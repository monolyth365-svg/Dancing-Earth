// „Co by se stalo, kdyby…“ – jednoduchá simulace šíření požáru při jiném větru.
// NENÍ to měření ani předpověď. Model: elipsa, jejíž protažení roste s rychlostí větru
// (vztah z kanadského systému Forest Fire Behaviour Prediction), a rychlost čela požáru roste s větrem.
// Kalibrace: při skutečném větru doběhne modelový požár za 24 h stejně daleko jako skutečné detekce žáru.
window.Sim = (() => {
  const el = (s) => document.querySelector(s), D2R = Math.PI / 180, RE = 6371, HOURS = [6, 12, 24];
  const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  const comp = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  let map, S = null, on = false;

  const LB = (U) => 1 + 8.729 * Math.pow(1 - Math.exp(-0.03 * U), 2.155); // poměr délky k šířce
  function dest([lon, lat], brg, km) {
    const d = km / RE, p1 = lat * D2R, t = brg * D2R;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
    return [lon + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2)) / D2R, p2 / D2R];
  }
  function shape(U, from, hours) {
    const lb = Math.max(1.0001, LB(U)), k = Math.sqrt(lb * lb - 1), hb = (lb + k) / (lb - k);          // hb: čelo běží hb× rychleji než týl
    const rate = Math.min(6, Math.max(0.2, Math.exp(0.05039 * (U - S.wind.speedKmh)))) * (S.observed.reachKm24 / 24); // km/h čela
    const head = rate * hours, back = head / hb, a = (head + back) / 2, b = a / lb, off = (head - back) / 2, to = (from + 180) % 360;
    const ring = [];
    for (let th = 0; th <= 360; th += 6) { const x = off + a * Math.cos(th * D2R), y = b * Math.sin(th * D2R); ring.push(dest(S.ignition, to + Math.atan2(y, x) / D2R, Math.hypot(x, y))); }
    return { ring, area: Math.PI * a * b, head, to };
  }

  function draw() {
    const U = +el("#sim-spd").value, from = +el("#sim-dir").value, fc = (f) => ({ type: "FeatureCollection", features: f });
    const mine = HOURS.map((h) => shape(U, from, h)), real = HOURS.map((h) => shape(S.wind.speedKmh, S.wind.fromDeg, h));
    map.getSource("sim-user").setData(fc(mine.map((m, n) => ({ type: "Feature", properties: { h: HOURS[n] }, geometry: { type: "Polygon", coordinates: [m.ring] } })).reverse()));
    map.getSource("sim-orig").setData(fc(el("#sim-orig").checked ? real.map((m, n) => ({ type: "Feature", properties: { h: HOURS[n] }, geometry: { type: "LineString", coordinates: m.ring } })) : []));
    el("#sim-dir-l").textContent = `the ${comp(from)} (${from}°)`;
    el("#sim-spd-l").textContent = `${U} km/h`;
    const m = mine[2], r = real[2], same = U === Math.round(S.wind.speedKmh) && from === Math.round(S.wind.fromDeg / 5) * 5;
    el("#sim-out").innerHTML = `${same ? "<b>This is the real wind of the first day.</b>" : "<b>Your scenario.</b>"} After 24 hours the model fire reaches ${m.head.toFixed(1)} km towards the ${comp(m.to)} and covers ${m.area < 10 ? m.area.toFixed(1) : Math.round(m.area)} km²${same ? "" : `; with the real wind (${S.wind.speedKmh} km/h from the ${comp(S.wind.fromDeg)}) it covers ${r.area < 10 ? r.area.toFixed(1) : Math.round(r.area)} km²`}. Orange rings: 6, 12 and 24 hours. White dashed rings: the same with the real wind. Bright dots: where satellites really saw heat in the first day.<br>Reality check: the real fire spread towards the ${comp(S.observed.spreadToDeg)}, while the model with the real wind points ${comp((S.wind.fromDeg + 180) % 360)}. Hills and fuel, which the model ignores, make the difference.`;
  }

  function open() {
    if (!S) return;
    on = true;
    el("#sim").hidden = false; el("#sim-open").hidden = true;
    const fc = { type: "FeatureCollection", features: [] }, before = map.getLayer("heat-old") ? "heat-old" : map.getLayer("perim") ? "perim" : undefined;
    map.addSource("sim-user", { type: "geojson", data: fc });
    map.addSource("sim-orig", { type: "geojson", data: fc });
    map.addSource("sim-ign", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: S.ignition } } });
    map.addLayer({ id: "sim-user", type: "fill", source: "sim-user", paint: { "fill-color": "#ff8a1f", "fill-opacity": 0.22 } }, before);
    map.addLayer({ id: "sim-user-line", type: "line", source: "sim-user", paint: { "line-color": "#ffb066", "line-width": 1.8 } }, before);
    map.addLayer({ id: "sim-orig", type: "line", source: "sim-orig", paint: { "line-color": "#ffffff", "line-width": 1.5, "line-dasharray": [2, 2] } });
    map.addLayer({ id: "sim-ign", type: "circle", source: "sim-ign", paint: { "circle-radius": 6, "circle-color": "#ffffff", "circle-stroke-color": "#ff2d1f", "circle-stroke-width": 3 } });
    reset();
    Fire.sync(new Date(Date.parse(S.start) + 864e5).toISOString().slice(0, 10)); // ukázat skutečné detekce z prvního dne
    const r = Math.max(8, S.observed.reachKm24 * 3.2), a = dest(S.ignition, 315, r * 1.414), b = dest(S.ignition, 135, r * 1.414);
    map.fitBounds([[a[0], b[1]], [b[0], a[1]]], { padding: 30, duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 900 });
  }
  function reset() { el("#sim-spd").value = Math.round(S.wind.speedKmh); el("#sim-dir").value = Math.round(S.wind.fromDeg / 5) * 5; draw(); }
  function close() {
    on = false;
    el("#sim").hidden = true; el("#sim-open").hidden = !S;
    if (!map) return;
    for (const l of ["sim-ign", "sim-orig", "sim-user-line", "sim-user"]) if (map.getLayer(l)) map.removeLayer(l);
    for (const s of ["sim-ign", "sim-orig", "sim-user"]) if (map.getSource(s)) map.removeSource(s);
  }
  function attach(m, d) {
    map = m; close();
    S = d.sim && d.hotspots ? d.sim : null;
    el("#sim-open").hidden = !S;
    if (S) el("#sim-about").innerHTML = `This is a teaching model, not a forecast and not a measurement. <b>Shape:</b> an ellipse that gets longer and narrower as the wind gets stronger (length-to-breadth relation from the Canadian Forest Fire Behaviour Prediction System). <b>Speed:</b> the front moves faster in stronger wind (as in that system's Initial Spread Index) and is calibrated so that, with the real wind, the model fire reaches as far in 24 hours as the real satellite detections did (${S.observed.reachKm24} km from the first hot spot, ${S.observed.detections24} detections). <b>It assumes</b> flat ground, the same fuel everywhere and a steady wind, so real fires are far less regular. <b>Starting point:</b> the first heat detection, ${S.start.replace("T", " ").replace("Z", " UTC")}. <b>Real wind:</b> ${S.wind.source}; gusts reached ${S.wind.gustKmh} km/h.`;
  }
  function bind() {
    el("#sim-open").onclick = open; el("#sim-close").onclick = close; el("#sim-reset").onclick = reset;
    for (const id of ["#sim-dir", "#sim-spd", "#sim-orig"]) el(id).oninput = draw;
  }
  return { attach, close, bind, get on() { return on; } };
})();
