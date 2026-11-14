# Dancing Earth

An interactive web app that shows **and plays** how Earth's surface changes, using L-band radar data from the NASA-ISRO **NISAR** satellite.
Built for the NASA Space Apps Challenge 2026, challenge **"Dancing with the SARs"**.

**Live app:** https://monolyth365-svg.github.io/Dancing-Earth/

**Source code:** https://github.com/monolyth365-svg/Dancing-Earth

## What it does

Pick a topic (**Nature** or **Human activity**), then a phenomenon and a place, and watch, compare and listen. For every phenomenon the app keeps apart what is *seen* on the image and what is *known about the cause*.

- **Compare any image with any other** – choose any pass as the reference image; the Change layer, the Before / after slider and the time-lapse then compare every other date with it, computed in the browser. The map stays where you put it.
- **Explore it yourself** – tools that work on the radar change itself:
  - click a spot by a lake to see on which passes it was open water and when it was dry;
  - turn on **Under plants** at a lake to see possible water standing under trees, shrubs or rice (HH rises by more than 3 dB and much more than HV: the double-bounce signature). At Tonlé Sap it grows from 17 km² in mid-August to about 90 km² in September, in belts along the shore;
  - outline a field, forest or bay and get the hectares where radar saw a change;
  - drag along a river or shore and hear the change under your finger; the place with the biggest change lights up;
  - a quiz: two radar images, guess what changed, then reveal the Change layer;
  - at a fire, click a red patch to ask **why it is red**: did the radar drop last on later passes, did satellites detect heat right there, is it inside the official fire line, and a cautious verdict from the three;
  - **play the story of the fire** in three steps: the first heat detection, the day with the most detections, and what radar shows about a month later;
  - for any date, show the share of detected loss that lies outside the official fire line (4 % for the Shingle Fire on 19 October), with before / after;
  - place a lake's water change over any other town at the same scale.
- **Fire seen two ways** – radar shows the burned area; a Heat layer shows where satellites (VIIRS) detected fire on each day. A day slider replays the spread; click a point for the time of detection, satellite, radiated power and source.
- **Hurricane at its real size** – centre, track and the reach of three wind strengths in each quarter of the storm (so its asymmetry is visible), category, wind, pressure, reach of high waves, and the satellite photo of that day.
- **"What if…" simulation** – change wind direction and speed and see how a simple fire-spread model changes from the same ignition point, next to the real-wind result and the real detections, with a score: how many real first-day heat detections fall inside the simulated area and how much of that area they fill (86 % and about 40 % for the Shingle Fire with the real wind). Clearly labelled as a simulation.
- **3D Earth** – a globe whose surface sharpens as you zoom (only the part you look at is loaded), with each satellite as its own simplified 3D model built from its real layout (the ISS truss with eight solar wings, SWOT's two antennas on a mast, Sentinel-6's house shape…), their orbits and NISAR's radar beam; you can pick any of nine satellites (NISAR, NOAA-20, SWOT, Landsat 9, Sentinel-1A, the ISS, Suomi NPP, Terra, Sentinel-6) and fly beside it while the camera follows; you can also zoom right down to the ground and tilt the view.
- **Change map** – a coloured layer shows where the radar signal dropped or rose.
- **Before / after slider** – swipe between the reference pass and any later pass.
- **Optical layer** – a photo from a camera satellite (NASA VIIRS) taken on the same day. With the slider it sits next to the radar image, so you can see the clouds that radar looks through. A camera saw mostly cloud on 29 of the 77 radar pass days (rough estimate).
- **Time-series animation** – press Play to step through every satellite pass.
- **Live world** – a world map that reads everything live from NASA in your browser:
  - natural events NASA is tracking right now (wildfires, storms, ice, floods, volcanoes);
  - click an event, or any place on land, to load the newest NISAR quick-look radar image of that spot, with earlier passes to flip through and an estimate of the next pass;
  - one button compares two passes of the same track, colours what changed and plays it as music;
  - satellites overhead right now (NISAR, NOAA-20, SWOT, Landsat 9, Sentinel-1A) with their direction, their path for the last and next 50 minutes, and the strip NISAR's radar is looking at. The strip was checked against real NISAR images.
- **Live globe** – the small globe in the top right corner opens a 3D view of Earth with the satellites at their true height, their orbits, and NISAR's radar beam reaching the ground, all drawn to scale and updated live. It says whether the radar is looking at day or night (it works in both), and time can be sped up ×300.
- **Start here** – a short welcome card explains the app in four steps on the first visit (the "?" button reopens it).
- **Dashboard** – a plain-English sentence generated from the data ("what happened"), three key numbers for the selected date, and a chart.
- **Click any spot** on the image to get the time series of that exact place.
- **Music from the image** – each radar image is cut into 16 vertical strips. Brightness sets the pitch of a note, the amount of change since the previous pass sets its loudness, and the position (west to east) sets left/right. Places that change sound different from places that stay the same.
- **Download CSV** of the time series and **copy a link** that reopens the same place, date and layer.

### Places

| Place | Topic | What the radar shows |
| --- | --- | --- |
| Tonlé Sap, Cambodia | Water – monsoon flood pulse | Open water mapped from HV grows from about 1,040 km² to about 1,570 km² between June and October 2026 |
| Poyang Lake, China | Water – a lake that empties | Open water mapped from HV shrinks from summer to autumn as the lake drains into the Yangtze |
| Hurricane Isaias, Gulf of Mexico | Hurricane – wind and waves | Track, category 3 peak, wind reach 333 km to the north-east but 167 km to the south-west (NOAA NHC data, no radar) |
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
6. `pipeline/fetch_optical.py` downloads the VIIRS true-colour image of the same calendar day from NASA GIBS, resamples it to the radar grid and makes a rough cloud estimate (share of bright, colourless pixels).
7. `pipeline/fetch_hotspots.py` downloads VIIRS active-fire detections (NASA FIRMS via GIBS vector tiles) for the fire sites; `pipeline/fetch_wind.py` adds the real first-day wind (Open-Meteo / ERA5) and the first-day reach of the fire for the what-if model; `pipeline/fetch_storms.py` parses NOAA NHC best-track files.
8. `pipeline/fetch_tle.py` downloads orbital elements (TLE) from CelesTrak; the browser turns them into live satellite positions with the SGP4 model (satellite.js).
9. `pipeline/update_sites.py` and `.github/workflows/update.yml` re-run the pipeline once a day on GitHub, so new NISAR passes appear in the app automatically (needs an `EARTHDATA_TOKEN` repository secret; without it only the orbits are refreshed).
10. `pipeline/make_cube.py` packs all passes into a small binary cube used for click-to-chart and for the sound.

All thresholds are listed in the app under "Method and limits" for each place.

### Honest limits

- A drop in HV is not proof of fire or logging; farming, rain and seasonal drying change the signal too.
- L-band radar detects loss of woody vegetation. Grass fires are almost invisible (see Big Grass Fire).
- Open-water area does not include water under trees or floating vegetation.
- Area numbers are approximate (pixel size 78–195 m, simple thresholds).
- The optical photo is from the same calendar day, not the same hour, and its cloud percentage is a rough estimate that smoke, haze, fog or bright ground can confuse.
- Live world works with NASA's quick-look images, which are not calibrated, so its change map is a rough visual comparison, not a measurement. Satellite positions are computed from orbital elements and are good to a few kilometres; the radar strip shows where the radar points, not whether it is recording. "Right now" for radar images means the newest pass, because NISAR revisits a place every 12 days, and the next-pass date is an estimate.
- The what-if fire simulation is a teaching model (ellipse on flat ground, uniform fuel, steady wind), calibrated only to the first day's reach; it is not a forecast.
- Heat detections are single 375 m pixels at the moment of a satellite overpass; cloud and thick smoke can hide a fire, and they are not a temperature map.
- Hurricane wind reach is the largest distance in each quarter, every 6 hours, from preliminary best-track data.
- "Under plants" is a hint, not a validated flood map: wet or ploughed fields can give the same signature, and nothing was checked on the ground.
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
.venv/bin/python pipeline/fetch_optical.py          # no token needed
.venv/bin/python pipeline/fetch_tle.py              # satellite orbits, no token needed
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
- NASA GIBS, VIIRS NOAA-20 Corrected Reflectance (True Color), daily optical images for the Optical layer – https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi (layer `VIIRS_NOAA20_CorrectedReflectance_TrueColor`)
- NISAR GCOV browse (quick-look) images and KML footprints, NASA ASF DAAC, read live in the Live world mode – https://nisar.asf.earthdatacloud.nasa.gov/
- NASA FIRMS / GIBS, VIIRS Thermal Anomalies 375 m (NOAA-20, Suomi NPP), active-fire detections – https://www.earthdata.nasa.gov/data/tools/firms (tiles: https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/VIIRS_NOAA20_Thermal_Anomalies_375m_All/)
- NASA GIBS, Landsat WELD true-colour mosaic (30 m), detail imagery of the 3D Earth – https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual/
- NASA EONET (Earth Observatory Natural Event Tracker), used to find the wildfires and read live for the event map – https://eonet.gsfc.nasa.gov/api/v3/events

### Other data and tools

- NIFC (US National Interagency Fire Center) WFIGS Interagency Fire Perimeters, year to date – https://data-nifc.opendata.arcgis.com/ (service: https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_YearToDate/FeatureServer/0)
- NASA GIBS Blue Marble Next Generation, used as the surface of the live globe (`web/earth.jpg`) – https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi (layer `BlueMarble_NextGeneration`)
- NOAA National Hurricane Center, ATCF best-track files (track, wind, pressure, wind and wave radii) – https://ftp.nhc.noaa.gov/atcf/btk/
- Open-Meteo historical weather API (ERA5 reanalysis), real wind for the what-if simulation – https://open-meteo.com/
- CesiumJS 1.123 (Apache-2.0), 3D globe engine – https://cesium.com/platform/cesiumjs/
- Canadian Forest Fire Behaviour Prediction System (Forestry Canada 1992), length-to-breadth and wind relations used in the what-if model – https://cwfis.cfs.nrcan.gc.ca/background/summary/fbp
- Place-name labels for the "over another place" tool: NASA GIBS Reference Labels, © OpenStreetMap contributors – https://www.openstreetmap.org/copyright
- CelesTrak, orbital elements (TLE) of the satellites shown in Live world – https://celestrak.org/
- satellite.js 5.0.0 (MIT), SGP4 orbit propagation in the browser – https://github.com/shashwatak/satellite-js
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
