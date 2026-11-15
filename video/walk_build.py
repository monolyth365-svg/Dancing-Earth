"""Put the recorded chapters together: python video/walk_build.py  ->  video/out/dancing-earth-walkthrough.mp4
Frames keep their recorded timing. If the whole take runs over the target length it is played a few percent faster
(picture and the app's sound together, the sound without changing pitch). The app's own recorded sound is mixed
over the quiet background music, which steps back whenever the app plays something."""
import json, subprocess, sys, wave
from pathlib import Path
import numpy as np, imageio_ffmpeg
from walk_script import CHAPTERS
HERE = Path(__file__).parent; D = HERE / "out" / "walk"; FF = imageio_ffmpeg.get_ffmpeg_exe()
TARGET = 299.0; SR = 48000   # whole video, preview included (the limit is five minutes)
TEASER = HERE / "out" / "walk" / "intro"; N_T = len(list(TEASER.glob("f*.jpg"))); T_T = N_T / 30   # the motion intro in front (video/intro.html, video/walk_intro.py)
names = [n for n in CHAPTERS if not n.startswith("_")]
metas = {n: json.loads((D / n / "meta.json").read_text()) for n in names}
durs = {n: metas[n]["end"] - metas[n]["ts"][0] for n in names}; total = sum(durs.values())
speed = max(1.0, total / (TARGET - T_T)); print(f"intro {T_T:.1f} s + recorded {total:.1f} s at speed x{speed:.3f} = {T_T + total / speed:.1f} s")
if speed > 1.07: sys.exit("more than 7 % too long: shorten the script instead of speeding up")

# picture: every frame with the time it stayed on screen
lines = []
for i in range(N_T): lines += [f"file '{(TEASER / f'f{i:05d}.jpg').as_posix()}'", f"duration {1 / 30:.5f}"]
for n in names:
    ts = metas[n]["ts"] + [metas[n]["end"]]
    for i in range(len(ts) - 1): lines += [f"file '{(D / n / f'f{i:05d}.jpg').as_posix()}'", f"duration {max(0.001, (ts[i + 1] - ts[i]) / speed):.5f}"]
lines.append(lines[-2]); (D / "frames.txt").write_text("\n".join(lines))

# sound of the app, chapter after chapter
def read(p):
    w = wave.open(str(p)); return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).reshape(-1, 2).astype(np.float32) / 32768
def write(p, a):
    with wave.open(str(p), "wb") as w: w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(a, -1, 1) * 32767).astype(np.int16).tobytes())
parts = []
for n in names:
    a = read(D / n / "audio.wav"); m = int(round(durs[n] * SR)); parts.append(np.pad(a, ((0, max(0, m - len(a))), (0, 0)))[:m])
write(D / "app_raw.wav", np.concatenate(parts))
subprocess.run([FF, "-y", "-loglevel", "error", "-i", str(D / "app_raw.wav"), "-af", f"atempo={speed:.5f}", str(D / "app.wav")], check=True)
app = read(D / "app.wav"); n_out = int(round((T_T + total / speed) * SR))
app = np.concatenate([np.zeros((int(round(T_T * SR)), 2), dtype=np.float32), app]); app = np.pad(app, ((0, max(0, n_out - len(app))), (0, 0)))[:n_out]   # the intro has music only
subprocess.run([sys.executable, str(HERE / "walk_music.py"), f"{T_T + total / speed:.2f}", f"{T_T:.2f}"], check=True)
bed = read(D / "bed.wav"); bed = np.pad(bed, ((0, max(0, n_out - len(bed))), (0, 0)))[:n_out]
# the music steps back while the app is heard (smoothed loudness of the app's sound, 0.25 s attack, about 1 s release)
env = np.abs(app).max(axis=1); hop = 480; e = env[: len(env) // hop * hop].reshape(-1, hop).max(axis=1); sm = np.zeros_like(e); v = 0.0
for i, x in enumerate(e): v = max(x, v * 0.985) if x > v else v * 0.985 + x * 0.015; sm[i] = v
duck = 1 - 0.62 * np.clip(sm / 0.02, 0, 1); duck = np.convolve(duck, np.ones(25) / 25, mode="same")
duck = np.interp(np.arange(n_out), np.arange(len(duck)) * hop, duck)[:, None]
app_peak = float(np.abs(app).max()) or 1.0
mix = bed * 0.5 * duck + app * (0.8 / app_peak)
write(D / "mix.wav", mix / max(1.0, float(np.abs(mix).max()) / 0.95))
print(f"app sound: {(env > 1e-3).sum() / SR:.1f} s, peak {app_peak:.2f}; music steps back to {duck.min():.2f}")

dst = HERE / "out" / "dancing-earth-walkthrough.mp4"
# the same clear "AI-assisted video" tag in the corner of the caption band on every chapter (older takes carried a smaller note)
vf = (f"[0:v]crop=1920:1080:0:0,fps=30[a];[a][2:v]overlay=1580:952:enable='gte(t,{T_T:.3f})',scale=in_range=full:out_range=tv,format=yuv420p[v]")
subprocess.run([FF, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(D / "frames.txt"), "-i", str(D / "mix.wav"), "-i", str(D / "mark_patch.png"),
                "-filter_complex", vf, "-map", "[v]", "-map", "1:a", "-color_range", "tv",
                "-af", "loudnorm=I=-17:TP=-1.5:LRA=11", "-c:v", "libx264", "-preset", "medium", "-crf", sys.argv[1] if len(sys.argv) > 1 else "21",
                "-c:a", "aac", "-ar", "48000", "-b:a", "192k", "-t", f"{T_T + total / speed:.2f}", "-movflags", "+faststart", str(dst)], check=True)
print("written", dst, round(dst.stat().st_size / 1e6, 1), "MB")
