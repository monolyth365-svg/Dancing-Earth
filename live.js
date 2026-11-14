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
  let map, events = null, passes = [], reqId = 0, on = false;
  const marker = new maplibregl.Marker({ element: Object.assign(document.createElement("div"), { className: "pt" }) });

  async function enter(m, at) {
    map = m; on = true;
    document.body.classList.add("live");
    for (const l of ["perim", "sar"]) if (map.getLayer(l)) map.removeLayer(l);
    for (const s of ["perim", "sar"]) if (map.getSource(s)) map.removeSource(s);
    document.querySelectorAll("#sites button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.site === "live"));
    history.replaceState(null, "", "#live" + (at ? "=" + at : ""));
    if (!at) map.flyTo({ center: [0, 20], zoom: 1.4, duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1200 });
    el("#live-detail").innerHTML = "";
    await loadEvents();
    if (at) { const [lng, lat] = at.split(",").map(Number); if (isFinite(lng) && isFinite(lat)) pick({ lng, lat }, "Shared location"); }
  }

  function exit() {
    if (!on) return;
    on = false; reqId++;
    document.body.classList.remove("live");
    marker.remove();
    for (const l of ["live-img", "events"]) if (map.getLayer(l)) map.removeLayer(l);
    for (const s of ["live-img", "events"]) if (map.getSource(s)) map.removeSource(s);
  }

  async function loadEvents() {
    el("#live-status").textContent = "Loading current events from NASA EONET…";
    try {
      if (!events) {
        const raw = (await (await fetch(EONET)).json()).events;
        events = raw.map((e) => {
          const g = e.geometry.at(-1), c = g.type === "Point" ? g.coordinates : g.coordinates.flat(3).slice(0, 2);
          return { id: e.id, title: e.title, cat: e.categories[0]?.id, date: (g.date || "").slice(0, 10), lng: c[0], lat: c[1], link: e.sources?.[0]?.url };
        }).filter((e) => isFinite(e.lng) && isFinite(e.lat)).sort((a, b) => b.date.localeCompare(a.date));
      }
    } catch { events = null; el("#live-status").textContent = "NASA EONET did not answer. You can still click anywhere on the map."; }
    if (!on) return;
    const list = events || [];
    if (!map.getSource("events")) {
      map.addSource("events", { type: "geojson", data: { type: "FeatureCollection", features: list.map((e, i) => ({ type: "Feature", id: i, properties: { i, color: cat(e.cat)[1] }, geometry: { type: "Point", coordinates: [e.lng, e.lat] } })) } });
      map.addLayer({ id: "events", type: "circle", source: "events", paint: { "circle-radius": 6, "circle-color": ["get", "color"], "circle-stroke-color": "#0b0d10", "circle-stroke-width": 1.5, "circle-opacity": 0.9 } });
    }
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
    marker.setLngLat(ll).addTo(map);
    history.replaceState(null, "", `#live=${ll.lng.toFixed(3)},${ll.lat.toFixed(3)}`);
    const head = `<h2>${esc(title)}</h2><p class="mono meta">${ll.lat.toFixed(3)}°, ${ll.lng.toFixed(3)}°${ev ? ` · ${cat(ev.cat)[0]} · reported ${ev.date}` : ""}${ev?.link ? ` · <a href="${esc(ev.link)}" target="_blank" rel="noopener">source</a>` : ""}</p>`;
    el("#live-detail").innerHTML = head + `<p class="status" role="status">Asking NASA's archive (ASF) for NISAR passes over this spot…</p>`;
    el("#live-detail").scrollIntoView({ block: "nearest" });
    let res;
    try {
      const q = new URLSearchParams({ platform: "NISAR", processingLevel: "GCOV", output: "jsonlite", maxResults: "60", intersectsWith: `POINT(${ll.lng.toFixed(4)} ${ll.lat.toFixed(4)})` });
      res = (await (await fetch(`${ASF}?${q}`)).json()).results || [];
    } catch { res = null; }
    if (id !== reqId) return;
    if (!res) { el("#live-detail").innerHTML = head + `<p class="status">The archive did not answer. Try again in a moment.</p>`; return; }
    const seen = new Set();
    passes = res.filter((r) => r.browse?.length).sort((a, b) => b.startTime.localeCompare(a.startTime))
      .filter((r) => !seen.has(r.startTime.slice(0, 13)) && seen.add(r.startTime.slice(0, 13))).slice(0, 14);
    if (!passes.length) {
      el("#live-detail").innerHTML = head + `<p class="status">No NISAR image of this spot in the archive yet. NISAR mostly maps land and ice; open ocean is rarely imaged.</p>`;
      return;
    }
    // Odhad dalšího přeletu: stejná dráha se opakuje po 12 dnech
    const latest = {};
    passes.forEach((p) => { const k = `${p.path}-${p.flightDirection}`; latest[k] ??= p.startTime; });
    const now = Date.now(), next = Math.min(...Object.values(latest).map((t) => { let d = Date.parse(t); while (d < now) d += 12 * 864e5; return d; }));
    el("#live-detail").innerHTML = head + `
      <p>${res.length >= 60 ? "60 or more" : res.length} NISAR radar products cover this spot. Newest: <b>${passes[0].startTime.slice(0, 10)}</b>. Next pass expected around <b>${new Date(next).toISOString().slice(0, 10)}</b> (estimate from the 12-day repeat).</p>
      <div class="passes" role="group" aria-label="Radar passes, newest first">${passes.map((p, i) => `<button data-pass="${i}" aria-pressed="false">${p.startTime.slice(0, 10)}</button>`).join("")}</div>
      <p class="status" id="live-img-status" role="status"></p>
      <p class="hint">Click the dates to flip between passes and spot what changed. Colours are NASA's quick-look composite of the HH and HV channels: brighter means a stronger radar echo; water and smooth ground are dark.</p>`;
    showPass(0);
  }

  // Náhledový snímek čteme přímo z NASA; černé okolí zprůhledníme, ať je vidět mapa
  async function showPass(i) {
    const id = ++reqId, p = passes[i];
    document.querySelectorAll("[data-pass]").forEach((b) => b.setAttribute("aria-pressed", +b.dataset.pass === i));
    const st = el("#live-img-status");
    st.textContent = `Loading radar image of ${p.startTime.slice(0, 10)} from NASA…`;
    try {
      const png = p.browse.find((u) => u.endsWith("_LATLON.png")), kml = (p.nisar?.additionalUrls || []).find((u) => u.endsWith("_LATLON.kml"));
      if (!png || !kml) throw new Error("no browse");
      const [txt, bmp] = await Promise.all([fetch(kml).then((r) => r.text()), fetch(png).then((r) => r.blob()).then((b) => createImageBitmap(new Blob([b], { type: "image/png" })))]);
      if (id !== reqId) return;
      const c = txt.match(/<coordinates>([^<]+)</)[1].trim().split(/\s+/).map((s) => s.split(",").map(Number)); // LL, LR, UR, UL
      const k = Math.min(1, 1200 / Math.max(bmp.width, bmp.height)), cv = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
      const cx = cv.getContext("2d");
      cx.drawImage(bmp, 0, 0, cv.width, cv.height);
      const im = cx.getImageData(0, 0, cv.width, cv.height), a = im.data;
      for (let j = 0; j < a.length; j += 4) if (a[j] + a[j + 1] + a[j + 2] < 10) a[j + 3] = 0;
      cx.putImageData(im, 0, 0);
      const coords = [c[3], c[2], c[1], c[0]], url = cv.toDataURL("image/png");
      if (map.getSource("live-img")) map.getSource("live-img").updateImage({ url, coordinates: coords });
      else {
        map.addSource("live-img", { type: "image", url, coordinates: coords });
        map.addLayer({ id: "live-img", type: "raster", source: "live-img", paint: { "raster-opacity": 0.92, "raster-fade-duration": 0 } }, map.getLayer("events") ? "events" : undefined);
      }
      const lons = c.map((x) => x[0]), lats = c.map((x) => x[1]);
      if (i === 0 || !map.getBounds().contains(marker.getLngLat())) map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 40, duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1000 });
      st.textContent = `NISAR radar image, ${p.startTime.slice(0, 16).replace("T", " ")} UTC · track ${p.path}, frame ${p.frame}, ${p.flightDirection.toLowerCase()} · quick-look image from NASA ASF DAAC`;
    } catch (e) {
      if (id === reqId) st.textContent = "This radar image could not be loaded. Try another date.";
    }
  }

  function bind(m) {
    map = m;
    map.on("click", (e) => {
      if (!on) return;
      const f = map.getLayer("events") && map.queryRenderedFeatures(e.point, { layers: ["events"] })[0];
      if (f) { const ev = events[f.properties.i]; pick({ lng: ev.lng, lat: ev.lat }, ev.title, ev); }
      else pick(e.lngLat, "Selected place");
    });
    map.on("mousemove", (e) => { if (on && map.getLayer("events")) map.getCanvas().style.cursor = map.queryRenderedFeatures(e.point, { layers: ["events"] }).length ? "pointer" : ""; });
    el("#live-list").onclick = (e) => { const b = e.target.closest("[data-ev]"); if (b) { const ev = events[+b.dataset.ev]; pick({ lng: ev.lng, lat: ev.lat }, ev.title, ev); } };
    el("#live-detail").onclick = (e) => { const b = e.target.closest("[data-pass]"); if (b) showPass(+b.dataset.pass); };
  }

  return { enter, exit, bind, get on() { return on; } };
})();
