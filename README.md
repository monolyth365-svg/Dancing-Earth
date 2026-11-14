# Dancing Earth

An interactive web app that shows **and plays** how Earth's surface changes, using L-band radar data from the NASA-ISRO **NISAR** satellite.
Built for the NASA Space Apps Challenge 2026, challenge **"Dancing with the SARs"**.

**Live app:** https://monolyth365-svg.github.io/Dancing-Earth/

**Source code:** https://github.com/monolyth365-svg/Dancing-Earth

## What it does

Pick a place, then watch, compare and listen:

- **Change map** – a coloured layer shows where the radar signal dropped or rose.
- **Before / after slider** – swipe between the reference pass and any later pass.
- **Time-series animation** – press Play to step through every satellite pass.
- **Dashboard** – a plain-English sentence generated from the data ("what happened"), three key numbers for the selected date, and a chart.
- **Click any spot** on the image to get the time series of that exact place.
- **Music from the image** – each radar image is cut into 16 vertical strips. Brightness sets the pitch of a note, the amount of change since the previous pass sets its loudness, and the position (west to east) sets left/right. Places that change sound different from places that stay the same.
- **Download CSV** of the time series and **copy a link** that reopens the same place, date and layer.

### Places

| Place | Topic | What the radar shows |
| --- | --- | --- |
| Tonlé Sap, Cambodia | Water – monsoon flood pulse | Open water mapped from HV grows from about 1,040 km² to about 1,570 km² between June and October 2026 |
| Shingle Fire, Oregon, USA | Wildfire – burn scar | HV drops inside the fire; 96 % of the detected loss lies inside the official fire perimeter |
| Big Grass Fire, Oregon, USA | Wildfire – limit of the method | A large grass fire that L-band radar barely sees (about 5–9 % of the official burn area) |
| Rondônia, Brazil | Forest clearing | HV loss and gain between dual-pol passes |
| Central Valley, California, USA | Farm fields | Field-by-field change through a full year |

## Who it is for

- **Scientists** – numbers per pass, method parameters, granule names and CSV export.
- **Resource and emergency managers** – flooded area, vegetation loss inside a fire perimeter, trend since the previous pass.
- **Teachers and the public** – a short story for each place, a before/after slider, and sound.

## Method (short)

1. `pipeline/fetch_nisar.py` searches the ASF archive for NISAR **L2 GCOV** (geocoded polarimetric covariance) products on one track, and reads only a small window of each ~1.8 GB HDF5 file through HTTP range requests.
2. The window is averaged **in linear power** to a 512 × 512 grid (about 78–195 m per pixel depending on the place) and converted to dB.
3. For the change map the image is smoothed (5 × 5 or 7 × 7 pixels, in linear power) to reduce speckle and compared with a reference:
   - fires: the mean of all passes **before** the fire; other places: the first pass.
   - for fire and forest sites the median change of the whole scene is subtracted (rain changes the whole image at once).
   - for fires, pixels that already varied before the event are left out.
4. **Open water** = smoothed HV below −24 dB. HV is used because wind makes water bright in HH (visible on 18 August 2026 over Tonlé Sap) but not in HV.
5. **Fire validation** – the detected HV loss is compared with the official fire perimeter (NIFC), which is not used in the detection itself.
6. `pipeline/make_cube.py` packs all passes into a small binary cube used for click-to-chart and for the sound.

All thresholds are listed in the app under "Method and limits" for each place.

### Honest limits

- A drop in HV is not proof of fire or logging; farming, rain and seasonal drying change the signal too.
- L-band radar detects loss of woody vegetation. Grass fires are almost invisible (see Big Grass Fire).
- Open-water area does not include water under trees or floating vegetation.
- Area numbers are approximate (pixel size 78–195 m, simple thresholds).
- The sound is an artistic mapping of the data, not a measurement.

## Run it locally

```bash
python3 -m http.server 8080 -d web
```

Then open http://localhost:8080 . The processed data is already in `web/data/`.

To rebuild the data you need a free NASA Earthdata account and token:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env          # then paste your Earthdata token into .env
.venv/bin/python pipeline/fetch_nisar.py            # all places, or name one: shingle
.venv/bin/python pipeline/make_cube.py
```

Places are defined in `pipeline/sites.json` (centre, window size, track, event date).

## Data and resources

### NASA data and resources

- NISAR L2 GCOV (Geocoded Polarimetric Covariance) products, NASA-ISRO SAR mission, distributed by the NASA Alaska Satellite Facility DAAC – https://search.asf.alaska.edu/
- ASF Search API – https://api.daac.asf.alaska.edu/services/search/param
- NASA Earthdata Login – https://urs.earthdata.nasa.gov/
- NISAR Data User Guide – https://nisar-docs.asf.alaska.edu/
- NASA Earthdata, "What is Synthetic Aperture Radar?" – https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/sar
- NASA GIBS (Global Imagery Browse Services), Blue Marble Next Generation basemap – https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg (docs: https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api)
- NASA EONET (Earth Observatory Natural Event Tracker), used to find the wildfires – https://eonet.gsfc.nasa.gov/api/v3/events

### Other data and tools

- NIFC (US National Interagency Fire Center) WFIGS Interagency Fire Perimeters, year to date – https://data-nifc.opendata.arcgis.com/ (service: https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_YearToDate/FeatureServer/0)
- MapLibre GL JS 4.7.1 (BSD-3-Clause) – https://maplibre.org/
- Fonts Instrument Sans and JetBrains Mono (SIL Open Font License) via Google Fonts – https://fonts.google.com/
- Python libraries: NumPy https://numpy.org/ , h5py https://www.h5py.org/ , Requests https://requests.readthedocs.io/ , pyproj https://pyproj4.github.io/pyproj/ , Pillow https://python-pillow.org/
- Sound is generated live in the browser with the Web Audio API; no recordings are used.

## Use of AI

This project was built with the help of an AI assistant (Claude by Anthropic, used through Claude Code).

- **AI wrote most of the code** (the Python data pipeline and the web app) and drafted the English texts in the app and in this README.
- **The idea and the decisions are human**: showing surface change on a map with water as the main topic, adding wildfires and other change, and turning the change into music.
- No AI-generated images, video or audio are used. All images in the app are computed directly from NISAR data; the sound is synthesised from the data in the browser.

## Licence

Code: MIT, see [LICENSE](LICENSE). NISAR data and NASA imagery are provided by NASA under its open data policy; fire perimeters by NIFC (public domain). This project is not endorsed by NASA.
