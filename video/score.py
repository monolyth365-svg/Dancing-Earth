"""Cinematic soundtrack for the demo video, synthesized in code (no recordings, no samples, no music model).
A slow D-minor score (pad, sub bass, piano, low hits) is written here; two things come from the NISAR data:
  * the piano line in the flood and fire scenes follows the open-water area / the mapped burn scar, pass by pass;
  * in the "Hear the change" scene the app's own sound code (web/sound.js) plays the two radar images.
Rendered offline in the browser (Web Audio) to video/out/music.wav. Usage: python video/score.py"""
import asyncio, base64, time, json
from pathlib import Path
from playwright.async_api import async_playwright
OUT = Path(__file__).parent / "out"; OUT.mkdir(exist_ok=True)
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
T = json.loads((Path(__file__).parent / "timeline.json").read_text())
INIT = """
(() => {
  const SR = 48000, off = new OfflineAudioContext(2, SR * %d, SR); let vt = 1e4;
  let seed = 20261115; const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  // master: everything -> gentle compressor -> out; a long dark reverb gives the "big hall" sound
  const master = off.createGain(), comp = off.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 3; comp.attack.value = 0.012; comp.release.value = 0.3;
  master.connect(comp); comp.connect(off.destination);
  const irLen = Math.floor(SR * 3.6), ir = off.createBuffer(2, irLen, SR);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); let y = 0; for (let i = Math.floor(SR * 0.02); i < irLen; i++) { y += 0.28 * ((rnd() * 2 - 1) - y); d[i] = y * Math.exp(-(i / SR) / 0.55); } }
  const conv = off.createConvolver(); conv.buffer = ir; const wet = off.createGain(); wet.gain.value = 0.9; conv.connect(wet); wet.connect(master);
  const bus = {}, mk = (name, dry, send) => { const g = off.createGain(); g.gain.value = 1; const d = off.createGain(); d.gain.value = dry; const s = off.createGain(); s.gain.value = send; g.connect(d); d.connect(master); g.connect(s); s.connect(conv); bus[name] = g; };
  mk("pad", 2.8, 1.3); mk("sub", 0.3, 0.02); mk("piano", 2.0, 1.1); mk("pluck", 2.2, 0.8); mk("hit", 0.7, 0.4); mk("air", 1.3, 0.7); mk("app", 3.0, 1.0);
  const noise = off.createBuffer(1, SR * 4, SR); { const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1; }
  // the app's sound code asks for an AudioContext: give it this one, routed to its own fader
  const prox = new Proxy(off, { get(t, k) { if (k === "currentTime") return vt; if (k === "destination") return bus.app; const v = t[k]; return typeof v === "function" ? v.bind(t) : v; } });
  window.AudioContext = function () { return prox; };
  window.__at = (x) => { vt = x; };
  window.__A = { off, bus, noise, master };
  window.__wav = async () => {
    const buf = await off.startRendering(), L = buf.getChannelData(0), R = buf.getChannelData(1), n = L.length;
    let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    const g = 0.89 / (peak || 1), dv = new DataView(new ArrayBuffer(44 + n * 4)), str = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
    str(0, "RIFF"); dv.setUint32(4, 36 + n * 4, true); str(8, "WAVEfmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
    dv.setUint32(24, 48000, true); dv.setUint32(28, 192000, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); str(36, "data"); dv.setUint32(40, n * 4, true);
    for (let i = 0; i < n; i++) { dv.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i] * g)) * 32767, true); dv.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i] * g)) * 32767, true); }
    const u = new Uint8Array(dv.buffer); let s = ""; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768));
    return JSON.stringify({ peak, b64: btoa(s) });
  };
})();
""" % (int(T["total"]) + 1)
SCORE = """
(async () => {
  const T = %s, S = T.scenes, { off, bus, noise } = __A, quiet = () => __at(1e4);
  const grab = async (id) => { quiet(); await loadSite(id); await new Promise((r) => setTimeout(r, 2500)); quiet();
    const f = state.data.frames; return { kind: state.data.kind, scans: f.map((_, i) => scan(i)), water: f.map((x) => x.waterKm2), loss: f.map((x) => x.lossKm2) }; };
  const lake = await grab("tonle-sap"), fire = await grab("shingle"); quiet();
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // ---- instruments ----
  const env = (g, t, a, peak, hold, r) => { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setValueAtTime(peak, t + a + hold); g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + r); };
  // PAD ("strings"): three slightly detuned saws through a low-pass that slowly opens
  function pad(t, dur, midi, gain, c0, c1, a = 1.4, r = 2.2) {
    const f = off.createBiquadFilter(), g = off.createGain(); f.type = "lowpass"; f.Q.value = 0.5; f.frequency.setValueAtTime(c0, t); f.frequency.linearRampToValueAtTime(c1, t + dur);
    env(g, t, a, gain, Math.max(0.01, dur - a), r); f.connect(g); g.connect(bus.pad);
    for (const cents of [-9, 0, 8]) { const o = off.createOscillator(); o.type = "sawtooth"; o.frequency.value = hz(midi); o.detune.value = cents; o.connect(f); o.start(t); o.stop(t + dur + r + 0.1); }
  }
  // SUB: a pure low note under each chord
  function sub(t, dur, midi, gain) { const o = off.createOscillator(), g = off.createGain(); o.type = "sine"; o.frequency.value = hz(midi); env(g, t, 0.6, gain, Math.max(0.01, dur - 0.6), 1.2); o.connect(g); g.connect(bus.sub); o.start(t); o.stop(t + dur + 1.4);
    // the same note an octave higher, so the bass line is also heard on small speakers
    const o2 = off.createOscillator(), g2 = off.createGain(), f2 = off.createBiquadFilter(); o2.type = "triangle"; o2.frequency.value = hz(midi + 12); f2.type = "lowpass"; f2.frequency.value = 500;
    env(g2, t, 0.5, gain * 0.2, Math.max(0.01, dur - 0.5), 1.2); o2.connect(f2); f2.connect(g2); g2.connect(bus.pad); o2.start(t); o2.stop(t + dur + 1.4); }
  // PIANO: soft hammer, long decay (sine + quiet octave + quiet fifth above the octave)
  function piano(t, midi, gain, decay = 2.6) {
    [[1, 1], [2, 0.32], [3, 0.1], [4, 0.05]].forEach(([mult, amp]) => { const o = off.createOscillator(), g = off.createGain(); o.type = "sine"; o.frequency.value = hz(midi) * mult;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain * amp, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + decay / mult); o.connect(g); g.connect(bus.piano); o.start(t); o.stop(t + decay / mult + 0.05); });
  }
  // PLUCK: short muted string, used for the quiet ticking pattern
  function pluck(t, midi, gain) { const o = off.createOscillator(), f = off.createBiquadFilter(), g = off.createGain(); o.type = "sawtooth"; o.frequency.value = hz(midi); f.type = "lowpass"; f.frequency.setValueAtTime(1900, t); f.frequency.exponentialRampToValueAtTime(420, t + 0.2);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24); o.connect(f); f.connect(g); g.connect(bus.pluck); o.start(t); o.stop(t + 0.3); }
  // HIT: deep cinematic boom (falling sine + a short dark thump of noise)
  function hit(t, gain) {
    const o = off.createOscillator(), g = off.createGain(); o.type = "sine"; o.frequency.setValueAtTime(82, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.7);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4); o.connect(g); g.connect(bus.hit); o.start(t); o.stop(t + 2.5);
    const n = off.createBufferSource(), f = off.createBiquadFilter(), ng = off.createGain(); n.buffer = noise; f.type = "lowpass"; f.frequency.value = 260;
    ng.gain.setValueAtTime(0.0001, t); ng.gain.linearRampToValueAtTime(gain * 0.9, t + 0.005); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.5); n.connect(f); f.connect(ng); ng.connect(bus.hit); n.start(t); n.stop(t + 0.6);
  }
  // RISER: a breath of filtered noise that swells into a cut
  function riser(t0, t1, gain) { const n = off.createBufferSource(), f = off.createBiquadFilter(), g = off.createGain(); n.buffer = noise; n.loop = true; f.type = "bandpass"; f.Q.value = 0.9;
    f.frequency.setValueAtTime(350, t0); f.frequency.exponentialRampToValueAtTime(4200, t1); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t1 - 0.02); g.gain.linearRampToValueAtTime(0.0001, t1 + 0.04);
    n.connect(f); f.connect(g); g.connect(bus.air); n.start(t0); n.stop(t1 + 0.1); }

  // ---- harmony: D minor, one chord every four seconds: Dm - Bb - F - C - Dm - Bb - C - Dm ----
  const CH = { Dm: { bass: 38, notes: [50, 57, 62, 65] }, Bb: { bass: 34, notes: [46, 53, 58, 62] }, F: { bass: 41, notes: [53, 57, 60, 65] }, C: { bass: 36, notes: [48, 55, 60, 64] } };
  const bars = [[0, 4, "Dm", 0.35], [4, 8, "Bb", 0.5], [8, 12, "F", 0.7], [12, 16, "C", 0.85], [16, 20, "Dm", 0.3], [20, 24, "Bb", 0.85], [24, S.end[0], "C", 1], [S.end[0], T.total, "Dm", 0.9]];
  bars.forEach(([a, b, name, level], k) => { const c = CH[name], last = k === bars.length - 1;
    c.notes.forEach((m, j) => pad(a, b - a, m, 0.022 * (0.6 + level) * (j === 3 ? 0.8 : 1), 380 + level * 500, 520 + level * 1300, last ? 0.25 : 1.4, last ? 3.2 : 2.2));
    if (level > 0.6) pad(a, b - a, c.notes[1] + 12, 0.012 * level, 600, 1700, 1.6, 2); // a higher voice joins when the music grows
    sub(a, b - a, c.bass, 0.13 + level * 0.07); });
  // quiet ticking pattern (eighth notes) from the flood scene on; it stops for "Hear the change"
  const tick = (a, b, name, g) => { const c = CH[name], pat = [c.notes[0], c.notes[1], c.notes[0] + 12, c.notes[1]]; for (let t = a, k = 0; t < b - 1e-6; t += 0.25, k++) pluck(t, pat[k %% 4], g * (k %% 2 ? 0.75 : 1)); };
  tick(6, 8, "Bb", 0.02); tick(8, 12, "F", 0.028); tick(12, 16, "C", 0.034); tick(20, 24, "Bb", 0.036); tick(24, S.end[0], "C", 0.042);
  // opening piano: four calm notes
  [[0.5, 62, 0.07], [2, 69, 0.06], [4, 65, 0.07], [5, 70, 0.06]].forEach(([t, m, g]) => piano(t, m, g, 3));
  // DATA MELODY: one piano note per radar pass; the higher the note, the more open water / the larger the burn scar
  const scale = [62, 65, 67, 69, 72, 74, 77, 79, 81]; // D minor pentatonic, two octaves
  const tone = (v) => scale[Math.max(0, Math.min(scale.length - 1, Math.round(v * (scale.length - 1))))];
  const w = T.waterPasses.map((i) => lake.water[i]), wlo = Math.min(...w), whi = Math.max(...w);
  w.forEach((v, k) => piano(S.water[0] + k * T.beat, tone((v - wlo) / (whi - wlo)), 0.075 + 0.02 * (k / w.length), 2.2));
  const ls = T.firePasses.map((i) => fire.loss[i]), lmax = Math.max(...ls);
  ls.forEach((v, k) => piano(S.fire[0] + k * T.beat, tone(v / lmax) - 12, 0.1, 2.4));
  // HEAR THE CHANGE: the music steps back and the app itself plays the two radar images (16 strips each)
  const half = (S.music[1] - S.music[0]) / 2;
  __at(S.music[0]); Sonify.playScan(lake.kind, lake.scans[T.waterPasses.at(-1)], half - 0.1);
  __at(S.music[0] + half); Sonify.playScan(fire.kind, fire.scans[T.firePasses.at(-1)], half - 0.1); quiet();
  // return of the theme under Live world, rising
  [[20, 65, 0.08], [21, 70, 0.08], [22, 74, 0.09], [23, 77, 0.09], [24, 76, 0.09], [25, 79, 0.1], [26, 76, 0.09]].forEach(([t, m, g]) => piano(t, m, g, 2.4));
  // low hits on the big cuts, swells into them, four growing hits on the quick cuts, and the final chord
  [[S.clouds[0], 0.22], [S.water[0], 0.3], [S.fire[0], 0.36], [S.music[0], 0.3], [S.live[0], 0.36]].forEach(([t, g]) => hit(t, g));
  [[S.water[0] - 1, S.water[0], 0.03], [S.fire[0] - 1, S.fire[0], 0.035], [S.live[0] - 1.2, S.live[0], 0.04], [S.montage[0], S.end[0], 0.06]].forEach(([a, b, g]) => riser(a, b, g));
  [0, 1, 2, 3].forEach((k) => hit(S.montage[0] + k * 0.5, 0.2 + k * 0.05));
  hit(S.end[0], 0.55); [50, 62, 69, 74].forEach((m, k) => piano(S.end[0], m, 0.11 - k * 0.012, 4.5));
  __A.master.gain.setValueAtTime(1, T.total - 1.3); __A.master.gain.linearRampToValueAtTime(0.0001, T.total - 0.05);
  return JSON.stringify({ ...JSON.parse(await __wav()), scans: { lake: lake.scans[T.waterPasses.at(-1)], fire: fire.scans[T.firePasses.at(-1)] } });
})()
""" % json.dumps(T)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, executable_path=CHROME, args=["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--autoplay-policy=no-user-gesture-required"])
        page = await (await b.new_context(viewport={"width": 1280, "height": 800})).new_page()
        page.on("pageerror", lambda e: print("PAGEERROR", str(e)[:300]))
        await page.add_init_script(INIT)
        await page.goto(f"http://localhost:8080/?t={int(time.time())}#site=tonle-sap"); await page.wait_for_timeout(4000)
        r = json.loads(await page.evaluate(SCORE))
        (OUT / "music.wav").write_bytes(base64.b64decode(r["b64"]))
        (OUT / "scans.js").write_text("window.SCANS = " + json.dumps(r["scans"]) + ";\nwindow.TL = " + json.dumps(T) + ";\n")
        print("peak before normalising:", round(r["peak"], 3), "bytes:", (OUT / "music.wav").stat().st_size)
        await b.close()
asyncio.run(main())
