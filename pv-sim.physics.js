/* =========================================================
   PV.SIM — Model fizyczny symulacji

   Zawiera trzy główne funkcje obliczeniowe:

   P.simulateDay(kWp, monthIdx, pvMode)
     Godzinowa produkcja PV. Wyznacza wysokość słońca (model Coopera 1969),
     przelicza przez model bezchmurny Hottela, a następnie skaluje wynik
     do średniej dobowej z PVGIS (tryb 'avg') lub do idealnego
     dnia słonecznego (tryb 'clear'). Zwraca tablicę 24 godzin + sumy.

   P.simulateDHW(residents, monthIdx, T_hot)
     Godzinowe zapotrzebowanie na ciepłą wodę użytkową dla N mieszkańców.
     Rozkłada dobową objętość wg znormalizowanego profilu godzinowego,
     oblicza energię użyteczną oraz straty cyrkulacji (P.CIRC_LOSS wg
     P.state.buildingType: stary budynek 60%, nowy 35%) i koszt całkowity
     przy aktualnej taryfie ECO.

   P.simulateTank(simPV, simDHW, heaterKW, tankL)
     Model zasobnika 1-węzłowego (fully-mixed) z 6 podkrokami na godzinę.
     Symuluje: pobór CWU (rozcieńczenie), grzanie grzałką off-grid
     (power diverter — grzałka throttluje moc do nadwyżki PV, włącza się
     gdy P_PV ≥ progu = heaterThreshold × P_grzałki), straty postojowe.
     Śledzi pokrycie zapotrzebowania CWU i oszczędności w zł.
   ========================================================= */
window.PVSIM = window.PVSIM || {};
(function(P) {
  'use strict';

  // ===== FIZYKA SŁOŃCA (prywatne) =====
  const rad = d => d * Math.PI / 180;

  // Pozycja słońca: wysokość kątowa nad horyzontem [rad]
  // φ — szerokość geograficzna, doy — dzień roku, hour — godzina słoneczna (0..24)
  function solarElevation(phi, doy, hour) {
    const phiR = rad(phi);
    // Deklinacja słońca (Cooper, 1969)
    const decl = rad(23.45 * Math.sin(rad(360 * (284 + doy) / 365)));
    // Kąt godzinowy: 15° na godzinę, 0° w południe słoneczne
    const omega = rad((hour - 12) * 15);
    const sinAlpha = Math.sin(phiR) * Math.sin(decl)
                   + Math.cos(phiR) * Math.cos(decl) * Math.cos(omega);
    return Math.asin(Math.max(-1, Math.min(1, sinAlpha)));
  }

  // Uproszczony model clear-sky (Hottel zmodyfikowany)
  function clearSkyRel(alpha) {
    if (alpha <= 0.01) return 0;
    const sinA = Math.sin(alpha);
    const AM = 1 / sinA;  // air mass uproszczony
    const tau = Math.pow(0.7, Math.pow(AM, 0.678));
    return tau * sinA;
  }

  // ===== SYMULACJA GODZINOWA PV =====
  P.simulateDay = function(kWp, monthIdx, pvMode) {
    const m = P.MONTHS[monthIdx];
    const hours = [];
    let rawSum = 0;

    // Próbkujemy 24 razy, w środku każdej godziny (h+0.5)
    for (let h = 0; h < 24; h++) {
      const alpha = solarElevation(P.LAT, m.doy, h + 0.5);
      const raw = clearSkyRel(alpha);
      hours.push({ hour: h, raw, alpha });
      rawSum += raw;
    }

    // 'avg'   — skalujemy do PVGIS dailyYield (uśrednione: słoneczne + pochmurne dni)
    // 'clear' — czysty clear-sky × CLEAR_SCALE (idealny bezchmurny dzień)
    let scale;
    if (pvMode === 'clear') {
      scale = P.CLEAR_SCALE;
    } else {
      scale = rawSum > 0 ? m.dailyYield / rawSum : 0;
    }

    const result = hours.map(h => ({
      hour: h.hour,
      power: h.raw * scale * kWp,   // kW chwilowe w środku godziny
      energy: h.raw * scale * kWp   // kWh w danej godzinie (1h × kW = kWh)
    }));

    const daily   = result.reduce((s, x) => s + x.energy, 0);
    const peak    = Math.max(...result.map(x => x.power));
    const monthly = daily * m.days;

    return { hours: result, daily, peak, monthly, monthData: m, mode: pvMode };
  };

  // ===== SYMULACJA CWU =====
  // Godzinowy profil + statystyki dobowe i miesięczne dla N mieszkańców.
  // Straty cyrkulacji: stała moc P_circ rozprowadzona równomiernie przez 24h,
  // obliczona jako procent Q_użytecznej zależny od typu budynku (P.CIRC_LOSS).
  P.simulateDHW = function(residents, monthIdx, T_hot) {
    const m = P.MONTHS[monthIdx];
    const T_in   = P.T_cold(monthIdx);
    const kwhM3  = P.kWh_per_m3(monthIdx, T_hot);
    const priceM3 = kwhM3 * P.PRICE_PER_KWH;
    const dailyM3 = (residents * P.DHW_L_PER_PERSON) / 1000;

    const Q_useful = dailyM3 * kwhM3;
    const circRatio = P.CIRC_LOSS[P.state.buildingType] || P.CIRC_LOSS.old;
    const Q_circ = Q_useful * circRatio;       // kWh/dobę strat cyrkulacji
    const P_circ = Q_circ / 24;               // kW — stała moc strat przez całą dobę

    const hours = P.DHW_PROFILE.map((frac, h) => {
      const water  = dailyM3 * frac;         // m³/h (bo 1h)
      const energy = water * kwhM3;          // kWh w godzinie (użyteczna)
      const cost   = energy * P.PRICE_PER_KWH;
      return { hour: h, water, power: energy, energy, cost };
    });

    const Q_total = Q_useful + Q_circ;
    const cost_useful = Q_useful * P.PRICE_PER_KWH;
    const cost_circ   = Q_circ   * P.PRICE_PER_KWH;

    return {
      hours,
      T_in,
      T_hot,
      kwhM3,
      circulation: {
        ratio:   circRatio,
        powerKW: P_circ,
        energy:  Q_circ
      },
      daily: {
        water:       dailyM3,
        energy:      Q_useful,
        cost:        cost_useful,
        totalEnergy: Q_total,
        totalCost:   (cost_useful + cost_circ)
      },
      monthly: {
        water:       dailyM3 * m.days,
        energy:      Q_useful * m.days,
        cost:        cost_useful * m.days,
        totalEnergy: Q_total * m.days,
        totalCost:   (cost_useful + cost_circ) * m.days,
        days:        m.days
      }
    };
  };

  // ===== SYMULACJA ZASOBNIKA (Moduł 04) =====
  // Model 1-węzłowy (fully-mixed) z 6 podkrokami na godzinę.
  // Off-grid: grzałka pracuje tylko gdy P_PV >= P_grzałki w danej godzinie.
  // Start zimny: T_zas(00:00) = T_in (temp. wody wodociągowej w danym miesiącu).
  P.simulateTank = function(simPV, simDHW, heaterKW, tankL) {
    const cw    = P.C_WATER / 3600;                           // kWh/(kg·K)
    const m_zas = tankL;                                      // kg
    const UA    = P.TANK_UA_REF * Math.pow(tankL / P.TANK_V_REF, 2/3);  // W/K
    const UA_kWh = UA / 1000;                                // kWh/(K·h)
    const dt    = 1 / P.TANK_SUBSTEPS;

    const T_in = simDHW.T_in;
    let T = T_in;
    const hours = [];

    let dailyHeaterOnHours = 0;
    let dailyQ_heater = 0;
    let dailyQ_saved  = 0;
    let dailyQ_strat  = 0;
    let dailyQ_wasted = 0;

    for (let h = 0; h < 24; h++) {
      const T_start = T;
      const P_PV    = simPV.hours[h].power;
      const m_pobor = simDHW.hours[h].water * 1000;

      // Sterowanie mocą grzałki (power diverter):
      // - PV < threshold               → wyłączona
      // - threshold ≤ PV < heaterKW   → moc = PV (throttling, cała nadwyżka do grzałki)
      // - PV ≥ heaterKW               → moc = heaterKW (100%)
      // threshold = heaterThreshold [0.1–1.0] × heaterKW
      const threshold = P.state.heaterThreshold * heaterKW;
      const heaterOn = P_PV >= threshold;
      const Q_heater_target = heaterOn ? Math.min(P_PV, heaterKW) : 0;

      const m_per = m_pobor / P.TANK_SUBSTEPS;
      const Q_per = Q_heater_target / P.TANK_SUBSTEPS;

      let Q_saved_h = 0, Q_strat_h = 0, Q_wasted_h = 0, Q_heater_actual_h = 0;

      for (let s = 0; s < P.TANK_SUBSTEPS; s++) {
        // 1) Pobór — oszczędność = ile mniej musi włożyć węzeł ECO (Δ od T_in)
        Q_saved_h += m_per * cw * Math.max(T - T_in, 0);
        if (m_per >= m_zas) {
          T = T_in;
        } else if (m_per > 0) {
          T = (T * (m_zas - m_per) + T_in * m_per) / m_zas;
        }

        // 2) Grzanie z PV (z termostatem T_MAX)
        if (Q_per > 0) {
          const dT_full = Q_per / (m_zas * cw);
          let T_after = T + dT_full;
          if (T_after > P.TANK_T_MAX) {
            const Q_actual = Math.max((P.TANK_T_MAX - T) * m_zas * cw, 0);
            Q_wasted_h += Math.max(Q_per - Q_actual, 0);
            Q_heater_actual_h += Q_actual;
            T_after = P.TANK_T_MAX;
          } else {
            Q_heater_actual_h += Q_per;
          }
          T = T_after;
        }

        // 3) Straty postojowe (do otoczenia)
        const Q_loss = UA_kWh * Math.max(T - P.TANK_T_AMB, 0) * dt;
        Q_strat_h += Q_loss;
        T = Math.max(T - Q_loss / (m_zas * cw), T_in);
      }

      hours.push({
        hour: h,
        T_start, T_end: T,
        heaterOn,
        P_heater_eff: Q_heater_actual_h,
        Q_saved: Q_saved_h,
        Q_strat: Q_strat_h,
        Q_wasted: Q_wasted_h
      });

      if (heaterOn) dailyHeaterOnHours++;
      dailyQ_heater += Q_heater_actual_h;
      dailyQ_saved  += Q_saved_h;
      dailyQ_strat  += Q_strat_h;
      dailyQ_wasted += Q_wasted_h;
    }

    const Q_CWU_total = simDHW.daily.energy;
    const coveragePct = Q_CWU_total > 0 ? (dailyQ_saved / Q_CWU_total * 100) : 0;
    const savingPLN_d = dailyQ_saved * P.PRICE_PER_KWH;
    const days = P.MONTHS[P.state.monthIdx].days;

    // Ciepło zmagazynowane w zasobniku o 24:00 — energia ponad T_in,
    // która nie została pobrana przez CWU (start zimny, model jednodobowy).
    const Q_residual = Math.max(T - T_in, 0) * m_zas * cw;

    return {
      hours,
      T_in,
      daily: {
        Q_heater:    dailyQ_heater,
        Q_saved:     dailyQ_saved,
        Q_strat:     dailyQ_strat,
        Q_wasted:    dailyQ_wasted,
        heaterHours: dailyHeaterOnHours,
        coveragePct,
        Q_residual,
        savingPLN:   savingPLN_d
      },
      monthly: {
        Q_saved:   dailyQ_saved * days,
        savingPLN: savingPLN_d * days
      },
      params: { heaterKW, tankL, UA }
    };
  };

})(window.PVSIM);
