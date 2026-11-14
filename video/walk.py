"""Five-minute walkthrough: a real-time screen recording of the app being used.
A real (headless) Chrome is driven with real mouse moves and clicks; the page is recorded frame by frame with their
timestamps. Three things are added to the page for the recording only: a visible mouse pointer with a ring on every
click, a caption band under the app, and a log of every sound the app plays (so the same sounds can be rendered into
the video's soundtrack). The app itself is not changed.

Usage: python video/walk.py <chapter> [<chapter> ...]   (or: all)      frames -> video/out/walk/<chapter>/"""
import asyncio, base64, json, sys, time, shutil
from pathlib import Path
from playwright.async_api import async_playwright

HERE = Path(__file__).parent; OUT = HERE / "out" / "walk"
BASE = "http://localhost:8080/"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
W, H, BAND, DSF = 1600, 900, 110, 1.2          # 1600x900 CSS px at 1.2 = 1920x1080 video; the app gets 1600x790
APP_H = H - BAND

OVERLAY = r"""
(() => {
  if (window.__vw) return; window.__vw = true;
  window.__snd = []; window.__subs = [];
  const add = () => {
    const st = document.createElement("style");
    st.textContent = `
      html, body { height: %(app_h)dpx !important; }
      .loader { bottom: %(loader_b)dpx !important; }
      #vw-band { position: fixed; left: 0; right: 0; bottom: 0; height: %(band)dpx; z-index: 2147483600; background: #07090c; border-top: 1px solid #2a303a; font-family: "Instrument Sans", system-ui, sans-serif; color: #f2f3f5; pointer-events: none; }
      #vw-chap { position: absolute; left: 34px; top: 13px; font: 500 12.5px/1 "JetBrains Mono", monospace; letter-spacing: .14em; text-transform: uppercase; color: #e9b949; }
      #vw-sub { position: absolute; left: 34px; top: 35px; width: 1240px; font-size: 26px; font-weight: 600; line-height: 1.22; letter-spacing: -.01em; transition: opacity .18s; }
      #vw-sub b { color: #e9b949; font-weight: 600; }
      #vw-mark { position: absolute; right: 26px; bottom: 12px; width: 250px; text-align: right; font: 400 10.5px/1.45 "JetBrains Mono", monospace; color: rgba(210,215,222,.5); }
      #vw-prog { position: absolute; left: 0; top: -1px; height: 2px; width: 0; background: #e9b949; }
      #vw-cur { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; width: 26px; height: 26px; transform: translate(-200px, -200px); filter: drop-shadow(0 2px 3px rgba(0,0,0,.7)); }
      .vw-ring { position: fixed; z-index: 2147483646; pointer-events: none; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%%; border: 3px solid #e9b949; animation: vwring .55s ease-out forwards; }
      @keyframes vwring { from { transform: scale(.5); opacity: 1; } to { transform: scale(4.2); opacity: 0; } }`;
    document.head.appendChild(st);
    const band = document.createElement("div"); band.id = "vw-band";
    band.innerHTML = `<div id="vw-prog"></div><div id="vw-chap"></div><div id="vw-sub"></div><div id="vw-mark">Screen recording of the real app.<br>Captions and music added with AI (SI) assistance.</div>`;
    document.body.appendChild(band);
    const cur = document.createElement("div"); cur.id = "vw-cur";
    cur.innerHTML = `<svg viewBox="0 0 26 26" width="26" height="26"><path d="M3 2 L3 21 L8.2 16.4 L11.6 24 L14.6 22.7 L11.3 15.2 L18 15 Z" fill="#fff" stroke="#07090c" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    document.body.appendChild(cur);
    window.addEventListener("mousemove", (e) => { cur.style.transform = `translate(${e.clientX - 3}px, ${e.clientY - 2}px)`; }, true);
    window.addEventListener("mousedown", (e) => { const r = document.createElement("div"); r.className = "vw-ring"; r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px"; document.body.appendChild(r); setTimeout(() => r.remove(), 600); }, true);
    window.dispatchEvent(new Event("resize"));
  };
  window.__sub = (html) => { const el = document.querySelector("#vw-sub"); if (el) el.innerHTML = html; window.__subs.push({ t: Date.now() / 1000, html }); };
  window.__chap = (text, frac) => { const el = document.querySelector("#vw-chap"); if (el) el.textContent = text; const p = document.querySelector("#vw-prog"); if (p && frac != null) p.style.width = (frac * 100).toFixed(1) + "%%"; };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add); else add();
  // RECORD THE APP'S REAL SOUND: whatever any of its AudioContexts sends to the speakers is also copied, block by
  // block with its wall-clock time, into window.__pcm (silent blocks are skipped). The browser itself runs muted.
  window.__pcm = [];
  const _connect = AudioNode.prototype.connect, taps = new WeakMap();
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = _connect.call(this, dest, ...rest);
    try {
      const ac = dest && dest.context;
      if (ac && dest === ac.destination && !this.__tapnode) {
        let tap = taps.get(ac);
        if (!tap) {
          const mix = ac.createGain(), sp = ac.createScriptProcessor(4096, 2, 2), mute = ac.createGain(); mute.gain.value = 0; sp.__tapnode = mute.__tapnode = mix.__tapnode = true;
          let wall0 = null, pt0 = null;
          sp.onaudioprocess = (e) => {
            const L = e.inputBuffer.getChannelData(0), R = e.inputBuffer.getChannelData(1);
            if (wall0 === null) { wall0 = Date.now() / 1000; pt0 = e.playbackTime; }
            let peak = 0; for (let i = 0; i < L.length; i += 16) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
            if (peak < 1e-4) return;
            const b = new Int16Array(L.length * 2); for (let i = 0; i < L.length; i++) { b[2 * i] = Math.max(-1, Math.min(1, L[i])) * 32767; b[2 * i + 1] = Math.max(-1, Math.min(1, R[i])) * 32767; }
            window.__pcm.push({ t: wall0 + (e.playbackTime - pt0), sr: ac.sampleRate, b });
          };
          _connect.call(mix, sp); _connect.call(sp, mute); _connect.call(mute, ac.destination);
          tap = mix; taps.set(ac, tap);
        }
        _connect.call(this, tap);
      }
    } catch (err) { /* recording the sound must never break the app */ }
    return r;
  };
  window.__pcmTake = (t0, t1) => { const out = []; for (const k of window.__pcm) if (k.t >= t0 - 0.2 && k.t <= t1) { const u = new Uint8Array(k.b.buffer); let s = ""; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); out.push({ t: k.t, sr: k.sr, b64: btoa(s) }); } return out; };
  // log every sound the app plays (time + what), just for the record
  const hook = () => { if (!window.Sonify || window.Sonify.__logged) return setTimeout(hook, 50);
    for (const fn of ["play", "playScan"]) { const o = window.Sonify[fn]; window.Sonify[fn] = (...a) => { window.__snd.push({ t: Date.now() / 1000, fn, a }); return o(...a); }; }
    window.Sonify.__logged = true; };
  hook();
})();
""" % {"app_h": APP_H, "band": BAND, "loader_b": BAND + 22}


class Rec:
    def __init__(self, page, cdp):
        self.page, self.cdp = page, cdp
        self.x, self.y = 800.0, 400.0
        self.dir = None; self.n = 0; self.ts = []; self.last = 0.0; self.on = False

    # ---- recording ----
    async def _frame(self, ev):
        try:
            await self.cdp.send("Page.screencastFrameAck", {"sessionId": ev["sessionId"]})
        except Exception:
            return
        t = ev["metadata"]["timestamp"]
        if not self.on or t - self.last < 1 / 31:
            return
        self.last = t
        (self.dir / f"f{self.n:05d}.jpg").write_bytes(base64.b64decode(ev["data"]))
        self.ts.append(t); self.n += 1

    async def start(self, name):
        self.dir = OUT / name; shutil.rmtree(self.dir, ignore_errors=True); self.dir.mkdir(parents=True)
        self.n = 0; self.ts = []; self.last = 0.0
        await self.page.evaluate("window.__snd.length = 0; window.__subs.length = 0;")
        self.on = True
        await self.cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 93, "everyNthFrame": 1})
        self.t0 = time.time()

    async def stop(self):
        await self.page.wait_for_timeout(150)
        await self.cdp.send("Page.stopScreencast"); self.on = False
        end = time.time()
        snd = await self.page.evaluate("window.__snd"); subs = await self.page.evaluate("window.__subs")
        t_first = self.ts[0] if self.ts else self.t0
        blocks = await self.page.evaluate("([a, b]) => window.__pcmTake(a, b)", [t_first, end])
        (self.dir / "meta.json").write_text(json.dumps({"ts": self.ts, "end": end, "snd": snd, "subs": subs}))
        self._wav(blocks, t_first, end)
        dur = (end - self.ts[0]) if self.ts else 0
        print(f"  [{self.dir.name}] {self.n} frames, {dur:.1f} s, {len(snd)} app sound calls, {self.sound_s:.1f} s of recorded app sound", flush=True)
        return dur

    def _wav(self, blocks, t0, t1):
        """Lay the recorded sound blocks on the chapter's time line and save it as audio.wav (48 kHz stereo)."""
        import numpy as np, wave
        n = int((t1 - t0) * 48000) + 1; mix = np.zeros((n, 2), dtype=np.float32)
        for k in blocks:
            a = np.frombuffer(base64.b64decode(k["b64"]), dtype=np.int16).reshape(-1, 2).astype(np.float32) / 32768
            if k["sr"] != 48000:
                m = int(len(a) * 48000 / k["sr"]); xi = np.linspace(0, len(a) - 1, m); a = np.stack([np.interp(xi, np.arange(len(a)), a[:, c]) for c in (0, 1)], axis=1).astype(np.float32)
            i = int((k["t"] - t0) * 48000)
            if i < 0: a = a[-i:]; i = 0
            a = a[:max(0, n - i)]; mix[i:i + len(a)] += a
        self.sound_s = float((np.abs(mix).max(axis=1) > 1e-3).sum() / 48000)
        with wave.open(str(self.dir / "audio.wav"), "wb") as w:
            w.setnchannels(2); w.setsampwidth(2); w.setframerate(48000); w.writeframes((np.clip(mix, -1, 1) * 32767).astype(np.int16).tobytes())

    # ---- acting like a person ----
    async def wait(self, s): await self.page.wait_for_timeout(int(s * 1000))

    async def move(self, x, y, dur=None):
        dx, dy = x - self.x, y - self.y; dist = (dx * dx + dy * dy) ** 0.5
        if dur is None: dur = min(1.1, 0.28 + dist / 1500)
        steps = max(2, int(dur * 60))
        for k in range(1, steps + 1):
            u = k / steps; e = u * u * (3 - 2 * u)   # ease in and out
            await self.page.mouse.move(self.x + dx * e, self.y + dy * e)
            await asyncio.sleep(dur / steps)
        self.x, self.y = x, y

    async def xy(self, target):
        if isinstance(target, (tuple, list)): return float(target[0]), float(target[1])
        box = await self.page.locator(target).first.bounding_box()
        if not box: raise RuntimeError(f"not on screen: {target}")
        return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2

    async def click(self, target, dur=None, after=0.35):
        x, y = await self.xy(target)
        await self.move(x, y, dur); await asyncio.sleep(0.16)
        await self.page.mouse.down(); await asyncio.sleep(0.07); await self.page.mouse.up()
        await asyncio.sleep(after)

    async def hover(self, target, dur=None, after=0.3):
        x, y = await self.xy(target); await self.move(x, y, dur); await asyncio.sleep(after)

    async def drag(self, a, b, dur=1.2, after=0.3):
        ax, ay = await self.xy(a); bx, by = (await self.xy(b))
        await self.move(ax, ay); await asyncio.sleep(0.15); await self.page.mouse.down(); await asyncio.sleep(0.1)
        await self.move(bx, by, dur); await asyncio.sleep(0.12); await self.page.mouse.up(); await asyncio.sleep(after)

    async def slider(self, sel, frac, dur=1.0):
        """Drag a range input's thumb to the given fraction (0..1) of its track."""
        box = await self.page.locator(sel).bounding_box()
        cur = await self.page.evaluate(f"(() => {{ const s = document.querySelector('{sel}'); return (s.value - s.min) / ((s.max - s.min) || 1); }})()")
        pad = 8; span = box["width"] - 2 * pad; y = box["y"] + box["height"] / 2
        await self.drag((box["x"] + pad + span * cur, y), (box["x"] + pad + span * frac, y), dur)

    async def scroll(self, dy, at=None, dur=0.7):
        if at: await self.move(*at)
        steps = max(3, int(dur * 30))
        for _ in range(steps):
            await self.page.mouse.wheel(0, dy / steps); await asyncio.sleep(dur / steps)
        await asyncio.sleep(0.25)

    async def reveal(self, target, at=(1400, 500)):
        """If a control of the side panel is below the visible part, scroll the panel until it is comfortably on screen."""
        for _ in range(8):
            box = await self.page.locator(target).first.bounding_box()
            if not box: return
            if box["y"] + box["height"] > APP_H - 24: await self.scroll(min(260, box["y"] + box["height"] - APP_H + 140), at)
            elif box["y"] < 150 and at[0] > 1200: await self.scroll(-min(260, 260 - box["y"]), at)
            else: return

    async def pressed(self, sel): return await self.page.evaluate(f"document.querySelector('{sel}')?.getAttribute('aria-pressed') === 'true'")

    async def sub(self, html, hold=0.0):
        await self.page.evaluate("(h) => window.__sub(h)", html)
        if hold: await self.wait(hold)

    async def chap(self, text, frac=None): await self.page.evaluate("([t, f]) => window.__chap(t, f)", [text, frac])
    async def js(self, code): return await self.page.evaluate(code)
    async def idle(self, extra=0.3):
        await self.page.evaluate("new Promise((r) => { const done = () => setTimeout(r, 150); if (map.loaded() && !map.isMoving() && map.areTilesLoaded()) done(); else map.once('idle', done); setTimeout(r, 7000); })")
        await self.wait(extra)
    async def until(self, cond, timeout=25):
        t0 = time.time()
        while time.time() - t0 < timeout:
            if await self.page.evaluate(cond): return True
            await asyncio.sleep(0.15)
        print("  ! timed out waiting for:", cond[:90], flush=True); return False
    async def shot(self, name): pass  # (page screenshots come out at the wrong size in this window mode; use video/sheet.py on the recording)
    async def dump(self, label):
        print(f"--- {label} ---")
        print(await self.page.evaluate(r"""(() => { const out = []; for (const e of document.querySelectorAll('button, input, select, [role=tab], [data-go], [data-act], [data-story]')) {
          const r = e.getBoundingClientRect(); if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue;
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); if (top !== e && !e.contains(top) && !(top && top.contains(e))) continue;
          const ds = Object.entries(e.dataset).map(([k, v]) => `[data-${k}=${String(v).slice(0, 26)}]`).join('');
          out.push(`${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${ds} "${(e.textContent || e.value || '').trim().replace(/\s+/g, ' ').slice(0, 50)}" @${Math.round(r.left + r.width / 2)},${Math.round(r.top + r.height / 2)}`); }
          return out.join('\n'); })()"""))


from walk_script import CHAPTERS  # noqa: E402  (the scenes themselves: what is clicked and what the captions say)


async def main(names):
    order = list(CHAPTERS)
    if names == ["all"]: names = order
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, executable_path=CHROME, args=["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required", "--hide-scrollbars", "--mute-audio",
                                                                                       f"--window-size={W},{H + 87}", f"--force-device-scale-factor={DSF}"])  # a real 1.2 scale: frames come out 1921x1080
        ctx = await b.new_context(no_viewport=True, permissions=["clipboard-read", "clipboard-write"], accept_downloads=True)
        page = await ctx.new_page()
        page.on("pageerror", lambda e: print("  PAGEERROR", str(e)[:200], flush=True))
        await page.add_init_script(OVERLAY)
        cdp = await ctx.new_cdp_session(page); R = Rec(page, cdp)
        cdp.on("Page.screencastFrame", lambda ev: asyncio.ensure_future(R._frame(ev)))
        first = True
        for name in names:
            title, setup, fn = CHAPTERS[name]
            if first:   # the session starts from a fresh page; a chapter recorded on its own first jumps to its starting state
                await page.goto(f"{BASE}?t={int(time.time())}"); await page.wait_for_timeout(4500)
                print("  window:", await page.evaluate("[innerWidth, innerHeight, devicePixelRatio]"), flush=True)
                if name != order[0]:
                    await page.evaluate("(() => { const i = document.querySelector('#intro'); if (i && !i.hidden) document.querySelector('#intro-close').click(); if (window.stop) stop(); })()")
                if setup: await setup(R)
                first = False
            real = [n for n in order if not n.startswith("_")]
            if name in real: await R.chap(f"{real.index(name) + 1} / {len(real)} · {title}", real.index(name) / len(real))
            await page.mouse.move(R.x, R.y)
            probe = False   # probes ("_name") are recorded too, so their contact sheets can be looked at; the final cut skips them
            if not probe: await R.start(name)
            try:
                await fn(R)
            except Exception as e:
                print(f"  !! chapter {name} stopped: {str(e)[:300]}", flush=True)
            if not probe: await R.stop()
        await b.close()

if __name__ == "__main__":
    sys.path.insert(0, str(HERE))
    asyncio.run(main(sys.argv[1:] or ["all"]))
