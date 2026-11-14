// Záložka Charts: několik grafů k právě otevřenému místu, každý s jednou větou, co z něj plyne.
//   • jezera: obě jezera v jednom grafu a pásmo citlivosti na práh,
//   • požáry: záchyty žáru po dnech a plocha, kterou radar označil jako ztrátu vegetace,
//   • les a pole: plocha, která proti prvnímu přeletu ztmavla a zesvětlala,
//   • všude: co by ten den viděla kamera (oblačnost) proti radaru.
// Grafy jsou samostatné obrázky SVG (barvy i písmo uvnitř), takže jdou uložit jako PNG do zprávy nebo prezentace.
window.Charts = (() => {
  const q = (s) => document.querySelector(s), W = 400, DAY = 864e5;
  const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", SANS = "system-ui, -apple-system, Segoe UI, sans-serif";
  const K = { bg: "#12151a", grid: "#2a303a", text: "#9aa2ad", strong: "#e8eaed", gold: "#e9b949", blue: "#3c8cff", teal: "#5fd0c5", red: "#ff4632", orange: "#ff8a1f", cloud: "#d5dbe3", dim: "#4c5562" };
  const T = (d) => Date.parse(d);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const n0 = (v) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString("en-US") : (+v).toFixed(Math.abs(v) < 10 && v % 1 ? 1 : 0));
  const pct = (a, b) => `${b >= a ? "up" : "down"} ${Math.round((Math.abs(b - a) / (a || 1)) * 100)}%`;
  let built = [];
  const cache = {}; // data druhého jezera (načtou se jednou)

  // Jeden graf jako samostatné SVG. c = { title, legend, left, right?, items, t0, t1, d0, d1, marker, event?, dots?, source }
  function draw(c) {
    let lx = 12, ly = 34;
    const leg = [];
    for (const it of c.legend) { // popisky se podle potřeby zalomí na další řádek
      const w = 16 + it.label.length * 6.05 + 12;
      if (lx + w > W - 4 && lx > 12) { lx = 12; ly += 14; }
      leg.push({ ...it, x: lx, y: ly }); lx += w;
    }
    const L = 46, R = c.right ? 46 : 14, top = ly + 30, ph = 96, base = top + ph, h = base + (c.dots ? 48 : 40), pw = W - L - R;
    const x = (t) => L + ((t - c.t0) / (c.t1 - c.t0 || 1)) * pw, y = (v, ax) => base - ((v - ax.min) / (ax.max - ax.min || 1)) * ph;
    const xy = (p, ax, key = "v") => `${x(p.t).toFixed(1)},${y(p[key], ax).toFixed(1)}`;
    const P = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" width="${W}" height="${h}" font-family="${MONO}" font-size="10">`,
      `<rect width="${W}" height="${h}" fill="${K.bg}"/>`,
      `<text x="12" y="17" font-family="${SANS}" font-size="12.5" font-weight="600" fill="${K.strong}">${esc(c.title)}</text>`];
    for (const g of leg) {
      P.push(g.shape === "line" ? `<line x1="${g.x}" x2="${g.x + 11}" y1="${g.y - 3.5}" y2="${g.y - 3.5}" stroke="${g.color}" stroke-width="2"${g.dash ? ' stroke-dasharray="3 2"' : ""}/>`
        : g.shape === "dot" ? `<circle cx="${g.x + 5}" cy="${g.y - 3.5}" r="3" fill="${g.color}"/>`
        : g.shape === "ring" ? `<circle cx="${g.x + 5}" cy="${g.y - 3.5}" r="3.2" fill="${K.bg}" stroke="${g.color}" stroke-width="1.6"/>`
        : `<rect x="${g.x}" y="${g.y - 8}" width="10" height="9" fill="${g.color}"${g.opacity ? ` fill-opacity="${g.opacity}"` : ""}/>`,
      `<text x="${g.x + 15}" y="${g.y}" fill="${K.text}">${esc(g.label)}</text>`);
    }
    for (const k of [0, 0.5, 1]) P.push(`<line x1="${L}" x2="${W - R}" y1="${base - ph * k}" y2="${base - ph * k}" stroke="${K.grid}"/>`);
    const axis = (ax, left) => {
      const ax_x = left ? L - 5 : W - R + 5, an = left ? "end" : "start", col = ax.color || K.text;
      P.push(`<text x="${ax_x}" y="${top + 3}" text-anchor="${an}" fill="${col}">${n0(ax.max)}</text>`, `<text x="${ax_x}" y="${base + 3}" text-anchor="${an}" fill="${col}">${n0(ax.min)}</text>`,
        `<text x="${left ? 12 : ax_x}" y="${top - 10}" text-anchor="start" fill="${col}">${esc(ax.unit)}</text>`);
    };
    axis(c.left, true);
    if (c.right) axis(c.right, false);
    for (const it of c.items) {
      const ax = it.axis === "right" ? c.right : c.left;
      if (!it.pts.length) continue;
      if (it.type === "bars") {
        const bw = it.bw || Math.max(1.5, Math.min(12, (pw / it.pts.length) * 0.62));
        for (const p of it.pts) if (p.v > 0) P.push(`<rect x="${(x(p.t) - bw / 2).toFixed(1)}" y="${y(p.v, ax).toFixed(1)}" width="${bw.toFixed(1)}" height="${(base - y(p.v, ax)).toFixed(1)}" fill="${p.color || it.color}"/>`);
      } else if (it.type === "band") {
        P.push(`<polygon points="${it.pts.map((p) => xy(p, ax, "v2")).concat(it.pts.slice().reverse().map((p) => xy(p, ax))).join(" ")}" fill="${it.color}" fill-opacity="0.2"/>`);
      } else {
        P.push(`<polyline points="${it.pts.map((p) => xy(p, ax)).join(" ")}" fill="none" stroke="${it.color}" stroke-width="${it.width || 1.6}"${it.dash ? ' stroke-dasharray="4 3"' : ""}/>`);
        for (const p of it.pts) P.push(p.odd ? `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.v, ax).toFixed(1)}" r="3.4" fill="${K.bg}" stroke="${it.color}" stroke-width="1.6"/>`
          : `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.v, ax).toFixed(1)}" r="${it.width > 2 ? 2.6 : 2}" fill="${it.color}"/>`);
      }
    }
    if (c.dots) for (const t of c.dots.ts) P.push(`<circle cx="${x(t).toFixed(1)}" cy="${base + 9}" r="2.6" fill="${c.dots.color}"/>`);
    if (c.event != null && c.event >= c.t0 && c.event <= c.t1) P.push(`<line x1="${x(c.event).toFixed(1)}" x2="${x(c.event).toFixed(1)}" y1="${top - 15}" y2="${base}" stroke="#ff6a3d"/>`, `<text x="${(x(c.event) + 4).toFixed(1)}" y="${top - 7}" fill="#ff6a3d">${esc(c.eventLabel)}</text>`);
    if (c.marker != null && c.marker >= c.t0 && c.marker <= c.t1) P.push(`<line x1="${x(c.marker).toFixed(1)}" x2="${x(c.marker).toFixed(1)}" y1="${top - 4}" y2="${base}" stroke="${K.strong}" stroke-dasharray="2 3"/>`);
    const dy = base + (c.dots ? 23 : 15);
    P.push(`<text x="${L}" y="${dy}" fill="${K.text}">${c.d0}</text>`, `<text x="${W - R}" y="${dy}" text-anchor="end" fill="${K.text}">${c.d1}</text>`,
      `<text x="12" y="${h - 7}" font-size="8.5" fill="${K.text}">${esc(c.source)}</text>`, "</svg>");
    return { ...c, svg: P.join(""), x0: L, pw, h };
  }

  // Data druhého místa (pro porovnání jezer); než dorazí, graf se vynechá a pak se záložka překreslí
  function need(id) {
    if (cache[id]) return cache[id] === 1 ? null : cache[id];
    cache[id] = 1;
    fetch(`data/${id}/series.json`).then((r) => r.json()).then((j) => { cache[id] = j; render(); }).catch(() => { delete cache[id]; });
    return null;
  }
  const corr = (a, b) => { // souhlasí spolu dvě křivky? (Pearsonův korelační koeficient)
    const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
    let sab = 0, sa = 0, sb = 0;
    for (let k = 0; k < n; k++) { sab += (a[k] - ma) * (b[k] - mb); sa += (a[k] - ma) ** 2; sb += (b[k] - mb) ** 2; }
    return sab / Math.sqrt(sa * sb || 1);
  };

  // Které grafy patří k otevřenému místu a co v nich je
  function defs() {
    const d = state.data, f = d.frames, a = d.analysis, name = d.name.split(",")[0], out = [];
    const t0 = T(f[0].date), t1 = T(f.at(-1).date), marker = T(f[state.i].date);
    const src = `NISAR L2 GCOV (NASA-ISRO) · ${name} · Dancing Earth`, common = { t0, t1, d0: f[0].date, d1: f.at(-1).date, marker, source: src };

    if (d.kind === "water") {
      // 1) dvě jezera v jednom grafu: jedno se plní, druhé vyprazdňuje
      const ids = ["tonle-sap", "poyang"].filter((id) => state.sites.some((s) => s.id === id));
      const both = ids.map((id) => (id === state.site ? d : need(id)));
      if (ids.length === 2 && both.every(Boolean)) {
        const pts = both.map((x) => x.frames.filter((fr) => fr.waterKm2 != null).map((fr) => ({ t: T(fr.date), v: fr.waterKm2 }))), all = pts.flat(), col = [K.gold, K.blue];
        const nm = both.map((x) => x.name.split(",")[0]), a0 = Math.min(...all.map((p) => p.t)), a1 = Math.max(...all.map((p) => p.t));
        out.push({ id: "two-lakes", title: "Two lakes, same months, opposite directions", ...common, t0: a0, t1: a1, d0: new Date(a0).toISOString().slice(0, 10), d1: new Date(a1).toISOString().slice(0, 10),
          source: "NISAR L2 GCOV (NASA-ISRO) · open water from HV · Dancing Earth",
          legend: nm.map((n, k) => ({ shape: "line", color: col[k], label: `${n} (km² of open water)` })),
          left: { min: 0, max: Math.max(...all.map((p) => p.v)), unit: "km²" },
          items: pts.map((p, k) => ({ type: "line", color: col[k], pts: p, width: ids[k] === state.site ? 2.6 : 1.4 })),
          take: `Over the same months, open water at ${nm[0]} went from ${n0(pts[0][0].v)} to ${n0(pts[0].at(-1).v)} km² (${pct(pts[0][0].v, pts[0].at(-1).v)}), while at ${nm[1]} it went from ${n0(pts[1][0].v)} to ${n0(pts[1].at(-1).v)} km² (${pct(pts[1][0].v, pts[1].at(-1).v)}). The thicker line is the lake you are looking at.` });
      }
      // 2) citlivost na práh: pásmo mezi přísným a o 2 dB volnějším prahem
      const w = f.filter((fr) => fr.waterKm2 != null && fr.waterHiKm2 != null);
      if (w.length > 1) {
        const r = corr(w.map((fr) => fr.waterKm2), w.map((fr) => fr.waterHiKm2)), last = w.at(-1);
        out.push({ id: "threshold", title: `How much the radar threshold matters: ${name}`, ...common,
          legend: [{ shape: "line", color: K.gold, label: `strict threshold (${a.waterDb} dB)` }, { shape: "line", color: K.teal, dash: true, label: `2 dB looser (${a.waterDb + 2} dB)` }, { shape: "bar", color: K.teal, opacity: 0.3, label: "range between them" }],
          left: { min: 0, max: Math.max(...w.map((fr) => fr.waterHiKm2)), unit: "km²" },
          items: [{ type: "band", color: K.teal, pts: w.map((fr) => ({ t: T(fr.date), v: fr.waterKm2, v2: fr.waterHiKm2 })) },
            { type: "line", color: K.teal, dash: true, pts: w.map((fr) => ({ t: T(fr.date), v: fr.waterHiKm2 })) }, { type: "line", color: K.gold, width: 2.2, pts: w.map((fr) => ({ t: T(fr.date), v: fr.waterKm2 })) }],
          take: `On the latest pass (${last.date}) open water is ${n0(last.waterKm2)} km² with the strict threshold and ${n0(last.waterHiKm2)} km² with the looser one. ${r >= 0.7 ? "The two curves rise and fall together, so trust the trend more than the exact area." : "The two curves do not always agree, so treat single passes with care."}` });
      }
    }

    if (d.kind === "fire") {
      // 3) žár po dnech (sloupce) a ztráta vegetace podle radaru (čára)
      // Přelet, kdy se celá scéna posunula o víc než polovinu prahu (např. mokrá půda), je nespolehlivý: v grafu má prázdný bod.
      const lim = a.thresholdDb / 2, isOdd = (fr) => fr.date > d.event && Math.abs(fr.sceneShiftDb || 0) >= lim;
      const F = Fire.facts(), lf = f.filter((fr) => fr.lossKm2 != null), loss = lf.map((fr) => ({ t: T(fr.date), v: fr.lossKm2, odd: isOdd(fr) }));
      if (F && loss.length) {
        const bars = F.days.map((day, k) => ({ t: T(day), v: F.perDay[k] })).filter((p) => p.v > 0), ins = f.filter((fr) => fr.lossInsideKm2 != null).map((fr) => ({ t: T(fr.date), v: fr.lossInsideKm2, odd: isOdd(fr) }));
        const e = T(d.event), a0 = Math.max(t0, e - 30 * DAY), // osa začíná měsíc před požárem
          odd = lf.filter(isOdd), ok = lf.filter((fr) => !isOdd(fr)), lastF = ok.at(-1) || lf.at(-1),
          atEnd = ok.filter((fr) => fr.date <= F.days[F.last]).at(-1), // poslední spolehlivý přelet, dokud ještě hořelo
          share = lastF.lossInsideKm2 != null && lastF.lossKm2 > 0 ? Math.round((lastF.lossInsideKm2 / lastF.lossKm2) * 100) : null,
          grew = atEnd && lastF.date > atEnd.date && lastF.lossKm2 > atEnd.lossKm2 * 1.2;
        const oddNote = odd.length ? ` Hollow points are unusual passes: ${odd.map((fr) => `on ${fr.date} the whole scene was ${Math.abs(fr.sceneShiftDb).toFixed(1)} dB ${fr.sceneShiftDb > 0 ? "brighter" : "darker"} than before the fire and the map showed ${n0(fr.lossKm2)} km²`).join("; ")}. Wet or frozen ground can do that (not checked here), so do not trust ${odd.length > 1 ? "those passes" : "that pass"}.` : "";
        out.push({ id: "heat-and-scar", title: `Heat first, the radar scar later: ${name}`, ...common, t0: a0, d0: new Date(a0).toISOString().slice(0, 10), event: e, eventLabel: "fire starts",
          source: `Heat: VIIRS (NASA FIRMS) · loss: NISAR L2 GCOV · ${name}`,
          legend: [{ shape: "bar", color: K.orange, label: "heat detections per day" }, { shape: "line", color: K.red, label: "radar: vegetation loss (km²)" }, ...(ins.length ? [{ shape: "line", color: K.cloud, dash: true, label: "of it inside the official fire line" }] : []),
            ...(odd.length ? [{ shape: "ring", color: K.red, label: "unusual pass, less reliable" }] : [])],
          left: { min: 0, max: Math.max(...bars.map((p) => p.v)), unit: "per day", color: K.orange }, right: { min: 0, max: Math.max(...loss.map((p) => p.v)), unit: "km²", color: K.red },
          items: [{ type: "bars", color: K.orange, pts: bars, bw: Math.max(1.4, ((W - 92) / ((t1 - a0) / DAY)) * 0.8) },
            ...(ins.length ? [{ type: "line", axis: "right", color: K.cloud, dash: true, pts: ins.filter((p) => p.t >= a0) }] : []), { type: "line", axis: "right", color: K.red, width: 2.2, pts: loss.filter((p) => p.t >= a0) }],
          take: `Heat peaked on ${F.days[F.peak]} (${F.perDay[F.peak].toLocaleString("en-US")} detections in one day) and was last seen on ${F.days[F.last]}. `
            + (grew ? `The radar map showed ${n0(atEnd.lossKm2)} km² of vegetation loss while it still burned (${atEnd.date}) and ${n0(lastF.lossKm2)} km² by ${lastF.date}: the mapped scar kept growing after the last heat. This app does not establish why it lags.`
              : `The radar map showed ${n0(lastF.lossKm2)} km² of vegetation loss by ${lastF.date}.`)
            + (share != null ? ` ${share}% of that area lies inside the official fire line${share < 85 ? "; the rest is other change, not proven to be fire" : ""}.` : "") + oddNote });
      }
    }

    if (d.kind === "forest" || d.kind === "crops") {
      // 4) plocha, která proti výchozímu přeletu ztmavla a zesvětlala
      const ch = f.filter((fr) => fr.lossKm2 != null);
      if (ch.length > 1) {
        const mx = (key) => ch.reduce((m, fr) => (fr[key] > m[key] ? fr : m)), lo = mx("lossKm2"), hi = mx("gainKm2");
        out.push({ id: "darker-brighter", title: `Area that changed since ${a.baselineDates[0]}: ${name}`, ...common,
          legend: [{ shape: "line", color: a.colors.loss, label: `${a.pol} darker by more than ${a.thresholdDb} dB` }, { shape: "line", color: a.colors.gain, label: `${a.pol} brighter by more than ${a.thresholdDb} dB` }],
          left: { min: 0, max: Math.max(...ch.map((fr) => Math.max(fr.lossKm2, fr.gainKm2)), 1), unit: "km²" },
          items: [{ type: "line", color: a.colors.gain, pts: ch.map((fr) => ({ t: T(fr.date), v: fr.gainKm2 })) }, { type: "line", color: a.colors.loss, width: 2.2, pts: ch.map((fr) => ({ t: T(fr.date), v: fr.lossKm2 })) }],
          take: `The darker area was largest on ${lo.date} (${n0(lo.lossKm2)} km²) and the brighter area on ${hi.date} (${n0(hi.gainKm2)} km²), out of ${n0(d.validKm2)} km² mapped. ${d.kind === "forest" ? "Darker can mean clearing, but also burning of pasture or seasonal drying." : "In farmland this follows planting, irrigation and harvest."} Radar shows that the surface changed, not why.` });
      }
    }

    // 5) všude: co by ten den viděla kamera
    const cl = f.filter((fr) => fr.cloudPct != null);
    if (cl.length) {
      const cloudy = cl.filter((fr) => fr.cloudPct >= 50), worst = cl.reduce((m, fr) => (fr.cloudPct > m.cloudPct ? fr : m));
      out.push({ id: "camera-vs-radar", title: "What a camera would have seen on radar pass days", ...common, source: `Cloud: VIIRS photo (NASA GIBS), rough estimate · ${name}`,
        legend: [{ shape: "bar", color: K.cloud, label: "mostly cloud (50% or more)" }, { shape: "bar", color: K.dim, label: "clearer" }, { shape: "dot", color: K.gold, label: "radar pass: ground seen" }],
        left: { min: 0, max: 100, unit: "% cloud" }, dots: { color: K.gold, ts: f.map((fr) => T(fr.date)) },
        items: [{ type: "bars", color: K.dim, pts: cl.map((fr) => ({ t: T(fr.date), v: Math.max(fr.cloudPct, 1.5), color: fr.cloudPct >= 50 ? K.cloud : K.dim })) }],
        take: `On ${cloudy.length} of ${cl.length} radar pass days a camera satellite saw mostly cloud; the cloudiest was ${worst.date} (${worst.cloudPct}%). Radar imaged the ground on all ${f.length} passes. The cloud share is a rough estimate from the photo of the same day.` });
    }
    return out;
  }

  function render() {
    const box = q("#charts");
    if (!box || !state.data || q("#panel").dataset.tab !== "charts") return; // kreslí se, jen když je záložka otevřená
    built = defs().map(draw);
    box.innerHTML = `<p class="lead">Click a chart to jump to that date on the map. Each chart can be saved as an image for a report or a lesson.</p>`
      + built.map((b, k) => `<figure><div class="svgwrap" data-chart="${k}" role="img" aria-label="${esc(b.title)}. ${esc(b.take)}">${b.svg}</div><figcaption>${esc(b.take)}</figcaption><button data-png="${k}">Save as image</button></figure>`).join("")
      + (built.length ? "" : `<p class="lead">No charts for this place yet.</p>`);
  }

  // Uložení grafu jako PNG (3× větší než na obrazovce, aby byl ostrý i v prezentaci)
  function save(k) {
    const b = built[k], img = new Image(), url = URL.createObjectURL(new Blob([b.svg], { type: "image/svg+xml;charset=utf-8" }));
    img.onload = () => {
      const cv = Object.assign(document.createElement("canvas"), { width: W * 3, height: b.h * 3 });
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      cv.toBlob((blob) => {
        const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `dancing-earth_${state.site}_${b.id}.png` });
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 3000);
      }, "image/png");
    };
    img.src = url;
  }

  q("#charts").onclick = (e) => {
    const png = e.target.closest("[data-png]"), wrap = e.target.closest(".svgwrap");
    if (png) { save(+png.dataset.png); return; }
    if (!wrap) return;
    // klik do grafu → nejbližší přelet otevřeného místa
    const b = built[+wrap.dataset.chart], r = wrap.querySelector("svg").getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
    const t = b.t0 + ((px - b.x0) / b.pw) * (b.t1 - b.t0), f = state.data.frames;
    let best = 0;
    f.forEach((fr, j) => { if (Math.abs(T(fr.date) - t) < Math.abs(T(f[best].date) - t)) best = j; });
    stop(); show(best);
  };
  for (const ev of ["de:site", "de:show", "de:fire"]) document.addEventListener(ev, render);
  return { render };
})();
