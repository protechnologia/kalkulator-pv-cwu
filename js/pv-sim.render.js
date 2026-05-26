/* =========================================================
   PV.SIM — Wspólne helpery warstwy renderowania

   Funkcje per-moduł żyją w pv-sim.render.mXX.js.

   P.fmt          — formatery liczb w polskiej lokalizacji (pl-PL),
                    używane też przez app.js
   P._smoothPath  — interpolacja krzywą Catmull-Rom, wygładza wykresy
                    SVG między próbkami; eksportowana, bo używają jej
                    pliki render.mXX.
   P._niceMax     — „lepki" zakres osi: zaokrągla peak (z headroomem)
                    w górę do {1, 2, 5} × 10ⁿ. Sąsiednie poziomy oddalone
                    o 2–2.5×, więc skala stabilna w szerokim paśmie peaku.
                    Krok osi = yMax / 5 (zawsze ładny: 0.02, 0.05, 0.1…).
   ========================================================= */
window.PVSIM = window.PVSIM || {};
(function(P) {
  'use strict';

  // ===== FORMATOWANIE PL =====
  P.fmt = {
    pl1: n => n.toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    pl2: n => n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    pl0: n => Math.round(n).toLocaleString('pl-PL'),
  };

  // ===== INTERPOLACJA CATMULL–ROM → SVG path =====
  function smoothPath(pts) {
    if (pts.length < 2) return '';
    let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
    }
    return d;
  }
  P._smoothPath = smoothPath;

  // ===== „LEPKI" ZAKRES OSI — yMax z zestawu {1, 2, 5} × 10ⁿ =====
  // Mały ruch suwakiem nie przeskakuje skali — dopiero peak przekraczający
  // bieżący poziom skacze na następny.
  //
  // Argumenty:
  //   peak     — maksymalna wartość danych do pokazania na osi (≥ 0)
  //   headroom — mnożnik nad peakiem (np. 1.10 = 10% odstępu nad peakiem
  //              do góry osi); 1.0 = bez odstępu
  //
  // Zwraca: yMax ∈ {1, 2, 5} × 10ⁿ, najmniejszy taki że yMax ≥ peak·headroom.
  // Krok osi = yMax / 5 zawsze ładny (0.02, 0.05, 0.1, 0.2, 0.5, …).
  P._niceMax = function(peak, headroom) {
    const t = (peak || 0) * (headroom || 1) + 1e-12;
    const exp = Math.floor(Math.log10(t));
    const base = Math.pow(10, exp);
    const m = t / base;
    const mNice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
    return mNice * base;
  };

})(window.PVSIM);
