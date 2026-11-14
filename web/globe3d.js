// Velká 3D zeměkoule (knihovna CesiumJS, načítá se až na vyžádání).
// Povrch se dočítá po dlaždicích podle toho, kam a jak zblízka se uživatel dívá: zdálky NASA Blue Marble,
// zblízka mozaika Landsat (30 m). Kamerou jde otáčet, přibližovat až k zemi a naklonit ji vzhůru k družici.
// Polohy družic se počítají stejně jako na mapě (TLE + SGP4). Model družice je zjednodušený náčrt, mnohonásobně zvětšený.
window.Globe3D = (() => {
  const BASE = "https://cesium.com/downloads/cesiumjs/releases/1.123/Build/Cesium/", SCALE = 4000, el = (s) => document.querySelector(s);
  const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/";
  let C, viewer = null, loading = null, open = false, sats = [], lastSlow = 0, swath = null;
  // Tablety a telefony mají málo grafické paměti (Safari na iPadu jinak stránku shodí) → úsporný režim
  const LIGHT = matchMedia("(pointer: coarse)").matches || /iPad|iPhone|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));
  let mapLost = null;
  let sel = null, track = null, spot = null; // vybraná družice; kamera letí s ní (track) nebo stojí na zemi a dívá se na ni (spot)

  const loadLib = () => (loading ??= new Promise((ok, bad) => {
    window.CESIUM_BASE_URL = BASE;
    document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: BASE + "Widgets/widgets.css" }));
    const s = Object.assign(document.createElement("script"), { src: BASE + "Cesium.js" });
    s.onload = ok; s.onerror = () => { loading = null; bad(new Error("3D engine could not be loaded")); };
    document.head.append(s);
  }));

  const now = () => C.JulianDate.toDate(viewer.clock.currentTime);
  const cart = (lng, lat, km = 0) => C.Cartesian3.fromDegrees(lng, lat, km * 1000);

  // Stav družice v čase: poloha a místní osy (dopředu = směr letu, vlevo, nahoru). Počítá se jednou na snímek.
  function st(s) {
    const t = +now();
    if (s._t === t) return s._s;
    const p = Sats.at(s, new Date(t)), q = Sats.at(s, new Date(t + 1000));
    if (!p || !q) return s._s;
    const pos = cart(p.lng, p.lat, p.alt), up = C.Cartesian3.normalize(pos, new C.Cartesian3());
    let fwd = C.Cartesian3.normalize(C.Cartesian3.subtract(cart(q.lng, q.lat, q.alt), pos, new C.Cartesian3()), new C.Cartesian3());
    const left = C.Cartesian3.normalize(C.Cartesian3.cross(up, fwd, new C.Cartesian3()), new C.Cartesian3());
    fwd = C.Cartesian3.cross(left, up, new C.Cartesian3());
    const rot = new C.Matrix3(fwd.x, left.x, up.x, fwd.y, left.y, up.y, fwd.z, left.z, up.z);
    s._t = t; s._s = { p, pos, fwd, left, up, quat: C.Quaternion.fromRotationMatrix(rot) };
    return s._s;
  }
  const offset = (S, f, l, u) => new C.Cartesian3(S.pos.x + (S.fwd.x * f + S.left.x * l + S.up.x * u) * SCALE, S.pos.y + (S.fwd.y * f + S.left.y * l + S.up.y * u) * SCALE, S.pos.z + (S.fwd.z * f + S.left.z * l + S.up.z * u) * SCALE);
  const posProp = (fn) => (C.CallbackPositionProperty ? new C.CallbackPositionProperty(fn, false) : new C.CallbackProperty(fn, false));

  function build() {
    viewer = new C.Viewer("g3d-view", {
      baseLayer: new C.ImageryLayer(new C.UrlTemplateImageryProvider({ url: GIBS + "BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg", maximumLevel: 8, credit: "NASA GIBS Blue Marble" })),
      scene3DOnly: true, msaaSamples: 1, skyBox: LIGHT ? false : undefined, contextOptions: { webgl: { antialias: false, powerPreference: "default" } },
      baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
    });
    // Ostrý detail zblízka: mozaika Landsat 30 m; černá (= bez dat, moře) se zprůhlední, aby byl vidět Blue Marble
    // POZOR: nepoužívat u této vrstvy „minimumLevel“ – nutilo by to načíst všechny dlaždice dané úrovně pro celou
    // viditelnou polokouli (tisíce obrázků), což sekalo obraz a na iPadu shodilo Safari. Správně: vrstva se ukáže
    // až na dlaždicích terénu od úrovně 7 výš, tedy jen zblízka a jen tam, kam se uživatel dívá.
    const detail = new C.ImageryLayer(new C.UrlTemplateImageryProvider({ url: GIBS + "Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual/default/2000-12-01/GoogleMapsCompatible_Level12/{z}/{y}/{x}.jpg", maximumLevel: LIGHT ? 11 : 12, credit: "NASA Landsat WELD mosaic" }), { minimumTerrainLevel: 7 });
    viewer.imageryLayers.add(detail);
    detail.colorToAlpha = C.Color.BLACK; detail.colorToAlphaThreshold = 0.02;
    viewer.clock.shouldAnimate = true; viewer.clock.multiplier = 1; viewer.clock.currentTime = C.JulianDate.now();
    viewer.scene.globe.enableLighting = false;
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 500;
    viewer.scene.globe.maximumScreenSpaceError = LIGHT ? 3 : 2.6; // méně dlaždic najednou = plynulejší pohyb a méně paměti
    viewer.scene.globe.tileCacheSize = LIGHT ? 60 : 100;
    if (LIGHT) { viewer.scene.fog.enabled = false; viewer.scene.sun && (viewer.scene.sun.show = false); viewer.scene.moon && (viewer.scene.moon.show = false); }
    // Když počítač nestíhá (pod 24 snímků za vteřinu), sníží se postupně rozlišení a detail dlaždic, aby se obraz nesekal
    let frames = 0, since = performance.now();
    viewer.scene.postRender.addEventListener(() => {
      frames++;
      const t = performance.now();
      if (t - since < 3000) return;
      const fps = (frames * 1000) / (t - since);
      frames = 0; since = t;
      if (fps < 24 && viewer.resolutionScale > 0.55) { viewer.resolutionScale = Math.max(0.55, viewer.resolutionScale - 0.15); viewer.scene.globe.maximumScreenSpaceError = Math.min(6, viewer.scene.globe.maximumScreenSpaceError + 1); }
    });

    sats = Sats.all();
    sel = sats[0];
    el("#g3d-sats").innerHTML = sats.map((x) => `<button data-sat3="${x.id}" aria-pressed="${x === sel}" title="${x.role}"><i style="background:${x.color}"></i>${x.name}</button>`).join("");
    const lines = viewer.scene.primitives.add(new C.PolylineCollection());
    for (const s of sats) {
      const col = C.Color.fromCssColorString(s.color), nisar = s.id === "nisar";
      viewer.entities.add({ // zdálky obrázek se šipkou směru letu a popisek
        position: posProp(() => st(s)?.pos),
        billboard: { image: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(Sats.icon(s, 96)), width: nisar ? 46 : 38, height: nisar ? 46 : 38, alignedAxis: new C.CallbackProperty(() => st(s)?.fwd, false), distanceDisplayCondition: new C.DistanceDisplayCondition(2.2e6, Number.MAX_VALUE) },
        label: { text: s.name, font: '500 13px "JetBrains Mono", monospace', pixelOffset: new C.Cartesian2(28, 0), horizontalOrigin: C.HorizontalOrigin.LEFT, fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK, outlineWidth: 4, style: C.LabelStyle.FILL_AND_OUTLINE },
      });
      // Zblízka prostorový náčrt: tělo, solární panely, u NISARu rameno a velká anténa na levé straně.
      // Staví se JEDNOU a pak se jen posouvá (modelMatrix) – dřív se přestavoval každý snímek a obraz se sekal.
      const gold = C.Color.fromCssColorString("#dcae3f"), blue = C.Color.fromCssColorString("#2b4fa8"), vf = C.PerInstanceColorAppearance.VERTEX_FORMAT;
      const at = (f, l, u) => C.Matrix4.fromTranslation(new C.Cartesian3(f * SCALE, l * SCALE, u * SCALE));
      const box = (f, l, u, x, y, z, color) => new C.GeometryInstance({ geometry: C.BoxGeometry.fromDimensions({ dimensions: new C.Cartesian3(x * SCALE, y * SCALE, z * SCALE), vertexFormat: vf }), modelMatrix: at(f, l, u), attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(color) } });
      const inst = [box(0, 0, 0, 2.6, 1.8, 1.8, gold)];
      if (nisar) {
        inst.push(box(4.2, 0, 0, 5, 2.4, 0.12, blue), box(-4.2, 0, 0, 5, 2.4, 0.12, blue), box(0, 5, 0.4, 0.3, 8.5, 0.3, C.Color.LIGHTGRAY));
        inst.push(new C.GeometryInstance({ geometry: new C.EllipsoidGeometry({ radii: new C.Cartesian3(6 * SCALE, 6 * SCALE, 0.9 * SCALE), vertexFormat: vf, stackPartitions: 16, slicePartitions: 24 }), modelMatrix: at(0, 11, -0.6), attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(C.Color.fromCssColorString("#e8c766")) } }));
      } else inst.push(box(0, 4.6, 0, 2.2, 6, 0.12, blue), box(0, -4.6, 0, 2.2, 6, 0.12, blue));
      s._model = viewer.scene.primitives.add(new C.Primitive({ geometryInstances: inst, appearance: new C.PerInstanceColorAppearance({ closed: true, translucent: false }), asynchronous: false }));
      // šipka směru letu a dráha (plná = posledních 50 minut, čárkovaná = dalších 50) – čáry v jedné společné sadě
      s._arrow = lines.add({ width: 10, material: C.Material.fromType("PolylineArrow", { color: col }) });
      s._pastL = lines.add({ width: nisar ? 2.5 : 1.6, material: C.Material.fromType("Color", { color: col.withAlpha(0.8) }) });
      s._futL = lines.add({ width: nisar ? 2 : 1.3, material: C.Material.fromType("PolylineDash", { color: col.withAlpha(0.6), dashLength: 14 }) });
    }
    // Paprsek radaru NISAR: vějíř paprsků od družice k pruhu na zemi + jasná čára, kde paprsek dopadá
    const n = sats[0], RAYS = 9, ground = (S, k) => { const e = S.p.edges, a = k / (RAYS - 1); return cart(e[0][0] + (e[1][0] - e[0][0]) * a, e[0][1] + (e[1][1] - e[0][1]) * a); };
    const rays = Array.from({ length: RAYS }, (_, k) => lines.add({ width: k === 0 || k === RAYS - 1 ? 3 : 1.5, material: C.Material.fromType("PolylineGlow", { color: C.Color.fromCssColorString("#ffe9a8").withAlpha(k === 0 || k === RAYS - 1 ? 0.9 : 0.45), glowPower: 0.25 }) }));
    const base = lines.add({ width: 6, material: C.Material.fromType("Color", { color: C.Color.fromCssColorString("#fff3c0") }) });
    // Každý snímek se jen posunou hotové modely a čáry
    viewer.scene.preUpdate.addEventListener(() => {
      for (const s of sats) {
        const S = st(s); if (!S) continue;
        s._model.modelMatrix = frame(S);
        s._arrow.positions = [offset(S, 2, 0, 0), offset(S, 14, 0, 0)];
      }
      const S = st(n);
      if (S?.p.edges) { rays.forEach((r, k) => { r.positions = [S.pos, ground(S, k)]; }); base.positions = [ground(S, 0), ground(S, RAYS - 1)]; }
    });
    swath = viewer.entities.add({ polygon: { hierarchy: new C.PolygonHierarchy([]), material: C.Color.fromCssColorString("#e9b949").withAlpha(0.35), height: 0 } });

    viewer.clock.onTick.addEventListener(() => {
      follow();
      const real = performance.now();
      if (real - lastSlow < (viewer.clock.multiplier > 1 ? 400 : 3000)) return;
      lastSlow = real;
      const t = +now();
      for (const s of sats) {
        const past = [], future = [];
        for (let dt = -3000; dt <= 3000; dt += 60) { const p = Sats.sub(s, new Date(t + dt * 1000)); if (!p) continue; const c = cart(p.lng, p.lat, p.alt); (dt <= 0 ? past : future).push(c); if (dt === 0) future.push(c); }
        if (past.length > 1) s._pastL.positions = past;
        if (future.length > 1) s._futL.positions = future;
      }
      const nearE = [], farE = [];
      for (let dt = -12 * 60; dt <= 0; dt += 30) { const p = Sats.at(n, new Date(t + dt * 1000)); if (p?.edges) { nearE.push(cart(p.edges[0][0], p.edges[0][1])); farE.push(cart(p.edges[1][0], p.edges[1][1])); } }
      swath.polygon.hierarchy = new C.PolygonHierarchy(nearE.concat(farE.reverse()));
      el("#g3d-text").innerHTML = describe(new Date(t));
    });
    whole(0);
  }

  // Popis vybrané družice: kde je, jak vysoko a kam letí
  const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  function describe(date) {
    const sim = viewer.clock.multiplier > 1 ? viewer.clock.multiplier : 0;
    if (sel === sats[0]) return Globe.describeAt(date, sim);
    const p = Sats.at(sel, date); if (!p) return "";
    const v = satellite.propagate(sel.rec, date).velocity, kms = v ? Math.hypot(v.x, v.y, v.z) : null;
    return `${sim ? `<b class="sim">Simulated time ×${sim}: ${date.toISOString().slice(0, 16).replace("T", " ")} UTC (not live)</b><br>` : ""}<b>${sel.name}</b> is over ${Math.abs(p.lat).toFixed(1)}°${p.lat >= 0 ? "N" : "S"} ${Math.abs(p.lng).toFixed(1)}°${p.lng >= 0 ? "E" : "W"}, ${Math.round(p.alt)} km up, flying ${COMPASS[Math.round((((p.head % 360) + 360) % 360) / 45) % 8]}${kms ? ` at ${kms.toFixed(1)} km/s` : ""}. ${sel.role}.`;
  }

  // Pohledy kamery. „Vedle družice“ = kamera letí s družicí (myší jde kolem ní kroužit a přibližovat);
  // „ze země“ = kamera stojí na zemi a otáčí se za družicí, dokud je nad obzorem.
  const frame = (S) => C.Matrix4.fromRotationTranslation(new C.Matrix3(S.fwd.x, S.left.x, S.up.x, S.fwd.y, S.left.y, S.up.y, S.fwd.z, S.left.z, S.up.z), S.pos);
  function free() { track = null; spot = null; viewer.trackedEntity = undefined; viewer.camera.lookAtTransform(C.Matrix4.IDENTITY); }
  function whole(sec = 1.5) {
    free();
    const S = st(sel); if (!S) return;
    // kamera na levé straně dráhy (u NISARu strana, kam se dívá radar), aby byla družice vidět z boku
    const c = C.Cartesian3.add(C.Cartesian3.multiplyByScalar(S.up, 0.55, new C.Cartesian3()), C.Cartesian3.multiplyByScalar(S.left, 0.83, new C.Cartesian3()), new C.Cartesian3());
    viewer.camera.flyTo({ destination: C.Cartesian3.multiplyByScalar(C.Cartesian3.normalize(c, c), 2.6e7, new C.Cartesian3()), duration: sec });
  }
  function beside() {
    free();
    const S = st(sel); if (!S) return;
    track = sel;
    viewer.camera.lookAtTransform(frame(S), new C.Cartesian3(-9.5e5, -4.5e5, 2.6e5)); // za družicí, vpravo od ní a kousek nad ní
  }
  // Místo na zemi, odkud se díváme: u NISARu pod paprskem radaru, jinak 350 km za bodem pod družicí
  function groundSpot(S) {
    if (sel === sats[0] && S.p.edges) { const e = S.p.edges; return cart((e[0][0] + e[1][0]) / 2, (e[0][1] + e[1][1]) / 2, 6); }
    const g = C.Cartographic.fromCartesian(C.Cartesian3.subtract(S.pos, C.Cartesian3.multiplyByScalar(S.fwd, 3.5e5, new C.Cartesian3()), new C.Cartesian3()));
    return C.Cartesian3.fromRadians(g.longitude, g.latitude, 6000);
  }
  function below() {
    free();
    const S = st(sel); if (!S) return;
    spot = groundSpot(S);
    follow();
  }
  // Každý snímek: kamera se drží vybrané družice
  function follow() {
    const S = (track || spot) && st(sel);
    if (!S) return;
    if (track) { // posunout vztažnou soustavu s družicí a zachovat polohu kamery vůči ní (jinak by družice kameře uletěla)
      const cam = viewer.camera, p = C.Cartesian3.clone(cam.position), d = C.Cartesian3.clone(cam.direction), u = C.Cartesian3.clone(cam.up);
      cam.lookAtTransform(frame(S));
      C.Cartesian3.clone(p, cam.position); C.Cartesian3.clone(d, cam.direction); C.Cartesian3.clone(u, cam.up); C.Cartesian3.cross(d, u, cam.right);
      return;
    }
    const up = C.Cartesian3.normalize(spot, new C.Cartesian3());
    let dir = C.Cartesian3.normalize(C.Cartesian3.subtract(S.pos, spot, new C.Cartesian3()), new C.Cartesian3());
    if (C.Cartesian3.dot(dir, up) < 0.14) { // družice klesla k obzoru (pod 8°) → přesunout se pod ni
      spot = groundSpot(S);
      dir = C.Cartesian3.normalize(C.Cartesian3.subtract(S.pos, spot, new C.Cartesian3()), new C.Cartesian3());
    }
    const right = C.Cartesian3.normalize(C.Cartesian3.cross(dir, C.Cartesian3.normalize(spot, new C.Cartesian3()), new C.Cartesian3()), new C.Cartesian3());
    viewer.camera.setView({ destination: spot, orientation: { direction: dir, up: C.Cartesian3.cross(right, dir, new C.Cartesian3()) } });
  }
  function pick(id) {
    sel = sats.find((x) => x.id === id) || sats[0];
    document.querySelectorAll("[data-sat3]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.sat3 === sel.id));
    el("#g3d-beside").textContent = `Fly beside ${sel.name}`;
    el("#g3d-text").innerHTML = describe(now());
    beside();
  }
  function aim(dest, target, upHint, sec) {
    const dir = C.Cartesian3.normalize(C.Cartesian3.subtract(target, dest, new C.Cartesian3()), new C.Cartesian3());
    const right = C.Cartesian3.normalize(C.Cartesian3.cross(dir, upHint, new C.Cartesian3()), new C.Cartesian3()), up = C.Cartesian3.cross(right, dir, new C.Cartesian3());
    viewer.camera.flyTo({ destination: dest, orientation: { direction: dir, up }, duration: sec });
  }

  // Na tabletu se po dobu 3D pohledu uvolní grafická paměť ploché mapy pod ním; při zavření se obnoví
  function releaseMap(release) {
    return; // vypnuto: příčinou pádů bylo hromadné načítání dlaždic, ne paměť mapy; ponecháno jen pro případ potřeby
    if (!LIGHT || typeof map === "undefined") return;
    try {
      if (release && !mapLost) { mapLost = map.painter.context.gl.getExtension("WEBGL_lose_context"); mapLost?.loseContext(); }
      else if (!release && mapLost) { mapLost.restoreContext(); mapLost = null; setTimeout(() => map.triggerRepaint(), 300); }
    } catch { mapLost = null; }
  }

  async function show() {
    const box = el("#g3d");
    releaseMap(true);
    box.hidden = false; open = true;
    box.style.top = el(".top").offsetHeight + "px";
    el("#globe-btn").setAttribute("aria-expanded", "true");
    if (!viewer) {
      el("#g3d-text").textContent = "Loading the 3D Earth…";
      try { await loadLib(); await Sats.load(); C = window.Cesium; build(); }
      catch (e) { box.hidden = true; open = false; el("#globe-btn").setAttribute("aria-expanded", "false"); releaseMap(false); throw e; }
    } else { viewer.clock.currentTime = C.JulianDate.now(); viewer.clock.multiplier = 1; viewer.useDefaultRenderLoop = true; whole(0); }
    el("#g3d-beside").textContent = `Fly beside ${sel.name}`;
    el("#g3d-fast").setAttribute("aria-pressed", "false"); el("#g3d-fast").textContent = "Speed up time ×300";
    el("#g3d-close").focus();
  }
  function hide() {
    open = false; el("#g3d").hidden = true; el("#globe-btn").setAttribute("aria-expanded", "false");
    if (viewer) viewer.useDefaultRenderLoop = false; // nekreslit, když není vidět
    releaseMap(false);
  }
  const toggle = () => (open ? (hide(), Promise.resolve()) : show());

  function bind() {
    el("#g3d-close").onclick = hide;
    el("#g3d-whole").onclick = () => whole();
    el("#g3d-beside").onclick = beside;
    el("#g3d-sats").onclick = (e) => { const b = e.target.closest("[data-sat3]"); if (b) pick(b.dataset.sat3); };
    el("#g3d-below").onclick = below;
    el("#g3d-light").onclick = (e) => { const v = !viewer.scene.globe.enableLighting; viewer.scene.globe.enableLighting = v; e.target.setAttribute("aria-pressed", v); };
    el("#g3d-fast").onclick = (e) => {
      const fast = viewer.clock.multiplier === 1;
      viewer.clock.multiplier = fast ? 300 : 1; if (!fast) viewer.clock.currentTime = C.JulianDate.now();
      e.target.setAttribute("aria-pressed", fast); e.target.textContent = fast ? "Back to live" : "Speed up time ×300"; lastSlow = 0;
    };
    addEventListener("keydown", (e) => { if (e.key === "Escape" && open) hide(); });
  }
  return { toggle, bind, get open() { return open; }, _viewer: () => viewer };
})();
