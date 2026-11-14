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
      // Zblízka prostorový model podle skutečného uspořádání každé družice (zjednodušený, z jednoduchých těles).
      // Staví se JEDNOU a pak se jen posouvá (modelMatrix). Osy modelu: x = směr letu, y = vlevo, z = od Země.
      const k = (s._k = s.id === "iss" ? 450 : SCALE), vf = C.PerInstanceColorAppearance.VERTEX_FORMAT, inst = [];
      const hue = (h) => C.ColorGeometryInstanceAttribute.fromColor(C.Color.fromCssColorString(h));
      const place = (f, l, u, rot) => (rot ? C.Matrix4.fromRotationTranslation(rot, new C.Cartesian3(f * k, l * k, u * k)) : C.Matrix4.fromTranslation(new C.Cartesian3(f * k, l * k, u * k)));
      const rx = (deg) => C.Matrix3.fromRotationX(C.Math.toRadians(deg)), ry = (deg) => C.Matrix3.fromRotationY(C.Math.toRadians(deg));
      const box = (f, l, u, x, y, z, color, rot) => inst.push(new C.GeometryInstance({ geometry: C.BoxGeometry.fromDimensions({ dimensions: new C.Cartesian3(x * k, y * k, z * k), vertexFormat: vf }), modelMatrix: place(f, l, u, rot), attributes: { color: hue(color) } }));
      const tube = (f, l, u, len, r, color, rot) => inst.push(new C.GeometryInstance({ geometry: new C.CylinderGeometry({ length: len * k, topRadius: r * k, bottomRadius: r * k, slices: 14, vertexFormat: vf }), modelMatrix: place(f, l, u, rot), attributes: { color: hue(color) } }));
      const dish = (f, l, u, r, thick, color, rot) => inst.push(new C.GeometryInstance({ geometry: new C.EllipsoidGeometry({ radii: new C.Cartesian3(r * k, r * k, thick * k), vertexFormat: vf, stackPartitions: 12, slicePartitions: 20 }), modelMatrix: place(f, l, u, rot), attributes: { color: hue(color) } }));
      const GOLD = "#dcae3f", BLUE = "#2b4fa8", GREY = "#c9ced6", WHITE = "#f2f4f7", DARK = "#3b4250", ALONG = ry(90), ACROSS = rx(90); // válec podél letu / napříč
      s._len = 3; // polovina délky modelu ve směru letu (m), kvůli šipce
      if (s.id === "nisar") { // tělo, dva solární panely, 9m rameno a 12m síťová anténa vlevo (radar se dívá vlevo)
        box(0, 0, 0, 2.6, 1.8, 1.8, GOLD); box(4.2, 0, 0, 5, 2.4, 0.12, BLUE); box(-4.2, 0, 0, 5, 2.4, 0.12, BLUE);
        box(0, 5, 0.4, 0.3, 8.5, 0.3, GREY); dish(0, 11, -0.6, 6, 0.9, "#e8c766"); box(0, 1.6, -1.2, 1.6, 1.2, 0.6, WHITE); s._len = 7;
      } else if (s.id === "iss") { // 109m příčný nosník, osm křídel solárních panelů, moduly podél směru letu, radiátory
        box(0, 0, 0, 2.5, 96, 2.5, GREY);
        for (const y of [-44, -30, 30, 44]) for (const x of [-20, 20]) box(x, y, 0, 34, 11.5, 0.25, "#c9822b");
        tube(4, 0, -4, 46, 2.2, WHITE, ALONG); tube(-26, 0, -4, 13, 2.1, GREY, ALONG);
        tube(22, 0, -4, 24, 2.2, WHITE, ACROSS); tube(8, 0, -8.5, 7, 2.1, WHITE);
        box(-9, 10, -2, 13, 3.4, 0.2, WHITE, rx(55)); box(-9, -10, -2, 13, 3.4, 0.2, WHITE, rx(-55)); s._len = 38;
      } else if (s.id === "swot") { // dvě radarové antény na koncích 10m stožáru napříč letu, solární křídla vpředu a vzadu
        box(0, 0, 0.4, 2.2, 2.2, 3, GOLD); box(0, 0, -1.6, 0.25, 10, 0.25, GREY);
        box(0, 5, -1.6, 5, 0.25, 1.3, WHITE, rx(-20)); box(0, -5, -1.6, 5, 0.25, 1.3, WHITE, rx(20));
        box(5.2, 0, 1, 7.5, 2.6, 0.1, BLUE); box(-5.2, 0, 1, 7.5, 2.6, 0.1, BLUE); s._len = 9;
      } else if (s.id === "landsat9") { // jedno dlouhé solární křídlo na jedné straně, bílý přístroj dole
        box(0, 0, 0, 3.2, 2.4, 2.4, GOLD); box(0.4, 0, -1.7, 1.8, 1.6, 1, WHITE); box(0, 2.2, 0.4, 0.2, 2, 0.2, GREY); box(0, 7.6, 0.4, 2.6, 9, 0.1, BLUE); tube(-1.2, -0.8, 1.9, 1.4, 0.12, GREY); dish(-1.2, -0.8, 2.7, 0.7, 0.2, WHITE);
      } else if (s.id === "sentinel1a") { // 12m plochá radarová anténa podél letu a dvě solární křídla napříč
        box(0, 0, 0, 3.4, 2.4, 2.4, GOLD); box(0, 1.5, -1.3, 12.3, 0.25, 0.9, WHITE, rx(-25)); box(0, 7.4, 0.6, 2, 10, 0.1, BLUE); box(0, -7.4, 0.6, 2, 10, 0.1, BLUE); s._len = 6.5;
      } else if (s.id === "sentinel6") { // tvar „domečku“: solární panely tvoří šikmou střechu
        box(0, 0, -0.5, 5.1, 2.3, 1.2, GOLD); box(0, 0.75, 0.55, 5.1, 2.1, 0.1, BLUE, rx(38)); box(0, -0.75, 0.55, 5.1, 2.1, 0.1, BLUE, rx(-38)); dish(1.4, 0, -1.4, 0.6, 0.25, WHITE); box(-2.9, 0, -0.3, 0.7, 0.9, 0.9, DARK);
      } else if (s.id === "terra") { // velké autobusové tělo, jedno solární křídlo, anténa na stožáru
        box(0, 0, 0, 6.8, 3.5, 3.5, GOLD); box(0, 2.6, 0.8, 0.25, 1.8, 0.25, GREY); box(0, 8.2, 0.8, 5, 9.5, 0.1, BLUE); tube(2, -0.6, 2.8, 2.2, 0.12, GREY); dish(2, -0.6, 4, 0.9, 0.25, WHITE); box(-1, 0, -2.1, 3, 2, 0.8, WHITE); s._len = 4;
      } else { // NOAA-20 a Suomi NPP (stejná stavba): podlouhlé tělo, jedno solární křídlo, přístroje dole
        box(0, 0, 0, 4.4, 2.2, 2.2, s.id === "snpp" ? "#b9bec7" : GOLD); box(0, 2, 0.5, 0.2, 1.8, 0.2, GREY); box(0, 6.6, 0.5, 3.2, 8, 0.1, BLUE, rx(12)); box(0.8, 0, -1.5, 1.6, 1.4, 0.8, WHITE); box(-1.2, 0, -1.4, 1, 1, 0.6, DARK);
      }
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
        const a0 = (s._len * s._k + 9000) / SCALE; // šipka začíná před přídí modelu
        s._arrow.positions = [offset(S, a0, 0, 0), offset(S, a0 + 11, 0, 0)];
      }
      const S = st(n);
      if (S?.p.edges) { rays.forEach((r, k) => { r.positions = [S.pos, ground(S, k)]; }); base.positions = [ground(S, 0), ground(S, RAYS - 1)]; }
    });
    swath = viewer.entities.add({ polygon: { hierarchy: new C.PolygonHierarchy([]), material: C.Color.fromCssColorString("#e9b949").withAlpha(0.35), height: 0 } });

    // Ťuknutí na zeměkouli načte radarový snímek toho místa (stejně jako klik na ploché mapě).
    // Rozlišení gest: krátké ťuknutí bez pohybu = načíst; tažení = otáčet Zemí; dlouhé podržení = nic.
    // LEFT_CLICK vyvolá knihovna jen tehdy, když se ukazatel mezi stiskem a puštěním nepohnul (myš i jeden prst);
    // při dvou prstech (přiblížení) se nevyvolá vůbec. Délku stisku hlídáme sami.
    viewer.screenSpaceEventHandler.removeInputAction(C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK); // dvojklik jinak „chytá“ družice
    const taps = new C.ScreenSpaceEventHandler(viewer.scene.canvas);
    // Délka stisku se měří z časových značek samotných událostí (kdy se prst opravdu dotkl a zvedl), ne podle toho,
    // kdy na ně program stihl zareagovat: na pomalém zařízení by jinak rychlé ťuknutí vypadalo jako podržení.
    let downT = 0, upT = 0, lastTap = 0;
    const holder = el("#g3d-view");
    for (const k of ["pointerdown", "mousedown", "touchstart"]) holder.addEventListener(k, (e) => { downT = e.timeStamp; }, true);
    for (const k of ["pointerup", "mouseup", "touchend"]) holder.addEventListener(k, (e) => { upT = e.timeStamp; }, true);
    taps.setInputAction((e) => {
      const t = performance.now();
      if (upT - downT > 500 || t - lastTap < 700) return; // podržení, nebo druhé ťuknutí dvojkliku
      const c = viewer.camera.pickEllipsoid(e.position, viewer.scene.globe.ellipsoid);
      if (!c) return; // ťuknutí vedle Země
      lastTap = t;
      const g = C.Cartographic.fromCartesian(c);
      radarAt({ lng: C.Math.toDegrees(g.longitude), lat: C.Math.toDegrees(g.latitude) });
    }, C.ScreenSpaceEventType.LEFT_CLICK);

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

  // --- Radarový snímek místa, na které uživatel ťukl -------------------------------------------------------------
  // Dotaz do archivu i stažení snímku jsou stejné jako v živém režimu na ploché mapě (Live.search, Live.loadPass);
  // snímek se položí na zeměkouli jako další vrstva povrchu.
  const radar = { rq: 0, layer: null, mark: null, passes: [], ll: null };
  const fmtLL = (ll) => `${Math.abs(ll.lat).toFixed(2)}°${ll.lat >= 0 ? "N" : "S"}, ${Math.abs(ll.lng).toFixed(2)}°${ll.lng >= 0 ? "E" : "W"}`;
  async function radarAt(ll) {
    const id = ++radar.rq, box = el("#g3d-radar"), head = `<h3>Radar image of ${fmtLL(ll)}</h3>`;
    radar.ll = ll;
    const pos = cart(ll.lng, ll.lat, 3);
    if (radar.mark) radar.mark.position = pos;
    else radar.mark = viewer.entities.add({ position: pos, point: { pixelSize: 13, color: C.Color.fromCssColorString("#e9b949").withAlpha(0.25), outlineColor: C.Color.fromCssColorString("#e9b949"), outlineWidth: 3, disableDepthTestDistance: 2e6 } });
    box.hidden = false;
    box.innerHTML = head + `<p class="status">Asking NASA's archive for NISAR passes over this spot…</p>`;
    const found = await Live.search(ll);
    if (id !== radar.rq) return;
    if (!found) { box.innerHTML = head + `<p class="status">The archive did not answer. Tap again in a moment.</p>`; return; }
    if (!found.passes.length) { box.innerHTML = head + `<p class="status">No NISAR image of this spot in the archive yet. NISAR mostly maps land and ice; open ocean is rarely imaged. Tap a place on land.</p>`; return; }
    radar.passes = found.passes.slice(0, 8);
    box.innerHTML = head + `<p>${found.count} NISAR radar products cover this spot. Newest: <b>${radar.passes[0].startTime.slice(0, 10)}</b>.</p>
      <div class="passes" role="group" aria-label="Radar passes, newest first">${radar.passes.map((p, i) => `<button data-r3="${i}" aria-pressed="false">${p.startTime.slice(0, 10)}</button>`).join("")}</div>
      <p class="status" id="g3d-radar-status" role="status"></p>
      <div class="tools"><button data-r3="flat">Compare passes on the flat map</button><button data-r3="clear">Remove image</button></div>`;
    radarShow(0, true);
  }
  async function radarShow(i, fly) {
    const id = ++radar.rq, p = radar.passes[i], st = el("#g3d-radar-status"), day = p.startTime.slice(0, 10);
    document.querySelectorAll("#g3d-radar [data-r3]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.r3 === String(i)));
    st.textContent = `Loading the radar image of ${day} from NASA…`;
    try {
      const A = await Loader.during(`Loading the radar image of ${day} from NASA…`, (progress) => Live.loadPass(p, progress));
      if (id !== radar.rq) return;
      const provider = await C.SingleTileImageryProvider.fromUrl(Live.clean(A).toDataURL("image/png"), { rectangle: C.Rectangle.fromDegrees(A.w, A.s, A.e, A.n), credit: "NISAR quick-look image, NASA ASF DAAC" });
      if (id !== radar.rq) return;
      const layer = viewer.imageryLayers.addImageryProvider(provider);
      if (radar.layer) viewer.imageryLayers.remove(radar.layer, true);
      radar.layer = layer;
      if (fly) { // přiletět nad snímek tak, aby byl celý vidět
        free();
        const padX = (A.e - A.w) * 0.6, padY = (A.n - A.s) * 0.6;
        viewer.camera.flyTo({ destination: C.Rectangle.fromDegrees(A.w - padX, Math.max(-89, A.s - padY), A.e + padX, Math.min(89, A.n + padY)), duration: 1.6 });
      }
      st.textContent = `NISAR radar image, ${p.startTime.slice(0, 16).replace("T", " ")} UTC · track ${p.path}, ${p.flightDirection.toLowerCase()} · quick-look image from NASA ASF DAAC${A.approx ? " · placed approximately (provisional product)" : ""}. Brighter means a stronger radar echo; water and smooth ground are dark.`;
    } catch (e) {
      if (id === radar.rq) st.textContent = "This radar image could not be loaded. Try another date.";
    }
  }
  function radarClear() {
    radar.rq++;
    if (radar.layer) { viewer.imageryLayers.remove(radar.layer, true); radar.layer = null; }
    if (radar.mark) { viewer.entities.remove(radar.mark); radar.mark = null; }
    el("#g3d-radar").hidden = true;
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
      const done = Loader.show("Loading the 3D Earth…");
      try { await loadLib(); await Sats.load(); C = window.Cesium; build(); done(); }
      catch (e) { done(); box.hidden = true; open = false; el("#globe-btn").setAttribute("aria-expanded", "false"); releaseMap(false); throw e; }
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
    el("#g3d-radar").onclick = (e) => {
      const b = e.target.closest("[data-r3]"); if (!b) return;
      if (b.dataset.r3 === "clear") radarClear();
      else if (b.dataset.r3 === "flat") { const ll = radar.ll; hide(); goLive(`${ll.lng.toFixed(3)},${ll.lat.toFixed(3)}`); } // plochá mapa umí porovnání a časosběr
      else radarShow(+b.dataset.r3, false);
    };
    el("#g3d-light").onclick = (e) => { const v = !viewer.scene.globe.enableLighting; viewer.scene.globe.enableLighting = v; e.target.setAttribute("aria-pressed", v); };
    el("#g3d-fast").onclick = (e) => {
      const fast = viewer.clock.multiplier === 1;
      viewer.clock.multiplier = fast ? 300 : 1; if (!fast) viewer.clock.currentTime = C.JulianDate.now();
      e.target.setAttribute("aria-pressed", fast); e.target.textContent = fast ? "Back to live" : "Speed up time ×300"; lastSlow = 0;
    };
    addEventListener("keydown", (e) => { if (e.key === "Escape" && open) hide(); });
  }
  return { toggle, bind, get open() { return open; }, _viewer: () => viewer, _radar: () => radar };
})();
