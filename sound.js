// Převod změn povrchu na zvuk (Web Audio, žádné nahrávky – nic s licencí).
window.Sonify = (() => {
  let ctx;
  const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21]; // pentatonika – vždy zní dobře
  const audio = () => (ctx ??= new AudioContext());

  function note(freq, { type = "sine", dur = 0.5, gain = 0.15, attack = 0.02 } = {}) {
    const a = audio(), t = a.currentTime;
    const o = a.createOscillator(), g = a.createGain(), f = a.createBiquadFilter();
    o.type = type; o.frequency.value = freq;
    f.type = "lowpass"; f.frequency.value = 2200;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(a.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function drum(depth) {
    const a = audio(), t = a.currentTime;
    const o = a.createOscillator(), g = a.createGain();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.4);
    g.gain.setValueAtTime(Math.min(0.6, 0.15 + depth), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + 0.55);
  }

  const pitch = (v) => {
    const i = Math.max(0, Math.min(scale.length - 1, Math.round(v * (scale.length - 1))));
    return 196 * Math.pow(2, scale[i] / 12);
  };

  // kind: water | forest | crops; v = normalizovaná hodnota 0–1; delta = změna oproti minulému snímku 0–1
  function play(kind, v, delta) {
    if (kind === "water") {
      note(pitch(v) / 2, { type: "sawtooth", dur: 0.9, gain: 0.06, attack: 0.25 });
      note(pitch(v), { type: "sine", dur: 0.9, gain: 0.08, attack: 0.2 });
    } else if (kind === "forest") {
      note(pitch(v), { type: "triangle", dur: 0.6, gain: 0.1 });
      if (delta < -0.08) drum(-delta);
    } else {
      note(pitch(v), { type: "square", dur: 0.25, gain: 0.04 });
      note(pitch(v) * 1.5, { type: "sine", dur: 0.4, gain: 0.06 });
    }
  }
  // Hudba z obrazu: pruhy zleva doprava, jas = výška tónu, změna = hlasitost, poloha = stereo
  function playScan(kind, cols, dur) {
    const a = audio(), t0 = a.currentTime + 0.02, step = dur / cols.length;
    const type = { water: "sine", fire: "sawtooth", forest: "triangle", crops: "square" }[kind] || "sine";
    const levels = cols.filter(Boolean).map((c) => c.level);
    const lo = Math.min(...levels), hi = Math.max(...levels);
    cols.forEach((c, k) => {
      if (!c) return;
      const change = Math.min(1, Math.abs(c.delta) / 3); // 3 dB = plná hlasitost
      const o = a.createOscillator(), g = a.createGain(), f = a.createBiquadFilter(), p = a.createStereoPanner();
      const t = t0 + k * step;
      o.type = type;
      o.frequency.value = pitch(hi > lo ? (c.level - lo) / (hi - lo) : 0.5) * (c.delta < -0.5 ? 0.5 : 1);
      f.type = "lowpass"; f.frequency.value = 900 + change * 2600;
      p.pan.value = (k / (cols.length - 1)) * 2 - 1;
      const peak = (type === "sine" || type === "triangle" ? 0.05 : 0.02) + change * 0.16;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + step * 2.2);
      o.connect(f).connect(g).connect(p).connect(a.destination);
      o.start(t); o.stop(t + step * 2.4);
    });
    const drop = Math.min(...cols.filter(Boolean).map((c) => c.delta));
    if (drop < -1.5) drum(Math.min(0.4, -drop / 10));
  }
  return { play, playScan, resume: () => audio().resume() };
})();
