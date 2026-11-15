"""The walkthrough itself: what is clicked, in which order, and what the captions say. Run through video/walk.py.
The final video is one continuous take of all ten chapters (python video/walk.py all). `setup` only matters when a
chapter is tried on its own: it jumps to the state in which the previous chapter would have left the app.
Captions are kept short (at most about 16 characters per second on screen) so that an audience can read them."""
CHAPTERS = {}
def chapter(name, title, setup=None):
    def deco(fn):
        CHAPTERS[name] = (title, setup, fn); return fn
    return deco


async def _site(R, sid, layer=None):
    await R.js(f"loadSite('{sid}')"); await R.wait(3.5); await R.js("window.stop && stop()")
    if layer: await R.js(f"document.querySelector('[data-layer={layer}]').click()")
    await R.idle()

async def _off(R, sel):
    """Switch a toggle button off if it is on."""
    if await R.pressed(sel): await R.click(sel)

async def _menu(R, theme, go, look=()):
    """Open one of the two theme menus at the top, look at a few entries, pick one."""
    await R.click(f"[data-theme='{theme}']", after=0.6)
    for sel in look: await R.hover(sel, after=0.35)
    await R.click(f"[data-go='{go}']", after=0.4)

# Where NISAR's radar strip was three minutes ago, as [lng, lat] (`ahead` = seconds from now, for planning the take)
STRIP = """(async (ahead) => { await Sats.load(); const n = Sats.all().find((x) => x.id === 'nisar'); if (!n) return null;
  const p = Sats.at(n, new Date(Date.now() + ahead * 1000 - 180000)); if (!p || !p.edges || Math.abs(p.edges[0][0] - p.edges[1][0]) > 90) return null;
  return [(p.edges[0][0] + p.edges[1][0]) / 2, (p.edges[0][1] + p.edges[1][1]) / 2]; })"""

async def preroll(R, lead):
    """Before the recording starts: wait until NISAR's strip will lie on the world map at the moment the Live world chapter
    clicks inside it (`lead` seconds from now). NISAR spends part of every orbit over the poles, where the flat map ends."""
    for k in range(120):
        p = await R.js(f"{STRIP}({lead})")
        if p and -38 <= p[1] <= 50 and -125 <= p[0] <= 135:
            print(f"  NISAR's strip will be at {p[0]:.0f}°, {p[1]:.0f}° when the Live chapter clicks it" + (f" (waited {k * 20} s)" if k else ""), flush=True); return
        if k == 0: print(f"  waiting for NISAR to come back over the map (its strip would be at {p})…", flush=True)
        await R.wait(20)


# ------------------------------------------------------------------------------------------------ 1
@chapter("start", "Start")
async def start(R):
    await R.sub("<b>Dancing Earth</b>: see and hear how Earth's surface changes, with NISAR radar.")
    await R.move(640, 330, 1.0); await R.wait(3.2)
    await R.sub("A welcome card explains the app. We will explore on our own.")
    await R.hover("#intro-play", after=0.45); await R.hover("#intro-live", after=0.45)
    await R.click("#intro-close", after=0.7)
    await R.js("window.stop && stop()")
    await R.sub("<b>Tonlé Sap</b>, a lake in Cambodia. Each step of the slider is one pass of the NISAR satellite.")
    k = await R.js("state.data.frames.findIndex((f) => f.date === '2026-09-23')"); n = await R.js("state.data.frames.length")
    await R.wait(0.8); await R.slider("#frame", k / (n - 1), 1.4); await R.wait(1.0)
    await R.sub("Why radar? <b>Optical</b> shows a camera photo of the same day: only clouds.")
    await R.click("[data-layer=optical]", after=0.4); await R.idle(); await R.move(430, 420, 0.7); await R.wait(1.8)
    await R.sub("The <b>radar</b> looks straight through them. Drag the line to compare.")
    await R.slider("#split", 0.22, 0.9); await R.slider("#split", 0.8, 1.0); await R.wait(0.3)


# ------------------------------------------------------------------------------------------------ 2
async def _lake_setup(R):
    await _site(R, "tonle-sap", "optical"); await R.js("show(state.data.frames.findIndex((f) => f.date === '2026-09-23'), false)"); await R.idle()

@chapter("lake", "A lake that breathes", _lake_setup)
async def lake(R):
    await R.sub("<b>HH</b> and <b>HV</b> are two radar channels. Water is dark; rough ground and plants are bright.")
    await _off(R, "#compare")
    await R.click("[data-layer=hh]", after=1.0); await R.click("[data-layer=hv]", after=1.2)
    await R.sub("<b>Change</b> colours what differs from the first pass. Blue is new open water.")
    await R.click("[data-layer=change]", after=0.5); await R.slider("#frame", 0, 1.1); await R.wait(0.3)
    await R.sub("<b>Play</b> steps through eleven passes. Each one plays its image as <b>music</b>: brighter is higher, more change is louder.")
    await R.click("#play", after=0.3); await R.move(560, 440, 0.9)
    await R.until("state.i >= state.data.frames.length - 3", 14); await R.hover("#play", after=0.1)
    await R.until("state.i === state.data.frames.length - 1", 6); await R.click("#play", dur=0.05, after=0.4)
    if await R.js("state.i !== state.data.frames.length - 1"): await R.slider("#frame", 1, 0.8)
    await R.sub("The panel says what happened in plain words, with the key numbers.")
    await R.hover("#insight", after=1.7); await R.hover("#kpis", after=1.5)
    await R.sub("Click <b>any spot</b>: the chart switches to that place and shows when it was water or dry.")
    await R.click((330, 455), after=0.6); await R.scroll(330, at=(1400, 520), dur=0.8); await R.wait(1.1)
    await R.scroll(-330, dur=0.5)
    await R.sub("<b>Under plants</b> hints at water standing under trees or rice. A hint, not a flood map.")
    await R.click("#fv", after=0.5); await R.idle(); await R.move(900, 330, 0.8); await R.wait(1.4)
    await R.click("#fv", after=0.2)
    await R.sub("<b>Charts</b> put both lakes in one picture: Tonlé Sap fills while Poyang Lake in China empties.")
    await R.click("[data-tabbtn=charts]", after=0.7); await R.hover("#charts .svgwrap", after=2.5)
    await R.click("[data-tabbtn=explore]", after=0.2)


# ------------------------------------------------------------------------------------------------ 3
async def _fire_setup(R): await _site(R, "tonle-sap", "change")

@chapter("fire", "A wildfire", _fire_setup)
async def fire(R):
    await R.sub("The menu groups places by what happened: floods, fires, hurricanes.")
    await _menu(R, 0, "site:shingle")
    await R.until("state.site === 'shingle' && !!map.getLayer('sar')", 15); await R.idle(0.5)
    await R.sub("<b>Shingle Fire</b>, Oregon. Red: the radar's vegetation signal dropped. Dashed: the official fire line.")
    await R.move(760, 450, 0.9); await R.wait(4.9)
    await R.sub("The radar map was drawn without that line, yet <b>96%</b> of the red area lies inside it.")
    await R.hover("#kpis", after=4.5)
    await R.sub("<b>Play the story</b>. 23 July: a satellite sees the first heat. Nothing is red yet.")
    await R.reveal("#fire-story"); await R.click("#fire-story", after=0.5); await R.move(700, 420, 0.8); await R.wait(2.2)
    await R.sub("Two days later, the worst day: 2,136 heat detections.")
    await R.click("[data-story='1']", after=0.4); await R.move(820, 400, 0.7); await R.wait(1.8)
    await R.sub("Four weeks on, the heat is gone and radar shows the scar. Drag the line: before and after.")
    await R.click("[data-story='2']", after=0.8); await R.idle(0.3)
    await R.slider("#split", 0.3, 1.4); await R.wait(1.0)
    await R.click("[data-story='close']", after=0.3)


# ------------------------------------------------------------------------------------------------ 4
async def _charts_setup(R): await _site(R, "shingle", "change")

@chapter("charts", "Charts", _charts_setup)
async def charts(R):
    await R.sub("<b>Charts</b>: heat per day against the scar seen by radar. Hollow point: a pass marked unreliable.")
    await _off(R, "#compare")
    await R.click("[data-tabbtn=charts]", after=0.8); await R.hover("#charts .svgwrap", after=2.6)
    await R.sub("Click a chart to jump to that date. Save any chart as an image.")
    box = await R.page.locator("#charts .svgwrap").first.bounding_box()
    await R.click((box["x"] + box["width"] * 0.47, box["y"] + box["height"] * 0.6), after=0.9)
    await R.click((box["x"] + box["width"] * 0.80, box["y"] + box["height"] * 0.5), after=0.7)
    await R.reveal("#charts [data-png='0']"); await R.click("#charts [data-png='0']", after=0.7)


# ------------------------------------------------------------------------------------------------ 5
async def _tools_setup(R):
    await _site(R, "shingle", "change"); await R.js("document.querySelector('[data-tabbtn=charts]').click()")

@chapter("tools", "Tools", _tools_setup)
async def tools(R):
    await R.js("show(state.data.frames.length - 1, false)")
    await R.sub("<b>Tools</b>. <b>Measure an area</b>: click the corners of any shape.")
    await R.click("[data-tabbtn=tools]", after=0.5); await R.click("#t-area", after=0.5)
    for pt in [(640, 470), (770, 425), (885, 515), (790, 612)]: await R.click(pt, dur=0.4, after=0.1)
    await R.click("[data-act='area-done']", after=0.3)
    await R.sub("You get its size, and how much of it changed since before the fire.")
    await R.wait(3.0); await R.click("[data-act='area-clear']", after=0.3)
    await R.sub("<b>Trace a line and listen</b>: drag, and hear the change under the pointer.")
    await R.click("#t-trace", after=0.6)
    await R.drag((520, 300), (900, 580), dur=2.3, after=0.4); await R.wait(0.3)
    if await R.js("!!document.querySelector(\"[data-act='trace-clear']\")"): await R.click("[data-act='trace-clear']", after=0.3)
    await R.sub("<b>What if the wind had been different?</b> A simple model: the fire grows as an ellipse.")
    await R.reveal("#sim-open"); await R.click("#sim-open", after=0.9); await R.reveal("#sim-spd")
    await R.slider("#sim-dir", 0.25, 1.0); await R.wait(0.5)
    await R.sub("With the real wind, 86% of the first day's heat detections fall inside the model's area.")
    await R.click("#sim-reset", after=0.4); await R.move(780, 430, 0.8); await R.wait(2.6)
    await R.reveal("#sim-close"); await R.click("#sim-close", after=0.3)
    await R.sub("Take it with you: a <b>CSV</b> of the numbers and a <b>link</b> to this exact view.")
    await R.reveal("#csv"); await R.hover("#csv", after=0.9); await R.click("#share", after=1.8)
    # The quiz picks one of the places at random, so the pointer answers for whatever place it really shows.
    await R.sub("<b>Quiz</b>: two radar images of one place, before and after. What changed?")
    await R.scroll(-600, at=(1400, 400), dur=0.4); await R.click("#t-quiz", after=0.4)
    await R.until("!!document.querySelector(\"[data-quiz='0']\")", 20); await R.idle(0.2)
    await R.slider("#split", 0.72, 0.9)
    answer = await R.js("({ 'tonle-sap': 0, poyang: 1, rondonia: 3, 'central-valley': 4 })[state.site] ?? 2")
    await R.click(f"[data-quiz='{answer}']", after=0.5)
    ok = await R.js("!!document.querySelector('#quiz h2.ok')")
    await R.sub("Correct! The quiz then turns on the Change layer and explains what you see." if ok else "Not quite. The quiz then turns on the Change layer and explains what you see.")
    await R.wait(3.2)
    if await R.js("!!document.querySelector(\"[data-quiz='close']\")"): await R.click("[data-quiz='close']", after=0.3)


# ------------------------------------------------------------------------------------------------ 6
async def _limit_setup(R): await _site(R, "tonle-sap", "change"); await R.js("document.querySelector('[data-tabbtn=tools]').click()")

@chapter("limit", "Honest limits", _limit_setup)
async def limit(R):
    await R.sub("An honest limit: <b>Big Grass</b> was a grass fire. L-band radar sees woody plants, so it marks under a tenth of the burn area.")
    await _off(R, "#compare")
    await R.click("[data-tabbtn=explore]", after=0.3)
    await _menu(R, 0, "site:big-grass")
    await R.until("state.site === 'big-grass' && !!map.getLayer('sar')", 15); await R.idle(0.4)
    await R.move(700, 430, 0.8); await R.hover("#insight", after=1.9); await R.hover("#kpis", after=1.3)
    await R.sub("<b>About</b> lists the method, thresholds, limits and data sources for each place.")
    await R.click("[data-tabbtn=about]", after=0.5); await R.scroll(700, at=(1400, 520), dur=1.9); await R.wait(0.9)
    await R.scroll(-800, dur=0.5); await R.click("[data-tabbtn=explore]", after=0.2)


# ------------------------------------------------------------------------------------------------ 7
async def _others_setup(R): await _site(R, "big-grass", "change")

@chapter("others", "Forest, fields, hurricanes", _others_setup)
async def others(R):
    await R.sub("<b>Human activity</b>: forest clearing in Brazil, farm fields in California.")
    await _menu(R, 1, "site:rondonia", look=("[data-go='site:central-valley']",))
    await R.until("state.site === 'rondonia' && !!map.getLayer('sar')", 15); await R.idle(0.4)
    await R.sub("<b>Rondônia</b>: blue marks where the forest's radar signal dropped. That can mean clearing, burning or drying.")
    await R.move(600, 300, 0.8); await R.move(700, 470, 1.0); await R.wait(4.5)
    await R.sub("Around it, the background is a NASA Landsat photo from 2000–2001: for orientation only.")
    await R.move(1060, 420, 0.8)
    if await R.js("!document.querySelector('#bgnote').hidden"): await R.hover("#bgnote", after=3.9)
    else: await R.wait(4.1)
    await R.sub("<b>Central Valley</b>, 29 passes in a year: fields change as they are planted and harvested.")
    await _menu(R, 1, "site:central-valley")
    await R.until("state.site === 'central-valley' && !!map.getLayer('sar')", 15); await R.idle(0.3)
    await R.click("#play", after=0.3); await R.move(620, 430, 0.8); await R.wait(1.4); await R.click("#play", after=0.3)
    await R.sub("<b>Hurricanes</b> use NOAA data: the track, how far each wind strength reaches, wave height.")
    await _menu(R, 0, "storm:al092026")
    await R.until("document.body.classList.contains('storm')", 12); await R.wait(0.5)
    await R.click("#st-play", after=0.3); await R.move(650, 420, 0.8); await R.wait(1.9)
    if await R.js("document.querySelector('#st-play').textContent.trim() !== 'Play'"): await R.click("#st-play", after=0.3)


# ------------------------------------------------------------------------------------------------ 8
async def _live_setup(R):   # the chapter before ends on the hurricane
    await R.js("goStorm('al092026')"); await R.wait(5)

IMG_READY = "(() => { const s = document.querySelector('#live-img-status'); return !!s && s.textContent.startsWith('NISAR radar image') && !document.querySelector('.loader:not([hidden])'); })()"
ON_MAP = "(ll) => { const r = document.querySelector('#map').getBoundingClientRect(), q = map.project(ll); return [q.x + r.left, q.y + r.top]; }"

@chapter("live", "Live world", _live_setup)
async def live(R, band=True):
    await R.sub("<b>Live world</b>: events NASA tracks right now, and satellites overhead.")
    await R.click("[data-site=live]", after=0.5); await R.until("document.body.classList.contains('live')", 10); await R.wait(1.0); await R.idle(0.2)
    await R.move(430, 300, 0.9); await R.wait(0.3)
    await R.sub("The yellow band is the strip NISAR's radar is looking at this minute.")
    await R.hover("[data-sat=nisar]", after=2.1); await R.hover("[data-sat=swot]", after=0.7)
    # Click inside the band, three minutes behind the satellite: that pass is not in the archive yet, and the app says so
    ll = await R.js(f"{STRIP}(0)")
    xy = await R.page.evaluate(ON_MAP, ll) if ll else None
    if band and xy and 60 < xy[0] < 1130 and 150 < xy[1] < 700:
        await R.sub("Click inside that band: the app says plainly that today's pass is not in NASA's archive yet.")
        await R.click(tuple(xy), after=0.4)
        await R.until("(() => { const n = document.querySelector('#live-now'); return !!n && !n.hidden && n.textContent.includes('archive right now'); })()", 20)
        await R.reveal("#live-now"); await R.hover("#live-now", after=2.9)
    else:
        if band: print("  (NISAR's strip is not on the map right now: the 'today's pass' moment is left out)", flush=True)
    await R.sub("Click <b>any place on land</b>, here Mount Etna. The app asks NASA's archive…")
    await R.until("!document.querySelector('.loader:not([hidden])')", 30)
    if await R.js("map.getZoom() > 2.6 || map.isMoving()"):   # an older image of that spot was loaded and the map flew to it: back to the whole world
        await R.wait(0.6); await R.click("[data-site=live]", after=0.4); await R.until("map.getZoom() < 2.6 && !map.isMoving()", 10); await R.wait(0.3)
    x, y = await R.page.evaluate(ON_MAP, [14.99, 37.75])
    await R.click((x, y), after=0.5)
    await R.until(IMG_READY, 45); await R.wait(0.4)
    await R.sub("…and loads the newest <b>NISAR image</b>, with earlier passes to flip through.")
    await R.move(560, 430, 0.8); await R.wait(1.7)
    await R.reveal("[data-pass='1']"); await R.hover("[data-pass='1']", after=0.45); await R.hover("[data-pass='2']", after=0.45)
    await R.sub("One button compares two passes, colours the change and plays it.")
    await R.reveal("#live-diff"); await R.click("#live-diff", after=0.5)
    await R.until("!document.querySelector('.loader:not([hidden])') && /Compared/.test(document.querySelector('#live-diff-status').textContent)", 45); await R.move(600, 420, 0.8); await R.wait(1.2)
    await R.sub("Zoom in and the image is reloaded at the full detail of NASA's quick-look.")
    await R.reveal("[data-pass='0']"); await R.click("[data-pass='0']", after=0.3); await R.until(IMG_READY, 30)
    x, y = await R.page.evaluate(ON_MAP, [14.99, 37.75])
    await R.scroll(-850, at=(x - 40, y - 30), dur=1.2)
    await R.until("document.querySelector('#live-img-status').textContent.includes('full quick-look detail')", 10)
    await R.wait(2.0)


# ------------------------------------------------------------------------------------------------ 9
async def _card(R, want):
    """Open or close the 3D view's satellite card (it opens by itself in some situations, so look first)."""
    is_open = await R.js("(() => { const c = document.querySelector('#g3d-card'); return !!c && !c.hidden && c.offsetParent !== null; })()")
    if want and not is_open: await R.click("#g3d-sat-toggle", after=0.3)
    if not want and is_open: await R.click("#g3d-card-close", after=0.2)

async def _globe_setup(R):   # the same clicks as the Live world chapter (without the click inside NISAR's band), so the app is in the same state
    await live(R, band=False)

@chapter("globe", "3D Earth", _globe_setup)
async def globe(R):
    await R.sub("The same app on a <b>3D Earth</b>: same menus, layers and tools, on a globe you can turn.")
    await R.click("#globe-btn", after=0.5); await R.until("!!(window.Globe3D && Globe3D.on && Globe3D._viewer())", 25); await R.wait(0.6)
    await _card(R, False); await R.wait(0.9)
    await R.sub("<b>Satellites</b> at their true height, with live paths behind and ahead.")
    await _card(R, True); await R.click("#g3d-whole", after=0.4); await _card(R, False); await R.wait(0.3)
    await R.drag((470, 420), (600, 405), dur=1.0, after=0.4)
    # How NISAR maps: fly behind and a little above it, so the satellite, its beam, the strip on the ground and the horizon are all in view
    await R.sub("Follow <b>NISAR</b>: its radar beam meets the ground left of its path, in a strip 240 km wide.")
    await _card(R, True); await R.click("[data-sat3='nisar']", after=0.4); await _card(R, False)
    await R.drag((600, 330), (600, 370), dur=0.8, after=0.2)
    for _ in range(3):   # three gentle steps back, with the pointer on the satellite so that it stays in the middle
        await R.scroll(120, at=(600, 430), dur=0.6); await R.wait(0.35)
    await R.move(300, 650, 0.5); await R.wait(0.3)
    print("  camera:", await R.js("(() => { const p = Globe3D._viewer().camera.position; return `${(Math.atan2(p.z, Math.hypot(p.x, p.y)) * 180 / Math.PI).toFixed(0)}° above the satellite's level, ${(Math.hypot(p.x, p.y, p.z) / 1000).toFixed(0)} km from it`; })()"), flush=True)
    await R.sub("Speed time up 300 times: the yellow band is where the radar has just swept. It returns every 12 days.")
    await _card(R, True); await R.click("#g3d-fast", after=0.3); await _card(R, False); await R.wait(3.0)


# ------------------------------------------------------------------------------------------------ 10
async def _end_setup(R):
    await R.js("document.querySelector('#globe-btn').click()"); await R.wait(9)

@chapter("end", "Dancing Earth", _end_setup)
async def end(R):
    await R.sub("<b>Dancing Earth</b> · Team AlgoryX · NASA Space Apps Challenge 2026 · <b>monolyth365-svg.github.io/Dancing-Earth</b>")
    await R.move(330, 600, 1.2); await R.wait(3.8)
