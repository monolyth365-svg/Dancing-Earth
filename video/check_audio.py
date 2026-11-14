"""Numbers that stand in for ears: loudness over time, balance of low / middle / high, and which notes sound in each bar."""
import wave, sys, numpy as np
w = wave.open(sys.argv[1] if len(sys.argv) > 1 else "video/out/music.wav"); a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).reshape(-1, 2) / 32768
sr = w.getframerate(); m = a.mean(axis=1)
print("loudness per second:", " ".join(f"{float(np.sqrt((m[i:i + sr] ** 2).mean())):.2f}" for i in range(0, len(m), sr)))
print("clipped samples:", int((np.abs(a) > 0.999).sum()), " stereo difference:", round(float(np.abs(a[:, 0] - a[:, 1]).mean() / (np.abs(a).mean() + 1e-9)), 2))
F = np.abs(np.fft.rfft(m)); f = np.fft.rfftfreq(len(m), 1 / sr); tot = (F ** 2).sum()
for lo, hi in [(0, 60), (60, 150), (150, 500), (500, 2000), (2000, 8000)]: print(f"  {lo}-{hi} Hz: {float((F[(f >= lo) & (f < hi)] ** 2).sum() / tot):.2f}", end="")
print()
names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
for a0 in range(0, 28, 4):
    seg = m[a0 * sr:(a0 + 4) * sr] * np.hanning(4 * sr); S = np.abs(np.fft.rfft(seg)) ** 2; fr = np.fft.rfftfreq(len(seg), 1 / sr)
    pc = np.zeros(12)
    for k in np.nonzero((fr > 60) & (fr < 1200))[0]: pc[int(round(69 + 12 * np.log2(fr[k] / 440))) % 12] += S[k]
    top = np.argsort(-pc)[:4]; print(f"  bar {a0:>2}-{a0 + 4:<2} s strongest notes:", " ".join(f"{names[i]}({pc[i] / pc.sum():.2f})" for i in top))
