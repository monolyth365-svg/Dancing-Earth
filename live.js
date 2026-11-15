// Živý režim: aktuální události z NASA EONET na mapě světa a nejnovější radarový snímek NISAR
// pro kterékoli místo. Vše se čte přímo z NASA v prohlížeči návštěvníka, nic není předpočítané.
window.Live = (() => {
  const EONET = "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&limit=300";
  const ASF = "https://api.daac.asf.alaska.edu/services/search/param";
  const CATS = {
    wildfires: ["Wildfires", "#ff4632"], floods: ["Floods", "#3c8cff"], volcanoes: ["Volcanoes", "#ff9628"],
    severeStorms: ["Severe storms", "#b07cff"], seaLakeIce: ["Sea and lake ice", "#7fd6e8"], landslides: ["Landslides", "#c9a26b"],
    earthquakes: ["Earthquakes", "#e9b949"], drought: ["Drought", "#d6b45a"], dustHaze: ["Dust and haze", "#b8a58a"],
  };
  const cat = (id) => CATS[id] || ["Other", "#9aa2ad"];
  const el = (s) => document.querySelector(s);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let map, events = null, passes = [], reqId = 0, on = false, cur = 0, fitted = false, lapse = null;
  let shown = null, hiUrl = null, sharpTimer = null; // který přelet je právě na mapě (kvůli doostření po přiblížení)
  const cache = new Map(); // stažené náhledy (jeden má kolem 4 MB), ať se při přepínání nestahují znovu
  const marker = new maplibregl.Marker({ element: Object.assign(document.createElement("div"), { className: "pt" }) });

  async function enter(m, at) {
    map = m; on = true;
    document.body.classList.add("live");
    for (const l of ["perim", "sar"]) if (map.getLayer(l)) map.removeLayer(l);
    for (const s of ["perim", "sar"]) if (map.getSource(s)) map.removeSource(s);
    history.replaceState(null, "", "#live" + (at ? "=" + at : "") + v3());
    if (!at) { map.resize(); map.fitBounds([[-150, -50], [160, 68]], { padding: 4, duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1200 }); }
    el("#live-detail").innerHTML = "";
    Sats.show(map, !!window.Globe3D?.on); // ve 3D pohledu jen seznam družic; kreslí je zeměkoule
    await loadEvents();
    if (at) { const [lng, lat] = at.split(",").map(Number); if (isFinite(lng) && isFinite(lat)) pick({ lng, lat }, "Shared location"); }
  }

  function exit() {
    if (!on) return;
    on = false; reqId++; shown = null;
    Sats.hide();
    document.body.classList.remove("live");
    marker.remove();
    for (const l of ["live-img", "events"]) if (map.getLayer(l)) map.removeLayer(l);
    for (const s of ["live-img", "events"]) if (map.getSource(s)) map.removeSource(s);
    document.dispatchEvent(new Event("de:live"));
  }

  async function loadEvents() {
    el("#live-status").textContent = "Loading current events from NASA EONET…";
    const got = Loader.show("Reading today's events from NASA…");
    try {
      if (!events) {
        const raw = (await (await fetch(EONET)).json()).events;
        events = raw.map((e) => {
          const g = e.geometry.at(-1), c = g.type === "Point" ? g.coordinates : g.coordinates.flat(3).slice(0, 2);
          return { id: e.id, title: e.title, cat: e.categories[0]?.id, date: (g.date || "").slice(0, 10), lng: c[0], lat: c[1], link: e.sources?.[0]?.url };
        }).filter((e) => isFinite(e.lng) && isFinite(e.lat)).sort((a, b) => b.date.localeCompare(a.date));
      }
    } catch { events = null; el("#live-status").textContent = "NASA EONET did not answer. You can still click anywhere on the map."; }
    got();
    if (!on) return;
    const list = events || [];
    if (!map.getSource("events")) {
      map.addSource("events", { type: "geojson", data: { type: "FeatureCollection", features: list.map((e, i) => ({ type: "Feature", id: i, properties: { i, color: cat(e.cat)[1] }, geometry: { type: "Point", coordinates: [e.lng, e.lat] } })) } });
      map.addLayer({ id: "events", type: "circle", source: "events", paint: { "circle-radius": 6, "circle-color": ["get", "color"], "circle-stroke-color": "#0b0d10", "circle-stroke-width": 1.5, "circle-opacity": 0.9 } });
    }
    document.dispatchEvent(new Event("de:live")); // 3D pohled si události vykreslí jako body na zeměkouli
    if (!events) return;
    const counts = {};
    list.forEach((e) => { counts[e.cat] = (counts[e.cat] || 0) + 1; });
    el("#live-status").textContent = `${list.length} open events reported in the last 30 days · read from NASA just now`;
    el("#live-cats").innerHTML = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<span><i style="background:${cat(k)[1]}"></i>${cat(k)[0]} <b>${n}</b></span>`).join("");
    el("#live-list").innerHTML = list.slice(0, 40).map((e, i) => `<li><button data-ev="${i}"><i style="background:${cat(e.cat)[1]}"></i><span>${esc(e.title)}</span><time>${e.date}</time></button></li>`).join("");
  }

  // Vybrané místo: zeptat se archivu ASF, které přelety NISAR nad ním existují
  async function pick(ll, title, ev) {
    const id = ++reqId;
    nowReq++; fitted = false; lapse = null; shown = null;
    marker.setLngLat(ll).addTo(map);
    history.replaceState(null, "", `#live=${ll.lng.toFixed(3)},${ll.lat.toFixed(3)}` + v3());
    const head = `<h2>${esc(title)}</h2><p class="mono meta">${ll.lat.toFixed(3)}°, ${ll.lng.toFixed(3)}°${ev ? ` · ${cat(ev.cat)[0]} · reported ${ev.date}` : ""}${ev?.link ? ` · <a href="${esc(ev.link)}" target="_blank" rel="noopener">source</a>` : ""}</p>`;
    el("#live-detail").innerHTML = head + `<p class="status" role="status">Asking NASA's archive (ASF) for NISAR passes over this spot…</p>`;
    el("#live-detail").scrollIntoView({ block: "nearest" });
    const found = await search(ll);
    if (id !== reqId) return;
    if (!found) { el("#live-detail").innerHTML = head + `<p class="status">The archive did not answer. Try again in a moment.</p>`; return; }
    passes = found.passes;
    if (!passes.length) {
      el("#live-detail").innerHTML = head + `<p class="status">No NISAR image of this spot in the archive yet. NISAR mostly maps land and ice; open ocean is rarely imaged.</p><p class="now" id="live-now" hidden></p>`;
      overNow(ll);
      return;
    }
    el("#live-detail").innerHTML = head + `
      <p>${found.count} NISAR radar products cover this spot. Newest: <b>${passes[0].startTime.slice(0, 10)}</b>. Next pass expected around <b>${found.next}</b> (estimate from the 12-day repeat).</p>
      <p class="now" id="live-now" hidden></p>
      <div class="passes" role="group" aria-label="Radar passes, newest first">${passes.map((p, i) => `<button data-pass="${i}" aria-pressed="false">${p.startTime.slice(0, 10)}</button>`).join("")}</div>
      <p class="status" id="live-img-status" role="status"></p>
      <label class="pick">Compare this image with <select id="live-ref" aria-label="Pass to compare with"></select></label>
      <p class="status" id="live-pair"></p>
      <div class="tools"><button id="live-diff" class="primary">♪ Show what changed and play it</button><button id="live-lapse">▶ Play all passes of this track</button></div>
      <p class="status" id="live-diff-status" role="status"></p>
      <p class="hint">Click the dates to flip between passes and spot what changed. Zoom in and the image is reloaded at the full detail of NASA's quick-look. Colours are NASA's quick-look composite of the HH and HV channels: brighter means a stronger radar echo; water and smooth ground are dark.</p>`;
    overNow(ll);
    showPass(0);
  }

  // Letí NISAR nad vybraným místem právě teď? Žlutý pruh ukazuje, kam radar míří; dnešní snímek ale v archivu ještě
  // být nemůže (NASA nové snímky zveřejňuje se zpožděním). Aby to uživatele nemátlo, řekneme to na rovinu a doložíme
  // tím, jak starý je nejnovější snímek v celém archivu (zjistí se jedním dotazem a pamatuje se po dobu návštěvy).
  let freshest = null, nowReq = 0;
  const newestInArchive = () => (freshest ??= (async () => {
    for (const days of [5, 30]) {
      const q = new URLSearchParams({ platform: "NISAR", processingLevel: "GCOV", output: "jsonlite", maxResults: "250", start: new Date(Date.now() - days * 864e5).toISOString().slice(0, 19) + "Z" });
      const res = (await (await fetch(`${ASF}?${q}`)).json()).results || [];
      if (res.length) return res.reduce((m, r) => (r.startTime > m ? r.startTime : m), "");
    }
    return null;
  })().catch(() => { freshest = null; return null; }));
  // Kdy pruh radaru přejel (nebo přejede) dané místo: vzdálenost místa od příčného řezu pruhem, po 5 vteřinách
  function stripPass(ll) {
    const n = Sats.all().find((x) => x.id === "nisar"); if (!n) return null;
    const kx = 111.32 * Math.cos((ll.lat * Math.PI) / 180), xy = (c) => [(((c[0] - ll.lng + 540) % 360) - 180) * kx, (c[1] - ll.lat) * 110.57], t0 = Date.now();
    let best = null;
    for (let dt = -900; dt <= 300; dt += 5) {
      const p = Sats.at(n, new Date(t0 + dt * 1000)); if (!p?.edges) continue;
      const [ax, ay] = xy(p.edges[0]), [bx, by] = xy(p.edges[1]), L = (bx - ax) ** 2 + (by - ay) ** 2;
      const u = L ? Math.max(0, Math.min(1, (-ax * (bx - ax) - ay * (by - ay)) / L)) : 0, d = Math.hypot(ax + u * (bx - ax), ay + u * (by - ay)); // km od místa k řezu
      if (!best || d < best.d) best = { d, dt };
    }
    return best && best.d < 20 ? best : null; // řezy jsou od sebe asi 37 km, takže místo uvnitř pruhu je vždy blíž než 20 km
  }
  async function overNow(ll) {
    const mine = ++nowReq, hit = stripPass(ll); if (!hit) return; // „mine“: poznámka patří jen k naposledy vybranému místu
    const at = new Date(Date.now() + hit.dt * 1000), hm = at.toISOString().slice(11, 16), min = Math.round(Math.abs(hit.dt) / 60);
    const when = Math.abs(hit.dt) < 45 ? `is crossing this spot right now (${hm} UTC)` : hit.dt < 0 ? `crossed this spot ${min} minute${min === 1 ? "" : "s"} ago (${hm} UTC)` : `will cross this spot in about ${min} minute${min === 1 ? "" : "s"} (${hm} UTC)`;
    const say = (tail) => { const box = el("#live-now"); if (mine === nowReq && box) { box.innerHTML = `<b>NISAR's radar strip ${when}.</b> ${tail} The strip shows where the radar points; this app cannot tell whether it is recording.`; box.hidden = false; } };
    say("That pass cannot be shown yet: NASA publishes new images with a delay.");
    const newest = await newestInArchive();
    if (newest) {
      const days = (Date.now() - Date.parse(newest)) / 864e5;
      say(`That pass cannot be shown yet: the newest image anywhere in NASA's archive right now is from ${newest.slice(0, 10)}, ${days < 1.5 ? "about a day" : `about ${Math.round(days)} days`} ago.`);
    }
  }

  // Dotaz do archivu ASF: které přelety NISAR pokrývají dané místo (používá ho plochá mapa i 3D zeměkoule).
  // Vrací null, když archiv neodpoví.
  async function search(ll) {
    const asked = Loader.show("Asking NASA's archive for radar passes…");
    try {
      const q = new URLSearchParams({ platform: "NISAR", processingLevel: "GCOV", output: "jsonlite", maxResults: "60", intersectsWith: `POINT(${ll.lng.toFixed(4)} ${ll.lat.toFixed(4)})` });
      const res = (await (await fetch(`${ASF}?${q}`)).json()).results || [], seen = new Set();
      const list = res.filter((r) => r.browse?.length).sort((a, b) => b.startTime.localeCompare(a.startTime))
        .filter((r) => !seen.has(r.startTime.slice(0, 13)) && seen.add(r.startTime.slice(0, 13))).slice(0, 14);
      // Odhad dalšího přeletu: stejná dráha se opakuje po 12 dnech
      const latest = {};
      list.forEach((p) => { const k = `${p.path}-${p.flightDirection}`; latest[k] ??= p.startTime; });
      const now = Date.now(), next = Math.min(...Object.values(latest).map((t) => { let d = Date.parse(t); while (d < now) d += 12 * 864e5; return d; }));
      return { passes: list, count: res.length >= 60 ? "60 or more" : String(res.length), next: list.length ? new Date(next).toISOString().slice(0, 10) : null };
    } catch { return null; } finally { asked(); }
  }

  // Náhledový snímek a jeho zeměpisné rohy čteme přímo z NASA. onProgress dostává podíl stažených dat (0 až 1).
  function loadPass(p, onProgress) {
    let entry = cache.get(p.granuleName);
    if (entry) { if (onProgress) { entry.fns.add(onProgress); if (entry.frac) onProgress(entry.frac); } return entry.job; }
    entry = { fns: new Set(onProgress ? [onProgress] : []), frac: 0 };
    const tell = (f) => { entry.frac = f; entry.fns.forEach((fn) => fn(f)); };
    const png = p.browse.find((u) => u.endsWith("_LATLON.png")), kml = (p.nisar?.additionalUrls || []).find((u) => u.endsWith("_LATLON.kml") && u.includes("/BROWSE/"));
    const job = entry.job = !png ? Promise.reject(new Error("no browse")) : Promise.all([
      kml ? fetch(kml).then((r) => (r.ok ? r.text() : "")).catch(() => "") : "",
      Loader.fetchBlob(png, (f) => tell(f * 0.95), "image/png").then(async (b) => { const blob = new Blob([b], { type: "image/png" }); return { blob, bmp: await createImageBitmap(blob) }; }),
    ]).then(([txt, { blob, bmp }]) => {
      tell(1);
      const m = txt.match(/<coordinates>([^<]+)</);
      let w, e, s2, n, approx = false;
      if (m) {
        const c = m[1].trim().split(/\s+/).map((x) => x.split(",").map(Number)); // LL, LR, UR, UL
        const lons = c.map((x) => x[0]), lats = c.map((x) => x[1]);
        [w, e, s2, n] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
      } else {
        // Některé (předběžné) produkty mají soubor s rohy jen po přihlášení. Pak polohu odhadneme:
        // obrys snímku z katalogu se přiloží na neprázdnou část obrázku.
        const pts = (p.wkt.match(/-?\d+(\.\d+)?\s+-?\d+(\.\d+)?/g) || []).map((t) => t.trim().split(/\s+/).map(Number));
        if (pts.length < 3) throw new Error("no footprint");
        const k = Math.min(1, 500 / Math.max(bmp.width, bmp.height)), cv = canvas(Math.round(bmp.width * k), Math.round(bmp.height * k)), cx = cv.getContext("2d");
        cx.drawImage(bmp, 0, 0, cv.width, cv.height);
        const d = cx.getImageData(0, 0, cv.width, cv.height).data;
        let x0 = cv.width, x1 = -1, y0 = cv.height, y1 = -1;
        for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
          const q = (y * cv.width + x) * 4;
          if (d[q] + d[q + 1] + d[q + 2] >= 30) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
        if (x1 <= x0 || y1 <= y0) throw new Error("empty image");
        const lons = pts.map((t) => t[0]), lats = pts.map((t) => t[1]);
        const dx = (Math.max(...lons) - Math.min(...lons)) / (x1 + 1 - x0), dy = (Math.max(...lats) - Math.min(...lats)) / (y1 + 1 - y0);
        w = Math.min(...lons) - x0 * dx; e = w + cv.width * dx; n = Math.max(...lats) + y0 * dy; s2 = n - cv.height * dy; approx = true;
      }
      // uchovat jen zmenšený snímek (max. 1000 px): časosběr drží v paměti víc přeletů najednou
      const k = Math.min(1, 1000 / Math.max(bmp.width, bmp.height)), small = canvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
      small.getContext("2d").drawImage(bmp, 0, 0, small.width, small.height); bmp.close?.();
      return { bmp: small, blob, full: [Math.round(small.width / k), Math.round(small.height / k)], coords: [[w, n], [e, n], [e, s2], [w, s2]], w, e, s: s2, n, approx };
    });
    job.catch(() => cache.delete(p.granuleName));
    cache.set(p.granuleName, entry);
    if (cache.size > (matchMedia("(pointer: coarse)").matches ? 6 : 16)) cache.delete(cache.keys().next().value);
    return job;
  }
  // Snímek připravený k položení na mapu: zmenšený a s průhledným černým okolím, ať je vidět podklad
  function clean(A, max = 1200) {
    const k = Math.min(1, max / Math.max(A.bmp.width, A.bmp.height)), cv = canvas(Math.round(A.bmp.width * k), Math.round(A.bmp.height * k)), cx = cv.getContext("2d");
    cx.drawImage(A.bmp, 0, 0, cv.width, cv.height);
    const im = cx.getImageData(0, 0, cv.width, cv.height), a = im.data;
    for (let j = 0; j < a.length; j += 4) if (a[j] + a[j + 1] + a[j + 2] < 10) a[j + 3] = 0;
    cx.putImageData(im, 0, 0);
    return cv;
  }
  function put(cv, coords) {
    const url = cv.toDataURL("image/png");
    if (map.getSource("live-img")) map.getSource("live-img").updateImage({ url, coordinates: coords });
    else {
      map.addSource("live-img", { type: "image", url, coordinates: coords });
      map.addLayer({ id: "live-img", type: "raster", source: "live-img", paint: { "raster-opacity": 0.92, "raster-fade-duration": 0 } }, map.getLayer("sat-swath") ? "sat-swath" : map.getLayer("events") ? "events" : undefined);
    }
  }
  const canvas = (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h });

  // Černé okolí snímku zprůhledníme, ať je vidět mapa
  async function showPass(i) {
    const id = ++reqId, p = passes[i];
    cur = i; shown = null;
    document.querySelectorAll("[data-pass]").forEach((b) => b.setAttribute("aria-pressed", +b.dataset.pass === i));
    const st = el("#live-img-status");
    el("#live-diff-status").textContent = "";
    st.textContent = `Loading radar image of ${p.startTime.slice(0, 10)} from NASA…`;
    try {
      const A = await Loader.during(`Loading the radar image of ${p.startTime.slice(0, 10)} from NASA…`, (progress) => loadPass(p, progress));
      if (id !== reqId) return;
      put(clean(A), A.coords);
      shown = { A, hi: false }; sharpenSoon();
      refs();
      if (!fitted || !map.getBounds().contains(marker.getLngLat())) fitted = true, map.fitBounds([[A.w, A.s], [A.e, A.n]], { padding: 40, duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1000 });
      st.textContent = `NISAR radar image, ${p.startTime.slice(0, 16).replace("T", " ")} UTC · track ${p.path}, frame ${p.frame}, ${p.flightDirection.toLowerCase()} · quick-look image from NASA ASF DAAC${A.approx ? " · placed on the map approximately (provisional product)" : ""}`;
    } catch (e) {
      if (id === reqId) st.textContent = "This radar image could not be loaded. Try another date.";
    }
  }

  // Co se změnilo mezi dvěma přelety stejné dráhy: rozdíl jasu obou náhledů, spočítaný v prohlížeči, a přehraný jako hudba
  async function diff() {
    let swapped = "";
    if (el("#live-ref").value === "") { // zobrazený přelet nemá na své dráze dvojici → porovnat nejnovější dvojici, která ji má
      const pr = bestPair();
      if (!pr) { el("#live-diff-status").textContent = "Every pass over this spot is on a different track, so no two of them can be compared fairly."; return; }
      swapped = `${passes[cur].startTime.slice(0, 10)} is the only pass on its track here, so the newest pair that shares a track is compared instead. `;
      await showPass(pr[0]);
      if (cur !== pr[0] || el("#live-ref").value === "") return; // snímek se nepodařilo načíst
    }
    const a = passes[cur], st = el("#live-diff-status");
    const j = +el("#live-ref").value;
    if (!(j >= 0) || !passes[j] || j === cur) { st.textContent = "There is no other pass on the same track in this list to compare with. Try another date."; return; }
    const id = ++reqId, b = passes[j];
    Sonify.resume();
    st.textContent = `Comparing ${a.startTime.slice(0, 10)} with ${b.startTime.slice(0, 10)}…`;
    try {
      const [A, B] = await Loader.during("Comparing two radar images…", (progress) => { // postup = průměr obou stahování
        let fa = 0, fb = 0;
        return Promise.all([loadPass(a, (f) => progress(((fa = f) + fb) / 2)), loadPass(b, (f) => progress((fa + (fb = f)) / 2))]);
      });
      if (id !== reqId) return;
      const N = 600, grab = (I) => {
        const cv = canvas(N, N), cx = cv.getContext("2d");
        cx.imageSmoothingQuality = "high";
        // starší snímek se posadí do mřížky novějšího podle zeměpisných rohů
        cx.drawImage(I.bmp, ((I.w - A.w) / (A.e - A.w)) * N, ((A.n - I.n) / (A.n - A.s)) * N, ((I.e - I.w) / (A.e - A.w)) * N, ((I.n - I.s) / (A.n - A.s)) * N);
        const d = cx.getImageData(0, 0, N, N).data, lum = new Float32Array(N * N), ok = new Uint8Array(N * N);
        for (let q = 0; q < N * N; q++) { const v = d[q * 4] + d[q * 4 + 1] + d[q * 4 + 2]; lum[q] = v / 3; ok[q] = v >= 10 ? 1 : 0; }
        return { lum: blur(lum, ok, N), ok };
      };
      const X = grab(A), Y = grab(B), d = new Float32Array(N * N);
      let sum = 0, n = 0;
      for (let q = 0; q < N * N; q++) if (X.ok[q] && Y.ok[q]) { d[q] = X.lum[q] - Y.lum[q]; sum += d[q]; n++; }
      if (n < N * N * 0.05) { st.textContent = "These two images barely overlap, so there is nothing to compare."; return; }
      const bias = sum / n, T = 30; // posun celé scény (např. po dešti) se odečte; práh 30 z 255
      const out = canvas(N, N), ox = out.getContext("2d"), im = ox.createImageData(N, N), o = im.data;
      const cols = Array.from({ length: 16 }, () => ({ lum: 0, n: 0, up: 0, down: 0 }));
      let changed = 0;
      for (let q = 0; q < N * N; q++) {
        if (!X.ok[q]) continue;
        const g = X.lum[q] * 0.6, both = Y.ok[q], v = both ? d[q] - bias : 0, c = cols[Math.min(15, Math.floor(((q % N) / N) * 16))];
        let r = g, gg = g, bl = g;
        if (Math.abs(v) > T) {
          const k = Math.min(1, (Math.abs(v) - T) / 50) * 0.8 + 0.2, [cr, cg, cb] = v < 0 ? [60, 140, 255] : [255, 150, 40];
          r = g * (1 - k) + cr * k; gg = g * (1 - k) + cg * k; bl = g * (1 - k) + cb * k;
          changed++; v < 0 ? c.down++ : c.up++;
        }
        if (both) { c.lum += X.lum[q]; c.n++; }
        o[q * 4] = r; o[q * 4 + 1] = gg; o[q * 4 + 2] = bl; o[q * 4 + 3] = 255;
      }
      ox.putImageData(im, 0, 0);
      shown = null; // mapa změn se nedoostřuje (počítá se ve zmenšené mřížce)
      put(out, A.coords);
      const share = (changed / n) * 100;
      st.textContent = `${swapped}Compared ${a.startTime.slice(0, 10)} with ${b.startTime.slice(0, 10)}, same track. About ${share < 1 ? share.toFixed(1) : Math.round(share)}% of the image changed noticeably. Blue: darker now, for example new water or lost vegetation. Orange: brighter now. You are hearing it west to east: louder notes mean more change. This is a rough comparison of NASA's quick-look images, not a calibrated measurement.`;
      // stejné pravidlo jako u připravených míst: jas = výška tónu, změna = hlasitost
      Sonify.playScan("water", cols.map((c) => (c.n ? { level: (c.lum / c.n / 255) * 25 - 25, delta: (c.down > c.up ? -1 : 1) * ((c.up + c.down) / c.n) * 30 } : null)), 2.6);
    } catch (e) {
      if (id === reqId) st.textContent = "The comparison could not be made. Try another date.";
    }
  }
  // Přelety stejné dráhy jako právě zobrazený (jen ty jdou poctivě porovnat – stejný úhel pohledu)
  const sameTrack = (a) => passes.map((p, k) => k).filter((k) => passes[k].path === a.path && passes[k].frame === a.frame && passes[k].flightDirection === a.flightDirection);
  // Nejnovější dvojice přeletů stejné dráhy [novější, starší]; null, když v seznamu žádná není
  const bestPair = () => { for (let i = 0; i < passes.length; i++) { const k = sameTrack(passes[i]).find((q) => q > i); if (k != null) return [i, k]; } return null; };
  function refs() {
    const ks = sameTrack(passes[cur]).filter((k) => k !== cur), sel = el("#live-ref"), keep = sel.value;
    const pr = ks.length ? null : bestPair(), day = (k) => passes[k].startTime.slice(0, 10);
    el("#live-pair").textContent = ks.length ? "" : pr ? `This image (${day(cur)}) is the only pass on its track over this spot, so nothing can be compared with it fairly. The button below compares the newest pair that does share a track: ${day(pr[0])} with ${day(pr[1])}.` : "Every pass over this spot is on a different track, so no two of them can be compared fairly.";
    sel.innerHTML = ks.map((k) => `<option value="${k}">${passes[k].startTime.slice(0, 10)}${k > cur ? " (earlier)" : " (later)"}</option>`).join("");
    sel.value = ks.includes(+keep) ? keep : ks.find((k) => k > cur) ?? ks[0] ?? "";
    el("#live-lapse").disabled = ks.length < 1;
  }
  // Časosběr: všechny přelety stejné dráhy od nejstaršího po nejnovější, mapa zůstává na místě
  async function timelapse() {
    const b = el("#live-lapse");
    if (lapse) { lapse = null; b.textContent = "▶ Play all passes of this track"; return; }
    const ks = sameTrack(passes[cur]).reverse(), token = (lapse = {});
    b.textContent = "■ Stop";
    for (const k of ks) { if (lapse !== token) return; await showPass(k); await new Promise((r) => setTimeout(r, 1100)); }
    if (lapse === token) { lapse = null; b.textContent = "▶ Play all passes of this track"; sharpenSoon(); }
  }

  // Ostřejší snímek po přiblížení. Běžně se ukazuje zmenšená verze (rychlá, šetří paměť). Jakmile je snímek na obrazovce
  // větší než tato verze, nahradí se plným náhledem NASA (asi 2000 × 2000 bodů, tedy zhruba dvakrát jemnější).
  // Víc detailu veřejný náhled neobsahuje; plná radarová data (GCOV) jsou soubory po 1,8 GB a vyžadují přihlášení.
  const sharpenSoon = () => { clearTimeout(sharpTimer); sharpTimer = setTimeout(sharpen, 250); };
  async function sharpen() {
    const s = shown;
    if (!on || lapse || !s || s.hi || s.busy || !map.getSource("live-img")) return;
    const A = s.A, a = map.project([A.w, A.n]), b = map.project([A.e, A.n]), c = map.project([A.w, A.s]);
    const onScreen = Math.max(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - a.x, c.y - a.y)) * (window.devicePixelRatio || 1);
    if (onScreen < Math.max(A.bmp.width, A.bmp.height) * 1.15 || Math.max(...A.full) <= Math.max(A.bmp.width, A.bmp.height)) return; // zmenšená verze zatím stačí
    s.busy = true;
    try {
      const full = await createImageBitmap(A.blob), cv = clean({ bmp: full }, 2048);
      full.close?.();
      const png = await new Promise((r) => cv.toBlob(r, "image/png"));
      if (shown !== s || !on || !png || !map.getSource("live-img")) return; // mezitím jiný přelet, mapa změn nebo jiné místo
      const url = URL.createObjectURL(png), old = hiUrl;
      map.getSource("live-img").updateImage({ url, coordinates: A.coords });
      hiUrl = url; s.hi = true;
      if (old) setTimeout(() => URL.revokeObjectURL(old), 5000);
      const st = el("#live-img-status");
      if (st && !st.textContent.includes("full quick-look detail")) st.textContent += ` · full quick-look detail loaded (${cv.width} × ${cv.height} px)`;
    } catch { /* zůstane zmenšená verze */ } finally { s.busy = false; }
  }

  // Průměr z okolí 5×5 potlačí radarový šum (speckle)
  function blur(a, ok, N) {
    const out = new Float32Array(N * N), R = 2;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let s2 = 0, c = 0;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= N || yy >= N || !ok[yy * N + xx]) continue;
        s2 += a[yy * N + xx]; c++;
      }
      out[y * N + x] = c ? s2 / c : 0;
    }
    return out;
  }

  function bind(m) {
    map = m;
    map.on("click", (e) => {
      if (!on) return;
      const f = map.getLayer("events") && map.queryRenderedFeatures(e.point, { layers: ["events"] })[0];
      if (f) { const ev = events[f.properties.i]; pick({ lng: ev.lng, lat: ev.lat }, ev.title, ev); }
      else pick(e.lngLat, "Selected place");
    });
    map.on("moveend", () => { if (on && shown && !shown.hi) sharpenSoon(); });
    map.on("mousemove", (e) => { if (on && map.getLayer("events")) map.getCanvas().style.cursor = map.queryRenderedFeatures(e.point, { layers: ["events"] }).length ? "pointer" : ""; });
    el("#live-list").onclick = (e) => { const b = e.target.closest("[data-ev]"); if (b) { const ev = events[+b.dataset.ev]; pick({ lng: ev.lng, lat: ev.lat }, ev.title, ev); } };
    Sats.bind();
    el("#live-detail").onclick = (e) => {
      const b = e.target.closest("[data-pass]");
      if (b) showPass(+b.dataset.pass);
      else if (e.target.closest("#live-diff")) diff();
      else if (e.target.closest("#live-lapse")) timelapse();
    };
  }

  return { enter, exit, bind, search, loadPass, clean, marker, get on() { return on; },
    events: () => (on && events ? events.map((e) => ({ lng: e.lng, lat: e.lat, title: e.title, color: cat(e.cat)[1] })) : []),
    pickEvent: (i) => { const ev = events?.[i]; if (ev) pick({ lng: ev.lng, lat: ev.lat }, ev.title, ev); } };
})();
