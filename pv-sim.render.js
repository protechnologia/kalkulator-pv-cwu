/* =========================================================
   PV.SIM — Renderowanie wykresów i statystyk

   Odpowiada za całą warstwę prezentacji — nie wykonuje obliczeń,
   tylko przetwarza wyniki symulacji na elementy DOM i SVG.

   P.fmt — formatery liczb w polskiej lokalizacji (pl-PL),
     eksportowane na namespace, bo używa ich też app.js

   Prywatna smoothPath() — interpolacja krzywą Catmull-Rom,
     wygładza wykresy SVG między próbkami godzinowymi.

   Moduł 01 — PV:
     renderChart()  — wykres mocy chwilowej (kW), kolor pomarańczowy
     renderStats()  — karty: produkcja dobowa, miesięczna, moc szczytowa

   Moduł 02 — CWU:
     renderDHWChart() — wykres zużycia wody (m³/h) i mocy grzewczej (kW),
                        dwie osie Y, kolor turkusowy
     renderDHWStats() — karty: dobowe/miesięczne zużycie wody, energii i koszt

   Moduł 03 — Zasobnik:
     renderTankChart() — wykres temperatury zasobnika (°C) z tłem grzania,
                         linia termostatu i linea T_CWU, kolor bursztynowy
     renderTankStats() — karty: pokrycie CWU, energia z PV, oszczędność w zł
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
    const padL = 50, padR = 18, padT = 14, padB = 36;
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
                          stroke="#26262b" stroke-width="1" ${i === 0 ? '' : 'stroke-dasharray="2,3"'}/>`;
      yLabels += `<text x="${padL - 8}" y="${(yy + 3.5).toFixed(2)}" text-anchor="end"
                        font-family="'IBM Plex Mono', monospace" font-size="10" fill="#6b6b73"
                        font-variant-numeric="tabular-nums">${Math.round(v)}</text>`;
    }

    let xLabels = '';
    let xGrid = '';
    for (let h = 0; h <= 24; h += 3) {
      const xx = x(h);
      xGrid += `<line x1="${xx.toFixed(2)}" y1="${padT}" x2="${xx.toFixed(2)}" y2="${(padT + ch).toFixed(2)}"
                      stroke="#26262b" stroke-width="1" stroke-dasharray="1,4"/>`;
      const hh = String(h % 24).padStart(2, '0');
      xLabels += `<text x="${xx.toFixed(2)}" y="${(padT + ch + 18).toFixed(2)}" text-anchor="middle"
                        font-family="'IBM Plex Mono', monospace" font-size="10" fill="#6b6b73"
                        font-variant-numeric="tabular-nums">${hh}:00</text>`;
    }

    const px = x(12);
    const py = y(sim.peak);
    const peakMarker = sim.peak > 0.05 ? `
      <line x1="${px.toFixed(2)}" y1="${(padT).toFixed(2)}" x2="${px.toFixed(2)}" y2="${py.toFixed(2)}"
            stroke="#2dd4bf" stroke-width="1" stroke-dasharray="2,3" opacity="0.5"/>
      <circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="4" fill="#0a0a0b" stroke="#ff7a1a" stroke-width="2"/>
      <text x="${(px + 8).toFixed(2)}" y="${(py - 6).toFixed(2)}"
            font-family="'IBM Plex Mono', monospace" font-size="10" font-weight="600" fill="#ff7a1a"
            font-variant-numeric="tabular-nums">P_max ${P.fmt.pl2(sim.peak)} kW</text>
    ` : '';

    const axes = `
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${(padT + ch).toFixed(2)}" stroke="#36363d" stroke-width="1"/>
      <line x1="${padL}" y1="${(padT + ch).toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${(padT + ch).toFixed(2)}" stroke="#36363d" stroke-width="1"/>
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
      <text x="${padL - 30}" y="${padT - 2}" font-family="'IBM Plex Mono', monospace" font-size="9.5"
            fill="#6b6b73" letter-spacing="1.4">[kW]</text>
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

  // ===== RENDER WYKRESU CWU =====
  // Jedna krzywa zużycia wody, dwie osie Y (m³/h i kW) niezależnie wyskalowane.
  // Zasada: lewa oś zawsze 0..1.0 m³/h, prawa oś zawsze 0..60 kW.
  // Relacja kW = m³/h × cw × ΔT zmienia się z miesiącem i T_hot, więc osie NIE są
  // sztywno proporcjonalne — to świadoma decyzja, by skala była przewidywalna.
  P.renderDHWChart = function(simDHW) {
    const svg = document.getElementById('pvsim-dhw-chart');
    const W = 780, H = 300;
    const padL = 50, padR = 50, padT = 14, padB = 36;
    const cw = W - padL - padR;
    const ch = H - padT - padB;

    const yMaxL = P.Y_MAX_M3H;
    const yMaxR = yMaxL * simDHW.kwhM3;
    const xMax = 24;

    const x = h => padL + (h / xMax) * cw;
    const y = v => padT + ch - (v / yMaxL) * ch;

    const pts = simDHW.hours.map(d => ({ x: x(d.hour + 0.5), y: y(d.water) }));
    pts.unshift({ x: x(0),  y: y(0) });
    pts.push   ({ x: x(24), y: y(0) });

    const linePath = smoothPath(pts);
    const areaPath = linePath + ` L ${x(24).toFixed(2)} ${y(0).toFixed(2)} L ${x(0).toFixed(2)} ${y(0).toFixed(2)} Z`;

    const yTicks = 5;
    let gridLines = '';
    let yLabelsL = '';
    let yLabelsR = '';
    for (let i = 0; i <= yTicks; i++) {
      const vL = (yMaxL * i / yTicks);
      const vR = (yMaxR * i / yTicks);
      const yy = y(vL);
      gridLines += `<line x1="${padL}" y1="${yy.toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${yy.toFixed(2)}"
                          stroke="#26262b" stroke-width="1" ${i === 0 ? '' : 'stroke-dasharray="2,3"'}/>`;
      yLabelsL += `<text x="${padL - 8}" y="${(yy + 3.5).toFixed(2)}" text-anchor="end"
                         font-family="'IBM Plex Mono', monospace" font-size="10" fill="#6b6b73"
                         font-variant-numeric="tabular-nums">${P.fmt.pl1(vL)}</text>`;
      yLabelsR += `<text x="${(W - padR + 8).toFixed(2)}" y="${(yy + 3.5).toFixed(2)}" text-anchor="start"
                         font-family="'IBM Plex Mono', monospace" font-size="10" fill="#6b6b73"
                         font-variant-numeric="tabular-nums">${P.fmt.pl1(vR)}</text>`;
    }

    let xLabels = '', xGrid = '';
    for (let h = 0; h <= 24; h += 3) {
      const xx = x(h);
      xGrid += `<line x1="${xx.toFixed(2)}" y1="${padT}" x2="${xx.toFixed(2)}" y2="${(padT + ch).toFixed(2)}"
                      stroke="#26262b" stroke-width="1" stroke-dasharray="1,4"/>`;
      const hh = String(h % 24).padStart(2, '0');
      xLabels += `<text x="${xx.toFixed(2)}" y="${(padT + ch + 18).toFixed(2)}" text-anchor="middle"
                        font-family="'IBM Plex Mono', monospace" font-size="10" fill="#6b6b73"
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
      <circle cx="${ppx.toFixed(2)}" cy="${ppy.toFixed(2)}" r="4" fill="#0a0a0b" stroke="#2dd4bf" stroke-width="2"/>
      <text x="${(ppx + 8).toFixed(2)}" y="${(ppy - 6).toFixed(2)}"
            font-family="'IBM Plex Mono', monospace" font-size="10" font-weight="600" fill="#2dd4bf"
            font-variant-numeric="tabular-nums">peak ${P.fmt.pl2(peakHour.power)} kW · ${P.fmt.pl2(peakHour.water)} m³/h</text>
    ` : '';

    const axes = `
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${(padT + ch).toFixed(2)}" stroke="#36363d" stroke-width="1"/>
      <line x1="${(W - padR).toFixed(2)}" y1="${padT}" x2="${(W - padR).toFixed(2)}" y2="${(padT + ch).toFixed(2)}" stroke="#36363d" stroke-width="1"/>
      <line x1="${padL}" y1="${(padT + ch).toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${(padT + ch).toFixed(2)}" stroke="#36363d" stroke-width="1"/>
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
      <text x="${padL - 30}" y="${padT - 2}" font-family="'IBM Plex Mono', monospace" font-size="9.5"
            fill="#6b6b73" letter-spacing="1.4">[m³/h]</text>
      <text x="${(W - padR + 4).toFixed(2)}" y="${padT - 2}" font-family="'IBM Plex Mono', monospace" font-size="9.5"
            fill="#6b6b73" letter-spacing="1.4">[kW]</text>
    `;
  };

  // ===== RENDER STATÓW CWU =====
  P.renderDHWStats = function(simDHW) {
    const circ = simDHW.circulation;
    const circPct = simDHW.daily.energy > 0
      ? Math.round(circ.energy / simDHW.daily.energy * 100)
      : 0;
    const circPctTot = simDHW.daily.totalEnergy > 0
      ? Math.round(circ.energy / simDHW.daily.totalEnergy * 100)
      : 0;

    document.getElementById('pvsim-dhw-water-d').textContent      = P.fmt.pl2(simDHW.daily.water);
    document.getElementById('pvsim-dhw-water-m').textContent      = P.fmt.pl0(simDHW.monthly.water);
    document.getElementById('pvsim-dhw-energy-d').textContent     = P.fmt.pl0(simDHW.daily.totalEnergy);
    document.getElementById('pvsim-dhw-energy-m').textContent     = P.fmt.pl0(simDHW.monthly.totalEnergy);
    document.getElementById('pvsim-dhw-circ-d').textContent       = P.fmt.pl0(circ.energy);
    document.getElementById('pvsim-dhw-circ-pct').textContent     = circPct;
    document.getElementById('pvsim-dhw-circ-pct-tot').textContent = circPctTot;
    document.getElementById('pvsim-dhw-cost-d').textContent   = P.fmt.pl2(simDHW.daily.totalCost);
    document.getElementById('pvsim-dhw-cost-m').textContent   = P.fmt.pl0(simDHW.monthly.totalCost);

    const buildingLabel = P.state.buildingType === 'old' ? 'stary bud.' : 'nowy bud.';
    const ctx = `— ${P.state.residents} osób · ${P.MONTHS[P.state.monthIdx].name} · ΔT ${simDHW.T_in.toFixed(1)}→${simDHW.T_hot}°C · ${buildingLabel}`;
    document.getElementById('pvsim-dhw-ctx').textContent = ctx;
  };

  // ===== RENDER WYKRESU ZASOBNIKA =====
  // Temperatura T(t) + zacieniowanie godzin pracy grzałki w tle.
  P.renderTankChart = function(simTank) {
    const svg = document.getElementById('pvsim-tank-chart');
    const W = 780, H = 300;
    const padL = 50, padR = 18, padT = 14, padB = 36;
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
                          stroke="#26262b" stroke-width="1" ${i === 0 ? '' : 'stroke-dasharray="2,3"'}/>`;
      yLabels += `<text x="${padL - 8}" y="${(yy + 3.5).toFixed(2)}" text-anchor="end"
                        font-family="'IBM Plex Mono', monospace" font-size="10" fill="#6b6b73"
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
            stroke="#6b6b73" stroke-width="1" stroke-dasharray="3,3" opacity="0.5"/>
      <text x="${(W - padR - 4).toFixed(2)}" y="${(y(T_in) - 4).toFixed(2)}" text-anchor="end"
            font-family="'IBM Plex Mono', monospace" font-size="9.5" fill="#a1a1aa" opacity="0.7">T_wodociąg ${T_in.toFixed(1)}°</text>
    `;

    let xLabels = '', xGrid = '';
    for (let h = 0; h <= 24; h += 3) {
      const xx = x(h);
      xGrid += `<line x1="${xx.toFixed(2)}" y1="${padT}" x2="${xx.toFixed(2)}" y2="${(padT + ch).toFixed(2)}"
                      stroke="#26262b" stroke-width="1" stroke-dasharray="1,4"/>`;
      const hh = String(h % 24).padStart(2, '0');
      xLabels += `<text x="${xx.toFixed(2)}" y="${(padT + ch + 18).toFixed(2)}" text-anchor="middle"
                        font-family="'IBM Plex Mono', monospace" font-size="10" fill="#6b6b73"
                        font-variant-numeric="tabular-nums">${hh}:00</text>`;
    }

    let heaterBg = '';
    simTank.hours.forEach(d => {
      if (d.heaterOn) {
        const x1 = x(d.hour), x2 = x(d.hour + 1);
        heaterBg += `<rect x="${x1.toFixed(2)}" y="${padT}" width="${(x2 - x1).toFixed(2)}" height="${ch}"
                           fill="#f59e0b" opacity="0.08"/>`;
      }
    });

    const onHours = simTank.hours.filter(d => d.heaterOn);
    let heaterLabel = '';
    if (onHours.length > 0) {
      const firstOn = onHours[0].hour;
      const lastOn = onHours[onHours.length - 1].hour + 1;
      const midX = x((firstOn + lastOn) / 2);
      heaterLabel = `<text x="${midX.toFixed(2)}" y="${(padT + 14).toFixed(2)}" text-anchor="middle"
                           font-family="'IBM Plex Mono', monospace" font-size="9.5" font-weight="600"
                           fill="#f59e0b" opacity="0.85" letter-spacing="1.5">▼ GRZAŁKA ON ▼</text>`;
    }

    const axes = `
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${(padT + ch).toFixed(2)}" stroke="#36363d" stroke-width="1"/>
      <line x1="${padL}" y1="${(padT + ch).toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${(padT + ch).toFixed(2)}" stroke="#36363d" stroke-width="1"/>
    `;

    svg.innerHTML = `
      <defs>
        <linearGradient id="pvsim-tank-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stop-color="#f59e0b" stop-opacity="0.45"/>
          <stop offset="60%" stop-color="#f59e0b" stop-opacity="0.12"/>
          <stop offset="100%" stop-color="#f59e0b" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${heaterBg}
      ${gridLines}
      ${xGrid}
      ${axes}
      ${refLines}
      <path d="${areaPath}" fill="url(#pvsim-tank-grad)"/>
      <path d="${linePath}" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linejoin="round"/>
      ${heaterLabel}
      ${yLabels}
      ${xLabels}
      <text x="${padL - 30}" y="${padT - 2}" font-family="'IBM Plex Mono', monospace" font-size="9.5"
            fill="#6b6b73" letter-spacing="1.4">[°C]</text>
    `;
  };

  // ===== RENDER STATÓW ZASOBNIKA =====
  P.renderTankStats = function(simTank) {
    document.getElementById('pvsim-cover').textContent      = simTank.daily.coveragePct.toFixed(0);
    document.getElementById('pvsim-cover-kwh').textContent  = P.fmt.pl1(simTank.daily.Q_saved);
    document.getElementById('pvsim-save-d').textContent     = P.fmt.pl2(simTank.daily.savingPLN);
    document.getElementById('pvsim-save-m').textContent     = P.fmt.pl0(simTank.monthly.savingPLN);
    document.getElementById('pvsim-heater-hrs').textContent = simTank.daily.heaterHours;
    document.getElementById('pvsim-heater-kwh').textContent = P.fmt.pl1(simTank.daily.Q_heater);

    const ctx = `— grzałka ${P.fmt.pl1(P.state.heaterKW)} kW · zasobnik ${P.state.tankL} l`;
    document.getElementById('pvsim-tank-ctx').textContent = ctx;
  };

})(window.PVSIM);
