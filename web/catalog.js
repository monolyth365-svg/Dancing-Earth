// Nabídka témat: téma → jev → konkrétní místo a období.
// U každého jevu je odděleno, co je na snímku VIDĚT, a co VÍME o příčině.
// go: "site:<id>" = připravené místo s analýzou, "storm:<id>" = hurikán, "live:<lon>,<lat>" = bez připravené analýzy,
// otevře nejnovější radarové snímky NASA v živém režimu, kde si uživatel přelety porovná sám.
window.CATALOG = [
  { theme: "Nature", items: [
    { name: "Floods and rising water", seen: "The dark area of open water grows from pass to pass.", cause: "The yearly monsoon flood of the Mekong, well documented by hydrologists. This app does not measure rain or river flow.",
      entries: [{ go: "site:tonle-sap", label: "Tonlé Sap, Cambodia", period: "" }] },
    { name: "Lakes that shrink", seen: "The dark area of open water gets smaller and lake bed appears.", cause: "The lake drains into the Yangtze every autumn. Whether 2026 was drier than usual cannot be told from these images alone.",
      entries: [{ go: "site:poyang", label: "Poyang Lake, China", period: "" }] },
    { name: "Wildfires", seen: "Radar: vegetation signal (HV) drops in a compact patch. Heat sensor: points where fire was burning on each day.", cause: "Confirmed as fire by two independent sources: the official fire perimeter and satellite heat detections.",
      entries: [{ go: "site:shingle", label: "Shingle Fire, Oregon, USA", period: "heat detections day by day" },
                { go: "site:big-grass", label: "Big Grass Fire, Oregon, USA", period: "a grass fire radar barely sees" }] },
    { name: "Hurricanes, strong wind and high waves", seen: "The storm's centre, its path, and how far three strengths of wind and high waves reach in each quarter.", cause: "Measured and analysed by the US National Hurricane Center. Radar is not used for the wind; it can show flooding on land afterwards.",
      entries: [{ go: "storm:al092026", label: "Hurricane Isaias, Gulf of Mexico", period: "4–11 Oct 2026 · category 3" },
                { go: "storm:ep172026", label: "Hurricane Polo, eastern Pacific", period: "17–30 Sep 2026 · category 5" }] },
    { name: "Coastal erosion", seen: "Not analysed yet. In the newest radar images, water is dark and land is bright, so the shoreline is easy to trace.", cause: "Erosion is slow: compare the oldest and the newest pass, and expect small changes within one year.",
      entries: [{ go: "live:-89.25,29.15", label: "Mississippi River Delta, USA", period: "newest passes, straight from NASA", open: true }] },
    { name: "Volcanic activity", seen: "Not analysed yet. New lava and ash change how rough the ground is, which changes the radar brightness.", cause: "This app has no eruption data. Use the comparison button to see whether anything changed between two passes.",
      entries: [{ go: "live:-155.28,19.41", label: "Kīlauea, Hawaii, USA", period: "newest passes, straight from NASA", open: true }] },
  ] },
  { theme: "Human activity", items: [
    { name: "Deforestation", seen: "Vegetation signal (HV) drops in blocks, often along roads.", cause: "Not confirmed here. The pattern fits clearing, but no ground or optical check was made.",
      entries: [{ go: "site:rondonia", label: "Rondônia, Brazil", period: "" }] },
    { name: "Farm fields", seen: "Single fields get brighter and darker through the year.", cause: "Assumed to be planting, irrigation and harvest. The app cannot tell these apart.",
      entries: [{ go: "site:central-valley", label: "Central Valley, California, USA", period: "" }] },
    { name: "New construction and growing cities", seen: "Not analysed yet. Buildings are among the brightest things in a radar image, so new ones show up as new bright spots.", cause: "This app has no construction records. A new bright patch is a hint to check, not proof of a building.",
      entries: [{ go: "live:31.76,30.02", label: "New Administrative Capital, Egypt", period: "newest passes, straight from NASA", open: true }] },
  ] },
];
window.CATALOG.find = (go) => { for (const t of window.CATALOG) for (const it of t.items) for (const e of it.entries) if (e.go === go) return { theme: t.theme, item: it, entry: e }; return null; };
