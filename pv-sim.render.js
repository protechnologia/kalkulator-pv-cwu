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

   Moduł 03 — Sieć:
     renderGridChart() — wykres krokowy ceny energii elektrycznej (zł/kWh) przez dobę,
                         strefa dzienna (fiolet) vs nocna (szary), kolor fioletowy;
                         oś Y z ładnymi krokami (nie wywołuje P.update — brak symulacji)

   Moduł 04 — Zasobnik (PC + grzałka):
     renderTankChart()      — wykres temperatury zasobnika (°C) z tłem grzania
                              (osobny odcień dla strefy dziennej i nocnej),
                              linia termostatu i linia T_CWU, kolor bursztynowy
     renderTankElecChart()  — wykres słupkowy mocy elektrycznej pary
                              PC + grzałki: 4-stos (PC·PV, grz·PV, PC·sieć,
                              grz·sieć)
     renderHeatSplitChart() — wykres słupkowy podziału mocy cieplnej
                              (PC vs grzałka, kWh ciepła dostarczonego do
                              zasobnika)
     renderTankStats()      — karty: pokrycie CWU, grzałka (h + kWh ciepła),
                              PC (h + kWh ciepła), zużycie prądu — źródło
                              (PV vs sieć) i — urządzenie (grzałka vs PC),
                              koszt energii z sieci

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

   Moduł 07 — Inwestycja:
     renderInvestStats()    — karty: koszt inwestycji (PV, grzałki, PC,
                              zasobnik, SCADA) i liczba lat na zwrot

   Moduł 08 — Optymalizacja:
     renderOptimTable()     — tabela top 10 wariantów grid searcha
                              (z grupowaniem wierszy o identycznym wyniku
                              ekonomicznym — kolumna # pokazuje zakres
                              `1–3`, różniące się parametry listowane jako
                              `v1 / v2 / v3`). Każdy wiersz z przyciskiem
                              „Przenieś →". Przy braku wyników wyświetla
                              pustą tabelę z napisem „brak wyników"
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

  // ===== RENDER WYKRESU ZASOBNIKA =====
  // Temperatura T(t) + zacieniowanie godzin pracy grzałki w tle.
  P.renderTankChart = function(simTank) {
    const svg = document.getElementById('pvsim-tank-chart');
    const W = 780, H = 350;
    const padL = 50, padR = 18, padT = 22, padB = 86;
    const cw = W - padL - padR;
    const ch = H - padT - padB;

    const yMax = P.Y_MAX_TEMP;
    const xMax = 24;

    const x = h => padL + (h / xMax) * cw;
    const y = v => padT + ch - (v / yMax) * ch;

    const T_in = simTank.T_in;
    const pts = [{ x: x(0), y: y(T_in) }];
    simTank.hours.forEach(d => pts.push({ x: x(d.hour + 1), y: y(d.T_end) }));

    const linePath = smoothPath(pts);
    const areaPath = linePath + ` L ${x(24).toFixed(2)} ${y(T_in).toFixed(2)} L ${x(0).toFixed(2)} ${y(T_in).toFixed(2)} Z`;

    const yTicks = 7;
    let gridLines = '', yLabels = '';
    for (let i = 0; i <= yTicks; i++) {
      const v = (yMax * i / yTicks);
      const yy = y(v);
      gridLines += `<line x1="${padL}" y1="${yy.toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${yy.toFixed(2)}"
                          stroke="var(--pvsim-border)" stroke-width="1" ${i === 0 ? '' : 'stroke-dasharray="2,3"'}/>`;
      yLabels += `<text x="${padL - 8}" y="${(yy + 3.5).toFixed(2)}" text-anchor="end"
                        font-family="'IBM Plex Mono', monospace" font-size="10" fill="var(--pvsim-text-2)"
                        font-variant-numeric="tabular-nums">${Math.round(v)}</text>`;
    }

    // Linie referencyjne:
    //  T_kran (cel, ustawiana sliderem) — niebieska, najważniejsza dla użytkownika
    //  T_max 60°C (termostat) — czerwona
    //  T_in (woda zimna, sezonowa) — szary cień
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

    // Pasma pracy: dwie wąskie poziome wstęgi pod osią X, rozsunięte odstępem.
    // PC u góry (cyan), GRZAŁKA poniżej (bursztyn). Etykiety przy lewej osi.
    const bandH = 12;
    const bandGap = 8;
    const hpBandTop     = padT + ch + 32;
    const hpBandBot     = hpBandTop + bandH;
    const heaterBandTop = hpBandBot + bandGap;
    const heaterBandBot = heaterBandTop + bandH;

    let heaterBg = '', hpBg = '';
    simTank.hours.forEach(d => {
      const x1 = x(d.hour), x2 = x(d.hour + 1);
      const op = d.day ? '0.28' : '0.14';
      if (d.hpOn) {
        hpBg += `<rect x="${x1.toFixed(2)}" y="${hpBandTop}" width="${(x2 - x1).toFixed(2)}" height="${bandH.toFixed(2)}"
                       fill="#22d3ee" opacity="${op}"/>`;
      }
      if (d.heaterOn) {
        heaterBg += `<rect x="${x1.toFixed(2)}" y="${heaterBandTop.toFixed(2)}" width="${(x2 - x1).toFixed(2)}" height="${bandH.toFixed(2)}"
                           fill="#f59e0b" opacity="${op}"/>`;
      }
    });

    const hpBorder = `
      <line x1="${padL}" y1="${hpBandTop}" x2="${(W - padR).toFixed(2)}" y2="${hpBandTop}"
            stroke="#22d3ee" stroke-width="1" opacity="0.5"/>
      <line x1="${padL}" y1="${hpBandBot.toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${hpBandBot.toFixed(2)}"
            stroke="#22d3ee" stroke-width="1" opacity="0.5"/>
    `;
    const heaterBorder = `
      <line x1="${padL}" y1="${heaterBandTop.toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${heaterBandTop.toFixed(2)}"
            stroke="#f59e0b" stroke-width="1" opacity="0.5"/>
      <line x1="${padL}" y1="${heaterBandBot.toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${heaterBandBot.toFixed(2)}"
            stroke="#f59e0b" stroke-width="1" opacity="0.5"/>
    `;

    const hpLabel = `<text x="${padL - 6}" y="${(hpBandTop + bandH / 2 + 3.5).toFixed(2)}" text-anchor="end"
                           font-family="'IBM Plex Mono', monospace" font-size="9" font-weight="600"
                           fill="#22d3ee" opacity="0.85" letter-spacing="1">PC</text>`;
    const heaterLabel = `<text x="${padL - 6}" y="${(heaterBandTop + bandH / 2 + 3.5).toFixed(2)}" text-anchor="end"
                               font-family="'IBM Plex Mono', monospace" font-size="9" font-weight="600"
                               fill="#f59e0b" opacity="0.85" letter-spacing="1">GRZ.</text>`;

    const axes = `
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${(padT + ch).toFixed(2)}" stroke="var(--pvsim-border-strong)" stroke-width="1"/>
      <line x1="${padL}" y1="${(padT + ch).toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${(padT + ch).toFixed(2)}" stroke="var(--pvsim-border-strong)" stroke-width="1"/>
    `;

    svg.innerHTML = `
      <defs>
        <linearGradient id="pvsim-tank-grad" gradientUnits="userSpaceOnUse"
          x1="0" y1="${padT}" x2="0" y2="${(padT + ch / 2).toFixed(2)}">
          <stop offset="0%"  stop-color="#f59e0b" stop-opacity="0.45"/>
          <stop offset="70%" stop-color="#f59e0b" stop-opacity="0.10"/>
          <stop offset="100%" stop-color="#f59e0b" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${hpBg}
      ${heaterBg}
      ${hpBorder}
      ${heaterBorder}
      ${gridLines}
      ${xGrid}
      ${axes}
      ${refLines}
      <path d="${areaPath}" fill="url(#pvsim-tank-grad)"/>
      <path d="${linePath}" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linejoin="round"/>
      ${hpLabel}
      ${heaterLabel}
      ${yLabels}
      ${xLabels}
      <text x="${padL - 30}" y="${padT - 10}" font-family="'IBM Plex Mono', monospace" font-size="9.5"
            fill="var(--pvsim-text-2)" letter-spacing="1.4">[°C]</text>
    `;
  };

  // ===== RENDER WYKRESU MOCY ELEKTRYCZNEJ GRZAŁKI =====
  // Słupki skumulowane: dół = moc z PV (bursztyn), góra = moc z sieci (fiolet).
  // Energia godzinowa [kWh] = średnia moc [kW] w danej godzinie (1 h).
  P.renderTankElecChart = function(simTank) {
    const svg = document.getElementById('pvsim-tank-elec-chart');
    if (!svg) return;
    const W = 780, H = 300;
    const padL = 50, padR = 18, padT = 22, padB = 36;
    const cw = W - padL - padR;
    const ch = H - padT - padB;

    const pairKW = P.state.heaterKW + P.state.hpKW;
    const rawMax = Math.max(
      ...simTank.hours.map(d => (d.elec_pair_pv || 0) + (d.elec_pair_grid || 0)),
      pairKW, 0.001
    );
    const niceSteps = [0.5, 1, 2, 2.5, 5, 10, 20];
    const step = niceSteps.find(s => rawMax / s <= 6) || 20;
    const yMax = Math.ceil(rawMax / step + 0.001) * step;

    const x = h => padL + (h / 24) * cw;
    const y = v => padT + ch - (v / yMax) * ch;
    const bw = cw / 24;

    // Stos dwupoziomowy — dół: energia z PV (bursztyn), góra: z sieci (fiolet).
    // Suma PC + grzałka łączona po stronie źródła (rozbicie urządzeń jest na osobnym wykresie cieplnym).
    let bars = '';
    for (let h = 0; h < 24; h++) {
      const d = simTank.hours[h];
      const ePv   = (d.elec_pv    || 0) + (d.elec_hp_pv   || 0);
      const eGrid = (d.elec_grid  || 0) + (d.elec_hp_grid || 0);
      if (ePv > 0) {
        const segH = (ePv / yMax) * ch;
        if (segH > 0.1) {
          bars += `<rect x="${x(h).toFixed(2)}" y="${y(ePv).toFixed(2)}"
                         width="${(bw - 1).toFixed(2)}" height="${segH.toFixed(2)}"
                         fill="#f59e0b" opacity="0.85"/>`;
        }
      }
      if (eGrid > 0) {
        const segH = (eGrid / yMax) * ch;
        if (segH > 0.1) {
          bars += `<rect x="${x(h).toFixed(2)}" y="${y(ePv + eGrid).toFixed(2)}"
                         width="${(bw - 1).toFixed(2)}" height="${segH.toFixed(2)}"
                         fill="#a78bfa" opacity="0.85"/>`;
        }
      }
    }

    const ticks = Math.round(yMax / step);
    let gridLines = '', yLabels = '';
    for (let i = 0; i <= ticks; i++) {
      const v = i * step;
      const yy = y(v);
      gridLines += `<line x1="${padL}" y1="${yy.toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${yy.toFixed(2)}"
                          stroke="var(--pvsim-border)" stroke-width="1" ${i === 0 ? '' : 'stroke-dasharray="2,3"'}/>`;
      yLabels += `<text x="${padL - 8}" y="${(yy + 3.5).toFixed(2)}" text-anchor="end"
                        font-family="'IBM Plex Mono', monospace" font-size="10" fill="var(--pvsim-text-2)"
                        font-variant-numeric="tabular-nums">${P.fmt.pl1(v)}</text>`;
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

    // Linie poziome — moc nominalna grzałki (bursztyn) i PC (cyan), osobno
    const heaterKW = P.state.heaterKW;
    const hpKW = P.state.hpKW;
    const yHeater = y(heaterKW);
    const yHp = y(hpKW);
    const nomHeater = heaterKW > 0.01 ? `
      <line x1="${padL}" y1="${yHeater.toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${yHeater.toFixed(2)}"
            stroke="#f59e0b" stroke-width="1.25" stroke-dasharray="5,3" opacity="0.85"/>
      <text x="${(W - padR - 4).toFixed(2)}" y="${(yHeater - 4).toFixed(2)}" text-anchor="end"
            font-family="'IBM Plex Mono', monospace" font-size="10" fill="#f59e0b"
            font-variant-numeric="tabular-nums">grzałka ${P.fmt.pl1(heaterKW)} kW</text>
    ` : '';
    const nomHp = hpKW > 0.01 ? `
      <line x1="${padL}" y1="${yHp.toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${yHp.toFixed(2)}"
            stroke="#22d3ee" stroke-width="1.25" stroke-dasharray="5,3" opacity="0.85"/>
      <text x="${(padL + 4).toFixed(2)}" y="${(yHp - 4).toFixed(2)}" text-anchor="start"
            font-family="'IBM Plex Mono', monospace" font-size="10" fill="#22d3ee"
            font-variant-numeric="tabular-nums">PC ${P.fmt.pl1(hpKW)} kW</text>
    ` : '';
    const nominal = nomHeater + nomHp;

    // Legenda — dwa znaczniki: źródło energii (PV / sieć)
    const lx = W - padR - 150;
    const legend = `
      <rect x="${lx}" y="${padT + 2}" width="10" height="10" fill="#f59e0b" opacity="0.85"/>
      <text x="${lx + 15}" y="${padT + 11}" font-family="'IBM Plex Mono', monospace" font-size="10"
            fill="#a1a1aa">z PV</text>
      <rect x="${lx + 60}" y="${padT + 2}" width="10" height="10" fill="#a78bfa" opacity="0.85"/>
      <text x="${lx + 75}" y="${padT + 11}" font-family="'IBM Plex Mono', monospace" font-size="10"
            fill="#a1a1aa">z sieci</text>
    `;

    svg.innerHTML = `
      ${gridLines}${xGrid}${axes}${bars}${nominal}${legend}${yLabels}${xLabels}
      <text x="${padL - 30}" y="${padT - 10}" font-family="'IBM Plex Mono', monospace" font-size="9.5"
            fill="var(--pvsim-text-2)" letter-spacing="1.4">[kW]</text>
    `;

    const ctxEl = document.getElementById('pvsim-tank-elec-ctx');
    if (ctxEl) {
      const pv   = simTank.daily.elec_pair_pv   != null ? simTank.daily.elec_pair_pv   : simTank.daily.elec_pv;
      const grid = simTank.daily.elec_pair_grid != null ? simTank.daily.elec_pair_grid : simTank.daily.elec_grid;
      ctxEl.textContent = `— z PV ${P.fmt.pl1(pv)} kWh · z sieci ${P.fmt.pl1(grid)} kWh`;
    }
  };

  // ===== RENDER WYKRESU PODZIAŁU CIEPŁA — PC vs GRZAŁKA (Moduł 04) =====
  // Słupki godzinowe: dół = ciepło dostarczone z PC (cyan), góra = z grzałki (bursztyn).
  // Pod wykresem stat: udział PC vs grzałki w pokryciu CWU i efektywny COP układu.
  P.renderHeatSplitChart = function(simTank) {
    const svg = document.getElementById('pvsim-tank-split-chart');
    if (!svg) return;
    const W = 780, H = 300;
    const padL = 50, padR = 18, padT = 22, padB = 36;
    const cw = W - padL - padR;
    const ch = H - padT - padB;

    const hrs = simTank.hours;
    const heaterKW = P.state.heaterKW;
    const hpKW = P.state.hpKW;
    const mi = P.state.monthIdx;
    const hpCOP = (mi >= 3 && mi <= 8) ? P.state.hpCOPSummer : P.state.hpCOPWinter;
    const hpQNom = hpKW * hpCOP;
    const rawMax = Math.max(
      ...hrs.map(d => (d.Q_hp || 0) + (d.Q_heater || 0)),
      heaterKW, hpQNom,
      0.001
    );
    const niceSteps = [0.5, 1, 2, 2.5, 5, 10, 20];
    const step = niceSteps.find(s => rawMax / s <= 6) || 20;
    const yMax = Math.ceil(rawMax / step + 0.001) * step;

    const x = h => padL + (h / 24) * cw;
    const y = v => padT + ch - (v / yMax) * ch;
    const bw = cw / 24;

    let bars = '';
    for (let h = 0; h < 24; h++) {
      const d = hrs[h];
      const qHp = d.Q_hp || 0;
      const qHt = d.Q_heater || 0;
      let acc = 0;
      if (qHp > 0) {
        const segH = (qHp / yMax) * ch;
        if (segH > 0.1) {
          bars += `<rect x="${x(h).toFixed(2)}" y="${y(qHp).toFixed(2)}"
                         width="${(bw - 1).toFixed(2)}" height="${segH.toFixed(2)}"
                         fill="#22d3ee" opacity="0.85"/>`;
        }
        acc = qHp;
      }
      if (qHt > 0) {
        const segH = (qHt / yMax) * ch;
        if (segH > 0.1) {
          bars += `<rect x="${x(h).toFixed(2)}" y="${y(acc + qHt).toFixed(2)}"
                         width="${(bw - 1).toFixed(2)}" height="${segH.toFixed(2)}"
                         fill="#f59e0b" opacity="0.85"/>`;
        }
      }
    }

    const ticks = Math.round(yMax / step);
    let gridLines = '', yLabels = '';
    for (let i = 0; i <= ticks; i++) {
      const v = i * step;
      const yy = y(v);
      gridLines += `<line x1="${padL}" y1="${yy.toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${yy.toFixed(2)}"
                          stroke="var(--pvsim-border)" stroke-width="1" ${i === 0 ? '' : 'stroke-dasharray="2,3"'}/>`;
      yLabels += `<text x="${padL - 8}" y="${(yy + 3.5).toFixed(2)}" text-anchor="end"
                        font-family="'IBM Plex Mono', monospace" font-size="10" fill="var(--pvsim-text-2)"
                        font-variant-numeric="tabular-nums">${P.fmt.pl1(v)}</text>`;
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

    const lx = W - padR - 180;
    const legend = `
      <rect x="${lx}"       y="${padT + 2}" width="10" height="10" fill="#22d3ee" opacity="0.85"/>
      <text x="${lx + 15}"  y="${padT + 11}" font-family="'IBM Plex Mono', monospace" font-size="10" fill="#a1a1aa">PC</text>
      <rect x="${lx + 100}" y="${padT + 2}" width="10" height="10" fill="#f59e0b" opacity="0.85"/>
      <text x="${lx + 115}" y="${padT + 11}" font-family="'IBM Plex Mono', monospace" font-size="10" fill="#a1a1aa">grzałka</text>
    `;

    const yHeater = y(heaterKW);
    const yHp     = y(hpQNom);
    const nomHeater = heaterKW > 0.01 ? `
      <line x1="${padL}" y1="${yHeater.toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${yHeater.toFixed(2)}"
            stroke="#f59e0b" stroke-width="1" stroke-dasharray="4,3" opacity="0.7"/>
      <text x="${(W - padR - 4).toFixed(2)}" y="${(yHeater - 3).toFixed(2)}" text-anchor="end"
            font-family="'IBM Plex Mono', monospace" font-size="9.5" fill="#f59e0b" opacity="0.85">grzałka ${P.fmt.pl1(heaterKW)} kWh/h</text>
    ` : '';
    const nomHp = hpQNom > 0.01 ? `
      <line x1="${padL}" y1="${yHp.toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${yHp.toFixed(2)}"
            stroke="#22d3ee" stroke-width="1" stroke-dasharray="4,3" opacity="0.7"/>
      <text x="${(W - padR - 4).toFixed(2)}" y="${(yHp - 3).toFixed(2)}" text-anchor="end"
            font-family="'IBM Plex Mono', monospace" font-size="9.5" fill="#22d3ee" opacity="0.85">PC ${P.fmt.pl1(hpQNom)} kWh/h (COP ${P.fmt.pl1(hpCOP)})</text>
    ` : '';

    svg.innerHTML = `
      ${gridLines}${xGrid}${axes}${bars}${nomHeater}${nomHp}${legend}${yLabels}${xLabels}
      <text x="${padL - 30}" y="${padT - 10}" font-family="'IBM Plex Mono', monospace" font-size="9.5"
            fill="var(--pvsim-text-2)" letter-spacing="1.4">[kWh]</text>
    `;

    const ctxEl = document.getElementById('pvsim-tank-split-ctx');
    if (ctxEl) {
      const qHp = simTank.daily.Q_hp || 0;
      const qHt = simTank.daily.Q_heater || 0;
      const qTot = qHp + qHt;
      const pctHp = qTot > 0.001 ? (qHp / qTot * 100) : 0;
      const pctHt = qTot > 0.001 ? (qHt / qTot * 100) : 0;
      const elecPair = simTank.daily.elec_pair_total
        || ((simTank.daily.elec_pair_pv || 0) + (simTank.daily.elec_pair_grid || 0))
        || simTank.daily.elec_total || 0;
      const copEff = elecPair > 0.001 ? (qTot / elecPair) : 0;
      ctxEl.textContent = `— PC ${pctHp.toFixed(0)}% · grzałka ${pctHt.toFixed(0)}%`
        + ` · efektywny COP układu ${P.fmt.pl2(copEff)}`;
    }
  };

  // ===== RENDER STATÓW ZASOBNIKA =====
  P.renderTankStats = function(simTank) {
    document.getElementById('pvsim-cover').textContent      = simTank.daily.coveragePct.toFixed(0);
    document.getElementById('pvsim-cover-kwh').textContent  = P.fmt.pl1(simTank.daily.Q_saved);
    document.getElementById('pvsim-cover-residual').textContent = P.fmt.pl1(simTank.daily.Q_residual);
    document.getElementById('pvsim-cover-strat').textContent = P.fmt.pl1(simTank.daily.Q_strat);
    document.getElementById('pvsim-heater-hrs').textContent = simTank.daily.heaterHours;
    document.getElementById('pvsim-heater-kwh').textContent = P.fmt.pl1(simTank.daily.Q_heater);
    const hpHrsEl = document.getElementById('pvsim-hp-hrs');
    const hpKwhEl = document.getElementById('pvsim-hp-kwh');
    if (hpHrsEl) hpHrsEl.textContent = simTank.daily.hpHours || 0;
    if (hpKwhEl) hpKwhEl.textContent = P.fmt.pl1(simTank.daily.Q_hp || 0);

    const dPv   = simTank.daily.elec_pair_pv    != null ? simTank.daily.elec_pair_pv    : simTank.daily.elec_pv;
    const dGrid = simTank.daily.elec_pair_grid  != null ? simTank.daily.elec_pair_grid  : simTank.daily.elec_grid;
    const dTot  = simTank.daily.elec_pair_total != null ? simTank.daily.elec_pair_total : simTank.daily.elec_total;
    document.getElementById('pvsim-elec-total').textContent = P.fmt.pl1(dTot);
    document.getElementById('pvsim-elec-pv').textContent    = P.fmt.pl1(dPv);
    document.getElementById('pvsim-elec-grid').textContent  = P.fmt.pl1(dGrid);
    const dHeater = (simTank.daily.elec_pv || 0) + (simTank.daily.elec_grid || 0);
    const dHp     = (simTank.daily.elec_hp_pv || 0) + (simTank.daily.elec_hp_grid || 0);
    const elDevTot = document.getElementById('pvsim-elec-dev-total');
    const elDevHt  = document.getElementById('pvsim-elec-dev-heater');
    const elDevHp  = document.getElementById('pvsim-elec-dev-hp');
    if (elDevTot) elDevTot.textContent = P.fmt.pl1(dHeater + dHp);
    if (elDevHt)  elDevHt.textContent  = P.fmt.pl1(dHeater);
    if (elDevHp)  elDevHp.textContent  = P.fmt.pl1(dHp);
    document.getElementById('pvsim-grid-cost-d').textContent = P.fmt.pl2(simTank.daily.gridCost);
    const gcHt = document.getElementById('pvsim-grid-cost-heater-d');
    const gcHp = document.getElementById('pvsim-grid-cost-hp-d');
    if (gcHt) gcHt.textContent = P.fmt.pl2(simTank.daily.gridCost_heater || 0);
    if (gcHp) gcHp.textContent = P.fmt.pl2(simTank.daily.gridCost_hp || 0);

    const stratLabel = { 'off': 'wył.', 'off-grid': 'off-grid', 'on-grid': 'on-grid' };
    const ctx = `— grzałka ${P.fmt.pl1(P.state.heaterKW)} kW · zasobnik ${P.state.tankL} l`
      + ` · dzień: ${stratLabel[P.state.heaterStratDay]} · noc: ${stratLabel[P.state.heaterStratNight]}`;
    document.getElementById('pvsim-tank-ctx').textContent = ctx;
  };

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
    set(P.fmt.pl0(mo.Q_strat),     'pvsim-month-cover-strat');
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
    set(P.fmt.pl0(yr.Q_strat),     'pvsim-year-cover-strat');
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

  // ===== RENDER TABELI OPTYMALIZACJI (Moduł 08) =====
  // Renderuje wynik P.optimize() jako tabelę top 3 do #pvsim-optim-table.
  // Każdy wiersz ma przycisk „Przenieś" z atrybutem data-row = indeks wyniku;
  // listener (app.js) odczytuje go i wywołuje applyOptimRow().
  P.renderOptimTable = function(results, emptyMsg) {
    const box = document.getElementById('pvsim-optim-table');
    if (!box) return;

    const stratLabel = { 'off': 'wył.', 'off-grid': 'off-grid', 'on-grid': 'on-grid' };
    const COL_COUNT = 14;

    let body;
    if (!results || results.length === 0) {
      const msg = emptyMsg || 'brak wyników';
      body = `<tr class="pvsim-optim-empty-row"><td colspan="${COL_COUNT}">${msg}</td></tr>`;
    } else {
      // Grupowanie: wiersze o identycznym wyniku ekonomicznym (cost, balancePLN,
      // lifetimeProfit) różnią się tylko parametrami nieistotnymi dla bilansu,
      // więc fizycznie to ten sam wariant. Łączymy w jeden wiersz tabeli,
      // a w kolumnie różniącego się parametru pokazujemy listę „v1 / v2 / v3".
      const groupMap = new Map();
      const groups = [];
      results.forEach((r, idx) => {
        const key = `${r.lifetimeProfit}|${r.cost}|${r.balancePLN}`;
        let g = groupMap.get(key);
        if (!g) {
          g = { leaderIdx: idx, members: [] };
          groupMap.set(key, g);
          groups.push(g);
        }
        g.members.push(r);
      });
      const topGroups = groups.slice(0, 10);

      // Komórka parametru: jeśli wszyscy członkowie mają tę samą wartość — zwraca ją;
      // inaczej zwraca listę unikatów (posortowanych liczbowo lub po kolejności) złączonych „ / ".
      const cell = (members, get, fmt) => {
        const seen = [];
        for (const m of members) {
          const v = get(m);
          if (!seen.includes(v)) seen.push(v);
        }
        seen.sort((a, b) => (typeof a === 'number' && typeof b === 'number') ? a - b : 0);
        return seen.map(fmt).join(' / ');
      };

      body = '';
      let rank = 1;
      topGroups.forEach((g) => {
        const n = g.members.length;
        const rankCell = n === 1 ? `${rank}` : `${rank}–${rank + n - 1}`;
        const first = g.members[0];
        body += `<tr>
          <td>${rankCell}</td>
          <td>${cell(g.members, r => r.kWp, P.fmt.pl1)}</td>
          <td>${cell(g.members, r => r.heaterKW, P.fmt.pl1)}</td>
          <td>${cell(g.members, r => r.hpKW != null ? r.hpKW : 0, P.fmt.pl1)}</td>
          <td>${cell(g.members, r => r.heaterThreshold, v => Math.round(v * 100))}</td>
          <td>${cell(g.members, r => r.tankL, v => v)}</td>
          <td>${cell(g.members, r => r.heaterTargetC, v => v)}</td>
          <td>${cell(g.members, r => r.stratDay, v => stratLabel[v])}</td>
          <td>${cell(g.members, r => r.stratNight, v => stratLabel[v])}</td>
          <td>${P.fmt.pl0(first.cost)}</td>
          <td>${P.fmt.pl2(first.balancePLN)}</td>
          <td>${P.fmt.pl1(first.paybackYears)}</td>
          <td class="pvsim-optim-profit">${P.fmt.pl0(first.lifetimeProfit)}</td>
          <td><button class="pvsim-optim-apply" data-row="${g.leaderIdx}">Przenieś →</button></td>
        </tr>`;
        rank += n;
      });
    }

    box.innerHTML = `
      <table class="pvsim-optim-table">
        <thead>
          <tr>
            <th>#</th>
            <th>PV [kWp]</th>
            <th>Grzałka [kW]</th>
            <th>PC [kW]</th>
            <th>Próg [%]</th>
            <th>Zasobnik [l]</th>
            <th>Temp. grz. [°C]</th>
            <th>Strat. dzień</th>
            <th>Strat. noc</th>
            <th>Koszt inw. [zł]</th>
            <th>Bilans roczny [zł]</th>
            <th>Zwrot [lat]</th>
            <th>Zysk netto [zł]</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>`;
  };

})(window.PVSIM);
