"""Dancing Earth – stáhne aktuální dráhové údaje (TLE) družic z CelesTrak pro živou mapu.

Z TLE si prohlížeč sám spočítá, kde družice právě je (knihovna satellite.js, model SGP4).
Token není potřeba. Spuštění:  .venv/bin/python pipeline/fetch_tle.py
"""
import datetime, json
from pathlib import Path
import requests

OUT = Path(__file__).resolve().parent.parent / "web" / "data" / "tle.json"
URL = "https://celestrak.org/NORAD/elements/gp.php"
# swathKm: pruh, kam míří radar NISAR – vzdálenost bližšího a vzdálenějšího okraje vlevo od dráhy letu.
# Ověřeno na skutečných snímcích: střed snímku leží 553–561 km vlevo od dráhy, snímek je široký asi 240 km.
SATS = [
    dict(id="nisar", name="NISAR", catnr=65053, color="#e9b949", role="NASA-ISRO L-band radar: every radar image in this app", swathKm=[435, 675]),
    dict(id="noaa20", name="NOAA-20", catnr=43013, color="#7fd6e8", role="Carries VIIRS, the camera behind our Optical layer"),
    dict(id="swot", name="SWOT", catnr=54754, color="#3c8cff", role="NASA-CNES mission that measures water height"),
    dict(id="landsat9", name="Landsat 9", catnr=49260, color="#7bd88f", role="NASA-USGS optical land imager"),
    dict(id="sentinel1a", name="Sentinel-1A", catnr=39634, color="#b07cff", role="ESA C-band radar, NISAR's European cousin"),
    # extra=True: jen na 3D zeměkouli (na ploché mapě by už bylo družic moc)
    dict(id="iss", name="ISS", catnr=25544, color="#ffffff", role="International Space Station, with a crew on board", extra=True),
    dict(id="snpp", name="Suomi NPP", catnr=37849, color="#ff8a1f", role="NASA-NOAA satellite; its VIIRS sensor supplies part of our fire heat detections", extra=True),
    dict(id="terra", name="Terra", catnr=25994, color="#f06292", role="NASA Earth-observing satellite launched in 1999", extra=True),
    dict(id="sentinel6", name="Sentinel-6 MF", catnr=46984, color="#4dd0e1", role="NASA-ESA mission that measures sea level", extra=True),
]

if __name__ == "__main__":
    out = []
    for s in SATS:
        lines = requests.get(URL, params={"CATNR": s["catnr"], "FORMAT": "TLE"}, timeout=60).text.strip().splitlines()
        if len(lines) != 3 or not lines[1].startswith("1 "):
            print("přeskočeno", s["name"], lines[:1])
            continue
        out.append({**s, "tle": [lines[1].rstrip(), lines[2].rstrip()]})
        print("ok", s["name"], "=", lines[0].strip())
    if len(out) < 1 or out[0]["id"] != "nisar":
        raise SystemExit("NISAR chybí – soubor se nepřepíše")
    OUT.write_text(json.dumps({"fetched": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
                               "source": "CelesTrak (https://celestrak.org/)", "sats": out}, indent=1))
