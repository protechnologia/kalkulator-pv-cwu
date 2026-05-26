/* =========================================================
   PV.SIM — Renderowanie wykresów i statystyk

   Odpowiada za całą warstwę prezentacji — nie wykonuje obliczeń,
   tylko przetwarza wyniki symulacji na elementy DOM i SVG.

   P.fmt — formatery liczb w polskiej lokalizacji (pl-PL),
     eksportowane na namespace, bo używa ich też app.js

   Prywatna smoothPath() — interpolacja krzywą Catmull-Rom,
     wygładza wykresy SVG między próbkami godzinowymi.

   Moduł 01 — PV: wydzielone do pv-sim.render.m01.js
     renderChart(), renderStats(), renderPVMonthChart()

   Moduł 02 — CWU: wydzielone do pv-sim.render.m02.js
     renderDHWChart(), renderDHWStats()

   Moduł 03 — Sieć: wydzielone do pv-sim.render.m03.js
     renderGridChart()

   Moduł 04 — Zasobnik (PC + grzałka): wydzielone do pv-sim.render.m04.js
     renderTankChart(), renderTankElecChart(),
     renderHeatSplitChart(), renderTankStats()

   Moduł 05 — Symulacja miesięczna: wydzielone do pv-sim.render.m05.js
     renderMonthTankChart(), renderMonthElecChart(), renderMonthStats()

   Moduł 06 — Symulacja roczna: wydzielone do pv-sim.render.m06.js
     renderYearChart(), renderYearCoverChart(), renderYearStats()

   Moduł 07 — Inwestycja: wydzielone do pv-sim.render.m07.js
     renderInvestStats()

   Moduł 08 — Optymalizacja: wydzielone do pv-sim.render.m08.js
     renderOptimTable()
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

  // ===== Moduł 01 (PV) — wydzielony do pv-sim.render.m01.js =====
  // renderChart, renderStats, renderPVMonthChart — patrz pv-sim.render.m01.js

  // ===== Moduł 02 (CWU) — wydzielony do pv-sim.render.m02.js =====
  // renderDHWChart, renderDHWStats — patrz pv-sim.render.m02.js

  // ===== Moduł 05 (Symulacja miesięczna) — wydzielony do pv-sim.render.m05.js =====
  // renderMonthTankChart, renderMonthElecChart, renderMonthStats — patrz pv-sim.render.m05.js

  // ===== Moduł 06 (Symulacja roczna) — wydzielony do pv-sim.render.m06.js =====
  // renderYearChart, renderYearCoverChart, renderYearStats — patrz pv-sim.render.m06.js

})(window.PVSIM);
