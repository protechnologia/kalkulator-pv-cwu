/* =========================================================
   PV.SIM — Renderowanie Modułu 07 (inwestycja)

   renderInvestStats() — karty: koszt inwestycji (PV, grzałki, PC,
                         zasobnik, SCADA) i liczba lat na zwrot;
                         wpisuje też wartości do sidebara
   ========================================================= */
window.PVSIM = window.PVSIM || {};
(function(P) {
  'use strict';

  // ===== RENDER STATÓW — INWESTYCJA (Moduł 07) =====
  P.renderInvestStats = function(inv) {
    // wpisuje wartość do panelu Modułu 07 oraz do sidebara
    const set = (txt, ...ids) => ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = txt;
    });

    set(P.fmt.pl0(inv.total),      'pvsim-inv-total',  'pvsim-sb-inv-total');
    set(P.fmt.pl0(inv.costPV),     'pvsim-inv-pv',     'pvsim-sb-inv-pv');
    set(P.fmt.pl0(inv.costHeater), 'pvsim-inv-heater', 'pvsim-sb-inv-heater');
    set(P.fmt.pl0(inv.costHP || 0), 'pvsim-inv-hp',    'pvsim-sb-inv-hp');
    set(P.fmt.pl0(inv.costTank),   'pvsim-inv-tank',   'pvsim-sb-inv-tank');
    set(P.fmt.pl0(inv.costScada),  'pvsim-inv-scada',  'pvsim-sb-inv-scada');

    set(isFinite(inv.paybackYears) ? P.fmt.pl1(inv.paybackYears) : '—',
        'pvsim-inv-payback', 'pvsim-sb-inv-payback');
    set(P.fmt.pl2(inv.annual), 'pvsim-inv-annual', 'pvsim-sb-inv-annual');
  };

})(window.PVSIM);
