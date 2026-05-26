/* =========================================================
   PV.SIM — Renderowanie Modułu 06 (symulacja roczna)

   renderYearChart()      — wykres słupkowy energii elektrycznej pary
                            PC + grzałka (jeden słupek na miesiąc,
                            PV vs sieć)
   renderYearCoverChart() — wykres słupkowy miesięcznego pokrycia CWU
                            (pokryte vs brak; etykieta % nad każdym
                            słupkiem; mniejsza etykieta — zakres dobowego
                            pokrycia min–max)
   renderYearStats()      — karty roczne: pokrycie CWU, grzałka, PC,
                            zużycie prądu — źródło i — urządzenie, koszt,
                            ciepło zaoszczędzone, bilans; część wartości
                            dublowana w sidebarze
   ========================================================= */
window.PVSIM = window.PVSIM || {};
(function(P) {
  'use strict';

  // ===== RENDER WYKRESU ENERGII ELEKTRYCZNEJ — SYMULACJA ROCZNA (Moduł 06) =====
  // Słupki miesięczne: jeden słupek na miesiąc, 4-stos
  // (PC·PV, grz·PV, PC·sieć, grz·sieć). 12 słupków, oś X — skróty miesięcy.
  P.renderYearChart = function(simYear) {
    const svg = document.getElementById('pvsim-year-chart');
    if (!svg) return;
    const W = 780, H = 300;
    const padL = 50, padR = 18, padT = 22, padB = 36;
    const cw = W - padL - padR;
    const ch = H - padT - padB;

    const md = simYear.monthsData;

    const totalOf = d => (d.elec_hp_pv || 0) + (d.elec_pv || 0)
                       + (d.elec_hp_grid || 0) + (d.elec_grid || 0);
    const rawMax = Math.max(...md.map(totalOf), 0.001);
    const niceSteps = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
    const step = niceSteps.find(s => rawMax / s <= 6) || 5000;
    const yMax = Math.ceil(rawMax / step + 0.001) * step;

    const slot = cw / 12;
    const x = i => padL + i * slot;
    const y = v => padT + ch - (v / yMax) * ch;
    const bw = slot * 0.62;
    const bx = slot * 0.19;   // wcięcie słupka w slocie miesiąca

    // 4-stos (od dołu): PC·PV, grz·PV, PC·sieć, grz·sieć
    const SEG = [
      { key: 'elec_hp_pv',   color: '#f59e0b' },
      { key: 'elec_pv',      color: '#fcd34d' },
      { key: 'elec_hp_grid', color: '#a78bfa' },
      { key: 'elec_grid',    color: '#c4b5fd' },
    ];
    let bars = '';
    md.forEach((d, i) => {
      const x0 = x(i) + bx;
      let acc = 0;
      for (const s of SEG) {
        const v = d[s.key] || 0;
        if (v <= 0) continue;
        const segH = (v / yMax) * ch;
        if (segH > 0.05) {
          bars += `<rect x="${x0.toFixed(2)}" y="${y(acc + v).toFixed(2)}"
                         width="${bw.toFixed(2)}" height="${segH.toFixed(2)}"
                         fill="${s.color}" opacity="0.9"/>`;
        }
        acc += v;
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

    let xLabels = '';
    md.forEach((d, i) => {
      xLabels += `<text x="${(x(i) + slot / 2).toFixed(2)}" y="${(padT + ch + 18).toFixed(2)}" text-anchor="middle" font-size="9" letter-spacing="0.5">${d.abbr}</text>`;
    });

    const axes = `
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${(padT + ch).toFixed(2)}" stroke="var(--pvsim-border-strong)" stroke-width="1"/>
      <line x1="${padL}" y1="${(padT + ch).toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${(padT + ch).toFixed(2)}" stroke="var(--pvsim-border-strong)" stroke-width="1"/>
    `;

    const lx = W - padR - 320;
    const legend = `
      <rect x="${lx}"       y="${padT + 2}" width="10" height="10" fill="#f59e0b" opacity="0.9"/>
      <text x="${lx + 14}"  y="${padT + 11}" fill="#a1a1aa">PC·PV</text>
      <rect x="${lx + 70}"  y="${padT + 2}" width="10" height="10" fill="#fcd34d" opacity="0.9"/>
      <text x="${lx + 84}"  y="${padT + 11}" fill="#a1a1aa">grz·PV</text>
      <rect x="${lx + 145}" y="${padT + 2}" width="10" height="10" fill="#a78bfa" opacity="0.9"/>
      <text x="${lx + 159}" y="${padT + 11}" fill="#a1a1aa">PC·sieć</text>
      <rect x="${lx + 225}" y="${padT + 2}" width="10" height="10" fill="#c4b5fd" opacity="0.9"/>
      <text x="${lx + 239}" y="${padT + 11}" fill="#a1a1aa">grz·sieć</text>
    `;

    svg.innerHTML = `
      ${gridLines}${axes}${bars}${legend}${yLabels}${xLabels}
      <text x="${padL - 30}" y="${padT - 10}" font-size="9.5" letter-spacing="1.4">[kWh]</text>
      <text x="${(padL + cw / 2).toFixed(2)}" y="${(H - 4).toFixed(2)}" text-anchor="middle" font-size="9" letter-spacing="1">miesiąc</text>
    `;

    const ctxEl = document.getElementById('pvsim-year-chart-ctx');
    if (ctxEl) {
      const yr = simYear.yearly;
      const pv   = yr.elec_pair_pv   != null ? yr.elec_pair_pv   : yr.elec_pv;
      const grid = yr.elec_pair_grid != null ? yr.elec_pair_grid : yr.elec_grid;
      ctxEl.textContent = `— z PV ${P.fmt.pl0(pv)} kWh · z sieci ${P.fmt.pl0(grid)} kWh`;
    }
  };

  // ===== RENDER WYKRESU POKRYCIA CWU — SYMULACJA ROCZNA (Moduł 06) =====
  // Słupki miesięczne: pełna wysokość = miesięczne zapotrzebowanie CWU [kWh],
  // dół (lime) = ciepło dostarczone z zasobnika (Q_saved), góra (szary) = reszta
  // zapotrzebowania nieprzykryta przez układ PC + grzałka. Procent pokrycia
  // jako etykieta nad każdym słupkiem.
  P.renderYearCoverChart = function(simYear) {
    const svg = document.getElementById('pvsim-year-cover-chart');
    if (!svg) return;
    const W = 780, H = 300;
    const padL = 50, padR = 18, padT = 22, padB = 36;
    const cw = W - padL - padR;
    const ch = H - padT - padB;

    const md = simYear.monthsData;

    const rawMax = Math.max(...md.map(d => d.Q_CWU || 0), 0.001);
    const niceSteps = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
    const step = niceSteps.find(s => rawMax / s <= 6) || 5000;
    const yMax = Math.ceil(rawMax / step + 0.001) * step;

    const slot = cw / 12;
    const x = i => padL + i * slot;
    const y = v => padT + ch - (v / yMax) * ch;
    const bw = slot * 0.62;
    const bx = slot * 0.19;

    let bars = '', pctLabels = '';
    md.forEach((d, i) => {
      const cwuM = d.Q_CWU || 0;
      const covered = Math.min(d.Q_saved || 0, cwuM);
      const missing = Math.max(cwuM - covered, 0);
      const coveredH = (covered / yMax) * ch;
      const missingH = (missing / yMax) * ch;
      const x0 = x(i) + bx;
      if (coveredH > 0.05) {
        bars += `<rect x="${x0.toFixed(2)}" y="${y(covered).toFixed(2)}"
                       width="${bw.toFixed(2)}" height="${coveredH.toFixed(2)}"
                       fill="#a3e635" opacity="0.85"/>`;
      }
      if (missingH > 0.05) {
        bars += `<rect x="${x0.toFixed(2)}" y="${y(covered + missing).toFixed(2)}"
                       width="${bw.toFixed(2)}" height="${missingH.toFixed(2)}"
                       fill="#71717a" opacity="0.45"/>`;
      }
      const pct = cwuM > 0.001 ? (covered / cwuM * 100) : 0;
      const topY = y(cwuM);
      const cx = (x0 + bw / 2).toFixed(2);
      // główna etykieta — pokrycie miesięczne
      pctLabels += `<text x="${cx}" y="${(topY - 5).toFixed(2)}" text-anchor="middle" font-size="9.5" font-weight="600" fill="#a3e635">${pct.toFixed(0)}%</text>`;
      // mniejsza etykieta nad nią — zakres pokrycia dobowego (min–max)
      if (d.coverMaxPct != null && d.coverMaxPct >= 0) {
        const lo = Math.round(d.coverMinPct);
        const hi = Math.round(d.coverMaxPct);
        pctLabels += `<text x="${cx}" y="${(topY - 17).toFixed(2)}" text-anchor="middle" font-size="8" opacity="0.85">${lo}%–${hi}%</text>`;
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

    let xLabels = '';
    md.forEach((d, i) => {
      xLabels += `<text x="${(x(i) + slot / 2).toFixed(2)}" y="${(padT + ch + 18).toFixed(2)}" text-anchor="middle" font-size="9" letter-spacing="0.5">${d.abbr}</text>`;
    });

    const axes = `
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${(padT + ch).toFixed(2)}" stroke="var(--pvsim-border-strong)" stroke-width="1"/>
      <line x1="${padL}" y1="${(padT + ch).toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${(padT + ch).toFixed(2)}" stroke="var(--pvsim-border-strong)" stroke-width="1"/>
    `;

    const lx = W - padR - 150;
    const legend = `
      <rect x="${lx}" y="${padT + 2}" width="10" height="10" fill="#a3e635" opacity="0.85"/>
      <text x="${lx + 15}" y="${padT + 11}" fill="#a1a1aa">pokryte</text>
      <rect x="${lx + 70}" y="${padT + 2}" width="10" height="10" fill="#71717a" opacity="0.45"/>
      <text x="${lx + 85}" y="${padT + 11}" fill="#a1a1aa">brak</text>
    `;

    svg.innerHTML = `
      ${gridLines}${axes}${bars}${pctLabels}${legend}${yLabels}${xLabels}
      <text x="${padL - 30}" y="${padT - 10}" font-size="9.5" letter-spacing="1.4">[kWh]</text>
      <text x="${(padL + cw / 2).toFixed(2)}" y="${(H - 4).toFixed(2)}" text-anchor="middle" font-size="9" letter-spacing="1">miesiąc</text>
    `;

    const ctxEl = document.getElementById('pvsim-year-cover-chart-ctx');
    if (ctxEl) {
      const yr = simYear.yearly;
      ctxEl.textContent = `— pokrycie roczne ${yr.coveragePct.toFixed(0)}% · ${P.fmt.pl0(yr.Q_saved)} kWh dostarczone`;
    }
  };

  // ===== RENDER STATÓW — SYMULACJA ROCZNA (Moduł 06) =====
  P.renderYearStats = function(simYear) {
    const yr = simYear.yearly;
    // wpisuje wartość do panelu Modułu 06 oraz, opcjonalnie, do sidebara
    const set = (txt, ...ids) => ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = txt;
    });

    const ePv   = yr.elec_pair_pv    != null ? yr.elec_pair_pv    : yr.elec_pv;
    const eGrid = yr.elec_pair_grid  != null ? yr.elec_pair_grid  : yr.elec_grid;
    const eTot  = yr.elec_pair_total != null ? yr.elec_pair_total : yr.elec_total;
    const elecTotal = P.fmt.pl0(eTot);
    const elecPv    = P.fmt.pl0(ePv);
    const elecGrid  = P.fmt.pl0(eGrid);
    const gridCost  = P.fmt.pl2(yr.gridCost);
    const saving    = P.fmt.pl2(yr.savingPLN);
    const savingKwh = P.fmt.pl0(yr.Q_saved);
    const savingGj  = P.fmt.pl2(yr.Q_saved * 0.0036);
    const balance   = P.fmt.pl2(yr.balancePLN);

    set(yr.coveragePct.toFixed(0), 'pvsim-year-cover');
    set(P.fmt.pl0(yr.Q_saved),     'pvsim-year-cover-kwh');
    set(P.fmt.pl0(yr.Q_saved),                  'pvsim-year-bilans-kwh');
    set('+ ' + P.fmt.pl0(yr.Q_residual || 0),   'pvsim-year-bilans-residual');
    set('+ ' + P.fmt.pl0(yr.Q_strat),           'pvsim-year-bilans-strat');
    set(P.fmt.pl0(yr.heaterHours), 'pvsim-year-heater-hrs');
    set(P.fmt.pl0(yr.Q_heater || 0), 'pvsim-year-heater-kwh');
    set(P.fmt.pl0(yr.hpHours || 0),  'pvsim-year-hp-hrs');
    set(P.fmt.pl0(yr.Q_hp || 0),     'pvsim-year-hp-kwh');
    set(elecTotal, 'pvsim-year-elec-total', 'pvsim-sb-elec-total');
    set(elecPv,    'pvsim-year-elec-pv',    'pvsim-sb-elec-pv');
    set(elecGrid,  'pvsim-year-elec-grid',  'pvsim-sb-elec-grid');
    const yrElHt = (yr.elec_pv || 0) + (yr.elec_grid || 0);
    const yrElHp = (yr.elec_hp_pv || 0) + (yr.elec_hp_grid || 0);
    set(P.fmt.pl0(yrElHt + yrElHp), 'pvsim-year-elec-dev-total');
    set(P.fmt.pl0(yrElHt),          'pvsim-year-elec-dev-heater');
    set(P.fmt.pl0(yrElHp),          'pvsim-year-elec-dev-hp');
    set(gridCost,  'pvsim-year-grid-cost',  'pvsim-sb-grid-cost');
    set(saving,    'pvsim-year-saving',     'pvsim-sb-saving');
    set(savingKwh, 'pvsim-year-saving-kwh', 'pvsim-sb-saving-kwh');
    set(savingGj,  'pvsim-year-saving-gj',  'pvsim-sb-saving-gj');
    set(balance,   'pvsim-year-balance',        'pvsim-sb-balance');
    set(saving,    'pvsim-year-balance-saving', 'pvsim-sb-balance-saving');
    set(gridCost,  'pvsim-year-balance-cost',   'pvsim-sb-balance-cost');
  };

})(window.PVSIM);
