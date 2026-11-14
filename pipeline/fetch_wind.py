"""Dancing Earth – podklady pro simulaci šíření požáru „co by se stalo, kdyby“.

Pro každé požárové místo zjistí:
  * místo a čas prvního zaznamenaného žáru (z detekcí VIIRS = výchozí ohnisko),
  * skutečný vítr v prvních 24 hodinách (Open-Meteo, reanalýza ERA5, 10 m nad zemí),
  * jak daleko od ohniska sahaly detekce žáru po 24 hodinách (podle toho se model kalibruje).
Spouštět po fetch_hotspots.py. Token není potřeba.
"""
import datetime, json, math, sys
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "data"
SITES = json.loads((ROOT / "pipeline" / "sites.json").read_text())


def km(a, b):
    lat = math.radians((a[1] + b[1]) / 2)
    return math.hypot((a[0] - b[0]) * math.cos(lat), a[1] - b[1]) * 111.32


def process(site_id):
    d = OUT / site_id
    meta = json.loads((d / "series.json").read_text())
    h = json.loads((d / "hotspots.json").read_text())
    pts = h["points"]
    if not pts:
        return
    stamp = lambda p: datetime.datetime.fromisoformat(f"{h['days'][p[0]]}T{p[1]}:00+00:00")
    t0 = stamp(pts[0])
    first = [p for p in pts if (stamp(p) - t0).total_seconds() < 3 * 3600]       # první přelet se žárem
    ign = [sum(p[2] for p in first) / len(first), sum(p[3] for p in first) / len(first)]
    day1 = [p for p in pts if 0 <= (stamp(p) - t0).total_seconds() <= 30 * 3600]  # do ~24 h (další přelety)
    dist = sorted(km(ign, (p[2], p[3])) for p in day1)
    reach = dist[int(len(dist) * 0.9)] if dist else 0
    # směr, kterým se oheň první den rozšířil (od ohniska k těžišti detekcí)
    cx, cy = sum(p[2] for p in day1) / len(day1), sum(p[3] for p in day1) / len(day1)
    spread = (math.degrees(math.atan2((cx - ign[0]) * math.cos(math.radians(ign[1])), cy - ign[1])) + 360) % 360
    r = requests.get("https://archive-api.open-meteo.com/v1/archive", timeout=120, params=dict(
        latitude=round(ign[1], 3), longitude=round(ign[0], 3), start_date=t0.date().isoformat(), end_date=(t0.date() + datetime.timedelta(days=1)).isoformat(),
        hourly="wind_speed_10m,wind_direction_10m,wind_gusts_10m", wind_speed_unit="kmh", timezone="UTC")).json()
    hh = r["hourly"]
    idx = [i for i, t in enumerate(hh["time"]) if t0.replace(tzinfo=None) <= datetime.datetime.fromisoformat(t) <= t0.replace(tzinfo=None) + datetime.timedelta(hours=24) and hh["wind_speed_10m"][i] is not None]
    sp = [hh["wind_speed_10m"][i] for i in idx]
    u = sum(-s * math.sin(math.radians(hh["wind_direction_10m"][i])) for s, i in zip(sp, idx)) / len(idx)
    v = sum(-s * math.cos(math.radians(hh["wind_direction_10m"][i])) for s, i in zip(sp, idx)) / len(idx)
    frm = (math.degrees(math.atan2(-u, -v)) + 360) % 360
    meta["sim"] = {
        "ignition": [round(ign[0], 4), round(ign[1], 4)], "start": t0.strftime("%Y-%m-%dT%H:%MZ"),
        "wind": {"speedKmh": round(sum(sp) / len(sp), 1), "fromDeg": round(frm), "gustKmh": round(max(hh["wind_gusts_10m"][i] or 0 for i in idx), 1), "hours": len(idx),
                 "source": "Open-Meteo historical weather API (ERA5 reanalysis), wind 10 m above ground, mean of the first 24 hours"},
        "observed": {"reachKm24": round(reach, 1), "detections24": len(day1), "spreadToDeg": round(spread)},
    }
    (d / "series.json").write_text(json.dumps(meta, indent=1))
    print(site_id, json.dumps(meta["sim"])[:420])


if __name__ == "__main__":
    for sid in sys.argv[1:] or [k for k, v in SITES.items() if v["kind"] == "fire"]:
        process(sid)
