"""Render the five-second motion intro (video/intro.html) frame by frame.
Usage: python video/walk_intro.py [test t1 t2 ...]  ->  video/out/walk/intro/f00000.jpg ... (150 frames, 1921x1080 like the recording)"""
import asyncio, shutil, sys
from pathlib import Path
from PIL import Image
from playwright.async_api import async_playwright
HERE = Path(__file__).parent; OUT = HERE / "out" / "walk" / "intro"; FPS = 30; N = 150
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
async def main(times):
    if not times: shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, executable_path=CHROME)
        page = await (await b.new_context(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)).new_page()
        page.on("pageerror", lambda e: print("PAGEERROR", str(e)[:300]))
        await page.goto((HERE / "intro.html").as_uri()); await page.evaluate("window.ready")
        todo = [(f"test_{t:04.2f}", t) for t in times] if times else [(f"f{k:05d}", k / FPS) for k in range(N)]
        for name, t in todo:
            await page.evaluate(f"render({t})"); tmp = OUT / "_shot.png"; await page.screenshot(path=str(tmp))
            im = Image.new("RGB", (1921, 1080), (7, 9, 12)); im.paste(Image.open(tmp).convert("RGB"), (0, 0)); im.save(OUT / f"{name}.jpg", quality=94)
        (OUT / "_shot.png").unlink(missing_ok=True); await b.close()
    print("intro frames:", len(todo))
args = sys.argv[1:]
asyncio.run(main([float(x) for x in args[1:]] if args and args[0] == "test" else []))
