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
    mode = m; window.DE_TOOL = !!m; window.DE_TRACE = m === "trace";
    document.dispatchEvent(new Event("de:tool")); // 3D pohled při kreslení čáry zamkne kameru
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
    const b = map.getCanvas().getBoundingClientRect(), ll = e.lngLat || map.unproject([e.clientX - b.left, e.clientY - b.top]), [x, y] = toPx(ll); // e.lngLat posílá 3D pohled
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
  // Vždy pro právě vybrané datum: tlačítko i fialová vrstva ukazují podíl úbytku mimo oficiální hranici v ten den
  function outsideLabel() {
    const d = state.data, f = d.frames[state.i], b = q("#t-outside"), has = !!d.perimeter && d.frames.some((x) => x.outside);
    b.hidden = !has;
    if (!has) return;
    const any = f.outside && f.lossKm2 > 0 && f.lossOutsideKm2 > 0, pct = any ? 100 - Math.round((f.lossInsideKm2 / f.lossKm2) * 100) : 0;
    b.disabled = !any;
    b.textContent = any ? `Show the ${pct < 1 ? "less than 1" : pct}% outside the fire line (${f.date})` : f.date < d.event ? "Before the fire: no loss to show yet" : `No loss outside the fire line on ${f.date}`;
    if (!map.getLayer("t-outside")) return;
    if (!any) { drop("t-outside"); b.setAttribute("aria-pressed", "false"); out(`On ${f.date} radar shows no loss outside the official fire line.`); return; }
    map.getSource("t-outside").updateImage({ url: `data/${state.site}/${f.outside}`, coordinates: d.corners });
    outsideText(f, pct);
  }
  const outsideText = (f, pct) => out(`<b>Purple: ${f.lossOutsideKm2} km²</b> where radar saw the same loss of vegetation signal <b>outside</b> the official fire line on ${f.date}: ${pct < 1 ? "less than 1" : pct}% of all loss detected that day (${100 - pct}% is inside). Drag the yellow line to compare before and after, and move the timeline to see other dates. This is <b>not proof</b> that the fire went further: logging, farming, or a perimeter drawn a little too tight can look the same. It tells an inspector where to look.`);
  function outside() {
    const d = state.data, f = d.frames[state.i];
    if (map.getLayer("t-outside")) { drop("t-outside"); q("#t-outside").setAttribute("aria-pressed", "false"); out(""); return; }
    if (!(f.outside && f.lossOutsideKm2 > 0)) return;
    q('[data-layer="change"]').click();
    if (!state.compare) q("#compare").click();
    map.addSource("t-outside", { type: "image", url: `data/${state.site}/${f.outside}`, coordinates: d.corners });
    map.addLayer({ id: "t-outside", type: "raster", source: "t-outside", paint: { "raster-fade-duration": 0 } }, map.getLayer("heat-old") ? "heat-old" : map.getLayer("perim") ? "perim" : undefined);
    q("#t-outside").setAttribute("aria-pressed", "true");
    if (f.outsideFocus) map.flyTo({ center: f.outsideFocus, zoom: 10.6, duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1200 });
    outsideText(f, 100 - Math.round((f.lossInsideKm2 / f.lossKm2) * 100));
  }

  // --- 5) Jezero: kdy v kliknutém bodě byla voda a kdy souš --------------------------------------------------------
  function pointInfo() {
    const d = state.data, box = q("#point-info");
    if (d && d.kind === "fire" && d.event && state.point && state.cube) { whyRed(); return; }
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

  // --- 5b) Požár: „Proč je tahle skvrna červená?“ ---------------------------------------------------------------
  // Pro kliknuté místo spojí tři nezávislé stopy: radar (pokles signálu vegetace a jestli vydržel),
  // žár (zachytila tu družice oheň?) a oficiální hranici požáru. Z toho složí opatrný závěr.
  let perim = null;
  async function rings() {
    const d = state.data;
    if (!d.perimeter) return null;
    if (perim?.site === state.site) return perim.rings;
    const gj = await (await fetch(`data/${state.site}/${d.perimeter.file}`)).json(), r = [];
    for (const ft of gj.features) for (const poly of ft.geometry.type === "MultiPolygon" ? ft.geometry.coordinates : [ft.geometry.coordinates]) for (const ring of poly) r.push(ring);
    perim = { site: state.site, rings: r };
    return r;
  }
  // uvnitř lichého počtu prstenců = uvnitř plochy (neshořelé ostrovy jsou díry)
  const inRings = (r, x, y) => { let c = false; for (const ring of r) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if ((ring[i][1] > y) !== (ring[j][1] > y) && x < ((ring[j][0] - ring[i][0]) * (y - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) c = !c; return c; };
  async function whyRed() {
    const d = state.data, box = q("#point-info"), a = d.analysis, pt = state.point, site = state.site, thr = a.thresholdDb;
    const hv = d.frames.map((_, t) => pixel(1, t)), pre = hv.filter((v, t) => v != null && d.frames[t].date < d.event);
    if (!pre.length) { box.innerHTML = `<b>What happened at this spot?</b> There is no radar measurement from before the fire here, so the change cannot be judged.`; return; }
    const base = pre.reduce((x, y) => x + y, 0) / pre.length, dv = hv.map((v) => (v == null ? null : v - base));
    const post = d.frames.map((_, t) => t).filter((t) => d.frames[t].date >= d.event && dv[t] != null);
    const firstLow = post.find((t) => dv[t] < -thr), later = firstLow == null ? [] : post.filter((t) => t > firstLow), kept = later.filter((t) => dv[t] < -thr).length;
    const lasting = firstLow != null && (!later.length || kept / later.length >= 0.6);
    const R = Math.max(0.6, (d.extentKm[0] / 128) * 1.5), heat = Fire.near(pt.lng, pt.lat, R), r = await rings();
    if (site !== state.site || pt !== state.point) return;
    const inside = r ? inRings(r, pt.lng, pt.lat) : null, now = dv[state.i], red = now != null && now < -a.showDb;
    const verdict = firstLow != null && heat?.n && lasting ? `<b class="ok">Very likely burned.</b> Three independent clues agree: a radar drop that lasted, heat detected right here${inside ? ", and the official fire line around it" : ""}.`
      : firstLow != null && heat?.n ? `<b class="ok">Probably burned,</b> but the radar drop did not last. Low plants can grow back, and rain can change the signal for one pass.`
      : firstLow != null && inside ? `<b>Plausibly burned.</b> Radar sees a loss inside the official fire line, but no heat was caught here. Fire can burn unseen under cloud or between two satellite passes.`
      : firstLow != null ? `<b class="no">Probably not this fire.</b> Radar sees a loss, but no heat was detected here${inside === false ? " and the spot is outside the official fire line" : ""}. Logging, farming or noise are more likely.`
      : heat?.n ? `<b>Burned lightly, if at all.</b> Heat was detected here, but radar shows no lasting loss. Grass and low shrubs burn without changing the L-band signal much.`
      : `<b>Nothing points to fire at this spot.</b>`;
    box.innerHTML = `<b>${red ? "Why is this spot red?" : "What happened at this spot?"}</b>
      <div class="strip" aria-hidden="true">${dv.map((v, t) => `<i class="${v == null ? "" : d.frames[t].date < d.event ? "p" : v < -thr ? "l" : "d2"}${t === state.i ? " cur" : ""}" title="${d.frames[t].date}: ${v == null ? "no data" : `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(1)} dB`}"></i>`).join("")}</div>
      <ul class="why">
        <li><b>Radar:</b> ${now == null ? `no measurement on ${d.frames[state.i].date}` : `on ${d.frames[state.i].date} the vegetation signal (HV) here is ${now < 0 ? "−" : "+"}${Math.abs(now).toFixed(1)} dB compared with before the fire${red ? ", which is why it is drawn red" : ""}`}. ${firstLow != null ? `A drop of more than ${thr} dB first shows on ${d.frames[firstLow].date}${later.length ? ` and is still there on <b>${kept} of the ${later.length} later ${later.length === 1 ? "pass" : "passes"}</b>` : ", the latest pass"}.` : `It never dropped by more than ${thr} dB after the fire began.`}</li>
        <li><b>Heat:</b> ${heat?.n ? `satellites detected fire within ${R.toFixed(1)} km of this spot <b>${heat.n} ${heat.n === 1 ? "time" : "times"}</b>, from ${heat.first} to ${heat.last}.` : heat ? `no heat was detected within ${R.toFixed(1)} km. The nearest detection was ${heat.nearestKm.toFixed(1)} km away (${heat.nearestDay}).` : "no heat data for this place."}</li>
        ${inside == null ? "" : `<li><b>Official fire line:</b> this spot is <b>${inside ? "inside" : "outside"}</b> it.</li>`}
      </ul>
      <p class="verdict">${verdict}</p>
      <span class="muted">Strip: one square per radar pass; grey-blue = before the fire, red = HV more than ${thr} dB lower, grey = not lower. The spot is about ${Math.round((d.extentKm[0] / 128) * 3 * 1000)} m wide, so this is a quick check, coarser than the map.</span>`;
  }

  // --- 6) Přenést změnu vody ve stejném měřítku nad jiné místo -----------------------------------------------------
  function ghostStart() {
    if (mode === "ghost") { setMode(null); out(""); return; }
    setMode("ghost", q("#t-ghost"));
    if (!map.getSource("t-labels")) { // názvy měst, aby šlo najít vlastní město
      map.addSource("t-labels", { type: "raster", tileSize: 256, maxzoom: 9, tiles: ["https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Reference_Labels/default/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png"], attribution: "Labels: NASA GIBS, © OpenStreetMap contributors" });
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

  // --- 7) Možná voda pod porostem ---------------------------------------------------------------------------------
  // Když voda zaplaví stromy, keře nebo rýži, radarový paprsek se odrazí od hladiny a pak od kmenů zpět k družici
  // („dvojitý odraz“). Kanál HH tím výrazně zesílí, kanál HV skoro ne. Hledáme tedy místa, kde HH proti výchozímu
  // snímku stouplo o víc než 3 dB a aspoň o 2 dB víc než HV, a kde zároveň není volná hladina.
  const fvCache = new Map();
  let fvOn = false;
  async function fvCompute(i, b) {
    const d = state.data, key = `${state.site}|${i}|${b}`;
    if (fvCache.has(key)) return fvCache.get(key);
    if (![i, b].every((k) => d.frames[k].hh && d.frames[k].hv)) return null;
    const N = 512, read = async (k, pol) => {
      const [lo, hi] = pol === "hh" ? [-25, 0] : [-32, -8], c = Object.assign(document.createElement("canvas"), { width: N, height: N }), x = c.getContext("2d", { willReadFrequently: true });
      x.drawImage(await img(path(k, pol)), 0, 0, N, N);
      const px = x.getImageData(0, 0, N, N).data, v = new Float32Array(N * N), ok = new Uint8Array(N * N);
      for (let n = 0; n < N * N; n++) { v[n] = lo + (px[n * 4] / 255) * (hi - lo); ok[n] = px[n * 4 + 3] >= 128 ? 1 : 0; }
      return { v: boxBlur(v, ok, N, 5), ok };
    };
    const [h1, v1, h0, v0] = await Promise.all([read(i, "hh"), read(i, "hv"), read(b, "hh"), read(b, "hv")]);
    const cv = Object.assign(document.createElement("canvas"), { width: N, height: N }), cx = cv.getContext("2d"), im = cx.createImageData(N, N), o = im.data, wdb = d.analysis.waterDb;
    let n = 0;
    for (let k = 0; k < N * N; k++) {
      if (!(h1.ok[k] && h0.ok[k]) || isNaN(h1.v[k]) || isNaN(h0.v[k]) || isNaN(v1.v[k]) || isNaN(v0.v[k])) continue;
      const dh = h1.v[k] - h0.v[k], dv = v1.v[k] - v0.v[k];
      if (dh > 3 && dh - dv > 2 && v1.v[k] > wdb + 2) { o[k * 4] = 110; o[k * 4 + 1] = 255; o[k * 4 + 2] = 120; o[k * 4 + 3] = 215; n++; }
    }
    cx.putImageData(im, 0, 0);
    const res = { cv, km2: (n * d.extentKm[0] * d.extentKm[1]) / (N * N) };
    fvCache.set(key, res);
    if (fvCache.size > 40) fvCache.delete(fvCache.keys().next().value);
    return res;
  }
  async function fvShow() {
    const d = state.data, site = state.site, i = state.i, b = state.base, note = q("#fv-note");
    if (!fvOn || !d || d.kind !== "water") { if (map.getLayer("t-fv")) map.removeLayer("t-fv"); if (map.getSource("t-fv")) map.removeSource("t-fv"); note.textContent = ""; return; }
    const r = i === b ? { cv: Object.assign(document.createElement("canvas"), { width: 2, height: 2 }), km2: 0 } : await fvCompute(i, b);
    if (site !== state.site || i !== state.i || !fvOn) return;
    if (!r) { note.textContent = "One of these two passes has no HV image, so this cannot be worked out. Pick another date."; return; }
    const url = r.cv.toDataURL("image/png");
    if (map.getSource("t-fv")) map.getSource("t-fv").updateImage({ url, coordinates: d.corners });
    else { map.addSource("t-fv", { type: "image", url, coordinates: d.corners }); map.addLayer({ id: "t-fv", type: "raster", source: "t-fv", paint: { "raster-fade-duration": 0 } }); }
    note.innerHTML = i === b
      ? `<b>Possible water under plants.</b> ${d.frames[b].date} is the reference image itself. Move the timeline or press Play to see where it appears.`
      : `<b>Green: ${r.km2 < 10 ? r.km2.toFixed(1) : Math.round(r.km2)} km² of possible water under plants</b> on ${d.frames[i].date}, compared with ${d.frames[b].date}. There the HH signal rose by more than 3 dB and much more than HV, which is what happens when water stands under trees, shrubs or rice and the radar pulse bounces between the water and the stems. It is a hint, not proof: no one checked it on the ground, and wet or ploughed fields can look similar. Open water (dark) is counted separately.`;
  }
  function fvToggle() { fvOn = !fvOn; q("#fv").setAttribute("aria-pressed", fvOn); fvShow(); }

  // --- 8) Příběh požáru ve třech krocích --------------------------------------------------------------------------
  // první záchyt žáru → den s nejvíce záchyty → jak stejné místo vidí radar o měsíc později
  let st = { n: 0, timer: null };
  function storySteps() {
    const d = state.data, F = Fire.facts();
    if (!F) return null;
    const target = Date.parse(F.days[F.first]) + 30 * 864e5;
    let fr = -1;
    d.frames.forEach((f, t) => { if (f.date > d.event && f.lossKm2 != null && (fr < 0 || Math.abs(Date.parse(f.date) - target) < Math.abs(Date.parse(d.frames[fr].date) - target))) fr = t; });
    const pre = d.frames.filter((f) => f.date < d.event).at(-1), f3 = d.frames[fr], k3 = F.days.indexOf(f3.date);
    const recent = k3 < 0 ? 0 : F.perDay.slice(Math.max(0, k3 - 2), k3 + 1).reduce((x, y) => x + y, 0), weeks = Math.round((Date.parse(f3.date) - Date.parse(F.days[F.first])) / (7 * 864e5));
    return [
      { go: () => { Fire.show(); if (state.compare) q("#compare").click(); Fire.setDay(F.first, true); },
        text: `<b>1 · The first sign.</b> On ${F.days[F.first]} at ${F.firstTime} UTC a satellite detects heat here for the first time: ${F.perDay[F.first]} hot ${F.perDay[F.first] === 1 ? "spot" : "spots"} (bright dots). Radar's last look before the fire was on ${pre ? pre.date : "an earlier pass"}, so nothing is red yet.` },
      { go: () => { Fire.show(); if (state.compare) q("#compare").click(); Fire.setDay(F.peak, true); },
        text: `<b>2 · The worst day.</b> ${F.days[F.peak]}: <b>${F.perDay[F.peak].toLocaleString("en-US")} heat detections</b> in a single day, the most of the whole fire. Bright dots are burning today, orange ones burned in the last three days, dark red earlier.` },
      { go: () => { show(fr, true); if (!state.compare) q("#compare").click(); if (q("#heat").getAttribute("aria-pressed") === "true") q("#heat").click(); }, // žár schovat, ať je vidět radar
        text: `<b>3 · ${weeks} weeks after it began.</b> ${f3.date}: ${recent ? `only ${recent} heat ${recent === 1 ? "detection remains" : "detections remain"} from the last three days` : "no heat was detected in the last three days"}. The heat dots are hidden now so you can see the radar, which shows what the fire left: vegetation signal lost on <b>${f3.lossKm2} km²</b>${f3.lossInsideKm2 != null && f3.lossKm2 > 0 ? `, ${Math.round((f3.lossInsideKm2 / f3.lossKm2) * 100)}% of it inside the official fire line` : ""}. Drag the yellow line: left is before the fire, right is ${f3.date}. Then click a red patch to ask why it is red, or turn Heat back on to compare.` },
    ];
  }
  function story(n = 0, auto = true) {
    const steps = storySteps(), card = q("#storycard");
    if (!steps) return;
    clearTimeout(st.timer);
    if (n === 0) { // příprava scény
      stop(); Sim.close(); setMode(null);
      Fire.show();
      if (state.layer !== "change") q('[data-layer="change"]').click();
      const F = Fire.facts();
      map.fitBounds(F.bbox, { padding: 70, maxZoom: 11, duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 900 });
    }
    st.n = n;
    steps[n].go();
    card.hidden = false;
    card.innerHTML = `<p>${steps[n].text}</p><div class="tools">${n > 0 ? `<button data-story="${n - 1}">‹ Back</button>` : ""}${n < steps.length - 1 ? `<button data-story="${n + 1}" class="primary">Next ›</button>` : `<button data-story="0">Play again</button>`}<button data-story="close">Close</button></div>`;
    if (auto && n < steps.length - 1) st.timer = setTimeout(() => story(n + 1, true), 8000);
  }
  function storyEnd() { clearTimeout(st.timer); q("#storycard").hidden = true; }

  // --- napojení -------------------------------------------------------------------------------------------------
  map.on("click", (e) => {
    if (mode === "area") { pts.push(e.lngLat); areaDraw(); }
    else if (mode === "ghost") ghostPlace(e.lngLat);
  });
  const cvs = map.getCanvasContainer();
  cvs.addEventListener("pointerdown", traceDown); cvs.addEventListener("pointermove", traceMove);
  addEventListener("pointerup", traceUp); addEventListener("pointercancel", traceUp);
  // totéž tažení ve 3D pohledu: polohu na zeměkouli posílá globe3d.js
  document.addEventListener("de:trace3d", (e) => { const d = e.detail; if (d.type === "down") traceDown({ lngLat: d.lngLat }); else if (d.type === "move") traceMove({ lngLat: d.lngLat }); else traceUp(); });
  q("#t-area").onclick = areaStart; q("#t-trace").onclick = traceStart; q("#t-quiz").onclick = quiz; q("#t-outside").onclick = outside; q("#t-ghost").onclick = ghostStart;
  q("#tool-out").onclick = (e) => {
    const a = e.target.closest("[data-act]")?.dataset.act; if (!a) return;
    if (a === "area-done") areaDone(); else if (a === "area-cancel" || a === "area-clear") areaCancel();
    else if (a === "trace-cancel" || a === "trace-clear") traceCancel();
    else if (a === "trace-point") { const b = tr.best.ll; drop("t-trace"); out(""); if (setPoint(b)) { setTab("explore"); show(state.i, false); } }
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
    q("#fv").hidden = d.kind !== "water"; fvCache.clear();
    if (map.getLayer("t-fv")) map.removeLayer("t-fv"); if (map.getSource("t-fv")) map.removeSource("t-fv");
    q("#t-outside").setAttribute("aria-pressed", "false");
    outsideLabel();
    storyEnd();
    q("#fire-story").hidden = !(d.kind === "fire" && d.hotspots);
    q("#simwrap").hidden = !(d.kind === "fire" && d.sim && d.hotspots);
    q("#point-hint").textContent = d.kind === "fire" ? "Click a red patch on the map to ask why it is red. You also get its own chart and sound." : d.kind === "water" ? "Click anywhere by the lake to see when that spot was water and when it was dry." : "Click anywhere on the radar image to chart and hear that exact spot.";
  });
  document.addEventListener("de:show", () => { pointInfo(); fvShow(); outsideLabel(); });
  q("#fire-story").onclick = () => story(0);
  q("#storycard").onclick = (e) => { const b = e.target.closest("[data-story]"); if (!b) return; if (b.dataset.story === "close") storyEnd(); else story(+b.dataset.story, false); };
  q("#fv").onclick = fvToggle;
  if (state.data) document.dispatchEvent(new Event("de:site"));
})();
