"""Dancing Earth – stáhne místa, kde družice zaznamenaly žár (aktivní oheň), pro požárová místa.

Zdroj: NASA GIBS / FIRMS, VIIRS Thermal Anomalies 375 m (družice NOAA-20 a Suomi NPP), denní vektorové dlaždice.
Každý bod = jedna detekce: poloha, datum a čas (UTC), družice, jistota a vyzářený výkon (FRP, MW).
Jsou to BODOVÁ měření v okamžiku přeletu, ne souvislá teplotní mapa. Token není potřeba.

Spuštění:  .venv/bin/python pipeline/fetch_hotspots.py [site_id ...]
"""
import datetime, json, sys
from pathlib import Path
import mapbox_vector_tile, requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "data"
SITES = json.loads((ROOT / "pipeline" / "sites.json").read_text())
LAYERS = {"VIIRS_NOAA20_Thermal_Anomalies_375m_All": "NOAA-20", "VIIRS_SNPP_Thermal_Anomalies_375m_All": "Suomi NPP"}
URL = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/{layer}/default/{date}/500m/{L}/{row}/{col}.mvt"
L, SPAN = 7, 288 / 2 ** 7  # dlaždice úrovně 7 má 2,25°


def process(site_id):
    d = OUT / site_id
    meta = json.loads((d / "series.json").read_text())
    lons, lats = [c[0] for c in meta["corners"]], [c[1] for c in meta["corners"]]
    w, e, s, n = min(lons), max(lons), min(lats), max(lats)
    cols = range(int((w + 180) / SPAN), int((e + 180) / SPAN) + 1)
    rows = range(int((90 - n) / SPAN), int((90 - s) / SPAN) + 1)
    day0 = datetime.date.fromisoformat(meta["event"]) - datetime.timedelta(days=2)
    end = (meta.get("perimeter") or {}).get("contained")
    day1 = (datetime.date.fromisoformat(end) if end else day0 + datetime.timedelta(days=70)) + datetime.timedelta(days=10)
    points, seen, session = [], set(), requests.Session()
    days = [(day0 + datetime.timedelta(days=k)).isoformat() for k in range((day1 - day0).days + 1)]
    for k, date in enumerate(days):
        cnt = 0
        for layer, sat in LAYERS.items():
            for row in rows:
                for col in cols:
                    r = session.get(URL.format(layer=layer, date=date, L=L, row=row, col=col), timeout=120)
                    if r.status_code != 200 or len(r.content) < 60:
                        continue
                    for lyr in mapbox_vector_tile.decode(r.content).values():
                        for f in lyr["features"]:
                            p = f["properties"]
                            lon, lat = p.get("LONGITUDE"), p.get("LATITUDE")
                            if lon is None or not (w <= lon <= e and s <= lat <= n) or p.get("ACQ_DATE") != date:
                                continue
                            key = (sat, p.get("ACQ_TIME"), round(lon, 4), round(lat, 4))
                            if key in seen:
                                continue
                            seen.add(key)
                            # [den, čas UTC, délka, šířka, výkon MW, jistota, družice, den/noc]
                            points.append([k, p.get("ACQ_TIME"), round(lon, 4), round(lat, 4), round(float(p.get("FRP") or 0), 1),
                                           str(p.get("CONFIDENCE", ""))[:1], sat, p.get("DAYNIGHT")])
                            cnt += 1
        print(" ", date, cnt)
    points.sort(key=lambda q: (q[0], q[1] or ""))
    per_day = [0] * len(days)
    for q in points:
        per_day[q[0]] += 1
    (d / "hotspots.json").write_text(json.dumps({
        "source": "NASA FIRMS / GIBS, VIIRS Thermal Anomalies 375 m (NOAA-20 and Suomi NPP), near-real-time product",
        "url": "https://www.earthdata.nasa.gov/data/tools/firms", "days": days, "perDay": per_day, "points": points}, separators=(",", ":")))
    active = [days[k] for k, c in enumerate(per_day) if c]
    meta["hotspots"] = {"file": "hotspots.json", "count": len(points), "first": active[0] if active else None, "last": active[-1] if active else None,
                        "start": days[0], "end": days[-1]}
    (d / "series.json").write_text(json.dumps(meta, indent=1))
    print(site_id, len(points), "detekcí,", meta["hotspots"]["first"], "→", meta["hotspots"]["last"])


if __name__ == "__main__":
    for sid in sys.argv[1:] or [k for k, v in SITES.items() if v["kind"] == "fire"]:
        print(sid)
        process(sid)
