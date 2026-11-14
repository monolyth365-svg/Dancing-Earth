"""Dancing Earth – stáhne dráhy hurikánů s dosahem větru a vln (NOAA NHC, soubory ATCF „best track“).

Každý řádek záznamu = poloha středu bouře v daný čas (po 6 hodinách), maximální vítr, tlak,
a pro tři síly větru (34, 50, 64 uzlů) dosah ve čtyřech čtvrtinách (SV, JV, JZ, SZ) v námořních mílích.
Navíc dosah vln vyšších než 12 stop (3,7 m). Token není potřeba.

Spuštění:  .venv/bin/python pipeline/fetch_storms.py
"""
import json
from pathlib import Path
import requests

OUT = Path(__file__).resolve().parent.parent / "web" / "data" / "storms"
URL = "https://ftp.nhc.noaa.gov/atcf/btk/b{id}.dat"
STORMS = [  # id souboru, popis oblasti (jen z poloh v datech)
    dict(id="al092026", basin="Atlantic", where="Gulf of Mexico"),
    dict(id="ep172026", basin="Eastern Pacific", where="off the Pacific coast of Mexico"),
]
NM = 1.852


def num(x):
    x = x.strip()
    return int(x) if x.lstrip("-").isdigit() else 0


def parse(text):
    pts = {}
    for line in text.splitlines():
        p = [x.strip() for x in line.split(",")]
        if len(p) < 28 or p[4] != "BEST":
            continue
        t = p[2]
        lat = int(p[6][:-1]) / 10 * (1 if p[6][-1] == "N" else -1)
        lon = int(p[7][:-1]) / 10 * (1 if p[7][-1] == "E" else -1)
        d = pts.setdefault(t, dict(t=f"{t[:4]}-{t[4:6]}-{t[6:8]}T{t[8:10]}:00Z", lat=lat, lon=lon, kt=num(p[8]), hpa=num(p[9]) or None, type=p[10],
                                   rmwKm=round(num(p[19]) * NM) or None, dir=num(p[25]) if p[25] else None, moveKmh=round(num(p[26]) * NM) if p[26] else None,
                                   r34=None, r50=None, r64=None, seas=None, name=None))
        if p[27] and p[27] not in ("INVEST",) and not p[27].startswith("GENESIS") and not p[27].isdigit():
            d["name"] = p[27].title()
        if p[11] in ("34", "50", "64"):
            r = [round(num(x) * NM) for x in p[13:17]]  # SV, JV, JZ, SZ v km
            if any(r):
                d["r" + p[11]] = r
        if len(p) > 34 and num(p[29]) == 12:
            s = [round(num(x) * NM) for x in p[31:35]]
            if any(s):
                d["seas"] = s
    return [pts[k] for k in sorted(pts)]


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    index = []
    for s in STORMS:
        pts = parse(requests.get(URL.format(id=s["id"]), timeout=60).text)
        name = next((p["name"] for p in reversed(pts) if p["name"]), s["id"].upper())
        for p in pts:
            p.pop("name")
        peak = max(pts, key=lambda p: p["kt"])
        meta = dict(id=s["id"], name=name, basin=s["basin"], where=s["where"], season=int(s["id"][-4:]),
                    source="NOAA National Hurricane Center, ATCF best track (preliminary until the season report)",
                    url=URL.format(id=s["id"]), points=pts)
        (OUT / f"{s['id']}.json").write_text(json.dumps(meta, separators=(",", ":")))
        index.append(dict(id=s["id"], name=name, basin=s["basin"], where=s["where"], start=pts[0]["t"][:10], end=pts[-1]["t"][:10], peakKt=peak["kt"]))
        print(name, len(pts), "bodů, vrchol", peak["kt"], "kt", peak["t"], "| s dosahem větru:", sum(1 for p in pts if p["r34"]), "| s vlnami:", sum(1 for p in pts if p["seas"]))
    (OUT / "index.json").write_text(json.dumps(index))
