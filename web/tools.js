// Nástroje „prozkoumej si to sám“ nad radarovými snímky připravených míst.
// Všechny počítají ze stejného rozdílu dvou přeletů jako vrstva Change (právě zobrazené datum proti výchozímu snímku).
(() => {
  const q = (s) => document.querySelector(s), out = (html) => { q("#tool-out").innerHTML = html; };
  const fc = (f) => ({ type: "FeatureCollection", features: f });
  const ha = (px, r) => { const v = px * r.pxKm2 * 100; return v >= 1000 ? `${Math.round(v).toLocaleString("en-US")} ha` : `${v.toFixed(v < 10 ? 1 : 0)} ha`; };
  let mode = null, pts = [], ghostBack = null;

  // --- společné: převod souřadnic a rozdíl dvou přeletů -----------------------------------------------------------
  function toPx(ll) { // zeměpisná poloha → pixel radarového výřezu (512 × 512)
    const [tl, tr, , bl] = state.data.corners, ax = tr[0] - tl[0], ay = tr[1] - tl[1], bx = bl[0] - tl[0], by = bl[1] - tl[1];
    const det = ax * by - ay * bx, px = ll.lng - tl[0], py = ll.lat - tl[1];
    return [((px * by - py * bx) / det) * 512, ((ax * py - ay * px) / det) * 512];
  }
  async function diffNow() {
    const d = state.data;
    if (state.i === state.base) { out(`You are looking at the reference image itself (${d.frames[state.base].date}), so there is nothing to compare. Move the timeline to another date and try again.`); return null; }
    const r = await dynChange(state.i, state.base);
    if (!r) out(`One of these two passes has no ${d.analysis.pol} image, so the change cannot be computed. Pick another date.`);
    return r;
  }
  function layer(id, defs) {
    if (map.getSource(id)) return;
    map.addSource(id, { type: "geojson", data: fc([]) });
    defs.forEach((l, n) => map.addLayer({ id: `${id}-${n}`, source: id, ...l }));
  }
  function drop(id) {
    for (let n = 0; n < 4; n++) if (map.getLayer(`${id}-${n}`)) map.removeLayer(`${id}-${n}`);
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  }
  function setMode(m, btn) {
    mode = m; window.DE_TOOL = !!m;
    document.body.classList.toggle("tooling", !!m);
    document.querySelectorAll("#toolbar button").forEach((b) => b.setAttribute("aria-pressed", b === btn && !!m));
    if (m !== "trace") map.dragPan.enable();
  }
  const dates = () => `${state.data.frames[state.i].date} compared with ${state.data.frames[state.base].date}`;

  // --- 1) Obkreslit plochu a zjistit, na kolika hektarech radar zachytil změnu ---------------------------------------
  function areaStart() {
    if (mode === "area") return areaCancel();
    drop("t-area"); pts = [];
    layer("t-area", [{ type: "fill", paint: { "fill-color": "#e9b949", "fill-opacity": 0.15 } }, { type: "line", paint: { "line-color": "#e9b949", "line-width": 2 } }, { type: "circle", paint: { "circle-radius": 4, "circle-color": "#e9b949" } }]);
    setMode("area", q("#t-area"));
    out(`Click on the map to mark the corners of a field, a forest or a bay (at least three). <button data-act="area-done">Finish</button><button data-act="area-cancel">Cancel</button>`);
  }
  function areaDraw() {
    const ring = pts.map((p) => [p.lng, p.lat]);
    map.getSource("t-area")?.setData(fc([...(ring.length > 2 ? [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] } }] : ring.length === 2 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: ring } }] : []),
      ...ring.map((c) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } }))]));
  }
  function areaCancel() { setMode(null); drop("t-area"); out(""); }
  async function areaDone() {
    if (pts.length < 3) { out(`Mark at least three corners first. <button data-act="area-cancel">Cancel</button>`); return; }
    setMode(null);
    const r = await diffNow(); if (!r) return;
    const poly = pts.map(toPx), xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]), a = state.data.analysis;
    let n = 0, loss = 0, gain = 0, all = 0;
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(511, Math.ceil(Math.max(...ys))); y++) for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(511, Math.ceil(Math.max(...xs))); x++) {
      let inside = false; // bod uvnitř mnohoúhelníku (paprsková metoda)
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i][1] > y + 0.5) !== (poly[j][1] > y + 0.5) && x + 0.5 < ((poly[j][0] - poly[i][0]) * (y + 0.5 - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) inside = !inside;
      if (!inside) continue;
      all++;
      const k = y * 512 + x; if (!r.ok[k]) continue;
      n++; if (r.diff[k] < -a.thresholdDb) loss++; else if (r.diff[k] > a.thresholdDb) gain++;
    }
    if (!n) { out(`Your outline is outside the radar image, or covers no measured pixels. <button data-act="area-clear">Clear</button>`); return; }
    out(`<b>Your area: ${ha(n, r)}</b> of radar image${all > n ? " (part of your outline lies outside it)" : ""}. ${dates()}, the ${a.pol} signal is more than ${a.thresholdDb} dB <b>darker on ${ha(loss, r)}</b> (${Math.round((loss / n) * 100)}%) and <b>brighter on ${ha(gain, r)}</b> (${Math.round((gain / n) * 100)}%). One pixel is about ${Math.round(Math.sqrt(r.pxKm2) * 1000)} m wide, so small areas are rough. Radar shows that something changed, not why. <button data-act="area-clear">Clear</button>`);
  }

  // --- 2) Přejet po řece a slyšet, kde byla změna největší --------------------------------------------------------
  let tr = null;
  async function traceStart() {
    if (mode === "trace") return traceCancel();
    const r = await diffNow(); if (!r) return;
    drop("t-trace");
    layer("t-trace", [{ type: "line", paint: { "line-color": "#ffffff", "line-width": 2, "line-opacity": 0.8 } }, { type: "circle", filter: ["==", ["get", "max"], true], paint: { "circle-radius": 11, "circle-color": "#fff7b0", "circle-opacity": 0.35, "circle-stroke-color": "#fff", "circle-stroke-width": 2.5 } }]);
    tr = { r, path: [], best: null, osc: null };
    setMode("trace", q("#t-trace"));
    map.dragPan.disable();
    out(`Press and drag along a river, a shore or a road. You will hear the change under your finger: <b>higher and louder means a bigger change</b>. Let go to see where it was biggest. <button data-act="trace-cancel">Cancel</button>`);
  }
  function traceCancel() { traceStop(); setMode(null); drop("t-trace"); out(""); }
  function traceStop() { if (tr?.osc) { try { tr.gain.gain.setTargetAtTime(0, tr.ac.currentTime, 0.03); tr.osc.stop(tr.ac.currentTime + 0.2); } catch { /* už neběží */ } tr.osc = null; } }
  function traceDown(e) {
    if (mode !== "trace" || !tr) return;
    tr.path = []; tr.best = null; tr.down = true;
    try {
      tr.ac ??= new AudioContext();
      tr.ac.resume();
      tr.osc = tr.ac.createOscillator(); tr.gain = tr.ac.createGain();
      tr.osc.type = "triangle"; tr.gain.gain.value = 0;
      tr.osc.connect(tr.gain).connect(tr.ac.destination); tr.osc.start();
    } catch { /* bez zvuku to funguje také */ }
    traceMove(e);
  }
  function traceMove(e) {
    if (mode !== "trace" || !tr?.down) return;
    const b = map.getCanvas().getBoundingClientRect(), ll = map.unproject([e.clientX - b.left, e.clientY - b.top]), [x, y] = toPx(ll);
    tr.path.push([ll.lng, ll.lat]);
    let v = 0;
    if (x >= 0 && y >= 0 && x < 512 && y < 512) { const k = Math.floor(y) * 512 + Math.floor(x); if (tr.r.ok[k]) v = tr.r.diff[k]; }
    const m = Math.min(1, Math.abs(v) / 8);
    if (tr.osc) { tr.osc.frequency.setTargetAtTime(196 * Math.pow(2, m * 2), tr.ac.currentTime, 0.02); tr.gain.gain.setTargetAtTime(0.015 + m * 0.22, tr.ac.currentTime, 0.02); }
    if (!tr.best || Math.abs(v) > Math.abs(tr.best.v)) tr.best = { v, ll };
    map.getSource("t-trace")?.setData(fc([{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: tr.path.length > 1 ? tr.path : [tr.path[0], tr.path[0]] } }]));
  }
  function traceUp() {
    if (mode !== "trace" || !tr?.down) return;
    tr.down = false; traceStop();
    const b = tr.best, a = state.data.analysis;
    setMode(null);
    if (!b || tr.path.length < 2) { out(`That was too short. Press <b>Trace a line and listen</b> and drag a longer line.`); drop("t-trace"); return; }
    map.getSource("t-trace")?.setData(fc([{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: tr.path } }, { type: "Feature", properties: { max: true }, geometry: { type: "Point", coordinates: [b.ll.lng, b.ll.lat] } }]));
    out(Math.abs(b.v) < a.showDb
      ? `Along your line the radar signal hardly changed (at most ${Math.abs(b.v).toFixed(1)} dB), ${dates()}. Try another place or another date. <button data-act="trace-clear">Clear</button>`
      : `<b>Biggest change along your line: ${b.v < 0 ? "−" : "+"}${Math.abs(b.v).toFixed(1)} dB</b> (${a.pol} got ${b.v < 0 ? "darker" : "brighter"}), ${dates()}. It is the glowing ring on the map, at ${b.ll.lat.toFixed(3)}°, ${b.ll.lng.toFixed(3)}°. <button data-act="trace-point">Chart this spot</button><button data-act="trace-clear">Clear</button>`);
  }

  // --- 3) Hádanka: dva snímky, co se změnilo? ------------------------------------------------------------------
  const OPTS = ["Water spread over land", "Water retreated and left dry ground", "Vegetation burned", "Forest was cleared", "Farm fields changed"];
  const QUIZ = [["tonle-sap", 0], ["poyang", 1], ["shingle", 2], ["rondonia", 3], ["central-valley", 4]];
  let lastQuiz = -1;
  async function quiz() {
    let n; do { n = Math.floor(Math.random() * QUIZ.length); } while (n === lastQuiz);
    lastQuiz = n;
    const [site, answer] = QUIZ[n];
    document.body.classList.add("quiz");
    q("#quiz").hidden = false;
    q("#quiz").innerHTML = `<p>Loading two radar images…</p>`;
    await loadSite(site, { layer: "hh", compare: "1" });
    if (q("#heat").getAttribute("aria-pressed") === "true" && !q("#heat").hidden) q("#heat").click();
    if (q("#perim").getAttribute("aria-pressed") === "true" && !q("#perim").hidden) q("#perim").click();
    const d = state.data;
    q("#quiz").innerHTML = `<h2>What changed here?</h2><p>Two radar images of the same place: ${d.frames[state.base].date} on the left, ${d.frames[state.i].date} on the right. Drag the yellow line on the map, then choose.</p>
      <div class="opts">${OPTS.map((o, k) => `<button data-quiz="${k}">${o}</button>`).join("")}</div><button data-quiz="close">Close the quiz</button>`;
    q("#quiz").onclick = (e) => {
      const b = e.target.closest("[data-quiz]"); if (!b) return;
      if (b.dataset.quiz === "close") { quizEnd(); return; }
      if (b.dataset.quiz === "next") { quiz(); return; }
      const ok = +b.dataset.quiz === answer;
      document.body.classList.remove("quiz");
      q('[data-layer="change"]').click();
      q("#quiz").innerHTML = `<h2 class="${ok ? "ok" : "no"}">${ok ? "Correct!" : "Not quite."}</h2><p><b>${OPTS[answer]}.</b> This is ${d.name}. The coloured Change layer is now on, so you can see where.</p><p>${q("#insight").textContent}</p>
        <div class="tools"><button data-quiz="next" class="primary">Another one</button><button data-quiz="close">Close</button></div>`;
    };
  }
  function quizEnd() { document.body.classList.remove("quiz"); q("#quiz").hidden = true; }

  // --- 4) Požár: kde radar zachytil úbytek i za oficiální hranicí -------------------------------------------------
  function outside() {
    const d = state.data, last = d.frames.length - 1, f = d.frames[last];
    if (map.getLayer("t-outside")) { drop("t-outside"); q("#t-outside").setAttribute("aria-pressed", "false"); out(""); return; }
    show(last, false);
    q('[data-layer="change"]').click();
    if (!state.compare) q("#compare").click();
    map.addSource("t-outside", { type: "image", url: `data/${state.site}/${f.outside}`, coordinates: d.corners });
    map.addLayer({ id: "t-outside", type: "raster", source: "t-outside", paint: { "raster-fade-duration": 0 } }, map.getLayer("heat-old") ? "heat-old" : map.getLayer("perim") ? "perim" : undefined);
    q("#t-outside").setAttribute("aria-pressed", "true");
    if (f.outsideFocus) map.flyTo({ center: f.outsideFocus, zoom: 10.6, duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1200 });
    out(`<b>Purple: ${f.lossOutsideKm2} km²</b> where radar saw the same loss of vegetation signal <b>outside</b> the official fire line (${Math.round((f.lossOutsideKm2 / f.lossKm2) * 100)}% of all detected loss on ${f.date}). The map moved to the place with most of it. Drag the yellow line to compare before and after. This is <b>not proof</b> that the fire went further: logging, farming, or a perimeter drawn a little too tight can look the same. It tells an inspector where to look.`);
  }

  // --- 5) Jezero: kdy v kliknutém bodě byla voda a kdy souš --------------------------------------------------------
  function pointInfo() {
    const d = state.data, box = q("#point-info");
    if (!d || d.kind !== "water" || !state.point || !state.cube) { box.innerHTML = ""; return; }
    const thr = d.analysis.waterDb, pol = d.analysis.waterPol === "HV" ? 1 : 0;
    const wet = d.frames.map((_, t) => { const v = pixel(pol, t); return v == null ? null : v < thr; });
    const yes = d.frames.filter((_, t) => wet[t]).map((f) => f.date), known = wet.filter((w) => w != null).length;
    const runs = []; // souvislá období s vodou
    wet.forEach((w, t) => { if (w && !wet[t - 1]) runs.push([d.frames[t].date, d.frames[t].date]); else if (w) runs.at(-1)[1] = d.frames[t].date; });
    box.innerHTML = `<b>Water or dry land at this spot?</b><div class="strip" aria-hidden="true">${wet.map((w, t) => `<i class="${w == null ? "" : w ? "w" : "d"}${t === state.i ? " cur" : ""}" title="${d.frames[t].date}: ${w == null ? "no data" : w ? "open water" : "not open water"}"></i>`).join("")}</div>
      ${known ? `Radar saw <b>open water on ${yes.length} of ${known} passes</b>${yes.length && yes.length < known ? `: ${runs.map(([a, b]) => (a === b ? a : `${a} to ${b}`)).join(", and ")}` : yes.length ? " (always water)" : " (never open water)"}. ` : "No radar data at this spot. "}
      <span class="muted">Blue = open water (${d.analysis.waterPol} below ${thr} dB), sand = not open water. The spot is about ${Math.round((d.extentKm[0] / 128) * 1000)} m wide; water under trees does not count.</span>`;
  }

  // --- 6) Přenést změnu vody ve stejném měřítku nad jiné místo -----------------------------------------------------
  function ghostStart() {
    if (mode === "ghost") { setMode(null); out(""); return; }
    setMode("ghost", q("#t-ghost"));
    if (!map.getSource("t-labels")) { // názvy měst, aby šlo najít vlastní město
      map.addSource("t-labels", { type: "raster", tileSize: 256, maxzoom: 13, tiles: ["https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Reference_Labels_15m/default/GoogleMapsCompatible_Level13/{z}/{y}/{x}.png"], attribution: "Labels: NASA GIBS, © OpenStreetMap contributors" });
      map.addLayer({ id: "t-labels", type: "raster", source: "t-labels" });
    }
    out(`Zoom out, find your town (place names are now shown) and <b>click on it</b>. The water change will be drawn there at the same scale. <button data-act="ghost-here">Use my location</button><button data-act="ghost-cancel">Cancel</button>`);
  }
  async function ghostPlace(ll) {
    const d = state.data, i = state.i, b = state.base;
    setMode(null);
    let url;
    if (state.customBase) { const r = await dynChange(i, b); if (!r) { out("These two passes cannot be compared."); return; } url = r.cv.toDataURL("image/png"); }
    else if (d.frames[i].change) url = `data/${state.site}/${d.frames[i].change}`;
    else { out("There is no change map for this date. Pick another date first."); return; }
    const dLat = d.extentKm[1] / 2 / 111.32, dLon = d.extentKm[0] / 2 / (111.32 * Math.cos((ll.lat * Math.PI) / 180));
    const c = [[ll.lng - dLon, ll.lat + dLat], [ll.lng + dLon, ll.lat + dLat], [ll.lng + dLon, ll.lat - dLat], [ll.lng - dLon, ll.lat - dLat]];
    if (map.getLayer("t-ghost")) map.removeLayer("t-ghost");
    if (map.getSource("t-ghost")) map.removeSource("t-ghost");
    map.addSource("t-ghost", { type: "image", url, coordinates: c });
    map.addLayer({ id: "t-ghost", type: "raster", source: "t-ghost", paint: { "raster-opacity": 0.9, "raster-fade-duration": 0 } }, map.getLayer("t-labels") ? "t-labels" : undefined);
    ghostBack = map.getBounds();
    map.fitBounds([c[3], c[1]], { padding: 30, duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1200 });
    const ref = state.customBase ? d.frames[b].date : d.analysis.baselineDates[0];
    out(`This is the water change at <b>${d.name}</b> (${d.frames[i].date} compared with ${ref}) drawn over this place <b>at the same scale</b>: the square is ${Math.round(d.extentKm[0])} × ${Math.round(d.extentKm[1])} km. Blue: where open water appeared. Orange: where it retreated. It only shows size; this place was not flooded. <button data-act="ghost-back">Back to ${d.name.split(",")[0]}</button><button data-act="ghost-clear">Remove</button>`);
  }
  function ghostClear(back) {
    for (const id of ["t-ghost", "t-labels"]) { if (map.getLayer(id)) map.removeLayer(id); if (map.getSource(id)) map.removeSource(id); }
    if (back && ghostBack) map.fitBounds(ghostBack, { duration: 800 });
    setMode(null); out("");
  }

  // --- napojení -------------------------------------------------------------------------------------------------
  map.on("click", (e) => {
    if (mode === "area") { pts.push(e.lngLat); areaDraw(); }
    else if (mode === "ghost") ghostPlace(e.lngLat);
  });
  const cvs = map.getCanvasContainer();
  cvs.addEventListener("pointerdown", traceDown); cvs.addEventListener("pointermove", traceMove);
  addEventListener("pointerup", traceUp); addEventListener("pointercancel", traceUp);
  q("#t-area").onclick = areaStart; q("#t-trace").onclick = traceStart; q("#t-quiz").onclick = quiz; q("#t-outside").onclick = outside; q("#t-ghost").onclick = ghostStart;
  q("#tool-out").onclick = (e) => {
    const a = e.target.closest("[data-act]")?.dataset.act; if (!a) return;
    if (a === "area-done") areaDone(); else if (a === "area-cancel" || a === "area-clear") areaCancel();
    else if (a === "trace-cancel" || a === "trace-clear") traceCancel();
    else if (a === "trace-point") { const b = tr.best.ll; drop("t-trace"); out(""); if (setPoint(b)) show(state.i, false); }
    else if (a === "ghost-cancel") { setMode(null); out(""); }
    else if (a === "ghost-here") navigator.geolocation?.getCurrentPosition((p) => ghostPlace({ lng: p.coords.longitude, lat: p.coords.latitude }), () => out(`Your location is not available. Click on the map instead. <button data-act="ghost-cancel">Cancel</button>`));
    else if (a === "ghost-back") ghostClear(true); else if (a === "ghost-clear") ghostClear(false);
  };
  document.addEventListener("de:site", () => { // nové místo: uklidit po nástrojích a nabídnout ty, které k místu patří
    setMode(null); traceStop();
    for (const id of ["t-area", "t-trace", "t-outside"]) drop(id);
    for (const id of ["t-ghost", "t-labels"]) { if (map.getLayer(id)) map.removeLayer(id); if (map.getSource(id)) map.removeSource(id); }
    out(""); q("#point-info").innerHTML = "";
    const d = state.data, last = d.frames.at(-1);
    q("#t-ghost").hidden = d.kind !== "water";
    q("#t-outside").hidden = !(last.outside && last.lossOutsideKm2 > 0);
    q("#t-outside").setAttribute("aria-pressed", "false");
    if (!q("#t-outside").hidden) q("#t-outside").textContent = `Show the other ${Math.max(1, Math.round((last.lossOutsideKm2 / last.lossKm2) * 100))}%: loss outside the fire line`;
  });
  document.addEventListener("de:show", pointInfo);
  if (state.data) document.dispatchEvent(new Event("de:site"));
})();
