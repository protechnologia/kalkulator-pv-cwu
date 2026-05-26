/* =========================================================
   PV.SIM — Renderowanie Modułu 02 (CWU)

   Wydzielone z pv-sim.render.js.

   renderDHWChart() — wykres zużycia wody (m³/h) i mocy grzewczej (kW),
                      dwie osie Y (lewa m³/h, prawa kW) niezależnie wyskalowane,
                      turkusowa krzywa z gradientem, marker peak,
                      linia strat cyrkulacji (P_circ).
   renderDHWStats() — karty: dobowe/miesięczne/roczne zużycie wody,
                      energii i kosztu + udział cyrkulacji + kontekst
                      (osoby, miesiąc, ΔT, % cyrkulacji).
   ========================================================= */
window.PVSIM = window.PVSIM || {};
(function(P) {
  'use strict';

  // ===== Lokalna kopia smoothPath (Catmull-Rom) — używana też w render.js =====
  const smoothPath = (pts) => {
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

})(window.PVSIM);
