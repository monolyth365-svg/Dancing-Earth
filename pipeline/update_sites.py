"""Dancing Earth – automatické doplnění nových přeletů (spouští GitHub jednou denně).

Pro každé místo se zeptá archivu, jestli přibyl nový přelet. Jen pak místo stáhne znovu,
doplní optické fotky a datovou kostku. Když se cokoli nepovede nebo by dat ubylo,
vrátí původní stav, aby se rozbitá data nikdy nedostala na web.

Spuštění:  EARTHDATA_TOKEN=... python pipeline/update_sites.py
"""
import json, shutil, subprocess, sys, tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_nisar as fn

PY = sys.executable
HERE = Path(__file__).resolve().parent


def dates(site_id):
    f = fn.OUT / site_id / "series.json"
    return [fr["date"] for fr in json.loads(f.read_text())["frames"]] if f.exists() else []


def update(site_id):
    site = fn.SITES[site_id]
    have = dates(site_id)
    granules, _ = fn.search(site)
    new = sorted({g["startTime"][:10] for g in granules} - set(have))
    new = [d for d in new if not have or d > max(have)]
    if not new:
        print(site_id, "– nic nového")
        return False
    print(site_id, "– nové přelety:", new)
    d = fn.OUT / site_id
    backup = Path(tempfile.mkdtemp()) / site_id
    if d.exists():
        shutil.copytree(d, backup)
    try:
        scripts = ["fetch_nisar.py", "fetch_optical.py", "make_cube.py"] + (["fetch_hotspots.py"] if site["kind"] == "fire" else [])
        for script in scripts:
            subprocess.run([PY, str(HERE / script), site_id], check=True)
        after = dates(site_id)
        if len(after) < len(have) or not set(have) <= set(after):
            raise RuntimeError(f"dat ubylo: {len(have)} → {len(after)}")
        return True
    except Exception as e:  # cokoli se pokazí → vrátit původní data
        print(site_id, "– CHYBA, vracím původní data:", e)
        shutil.rmtree(d, ignore_errors=True)
        if backup.exists():
            shutil.copytree(backup, d)
        return False


if __name__ == "__main__":
    order = [s["id"] for s in json.loads((fn.OUT / "sites.json").read_text())]
    changed = [s for s in order if update(s)]
    # seznam míst vždy v původním pořadí (fetch_nisar ho přepisuje podle pipeline/sites.json)
    fn.write_index(order)
    print("aktualizováno:", changed or "nic")
