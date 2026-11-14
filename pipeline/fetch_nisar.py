"""Dancing Earth – stáhne malé výřezy z NISAR L2 GCOV a připraví data pro web.

Čte HDF5 přímo přes HTTP (jen potřebné bloky, ne celé GB soubory).
Token: EARTHDATA_TOKEN v souboru .env (nikdy necommitovat).

Spuštění:  .venv/bin/python pipeline/fetch_nisar.py [site_id ...]
           --analyze-only  jen přepočítá čísla a mapy změn z uložených výřezů
"""
import io, json, os, sys
from pathlib import Path
import numpy as np, requests, h5py
from PIL import Image
from pyproj import Transformer

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "data"
SITES = json.loads((ROOT / "pipeline" / "sites.json").read_text())
SEARCH = "https://api.daac.asf.alaska.edu/services/search/param"
SIZE = 512  # výstupní obrázek SIZE×SIZE


def token():
    env = ROOT / ".env"
    for line in env.read_text().splitlines() if env.exists() else []:
        if line.startswith("EARTHDATA_TOKEN="):
            return line.split("=", 1)[1].strip()
    t = os.environ.get("EARTHDATA_TOKEN")
    if not t:
        sys.exit("Chybí EARTHDATA_TOKEN v .env")
    return t


def search(site):
    lon, lat = site["center"]
    p = dict(platform="NISAR", processingLevel="GCOV", output="jsonlite", maxResults=500,
             intersectsWith=f"POINT({lon} {lat})")
    if site.get("start"):
        p["start"] = site["start"]
    res = requests.get(SEARCH, params=p, timeout=120).json()["results"]
    # jedna dráha = stejná geometrie → srovnatelná časová řada
    # číslo dráhy je v názvu souboru (…_GCOV_<cyklus>_<dráha>_<směr>_<frame>_…); bez něj by se míchaly sousední dráhy
    key = lambda r: (r["granuleName"].split("_")[5], r["frame"], r["flightDirection"])
    # "track" v sites.json dráhu připíchne; jinak vyhraje ta s nejvíce přelety (při shodě nižší číslo, ne náhoda)
    if site.get("track"):
        res = [r for r in res if key(r)[0] == site["track"]]
    best = max(sorted({key(r) for r in res}), key=lambda k: sum(key(r) == k for r in res))
    rows = sorted([r for r in res if key(r) == best], key=lambda r: r["startTime"])
    # duplicitní verze stejného přeletu → nechat poslední
    by_time = {}
    for r in rows:
        by_time[r["startTime"][:16]] = r
    return list(by_time.values()), best


def find(h5, names):
    hits = []
    h5.visititems(lambda n, o: hits.append(n) if isinstance(o, h5py.Dataset) and n.split("/")[-1] in names else None)
    return hits


class RangeFile(io.RawIOBase):
    """Soubor přes HTTP Range: token jen na ASF, pak podepsaná S3 adresa bez tokenu. Bloky 4 MB v cache."""
    BLOCK = 4 * 1024 * 1024

    def __init__(self, url, tok):
        r = requests.get(url, headers={"Authorization": f"Bearer {tok}", "Range": "bytes=0-0"},
                         allow_redirects=False, timeout=60)
        self.url = r.headers.get("location") or url
        r = requests.get(self.url, headers={"Range": "bytes=0-0"}, timeout=60)
        r.raise_for_status()
        self.size = int(r.headers["Content-Range"].split("/")[1])
        self.pos, self.cache, self.s = 0, {}, requests.Session()
        self.fetched = 0

    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.pos

    def seek(self, off, whence=0):
        self.pos = {0: off, 1: self.pos + off, 2: self.size + off}[whence]
        return self.pos

    def _block(self, i):
        if i not in self.cache:
            a = i * self.BLOCK
            b = min(a + self.BLOCK, self.size) - 1
            r = self.s.get(self.url, headers={"Range": f"bytes={a}-{b}"}, timeout=120)
            r.raise_for_status()
            self.cache[i] = r.content
            self.fetched += len(r.content)
        return self.cache[i]

    def readinto(self, buf):
        n = min(len(buf), self.size - self.pos)
        out, done = memoryview(buf), 0
        while done < n:
            i, o = divmod(self.pos + done, self.BLOCK)
            chunk = self._block(i)[o:o + n - done]
            out[done:done + len(chunk)] = chunk
            done += len(chunk)
        self.pos += n
        return n


def read_window(url, tok, site):
    """Vrátí výřez v lineárním výkonu (ne dB), aby šel správně průměrovat."""
    f = RangeFile(url, tok)
    with h5py.File(f, "r") as h5:
        # frequencyB (hrubší mřížka) stačí na 512 px výstup a stahuje se ~16× méně dat
        grids = [p.rsplit("/", 1)[0] for p in find(h5, {"HHHH"}) if "/grids/" in p]
        grid = next((g for g in grids if g.endswith("frequencyB")), grids[0])
        g = h5[grid]
        xs, ys = g["xCoordinates"][:], g["yCoordinates"][:]
        epsg = int(g["projection"][()])
        tr = Transformer.from_crs(4326, epsg, always_xy=True)
        cx, cy = tr.transform(*site["center"])
        half = site["sizeKm"] * 500
        ix = np.searchsorted(xs, [cx - half, cx + half])
        iy = sorted(np.searchsorted(-ys, [-(cy + half), -(cy - half)]))
        if ix[1] - ix[0] < 10 or iy[1] - iy[0] < 10:
            return None
        bands = {}
        for pol in ("HHHH", "HVHV"):
            if pol in g:
                a = g[pol][iy[0]:iy[1], ix[0]:ix[1]].astype("float32")
                a[(a <= 0) | ~np.isfinite(a)] = np.nan
                bands[pol] = a
        inv = Transformer.from_crs(epsg, 4326, always_xy=True)
        x0, x1, y0, y1 = xs[ix[0]], xs[ix[1] - 1], ys[iy[0]], ys[iy[1] - 1]
        corners = [inv.transform(x, y) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
        info = f"{grid.rsplit('/', 1)[1]} {abs(xs[1] - xs[0]):.0f} m"
        return bands, corners, info


def resize(a):
    """Plošný průměr v lineárním výkonu → dB. Průměrovat až dB by zkreslilo tmavé plochy
    (a různě podle režimu snímání), proto se průměruje výkon."""
    ok = np.isfinite(a)
    box = lambda x: np.array(Image.fromarray(x.astype("float32"), mode="F").resize((SIZE, SIZE), Image.BOX))
    w = box(ok)
    with np.errstate(divide="ignore", invalid="ignore"):
        m = box(np.where(ok, a, 0)) / w
        db = 10 * np.log10(m)
    db[(w < 0.5) | ~np.isfinite(db)] = np.nan
    return db


def box(a, k):
    """Klouzavý průměr k×k (okraje se opakují)."""
    r = k // 2
    c = np.cumsum(np.cumsum(np.pad(a, r, mode="edge"), 0, dtype="float64"), 1)
    c = np.pad(c, ((1, 0), (1, 0)))
    return ((c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)).astype("float32")


def smooth(db, k):
    """Vyhlazení v lineárním výkonu (potlačí radarový šum – speckle)."""
    ok = np.isfinite(db)
    w = box(ok.astype("float32"), k)
    with np.errstate(divide="ignore", invalid="ignore"):
        out = 10 * np.log10(box(np.where(ok, 10 ** (db / 10), 0), k) / w)
    out[~ok] = np.nan
    return out


def to_png(a, lo, hi, path, mask=None):
    v = np.clip((np.nan_to_num(a, nan=lo) - lo) / (hi - lo), 0, 1)
    rgba = np.dstack([v * 255] * 3 + [np.full_like(v, 255)]).astype("uint8")
    if mask is not None:
        rgba[~mask, 3] = 0
    Image.fromarray(rgba, "RGBA").save(path, optimize=True)


def process(site_id):
    site = SITES[site_id]
    tok = token()
    granules, track = search(site)
    print(f"{site_id}: {len(granules)} přeletů, dráha {track}")
    d = OUT / site_id
    d.mkdir(parents=True, exist_ok=True)
    for old in list(d.glob("*.png")) + list(d.glob("*.npy")):
        old.unlink()
    frames, corners = [], None
    for r in granules:
        name = r["granuleName"]
        date = r["startTime"][:10]
        try:
            got = read_window(r["downloadUrl"], tok, site)
        except Exception as e:  # jeden vadný soubor nesmí shodit celé místo
            print("  přeskočeno", date, type(e).__name__, e)
            continue
        if not got:
            print("  mimo výřez", date)
            continue
        bands, c, info = got
        if site.get("dualPolOnly") and "HVHV" not in bands:
            print("  bez HV, vynecháno", date)
            continue
        corners = corners or c
        hh = resize(bands["HHHH"])
        hv = resize(bands["HVHV"]) if "HVHV" in bands else None
        valid = np.isfinite(hh)
        to_png(hh, -25, 0, d / f"{date}_hh.png", valid)
        np.save(d / f"{date}_hh.npy", hh.astype("float16"))
        if hv is not None:
            to_png(hv, -32, -8, d / f"{date}_hv.png", valid)
            np.save(d / f"{date}_hv.npy", hv.astype("float16"))
        frames.append({"date": date, "granule": name, "mode": name.split("_")[9], "grid": info,
                       "hh": f"{date}_hh.png", "hv": f"{date}_hv.png" if hv is not None else None})
        print("  ok", date, info, "HV" if hv is not None else "bez HV")
    meta = {**{k: site[k] for k in ("name", "kind", "center", "sizeKm", "event") if k in site},
            "track": list(map(str, track)), "corners": corners, "frames": frames}
    (d / "series.json").write_text(json.dumps(meta, indent=1))
    if frames:
        analyze(site_id)


# Nastavení analýzy podle typu místa:
#   pol        – polarizace pro mapu změn (HV = objem vegetace, HH = voda / povrch)
#   scale      – rozsah barevné škály v dB, show = od kolika dB se změna kreslí
#   thr        – práh v dB pro výpočet „změněné plochy“ v km²
#   k          – velikost vyhlazovacího okna v pixelech
#   debias     – odečíst medián změny celé scény (déšť, vlhkost půdy zvednou celý snímek najednou)
ANALYSIS = {
    "fire":   dict(pol="hv", scale=3, show=1.0, thr=1.5, k=7, debias=True),
    "forest": dict(pol="hv", scale=6, show=1.5, thr=3.0, k=5, debias=True),
    "crops":  dict(pol="hh", scale=8, show=2.0, thr=3.0, k=5, debias=False),
    "water":  dict(pol="hv", scale=8, show=2.0, thr=3.0, k=5, debias=False),
}
COLORS = {  # (pokles, nárůst)
    "fire": ((255, 70, 50), (60, 200, 190)),
    "default": ((60, 140, 255), (255, 150, 40)),
}


def perimeter_mask(site, corners):
    """Oficiální obrys požáru (NIFC WFIGS) převedený na masku ve stejné mřížce jako snímek."""
    from PIL import ImageDraw
    gj = json.loads((ROOT / "pipeline" / site["perimeter"]).read_text())
    tl, tr, _, bl = corners
    ax, ay, bx, by = tr[0] - tl[0], tr[1] - tl[1], bl[0] - tl[0], bl[1] - tl[1]
    det = ax * by - ay * bx
    def to_px(lon, lat):
        px, py = lon - tl[0], lat - tl[1]
        return ((px * by - py * bx) / det * SIZE, (ax * py - ay * px) / det * SIZE)
    im = Image.new("L", (SIZE, SIZE), 0)
    dr = ImageDraw.Draw(im)
    # Služba vrací neshořelé ostrovy jako samostatné prstence s opačnou orientací → podle znaménka plochy
    rings = []
    for ft in gj["features"]:
        g = ft["geometry"]
        for poly in (g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]):
            for r in poly:
                area = sum(x1 * y2 - x2 * y1 for (x1, y1, *_), (x2, y2, *_) in zip(r, r[1:])) / 2
                rings.append((area, r))
    rings.sort(key=lambda t: -abs(t[0]))
    outer = np.sign(rings[0][0])
    for area, r in rings:
        dr.polygon([to_px(*pt[:2]) for pt in r], fill=int(np.sign(area) == outer))
    return np.array(im, bool), gj


def analyze(site_id):
    """Z uložených výřezů (.npy) spočítá čísla pro dashboard a barevné mapy změn. Běží bez internetu."""
    site = SITES[site_id]
    d = OUT / site_id
    meta = json.loads((d / "series.json").read_text())
    frames, cfg = meta["frames"], ANALYSIS[site["kind"]]
    # km² na pixel ze skutečných rohů výřezu (výřez může být na okraji dráhy menší než sizeKm)
    def dist(a, b):
        lat = np.radians((a[1] + b[1]) / 2)
        return float(np.hypot((a[0] - b[0]) * np.cos(lat), a[1] - b[1]) * 111.32)
    tl, tr, _, bl = meta["corners"]
    meta["extentKm"] = [round(dist(tl, tr), 2), round(dist(tl, bl), 2)]
    px = meta["extentKm"][0] * meta["extentKm"][1] / SIZE ** 2
    load = lambda fr, pol: np.load(d / f"{fr['date']}_{pol}.npy").astype("float32") if fr.get(pol) else None
    pol, k = cfg["pol"], cfg["k"]

    # Společná platná oblast: jen pixely změřené při všech přeletech, bez okraje dráhy (tam je šum)
    common = np.all([np.isfinite(load(fr, "hh")) for fr in frames], axis=0)
    common = box(common.astype("float32"), site.get("edgePx", 2 * k + 1)) > 0.999  # edgePx: širší ořez u míst na kraji dráhy
    meta["validKm2"] = round(float(common.sum()) * px, 1)
    sm = {}
    for fr in frames:
        hh, hv = load(fr, "hh"), load(fr, "hv")
        valid = np.isfinite(hh) & common
        fr["meanHH"] = round(float(10 * np.log10(np.nanmean(10 ** (hh[valid] / 10)))), 2)
        fr["meanHV"] = round(float(10 * np.log10(np.nanmean(10 ** (hv[valid] / 10)))), 2) if hv is not None else None
        # Volná voda: HV je nad vodou tmavé i za větru; HH vítr zesvětlí (hladina se zvlní)
        wsrc = hv if site.get("waterPol") == "hv" else hh
        ws = smooth(wsrc, 5) if wsrc is not None else None
        area = lambda db: round(float(((ws < db) & common).sum()) * px, 1) if ws is not None else None
        thr = site.get("waterDb", -18)
        fr["waterKm2"] = area(thr)
        if site["kind"] == "water":
            # Citlivost: plocha s prahem o 2 dB volnějším. Práh leží těsně nad šumem radaru, takže níž jít nejde;
            # výš ano, a pak se započítají i okraje jezera s plovoucí vegetací nebo mokrým bahnem.
            fr["waterHiKm2"] = area(thr + 2)
            fr.pop("waterLoKm2", None)
        cur = hh if pol == "hh" else hv
        sm[fr["date"]] = smooth(cur, k) if cur is not None else None

    # Výchozí stav: u události průměr všech přeletů před ní, jinak první přelet
    have = [fr for fr in frames if sm[fr["date"]] is not None]
    pre = [fr for fr in have if site.get("event") and fr["date"] < site["event"]] or have[:1]
    with np.errstate(all="ignore"), __import__("warnings").catch_warnings():
        __import__("warnings").simplefilter("ignore")
        base = 10 * np.log10(np.nanmean([10 ** (sm[fr["date"]] / 10) for fr in pre], axis=0))
    # Místa, která kolísala už před událostí (okraj dráhy, zavlažovaná pole), se z mapy změn vynechají
    meta["unstableKm2"] = None
    if len(pre) >= 3:
        spread = np.nanmax([sm[fr["date"]] for fr in pre], axis=0) - np.nanmin([sm[fr["date"]] for fr in pre], axis=0)
        unstable = common & ~(spread < cfg["thr"])
        meta["unstableKm2"] = round(float(unstable.sum()) * px, 1)
        common = common & ~unstable
    lo_c, hi_c = COLORS.get(site["kind"], COLORS["default"])
    inside = None
    if site.get("perimeter"):
        inside, gj = perimeter_mask(site, meta["corners"])
        (d / "perimeter.geojson").write_text(json.dumps(gj))
        pr = gj["features"][0]["properties"]
        day = lambda ms: __import__("datetime").datetime.fromtimestamp(ms / 1000, __import__("datetime").timezone.utc).strftime("%Y-%m-%d") if ms else None
        meta["perimeter"] = {
            "file": "perimeter.geojson", "name": pr["poly_IncidentName"],
            "source": "NIFC WFIGS Interagency Fire Perimeters (year to date)",
            "totalKm2": round(pr["poly_GISAcres"] * 0.00404686, 1),
            "inWindowKm2": round(float((inside & common).sum()) * px, 1),
            "discovered": day(pr["attr_FireDiscoveryDateTime"]), "contained": day(pr["attr_ContainmentDateTime"]),
            "mapped": day(pr["poly_DateCurrent"]),
        }
    for fr in frames:
        cur = sm[fr["date"]]
        if cur is None:
            fr["change"], fr["lossKm2"], fr["gainKm2"] = None, None, None
            continue
        diff = cur - base
        ok = np.isfinite(diff) & common
        bias = float(np.median(diff[ok])) if cfg["debias"] else 0.0
        diff = diff - bias
        fr["sceneShiftDb"] = round(bias, 2) if cfg["debias"] else None
        fr["lossKm2"] = round(float((diff[ok] < -cfg["thr"]).sum()) * px, 1)
        fr["gainKm2"] = round(float((diff[ok] > cfg["thr"]).sum()) * px, 1)
        if inside is not None:
            fr["lossInsideKm2"] = round(float(((diff < -cfg["thr"]) & ok & inside).sum()) * px, 1)
            fr["meanInsideDb"] = round(float(np.mean(diff[ok & inside])), 2)
            fr["meanOutsideDb"] = round(float(np.mean(diff[ok & ~inside])), 2)
        v = np.clip(np.nan_to_num(diff) / cfg["scale"], -1, 1)
        rgba = np.zeros((*v.shape, 4), "uint8")
        rgba[v < 0, :3] = lo_c
        rgba[v > 0, :3] = hi_c
        a0 = cfg["show"] / cfg["scale"]
        alpha = np.clip((np.abs(v) - a0) / (1 - a0), 0, 1) * 200 + 40
        rgba[..., 3] = np.where(ok & (np.abs(v) > a0), alpha, 0).astype("uint8")
        Image.fromarray(rgba, "RGBA").save(d / f"{fr['date']}_change.png", optimize=True)
        fr["change"] = f"{fr['date']}_change.png"
    meta["analysis"] = {
        "pol": pol.upper(), "scaleDb": cfg["scale"], "showDb": cfg["show"], "thresholdDb": cfg["thr"],
        "smoothingPx": k, "pixelM": round(site["sizeKm"] * 1000 / SIZE), "sceneShiftRemoved": cfg["debias"],
        "baselineDates": [fr["date"] for fr in pre], "waterDb": site.get("waterDb", -18), "waterPol": site.get("waterPol", "hh").upper(),
        "colors": {"loss": "#%02x%02x%02x" % lo_c, "gain": "#%02x%02x%02x" % hi_c},
    }
    (d / "series.json").write_text(json.dumps(meta, indent=1))
    print(f"{site_id}: analýza hotová, výchozí stav {meta['analysis']['baselineDates']}")
    for fr in frames:
        print("  ", fr["date"], fr["mode"], fr["meanHH"], fr["meanHV"], "voda", fr["waterKm2"],
              "pokles", fr["lossKm2"], "nárůst", fr["gainKm2"], "posun", fr.get("sceneShiftDb"),
              "| uvnitř obrysu", fr.get("lossInsideKm2"), fr.get("meanInsideDb"), "vně", fr.get("meanOutsideDb"))


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    only = "--analyze-only" in sys.argv
    for s in args or list(SITES):
        analyze(s) if only else process(s)
    (OUT / "sites.json").write_text(json.dumps(
        [{"id": s, "name": SITES[s]["name"], "kind": SITES[s]["kind"]}
         for s in SITES if (OUT / s / "series.json").exists()], ensure_ascii=False))
