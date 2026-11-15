"""How long is every caption on screen, and is that enough to read it? python video/captions.py  (after recording)"""
import json, re
from pathlib import Path
from walk_script import CHAPTERS
D = Path(__file__).parent / "out" / "walk"; total = 0
for name in [n for n in CHAPTERS if not n.startswith("_")]:
    m = json.loads((D / name / "meta.json").read_text()); t0 = m["ts"][0]; dur = m["end"] - t0; total += dur
    print(f"{name}: {dur:.1f} s")
    subs = m["subs"]
    for k, sub in enumerate(subs):
        end = subs[k + 1]["t"] if k + 1 < len(subs) else m["end"]; text = re.sub(r"<[^>]+>", "", sub["html"]); d = end - sub["t"]
        print(f"   {'!!' if len(text) / d > 17.5 else '  '} {d:4.1f} s  {len(text) / d:4.1f} ch/s  {text[:74]}")
print(f"TOTAL {total:.1f} s = {int(total // 60)}:{total % 60:04.1f}")
