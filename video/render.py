"""Render the demo video. Usage:
  python video/render.py test 1.2 4.3 ...   -> a few single frames into video/out/test_*.jpg
  python video/render.py encode             -> only re-encode the frames already drawn
  python video/render.py full               -> every frame, then video/out/dancing-earth-30s.mp4 (with video/out/music.wav)"""
import asyncio, sys, json, subprocess, threading, functools, http.server, shutil
from pathlib import Path
from playwright.async_api import async_playwright
import imageio_ffmpeg
HERE = Path(__file__).parent; OUT = HERE / "out"; FR = OUT / "frames"
T = json.loads((HERE / "timeline.json").read_text()); FPS = T["fps"]; N = int(T["total"] * FPS)
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT = 8099

def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(HERE))
    h.log_message = lambda *a: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), h); threading.Thread(target=srv.serve_forever, daemon=True).start(); return srv

async def main(mode, times):
    serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, executable_path=CHROME)
        page = await (await b.new_context(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)).new_page()
        page.on("pageerror", lambda e: print("PAGEERROR", str(e)[:300]))
        await page.goto(f"http://127.0.0.1:{PORT}/compose.html"); await page.evaluate("window.ready")
        if mode == "encode": pass
        elif mode == "test":
            for t in times:
                await page.evaluate(f"render({t})"); await page.screenshot(path=str(OUT / f"test_{t:05.2f}.jpg"), type="jpeg", quality=88)
            print("test frames:", len(times))
        else:
            shutil.rmtree(FR, ignore_errors=True); FR.mkdir(parents=True)
            for k in range(N):
                await page.evaluate(f"render({k / FPS})"); await page.screenshot(path=str(FR / f"f{k:04d}.jpg"), type="jpeg", quality=95)
                if k % 150 == 0: print("frame", k, "/", N, flush=True)
        await b.close()
    if mode in ("full", "encode"):
        ff = imageio_ffmpeg.get_ffmpeg_exe(); dst = OUT / "dancing-earth-30s.mp4"
        cmd = [ff, "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", str(FR / "f%04d.jpg"), "-i", str(OUT / "music.wav"), "-t", str(T["total"]),
               "-af", f"loudnorm=I=-15:TP=-1.5:LRA=11,afade=t=out:st={T['total'] - 0.5}:d=0.5",
               "-vf", "scale=in_range=full:out_range=tv,format=yuv420p", "-color_range", "tv", "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-c:a", "aac", "-ar", "48000", "-b:a", "192k", "-metadata", "title=Dancing Earth - 30-second demo (AI-assisted video)", "-metadata", "artist=Team AlgoryX", "-metadata", "comment=AI-assisted video (SI-generated titles, cuts and music). All pictures are real screenshots of the Dancing Earth app.", "-movflags", "+faststart", str(dst)]
        subprocess.run(cmd, check=True); print("written", dst, round(dst.stat().st_size / 1e6, 1), "MB")
mode = sys.argv[1] if len(sys.argv) > 1 else "test"
asyncio.run(main(mode, [float(x) for x in sys.argv[2:]]))
