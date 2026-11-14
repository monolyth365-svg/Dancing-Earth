// Žár požáru na mapě: body, kde družice (VIIRS) v daný den zaznamenala oheň, nad radarovým snímkem.
// Rozlišuje „hoří právě ten den“, „hořelo před 1–3 dny“ a „hořelo dřív“. Spálenou plochu ukazuje radar (vrstva Change).
// Jsou to bodové detekce v okamžiku přeletu, ne souvislá teplotní mapa.
window.Fire = (() => {
  const el = (s) => document.querySelector(s);
  let map, H = null, site = null, frames = [], day = 0, onFrame = null, shown = true, busy = false, seq = [], popup = null;
  const CONF = { l: "low", n: "nominal", h: "high" };

  function clear() {
    H = null;
    popup?.remove(); window.Globe3D?.popup(null);
    if (!map) return;
    for (const l of ["heat-now", "heat-glow", "heat-recent", "heat-old"]) if (map.getLayer(l)) map.removeLayer(l);
    if (map.getSource("heat")) map.removeSource("heat");
    el("#fire").hidden = true; el("#heat").hidden = true;
  }

  async function attach(m, id, d, cb) {
    map = m; clear(); site = id; frames = d.frames; onFrame = cb;
    if (!d.hotspots) return;
    let h;
    try { h = await (await fetch(`data/${id}/${d.hotspots.file}`)).json(); } catch { return; }
    if (site !== id || !map.getSource("sar")) return;
    h.byDay = h.days.map(() => []);
    h.points.forEach((p, n) => h.byDay[p[0]].push(n));
    h.first = h.perDay.findIndex((c) => c > 0);
    h.last = h.perDay.length - 1 - [...h.perDay].reverse().findIndex((c) => c > 0);
    H = h;
    // Přehrávání: den po dni, dokud hoří, potom už jen po radarových přeletech
    seq = [];
    for (let k = Math.max(0, h.first - 1); k <= Math.min(h.days.length - 1, h.last + 2); k++) seq.push(k);
    frames.forEach((f) => { const k = h.days.indexOf(f.date); if (k > seq.at(-1)) seq.push(k); });
    const before = map.getLayer("perim") ? "perim" : undefined, r = (a, b) => ["interpolate", ["linear"], ["zoom"], 6, a, 11, b];
    map.addSource("heat", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "heat-old", type: "circle", source: "heat", filter: ["==", ["get", "a"], 2], paint: { "circle-radius": r(1, 3.2), "circle-color": "#8c2a17", "circle-opacity": 0.5 } }, before);
    map.addLayer({ id: "heat-recent", type: "circle", source: "heat", filter: ["==", ["get", "a"], 1], paint: { "circle-radius": r(1.2, 3.8), "circle-color": "#ff8a1f", "circle-opacity": 0.75 } }, before);
    map.addLayer({ id: "heat-glow", type: "circle", source: "heat", filter: ["==", ["get", "a"], 0], paint: { "circle-radius": r(4, 11), "circle-color": "#ffd24a", "circle-blur": 1, "circle-opacity": 0.5 } }, before);
    map.addLayer({ id: "heat-now", type: "circle", source: "heat", filter: ["==", ["get", "a"], 0], paint: { "circle-radius": r(1.6, 4.5), "circle-color": "#fff7b0", "circle-stroke-color": "#ff5a1f", "circle-stroke-width": 1 } }, before);
    el("#fire").hidden = false; el("#heat").hidden = false;
    el("#fire-day").max = h.days.length - 1;
    visible(shown);
    spark();
  }

  function visible(v) {
    shown = v;
    el("#heat").setAttribute("aria-pressed", v);
    for (const l of ["heat-now", "heat-glow", "heat-recent", "heat-old"]) if (map.getLayer(l)) map.setLayoutProperty(l, "visibility", v ? "visible" : "none");
    if (!v) { popup?.remove(); window.Globe3D?.popup(null); }
  }

  // Sloupečky: kolik detekcí žáru bylo který den
  function spark() {
    const W = 400, Hh = 36, n = H.days.length, max = Math.max(...H.perDay, 1), bw = W / n;
    el("#fire-spark").innerHTML = H.perDay.map((c, k) => `<rect x="${(k * bw).toFixed(1)}" y="${(Hh - 2 - (c / max) * (Hh - 6)).toFixed(1)}" width="${Math.max(1, bw - 0.8).toFixed(1)}" height="${((c / max) * (Hh - 6) + (c ? 1 : 0)).toFixed(1)}" fill="${k === day ? "#fff7b0" : k < day ? "#ff8a1f" : "#5a3a2a"}"/>`).join("")
      + frames.map((f) => { const k = H.days.indexOf(f.date); return k < 0 ? "" : `<rect x="${(k * bw + bw / 2 - 0.5).toFixed(1)}" y="${Hh - 2}" width="1.4" height="2" fill="#e8eaed"/>`; }).join("");
    el("#fire-spark").onclick = (e) => { const r = el("#fire-spark").getBoundingClientRect(); setDay(Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n))), true); };
  }

  function setDay(k, user, sound) {
    if (!H) return;
    day = k;
    const feats = [];
    for (let j = 0; j <= k; j++) {
      const a = k - j === 0 ? 0 : k - j <= 3 ? 1 : 2;
      for (const n of H.byDay[j]) { const p = H.points[n]; feats.push({ type: "Feature", properties: { a, n }, geometry: { type: "Point", coordinates: [p[2], p[3]] } }); }
    }
    map.getSource("heat")?.setData({ type: "FeatureCollection", features: feats });
    el("#fire-day").value = k; el("#fire-day").setAttribute("aria-valuetext", H.days[k]);
    const c = H.perDay[k], total = feats.length;
    el("#fire-label").textContent = H.days[k];
    el("#fire-note").textContent = c
      ? `${c.toLocaleString("en-US")} heat detections on this day (bright), ${total.toLocaleString("en-US")} since the fire began.`
      : k < H.first ? "No heat detected yet: the fire has not started." : k > H.last ? `No heat detected any more. The last detection was on ${H.days[H.last]}; the radar scar keeps showing what burned.` : "No heat detected on this day (cloud or smoke can hide a fire from the heat sensor, or it was quiet).";
    spark();
    if (user && onFrame) { // radarový snímek: poslední přelet do tohoto dne
      let j = 0;
      frames.forEach((f, n) => { if (f.date <= H.days[k]) j = n; });
      busy = true; onFrame(j, sound); busy = false;
    }
  }

  // Když uživatel posune radarovou časovou osu, den požáru se srovná s datem přeletu
  function sync(date) {
    if (!H || busy) return;
    let k = H.days.indexOf(date);
    if (k < 0) k = date < H.days[0] ? 0 : H.days.length - 1;
    setDay(k, false);
  }

  function play(done) {
    let s = seq.indexOf(day);
    if (s < 0 || s >= seq.length - 1) { s = 0; setDay(seq[0], true, true); }
    return setInterval(() => { s++; if (s >= seq.length) return done(); setDay(seq[s], true, true); }, 320);
  }

  // Klik na bod: kdy a čím byl žár zaznamenán
  function hit(e) {
    if (!H || !shown) return false;
    const f = map.queryRenderedFeatures([[e.point.x - 4, e.point.y - 4], [e.point.x + 4, e.point.y + 4]], { layers: ["heat-now", "heat-recent", "heat-old"].filter((l) => map.getLayer(l)) })[0];
    if (!f) return false;
    const p = H.points[f.properties.n];
    const html = `<b>Heat detected</b><br>${H.days[p[0]]} at ${p[1]} UTC (${p[7] === "D" ? "daytime" : "night"} pass)<br>Sensor: VIIRS on ${p[6]}, 375 m pixel<br>Fire radiative power: ${p[4]} MW<br>Confidence: ${CONF[p[5]] || p[5]}<br><span class="src">Source: NASA FIRMS via GIBS</span>`;
    popup?.remove(); popup = null;
    if (window.Globe3D?.on) Globe3D.popup({ lng: p[2], lat: p[3] }, html); // ve 3D pohledu bublina nad zeměkoulí
    else popup = new maplibregl.Popup({ closeButton: true, maxWidth: "260px" }).setLngLat([p[2], p[3]]).setHTML(html).addTo(map);
    return true;
  }

  // --- pomocné funkce pro ostatní části aplikace ---
  const stamp = (p) => Date.parse(`${H.days[p[0]]}T${p[1] || "00:00"}:00Z`);
  // Detekce žáru v okruhu km kolem bodu: kolik, kdy poprvé a naposled, a jak daleko je nejbližší
  function near(lng, lat, km) {
    if (!H) return null;
    const c = Math.cos((lat * Math.PI) / 180), res = { n: 0, first: null, last: null, nearestKm: Infinity, nearestDay: null };
    for (const p of H.points) {
      const d = Math.hypot((p[2] - lng) * c, p[3] - lat) * 111.32;
      if (d < res.nearestKm) { res.nearestKm = d; res.nearestDay = H.days[p[0]]; }
      if (d > km) continue;
      res.n++; res.first ??= `${H.days[p[0]]} ${p[1]} UTC`; res.last = `${H.days[p[0]]} ${p[1]} UTC`;
    }
    return res;
  }
  // Detekce z prvních hodin požáru (pro porovnání se simulací)
  function early(hours) {
    if (!H || !H.points.length) return [];
    const t0 = stamp(H.points[0]);
    return H.points.filter((p) => stamp(p) - t0 <= hours * 36e5).map((p) => [p[2], p[3]]);
  }
  // Základní fakta o průběhu požáru (pro „příběh požáru“)
  function facts() {
    if (!H || !H.points.length) return null;
    let w = 180, e = -180, s = 90, n = -90;
    for (const p of H.points) { if (p[2] < w) w = p[2]; if (p[2] > e) e = p[2]; if (p[3] < s) s = p[3]; if (p[3] > n) n = p[3]; }
    return { days: H.days, perDay: H.perDay, first: H.first, peak: H.perDay.indexOf(Math.max(...H.perDay)), last: H.last, firstTime: H.points[0][1], bbox: [[w, s], [e, n]] };
  }

  const legend = () => (!H || !shown ? "" : `<div class="heatleg"><b>Heat seen by satellite (VIIRS)</b>
    <span><i style="background:#fff7b0;border:1px solid #ff5a1f"></i>on the selected day</span><span><i style="background:#ff8a1f"></i>1–3 days earlier</span><span><i style="background:#8c2a17"></i>earlier: burned over</span>
    <em>Points are single detections at the moment the satellite passed, not a temperature map.</em></div>`);

  function bind() {
    el("#heat").onclick = () => { visible(!shown); document.dispatchEvent(new Event("fire-legend")); };
    el("#fire-day").oninput = (e) => setDay(+e.target.value, true);
  }

  return { attach, clear, sync, setDay, play, hit, legend, bind, near, early, facts, show: () => { visible(true); document.dispatchEvent(new Event("fire-legend")); }, playable: () => !!H && shown, day: () => (H ? H.days[day] : null), info: () => H && { first: H.days[H.first], last: H.days[H.last], count: H.points.length } };
})();
