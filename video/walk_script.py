"""The walkthrough itself: what is clicked, in which order, and what the captions say. Run through video/walk.py.
Each chapter is recorded as one continuous take. `setup` only matters when a chapter is re-recorded on its own:
it jumps to the state in which the previous chapter would have left the app.
Captions are kept short (about 15 characters per second on screen) so that an audience can read them."""
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
    for sel in look: await R.hover(sel, after=0.4)
    await R.click(f"[data-go='{go}']", after=0.4)


# ------------------------------------------------------------------------------------------------ 1
@chapter("start", "Start")
async def start(R):
    await R.sub("<b>Dancing Earth</b>: see and hear how Earth's surface changes, with NISAR radar.")
    await R.move(640, 330, 1.0); await R.wait(3.2)
    await R.sub("A welcome card explains the app. We will explore on our own.")
    await R.hover("#intro-play", after=0.45); await R.hover("#intro-live", after=0.45)
    await R.click("#intro-close", after=0.8)
    await R.js("window.stop && stop()")
    await R.sub("<b>Tonlé Sap</b>, a lake in Cambodia. Each step of the slider is one pass of the NISAR satellite.")
    k = await R.js("state.data.frames.findIndex((f) => f.date === '2026-09-23')"); n = await R.js("state.data.frames.length")
    await R.wait(1.2); await R.slider("#frame", k / (n - 1), 1.5); await R.wait(1.6)
    await R.sub("Why radar? <b>Optical</b> shows a camera photo of the same day: only clouds.")
    await R.click("[data-layer=optical]", after=0.4); await R.idle(); await R.move(430, 420, 0.7); await R.wait(2.6)
    await R.sub("The <b>radar</b> looks straight through them. Drag the line to compare.")
    await R.slider("#split", 0.22, 1.1); await R.slider("#split", 0.8, 1.3); await R.wait(0.4)


# ------------------------------------------------------------------------------------------------ 2
async def _lake_setup(R):
    await _site(R, "tonle-sap", "optical"); await R.js("show(state.data.frames.findIndex((f) => f.date === '2026-09-23'), false)"); await R.idle()

@chapter("lake", "A lake that breathes", _lake_setup)
async def lake(R):
    await R.sub("<b>HH</b> and <b>HV</b> are two radar channels. Water is dark; rough ground and plants are bright.")
    await _off(R, "#compare")
    await R.click("[data-layer=hh]", after=1.3); await R.click("[data-layer=hv]", after=1.5)
    await R.sub("<b>Change</b> colours what differs from the first pass. Blue is new open water.")
    await R.click("[data-layer=change]", after=0.7); await R.slider("#frame", 0, 1.1); await R.wait(0.5)
    await R.sub("<b>Play</b> steps through eleven passes. Each one plays its image as <b>music</b>: brighter is higher, more change is louder.")
    await R.click("#play", after=0.3); await R.move(560, 440, 0.9)
    await R.until("state.i >= state.data.frames.length - 3", 14); await R.hover("#play", after=0.1)
    await R.until("state.i === state.data.frames.length - 1", 6); await R.click("#play", dur=0.05, after=0.5)
    if await R.js("state.i !== state.data.frames.length - 1"): await R.slider("#frame", 1, 0.8)
    await R.sub("The panel says what happened in plain words, with key numbers and a chart.")
    await R.hover("#insight", after=1.5); await R.hover("#kpis", after=1.2); await R.hover("#chart", after=0.9)
    await R.sub("Click <b>any spot</b>: the chart switches to that place and shows when it was water or dry.")
    await R.click((330, 455), after=0.8); await R.scroll(330, at=(1400, 520), dur=0.8); await R.wait(1.8)
    await R.scroll(-330, dur=0.5)
    await R.sub("<b>Under plants</b> hints at water standing under trees or rice. A hint, not a flood map.")
    await R.click("#fv", after=0.5); await R.idle(); await R.move(900, 330, 0.8); await R.wait(2.2)
    await R.click("#fv", after=0.3)


# ------------------------------------------------------------------------------------------------ 3
async def _fire_setup(R): await _site(R, "tonle-sap", "change")

@chapter("fire", "A wildfire", _fire_setup)
async def fire(R):
    await R.sub("The menu groups places by what happened: floods, fires, hurricanes.")
    await _menu(R, 0, "site:shingle", look=("[data-go='storm:al092026']",))
    await R.until("state.site === 'shingle' && !!map.getLayer('sar')", 15); await R.idle(0.5)
    await R.sub("<b>Shingle Fire</b>, Oregon. Red: the radar's vegetation signal dropped. Dashed: the official fire line.")
    await R.move(760, 450, 0.9); await R.wait(4.2)
    await R.sub("<b>96%</b> of the loss mapped by radar lies inside that line, which the method never used.")
    await R.hover("#kpis", after=4.4)
    await R.sub("<b>Play the story</b>. 23 July: a satellite sees the first heat. Nothing is red yet.")
    await R.reveal("#fire-story"); await R.click("#fire-story", after=0.5); await R.move(700, 420, 0.8); await R.wait(3.0)
    await R.sub("Two days later, the worst day: 2,136 heat detections.")
    await R.click("[data-story='1']", after=0.4); await R.move(820, 400, 0.7); await R.wait(2.8)
    await R.sub("Four weeks on, the heat is gone and radar shows the scar. Drag the line: before and after.")
    await R.click("[data-story='2']", after=0.8); await R.idle(0.3)
    await R.slider("#split", 0.75, 1.1); await R.slider("#split", 0.35, 1.2); await R.wait(0.5)
    await R.click("[data-story='close']", after=0.4)


# ------------------------------------------------------------------------------------------------ 4
async def _charts_setup(R): await _site(R, "shingle", "change")

@chapter("charts", "Charts", _charts_setup)
async def charts(R):
    await R.sub("<b>Charts</b>: heat per day against the scar seen by radar. Hollow point: a pass marked unreliable.")
    await _off(R, "#compare")
    await R.click("[data-tabbtn=charts]", after=0.8); await R.hover("#charts .svgwrap", after=2.8)
    await R.sub("Click a chart to jump to that date. Save any chart as an image.")
    box = await R.page.locator("#charts .svgwrap").first.bounding_box()
    await R.click((box["x"] + box["width"] * 0.47, box["y"] + box["height"] * 0.6), after=1.2)
    await R.click((box["x"] + box["width"] * 0.80, box["y"] + box["height"] * 0.5), after=1.0)
    await R.reveal("#charts [data-png='0']"); await R.click("#charts [data-png='0']", after=0.7)
    await R.sub("Everywhere: how cloudy a camera's photo was on each radar pass day.")
    await R.scroll(330, at=(1400, 520), dur=1.0); await R.wait(2.8); await R.scroll(-700, dur=0.5)


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
    await R.drag((520, 300), (900, 580), dur=2.6, after=0.5); await R.wait(0.5)
    if await R.js("!!document.querySelector(\"[data-act='trace-clear']\")"): await R.click("[data-act='trace-clear']", after=0.3)
    await R.sub("<b>What if the wind had been different?</b> A simple model: the fire grows as an ellipse.")
    await R.reveal("#sim-open"); await R.click("#sim-open", after=0.9); await R.reveal("#sim-spd")
    await R.slider("#sim-dir", 0.25, 1.0); await R.slider("#sim-spd", 0.8, 0.9); await R.wait(0.4)
    await R.sub("With the real wind, 86% of the first day's heat detections fall inside the model's area.")
    await R.click("#sim-reset", after=0.4); await R.move(780, 430, 0.8); await R.wait(2.6)
    await R.reveal("#sim-close"); await R.click("#sim-close", after=0.3)
    await R.sub("Take it with you: a <b>CSV</b> of the numbers and a <b>link</b> to this exact view.")
    await R.reveal("#csv"); await R.hover("#csv", after=0.9); await R.click("#share", after=1.9)
    # The quiz picks one of the places at random, so the pointer answers for whatever place it really shows.
    await R.sub("<b>Quiz</b>: two radar images of one place, before and after. What changed?")
    await R.scroll(-600, at=(1400, 400), dur=0.4); await R.click("#t-quiz", after=0.4)
    await R.until("!!document.querySelector(\"[data-quiz='0']\")", 20); await R.idle(0.2)
    await R.slider("#split", 0.72, 1.0)
    answer = await R.js("({ 'tonle-sap': 0, poyang: 1, rondonia: 3, 'central-valley': 4 })[state.site] ?? 2")
    await R.click(f"[data-quiz='{answer}']", after=0.5)
    ok = await R.js("!!document.querySelector('#quiz h2.ok')")
    await R.sub("Correct! The quiz then turns on the Change layer and explains what you see." if ok else "Not quite. The quiz then turns on the Change layer and explains what you see.")
    await R.wait(3.0)
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
    await R.move(700, 430, 0.8); await R.hover("#insight", after=2.0); await R.hover("#kpis", after=1.4)
    await R.sub("<b>About</b> lists the method, thresholds, limits and data sources for each place.")
    await R.click("[data-tabbtn=about]", after=0.5); await R.scroll(700, at=(1400, 520), dur=2.2); await R.wait(1.2)
    await R.scroll(-800, dur=0.5); await R.click("[data-tabbtn=explore]", after=0.2)


# ------------------------------------------------------------------------------------------------ 7
async def _others_setup(R): await _site(R, "big-grass", "change")

@chapter("others", "Fields and hurricanes", _others_setup)
async def others(R):
    await R.sub("<b>Human activity</b>: forest clearing in Brazil, farm fields in California.")
    await _menu(R, 1, "site:central-valley", look=("[data-go='site:rondonia']",))
    await R.until("state.site === 'central-valley' && !!map.getLayer('sar')", 15); await R.idle(0.4); await R.wait(0.8)
    await R.sub("Central Valley, 29 passes in a year: fields change as they are planted and harvested.")
    await R.click("#play", after=0.3); await R.move(620, 430, 0.8); await R.wait(4.4); await R.click("#play", after=0.3)
    await R.sub("<b>Hurricanes</b> use NOAA data: the track, how far each wind strength reaches, wave height.")
    await _menu(R, 0, "storm:al092026")
    await R.until("document.body.classList.contains('storm')", 12); await R.wait(1.0)
    await R.click("#st-play", after=0.3); await R.move(650, 420, 0.8); await R.wait(3.6)
    if await R.js("document.querySelector('#st-play').textContent.trim() !== 'Play'"): await R.click("#st-play", after=0.3)


# ------------------------------------------------------------------------------------------------ 8
async def _live_setup(R):   # the chapter before ends on the hurricane
    await R.js("goStorm('al092026')"); await R.wait(5)

@chapter("live", "Live world", _live_setup)
async def live(R):
    await R.sub("<b>Live world</b>: events NASA tracks right now, and satellites overhead.")
    await R.click("[data-site=live]", after=0.5); await R.until("document.body.classList.contains('live')", 10); await R.wait(1.6); await R.idle(0.2)
    await R.move(430, 300, 0.9); await R.wait(1.0)
    await R.sub("The yellow band is the strip NISAR's radar is looking at this minute.")
    await R.hover("[data-sat=nisar]", after=2.0); await R.hover("[data-sat=swot]", after=1.2)
    x, y = await R.js("(() => { const r = document.querySelector('#map').getBoundingClientRect(), q = map.project([14.99, 37.75]); return [q.x + r.left, q.y + r.top]; })()")
    await R.sub("Click <b>any place on land</b>, here Mount Etna. The app asks NASA's archive…")
    await R.click((x, y), after=0.5)
    await R.until("!!map.getLayer('live-img') && !document.querySelector('.loader:not([hidden])')", 45); await R.wait(0.6)
    await R.sub("…and loads the newest <b>NISAR image</b>, with earlier passes to flip through.")
    await R.move(560, 430, 0.8); await R.wait(2.0)
    await R.hover("[data-pass='1']", after=0.45); await R.hover("[data-pass='2']", after=0.45)
    await R.sub("One button compares two passes, colours the change and plays it.")
    await R.reveal("#live-diff"); await R.click("#live-diff", after=0.5)
    await R.until("!document.querySelector('.loader:not([hidden])')", 45); await R.move(600, 420, 0.8); await R.wait(2.8)


# ------------------------------------------------------------------------------------------------ 9
async def _card(R, want):
    """Open or close the 3D view's satellite card (it opens by itself in some situations, so look first)."""
    is_open = await R.js("(() => { const c = document.querySelector('#g3d-card'); return !!c && !c.hidden && c.offsetParent !== null; })()")
    if want and not is_open: await R.click("#g3d-sat-toggle", after=0.5)
    if not want and is_open: await R.click("#g3d-card-close", after=0.3)

async def _globe_setup(R):
    await R.js("goLive()"); await R.wait(5)

@chapter("globe", "3D Earth", _globe_setup)
async def globe(R):
    await R.sub("The same app on a <b>3D Earth</b>: same menus, layers and tools, on a globe you can turn.")
    await R.click("#globe-btn", after=0.5); await R.until("!!(window.Globe3D && Globe3D.on && Globe3D._viewer())", 25); await R.wait(2.4)
    await _card(R, False); await R.drag((520, 430), (690, 405), dur=1.2, after=0.3)
    await R.sub("<b>Satellites</b> at their true height, with live paths behind and ahead.")
    await _card(R, True); await R.click("#g3d-whole", after=0.4); await _card(R, False); await R.wait(0.4)
    await R.drag((470, 420), (640, 400), dur=1.3, after=0.5)
    await R.sub("Fly beside <b>NISAR</b>: its radar beam meets the ground left of its path, to scale.")
    await _card(R, True); await R.click("[data-sat3='nisar']", after=0.9); await R.click("#g3d-beside", after=0.4)
    await _card(R, False); await R.wait(2.4)
    await R.sub("Speed time up 300 times. NISAR returns over the same place every 12 days.")
    await _card(R, True); await R.click("#g3d-fast", after=0.3); await _card(R, False); await R.wait(3.0)


# ------------------------------------------------------------------------------------------------ 10
async def _end_setup(R):
    await R.js("document.querySelector('#globe-btn').click()"); await R.wait(9)

@chapter("end", "Dancing Earth", _end_setup)
async def end(R):
    await R.sub("<b>Dancing Earth</b> · Team AlgoryX · NASA Space Apps Challenge 2026 · <b>monolyth365-svg.github.io/Dancing-Earth</b>")
    await R.js("(() => { try { const v = Globe3D._viewer(); v.clock.multiplier = 1; v.clock.currentTime = Cesium.JulianDate.now(); } catch (e) {} })()")
    await _card(R, True); await R.click("#g3d-whole", after=0.4); await _card(R, False); await R.wait(0.4)
    await R.drag((430, 430), (700, 400), dur=2.6, after=2.2)
