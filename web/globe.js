// Malá živá zeměkoule: Země ve 3D (povrch = snímek NASA Blue Marble), družice ve správné výšce,
// jejich dráhy a paprsek radaru NISAR. Vše v měřítku. Kreslí se ručně do plátna, bez 3D knihovny.
window.Globe = (() => {
  const D2R = Math.PI / 180, RE = 6371, el = (s) => document.querySelector(s);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const unit = (lat, lng, r = 1) => { const p = lat * D2R, l = lng * D2R; return [r * Math.cos(p) * Math.cos(l), r * Math.cos(p) * Math.sin(l), r * Math.sin(p)]; };
  let tex = null, sats = [], icons = {}, open = false, speed = 1, simT = 0, lastReal = 0, lastEarth = 0, raf = 0;
  let free = false, vlat = 0, vlng = 0, zoom = 1, dirty = false; // vlastní pohled uživatele (otáčení a přiblížení)
  const big = { css: 340 }, mini = { css: 34 };

  // Bod na kouli ve směru (azimut) a úhlové vzdálenosti od výchozího bodu
  function dest(lat, lng, brg, deg) {
    const d = deg * D2R, p1 = lat * D2R, t = brg * D2R;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
    return [p2 / D2R, lng + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2)) / D2R];
  }
  // Směr ke Slunci v souřadnicích pevně spojených se Zemí (stačí přibližně, kvůli stínu noci)
  function sunVec(date) {
    const d = (date - Date.UTC(2000, 0, 1, 12)) / 864e5, g = (357.529 + 0.98560028 * d) * D2R;
    const L = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R, e = (23.439 - 3.6e-7 * d) * D2R;
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L)), lon = ra - satellite.gstime(date);
    return [Math.cos(dec) * Math.cos(lon), Math.cos(dec) * Math.sin(lon), Math.sin(dec)];
  }
  // Pohled: střed koule míří na (lat0, lng0), sever je nahoře
  function view(lat0, lng0) {
    const p = lat0 * D2R, l = lng0 * D2R;
    return { k: [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)], i: [-Math.sin(l), Math.cos(l), 0], j: [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)] };
  }
  const P = (F, v) => [dot(v, F.i), dot(v, F.j), dot(v, F.k)];       // do souřadnic obrazovky (v poloměrech Země)
  const seen = (q) => q[2] > 0 || q[0] * q[0] + q[1] * q[1] > 1;      // není schovaný za Zemí

  // Zesvětlení tmavých barev snímku (oceány, lesy), aniž by se led přepálil do čisté bílé
  const LUT = Float32Array.from({ length: 256 }, (_, v) => 255 * Math.pow(v / 255, 0.72));

  // Povrch Země: pro každý bod kotouče se dopočítá zeměpisná poloha a vezme barva ze snímku Blue Marble
  function paintEarth(cv, R, F, sun) {
    const S = cv.width, ctx = cv.getContext("2d"), img = ctx.createImageData(S, S), o = img.data, c = S / 2;
    const { i, j, k } = F, T = tex.data, TW = tex.width, TH = tex.height;
    for (let y = 0; y < S; y++) {
      const dy = (c - y - 0.5) / R;
      for (let x = 0; x < S; x++) {
        const dx = (x + 0.5 - c) / R, r2 = dx * dx + dy * dy;
        if (r2 > 1) continue;
        const z = Math.sqrt(1 - r2);
        const px = dx * i[0] + dy * j[0] + z * k[0], py = dx * i[1] + dy * j[1] + z * k[1], pz = dx * i[2] + dy * j[2] + z * k[2];
        const tx = Math.min(TW - 1, ((Math.atan2(py, px) / Math.PI + 1) / 2 * TW) | 0), ty = Math.min(TH - 1, ((0.5 - Math.asin(Math.max(-1, Math.min(1, pz))) / Math.PI) * TH) | 0), t = (ty * TW + tx) * 4;
        const d = px * sun[0] + py * sun[1] + pz * sun[2], f = d > 0.1 ? 1 : d < -0.1 ? 0 : (d + 0.1) / 0.2; // den / soumrak / noc
        const b = (0.38 + 0.62 * f) * (0.55 + 0.45 * z) * 1.1, q = (y * S + x) * 4;
        o[q] = Math.min(255, LUT[T[t]] * b); o[q + 1] = Math.min(255, LUT[T[t + 1]] * b); o[q + 2] = Math.min(255, LUT[T[t + 2]] * b + (1 - f) * 16);
        o[q + 3] = Math.min(1, (1 - Math.sqrt(r2)) * R) * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function draw(g, date, detail, repaint) {
    const n = sats[0], p = Sats.at(n, date);
    if (!p) return null;
    // Kamera stojí 50° vlevo od dráhy NISARu – na straně, kam se dívá radar, takže je paprsek vidět z boku
    const follow = dest(p.lat, p.lng, p.head - 90, 50), own = g === big && free;
    if (g === big && !free) [vlat, vlng] = follow; // odtud se pokračuje, když uživatel začne koulí otáčet
    const F = view(own ? vlat : follow[0], own ? vlng : follow[1]), sun = sunVec(date);
    const cv = g.cv, S = cv.width, R = S * 0.385 * (g === big ? zoom : 1), c = S / 2, ctx = cv.getContext("2d"), dpr = S / g.css;
    if (!g.earth) g.earth = Object.assign(document.createElement("canvas"), { width: S, height: S });
    if (repaint) paintEarth(g.earth, R, F, sun);
    const XY = (q) => [c + q[0] * R, c - q[1] * R], at3 = (st) => P(F, unit(st.lat, st.lng, 1 + st.alt / RE));
    ctx.clearRect(0, 0, S, S);
    const halo = ctx.createRadialGradient(c, c, R * 0.97, c, c, R * 1.08);
    halo.addColorStop(0, "rgba(120,170,255,.45)"); halo.addColorStop(1, "rgba(120,170,255,0)");
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(c, c, R * 1.08, 0, 7); ctx.fill();
    ctx.drawImage(g.earth, 0, 0);

    // Pruh, který radar NISAR právě přeletěl (posledních 12 minut), a paprsek od družice k zemi
    const strip = [];
    for (let dt = -12 * 60; dt <= 0; dt += 30) {
      const st = Sats.at(n, new Date(+date + dt * 1000));
      if (st?.edges) { const e = st.edges.map(([lng, lat]) => P(F, unit(lat, lng))); if (e[0][2] > 0 && e[1][2] > 0) strip.push(e); }
    }
    if (strip.length > 1) {
      ctx.beginPath();
      strip.forEach((e, m) => { const [x, y] = XY(e[0]); m ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      strip.slice().reverse().forEach((e) => ctx.lineTo(...XY(e[1])));
      ctx.closePath(); ctx.fillStyle = "rgba(233,185,73,.4)"; ctx.fill();
    }
    // Dráhy: plná čára = posledních 50 minut, čárkovaná = dalších 50; část za Zemí se nekreslí
    for (const s of detail ? sats : [n]) {
      ctx.strokeStyle = s.color; ctx.lineWidth = (s === n ? 1.7 : 1.1) * dpr;
      for (const [t0, t1, alpha, dash] of [[-3000, 0, 0.75, []], [0, 3000, 0.45, [3 * dpr, 4 * dpr]]]) {
        ctx.globalAlpha = alpha; ctx.setLineDash(dash); ctx.beginPath();
        let pen = false;
        for (let dt = t0; dt <= t1; dt += 60) {
          const st = Sats.at(s, new Date(+date + dt * 1000)), q = st && at3(st);
          if (!q || !seen(q)) { pen = false; continue; }
          const [x, y] = XY(q);
          pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true;
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1; ctx.setLineDash([]);

    // Družice: obrázek natočený ve směru letu (šipka vpředu), popisek vedle
    const shown = [];
    for (const s of detail ? sats : [n]) {
      const st = s === n ? p : Sats.at(s, date), q = st && at3(st);
      if (!q || !seen(q)) continue;
      const nx = Sats.at(s, new Date(+date + 20000)), q2 = nx && at3(nx), [x, y] = XY(q);
      const ang = q2 ? Math.atan2(q2[0] - q[0], q2[1] - q[1]) : 0, size = (s === n ? (detail ? 24 : 16) : 21) * dpr, im = icons[s.id];
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      if (im?.complete && im.naturalWidth) { ctx.shadowColor = "rgba(0,0,0,.8)"; ctx.shadowBlur = 4 * dpr; ctx.drawImage(im, -size / 2, -size / 2, size, size); }
      else { ctx.beginPath(); ctx.arc(0, 0, 4 * dpr, 0, 7); ctx.fillStyle = s.color; ctx.fill(); }
      ctx.restore();
      if (detail) {
        ctx.font = `500 ${11 * dpr}px "JetBrains Mono", ui-monospace, monospace`; ctx.lineWidth = 3 * dpr; ctx.strokeStyle = "rgba(0,0,0,.85)"; ctx.fillStyle = "#fff";
        const tx = x + size * 0.55, ty = y + 4 * dpr;
        ctx.strokeText(s.name, tx, ty); ctx.fillText(s.name, tx, ty);
      }
      shown.push(s.id);
    }
    // Paprsek radaru: od družice k pruhu na zemi (kreslí se až nahoru, aby ho obrázek družice nezakryl)
    const sq = at3(p), e = p.edges.map(([lng, lat]) => P(F, unit(lat, lng)));
    if (seen(sq) && e[0][2] > 0 && e[1][2] > 0) {
      const [sx, sy] = XY(sq), a = XY(e[0]), b = XY(e[1]), pulse = 0.6 + 0.3 * Math.sin(performance.now() / 350);
      const gr = ctx.createLinearGradient(sx, sy, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      gr.addColorStop(0, `rgba(255,244,190,${pulse})`); gr.addColorStop(1, "rgba(255,225,130,.3)");
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(...a); ctx.lineTo(...b); ctx.closePath(); ctx.fillStyle = gr; ctx.fill();
      ctx.strokeStyle = "rgba(255,244,200,.95)"; ctx.lineWidth = 0.8 * dpr; ctx.stroke();
      ctx.shadowColor = "#ffe9a8"; ctx.shadowBlur = 6 * dpr;
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.strokeStyle = "#fff6d0"; ctx.lineWidth = 2.6 * dpr; ctx.lineCap = "round"; ctx.stroke();
      ctx.shadowBlur = 0;
    }
    return { p, sun, shown };
  }

  const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  function describe(date, info) {
    const { p, sun } = info, n = sats[0];
    const v = satellite.propagate(n.rec, date).velocity, kms = v ? Math.hypot(v.x, v.y, v.z) : null;
    const mid = [(p.edges[0][0] + p.edges[1][0]) / 2, (p.edges[0][1] + p.edges[1][1]) / 2]; // střed pruhu (stačí přibližně)
    const elev = dot(unit(mid[1], mid[0]), sun), light = elev > 0.1 ? "daytime" : elev < -0.1 ? "night" : "twilight";
    const h = ((date.getUTCHours() + date.getUTCMinutes() / 60 + mid[0] / 15) % 24 + 24) % 24, lst = `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;
    const ll = `${Math.abs(p.lat).toFixed(1)}°${p.lat >= 0 ? "N" : "S"} ${Math.abs(p.lng).toFixed(1)}°${p.lng >= 0 ? "E" : "W"}`;
    return `${speed > 1 ? `<b class="sim">Simulated time ×${speed}: ${date.toISOString().slice(0, 16).replace("T", " ")} UTC (not live)</b><br>` : ""}<b>NISAR</b> is over ${ll}, ${Math.round(p.alt)} km up, flying ${COMPASS[Math.round((((p.head % 360) + 360) % 360) / 45) % 8]}${kms ? ` at ${kms.toFixed(1)} km/s` : ""}. Its radar points at a strip 435–675 km to its left, where it is ${light} (${lst} local solar time). Radar brings its own light, so day or night makes no difference.`;
  }

  function frame() {
    raf = 0;
    if (!open) return;
    const real = performance.now(), dtReal = real - lastReal;
    lastReal = real;
    if (speed > 1) simT += dtReal * speed;
    const date = new Date(speed > 1 ? simT : Date.now()), repaint = speed > 1 || dirty || real - lastEarth > 1000;
    if (repaint) lastEarth = real;
    dirty = false;
    const info = draw(big, date, true, repaint);
    if (info && repaint) {
      el("#orbit-text").innerHTML = describe(date, info);
      el("#orbit-legend").innerHTML = sats.map((s) => `<span class="${info.shown.includes(s.id) ? "" : "off"}"><i style="background:${s.color}"></i>${s.name}${info.shown.includes(s.id) ? "" : " (behind Earth)"}</span>`).join("");
    }
    raf = requestAnimationFrame(frame);
  }

  function size(g, css) {
    const dpr = Math.min(2, devicePixelRatio || 1);
    g.css = css; g.cv.style.width = g.cv.style.height = css + "px";
    g.cv.width = g.cv.height = Math.round(css * dpr); g.earth = null;
  }

  function toggle(show) {
    open = show;
    el("#orbit").hidden = !show;
    el("#globe-btn").setAttribute("aria-expanded", show);
    if (!show) { setSpeed(1); setFree(false); zoom = 1; return; }
    el("#orbit").style.top = el(".top").offsetHeight + 8 + "px";
    size(big, Math.min(400, el("#orbit").clientWidth - 32));
    lastReal = performance.now(); lastEarth = 0;
    if (!raf) raf = requestAnimationFrame(frame);
    el("#orbit-close").focus();
  }
  function setSpeed(v) {
    speed = v; simT = Date.now(); lastEarth = 0;
    el("#orbit-fast").setAttribute("aria-pressed", v > 1);
    el("#orbit-fast").textContent = v > 1 ? "Back to live" : "Speed up time ×300";
  }

  // Vlastní pohled: tažením se koule otáčí, kolečkem nebo tlačítky přibližuje
  function setFree(v) { free = v; dirty = true; el("#orbit-follow").hidden = !v && zoom === 1; }
  function setZoom(z) { zoom = Math.max(1, Math.min(4, z)); dirty = true; el("#orbit-follow").hidden = !free && zoom === 1; }
  function turn(dx, dy) { // posun v pixelech obrazovky
    const k = 57.3 / (big.css * 0.385 * zoom);
    if (!free) setFree(true);
    vlng = ((vlng - dx * k + 540) % 360) - 180;
    vlat = Math.max(-89, Math.min(89, vlat + dy * k));
    dirty = true;
  }
  function controls() {
    const cv = big.cv;
    let drag = null;
    cv.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; try { cv.setPointerCapture(e.pointerId); } catch { /* nevadí */ } cv.classList.add("grabbing"); });
    cv.addEventListener("pointermove", (e) => { if (!drag) return; turn(e.clientX - drag.x, e.clientY - drag.y); drag = { x: e.clientX, y: e.clientY }; });
    const end = () => { drag = null; cv.classList.remove("grabbing"); };
    cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
    cv.addEventListener("wheel", (e) => { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
    cv.addEventListener("keydown", (e) => {
      const step = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[e.key];
      if (step) { e.preventDefault(); turn(...step); }
      else if (e.key === "+" || e.key === "=") setZoom(zoom * 1.3);
      else if (e.key === "-") setZoom(zoom / 1.3);
    });
    el("#orbit-in").onclick = () => setZoom(zoom * 1.4);
    el("#orbit-out").onclick = () => setZoom(zoom / 1.4);
    el("#orbit-follow").onclick = () => { zoom = 1; setFree(false); };
  }

  async function init() {
    try {
      await Sats.load();
      sats = Sats.all();
      if (!sats.length || sats[0].id !== "nisar") throw new Error("no NISAR orbit");
      const im = await new Promise((ok, bad) => { const x = new Image(); x.onload = () => ok(x); x.onerror = bad; x.src = "earth.jpg"; });
      const c = Object.assign(document.createElement("canvas"), { width: im.width, height: im.height }), cx = c.getContext("2d", { willReadFrequently: true });
      cx.drawImage(im, 0, 0);
      tex = cx.getImageData(0, 0, im.width, im.height);
    } catch { return; } // bez dat se tlačítko se zeměkoulí vůbec neukáže
    for (const s of sats) icons[s.id] = Object.assign(new Image(), { src: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(Sats.icon(s, 96)) });
    big.cv = el("#globe"); mini.cv = el("#globe-mini");
    size(mini, mini.css);
    el("#globe-btn").hidden = false;
    const tickMini = () => { if (!document.hidden) draw(mini, new Date(), false, true); };
    tickMini(); setInterval(tickMini, 3000);
    el("#globe-btn").onclick = () => toggle(!open);
    el("#orbit-close").onclick = () => toggle(false);
    el("#orbit-fast").onclick = () => setSpeed(speed > 1 ? 1 : 300);
    controls();
    addEventListener("keydown", (e) => { if (e.key === "Escape" && open) toggle(false); });
  }

  return { init, _state: () => ({ open, speed, ready: !!tex, free, zoom, vlat: Math.round(vlat), vlng: Math.round(vlng) }) };
})();
