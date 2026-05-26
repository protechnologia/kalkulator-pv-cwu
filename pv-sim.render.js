/* =========================================================
   PV.SIM — Wspólne helpery warstwy renderowania

   Funkcje per-moduł żyją w pv-sim.render.mXX.js.

   P.fmt          — formatery liczb w polskiej lokalizacji (pl-PL),
                    używane też przez app.js
   P._smoothPath  — interpolacja krzywą Catmull-Rom, wygładza wykresy
                    SVG między próbkami; eksportowana, bo używają jej
                    pliki render.mXX.
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

})(window.PVSIM);
