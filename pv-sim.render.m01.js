/* =========================================================
   PV.SIM — Renderowanie Modułu 01 (PV)

   Wydzielone z pv-sim.render.js.

   renderChart()        — wykres mocy chwilowej (kW) reprezentatywnej
                          doby, kolor pomarańczowy, marker P_max
                          w południe, gradientowe wypełnienie obszaru.
   renderStats()        — karty: produkcja dobowa, miesięczna, moc
                          szczytowa + etykieta kontekstu wykresu
                          (miesiąc + tryb doby).
   renderPVMonthChart() — wykres słupkowy produkcji dobowej PV przez
                          cały miesiąc (jeden słupek na dobę), z linią
                          średniej dobowej; ujawnia zmienność pogody
                          generowaną przez P.dailyWeatherFactors().

   Zależy od P._smoothPath() (eksportowane z pv-sim.render.js).
   ========================================================= */
window.PVSIM = window.PVSIM || {};
(function(P) {
  'use strict';

  // ===== RENDER WYKRESU =====
  P.renderChart = function(sim) {
    const svg = document.getElementById('pvsim-chart');
    const W = 780, H = 300;
    const padL = 50, padR = 18, padT = 22, padB = 36;
    const cw = W - padL - padR;
    const ch = H - padT - padB;

    const yMax = P.Y_MAX_KW;
    const xMax = 24;

    const x = h => padL + (h / xMax) * cw;
    const y = p => padT + ch - (p / yMax) * ch;

    const pts = sim.hours.map(d => ({ x: x(d.hour + 0.5), y: y(d.power) }));
    pts.unshift({ x: x(0), y: y(0) });
    pts.push({ x: x(24), y: y(0) });

    const linePath = P._smoothPath(pts);
    const areaPath = linePath + ` L ${x(24).toFixed(2)} ${y(0).toFixed(2)} L ${x(0).toFixed(2)} ${y(0).toFixed(2)} Z`;

    const yTicks = 6;
    let gridLines = '';
    let yLabels = '';
    for (let i = 0; i <= yTicks; i++) {
      const v = (yMax * i / yTicks);
      const yy = y(v);
      gridLines += `<line x1="${padL}" y1="${yy.toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${yy.toFixed(2)}"
                          stroke="var(--pvsim-border)" stroke-width="1" ${i === 0 ? '' : 'stroke-dasharray="2,3"'}/>`;
      yLabels += `<text x="${padL - 8}" y="${(yy + 3.5).toFixed(2)}" text-anchor="end"
                        font-family="'IBM Plex Mono', monospace" font-size="10" fill="var(--pvsim-text-2)"
                        font-variant-numeric="tabular-nums">${Math.round(v)}</text>`;
    }

    let xLabels = '';
    let xGrid = '';
    for (let h = 0; h <= 24; h += 3) {
      const xx = x(h);
      xGrid += `<line x1="${xx.toFixed(2)}" y1="${padT}" x2="${xx.toFixed(2)}" y2="${(padT + ch).toFixed(2)}"
                      stroke="var(--pvsim-border)" stroke-width="1" stroke-dasharray="1,4"/>`;
      const hh = String(h % 24).padStart(2, '0');
      xLabels += `<text x="${xx.toFixed(2)}" y="${(padT + ch + 18).toFixed(2)}" text-anchor="middle"
                        font-family="'IBM Plex Mono', monospace" font-size="10" fill="var(--pvsim-text-2)"
                        font-variant-numeric="tabular-nums">${hh}:00</text>`;
    }

    const px = x(12);
    const py = y(sim.peak);
    const peakMarker = sim.peak > 0.05 ? `
      <line x1="${px.toFixed(2)}" y1="${(padT).toFixed(2)}" x2="${px.toFixed(2)}" y2="${py.toFixed(2)}"
            stroke="#2dd4bf" stroke-width="1" stroke-dasharray="2,3" opacity="0.5"/>
      <circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="4" fill="var(--pvsim-bg-0)" stroke="#ff7a1a" stroke-width="2"/>
      <text x="${(px + 8).toFixed(2)}" y="${(py - 6).toFixed(2)}"
            font-family="'IBM Plex Mono', monospace" font-size="10" font-weight="600" fill="#ff7a1a"
            font-variant-numeric="tabular-nums">P_max ${P.fmt.pl2(sim.peak)} kW</text>
    ` : '';

    const axes = `
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${(padT + ch).toFixed(2)}" stroke="var(--pvsim-border-strong)" stroke-width="1"/>
      <line x1="${padL}" y1="${(padT + ch).toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${(padT + ch).toFixed(2)}" stroke="var(--pvsim-border-strong)" stroke-width="1"/>
    `;

    svg.innerHTML = `
      <defs>
        <linearGradient id="pvsim-area-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ff7a1a" stop-opacity="0.45"/>
          <stop offset="60%" stop-color="#ff7a1a" stop-opacity="0.10"/>
          <stop offset="100%" stop-color="#ff7a1a" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${gridLines}
      ${xGrid}
      ${axes}
      <path d="${areaPath}" fill="url(#pvsim-area-grad)"/>
      <path d="${linePath}" fill="none" stroke="#ff7a1a" stroke-width="2" stroke-linejoin="round"/>
      ${peakMarker}
      ${yLabels}
      ${xLabels}
      <text x="${padL - 30}" y="${padT - 10}" font-family="'IBM Plex Mono', monospace" font-size="9.5"
            fill="var(--pvsim-text-2)" letter-spacing="1.4">[kW]</text>
    `;
  };

  // ===== RENDER STATÓW =====
  P.renderStats = function(sim) {
    document.getElementById('pvsim-daily').textContent   = P.fmt.pl2(sim.daily);
    document.getElementById('pvsim-monthly').textContent = P.fmt.pl0(sim.monthly);
    document.getElementById('pvsim-peak').textContent    = P.fmt.pl2(sim.peak);
    const modeLabel = sim.mode === 'clear' ? 'pełne usłonecznienie' : 'doba przeciętna';
    document.getElementById('pvsim-chart-ctx').textContent = '— ' + sim.monthData.name + ' · ' + modeLabel;
  };

  // ===== RENDER WYKRESU MIESIĘCZNEGO PV (Moduł 01) =====
  // Słupki dobowe: jeden słupek na dobę, wysokość = produkcja PV [kWh] danego dnia.
  // Dni różnią się wg P.dailyWeatherFactors() — średnia miesięczna jest zachowana.
  P.renderPVMonthChart = function(monthIdx, avgDaily) {
    const svg = document.getElementById('pvsim-pv-month-chart');
    if (!svg) return;
    const W = 780, H = 300;
    const padL = 50, padR = 18, padT = 22, padB = 36;
    const cw = W - padL - padR;
    const ch = H - padT - padB;

    const md   = P.MONTHS[monthIdx];
    const days = md.days;
    const factors = P.dailyWeatherFactors(monthIdx, days);
    const perDay  = factors.map(g => avgDaily * g);

    const rawMax = Math.max(...perDay, 0.001);
    const niceSteps = [1, 2, 2.5, 5, 10, 20, 50, 100, 200, 500];
    const step = niceSteps.find(s => rawMax / s <= 6) || 1000;
    const yMax = Math.ceil(rawMax / step + 0.001) * step;

    const slot = cw / days;
    const x = d => padL + d * slot;
    const y = v => padT + ch - (v / yMax) * ch;
    const bw = slot * 0.7;
    const bx = slot * 0.15;

    let bars = '';
    perDay.forEach((v, d) => {
      const h = (v / yMax) * ch;
      if (h > 0.05) {
        bars += `<rect x="${(x(d) + bx).toFixed(2)}" y="${y(v).toFixed(2)}"
                       width="${bw.toFixed(2)}" height="${h.toFixed(2)}"
                       fill="#ff7a1a" opacity="0.8"/>`;
      }
    });

    // linia średniej dobowej
    const avgY = y(avgDaily);
    const avgLine = `<line x1="${padL}" y1="${avgY.toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${avgY.toFixed(2)}"
                           stroke="#2dd4bf" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.8"/>
      <text x="${(W - padR - 4).toFixed(2)}" y="${(avgY - 5).toFixed(2)}" text-anchor="end"
            font-family="'IBM Plex Mono', monospace" font-size="10" font-weight="600" fill="#2dd4bf"
            font-variant-numeric="tabular-nums">śr. ${P.fmt.pl2(avgDaily)} kWh</text>`;

    const ticks = Math.round(yMax / step);
    let gridLines = '', yLabels = '';
    for (let i = 0; i <= ticks; i++) {
      const v = i * step;
      const yy = y(v);
      gridLines += `<line x1="${padL}" y1="${yy.toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${yy.toFixed(2)}"
                          stroke="var(--pvsim-border)" stroke-width="1" ${i === 0 ? '' : 'stroke-dasharray="2,3"'}/>`;
      yLabels += `<text x="${padL - 8}" y="${(yy + 3.5).toFixed(2)}" text-anchor="end"
                        font-family="'IBM Plex Mono', monospace" font-size="10" fill="var(--pvsim-text-2)"
                        font-variant-numeric="tabular-nums">${P.fmt.pl0(v)}</text>`;
    }

    const labelEvery = days > 16 ? 2 : 1;
    let xLabels = '';
    for (let d = 0; d < days; d++) {
      if (d % labelEvery === 0) {
        xLabels += `<text x="${(x(d) + slot / 2).toFixed(2)}" y="${(padT + ch + 18).toFixed(2)}" text-anchor="middle"
                          font-family="'IBM Plex Mono', monospace" font-size="10" fill="var(--pvsim-text-2)"
                          font-variant-numeric="tabular-nums">${d + 1}</text>`;
      }
    }

    const axes = `
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${(padT + ch).toFixed(2)}" stroke="var(--pvsim-border-strong)" stroke-width="1"/>
      <line x1="${padL}" y1="${(padT + ch).toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${(padT + ch).toFixed(2)}" stroke="var(--pvsim-border-strong)" stroke-width="1"/>
    `;

    svg.innerHTML = `
      ${gridLines}${axes}${bars}${avgLine}${yLabels}${xLabels}
      <text x="${padL - 30}" y="${padT - 10}" font-family="'IBM Plex Mono', monospace" font-size="9.5"
            fill="var(--pvsim-text-2)" letter-spacing="1.4">[kWh]</text>
      <text x="${(padL + cw / 2).toFixed(2)}" y="${(H - 4).toFixed(2)}" text-anchor="middle"
            font-family="'IBM Plex Mono', monospace" font-size="9" fill="var(--pvsim-text-2)" letter-spacing="1">doba</text>
    `;

    const ctxEl = document.getElementById('pvsim-pv-month-ctx');
    if (ctxEl) {
      const monthly = perDay.reduce((s, v) => s + v, 0);
      ctxEl.textContent = `— ${md.name} · suma ${P.fmt.pl0(monthly)} kWh`;
    }
  };

})(window.PVSIM);
