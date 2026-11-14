"""Contact sheet of a recorded chapter: python video/sheet.py <chapter> [columns] [rows] -> video/out/walk/<chapter>_sheet.jpg"""
import json, sys, bisect
from pathlib import Path
from PIL import Image
d = Path(__file__).parent / "out" / "walk" / sys.argv[1]; cols = int(sys.argv[2]) if len(sys.argv) > 2 else 4; rows = int(sys.argv[3]) if len(sys.argv) > 3 else 4
m = json.loads((d / "meta.json").read_text()); ts = m["ts"]; n = cols * rows; dur = m["end"] - ts[0]
w = 1920 // cols; h = w * 9 // 16; sh = Image.new("RGB", (cols * w, rows * h))
for k in range(n):
    t = ts[0] + dur * (k + 0.5) / n; i = max(0, bisect.bisect_right(ts, t) - 1)
    sh.paste(Image.open(d / f"f{i:05d}.jpg").resize((w, h)), ((k % cols) * w, (k // cols) * h))
sh.save(d.parent / f"{sys.argv[1]}_sheet.jpg", quality=84); im = Image.open(d / "f00000.jpg")
print(sys.argv[1], "frames", len(ts), "size", im.size, "duration", round(dur, 1), "s, mean fps", round(len(ts) / dur, 1), "longest gap", round(max(b - a for a, b in zip(ts, ts[1:] + [m["end"]])), 2))
