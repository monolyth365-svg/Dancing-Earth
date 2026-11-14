// Tancující Země: ukazatel, že se něco načítá (radarový snímek z NASA, nové místo, 3D zeměkoule…).
// Použití: const done = Loader.show("text"); … done();   Více načítání najednou se sčítá; zmizí po posledním.
window.Loader = (() => {
  let box = null, n = 0, since = 0, timer = null;
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
      </svg><span class="ld-text"></span>`;
    document.body.append(box);
  }
  function show(text = "Loading…") {
    if (!box) make();
    n++;
    box.querySelector(".ld-text").textContent = text;
    clearTimeout(timer);
    if (box.hidden) { box.hidden = false; since = performance.now(); }
    let finished = false;
    const done = () => { // zavolat, až je hotovo; ukazatel zůstane vidět aspoň půl vteřiny, aby neproblikl
      if (finished) return;
      finished = true;
      if (--n > 0) return;
      n = 0;
      timer = setTimeout(() => { if (n === 0) box.hidden = true; }, Math.max(0, 500 - (performance.now() - since)));
    };
    setTimeout(done, 30000); // pojistka: kdyby se něco zaseklo, ukazatel nezůstane viset
    return done;
  }
  // pohodlná obálka: ukazatel po dobu běhu slibu (Promise)
  const during = (text, promise) => { const done = show(text); return Promise.resolve(promise).finally(done); };
  return { show, during };
})();
