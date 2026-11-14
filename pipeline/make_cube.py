"""Z PNG snímků složí kompaktní datovou kostku pro klikání v mapě.

Výstup: web/data/<site>/cube.bin  = Int16 (dB*100, -32768 = bez dat), tvar [pol(2: HH,HV), snímek, N, N]
Rozsah dB odpovídá to_png() ve fetch_nisar.py (HH −25..0, HV −32..−8), krok ~0,1 dB.
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
N = 128
RANGES = {"hh": (-25, 0), "hv": (-32, -8)}


def load(path, lo, hi):
    if not path or not path.exists():
        return np.full((N, N), -32768, "int16")
    a = np.asarray(Image.open(path).convert("RGBA").resize((N, N), Image.BILINEAR), "float32")
    db = lo + a[..., 0] / 255 * (hi - lo)
    out = np.round(db * 100).astype("int16")
    out[a[..., 3] < 128] = -32768
    return out


def build(site):
    d = ROOT / "web" / "data" / site
    meta = json.loads((d / "series.json").read_text())
    cube = np.stack([
        np.stack([load(d / f[p] if f.get(p) else None, *RANGES[p]) for f in meta["frames"]])
        for p in ("hh", "hv")
    ])
    cube.astype("<i2").tofile(d / "cube.bin")
    meta["cube"] = {"file": "cube.bin", "size": N, "pols": ["hh", "hv"], "scale": 100, "nodata": -32768}
    (d / "series.json").write_text(json.dumps(meta, indent=1))
    print(site, cube.shape, f"{(d / 'cube.bin').stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    for s in sys.argv[1:] or [x["id"] for x in json.loads((ROOT / "web" / "data" / "sites.json").read_text())]:
        build(s)
