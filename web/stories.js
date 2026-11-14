// Stories for each type of place: physics of what the radar sees, who can use it, and the limits.
window.STORIES = {
  water: {
    label: "Water · flood pulse",
    instrument: "Each strip of the image is a note. Where water spreads the image gets darker, so the notes sink lower and louder",
    title: "The lake that breathes",
    body: [
      "Every monsoon the Mekong swells so much that it pushes water backwards up the Tonlé Sap river. The lake grows several times over and floods the surrounding forest and rice fields, then drains again in the dry season.",
      "Open water acts like a mirror for radar: the pulse bounces away from the satellite, so calm water looks almost black. When water rises under trees, the opposite happens — the signal bounces between water and trunks and comes back brighter (double bounce)."
    ],
    why: "Calm water is dark in both channels. But wind roughens the lake and makes it bright in HH — on 18 August 2026 most of the lake would vanish from an HH water map. HV stays dark over water whatever the wind, so open water is mapped from HV here. Clouds during the monsoon make optical satellites nearly useless; L-band radar sees through them.",
    use: [
      ["Flood and water managers", "follow how fast open water spreads between passes, even under monsoon cloud."],
      ["Scientists", "download the CSV and compare the flood curve with river gauges or rainfall."],
      ["Teachers and the public", "press Play to watch and hear the lake grow."]
    ],
    limits: "Open water is counted where smoothed HV is below the threshold, which sits close to the radar noise floor, so very smooth bare ground can be counted by mistake. Water under trees or floating vegetation is not counted, so the true flooded area is larger."
  },
  // Místo s vlastním příběhem (klíč = id místa); ostatní místa berou příběh podle typu
  poyang: {
    label: "Water · a lake that empties",
    instrument: "Each strip of the image is a note. Where the water retreats the image gets brighter, so the notes climb and get louder",
    title: "The lake that drains away",
    body: [
      "Poyang is China's largest freshwater lake. Five rivers feed it and it drains into the Yangtze. In the summer flood season it swells into a small sea; in autumn the water runs out and much of the lake bed turns into mudflats and grassland.",
      "Those drying flats are the winter feeding grounds of hundreds of thousands of migrating birds, among them most of the world's Siberian cranes. How fast the lake empties matters for them, for fishing and for the water supply of the towns around it."
    ],
    why: "Open water is very dark for radar because the smooth surface reflects the pulse away from the satellite. As the lake retreats, the exposed ground sends more signal back and the dark area shrinks. Water is mapped from HV, because wind can make a lake bright in HH. Summer cloud often hides this lake from cameras, as the Optical layer shows; radar is not affected.",
    use: [
      ["Water and wetland managers", "follow how fast the lake empties from one pass to the next, whatever the weather."],
      ["Scientists", "download the CSV and compare the curve with lake-level gauges or Yangtze discharge."],
      ["Teachers and the public", "press Play to watch the lake drain, and compare it with Tonlé Sap, which fills over the same months."]
    ],
    limits: "Open water is counted where smoothed HV is below the threshold. Very smooth wet mud can look like water, so in the dry season the true water area may be smaller than the number shown. Wind and rain can roughen the water and hide part of it on single days, which is why the curve is not perfectly smooth."
  },
  fire: {
    label: "Fire · burn scar",
    instrument: "Each strip of the image is a note; where vegetation burned the note drops and gets louder",
    title: "What the fire left behind",
    body: [
      "On 23 July 2026 several large wildfires started in eastern Oregon; their cause is recorded as natural. Smoke hides the ground from optical satellites while a fire is active, but radar passes straight through it.",
      "Living shrubs and trees scatter the radar pulse many times, which sends energy back in the cross-polarized HV channel. Once the vegetation burns, that scattering disappears and HV falls. The burn scar appears as a patch that was not there before, and it keeps growing while the fire burns."
    ],
    why: "The Change layer compares HV with the average of all passes before the fire. HV shows the loss of woody vegetation; grass and lightly burned ground barely change the L-band signal, so the radar scar is smaller than the official perimeter. The white outline is the official perimeter, used here as an independent check.",
    use: [
      ["Fire and land managers", "see where woody vegetation was actually lost inside the perimeter, without waiting for clear skies."],
      ["Scientists", "download the CSV: loss area inside and outside the perimeter for every pass."],
      ["Teachers and the public", "use Before / after to reveal the scar, and listen to it appear."]
    ],
    limits: "A scene-wide shift (for example after rain) is removed by subtracting the median change. Area before the fire shows the noise level of the method. Farming and weather also change HV, so not every coloured patch is fire."
  },
  forest: {
    label: "Forest · clearing",
    instrument: "Each strip of the image is a note; a deep drum sounds when the signal drops sharply",
    title: "Where the forest goes quiet",
    body: [
      "Rondônia is one of the most deforested regions of the Amazon. Forest is cut into the typical 'fishbone' pattern along roads, then burned and turned into pasture.",
      "A forest canopy scatters radar in all directions, which returns a strong cross-polarized (HV) signal. When trees are cut, HV drops sharply — the forest literally goes quiet in the data."
    ],
    why: "HV is the key band for vegetation volume. NISAR's L-band (24 cm) penetrates deeper into the canopy than the C-band used by Sentinel-1, so it responds to trunks and branches, not just leaves.",
    use: [
      ["Forest managers", "spot new HV drops along roads as candidates for a field or optical check."],
      ["Scientists", "download the CSV of loss and gain area per pass."],
      ["Teachers and the public", "compare the first and the latest pass with Before / after."]
    ],
    limits: "Only passes that include HV are used. A drop in HV marks possible clearing, not proof: pasture burning and seasonal drying lower HV as well."
  },
  crops: {
    label: "Fields · growing season",
    instrument: "Each strip of the image is a note; fields that changed since the last pass sound louder",
    title: "The heartbeat of a farm",
    body: [
      "California's Central Valley grows a large share of the fruit, nuts and vegetables eaten in the US. Fields are planted, irrigated, grow and are harvested on a regular cycle.",
      "Radar responds to plant structure and soil moisture. Wet, freshly irrigated soil and growing crops raise the signal; harvest and dry bare soil lower it — a repeating rhythm you can hear."
    ],
    why: "The ratio of HV to HH tracks how much plant volume is in the field. Repeating this every 12 days lets farmers and water managers follow crop growth and irrigation without visiting each field.",
    use: [
      ["Farm and water managers", "see which fields changed between passes (irrigation, harvest, flooding)."],
      ["Scientists", "click a single field to get its own time series, then download it as CSV."],
      ["Teachers and the public", "press Play to hear a year of farming."]
    ],
    limits: "The Change layer compares each pass with the first one, so it mixes crop growth, soil moisture and tillage. It shows that a field changed, not why."
  }
};
