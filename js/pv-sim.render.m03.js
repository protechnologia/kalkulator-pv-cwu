/* =========================================================
   PV.SIM — Renderowanie Modułu 03 (taryfa sieciowa)

   renderGridChart() — wykres krokowy ceny energii elektrycznej
                       (zł/kWh) przez dobę; strefa dzienna (fiolet)
                       vs nocna (szary), oś Y z ładnymi krokami.
                       Nie wywołuje P.update — brak symulacji.
   ========================================================= */
window.PVSIM = window.PVSIM || {};
(function(P) {
  'use strict';

  // ===== RENDER WYKRESU TARYFY SIECIOWEJ (Moduł 03) =====
  // Wykres krokowy (step) ceny energii elektrycznej przez dobę.
  // Strefa dzienna i nocna zaznaczone różnymi kolorami słupków.
  P.renderGridChart = function() {
    const svg = document.getElementById('pvsim-grid-chart');
    if (!svg) return;
    const W = 780, H = 300;
    const padL = 60, padR = 18, padT = 22, padB = 36;
    const cw = W - padL - padR;
    const ch = H - padT - padB;

    const dayStart = P.state.gridDayStart;
    const dayEnd   = P.state.gridDayEnd;
    const priceDay   = P.state.gridPriceDay;
    const priceNight = P.state.gridPriceNight;
    const rawMax = Math.max(priceDay, priceNight);
    const niceSteps = [0.05, 0.1, 0.2, 0.25, 0.5, 1.0, 2.0];
    const step = niceSteps.find(s => rawMax / s <= 6) || 1.0;
    const yMax = Math.ceil(rawMax / step + 1) * step;

    const x  = h => padL + (h / 24) * cw;
    const y  = v => padT + ch - (v / yMax) * ch;
    const bw = cw / 24;

    const isDay = h => dayStart < dayEnd
      ? h >= dayStart && h < dayEnd
      : h >= dayStart || h < dayEnd;

    let bars = '';
    for (let h = 0; h < 24; h++) {
      const day   = isDay(h);
      const price = day ? priceDay : priceNight;
      const color = day ? 'var(--pvsim-violet)' : 'var(--pvsim-text-2)';
      const barH  = (price / yMax) * ch;
      bars += `<rect x="${x(h).toFixed(2)}" y="${y(price).toFixed(2)}"
                     width="${(bw - 1).toFixed(2)}" height="${barH.toFixed(2)}"
                     fill="${color}" opacity="${day ? '0.75' : '0.4'}"/>`;
    }

    const ticks = Math.round(yMax / step);
    let gridLines = '', yLabels = '';
    for (let i = 0; i <= ticks; i++) {
      const v  = i * step;
      const yy = y(v);
      gridLines += `<line x1="${padL}" y1="${yy.toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${yy.toFixed(2)}"
                          stroke="var(--pvsim-border)" stroke-width="1" ${i === 0 ? '' : 'stroke-dasharray="2,3"'}/>`;
      yLabels += `<text x="${padL - 8}" y="${(yy + 3.5).toFixed(2)}" text-anchor="end"
                        font-family="'IBM Plex Mono', monospace" font-size="10" fill="var(--pvsim-text-2)"
                        font-variant-numeric="tabular-nums">${v.toFixed(2)}</text>`;
    }

    let xLabels = '', xGrid = '';
    for (let h = 0; h <= 24; h += 3) {
      const xx = x(h);
      xGrid += `<line x1="${xx.toFixed(2)}" y1="${padT}" x2="${xx.toFixed(2)}" y2="${(padT + ch).toFixed(2)}"
                      stroke="var(--pvsim-border)" stroke-width="1" stroke-dasharray="1,4"/>`;
      xLabels += `<text x="${xx.toFixed(2)}" y="${(padT + ch + 18).toFixed(2)}" text-anchor="middle"
                        font-family="'IBM Plex Mono', monospace" font-size="10" fill="var(--pvsim-text-2)"
                        font-variant-numeric="tabular-nums">${String(h % 24).padStart(2, '0')}:00</text>`;
    }

    const axes = `
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${(padT + ch).toFixed(2)}" stroke="var(--pvsim-border-strong)" stroke-width="1"/>
      <line x1="${padL}" y1="${(padT + ch).toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${(padT + ch).toFixed(2)}" stroke="var(--pvsim-border-strong)" stroke-width="1"/>
    `;

    // linia ceny dziennej i nocnej
    const refDay   = `<line x1="${padL}" y1="${y(priceDay).toFixed(2)}"   x2="${(W - padR).toFixed(2)}" y2="${y(priceDay).toFixed(2)}"   stroke="#a78bfa" stroke-width="1" stroke-dasharray="4,3" opacity="0.5"/>`;
    const refNight = `<line x1="${padL}" y1="${y(priceNight).toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${y(priceNight).toFixed(2)}" stroke="var(--pvsim-text-2)" stroke-width="1" stroke-dasharray="4,3" opacity="0.5"/>`;

    svg.innerHTML = `
      ${gridLines}${xGrid}${axes}${bars}${refDay}${refNight}${yLabels}${xLabels}
      <text x="${padL - 42}" y="${padT - 10}" font-family="'IBM Plex Mono', monospace" font-size="9.5"
            fill="var(--pvsim-text-2)" letter-spacing="1.4">[zł/kWh]</text>
    `;
  };

})(window.PVSIM);
