"""Capture sharp stills from the running app (http://localhost:8080) for the demo video.
Usage: python video/capture.py <scene> [<scene> ...]   scenes: opt water fire cmp charts extra live globe"""
import asyncio, sys, time, json
from pathlib import Path
from playwright.async_api import async_playwright
OUT = Path(__file__).parent / "shots"; OUT.mkdir(exist_ok=True)
BASE = "http://localhost:8080/"
LIVE_AT = (14.99, 37.75)  # Mount Etna, Sicily
GLOBE_N = 56
GLOBE4K_N = int(__import__('os').environ.get('GLOBE4K_N', 90))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
IDLE = "new Promise((r) => { const done = () => setTimeout(r, 250); if (map.loaded() && !map.isMoving() && map.areTilesLoaded()) done(); else map.once('idle', done); setTimeout(r, 6000); })"
CLOSE_INTRO = "(() => { const i = document.querySelector('#intro'); if (i && !i.hidden) { const x = i.querySelector('button'); x && x.click(); } const s = document.querySelector('#sound'); if (s) s.checked = false; })()"

async def new_page(b, dsf=2):
    ctx = await b.new_context(viewport={"width": 1920, "height": 1080}, device_scale_factor=dsf)
    page = await ctx.new_page()
    page.on("pageerror", lambda e: print("PAGEERROR", str(e)[:200]))
    return ctx, page

async def shot(page, name):
    await page.screenshot(path=str(OUT / f"{name}.jpg"), type="jpeg", quality=93)

async def open_site(page, hash_):
    await page.goto(f"{BASE}?t={int(time.time())}#{hash_}"); await page.wait_for_timeout(4500)
    await page.evaluate(CLOSE_INTRO); await page.wait_for_timeout(300); await page.evaluate(IDLE)

async def passes(page, prefix):
    n = await page.evaluate("state.data.frames.length"); meta = []
    for i in range(n):
        await page.evaluate(f"show({i}, false)"); await page.evaluate(IDLE); await page.wait_for_timeout(350)
        await shot(page, f"{prefix}_{i:02d}")
        meta.append(await page.evaluate("(() => { const f = state.data.frames[state.i]; return { date: f.date, waterKm2: f.waterKm2, lossKm2: f.lossKm2, lossInsideKm2: f.lossInsideKm2, cloudPct: f.cloudPct }; })()"))
    (OUT / f"{prefix}.json").write_text(json.dumps(meta))
    print(prefix, n, "passes")

async def main(scenes):
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, executable_path=CHROME, args=["--enable-unsafe-swiftshader", "--use-angle=swiftshader"])
        if "opt" in scenes:  # the same cloudy day as a camera photo and as a radar image
            ctx, page = await new_page(b)
            await open_site(page, "site=tonle-sap&date=2026-09-23&layer=optical"); await page.wait_for_timeout(1500); await shot(page, "opt_photo")
            await page.evaluate("document.querySelector('[data-layer=hv]').click()"); await page.evaluate(IDLE); await page.wait_for_timeout(600); await shot(page, "opt_radar")
            await ctx.close()
        if "water" in scenes:
            ctx, page = await new_page(b)
            await open_site(page, "site=tonle-sap&layer=change"); await passes(page, "water")
            await ctx.close()
        if "fire" in scenes:
            ctx, page = await new_page(b)
            await open_site(page, "site=shingle&layer=change"); await passes(page, "fire")
            await ctx.close()
        if "cmp" in scenes:  # before / after divider sweeping across the image
            ctx, page = await new_page(b)
            await open_site(page, "site=shingle&layer=hv"); await page.evaluate("show(state.data.frames.length - 1, false)")
            await page.evaluate("document.querySelector('#compare').click()"); await page.evaluate(IDLE); await page.wait_for_timeout(800)
            for k in range(25):
                v = 0.12 + (0.88 - 0.12) * k / 24
                await page.evaluate(f"(() => {{ const s = document.querySelector('#split'); s.value = {v:.3f}; s.dispatchEvent(new Event('input', {{ bubbles: true }})); }})()")
                await page.wait_for_timeout(350); await shot(page, f"cmp_{k:02d}")
            await ctx.close()
        if "charts" in scenes:
            ctx, page = await new_page(b)
            for site in ["tonle-sap", "shingle"]:
                await open_site(page, f"site={site}&layer=change"); await page.evaluate("document.querySelector('[data-tabbtn=charts]').click()"); await page.wait_for_timeout(2500); await shot(page, f"charts_{site}")
            await ctx.close()
        if "extra" in scenes:  # tools, hurricane and the same place on the 3D Earth
            ctx, page = await new_page(b)
            await open_site(page, "site=central-valley&layer=change"); await page.evaluate("document.querySelector('[data-tabbtn=tools]').click()"); await page.wait_for_timeout(1200); await shot(page, "extra_tools")
            await page.evaluate("goStorm('al092026')"); await page.wait_for_timeout(6000); await shot(page, "extra_storm")
            await ctx.close()
        if "live" in scenes:  # Live world: click a place, the newest NISAR quick-look loads from NASA's archive
            ctx, page = await new_page(b)
            await open_site(page, "site=tonle-sap"); await page.evaluate("goLive()"); await page.wait_for_timeout(9000); await page.evaluate(IDLE); await shot(page, "live_world")
            lng, lat = LIVE_AT
            await page.evaluate(f"map.fire('click', {{ lngLat: new maplibregl.LngLat({lng}, {lat}), point: map.project([{lng}, {lat}]), originalEvent: {{}} }})")
            for k in range(16):
                await page.wait_for_timeout(700); await shot(page, f"live_{k:02d}")
                print(k, await page.evaluate("JSON.stringify({ img: !!map.getLayer('live-img'), load: !!document.querySelector('.loader:not([hidden])'), zoom: +map.getZoom().toFixed(1) })"))
            await page.wait_for_timeout(5000); await page.evaluate(IDLE); await shot(page, "live_done")
            await ctx.close()
        if "globe" in scenes:  # 3D Earth with satellites, orbits and NISAR's beam; time runs fast, camera turns slowly
            ctx, page = await new_page(b, dsf=1)
            await open_site(page, "site=tonle-sap&layer=hv"); await page.evaluate("document.querySelector('#globe-btn').click()"); await page.wait_for_timeout(12000)
            await page.evaluate("(() => { const v = Globe3D._viewer(), C = Cesium; v.camera.cancelFlight(); v.camera.lookAtTransform(C.Matrix4.IDENTITY); v.camera.setView({ destination: C.Cartesian3.fromDegrees(118, 8, 1.75e7) }); v.clock.multiplier = 40; v.clock.shouldAnimate = true; })()")
            await page.wait_for_timeout(6000)
            for k in range(GLOBE_N):
                await page.evaluate("(() => { const v = Globe3D._viewer(), C = Cesium; v.camera.rotate(C.Cartesian3.UNIT_Z, 0.0045); })()")
                await page.wait_for_timeout(120); await shot(page, f"globe_{k:02d}")
            await ctx.close()
        if "measure" in scenes:  # outline a flooded bay with the area tool and read its size
            ctx, page = await new_page(b)
            await open_site(page, "site=tonle-sap&layer=change"); await page.evaluate("show(state.data.frames.length - 1, false)")
            await page.evaluate("document.querySelector('[data-tabbtn=tools]').click()"); await page.evaluate("document.querySelector('#t-area').click()")
            for x, y in [(330, 430), (500, 350), (610, 540), (520, 800), (350, 760)]:
                await page.evaluate(f"(() => {{ const ll = map.unproject([{x}, {y} - 67]); map.fire('click', {{ lngLat: ll, point: map.project(ll), originalEvent: {{}} }}); }})()"); await page.wait_for_timeout(200)
            await page.evaluate("document.querySelector('[data-act=area-done]').click()"); await page.wait_for_timeout(1200); await shot(page, "extra_measure")
            await ctx.close()
        if "globe4k" in scenes:  # the spinning 3D Earth at full quality: the app lowers its own resolution when frames come slowly
            # (as they do in this headless capture), so quality is forced back up and time is stepped by hand, frame by frame
            ctx, page = await new_page(b, dsf=2)
            await open_site(page, "site=tonle-sap&layer=hv"); await page.evaluate("document.querySelector('#globe-btn').click()"); await page.wait_for_timeout(12000)
            SHARP = "(() => { const v = Globe3D._viewer(); v.useBrowserRecommendedResolution = false; v.resolutionScale = 1; v.scene.globe.maximumScreenSpaceError = 1.3; v.scene.postProcessStages.fxaa.enabled = true; })()"
            await page.evaluate("(() => { const v = Globe3D._viewer(), C = Cesium; v.camera.cancelFlight(); v.camera.lookAtTransform(C.Matrix4.IDENTITY); v.camera.setView({ destination: C.Cartesian3.fromDegrees(118, 8, 1.75e7) }); v.clock.multiplier = 40; v.clock.shouldAnimate = false; window.__t0 = C.JulianDate.clone(v.clock.currentTime); })()")
            await page.evaluate(SHARP)
            for _ in range(40):  # wait until the sharper map tiles have arrived
                await page.wait_for_timeout(1500)
                if await page.evaluate("Globe3D._viewer().scene.globe.tilesLoaded"): break
            t0 = time.time()
            for k in range(GLOBE4K_N):
                await page.evaluate(SHARP)
                await page.evaluate(f"(() => {{ const v = Globe3D._viewer(), C = Cesium; v.clock.currentTime = C.JulianDate.addSeconds(window.__t0, {k} * 12, new C.JulianDate()); v.camera.rotate(C.Cartesian3.UNIT_Z, 0.0028); }})()")
                await page.wait_for_timeout(520)
                for _ in range(10):
                    if await page.evaluate("Globe3D._viewer().scene.globe.tilesLoaded"): break
                    await page.wait_for_timeout(400)
                await page.evaluate(SHARP); await page.wait_for_timeout(220)
                await shot(page, f"globe_{k:02d}")
                if k % 10 == 0: print("globe frame", k, round(time.time() - t0), "s", await page.evaluate("JSON.stringify({ rs: Globe3D._viewer().resolutionScale, w: Globe3D._viewer().canvas.width })"), flush=True)
            await ctx.close()
        await b.close()
asyncio.run(main(sys.argv[1:]))
