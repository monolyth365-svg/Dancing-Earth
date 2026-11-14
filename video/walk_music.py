"""Quiet background music for the five-minute walkthrough, synthesized in code (no recordings, no music model).
The same instruments and key as the 30-second video (video/score.py), but calm: slow string chords in D minor,
a soft bass and a few piano notes. Usage: python video/walk_music.py <seconds>  ->  video/out/walk/bed.wav"""
import asyncio, base64, json, sys
from pathlib import Path
from playwright.async_api import async_playwright
OUT = Path(__file__).parent / "out" / "walk"; SEC = float(sys.argv[1]) if len(sys.argv) > 1 else 296.0
INTRO = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0   # length of the motion intro in front (0 = none)
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
JS = """
(async () => {
  const TOTAL = %f, INTRO = %f, SR = 48000, off = new OfflineAudioContext(2, Math.ceil(SR * TOTAL), SR);
  let seed = 20261115; const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const master = off.createGain(), comp = off.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.02; comp.release.value = 0.4; master.connect(comp); comp.connect(off.destination);
  const irLen = Math.floor(SR * 3.6), ir = off.createBuffer(2, irLen, SR);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); let y = 0; for (let i = Math.floor(SR * 0.02); i < irLen; i++) { y += 0.28 * ((rnd() * 2 - 1) - y); d[i] = y * Math.exp(-(i / SR) / 0.55); } }
  const conv = off.createConvolver(); conv.buffer = ir; const wet = off.createGain(); wet.gain.value = 0.9; conv.connect(wet); wet.connect(master);
  const bus = (dry, send) => { const g = off.createGain(), d = off.createGain(), s = off.createGain(); d.gain.value = dry; s.gain.value = send; g.connect(d); d.connect(master); g.connect(s); s.connect(conv); return g; };
  const PAD = bus(2.6, 1.3), SUB = bus(0.3, 0.02), PIANO = bus(1.7, 1.2), HIT = bus(0.7, 0.4), AIR = bus(1.3, 0.7);
  const noise = off.createBuffer(1, SR * 4, SR); { const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1; }
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const env = (g, t, a, peak, hold, r) => { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setValueAtTime(peak, t + a + hold); g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + r); };
  function pad(t, dur, midi, gain, c0, c1) { const f = off.createBiquadFilter(), g = off.createGain(); f.type = "lowpass"; f.Q.value = 0.5; f.frequency.setValueAtTime(c0, t); f.frequency.linearRampToValueAtTime(c1, t + dur);
    env(g, t, 2.4, gain, Math.max(0.01, dur - 2.4), 3.2); f.connect(g); g.connect(PAD);
    for (const cents of [-9, 0, 8]) { const o = off.createOscillator(); o.type = "sawtooth"; o.frequency.value = hz(midi); o.detune.value = cents; o.connect(f); o.start(t); o.stop(Math.min(TOTAL, t + dur + 3.4)); } }
  function sub(t, dur, midi, gain) { const o = off.createOscillator(), g = off.createGain(); o.type = "sine"; o.frequency.value = hz(midi); env(g, t, 1.0, gain, Math.max(0.01, dur - 1.0), 1.6); o.connect(g); g.connect(SUB); o.start(t); o.stop(Math.min(TOTAL, t + dur + 1.8));
    const o2 = off.createOscillator(), g2 = off.createGain(), f2 = off.createBiquadFilter(); o2.type = "triangle"; o2.frequency.value = hz(midi + 12); f2.type = "lowpass"; f2.frequency.value = 480; env(g2, t, 0.8, gain * 0.2, Math.max(0.01, dur - 0.8), 1.6); o2.connect(f2); f2.connect(g2); g2.connect(PAD); o2.start(t); o2.stop(Math.min(TOTAL, t + dur + 1.8)); }
  function piano(t, midi, gain, decay = 3.2) { [[1, 1], [2, 0.3], [3, 0.09]].forEach(([mult, amp]) => { const o = off.createOscillator(), g = off.createGain(); o.type = "sine"; o.frequency.value = hz(midi) * mult;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain * amp, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + decay / mult); o.connect(g); g.connect(PIANO); o.start(t); o.stop(Math.min(TOTAL, t + decay / mult + 0.05)); }); }
  // low hit and a breath of noise, used only under the motion intro (its cuts) and at the moment the tour begins
  function hit(t, gain) { const o = off.createOscillator(), g = off.createGain(); o.type = "sine"; o.frequency.setValueAtTime(82, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.7);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4); o.connect(g); g.connect(HIT); o.start(t); o.stop(t + 2.5);
    const n = off.createBufferSource(), f = off.createBiquadFilter(), ng = off.createGain(); n.buffer = noise; f.type = "lowpass"; f.frequency.value = 260;
    ng.gain.setValueAtTime(0.0001, t); ng.gain.linearRampToValueAtTime(gain * 0.9, t + 0.005); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.5); n.connect(f); f.connect(ng); ng.connect(HIT); n.start(t); n.stop(t + 0.6); }
  function riser(t0, t1, gain) { const n = off.createBufferSource(), f = off.createBiquadFilter(), g = off.createGain(); n.buffer = noise; n.loop = true; f.type = "bandpass"; f.Q.value = 0.9;
    f.frequency.setValueAtTime(350, t0); f.frequency.exponentialRampToValueAtTime(4200, t1); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t1 - 0.02); g.gain.linearRampToValueAtTime(0.0001, t1 + 0.04);
    n.connect(f); f.connect(g); g.connect(AIR); n.start(t0); n.stop(t1 + 0.1); }
  if (INTRO > 0) {
    [[0.06, 0.3], [1.7, 0.22], [2.3, 0.24], [2.9, 0.26], [3.5, 0.3], [INTRO, 0.26]].forEach(([t, g]) => hit(t, g));
    riser(INTRO - 1.3, INTRO, 0.045);
    [[0.25, 62, 0.1], [0.4, 69, 0.09], [0.95, 74, 0.08]].forEach(([t, m, g]) => piano(t, m, g, 3.5)); // three notes as the title rises
  }
  // D minor, one chord every eight seconds: Dm - Bb - F - C, round and round; the last bar comes home to Dm
  const CH = { Dm: { bass: 38, notes: [50, 57, 62, 65] }, Bb: { bass: 34, notes: [46, 53, 58, 62] }, F: { bass: 41, notes: [53, 57, 60, 65] }, C: { bass: 36, notes: [48, 55, 60, 64] } }, order = ["Dm", "Bb", "F", "C"], BAR = 8;
  const bars = Math.ceil(TOTAL / BAR);
  for (let k = 0; k < bars; k++) {
    const a = k * BAR, name = k === bars - 1 ? "Dm" : order[k %% 4], c = CH[name], b = Math.min(TOTAL, a + BAR), swell = 0.75 + 0.25 * Math.sin((k / bars) * Math.PI * 3); // the strings breathe slowly over the whole piece
    c.notes.forEach((m, j) => pad(a, b - a, m, 0.02 * swell * (j === 3 ? 0.8 : 1), 420 + swell * 260, 620 + swell * 700));
    sub(a, b - a, c.bass, 0.15);
    // two or three piano notes per bar, taken from the chord and its neighbours, never on a fixed beat
    const pool = [c.notes[1] + 12, c.notes[2] + 12, c.notes[3] + 12, c.notes[0] + 24, c.notes[2]];
    let t = a + 0.6 + rnd() * 1.2;
    while (t < b - 1.2) { piano(t, pool[Math.floor(rnd() * pool.length)], 0.05 + rnd() * 0.03); t += 2.1 + rnd() * 2.6; }
  }
  master.gain.setValueAtTime(INTRO > 0 ? 1 : 0.0001, 0); master.gain.linearRampToValueAtTime(1, 2.5); master.gain.setValueAtTime(1, TOTAL - 5); master.gain.linearRampToValueAtTime(0.0001, TOTAL - 0.1);
  const buf = await off.startRendering(), L = buf.getChannelData(0), R = buf.getChannelData(1), n = L.length;
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const g = 0.7 / (peak || 1), out = new Int16Array(n * 2); for (let i = 0; i < n; i++) { out[2 * i] = L[i] * g * 32767; out[2 * i + 1] = R[i] * g * 32767; }
  const u = new Uint8Array(out.buffer); let s = ""; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768));
  return btoa(s);
})()
""" % (SEC, INTRO)
async def main():
    import wave
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, executable_path=CHROME, args=["--mute-audio"])
        page = await b.new_page(); await page.goto("about:blank")
        raw = base64.b64decode(await page.evaluate(JS)); await b.close()
    with wave.open(str(OUT / "bed.wav"), "wb") as w: w.setnchannels(2); w.setsampwidth(2); w.setframerate(48000); w.writeframes(raw)
    print("bed.wav", round(len(raw) / 4 / 48000, 1), "s")
asyncio.run(main())
