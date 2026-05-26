/* =========================================================
   PV.SIM — Renderowanie Modułu 04 (zasobnik: PC + grzałka)

   Cztery funkcje operujące na simTank. Współdzielony helper
   P._smoothPath() pochodzi z pv-sim.render.js.

   renderTankChart()      — wykres temperatury zasobnika (°C) z tłem grzania
                            (osobny odcień dla strefy dziennej i nocnej),
                            linia termostatu i linia T_CWU, kolor bursztynowy
   renderTankElecChart()  — wykres słupkowy mocy elektrycznej pary
                            PC + grzałki: 4-stos (PC·PV, grz·PV, PC·sieć,
                            grz·sieć)
   renderHeatSplitChart() — wykres słupkowy podziału mocy cieplnej
                            (PC vs grzałka, kWh ciepła dostarczonego do
                            zasobnika)
   renderTankStats()      — karty: pokrycie CWU, bilans energii, grzałka,
                            PC, zużycie prądu — źródło i — urządzenie,
                            koszt energii z sieci
   ========================================================= */
window.PVSIM = window.PVSIM || {};
(function(P) {
  'use strict';

  const smoothPath = P._smoothPath;

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
      yLabels += `<text x="${padL - 8}" y="${(yy + 3.5).toFixed(2)}" text-anchor="end">${Math.round(v)}</text>`;
    }

    // Linie referencyjne:
    //  T_kran (cel, ustawiana sliderem) — niebieska, najważniejsza dla użytkownika
    //  T_max 60°C (termostat) — czerwona
    //  T_in (woda zimna, sezonowa) — szary cień
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

    let xLabels = '', xGrid = '';
    for (let h = 0; h <= 24; h += 3) {
      const xx = x(h);
      xGrid += `<line x1="${xx.toFixed(2)}" y1="${padT}" x2="${xx.toFixed(2)}" y2="${(padT + ch).toFixed(2)}"
                      stroke="var(--pvsim-border)" stroke-width="1" stroke-dasharray="1,4"/>`;
      const hh = String(h % 24).padStart(2, '0');
      xLabels += `<text x="${xx.toFixed(2)}" y="${(padT + ch + 18).toFixed(2)}" text-anchor="middle">${hh}:00</text>`;
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

    const hpLabel = `<text x="${padL - 6}" y="${(hpBandTop + bandH / 2 + 3.5).toFixed(2)}" text-anchor="end" font-size="9" font-weight="600" fill="#22d3ee" opacity="0.85" letter-spacing="1">PC</text>`;
    const heaterLabel = `<text x="${padL - 6}" y="${(heaterBandTop + bandH / 2 + 3.5).toFixed(2)}" text-anchor="end" font-size="9" font-weight="600" fill="#f59e0b" opacity="0.85" letter-spacing="1">GRZ.</text>`;

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
      <text x="${padL - 30}" y="${padT - 10}" font-size="9.5" letter-spacing="1.4">[°C]</text>
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

    // 4-stos (od dołu): PC·PV (#f59e0b), grz·PV (#fcd34d), PC·sieć (#a78bfa),
    // grz·sieć (#c4b5fd). Ciemniejszy odcień = PC, jaśniejszy = grzałka;
    // bursztyn = PV, fiolet = sieć.
    const SEG = [
      { key: 'elec_hp_pv',   color: '#f59e0b' },
      { key: 'elec_pv',      color: '#fcd34d' },
      { key: 'elec_hp_grid', color: '#a78bfa' },
      { key: 'elec_grid',    color: '#c4b5fd' },
    ];
    let bars = '';
    for (let h = 0; h < 24; h++) {
      const d = simTank.hours[h];
      let acc = 0;
      for (const s of SEG) {
        const v = d[s.key] || 0;
        if (v <= 0) continue;
        const segH = (v / yMax) * ch;
        if (segH > 0.1) {
          bars += `<rect x="${x(h).toFixed(2)}" y="${y(acc + v).toFixed(2)}"
                         width="${(bw - 1).toFixed(2)}" height="${segH.toFixed(2)}"
                         fill="${s.color}" opacity="0.9"/>`;
        }
        acc += v;
      }
    }

    const ticks = Math.round(yMax / step);
    let gridLines = '', yLabels = '';
    for (let i = 0; i <= ticks; i++) {
      const v = i * step;
      const yy = y(v);
      gridLines += `<line x1="${padL}" y1="${yy.toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${yy.toFixed(2)}"
                          stroke="var(--pvsim-border)" stroke-width="1" ${i === 0 ? '' : 'stroke-dasharray="2,3"'}/>`;
      yLabels += `<text x="${padL - 8}" y="${(yy + 3.5).toFixed(2)}" text-anchor="end">${P.fmt.pl1(v)}</text>`;
    }

    let xLabels = '', xGrid = '';
    for (let h = 0; h <= 24; h += 3) {
      const xx = x(h);
      xGrid += `<line x1="${xx.toFixed(2)}" y1="${padT}" x2="${xx.toFixed(2)}" y2="${(padT + ch).toFixed(2)}"
                      stroke="var(--pvsim-border)" stroke-width="1" stroke-dasharray="1,4"/>`;
      xLabels += `<text x="${xx.toFixed(2)}" y="${(padT + ch + 18).toFixed(2)}" text-anchor="middle">${String(h % 24).padStart(2, '0')}:00</text>`;
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
      <text x="${(W - padR - 4).toFixed(2)}" y="${(yHeater - 4).toFixed(2)}" text-anchor="end" fill="#f59e0b">grzałka ${P.fmt.pl1(heaterKW)} kW</text>
    ` : '';
    const nomHp = hpKW > 0.01 ? `
      <line x1="${padL}" y1="${yHp.toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${yHp.toFixed(2)}"
            stroke="#22d3ee" stroke-width="1.25" stroke-dasharray="5,3" opacity="0.85"/>
      <text x="${(padL + 4).toFixed(2)}" y="${(yHp - 4).toFixed(2)}" text-anchor="start" fill="#22d3ee">PC ${P.fmt.pl1(hpKW)} kW</text>
    ` : '';
    const nominal = nomHeater + nomHp;

    // Legenda 4-elementowa: PC·PV, grz·PV, PC·sieć, grz·sieć
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
      ${gridLines}${xGrid}${axes}${bars}${nominal}${legend}${yLabels}${xLabels}
      <text x="${padL - 30}" y="${padT - 10}" font-size="9.5" letter-spacing="1.4">[kW]</text>
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
      yLabels += `<text x="${padL - 8}" y="${(yy + 3.5).toFixed(2)}" text-anchor="end">${P.fmt.pl1(v)}</text>`;
    }

    let xLabels = '', xGrid = '';
    for (let h = 0; h <= 24; h += 3) {
      const xx = x(h);
      xGrid += `<line x1="${xx.toFixed(2)}" y1="${padT}" x2="${xx.toFixed(2)}" y2="${(padT + ch).toFixed(2)}"
                      stroke="var(--pvsim-border)" stroke-width="1" stroke-dasharray="1,4"/>`;
      xLabels += `<text x="${xx.toFixed(2)}" y="${(padT + ch + 18).toFixed(2)}" text-anchor="middle">${String(h % 24).padStart(2, '0')}:00</text>`;
    }

    const axes = `
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${(padT + ch).toFixed(2)}" stroke="var(--pvsim-border-strong)" stroke-width="1"/>
      <line x1="${padL}" y1="${(padT + ch).toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${(padT + ch).toFixed(2)}" stroke="var(--pvsim-border-strong)" stroke-width="1"/>
    `;

    const lx = W - padR - 180;
    const legend = `
      <rect x="${lx}"       y="${padT + 2}" width="10" height="10" fill="#22d3ee" opacity="0.85"/>
      <text x="${lx + 15}" y="${padT + 11}" fill="#a1a1aa">PC</text>
      <rect x="${lx + 100}" y="${padT + 2}" width="10" height="10" fill="#f59e0b" opacity="0.85"/>
      <text x="${lx + 115}" y="${padT + 11}" fill="#a1a1aa">grzałka</text>
    `;

    const yHeater = y(heaterKW);
    const yHp     = y(hpQNom);
    const nomHeater = heaterKW > 0.01 ? `
      <line x1="${padL}" y1="${yHeater.toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${yHeater.toFixed(2)}"
            stroke="#f59e0b" stroke-width="1" stroke-dasharray="4,3" opacity="0.7"/>
      <text x="${(W - padR - 4).toFixed(2)}" y="${(yHeater - 3).toFixed(2)}" text-anchor="end" font-size="9.5" fill="#f59e0b" opacity="0.85">grzałka ${P.fmt.pl1(heaterKW)} kWh/h</text>
    ` : '';
    const nomHp = hpQNom > 0.01 ? `
      <line x1="${padL}" y1="${yHp.toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${yHp.toFixed(2)}"
            stroke="#22d3ee" stroke-width="1" stroke-dasharray="4,3" opacity="0.7"/>
      <text x="${(W - padR - 4).toFixed(2)}" y="${(yHp - 3).toFixed(2)}" text-anchor="end" font-size="9.5" fill="#22d3ee" opacity="0.85">PC ${P.fmt.pl1(hpQNom)} kWh/h (COP ${P.fmt.pl1(hpCOP)})</text>
    ` : '';

    svg.innerHTML = `
      ${gridLines}${xGrid}${axes}${bars}${nomHeater}${nomHp}${legend}${yLabels}${xLabels}
      <text x="${padL - 30}" y="${padT - 10}" font-size="9.5" letter-spacing="1.4">[kWh]</text>
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
    document.getElementById('pvsim-bilans-kwh').textContent      = P.fmt.pl1(simTank.daily.Q_saved);
    document.getElementById('pvsim-bilans-residual').textContent = '+ ' + P.fmt.pl1(simTank.daily.Q_residual);
    document.getElementById('pvsim-bilans-strat').textContent    = '+ ' + P.fmt.pl1(simTank.daily.Q_strat);
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

})(window.PVSIM);
