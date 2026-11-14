const $ = (s) => document.querySelector(s);
const state = { sites: [], site: null, data: null, i: 0, layer: "hh", timer: null, compare: false, split: 0.5, base: 0, point: null, cube: null, metric: null, perim: true };
// Hlavní číslo podle typu místa (co se ukáže v grafu jako první)
const MAIN = { water: "waterKm2", fire: "lossKm2", forest: "lossKm2", crops: "meanHV" };
const fmt = (v, unit = "") => (v == null ? "—" : (Math.abs(v) >= 100 ? Math.round(v).toLocaleString("en-US") : (+v).toFixed(1)) + (unit ? " " + unit : ""));
const say = (t) => { $("#status").textContent = t; };

function metricInfo(k) {
  const d = state.data, a = d.analysis || {};
  return {
    waterKm2: ["Open water area", "km²"],
    lossKm2: [d.kind === "fire" ? `Vegetation loss area (HV down > ${a.thresholdDb} dB)` : `Area where ${a.pol} fell > ${a.thresholdDb} dB`, "km²"],
    gainKm2: [`Area where ${a.pol} rose > ${a.thresholdDb} dB`, "km²"],
    lossInsideKm2: ["Loss area inside fire perimeter", "km²"],
    meanHH: ["Mean HH backscatter", "dB"],
    meanHV: ["Mean HV backscatter", "dB"],
    cloudPct: ["Cloud cover in the optical photo (rough estimate)", "%"],
  }[k];
}

const map = new maplibregl.Map({
  container: "map",
  style: {
    version: 8,
    sources: { base: { type: "raster", tileSize: 256, maxzoom: 8,
      tiles: ["https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg"],
      attribution: "Basemap: NASA GIBS Blue Marble" } },
    layers: [{ id: "base", type: "raster", source: "base", paint: { "raster-brightness-max": 0.55, "raster-saturation": -0.4 } }],
  },
  center: [0, 20], zoom: 1.5, attributionControl: { compact: true },
});
// Při rychlém přehrávání se starý snímek zahodí dřív, než se načte – to není chyba
map.on("error", (e) => { if (e.error?.name !== "AbortError") console.error(e.error); });
map.dragRotate.disable(); map.touchZoomRotate.disableRotation(); // sever je vždy nahoře
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

// Odkaz ke sdílení: stav aplikace je v adrese za znakem #
const readHash = () => Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
function writeHash() {
  if (!state.data) return;
  const p = new URLSearchParams({ site: state.site, date: state.data.frames[state.i].date, layer: state.layer });
  if (state.compare) p.set("compare", "1");
  if (state.point) p.set("pt", `${state.point.lng.toFixed(4)},${state.point.lat.toFixed(4)}`);
  history.replaceState(null, "", "#" + p);
}

async function init() {
  try {
    state.sites = await (await fetch("data/sites.json")).json();
  } catch { state.sites = []; }
  if (!state.sites.length) {
    $("#head").innerHTML = `<div class="empty">No processed NISAR data yet. Run <code class="mono">pipeline/fetch_nisar.py</code>.</div>`;
    return;
  }
  $("#sites").innerHTML = state.sites.map((s) => `<button data-site="${s.id}" aria-pressed="false">${s.name.split(",")[0]}</button>`).join("")
    + `<button data-site="live" aria-pressed="false" class="livebtn">● Live world</button><button id="help" aria-label="How to use this app" title="How to use this app">?</button>`;
  $("#help").onclick = () => intro(true);
  $("#sites").onclick = (e) => { const s = e.target.dataset.site; if (s === "live") goLive(); else if (s) loadSite(s); };
  Live.bind(map);
  const h = readHash(), first = state.sites.some((s) => s.id === h.site) ? h.site : state.sites[0].id;
  const go = () => ("live" in h ? goLive(h.live) : loadSite(first, h));
  // Úvod se ukáže jen při první návštěvě bez odkazu na konkrétní pohled
  let seen = false;
  try { seen = localStorage.getItem("de-intro") === "1"; } catch { /* soukromé okno */ }
  if (!seen && !location.hash) intro(true);
  map.loaded() ? go() : map.once("load", go);
}

// Krátký úvod pro nového návštěvníka
function intro(open) {
  $("#intro").hidden = !open;
  if (open) $("#intro-play").focus();
  else try { localStorage.setItem("de-intro", "1"); } catch { /* nevadí */ }
}
$("#intro-close").onclick = () => intro(false);
$("#intro-live").onclick = () => { intro(false); goLive(); };
$("#intro-play").onclick = async () => {
  intro(false);
  if (Live.on || state.site !== state.sites[0].id) await loadSite(state.sites[0].id);
  $("[data-layer=change]").click(); // barevná mapa změn, ať je záplava hned vidět
  if (!state.timer) $("#play").click();
};
addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#intro").hidden) intro(false); });

// Živý režim: mapa světa s událostmi a snímky čtenými přímo z NASA (viz live.js)
function goLive(at) {
  stop();
  state.point = null; pointMarker.remove();
  Live.enter(map, at);
}

async function loadSite(id, opts = {}) {
  stop();
  Live.exit();
  state.site = id;
  const d = state.data = await (await fetch(`data/${id}/series.json`)).json();
  document.querySelectorAll("#sites button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.site === id));
  const st = STORIES[id] || STORIES[d.kind], a = d.analysis, per = d.perimeter;
  $("#head").innerHTML = `<div class="kind">${st.label}</div><h1>${st.title}</h1>
    <p class="mono meta">${d.name} · ${d.frames.length} NISAR passes · ${d.frames[0].date} → ${d.frames.at(-1).date}</p>`;
  $("#story").innerHTML = `<h2>The story</h2>${st.body.map((p) => `<p>${p}</p>`).join("")}
    <h2>What the radar shows</h2><p>${st.why}</p>
    <h2>Who can use this</h2><ul>${st.use.map(([w, t]) => `<li><b>${w}</b> ${t}</li>`).join("")}</ul>
    <h2>Sound</h2><p>${st.instrument}. Louder notes mean a bigger change since the previous pass; left and right follow west and east.</p>
    <details><summary>Method and limits</summary>
      <p>Data: NISAR L2 GCOV (geocoded backscatter), track ${d.track[0]}, frame ${d.track[1]}, ${d.track[2].toLowerCase()} orbit, about ${a.pixelM} m per pixel after averaging, ${fmt(d.validKm2, "km²")} mapped.</p>
      <p>Change layer: ${a.pol} compared with ${a.baselineDates.length > 1 ? `the mean of ${a.baselineDates.length} passes before the event (${a.baselineDates.join(", ")})` : `the first pass (${a.baselineDates[0]})`}, smoothed over ${a.smoothingPx}×${a.smoothingPx} pixels to reduce speckle. Colour starts at ±${a.showDb} dB; area numbers count pixels beyond ±${a.thresholdDb} dB.${a.sceneShiftRemoved ? " The median change of the whole scene is subtracted first." : ""}${d.unstableKm2 != null ? ` Pixels that already varied by more than ${a.thresholdDb} dB between the passes before the event (${fmt(d.unstableKm2, "km²")}) are left out.` : ""}</p>
      ${d.kind === "water" ? `<p>Open water: smoothed ${a.waterPol} below ${a.waterDb} dB. This threshold sits just above the radar's noise level over calm water. How sensitive is the result? With a threshold 2 dB higher (${a.waterDb + 2} dB), which also counts lake edges with floating plants or wet mud, the first pass would show ${fmt(d.frames[0].waterHiKm2, "km²")} instead of ${fmt(d.frames[0].waterKm2, "km²")} and the latest ${fmt(d.frames.at(-1).waterHiKm2, "km²")} instead of ${fmt(d.frames.at(-1).waterKm2, "km²")}. Read the numbers as estimates and trust the trend more than the absolute area.</p>` : ""}
      ${d.optical ? `<p>Optical layer: ${d.optical.source}, ${d.optical.sensors.join(" / ")}, about ${d.optical.pixelM} m per pixel, taken on the same calendar day as the radar pass (not the same hour). Cloud cover is a rough estimate: the share of ${d.optical.cloudRule}. Smoke, haze and bright ground can confuse it.</p>` : ""}
      ${per ? `<p>Fire perimeter: ${per.source}, mapped ${per.mapped}; fire discovered ${per.discovered}, contained ${per.contained ?? "not yet"}; ${fmt(per.totalKm2, "km²")} in total.</p>` : ""}
      <p>${st.limits}</p>
    </details>`;
  for (const l of ["perim", "sar"]) if (map.getLayer(l)) map.removeLayer(l);
  for (const s of ["perim", "sar"]) if (map.getSource(s)) map.removeSource(s);
  imgs.clear();
  const pre = d.event ? d.frames.findLastIndex((f) => f.date < d.event) : 0;
  state.base = Math.max(0, pre);
  ctx.clearRect(0, 0, 512, 512);
  map.addSource("sar", { type: "image", url: cv.toDataURL("image/png"), coordinates: d.corners });
  map.addLayer({ id: "sar", type: "raster", source: "sar", paint: { "raster-opacity": +$("#opacity").value, "raster-fade-duration": 0 } });
  $("#perim").hidden = !per;
  if (per) {
    map.addSource("perim", { type: "geojson", data: `data/${id}/${per.file}` });
    map.addLayer({ id: "perim", type: "line", source: "perim", paint: { "line-color": "#ffffff", "line-width": 1.5, "line-dasharray": [3, 2] }, layout: { visibility: state.perim ? "visible" : "none" } });
  }
  map.resize();
  const lons = d.corners.map((c) => c[0]), lats = d.corners.map((c) => c[1]);
  map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 40, duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1200 });
  $("#frame").max = d.frames.length - 1;
  state.point = null; pointMarker.remove(); $("#point-hint").hidden = false; $("#clear-point").hidden = true; $(".pick").hidden = false;
  state.cube = null;
  if (d.cube) state.cube = new Int16Array(await (await fetch(`data/${id}/${d.cube.file}`)).arrayBuffer());
  $("#point-hint").hidden = !state.cube;

  // Nabídka grafu: jen čísla, která pro toto místo existují
  const keys = [MAIN[d.kind], "waterKm2", "lossKm2", "gainKm2", "lossInsideKm2", "meanHH", "meanHV", "cloudPct"]
    .filter((k, j, arr) => arr.indexOf(k) === j && d.frames.some((f) => f[k] != null) && (k !== "waterKm2" || d.kind === "water"));
  state.metric = keys[0];
  $("#metric").innerHTML = keys.map((k) => `<option value="${k}">${metricInfo(k)[0]}</option>`).join("");

  // Stav z odkazu (datum, vrstva, před/po, bod)
  const hasOptical = d.frames.some((f) => f.optical);
  $("[data-layer=optical]").hidden = !hasOptical;
  if (["hh", "hv", "change", "optical"].includes(opts.layer)) state.layer = opts.layer;
  if (state.layer === "optical" && !hasOptical) state.layer = "hh";
  document.querySelectorAll("[data-layer]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.layer === state.layer));
  setCompare(opts.compare === "1");
  const at = d.frames.findIndex((f) => f.date === opts.date);
  if (opts.pt && state.cube) {
    const [lng, lat] = opts.pt.split(",").map(Number);
    if (isFinite(lng) && isFinite(lat)) setPoint({ lng, lat });
  }
  $("#insight").textContent = insight(d) + cloudNote(d);
  // Bez odkazu: u události začít na posledním snímku s vrstvou změn, ať je hned vidět, co se stalo
  if (at < 0 && d.event && !opts.layer) {
    state.layer = "change";
    document.querySelectorAll("[data-layer]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.layer === "change"));
  }
  show(at >= 0 ? at : d.frames.length - 1, false);
}

// Věta „co se stalo“ – skládá se jen z čísel v datech
function insight(d) {
  const f = d.frames, a = d.analysis, first = f[0], last = f.at(-1);
  if (d.kind === "water") {
    const hi = f.reduce((m, x) => (x.waterKm2 > m.waterKm2 ? x : m)), lo = f.reduce((m, x) => (x.waterKm2 < m.waterKm2 ? x : m));
    const grew = hi.date > lo.date, times = lo.waterKm2 > 0 ? hi.waterKm2 / lo.waterKm2 : null;
    const prev = f.at(-2), trend = !prev ? "" : last.waterKm2 > prev.waterKm2 * 1.05 ? ", up from the pass before" : last.waterKm2 < prev.waterKm2 * 0.95 ? ", down from the pass before" : ", about the same as the pass before";
    return `Open water ${grew ? "grew" : "shrank"} from ${fmt(grew ? lo.waterKm2 : hi.waterKm2, "km²")} on ${grew ? lo.date : hi.date} to ${fmt(grew ? hi.waterKm2 : lo.waterKm2, "km²")} on ${grew ? hi.date : lo.date}${times && times >= 1.5 ? ` — about ${times >= 10 ? Math.round(times) : times.toFixed(1)} times ${grew ? "more" : "less"}` : ""}. On the latest pass (${last.date}) water covers ${fmt(last.waterKm2, "km²")}, ${Math.round((last.waterKm2 / d.validKm2) * 100)}% of the mapped area${trend}. The exact area depends on the radar threshold; the direction and timing of the change do not.`;
  }
  if (d.kind === "fire") {
    const per = d.perimeter;
    let s = `By ${last.date} the radar shows vegetation loss (HV down more than ${a.thresholdDb} dB) on ${fmt(last.lossKm2, "km²")}.`;
    if (per && last.lossInsideKm2 != null) {
      const share = Math.round((last.lossInsideKm2 / last.lossKm2) * 100), cov = Math.round((last.lossInsideKm2 / per.inWindowKm2) * 100);
      s += ` ${share}% of the loss lies inside the official ${per.name} Fire perimeter, where it covers ${cov}% of the ${fmt(per.inWindowKm2, "km²")} burn area.`;
      s += cov < 15
        ? " Radar sees only a small part of this fire: low vegetation such as grass returns little L-band signal even before it burns."
        : " Radar marks where woody vegetation was lost; grassy or lightly burned ground stays unchanged.";
      if (share < 60) s += " Changes outside the perimeter are more likely weather or farming than fire.";
    }
    return s;
  }
  const ok = f.filter((x) => x.lossKm2 != null), l = ok.at(-1);
  if (d.kind === "forest")
    return `Between ${a.baselineDates[0]} and ${l.date}, ${a.pol} backscatter fell by more than ${a.thresholdDb} dB on ${fmt(l.lossKm2, "km²")} (possible clearing) and rose on ${fmt(l.gainKm2, "km²")}, out of ${fmt(d.validKm2, "km²")} mapped.`;
  const busy = ok.reduce((m, x) => (x.lossKm2 + x.gainKm2 > m.lossKm2 + m.gainKm2 ? x : m));
  return `Fields here keep changing through the year. Compared with ${first.date}, ${a.pol} backscatter differed by more than ${a.thresholdDb} dB on up to ${fmt(busy.lossKm2 + busy.gainKm2, "km²")} (${busy.date}), ${Math.round(((busy.lossKm2 + busy.gainKm2) / d.validKm2) * 100)}% of the mapped area. On the latest pass (${l.date}) it is ${fmt(l.lossKm2 + l.gainKm2, "km²")}.`;
}

// Kolikrát by kamera kvůli mrakům neviděla nic – k větě „co se stalo“
function cloudNote(d) {
  const f = d.frames.filter((x) => x.cloudPct != null);
  if (!f.length) return "";
  const n = f.filter((x) => x.cloudPct >= 50).length;
  return n ? ` On ${n} of the ${f.length} radar pass days a camera satellite saw mostly cloud; radar saw the ground every time.` : ` Skies were mostly clear on all ${f.length} days, but radar would have worked under cloud too.`;
}

// Tři čísla pro vybrané datum
function kpis(i) {
  const d = state.data, f = d.frames[i], k = MAIN[d.kind] === "meanHV" ? "lossKm2" : MAIN[d.kind];
  const [label, unit] = metricInfo(k), cur = f[k];
  const prevF = d.frames.slice(0, i).reverse().find((x) => x[k] != null), delta = cur != null && prevF ? cur - prevF[k] : null;
  const out = [[label.split(" (")[0], fmt(cur, unit)],
    ["Since previous pass", delta == null ? "—" : `${delta > 0 ? "▲ +" : delta < 0 ? "▼ −" : ""}${fmt(Math.abs(delta), unit)}`]];
  if (d.kind === "water") out.push([`With a looser threshold (${d.analysis.waterDb + 2} dB)`, fmt(f.waterHiKm2, "km²")]);
  else if (d.perimeter) out.push(["Loss inside perimeter", f.lossKm2 ? `${Math.round((f.lossInsideKm2 / f.lossKm2) * 100)}%` : "—"]);
  else out.push([`Area where ${d.analysis.pol} rose`, fmt(f.gainKm2, "km²")]);
  $("#kpis").innerHTML = out.map(([l, v]) => `<div><span>${l}</span><b>${v}</b></div>`).join("");
}

const path = (i, layer) => `data/${state.site}/${state.data.frames[i][layer] || state.data.frames[i].hh}`;

// Radarový snímek se kreslí do plátna: umožní posuvník před/po a vrstvu změn přes šedý snímek
const cv = Object.assign(document.createElement("canvas"), { width: 512, height: 512 });
const ctx = cv.getContext("2d");
const imgs = new Map();
const img = (u) => imgs.get(u) || imgs.set(u, new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = u; })).get(u);
let renderId = 0;
async function render() {
  const id = ++renderId, i = state.i, L = state.layer, site = state.site;
  const stack = async (k, l = L) => (l === "change" ? [await img(path(k, "hh")), await img(path(k, "change"))] : [await img(path(k, l))]);
  // Vrstva Optical s posuvníkem: vlevo fotka z kamery, vpravo radar ze stejného dne
  const optical = L === "optical";
  const R = optical && state.compare ? "change" : L; // co se kreslí vpravo (nebo všude, když posuvník není zapnutý)
  const cur = await stack(i, R), before = state.compare ? await stack(optical ? i : state.base) : null;
  if (id !== renderId || site !== state.site) return;
  ctx.clearRect(0, 0, 512, 512);
  const x = before ? Math.round(state.split * 512) : 0;
  // Pod barevnou vrstvou změn se šedý radarový snímek ztmaví, aby barvy vynikly
  const draw = (list, layer, sx, w) => list.forEach((im, n) => {
    ctx.filter = layer === "change" && n === 0 ? "brightness(0.6)" : "none";
    ctx.drawImage(im, sx, 0, w, 512, sx, 0, w, 512);
  });
  if (before) draw(before, L, 0, x);
  draw(cur, R, x, 512 - x);
  ctx.filter = "none";
  if (before) { ctx.fillStyle = "#e9b949"; ctx.fillRect(x - 1, 0, 3, 512); }
  map.getSource("sar")?.updateImage({ url: cv.toDataURL("image/png"), coordinates: state.data.corners });
}

// Hudba z obrazu: snímek se rozdělí na 16 svislých pruhů; jas pruhu = výška tónu, velikost změny = hlasitost
function scan(t) {
  const { cube } = state, N = state.data.cube.size, B = 16, w = N / B;
  const prev = Math.max(0, t - 1), out = [];
  for (let b = 0; b < B; b++) {
    let sum = 0, dsum = 0, n = 0;
    for (let y = 0; y < N; y += 2) for (let x = b * w; x < (b + 1) * w; x += 2) {
      const c = cube[(t * N + y) * N + x], p = cube[(prev * N + y) * N + x];
      if (c === -32768 || p === -32768) continue;
      sum += c; dsum += c - p; n++;
    }
    out.push(n ? { level: sum / n / 100, delta: dsum / n / 100 } : null);
  }
  return out;
}

// Aktuální časová řada: buď číslo za celý výřez, nebo bod, na který uživatel klikl
function series() {
  const d = state.data;
  if (!state.point) {
    const [label, unit] = metricInfo(state.metric);
    return { vals: d.frames.map((f) => f[state.metric] ?? null), label: `${label}, whole area`, unit };
  }
  const pol = d.kind === "water" || d.kind === "crops" ? 0 : 1; // voda a pole: HH, vegetace: HV
  const vals = d.frames.map((_, t) => { const v = pixel(pol, t); return v == null ? null : Math.round(v * 10) / 10; });
  return { vals, label: `${pol ? "HV" : "HH"} backscatter at selected point`, unit: "dB" };
}

function pixel(pol, t) {
  const { cube, point } = state, N = state.data.cube.size, F = state.data.frames.length;
  let sum = 0, n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = point.u + dx, y = point.v + dy;
    if (x < 0 || y < 0 || x >= N || y >= N) continue;
    const v = cube[((pol * F + t) * N + y) * N + x];
    if (v !== -32768) { sum += v; n++; }
  }
  return n ? sum / n / 100 : null;
}

function show(i, sound = true) {
  const d = state.data; state.i = i;
  const f = d.frames[i];
  render();
  $("#frame").value = i;
  $("#frame").setAttribute("aria-valuetext", f.date);
  $("#date").textContent = f.date;
  const s = series(), ok = s.vals.filter((v) => v != null);
  const lo = Math.min(...ok), hi = Math.max(...ok);
  const norm = (v) => (hi > lo ? (v - lo) / (hi - lo) : 0.5);
  const cur = s.vals[i];
  $("#metrics").innerHTML = `<div>${state.point ? "At point" : "Charted value"}<b>${fmt(cur, s.unit)}</b></div><div>Mean HH<b>${fmt(f.meanHH, "dB")}</b></div><div>Mean HV<b>${f.meanHV == null ? "not acquired" : fmt(f.meanHV, "dB")}</b></div>`;
  kpis(i);
  drawChart(s, lo, hi);
  legend();
  writeHash();
  if (!state.timer) say(`${f.date}: ${s.label} ${fmt(cur, s.unit)}`);
  if (sound && $("#sound").checked) {
    const prev = s.vals.slice(0, i).reverse().find((v) => v != null) ?? cur;
    if (state.cube && !state.point) Sonify.playScan(d.kind, scan(i), 0.8);
    else if (cur != null) Sonify.play(d.kind, norm(cur), norm(cur) - norm(prev));
  }
}

function drawChart(s, lo, hi) {
  const vals = s.vals, fr = state.data.frames, W = 400, H = 140, P = 24, PL = 50;
  const t0 = Date.parse(fr[0].date), t1 = Date.parse(fr.at(-1).date);
  const x = (j) => PL + ((Date.parse(fr[j].date) - t0) / (t1 - t0 || 1)) * (W - P - PL);
  const y = (v) => H - P - (hi > lo ? (v - lo) / (hi - lo) : 0.5) * (H - 2 * P);
  const idx = vals.map((v, j) => (v == null ? -1 : j)).filter((j) => j >= 0);
  const ev = state.data.event ? PL + ((Date.parse(state.data.event) - t0) / (t1 - t0 || 1)) * (W - P - PL) : null;
  const pts = idx.map((j) => `${x(j).toFixed(1)},${y(vals[j]).toFixed(1)}`).join(" ");
  $("#chart").setAttribute("aria-label", `${s.label}: from ${fmt(vals[idx[0]], s.unit)} on ${fr[idx[0]]?.date} to ${fmt(vals[idx.at(-1)], s.unit)} on ${fr[idx.at(-1)]?.date}, lowest ${fmt(lo, s.unit)}, highest ${fmt(hi, s.unit)}.`);
  $("#chart").innerHTML = `
    <line x1="${PL}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="#232830"/>
    <polyline points="${pts}" fill="none" stroke="#e9b949" stroke-width="1.5"/>
    ${idx.map((j) => `<circle cx="${x(j)}" cy="${y(vals[j])}" r="${j === state.i ? 4 : 2}" fill="#e9b949"/>`).join("")}
    <line x1="${x(state.i)}" y1="${P / 2}" x2="${x(state.i)}" y2="${H - P}" stroke="#e8eaed" stroke-dasharray="2 3"/>
    ${ev != null ? `<line x1="${ev}" y1="${P / 2}" x2="${ev}" y2="${H - P}" stroke="#ff6a3d"/><text x="${ev + 4}" y="${P / 2 + 8}" style="fill:#ff6a3d">fire starts</text>` : ""}
    <text x="${PL}" y="${H - 6}">${fr[0].date}</text><text x="${W - P}" y="${H - 6}" text-anchor="end">${fr.at(-1).date}</text>
    <text x="${PL - 6}" y="${P + 3}" text-anchor="end">${fmt(hi)}</text><text x="${PL - 6}" y="${H - P + 3}" text-anchor="end">${fmt(lo)}</text><text x="${PL - 6}" y="${P - 9}" text-anchor="end">${s.unit}</text>`;
  $("#chart").onclick = (e) => {
    const r = $("#chart").getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
    let best = 0; fr.forEach((_, j) => Math.abs(x(j) - px) < Math.abs(x(best) - px) && (best = j));
    stop(); show(best);
  };
}

// Klik do mapy → pixel v kostce (afinní převod z rohů snímku)
function lngLatToPixel({ lng, lat }) {
  const [tl, tr, , bl] = state.data.corners, N = state.data.cube.size;
  const ax = tr[0] - tl[0], ay = tr[1] - tl[1], bx = bl[0] - tl[0], by = bl[1] - tl[1];
  const det = ax * by - ay * bx, px = lng - tl[0], py = lat - tl[1];
  const u = (px * by - py * bx) / det, v = (ax * py - ay * px) / det;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { u: Math.min(N - 1, Math.floor(u * N)), v: Math.min(N - 1, Math.floor(v * N)) };
}
function setPoint(ll) {
  const p = lngLatToPixel(ll);
  if (!p) return false;
  state.point = { ...p, lng: ll.lng, lat: ll.lat };
  pointMarker.setLngLat(ll).addTo(map);
  $("#point-hint").hidden = true; $("#clear-point").hidden = false; $(".pick").hidden = true;
  return true;
}
map.on("click", (e) => { if (!Live.on && state.cube && setPoint(e.lngLat)) show(state.i); });
const pointMarker = new maplibregl.Marker({ element: Object.assign(document.createElement("div"), { className: "pt" }) });
$("#clear-point").onclick = () => { state.point = null; pointMarker.remove(); $("#point-hint").hidden = false; $("#clear-point").hidden = true; $(".pick").hidden = false; show(state.i, false); };

function legend() {
  const d = state.data, a = d.analysis, f = d.frames[state.i];
  const base = a.baselineDates.length > 1 ? "before the fire" : a.baselineDates[0];
  const L = {
    hh: ["HH backscatter", "linear-gradient(90deg,#000,#fff)", "−25 dB · smooth / water", "0 dB · rough / urban"],
    hv: ["HV backscatter (vegetation volume)", "linear-gradient(90deg,#000,#fff)", "−32 dB · bare", "−8 dB · dense canopy"],
    change: [`${a.pol} change compared with ${base}`, `linear-gradient(90deg,${a.colors.loss},transparent,${a.colors.gain})`,
      `−${a.scaleDb} dB · ${d.kind === "fire" ? "vegetation lost" : d.kind === "water" ? "new open water" : "darker"}`, `+${a.scaleDb} dB · ${d.kind === "water" ? "water gone / brighter" : "brighter"}`],
    optical: [`Optical photo, same day${f.cloudPct != null ? ` · about ${f.cloudPct}% cloud` : ""}`, "linear-gradient(90deg,#1d3b2a,#8a7a5a,#fff)", "what a camera sees", "white = cloud"],
  }[state.layer];
  const missing = state.layer !== "hh" && !f[state.layer] ? `<div class="warn">${{ hv: "This pass recorded HH only, so the HH image is shown.", optical: "No optical photo for this day, so the radar image is shown." }[state.layer] || "No change map for this pass."}</div>` : "";
  $("#legend").innerHTML = `${L[0]}<div class="bar" style="background:${L[1]}"></div><div class="ends"><span>${L[2]}</span><span>${L[3]}</span></div>${d.perimeter && state.perim ? `<div class="ends"><span>- - -  official fire perimeter (NIFC)</span></div>` : ""}${missing}`;
}

// Export časové řady do CSV (pro tabulkový procesor nebo další analýzu)
function csv() {
  const d = state.data, pt = state.point ? series() : null;
  const cols = [["date", (f) => f.date], ["granule", (f) => f.granule], ["mode", (f) => f.mode], ["mean_hh_db", (f) => f.meanHH], ["mean_hv_db", (f) => f.meanHV],
    ["open_water_km2", (f) => f.waterKm2], ["open_water_looser_threshold_km2", (f) => f.waterHiKm2], ["loss_km2", (f) => f.lossKm2], ["gain_km2", (f) => f.gainKm2], ["optical_cloud_percent_estimate", (f) => f.cloudPct]];
  if (d.perimeter) cols.push(["loss_inside_perimeter_km2", (f) => f.lossInsideKm2], ["mean_change_inside_db", (f) => f.meanInsideDb], ["mean_change_outside_db", (f) => f.meanOutsideDb]);
  if (d.analysis.sceneShiftRemoved) cols.push(["scene_shift_removed_db", (f) => f.sceneShiftDb]);
  if (pt) cols.push([`point_${pt.label.slice(0, 2).toLowerCase()}_db_at_${state.point.lng.toFixed(4)}_${state.point.lat.toFixed(4)}`, (f, j) => pt.vals[j]]);
  const rows = [cols.map((c) => c[0]).join(","), ...d.frames.map((f, j) => cols.map((c) => c[1](f, j) ?? "").join(","))];
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([rows.join("\n") + "\n"], { type: "text/csv" })), download: `${state.site}_nisar_timeseries.csv` });
  document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  say(`Downloaded ${d.frames.length} rows as ${a.download}`);
  return rows;
}
$("#csv").onclick = csv;
$("#share").onclick = async () => {
  writeHash();
  try { await navigator.clipboard.writeText(location.href); say("Link copied. It opens this place, date and layer."); }
  catch { say("Copy the address from the browser bar — it already contains this view."); }
};

function stop() { clearInterval(state.timer); state.timer = null; $("#play").textContent = "Play"; }
$("#play").onclick = () => {
  if (state.timer) return stop();
  Sonify.resume();
  $("#play").textContent = "Pause";
  if (state.i === state.data.frames.length - 1) show(0);
  state.timer = setInterval(() => show((state.i + 1) % state.data.frames.length), 900);
};
const compareNote = () => state.data && (state.layer === "optical"
  ? "Left: camera (optical) · Right: radar change map, same day"
  : `Left: ${state.data.frames[state.base].date} · Right: selected date`);
function setCompare(on) {
  state.compare = on;
  $("#compare").setAttribute("aria-pressed", on);
  $("#cmp").hidden = !on;
  if (state.data) $("#compare-note").textContent = compareNote();
}
$("#compare").onclick = () => { setCompare(!state.compare); render(); writeHash(); };
$("#perim").onclick = () => {
  state.perim = !state.perim;
  $("#perim").setAttribute("aria-pressed", state.perim);
  if (map.getLayer("perim")) map.setLayoutProperty("perim", "visibility", state.perim ? "visible" : "none");
  legend();
};
$("#split").oninput = (e) => { state.split = +e.target.value; render(); };
$("#frame").oninput = (e) => { stop(); show(+e.target.value); };
$("#metric").onchange = (e) => { state.metric = e.target.value; show(state.i, false); };
$("#opacity").oninput = (e) => map.getLayer("sar") && map.setPaintProperty("sar", "raster-opacity", +e.target.value);
document.querySelector(".layers").onclick = (e) => {
  const l = e.target.dataset.layer; if (!l) return;
  state.layer = l;
  document.querySelectorAll("[data-layer]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.layer === l));
  setCompare(l === "optical" ? true : state.compare);
  show(state.i, false);
};
document.addEventListener("keydown", (e) => {
  if (!state.data || Live.on || e.target.closest("input, button, select, a, summary, .maplibregl-map")) return;
  if (e.key === "ArrowRight") { stop(); show(Math.min(state.i + 1, state.data.frames.length - 1)); }
  if (e.key === "ArrowLeft") { stop(); show(Math.max(state.i - 1, 0)); }
  if (e.key === " ") { e.preventDefault(); $("#play").click(); }
});
// Mapa musí znát skutečnou velikost svého okna (mobil, otočení, změna rozložení)
new ResizeObserver(() => map.resize()).observe($("#map"));
// Vložený nebo ručně změněný odkaz přepne pohled bez znovunačtení stránky
addEventListener("hashchange", () => {
  const h = readHash(), d = state.data;
  if ("live" in h) { if (!Live.on) goLive(h.live); return; }
  if (!state.sites.some((s) => s.id === h.site)) return;
  if (!d || Live.on) { loadSite(h.site, h); return; } // z živého režimu na konkrétní místo
  const same = h.site === state.site && h.date === d.frames[state.i].date && (h.layer || state.layer) === state.layer && (h.compare === "1") === state.compare;
  if (!same) loadSite(h.site, h);
});
init();
