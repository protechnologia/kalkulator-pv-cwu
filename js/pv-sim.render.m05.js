/* =========================================================
   PV.SIM — Renderowanie Modułu 05 (symulacja miesięczna)

   renderMonthTankChart() — ciągła linia temperatury zasobnika przez
                            cały miesiąc (days × 24 h), kolor błękitny,
                            linie referencyjne T_kran / T_max / T_wodociąg,
                            siatka pionowa co dobę.
   renderMonthElecChart() — wykres słupkowy dobowego bilansu energii
                            elektrycznej pary PC + grzałka (jeden słupek
                            na dobę, dół = PV, góra = sieć), z legendą.
   renderMonthStats()     — karty miesięczne: pokrycie CWU, grzałka, PC,
                            zużycie prądu — źródło (PV vs sieć) i —
                            urządzenie (grzałka vs PC), koszt energii
                            z sieci, ciepło zaoszczędzone, bilans
                            miesięczny (oszczędność − koszt).

   Zależy od P._smoothPath() z pv-sim.render.js.
   ========================================================= */
window.PVSIM = window.PVSIM || {};
(function(P) {
  'use strict';

  // ===== RENDER WYKRESU TEMPERATURY — SYMULACJA MIESIĘCZNA (Moduł 05) =====
  // Ciągła linia temperatury zasobnika przez cały miesiąc (days × 24 h).
  // Pierwsza doba startuje zimna, kolejne dziedziczą temperaturę poprzedniej.
  P.renderMonthTankChart = function(simMonth) {
    const svg = document.getElementById('pvsim-month-tank-chart');
    if (!svg) return;
    const W = 780, H = 300;
    const padL = 50, padR = 18, padT = 22, padB = 36;
    const cw = W - padL - padR;
    const ch = H - padT - padB;

    const yMax = P.Y_MAX_TEMP;
    const days = simMonth.days;
    const xMax = days * 24;

    const x = gh => padL + (gh / xMax) * cw;
    const y = v  => padT + ch - (v / yMax) * ch;

    const T_in = simMonth.T_in;
    const pts = [{ x: x(0), y: y(T_in) }];
    simMonth.hours.forEach(d => pts.push({ x: x(d.gh + 1), y: y(d.T_end) }));

    const linePath = P._smoothPath(pts);
    const areaPath = linePath
      + ` L ${x(xMax).toFixed(2)} ${y(T_in).toFixed(2)} L ${x(0).toFixed(2)} ${y(T_in).toFixed(2)} Z`;

    const yTicks = 7;
    let gridLines = '', yLabels = '';
    for (let i = 0; i <= yTicks; i++) {
      const v = yMax * i / yTicks;
      const yy = y(v);
      gridLines += `<line x1="${padL}" y1="${yy.toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${yy.toFixed(2)}"
                          stroke="var(--pvsim-border)" stroke-width="1" ${i === 0 ? '' : 'stroke-dasharray="2,3"'}/>`;
      yLabels += `<text x="${padL - 8}" y="${(yy + 3.5).toFixed(2)}" text-anchor="end">${Math.round(v)}</text>`;
    }

    const T_hot = P.state.T_hot;
    const refLines = `
      <line x1="${padL}" y1="${y(T_hot).toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${y(T_hot).toFixed(2)}"
            stroke="#2dd4bf" stroke-width="1" stroke-dasharray="6,4" opacity="0.5"/>
      <text x="${(W - padR - 4).toFixed(2)}" y="${(y(T_hot) - 4).toFixed(2)}" text-anchor="end" font-size="9.5" fill="#2dd4bf" opacity="0.8">T_kran ${T_hot}°</text>

      <line x1="${padL}" y1="${y(P.TANK_T_MAX).toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${y(P.TANK_T_MAX).toFixed(2)}"
            stroke="#ef4444" stroke-width="1" stroke-dasharray="6,4" opacity="0.4"/>
      <text x="${(W - padR - 4).toFixed(2)}" y="${(y(P.TANK_T_MAX) - 4).toFixed(2)}" text-anchor="end" font-size="9.5" fill="#ef4444" opacity="0.7">T_max 60°</text>

      <line x1="${padL}" y1="${y(T_in).toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${y(T_in).toFixed(2)}"
            stroke="var(--pvsim-text-2)" stroke-width="1" stroke-dasharray="3,3" opacity="0.5"/>
      <text x="${(W - padR - 4).toFixed(2)}" y="${(y(T_in) - 4).toFixed(2)}" text-anchor="end" font-size="9.5" fill="#a1a1aa" opacity="0.7">T_wodociąg ${T_in.toFixed(1)}°</text>
    `;

    // Siatka pionowa — jedna linia na dobę; etykieta numeru doby co kilka dób.
    const labelEvery = days > 16 ? 2 : 1;
    let xLabels = '', xGrid = '';
    for (let d = 0; d <= days; d++) {
      const xx = x(d * 24);
      xGrid += `<line x1="${xx.toFixed(2)}" y1="${padT}" x2="${xx.toFixed(2)}" y2="${(padT + ch).toFixed(2)}"
                      stroke="var(--pvsim-border)" stroke-width="1" stroke-dasharray="1,4"/>`;
      if (d < days && d % labelEvery === 0) {
        xLabels += `<text x="${(xx + (cw / days) / 2).toFixed(2)}" y="${(padT + ch + 18).toFixed(2)}" text-anchor="middle">${d + 1}</text>`;
      }
    }

    const axes = `
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${(padT + ch).toFixed(2)}" stroke="var(--pvsim-border-strong)" stroke-width="1"/>
      <line x1="${padL}" y1="${(padT + ch).toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${(padT + ch).toFixed(2)}" stroke="var(--pvsim-border-strong)" stroke-width="1"/>
    `;

    svg.innerHTML = `
      <defs>
        <linearGradient id="pvsim-month-tank-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stop-color="#38bdf8" stop-opacity="0.4"/>
          <stop offset="60%" stop-color="#38bdf8" stop-opacity="0.1"/>
          <stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${gridLines}${xGrid}${axes}${refLines}
      <path d="${areaPath}" fill="url(#pvsim-month-tank-grad)"/>
      <path d="${linePath}" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-linejoin="round"/>
      ${yLabels}${xLabels}
      <text x="${padL - 30}" y="${padT - 10}" font-size="9.5" letter-spacing="1.4">[°C]</text>
      <text x="${(padL + cw / 2).toFixed(2)}" y="${(H - 4).toFixed(2)}" text-anchor="middle" font-size="9" letter-spacing="1">doba</text>
    `;

    const ctxEl = document.getElementById('pvsim-month-tank-ctx');
    if (ctxEl) {
      const m = P.MONTHS[P.state.monthIdx];
      ctxEl.textContent = `— ${m.name}, ${days} dób · start zimny ${T_in.toFixed(1)}°C`;
    }
  };

  // ===== RENDER WYKRESU ENERGII ELEKTRYCZNEJ — SYMULACJA MIESIĘCZNA (Moduł 05) =====
  // Słupki dobowe: jeden słupek na dobę, dół = energia z PV, góra = energia z sieci.
  P.renderMonthElecChart = function(simMonth) {
    const svg = document.getElementById('pvsim-month-elec-chart');
    if (!svg) return;
    const W = 780, H = 300;
    const padL = 50, padR = 18, padT = 22, padB = 36;
    const cw = W - padL - padR;
    const ch = H - padT - padB;

    const days = simMonth.days;
    const dd   = simMonth.daysData;

    const pvOf   = d => d.elec_pair_pv   != null ? d.elec_pair_pv   : d.elec_pv;
    const gridOf = d => d.elec_pair_grid != null ? d.elec_pair_grid : d.elec_grid;
    const rawMax = Math.max(
      ...dd.map(d => pvOf(d) + gridOf(d)), 0.001
    );
    const niceSteps = [1, 2, 2.5, 5, 10, 20, 50, 100];
    const step = niceSteps.find(s => rawMax / s <= 6) || 200;
    const yMax = Math.ceil(rawMax / step + 0.001) * step;

    const slot = cw / days;
    const x = d => padL + d * slot;
    const y = v => padT + ch - (v / yMax) * ch;
    const bw = slot * 0.7;
    const bx = slot * 0.15;   // wcięcie słupka w slocie doby

    let bars = '';
    dd.forEach(d => {
      const ePv   = pvOf(d);
      const eGrid = gridOf(d);
      const pvH   = (ePv   / yMax) * ch;
      const gridH = (eGrid / yMax) * ch;
      const x0 = x(d.day) + bx;
      if (pvH > 0.05) {
        bars += `<rect x="${x0.toFixed(2)}" y="${y(ePv).toFixed(2)}"
                       width="${bw.toFixed(2)}" height="${pvH.toFixed(2)}"
                       fill="#f59e0b" opacity="0.8"/>`;
      }
      if (gridH > 0.05) {
        bars += `<rect x="${x0.toFixed(2)}" y="${y(ePv + eGrid).toFixed(2)}"
                       width="${bw.toFixed(2)}" height="${gridH.toFixed(2)}"
                       fill="#a78bfa" opacity="0.75"/>`;
      }
    });

    const ticks = Math.round(yMax / step);
    let gridLines = '', yLabels = '';
    for (let i = 0; i <= ticks; i++) {
      const v = i * step;
      const yy = y(v);
      gridLines += `<line x1="${padL}" y1="${yy.toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${yy.toFixed(2)}"
                          stroke="var(--pvsim-border)" stroke-width="1" ${i === 0 ? '' : 'stroke-dasharray="2,3"'}/>`;
      yLabels += `<text x="${padL - 8}" y="${(yy + 3.5).toFixed(2)}" text-anchor="end">${P.fmt.pl0(v)}</text>`;
    }

    const labelEvery = days > 16 ? 2 : 1;
    let xLabels = '';
    for (let d = 0; d < days; d++) {
      if (d % labelEvery === 0) {
        xLabels += `<text x="${(x(d) + slot / 2).toFixed(2)}" y="${(padT + ch + 18).toFixed(2)}" text-anchor="middle">${d + 1}</text>`;
      }
    }

    const axes = `
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${(padT + ch).toFixed(2)}" stroke="var(--pvsim-border-strong)" stroke-width="1"/>
      <line x1="${padL}" y1="${(padT + ch).toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${(padT + ch).toFixed(2)}" stroke="var(--pvsim-border-strong)" stroke-width="1"/>
    `;

    const lx = W - padR - 150;
    const legend = `
      <rect x="${lx}" y="${padT + 2}" width="10" height="10" fill="#f59e0b" opacity="0.8"/>
      <text x="${lx + 15}" y="${padT + 11}" fill="#a1a1aa">z PV</text>
      <rect x="${lx + 60}" y="${padT + 2}" width="10" height="10" fill="#a78bfa" opacity="0.75"/>
      <text x="${lx + 75}" y="${padT + 11}" fill="#a1a1aa">z sieci</text>
    `;

    svg.innerHTML = `
      ${gridLines}${axes}${bars}${legend}${yLabels}${xLabels}
      <text x="${padL - 30}" y="${padT - 10}" font-size="9.5" letter-spacing="1.4">[kWh]</text>
      <text x="${(padL + cw / 2).toFixed(2)}" y="${(H - 4).toFixed(2)}" text-anchor="middle" font-size="9" letter-spacing="1">doba</text>
    `;

    const ctxEl = document.getElementById('pvsim-month-elec-ctx');
    if (ctxEl) {
      const mo = simMonth.monthly;
      const pv   = mo.elec_pair_pv   != null ? mo.elec_pair_pv   : mo.elec_pv;
      const grid = mo.elec_pair_grid != null ? mo.elec_pair_grid : mo.elec_grid;
      ctxEl.textContent = `— z PV ${P.fmt.pl0(pv)} kWh · z sieci ${P.fmt.pl0(grid)} kWh`;
    }
  };

  // ===== RENDER STATÓW — SYMULACJA MIESIĘCZNA (Moduł 05) =====
  P.renderMonthStats = function(simMonth) {
    const mo = simMonth.monthly;
    // wpisuje wartość do panelu Modułu 05 (sidebar obsługuje renderYearStats)
    const set = (txt, id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = txt;
    };

    const ePv   = mo.elec_pair_pv    != null ? mo.elec_pair_pv    : mo.elec_pv;
    const eGrid = mo.elec_pair_grid  != null ? mo.elec_pair_grid  : mo.elec_grid;
    const eTot  = mo.elec_pair_total != null ? mo.elec_pair_total : mo.elec_total;
    const elecTotal = P.fmt.pl0(eTot);
    const elecPv    = P.fmt.pl0(ePv);
    const elecGrid  = P.fmt.pl0(eGrid);
    const gridCost  = P.fmt.pl2(mo.gridCost);
    const saving    = P.fmt.pl2(mo.savingPLN);
    const savingKwh = P.fmt.pl0(mo.Q_saved);
    const savingGj  = P.fmt.pl2(mo.Q_saved * 0.0036);
    const balance   = P.fmt.pl2(mo.balancePLN);

    set(mo.coveragePct.toFixed(0), 'pvsim-month-cover');
    set(P.fmt.pl0(mo.Q_saved),     'pvsim-month-cover-kwh');
    set(P.fmt.pl0(mo.Q_saved),                  'pvsim-month-bilans-kwh');
    set('+ ' + P.fmt.pl0(mo.Q_residual || 0),   'pvsim-month-bilans-residual');
    set('+ ' + P.fmt.pl0(mo.Q_strat),           'pvsim-month-bilans-strat');
    set(mo.heaterHours,            'pvsim-month-heater-hrs');
    set(P.fmt.pl0(mo.Q_heater || 0), 'pvsim-month-heater-kwh');
    set(mo.hpHours || 0,           'pvsim-month-hp-hrs');
    set(P.fmt.pl0(mo.Q_hp || 0),   'pvsim-month-hp-kwh');
    set(elecTotal, 'pvsim-month-elec-total');
    set(elecPv,    'pvsim-month-elec-pv');
    set(elecGrid,  'pvsim-month-elec-grid');
    const moElHt = (mo.elec_pv || 0) + (mo.elec_grid || 0);
    const moElHp = (mo.elec_hp_pv || 0) + (mo.elec_hp_grid || 0);
    set(P.fmt.pl0(moElHt + moElHp), 'pvsim-month-elec-dev-total');
    set(P.fmt.pl0(moElHt),          'pvsim-month-elec-dev-heater');
    set(P.fmt.pl0(moElHp),          'pvsim-month-elec-dev-hp');
    set(gridCost,  'pvsim-month-grid-cost');
    set(saving,    'pvsim-month-saving');
    set(savingKwh, 'pvsim-month-saving-kwh');
    set(savingGj,  'pvsim-month-saving-gj');
    set(balance,   'pvsim-month-balance');
    set(saving,    'pvsim-month-balance-saving');
    set(gridCost,  'pvsim-month-balance-cost');
  };

})(window.PVSIM);
