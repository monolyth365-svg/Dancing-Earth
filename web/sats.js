// Družice na živé mapě: kde právě jsou, kam letí, jakou dráhu mají za sebou a před sebou,
// a u NISARu pruh, kam míří radar. Polohy se počítají v prohlížeči z dráhových údajů (TLE, model SGP4).
window.Sats = (() => {
  const RE = 6371, D2R = Math.PI / 180, STEP = 15, SPAN = 50 * 60; // krok dráhy 30 s, 50 minut dozadu i dopředu
  const el = (s) => document.querySelector(s);
  let map, sats = [], meta = null, on = false, tick = null, lastTracks = 0, loading = null;

  // Obrázek družice (kreslený, ne fotka): tělo, solární panely a vpředu šipka směru letu. Špička míří nahoru = směr letu.
  // NISAR má místo levého panelu svou velkou síťovou anténu na rameni – radar se dívá vlevo od směru letu.
  function icon(s, px = 44) {
    const u = s.id, nisar = s.id === "nisar";
    const panel = (pts, lines) => `<polygon points="${pts}" fill="url(#p-${u})" stroke="#0a1838" stroke-width=".7"/>${lines.map((l) => `<path d="${l}" stroke="#9cc4ff" stroke-width=".35" opacity=".7"/>`).join("")}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${px}" height="${px}" aria-hidden="true">
      <defs>
        <linearGradient id="p-${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7db2ff"/><stop offset="1" stop-color="#142a63"/></linearGradient>
        <linearGradient id="b-${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff6d2"/><stop offset=".45" stop-color="#dcae3f"/><stop offset="1" stop-color="#6e4b0c"/></linearGradient>
        <radialGradient id="d-${u}" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff2c0"/><stop offset="1" stop-color="#9a7420"/></radialGradient>
      </defs>
      <path d="M24 .8 L28.6 8.2 H19.4 Z" fill="${s.color}" stroke="#000" stroke-width=".7" stroke-linejoin="round"/>
      ${panel("45.5,19.5 32,21.5 32,30.5 45.5,32.5", ["M36.5 20.9V31.1", "M41 20.2V31.8", "M32 26H45.5"])}
      ${nisar
        ? `<path d="M19 24 L9.5 15" stroke="#cfd6e0" stroke-width="1.3"/><ellipse cx="9" cy="14" rx="8.6" ry="6.6" transform="rotate(-28 9 14)" fill="url(#d-${u})" stroke="#5b430c" stroke-width=".7"/>
           <path d="M2.5 11.5 Q9 16 16 15.5 M4 16.5 Q9 13 13 8.5 M6.5 8.5 Q8.5 14 12.5 19" fill="none" stroke="#5b430c" stroke-width=".4" opacity=".8"/>`
        : panel("2.5,19.5 16,21.5 16,30.5 2.5,32.5", ["M11.5 20.9V31.1", "M7 20.2V31.8", "M2.5 26H16"])}
      <polygon points="18,17.5 21.5,13.5 33.5,13.5 30,17.5" fill="#fff8dc" stroke="#3a2a06" stroke-width=".6"/>
      <polygon points="30,17.5 33.5,13.5 33.5,29.5 30,33.5" fill="#6e4b0c" stroke="#3a2a06" stroke-width=".6"/>
      <rect x="18" y="17.5" width="12" height="16" fill="url(#b-${u})" stroke="${s.color}" stroke-width="1"/>
      <circle cx="24" cy="38.5" r="3.2" fill="#e6e9ee" stroke="#4a5160" stroke-width=".7"/><path d="M24 33.5V36" stroke="#cfd6e0" stroke-width="1"/>
    </svg>`;
  }

  const load = () => (loading ??= doLoad());
  async function doLoad() {
    meta = await (await fetch("data/tle.json")).json();
    // Dráhové údaje stárnou: po třech dnech zkusit čerstvé přímo z CelesTrak (když to nejde, zůstanou přibalené)
    if (Date.now() - Date.parse(meta.fetched) > 3 * 864e5) {
      await Promise.all(meta.sats.map(async (s) => {
        try {
          const t = (await (await fetch(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${s.catnr}&FORMAT=TLE`)).text()).trim().split(/\r?\n/);
          if (t.length === 3 && t[1].startsWith("1 ")) { s.tle = [t[1], t[2]]; meta.fresh = true; }
        } catch { /* přibalené údaje stačí */ }
      }));
      if (meta.fresh) meta.fetched = new Date().toISOString();
    }
    sats = meta.sats.map((s) => ({ ...s, rec: satellite.twoline2satrec(s.tle[0], s.tle[1]) }));
  }

  // Bod pod družicí a výška v daném čase
  function sub(rec, date) {
    const pv = satellite.propagate(rec, date);
    if (!pv.position) return null;
    const g = satellite.eciToGeodetic(pv.position, satellite.gstime(date));
    return { lng: satellite.degreesLong(g.longitude), lat: satellite.degreesLat(g.latitude), alt: g.height };
  }
  const bearing = (a, b) => {
    const p1 = a.lat * D2R, p2 = b.lat * D2R, dl = (b.lng - a.lng) * D2R;
    return Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / D2R;
  };
  // Bod na zemi ve vzdálenosti km a směru (azimut) od výchozího bodu
  function dest(a, brg, km) {
    const d = km / RE, p1 = a.lat * D2R, t = brg * D2R;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
    const l2 = a.lng * D2R + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [((l2 / D2R + 540) % 360) - 180, p2 / D2R];
  }
  function now(s, t) {
    const a = sub(s.rec, t), b = sub(s.rec, new Date(+t + 5000));
    if (!a || !b) return null;
    const head = bearing(a, b);
    return { ...a, head, edges: s.swathKm ? s.swathKm.map((km) => dest(a, head - 90, km)) : null }; // radar míří vlevo od směru letu
  }

  // Čáry drah a pruh radaru (přepočítává se jednou za čas, ne každou vteřinu)
  function tracks(t0) {
    const lines = [], swath = [];
    for (const s of sats) {
      let seg = [], prev = null, part = "past", prevEdges = null;
      const flush = () => { if (seg.length > 1) lines.push({ type: "Feature", properties: { color: s.color, part }, geometry: { type: "LineString", coordinates: seg } }); seg = []; };
      for (let dt = -SPAN; dt <= SPAN; dt += STEP) {
        const p = now(s, new Date(+t0 + dt * 1000));
        if (!p) { flush(); prev = prevEdges = null; continue; }
        const np = dt <= 0 ? "past" : "future";
        if (prev && (Math.abs(p.lng - prev.lng) > 180 || np !== part)) { // přechod přes 180° nebo z minulosti do budoucnosti
          if (np !== part && Math.abs(p.lng - prev.lng) <= 180) seg.push([p.lng, p.lat]);
          flush();
          if (np !== part && Math.abs(p.lng - prev.lng) <= 180) seg.push([prev.lng, prev.lat]);
        }
        part = np;
        seg.push([p.lng, p.lat]);
        if (p.edges && prevEdges && Math.abs(dt) <= 15 * 60) {
          const q = [prevEdges[0], prevEdges[1], p.edges[1], p.edges[0], prevEdges[0]];
          if (Math.max(...q.map((c) => c[0])) - Math.min(...q.map((c) => c[0])) < 180)
            swath.push({ type: "Feature", properties: { part: dt <= 0 ? "past" : "future" }, geometry: { type: "Polygon", coordinates: [q] } });
        }
        prev = p; prevEdges = p.edges;
      }
      flush();
    }
    return { lines: { type: "FeatureCollection", features: lines }, swath: { type: "FeatureCollection", features: swath } };
  }

  function draw() {
    if (!on) return;
    const t = new Date();
    if (+t - lastTracks > 2000) {
      const g = tracks(t);
      map.getSource("sat-lines")?.setData(g.lines);
      map.getSource("sat-swath")?.setData(g.swath);
      lastTracks = +t;
    }
    const rows = [];
    for (const s of sats) {
      const p = now(s, t);
      if (!p) continue;
      s.marker.setLngLat([p.lng, p.lat]);
      s.arrow.style.transform = `rotate(${p.head}deg)`;
      if (p.edges) map.getSource("sat-beam")?.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: Math.abs(p.edges[0][0] - p.edges[1][0]) < 180 ? p.edges : [] } });
      s.pos = p;
      rows.push(`<li><button data-sat="${s.id}"><i style="background:${s.color}"></i><span><b>${s.name}</b> ${s.role}</span><time>${Math.abs(p.lat).toFixed(1)}°${p.lat >= 0 ? "N" : "S"} ${Math.abs(p.lng).toFixed(1)}°${p.lng >= 0 ? "E" : "W"} · ${Math.round(p.alt)} km</time></button></li>`);
    }
    const list = el("#sat-list");
    if (list && !list.matches(":hover") && !list.contains(document.activeElement)) list.innerHTML = rows.join("");
  }

  async function show(m) {
    map = m; on = true;
    try { await load(); } catch { el("#sat-note").textContent = "Satellite positions are not available right now."; return; }
    if (!on) return;
    const before = map.getLayer("events") ? "events" : undefined, empty = { type: "FeatureCollection", features: [] };
    if (!map.getSource("sat-swath")) {
      map.addSource("sat-swath", { type: "geojson", data: empty });
      map.addSource("sat-lines", { type: "geojson", data: empty });
      map.addSource("sat-beam", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [] } } });
      map.addLayer({ id: "sat-swath", type: "fill", source: "sat-swath", paint: { "fill-color": "#e9b949", "fill-opacity": ["match", ["get", "part"], "past", 0.3, 0.1] } }, before);
      map.addLayer({ id: "sat-past", type: "line", source: "sat-lines", filter: ["==", ["get", "part"], "past"], paint: { "line-color": ["get", "color"], "line-width": 1.6, "line-opacity": 0.6 } }, before);
      map.addLayer({ id: "sat-future", type: "line", source: "sat-lines", filter: ["==", ["get", "part"], "future"], paint: { "line-color": ["get", "color"], "line-width": 1.2, "line-opacity": 0.4, "line-dasharray": [2, 3] } }, before);
      map.addLayer({ id: "sat-beam", type: "line", source: "sat-beam", paint: { "line-color": "#ffe9a8", "line-width": 3, "line-opacity": 0.9 } }, before);
    }
    for (const s of sats) {
      if (!s.marker) {
        const box = Object.assign(document.createElement("div"), { className: "sat" });
        s.arrow = Object.assign(document.createElement("div"), { className: "sat-icon", innerHTML: icon(s) });
        box.append(s.arrow, Object.assign(document.createElement("span"), { textContent: s.name }));
        s.marker = new maplibregl.Marker({ element: box, anchor: "center" });
        s.marker.setLngLat([0, 0]);
      }
      s.marker.addTo(map);
    }
    const age = Math.max(0, Math.round((Date.now() - Date.parse(meta.fetched)) / 864e5));
    el("#sat-note").textContent = `Positions are worked out in your browser from orbital elements published by CelesTrak (${age === 0 ? "updated today" : age + " days old"}), good to a few kilometres. Solid line: the last 50 minutes. Dashed: the next 50. Yellow band: the strip NISAR's radar looks at, about 240 km wide and 435–675 km to the left of its path, checked against real NISAR images. The radar does not record all the time.`;
    lastTracks = 0;
    draw();
    clearInterval(tick);
    tick = setInterval(draw, 1000);
  }

  function hide() {
    on = false;
    clearInterval(tick);
    sats.forEach((s) => s.marker?.remove());
    if (!map) return;
    for (const l of ["sat-beam", "sat-future", "sat-past", "sat-swath"]) if (map.getLayer(l)) map.removeLayer(l);
    for (const s of ["sat-beam", "sat-lines", "sat-swath"]) if (map.getSource(s)) map.removeSource(s);
  }

  function bind() {
    el("#sat-list").onclick = (e) => {
      const b = e.target.closest("[data-sat]"), s = b && sats.find((x) => x.id === b.dataset.sat);
      if (s?.pos) map.flyTo({ center: [s.pos.lng, s.pos.lat], zoom: Math.max(map.getZoom(), 3), duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1200 });
    };
  }

  return { show, hide, bind, load, icon, at: now, all: () => sats, meta: () => meta, _now: () => sats.map((s) => ({ id: s.id, ...s.pos })) };
})();
