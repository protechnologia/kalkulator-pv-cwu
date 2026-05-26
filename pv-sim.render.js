/* =========================================================
   PV.SIM — Renderowanie wykresów i statystyk

   Odpowiada za całą warstwę prezentacji — nie wykonuje obliczeń,
   tylko przetwarza wyniki symulacji na elementy DOM i SVG.

   P.fmt — formatery liczb w polskiej lokalizacji (pl-PL),
     eksportowane na namespace, bo używa ich też app.js

   Prywatna smoothPath() — interpolacja krzywą Catmull-Rom,
     wygładza wykresy SVG między próbkami godzinowymi.

   Moduł 01 — PV:
     renderChart()        — wykres mocy chwilowej (kW), kolor pomarańczowy
     renderPVMonthChart() — wykres słupkowy produkcji dobowej PV przez cały
                            miesiąc (jeden słupek na dobę, linia średniej)
     renderStats()        — karty: produkcja dobowa, miesięczna, moc szczytowa

   Moduł 02 — CWU:
     renderDHWChart() — wykres zużycia wody (m³/h) i mocy grzewczej (kW),
                        dwie osie Y, kolor turkusowy
     renderDHWStats() — karty: dobowe/miesięczne zużycie wody, energii i koszt

   Moduł 03 — Sieć: wydzielone do pv-sim.render.m03.js
     renderGridChart()

   Moduł 04 — Zasobnik (PC + grzałka): wydzielone do pv-sim.render.m04.js
     renderTankChart(), renderTankElecChart(),
     renderHeatSplitChart(), renderTankStats()

   Moduł 05 — Symulacja miesięczna:
     renderMonthTankChart() — wykres temperatury zasobnika przez cały
                              miesiąc (ciągła linia), kolor błękitny
     renderMonthElecChart() — wykres słupkowy dobowego bilansu energii pary
                              PC + grzałka (jeden słupek na dobę, PV vs sieć)
     renderMonthStats()     — karty miesięczne: pokrycie CWU, grzałka, PC,
                              zużycie prądu — źródło i — urządzenie, koszt,
                              ciepło zaoszczędzone, bilans; część wartości
                              dublowana w sidebarze

   Moduł 06 — Symulacja roczna:
     renderYearChart()      — wykres słupkowy energii elektrycznej pary
                              PC + grzałka (jeden słupek na miesiąc,
                              PV vs sieć)
     renderYearCoverChart() — wykres słupkowy miesięcznego pokrycia CWU
                              (pokryte vs brak, etykieta % nad słupkiem)
     renderYearStats()      — karty roczne: pokrycie CWU, grzałka, PC,
                              zużycie prądu — źródło i — urządzenie, koszt,
                              ciepło zaoszczędzone, bilans

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

    const linePath = smoothPath(pts);
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

  // ===== RENDER WYKRESU CWU =====
  // Jedna krzywa zużycia wody, dwie osie Y (m³/h i kW) niezależnie wyskalowane.
  // Zasada: lewa oś zawsze 0..1.0 m³/h, prawa oś zawsze 0..60 kW.
  // Relacja kW = m³/h × cw × ΔT zmienia się z miesiącem i T_hot, więc osie NIE są
  // sztywno proporcjonalne — to świadoma decyzja, by skala była przewidywalna.
  P.renderDHWChart = function(simDHW) {
    const svg = document.getElementById('pvsim-dhw-chart');
    const W = 780, H = 300;
    const padL = 50, padR = 50, padT = 22, padB = 36;
    const cw = W - padL - padR;
    const ch = H - padT - padB;

    const xMax = 24;

    // Prawa oś (kW) — dobieramy ładny krok, lewa (m³/h) wynika z proporcji
    const kwhM3 = simDHW.kwhM3;
    const rawMaxR = P.Y_MAX_M3H * kwhM3;
    const niceStepsR = [1, 2, 5, 10, 20, 50, 100];
    const stepR = niceStepsR.find(s => rawMaxR / s <= 6) || 10;
    const yMaxR = Math.ceil(rawMaxR / stepR + 1) * stepR;
    const yMaxL = yMaxR / kwhM3;
    const ticksR = Math.round(yMaxR / stepR);

    const x = h => padL + (h / xMax) * cw;
    const y = v => padT + ch - (v / yMaxL) * ch;

    const pts = simDHW.hours.map(d => ({ x: x(d.hour + 0.5), y: y(d.water) }));
    pts.unshift({ x: x(0),  y: y(0) });
    pts.push   ({ x: x(24), y: y(0) });

    const linePath = smoothPath(pts);
    const areaPath = linePath + ` L ${x(24).toFixed(2)} ${y(0).toFixed(2)} L ${x(0).toFixed(2)} ${y(0).toFixed(2)} Z`;

    let gridLines = '';
    let yLabelsL = '';
    let yLabelsR = '';
    for (let i = 0; i <= ticksR; i++) {
      const vR = i * stepR;
      const vL = vR / kwhM3;
      const yy = y(vL);
      gridLines += `<line x1="${padL}" y1="${yy.toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${yy.toFixed(2)}"
                          stroke="var(--pvsim-border)" stroke-width="1" ${i === 0 ? '' : 'stroke-dasharray="2,3"'}/>`;
      yLabelsL += `<text x="${padL - 8}" y="${(yy + 3.5).toFixed(2)}" text-anchor="end"
                         font-family="'IBM Plex Mono', monospace" font-size="10" fill="var(--pvsim-text-2)"
                         font-variant-numeric="tabular-nums">${P.fmt.pl2(vL)}</text>`;
      yLabelsR += `<text x="${(W - padR + 8).toFixed(2)}" y="${(yy + 3.5).toFixed(2)}" text-anchor="start"
                         font-family="'IBM Plex Mono', monospace" font-size="10" fill="var(--pvsim-text-2)"
                         font-variant-numeric="tabular-nums">${Math.round(vR)}</text>`;
    }

    let xLabels = '', xGrid = '';
    for (let h = 0; h <= 24; h += 3) {
      const xx = x(h);
      xGrid += `<line x1="${xx.toFixed(2)}" y1="${padT}" x2="${xx.toFixed(2)}" y2="${(padT + ch).toFixed(2)}"
                      stroke="var(--pvsim-border)" stroke-width="1" stroke-dasharray="1,4"/>`;
      const hh = String(h % 24).padStart(2, '0');
      xLabels += `<text x="${xx.toFixed(2)}" y="${(padT + ch + 18).toFixed(2)}" text-anchor="middle"
                        font-family="'IBM Plex Mono', monospace" font-size="10" fill="var(--pvsim-text-2)"
                        font-variant-numeric="tabular-nums">${hh}:00</text>`;
    }

    let peakIdx = 0;
    for (let i = 1; i < simDHW.hours.length; i++) {
      if (simDHW.hours[i].water > simDHW.hours[peakIdx].water) peakIdx = i;
    }
    const peakHour = simDHW.hours[peakIdx];
    const ppx = x(peakHour.hour + 0.5);
    const ppy = y(peakHour.water);
    const peakMarker = peakHour.water > 0.005 ? `
      <line x1="${ppx.toFixed(2)}" y1="${(padT).toFixed(2)}" x2="${ppx.toFixed(2)}" y2="${ppy.toFixed(2)}"
            stroke="#ff7a1a" stroke-width="1" stroke-dasharray="2,3" opacity="0.4"/>
      <circle cx="${ppx.toFixed(2)}" cy="${ppy.toFixed(2)}" r="4" fill="var(--pvsim-bg-0)" stroke="#2dd4bf" stroke-width="2"/>
      <text x="${(ppx + 8).toFixed(2)}" y="${(ppy - 6).toFixed(2)}"
            font-family="'IBM Plex Mono', monospace" font-size="10" font-weight="600" fill="#2dd4bf"
            font-variant-numeric="tabular-nums">peak ${P.fmt.pl2(peakHour.power)} kW · ${P.fmt.pl2(peakHour.water)} m³/h</text>
    ` : '';

    const axes = `
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${(padT + ch).toFixed(2)}" stroke="var(--pvsim-border-strong)" stroke-width="1"/>
      <line x1="${(W - padR).toFixed(2)}" y1="${padT}" x2="${(W - padR).toFixed(2)}" y2="${(padT + ch).toFixed(2)}" stroke="var(--pvsim-border-strong)" stroke-width="1"/>
      <line x1="${padL}" y1="${(padT + ch).toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${(padT + ch).toFixed(2)}" stroke="var(--pvsim-border-strong)" stroke-width="1"/>
    `;

    // Linia strat cyrkulacji — stała moc P_circ na osi prawej (kW)
    const P_circ = simDHW.circulation.powerKW;
    const vL_circ = P_circ / simDHW.kwhM3;    // przeliczenie kW → m³/h (lewa oś)
    const y_circ = y(Math.min(vL_circ, yMaxL));
    const circLine = P_circ > 0.001 ? `
      <line x1="${padL}" y1="${y_circ.toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${y_circ.toFixed(2)}"
            stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.7"/>
      <text x="${(padL + 6).toFixed(2)}" y="${(y_circ - 5).toFixed(2)}"
            font-family="'IBM Plex Mono', monospace" font-size="9.5" fill="#f59e0b" opacity="0.85"
            font-variant-numeric="tabular-nums">P_cyrk. ${P.fmt.pl2(P_circ)} kW</text>
    ` : '';

    svg.innerHTML = `
      <defs>
        <linearGradient id="pvsim-dhw-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stop-color="#2dd4bf" stop-opacity="0.40"/>
          <stop offset="60%" stop-color="#2dd4bf" stop-opacity="0.10"/>
          <stop offset="100%" stop-color="#2dd4bf" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${gridLines}
      ${xGrid}
      ${axes}
      <path d="${areaPath}" fill="url(#pvsim-dhw-grad)"/>
      <path d="${linePath}" fill="none" stroke="#2dd4bf" stroke-width="2" stroke-linejoin="round"/>
      ${circLine}
      ${peakMarker}
      ${yLabelsL}
      ${yLabelsR}
      ${xLabels}
      <text x="${padL - 30}" y="${padT - 10}" font-family="'IBM Plex Mono', monospace" font-size="9.5"
            fill="var(--pvsim-text-2)" letter-spacing="1.4">[m³/h]</text>
      <text x="${(W - padR + 4).toFixed(2)}" y="${padT - 10}" font-family="'IBM Plex Mono', monospace" font-size="9.5"
            fill="var(--pvsim-text-2)" letter-spacing="1.4">[kW]</text>
    `;
  };

  // ===== RENDER STATÓW CWU =====
  P.renderDHWStats = function(simDHW) {
    const circ = simDHW.circulation;
    const circPctTot = simDHW.daily.totalEnergy > 0
      ? Math.round(circ.energy / simDHW.daily.totalEnergy * 100)
      : 0;

    document.getElementById('pvsim-dhw-water-d').textContent      = P.fmt.pl2(simDHW.daily.water);
    document.getElementById('pvsim-dhw-water-m').textContent      = P.fmt.pl0(simDHW.monthly.water);
    document.getElementById('pvsim-dhw-energy-d').textContent     = P.fmt.pl0(simDHW.daily.totalEnergy);
    document.getElementById('pvsim-dhw-energy-m').textContent     = P.fmt.pl0(simDHW.monthly.totalEnergy);
    let yearlyEnergy = 0, yearlyCost = 0, yearlyWater = 0;
    for (let mi = 0; mi < 12; mi++) {
      const s = P.simulateDHW(P.state.residents, mi, P.state.T_hot);
      yearlyEnergy += s.monthly.totalEnergy;
      yearlyCost   += s.monthly.totalCost;
      yearlyWater  += s.monthly.water;
    }
    document.getElementById('pvsim-dhw-water-y').textContent      = P.fmt.pl0(yearlyWater);
    document.getElementById('pvsim-dhw-energy-y').textContent     = P.fmt.pl0(yearlyEnergy);
    document.getElementById('pvsim-dhw-circ-d').textContent       = P.fmt.pl0(circ.energy);
    document.getElementById('pvsim-dhw-circ-pct-tot').textContent = circPctTot;
    document.getElementById('pvsim-dhw-cost-d').textContent   = P.fmt.pl2(simDHW.daily.totalCost);
    document.getElementById('pvsim-dhw-cost-m').textContent   = P.fmt.pl0(simDHW.monthly.totalCost);
    document.getElementById('pvsim-dhw-cost-y').textContent   = P.fmt.pl0(yearlyCost);

    const circLabel = `cyrk. ${Math.round(P.state.circLossPct * 100)}%`;
    const ctx = `— ${P.state.residents} osób · ${P.MONTHS[P.state.monthIdx].name} · ΔT ${simDHW.T_in.toFixed(1)}→${simDHW.T_hot}°C · ${circLabel}`;
    document.getElementById('pvsim-dhw-ctx').textContent = ctx;
  };

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

    const linePath = smoothPath(pts);
    const areaPath = linePath
      + ` L ${x(xMax).toFixed(2)} ${y(T_in).toFixed(2)} L ${x(0).toFixed(2)} ${y(T_in).toFixed(2)} Z`;

    const yTicks = 7;
    let gridLines = '', yLabels = '';
    for (let i = 0; i <= yTicks; i++) {
      const v = yMax * i / yTicks;
      const yy = y(v);
      gridLines += `<line x1="${padL}" y1="${yy.toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${yy.toFixed(2)}"
                          stroke="var(--pvsim-border)" stroke-width="1" ${i === 0 ? '' : 'stroke-dasharray="2,3"'}/>`;
      yLabels += `<text x="${padL - 8}" y="${(yy + 3.5).toFixed(2)}" text-anchor="end"
                        font-family="'IBM Plex Mono', monospace" font-size="10" fill="var(--pvsim-text-2)"
                        font-variant-numeric="tabular-nums">${Math.round(v)}</text>`;
    }

    const T_hot = P.state.T_hot;
    const refLines = `
      <line x1="${padL}" y1="${y(T_hot).toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${y(T_hot).toFixed(2)}"
            stroke="#2dd4bf" stroke-width="1" stroke-dasharray="6,4" opacity="0.5"/>
      <text x="${(W - padR - 4).toFixed(2)}" y="${(y(T_hot) - 4).toFixed(2)}" text-anchor="end"
            font-family="'IBM Plex Mono', monospace" font-size="9.5" fill="#2dd4bf" opacity="0.8">T_kran ${T_hot}°</text>

      <line x1="${padL}" y1="${y(P.TANK_T_MAX).toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${y(P.TANK_T_MAX).toFixed(2)}"
            stroke="#ef4444" stroke-width="1" stroke-dasharray="6,4" opacity="0.4"/>
      <text x="${(W - padR - 4).toFixed(2)}" y="${(y(P.TANK_T_MAX) - 4).toFixed(2)}" text-anchor="end"
            font-family="'IBM Plex Mono', monospace" font-size="9.5" fill="#ef4444" opacity="0.7">T_max 60°</text>

      <line x1="${padL}" y1="${y(T_in).toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${y(T_in).toFixed(2)}"
            stroke="var(--pvsim-text-2)" stroke-width="1" stroke-dasharray="3,3" opacity="0.5"/>
      <text x="${(W - padR - 4).toFixed(2)}" y="${(y(T_in) - 4).toFixed(2)}" text-anchor="end"
            font-family="'IBM Plex Mono', monospace" font-size="9.5" fill="#a1a1aa" opacity="0.7">T_wodociąg ${T_in.toFixed(1)}°</text>
    `;

    // Siatka pionowa — jedna linia na dobę; etykieta numeru doby co kilka dób.
    const labelEvery = days > 16 ? 2 : 1;
    let xLabels = '', xGrid = '';
    for (let d = 0; d <= days; d++) {
      const xx = x(d * 24);
      xGrid += `<line x1="${xx.toFixed(2)}" y1="${padT}" x2="${xx.toFixed(2)}" y2="${(padT + ch).toFixed(2)}"
                      stroke="var(--pvsim-border)" stroke-width="1" stroke-dasharray="1,4"/>`;
      if (d < days && d % labelEvery === 0) {
        xLabels += `<text x="${(xx + (cw / days) / 2).toFixed(2)}" y="${(padT + ch + 18).toFixed(2)}" text-anchor="middle"
                          font-family="'IBM Plex Mono', monospace" font-size="10" fill="var(--pvsim-text-2)"
                          font-variant-numeric="tabular-nums">${d + 1}</text>`;
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
      <text x="${padL - 30}" y="${padT - 10}" font-family="'IBM Plex Mono', monospace" font-size="9.5"
            fill="var(--pvsim-text-2)" letter-spacing="1.4">[°C]</text>
      <text x="${(padL + cw / 2).toFixed(2)}" y="${(H - 4).toFixed(2)}" text-anchor="middle"
            font-family="'IBM Plex Mono', monospace" font-size="9" fill="var(--pvsim-text-2)" letter-spacing="1">doba</text>
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

    const lx = W - padR - 150;
    const legend = `
      <rect x="${lx}" y="${padT + 2}" width="10" height="10" fill="#f59e0b" opacity="0.8"/>
      <text x="${lx + 15}" y="${padT + 11}" font-family="'IBM Plex Mono', monospace" font-size="10"
            fill="#a1a1aa">z PV</text>
      <rect x="${lx + 60}" y="${padT + 2}" width="10" height="10" fill="#a78bfa" opacity="0.75"/>
      <text x="${lx + 75}" y="${padT + 11}" font-family="'IBM Plex Mono', monospace" font-size="10"
            fill="#a1a1aa">z sieci</text>
    `;

    svg.innerHTML = `
      ${gridLines}${axes}${bars}${legend}${yLabels}${xLabels}
      <text x="${padL - 30}" y="${padT - 10}" font-family="'IBM Plex Mono', monospace" font-size="9.5"
            fill="var(--pvsim-text-2)" letter-spacing="1.4">[kWh]</text>
      <text x="${(padL + cw / 2).toFixed(2)}" y="${(H - 4).toFixed(2)}" text-anchor="middle"
            font-family="'IBM Plex Mono', monospace" font-size="9" fill="var(--pvsim-text-2)" letter-spacing="1">doba</text>
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

  // ===== RENDER WYKRESU ENERGII ELEKTRYCZNEJ — SYMULACJA ROCZNA (Moduł 06) =====
  // Słupki miesięczne: jeden słupek na miesiąc, dół = energia z PV,
  // góra = energia z sieci. 12 słupków, oś X — skróty miesięcy.
  P.renderYearChart = function(simYear) {
    const svg = document.getElementById('pvsim-year-chart');
    if (!svg) return;
    const W = 780, H = 300;
    const padL = 50, padR = 18, padT = 22, padB = 36;
    const cw = W - padL - padR;
    const ch = H - padT - padB;

    const md = simYear.monthsData;

    const pvOf   = d => d.elec_pair_pv   != null ? d.elec_pair_pv   : d.elec_pv;
    const gridOf = d => d.elec_pair_grid != null ? d.elec_pair_grid : d.elec_grid;
    const rawMax = Math.max(...md.map(d => pvOf(d) + gridOf(d)), 0.001);
    const niceSteps = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
    const step = niceSteps.find(s => rawMax / s <= 6) || 5000;
    const yMax = Math.ceil(rawMax / step + 0.001) * step;

    const slot = cw / 12;
    const x = i => padL + i * slot;
    const y = v => padT + ch - (v / yMax) * ch;
    const bw = slot * 0.62;
    const bx = slot * 0.19;   // wcięcie słupka w slocie miesiąca

    let bars = '';
    md.forEach((d, i) => {
      const ePv   = pvOf(d);
      const eGrid = gridOf(d);
      const pvH   = (ePv   / yMax) * ch;
      const gridH = (eGrid / yMax) * ch;
      const x0 = x(i) + bx;
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
      yLabels += `<text x="${padL - 8}" y="${(yy + 3.5).toFixed(2)}" text-anchor="end"
                        font-family="'IBM Plex Mono', monospace" font-size="10" fill="var(--pvsim-text-2)"
                        font-variant-numeric="tabular-nums">${P.fmt.pl0(v)}</text>`;
    }

    let xLabels = '';
    md.forEach((d, i) => {
      xLabels += `<text x="${(x(i) + slot / 2).toFixed(2)}" y="${(padT + ch + 18).toFixed(2)}" text-anchor="middle"
                        font-family="'IBM Plex Mono', monospace" font-size="9" fill="var(--pvsim-text-2)"
                        letter-spacing="0.5">${d.abbr}</text>`;
    });

    const axes = `
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${(padT + ch).toFixed(2)}" stroke="var(--pvsim-border-strong)" stroke-width="1"/>
      <line x1="${padL}" y1="${(padT + ch).toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${(padT + ch).toFixed(2)}" stroke="var(--pvsim-border-strong)" stroke-width="1"/>
    `;

    const lx = W - padR - 150;
    const legend = `
      <rect x="${lx}" y="${padT + 2}" width="10" height="10" fill="#f59e0b" opacity="0.8"/>
      <text x="${lx + 15}" y="${padT + 11}" font-family="'IBM Plex Mono', monospace" font-size="10"
            fill="#a1a1aa">z PV</text>
      <rect x="${lx + 60}" y="${padT + 2}" width="10" height="10" fill="#a78bfa" opacity="0.75"/>
      <text x="${lx + 75}" y="${padT + 11}" font-family="'IBM Plex Mono', monospace" font-size="10"
            fill="#a1a1aa">z sieci</text>
    `;

    svg.innerHTML = `
      ${gridLines}${axes}${bars}${legend}${yLabels}${xLabels}
      <text x="${padL - 30}" y="${padT - 10}" font-family="'IBM Plex Mono', monospace" font-size="9.5"
            fill="var(--pvsim-text-2)" letter-spacing="1.4">[kWh]</text>
      <text x="${(padL + cw / 2).toFixed(2)}" y="${(H - 4).toFixed(2)}" text-anchor="middle"
            font-family="'IBM Plex Mono', monospace" font-size="9" fill="var(--pvsim-text-2)" letter-spacing="1">miesiąc</text>
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
      pctLabels += `<text x="${cx}" y="${(topY - 5).toFixed(2)}" text-anchor="middle"
                          font-family="'IBM Plex Mono', monospace" font-size="9.5" font-weight="600"
                          fill="#a3e635" font-variant-numeric="tabular-nums">${pct.toFixed(0)}%</text>`;
      // mniejsza etykieta nad nią — zakres pokrycia dobowego (min–max)
      if (d.coverMaxPct != null && d.coverMaxPct >= 0) {
        const lo = Math.round(d.coverMinPct);
        const hi = Math.round(d.coverMaxPct);
        pctLabels += `<text x="${cx}" y="${(topY - 17).toFixed(2)}" text-anchor="middle"
                            font-family="'IBM Plex Mono', monospace" font-size="8" fill="var(--pvsim-text-2)"
                            font-variant-numeric="tabular-nums" opacity="0.85">${lo}%–${hi}%</text>`;
      }
    });

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

    let xLabels = '';
    md.forEach((d, i) => {
      xLabels += `<text x="${(x(i) + slot / 2).toFixed(2)}" y="${(padT + ch + 18).toFixed(2)}" text-anchor="middle"
                        font-family="'IBM Plex Mono', monospace" font-size="9" fill="var(--pvsim-text-2)"
                        letter-spacing="0.5">${d.abbr}</text>`;
    });

    const axes = `
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${(padT + ch).toFixed(2)}" stroke="var(--pvsim-border-strong)" stroke-width="1"/>
      <line x1="${padL}" y1="${(padT + ch).toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${(padT + ch).toFixed(2)}" stroke="var(--pvsim-border-strong)" stroke-width="1"/>
    `;

    const lx = W - padR - 150;
    const legend = `
      <rect x="${lx}" y="${padT + 2}" width="10" height="10" fill="#a3e635" opacity="0.85"/>
      <text x="${lx + 15}" y="${padT + 11}" font-family="'IBM Plex Mono', monospace" font-size="10"
            fill="#a1a1aa">pokryte</text>
      <rect x="${lx + 70}" y="${padT + 2}" width="10" height="10" fill="#71717a" opacity="0.45"/>
      <text x="${lx + 85}" y="${padT + 11}" font-family="'IBM Plex Mono', monospace" font-size="10"
            fill="#a1a1aa">brak</text>
    `;

    svg.innerHTML = `
      ${gridLines}${axes}${bars}${pctLabels}${legend}${yLabels}${xLabels}
      <text x="${padL - 30}" y="${padT - 10}" font-family="'IBM Plex Mono', monospace" font-size="9.5"
            fill="var(--pvsim-text-2)" letter-spacing="1.4">[kWh]</text>
      <text x="${(padL + cw / 2).toFixed(2)}" y="${(H - 4).toFixed(2)}" text-anchor="middle"
            font-family="'IBM Plex Mono', monospace" font-size="9" fill="var(--pvsim-text-2)" letter-spacing="1">miesiąc</text>
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
