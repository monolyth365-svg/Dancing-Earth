"""Dancing Earth – ke každému radarovému přeletu stáhne optickou fotku ze stejného dne (NASA GIBS, VIIRS).

Účel: ukázat, co by ten den viděla družice s kamerou (často jen mraky), vedle radaru, který vidí skrz.
Fotka se převzorkuje do stejné mřížky jako radarový výřez, takže jde v aplikaci porovnat posuvníkem.
Token není potřeba. Spouštět až po fetch_nisar.py (ten series.json vytváří znovu).

Spuštění:  .venv/bin/python pipeline/fetch_optical.py [site_id ...]
"""
import io, json, sys
from pathlib import Path
import numpy as np, requests
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "data"
WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
# Denní snímky v pravých barvách, 250 m na pixel; zkouší se v tomto pořadí, dokud některý nepokryje výřez
LAYERS = ["VIIRS_NOAA20_CorrectedReflectance_TrueColor", "VIIRS_NOAA21_CorrectedReflectance_TrueColor",
          "VIIRS_SNPP_CorrectedReflectance_TrueColor"]
SIZE, SRC = 512, 640


def fetch(layer, date, bbox):
    w, s, e, n = bbox
    r = requests.get(WMS, timeout=120, params=dict(
        SERVICE="WMS", REQUEST="GetMap", VERSION="1.3.0", LAYERS=layer, CRS="EPSG:4326",
        BBOX=f"{s},{w},{n},{e}", WIDTH=SRC, HEIGHT=SRC, FORMAT="image/jpeg", TIME=date))
    if "image" not in r.headers.get("content-type", ""):
        return None
    return np.asarray(Image.open(io.BytesIO(r.content)).convert("RGB"), "float32")


def to_grid(img, bbox, corners):
    """Převzorkuje fotku (osy = zeměpisná délka/šířka) do mřížky radarového výřezu určené jeho rohy."""
    w, s, e, n = bbox
    tl, tr, _, bl = (np.array(c) for c in corners)
    u, v = np.meshgrid((np.arange(SIZE) + 0.5) / SIZE, (np.arange(SIZE) + 0.5) / SIZE)
    lon = tl[0] + u * (tr[0] - tl[0]) + v * (bl[0] - tl[0])
    lat = tl[1] + u * (tr[1] - tl[1]) + v * (bl[1] - tl[1])
    x = np.clip(((lon - w) / (e - w) * SRC).astype(int), 0, SRC - 1)
    y = np.clip(((n - lat) / (n - s) * SRC).astype(int), 0, SRC - 1)
    return img[y, x]


def cloud_share(rgb):
    """Hrubý odhad oblačnosti: světlé a málo barevné pixely (mrak je bílý až šedý, povrch barevný a tmavší)."""
    bright, colour = rgb.mean(2), rgb.max(2) - rgb.min(2)
    return float(((bright > 135) & (colour < 45)).mean())


def process(site_id):
    d = OUT / site_id
    meta = json.loads((d / "series.json").read_text())
    lons, lats = [c[0] for c in meta["corners"]], [c[1] for c in meta["corners"]]
    bbox = (min(lons), min(lats), max(lons), max(lats))
    used = set()
    for fr in meta["frames"]:
        fr["optical"], fr["cloudPct"] = None, None
        for layer in LAYERS:
            img = fetch(layer, fr["date"], bbox)
            if img is None:
                continue
            img = to_grid(img, bbox, meta["corners"])
            if (img.mean(2) < 5).mean() > 0.2:  # černé pruhy = družice ten den výřez nepokryla
                continue
            Image.fromarray(img.astype("uint8")).save(d / f"{fr['date']}_optical.jpg", quality=80)
            fr["optical"], fr["cloudPct"] = f"{fr['date']}_optical.jpg", round(cloud_share(img) * 100)
            fr["opticalLayer"] = layer
            used.add(layer.split("_Corrected")[0].replace("_", " "))
            break
        print(" ", fr["date"], fr.get("opticalLayer", "—"), "oblačnost", fr["cloudPct"], "%")
    meta["optical"] = {"source": "NASA GIBS, Corrected Reflectance (True Color)", "sensors": sorted(used), "pixelM": 250,
                       "cloudRule": "bright (mean RGB > 135) and colourless (max − min < 45) pixels"}
    (d / "series.json").write_text(json.dumps(meta, indent=1))


if __name__ == "__main__":
    for s in sys.argv[1:] or [x["id"] for x in json.loads((OUT / "sites.json").read_text())]:
        print(s)
        process(s)
