// Hurikán na mapě: střed bouře, dráha, a hlavně skutečný dosah větru – zvlášť pro každou čtvrtinu (SV, JV, JZ, SZ),
// takže je vidět, že bouře není kruh. Data: NOAA National Hurricane Center (ATCF best track), body po 6 hodinách.
window.Storm = (() => {
  const D2R = Math.PI / 180, RE = 6371, el = (s) => document.querySelector(s);
  const QUAD = ["north-east", "south-east", "south-west", "north-west"];
  const WIND = [["r34", 63, "Tropical-storm force (63 km/h and more)", "#5fd0c5"], ["r50", 93, "Damaging (93 km/h and more)", "#ffc140"], ["r64", 119, "Hurricane force (119 km/h and more)", "#ff6060"]];
  const fmtT = (t) => `${t.slice(0, 10)} ${t.slice(11, 16)} UTC`;
  let map, on = false, data = null, i = 0, timer = null, photo = false;
  const marker = new maplibregl.Marker({ element: Object.assign(document.createElement("div"), { className: "eye", innerHTML: "<span></span>" }) });

  // Saffirova–Simpsonova stupnice podle maximálního větru (uzly)
  function cat(p) {
    const k = p.kt;
    if (!["HU", "TS", "TD", "SS", "SD"].includes(p.type)) return ["Not a tropical storm at this time", "#9aa2ad", p.type === "DB" ? "disturbance, still forming" : "post-tropical low"];
    if (k >= 137) return ["Category 5 hurricane", "#c464d9"]; if (k >= 113) return ["Category 4 hurricane", "#ff6060"];
    if (k >= 96) return ["Category 3 hurricane", "#ff8f20"]; if (k >= 83) return ["Category 2 hurricane", "#ffc140"];
    if (k >= 64) return ["Category 1 hurricane", "#ffe775"]; if (k >= 34) return ["Tropical storm", "#5fd0c5"];
    return ["Tropical depression", "#7fb7e6"];
  }
  function dest(lat, lon, brg, km) {
    const d = km / RE, p1 = lat * D2R, t = brg * D2R;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
    return [lon + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2)) / D2R, p2 / D2R];
  }
  // Obrys dosahu: každá čtvrtina má vlastní poloměr, proto má tvar „schodů“, ne kruhu
  function ring(p, r) {
    const c = [];
    for (let b = 0; b <= 360; b += 3) c.push(dest(p.lat, p.lon, b, r[Math.min(3, Math.floor((b % 360) / 90))]));
    return c;
  }
  const kmh = (kt) => Math.round(kt * 1.852);

  async function enter(m, id, at) {
    map = m; on = true;
    document.body.classList.add("storm");
    el("#stormbox").innerHTML = `<p class="status">Loading the storm track…</p>`;
    try { data = await Loader.during("Loading the storm track…", fetch(`data/storms/${id}.json`).then((r) => r.json())); } catch { el("#stormbox").innerHTML = `<p class="status">This storm's data could not be loaded.</p>`; return; }
    if (!on) return;
    const P = data.points, peak = P.reduce((a, b) => (b.kt > a.kt ? b : a)), firstHU = P.find((p) => p.type === "HU"), last = P.at(-1);
    const r = peak.r34, qmax = r ? r.indexOf(Math.max(...r)) : 0, qmin = r ? r.indexOf(Math.min(...r)) : 0;
    data.peak = P.indexOf(peak);
    data.inland = P.slice(data.peak + 1).find((p) => p.type !== "HU") || last;
    el("#stormbox").innerHTML = `
      <div class="kind">Nature · hurricane, strong wind, high waves</div>
      <h1>Hurricane ${data.name}, ${data.where}</h1>
      <p class="mono meta">${data.basin} ${data.season} · ${P.length} positions, 6 hours apart · ${P[0].t.slice(0, 10)} → ${last.t.slice(0, 10)}</p>
      <section class="insight plain"><h2>What happened</h2>
        <p>${data.name} was tracked from ${P[0].t.slice(0, 10)} to ${last.t.slice(0, 10)} in the ${data.where}.${firstHU ? ` It became a hurricane on ${firstHU.t.slice(0, 10)} and` : " It"} peaked on ${fmtT(peak.t)} with winds of ${kmh(peak.kt)} km/h (${cat(peak)[0].toLowerCase()}) and a central pressure of ${peak.hpa} hPa.${r ? ` A hurricane is not a circle: at that moment tropical-storm-force wind reached ${r[qmax]} km from the centre to the ${QUAD[qmax]} but only ${r[qmin]} km to the ${QUAD[qmin]}.` : ""}</p>
        <div class="kpis" id="st-kpis"></div>
      </section>
      <section class="timeline">
        <div class="tl-head"><button id="st-play" class="play">Play</button><label class="sound"><input id="st-sound" type="checkbox" checked> Sound</label><span id="st-date" class="mono date"></span></div>
        <input id="st-frame" type="range" min="0" max="${P.length - 1}" value="0" aria-label="Time along the storm track">
        <svg id="st-chart" class="chart" viewBox="0 0 400 120" role="img" aria-label="Maximum wind over time"></svg>
        <h2 class="mini">How far the wind reaches right now (km from the centre)</h2>
        <div id="st-reach"></div>
        <div class="tools">
          <button id="st-photo" aria-pressed="false">Satellite photo of that day</button>
          <button id="st-radar">Radar images of the coast it hit</button>
        </div>
        <p class="hint" id="st-note"></p>
      </section>
      <article class="story">
        <h2>What you see on the map</h2>
        <p>The spinning mark is the centre of the storm. The line is its path: solid where it has been, faint where it went later, coloured by strength. The three shaded shapes show how far three strengths of wind reach in each quarter of the storm. The dashed white outline is the area where waves are higher than 3.7 m (12 ft), when it was reported.</p>
        <h2>What we know and what we do not</h2>
        <p>Position, wind, pressure and reach come from the National Hurricane Center's analysis of aircraft, satellite and buoy measurements. They are estimates, given every 6 hours and rounded; the reach is the largest distance in each quarter, so the real wind field is patchier than the shapes suggest. Radar from NISAR is not used here: it maps the land surface, and can show flooding after landfall (use the radar button).</p>
        <h2>Sound</h2><p>Each step plays one note: the stronger the wind, the higher the note.</p>
        <details><summary>Sources</summary>
          <p>Track, wind, pressure, wind reach and wave reach: ${data.source}, <a href="${data.url}" target="_blank" rel="noopener">${data.url}</a>.</p>
          <p>Photo: NASA GIBS, VIIRS (NOAA-20) true colour, the daytime pass on the selected date. It is taken once a day in the early afternoon local time, so the clouds can sit ahead of or behind the marked centre.</p>
        </details>
      </article>`;
    // mapové vrstvy
    for (const l of ["perim", "sar"]) if (map.getLayer(l)) map.removeLayer(l);
    for (const s of ["perim", "sar"]) if (map.getSource(s)) map.removeSource(s);
    const fc = (f) => ({ type: "FeatureCollection", features: f });
    map.addSource("st-wind", { type: "geojson", data: fc([]) });
    map.addSource("st-seas", { type: "geojson", data: fc([]) });
    map.addSource("st-track", { type: "geojson", data: fc([]) });
    map.addSource("st-pts", { type: "geojson", data: fc(P.map((p, k) => ({ type: "Feature", properties: { k, color: cat(p)[1] }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } }))) });
    map.addLayer({ id: "st-wind", type: "fill", source: "st-wind", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.28 } });
    map.addLayer({ id: "st-wind-line", type: "line", source: "st-wind", paint: { "line-color": ["get", "color"], "line-width": 1.2, "line-opacity": 0.9 } });
    map.addLayer({ id: "st-seas", type: "line", source: "st-seas", paint: { "line-color": "#ffffff", "line-width": 1.4, "line-dasharray": [2, 2], "line-opacity": 0.85 } });
    map.addLayer({ id: "st-track", type: "line", source: "st-track", paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": ["case", ["get", "past"], 0.95, 0.3] } });
    map.addLayer({ id: "st-pts", type: "circle", source: "st-pts", paint: { "circle-radius": 4, "circle-color": ["get", "color"], "circle-stroke-color": "#0b0d10", "circle-stroke-width": 1 } });
    const lons = P.map((p) => p.lon), lats = P.map((p) => p.lat);
    map.resize();
    map.fitBounds([[Math.min(...lons) - 4, Math.min(...lats) - 3], [Math.max(...lons) + 4, Math.max(...lats) + 3]], { padding: 20, duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1200 });
    marker.setLngLat([P[0].lon, P[0].lat]).addTo(map);
    // ovládání
    el("#st-frame").oninput = (e) => { stop(); show(+e.target.value); };
    el("#st-play").onclick = () => {
      if (timer) return stop();
      Sonify.resume(); el("#st-play").textContent = "Pause";
      if (i === P.length - 1) show(0);
      timer = setInterval(() => (i === P.length - 1 ? stop() : show(i + 1, true)), 700);
    };
    el("#st-photo").onclick = () => { photo = !photo; el("#st-photo").setAttribute("aria-pressed", photo); setPhoto(); };
    el("#st-radar").onclick = () => { location.hash = `#live=${data.inland.lon.toFixed(3)},${data.inland.lat.toFixed(3)}`; };
    const start = at ? P.findIndex((p) => p.t.startsWith(at)) : -1;
    show(start >= 0 ? start : data.peak);
  }

  function stop() { clearInterval(timer); timer = null; const b = el("#st-play"); if (b) b.textContent = "Play"; }

  function setPhoto() {
    if (map.getLayer("st-photo")) map.removeLayer("st-photo");
    if (map.getSource("st-photo")) map.removeSource("st-photo");
    if (!photo || !on) return;
    const day = data.points[i].t.slice(0, 10);
    map.addSource("st-photo", { type: "raster", tileSize: 256, maxzoom: 9, attribution: "Photo: NASA GIBS VIIRS",
      tiles: [`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/${day}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`] });
    map.addLayer({ id: "st-photo", type: "raster", source: "st-photo", paint: { "raster-opacity": 0.9 } }, "st-wind");
    setPhoto.day = day;
  }

  function show(k, sound) {
    const P = data.points, p = P[k], c = cat(p);
    i = k;
    el("#st-frame").value = k; el("#st-frame").setAttribute("aria-valuetext", fmtT(p.t));
    el("#st-date").textContent = fmtT(p.t);
    marker.setLngLat([p.lon, p.lat]);
    marker.getElement().style.setProperty("--c", c[1]);
    marker.getElement().classList.toggle("calm", p.kt < 34);
    const fc = (f) => ({ type: "FeatureCollection", features: f });
    map.getSource("st-wind").setData(fc(WIND.filter(([key]) => p[key]).map(([key, , , color]) => ({ type: "Feature", properties: { color }, geometry: { type: "Polygon", coordinates: [ring(p, p[key])] } }))));
    map.getSource("st-seas").setData(fc(p.seas ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: ring(p, p.seas) } }] : []));
    map.getSource("st-track").setData(fc(P.slice(1).map((q, j) => ({ type: "Feature", properties: { color: cat(P[j])[1], past: j < k }, geometry: { type: "LineString", coordinates: [[P[j].lon, P[j].lat], [q.lon, q.lat]] } }))));
    if (photo && setPhoto.day !== p.t.slice(0, 10)) setPhoto();
    const prev = P[Math.max(0, k - 1)], dk = p.kt - prev.kt;
    el("#st-kpis").innerHTML = [[c[2] ? "Status" : "Strength", c[2] ? c[2] : c[0]], ["Strongest wind", `${kmh(p.kt)} km/h`], ["Pressure at the centre", p.hpa ? `${p.hpa} hPa` : "—"]]
      .map(([l, v]) => `<div><span>${l}</span><b style="${l === "Strength" ? `color:${c[1]}` : ""}">${v}</b></div>`).join("")
      + `<p class="hint" style="grid-column:1/-1;margin:2px 0 0">${k ? `Since 6 hours earlier the wind ${dk > 0 ? `rose by ${kmh(dk)} km/h (strengthening)` : dk < 0 ? `fell by ${kmh(-dk)} km/h (weakening)` : "did not change"}.` : "First position in the record."}${p.rmwKm ? ` The strongest wind is about ${p.rmwKm} km from the centre.` : ""}</p>`;
    const rows = WIND.map(([key, , label, color]) => [label, color, p[key]]).concat([["Waves higher than 3.7 m", "#ffffff", p.seas]]);
    el("#st-reach").innerHTML = rows.some((r) => r[2])
      ? `<table class="reach"><thead><tr><th></th><th>NE</th><th>SE</th><th>SW</th><th>NW</th></tr></thead><tbody>${rows.map(([label, color, r]) => `<tr><th><i style="background:${color}"></i>${label}</th>${r ? r.map((v) => `<td>${v || "—"}</td>`).join("") : `<td colspan="4" class="na">not reported at this time</td>`}</tr>`).join("")}</tbody></table>`
      : `<p class="hint">No wind reach is reported for this time: the storm was ${p.kt < 34 ? "still weaker than a tropical storm" : "not analysed in that detail"}. Move the timeline to a later position.</p>`;
    el("#st-note").textContent = photo ? `Photo: VIIRS daytime pass on ${p.t.slice(0, 10)}. The marked centre is for ${p.t.slice(11, 16)} UTC, so the clouds may be offset.` : "";
    chart();
    history.replaceState(null, "", `#storm=${data.id}&t=${p.t.slice(0, 13)}` + v3());
    if (sound && el("#st-sound").checked) Sonify.play("water", Math.min(1, p.kt / 160), 0);
  }

  function chart() {
    const P = data.points, W = 400, H = 120, L = 44, B = 22, max = Math.max(...P.map((p) => p.kt)) * 1.852;
    const x = (k) => L + (k / (P.length - 1)) * (W - L - 12), y = (kt) => H - B - ((kt * 1.852) / max) * (H - B - 12);
    el("#st-chart").innerHTML = `<line x1="${L}" y1="${H - B}" x2="${W - 12}" y2="${H - B}" stroke="#232830"/>
      <line x1="${L}" y1="${y(64)}" x2="${W - 12}" y2="${y(64)}" stroke="#3a414c" stroke-dasharray="3 3"/><text x="${W - 12}" y="${y(64) - 3}" text-anchor="end">hurricane from 119 km/h</text>
      <polyline points="${P.map((p, k) => `${x(k).toFixed(1)},${y(p.kt).toFixed(1)}`).join(" ")}" fill="none" stroke="#8b939e" stroke-width="1.2"/>
      ${P.map((p, k) => `<circle cx="${x(k).toFixed(1)}" cy="${y(p.kt).toFixed(1)}" r="${k === i ? 5 : 2.5}" fill="${cat(p)[1]}"/>`).join("")}
      <line x1="${x(i)}" y1="6" x2="${x(i)}" y2="${H - B}" stroke="#e8eaed" stroke-dasharray="2 3"/>
      <text x="${L - 6}" y="${y(max / 1.852) + 4}" text-anchor="end">${Math.round(max)}</text><text x="${L - 6}" y="${H - B + 3}" text-anchor="end">0</text><text x="${L - 6}" y="9" text-anchor="end">km/h</text>
      <text x="${L}" y="${H - 6}">${P[0].t.slice(0, 10)}</text><text x="${W - 12}" y="${H - 6}" text-anchor="end">${P.at(-1).t.slice(0, 10)}</text>`;
    el("#st-chart").onclick = (e) => { const r = el("#st-chart").getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W; let b = 0; P.forEach((_, k) => Math.abs(x(k) - px) < Math.abs(x(b) - px) && (b = k)); stop(); show(b); };
  }

  function exit() {
    if (!on) return;
    on = false; stop(); photo = false;
    document.body.classList.remove("storm");
    marker.remove();
    for (const l of ["st-pts", "st-track", "st-seas", "st-wind-line", "st-wind", "st-photo"]) if (map.getLayer(l)) map.removeLayer(l);
    for (const s of ["st-pts", "st-track", "st-seas", "st-wind", "st-photo"]) if (map.getSource(s)) map.removeSource(s);
  }

  function bind(m) {
    map = m;
    map.on("click", (e) => { if (!on || !map.getLayer("st-pts")) return; const f = map.queryRenderedFeatures(e.point, { layers: ["st-pts"] })[0]; if (f) { stop(); show(f.properties.k); } });
  }
  return { enter, exit, bind, marker, get on() { return on; } };
})();
