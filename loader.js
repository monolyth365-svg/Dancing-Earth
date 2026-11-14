// Tancující Země: ukazatel, že se něco načítá (radarový snímek z NASA, nové místo, 3D zeměkoule…).
// Pod textem běží čára průběhu:
//   • když víme, kolik je staženo (např. velký radarový snímek), ukazuje skutečný podíl zleva doprava;
//   • když jen čekáme na odpověď (např. dotaz do archivu NASA), běží čára dokola – délku čekání znát nejde.
// Použití:  const done = Loader.show("text");  done.progress(0.4);  …  done();
window.Loader = (() => {
  let box = null, tasks = [], since = 0, timer = null;
  function make() {
    box = document.createElement("div");
    box.className = "loader"; box.hidden = true;
    box.setAttribute("role", "status"); box.setAttribute("aria-live", "polite");
    box.innerHTML = `<svg viewBox="0 0 72 76" width="62" height="66" aria-hidden="true">
        <g class="ld-waves" fill="none" stroke="#e9b949" stroke-width="3" stroke-linecap="round"><path d="M47 14a12 12 0 0 1 10 10"/><path d="M50 6a20 20 0 0 1 15 15"/></g>
        <g class="ld-body">
          <path class="ld-leg ld-l" d="M29 55v11h-6" fill="none" stroke="#e8eaed" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
          <path class="ld-leg ld-r" d="M41 55v11h6" fill="none" stroke="#e8eaed" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
          <path class="ld-arm ld-al" d="M17 38l-10-8" fill="none" stroke="#e8eaed" stroke-width="3.2" stroke-linecap="round"/>
          <path class="ld-arm ld-ar" d="M53 38l10-8" fill="none" stroke="#e8eaed" stroke-width="3.2" stroke-linecap="round"/>
          <circle cx="35" cy="38" r="19" fill="#1f5fa8"/>
          <path d="M21 33c5-7 10-8 15-5s3 8 9 7 7-6 8-2c-1 10-9 18-18 18-7 0-13-5-15-10 0-3 0-6 1-8z" fill="#3fa66b"/>
          <circle cx="29" cy="34" r="2.1" fill="#0b0d10"/><circle cx="41" cy="34" r="2.1" fill="#0b0d10"/>
          <path d="M29 42q6 5 12 0" fill="none" stroke="#0b0d10" stroke-width="2" stroke-linecap="round"/>
        </g>
      </svg><span class="ld-col"><span class="ld-text"></span><span class="ld-row" aria-hidden="true"><span class="ld-bar"><i></i></span><span class="ld-pct"></span></span></span>`;
    document.body.append(box);
  }
  // Ukazuje se vždy poslední spuštěné načítání
  function render() {
    const t = tasks.at(-1);
    if (!t) return;
    const bar = box.querySelector(".ld-bar"), known = t.p != null;
    box.querySelector(".ld-text").textContent = t.text;
    bar.classList.toggle("unknown", !known);
    bar.firstChild.style.width = known ? `${Math.round(t.p * 100)}%` : "";
    box.querySelector(".ld-pct").textContent = known ? `${Math.round(t.p * 100)}%` : "";
  }
  function show(text = "Loading…") {
    if (!box) make();
    const task = { text, p: null };
    tasks.push(task);
    clearTimeout(timer);
    if (box.hidden) { box.hidden = false; since = performance.now(); }
    render();
    let finished = false, guard;
    const done = () => { // zavolat, až je hotovo; ukazatel zůstane vidět aspoň půl vteřiny, aby neproblikl
      if (finished) return;
      finished = true; clearTimeout(guard);
      tasks = tasks.filter((x) => x !== task);
      if (tasks.length) { render(); return; }
      const bar = box.querySelector(".ld-bar"); // čára doběhne do konce a ukazatel zmizí
      bar.classList.remove("unknown"); bar.firstChild.style.width = "100%"; box.querySelector(".ld-pct").textContent = "";
      timer = setTimeout(() => { if (!tasks.length) box.hidden = true; }, Math.max(280, 500 - (performance.now() - since)));
    };
    // pojistka: kdyby se něco zaseklo, ukazatel nezůstane viset (každý ohlášený postup ji odsune)
    const arm = () => { clearTimeout(guard); guard = setTimeout(done, 30000); };
    done.progress = (f) => { // f = 0 až 1
      if (finished || !isFinite(f)) return;
      task.p = Math.max(task.p || 0, Math.min(1, Math.max(0, f)));
      arm();
      if (tasks.at(-1) === task) render();
    };
    arm();
    return done;
  }
  // Ukazatel po dobu běhu slibu (Promise). Místo slibu lze předat funkci, která dostane hlášení postupu.
  const during = (text, job) => { const done = show(text); return Promise.resolve(typeof job === "function" ? job(done.progress) : job).finally(done); };
  // Stažení souboru s hlášením skutečného postupu (podíl stažených bajtů)
  async function fetchBlob(url, onProgress, type) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const total = +r.headers.get("content-length") || 0;
    if (!r.body || !total || !onProgress) return r.blob();
    const reader = r.body.getReader(), chunks = [];
    for (let got = 0; ;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      onProgress(got / total);
    }
    return new Blob(chunks, { type: type || r.headers.get("content-type") || "" });
  }
  return { show, during, fetchBlob };
})();
