/* =========================================================
   PV.SIM — Model fizyczny symulacji

   Zawiera cztery główne funkcje obliczeniowe:

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
     Symuluje: pobór CWU (rozcieńczenie), grzanie grzałką wg strategii
     wybranej osobno dla strefy dziennej i nocnej taryfy, straty postojowe.
     Strategie: 'off' (wyłączona), 'off-grid' (power diverter — moc do nadwyżki
     PV, grzeje tylko do T_hot), 'on-grid' (moc proporcjonalna do T_hot,
     pobór z PV + sieci).
     Śledzi pokrycie CWU, oszczędności oraz zużycie energii (PV vs sieć).

   P.simulateTankMonth(simPV, simDHW, heaterKW, tankL, monthIdx)
     Ciągła symulacja zasobnika przez cały miesiąc — wywołuje
     P.simulateTank() raz na dobę, przekazując temperaturę końcową
     poprzedniej doby jako startową kolejnej (5. parametr T_init).
     Zwraca dobowe szeregi czasowe i zagregowane statystyki miesięczne.

   P.simulateTankYear()
     Symulacja roczna — wywołuje P.simulateTankMonth() dla każdego z 12
     miesięcy z osobnymi wejściami PV i CWU. Zwraca agregaty miesięczne
     (do wykresu słupkowego) oraz sumy roczne.

   P.computeInvestment(simYear)
     Kalkulator inwestycji — sumuje koszt instalacji PV, grzałki,
     zasobnika i automatyki + SCADA (ceny jednostkowe z P.state) oraz
     liczy zwrot inwestycji względem bilansu rocznego netto.
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
  // Strategia grzałki wybierana osobno dla strefy dziennej i nocnej taryfy:
  //   'off'      — grzałka wyłączona
  //   'off-grid' — moc throttlowana do nadwyżki PV (power diverter), energia z PV;
  //                grzeje tylko do setpointu T_hot, nadwyżka ponad to → Q_wasted
  //   'on-grid'  — moc proporcjonalna do (T_hot - T)/BAND; nadwyżkę PV
  //                wykorzystujemy w pierwszej kolejności, resztę dobiera sieć
  // Temperatura startowa T_zas(00:00):
  //   T_init === undefined → start zimny = T_in (temp. wody wodociągowej),
  //   T_init podane         → ciągłość dobowa (Moduł 05 — symulacja miesięczna).
  P.simulateTank = function(simPV, simDHW, heaterKW, tankL, T_init) {
    const cw    = P.C_WATER / 3600;                           // kWh/(kg·K)
    const m_zas = tankL;                                      // kg
    const UA    = P.TANK_UA_REF * Math.pow(tankL / P.TANK_V_REF, 2/3);  // W/K
    const UA_kWh = UA / 1000;                                // kWh/(K·h)
    const dt    = 1 / P.TANK_SUBSTEPS;

    const T_in  = simDHW.T_in;
    const T_hot = P.state.T_hot;
    const band  = P.TANK_ONGRID_BAND;
    const threshold = P.state.heaterThreshold * heaterKW;
    let T = (T_init === undefined ? T_in : T_init);
    const hours = [];

    // Przynależność godziny do strefy dziennej taryfy (Moduł 03)
    const dayStart = P.state.gridDayStart, dayEnd = P.state.gridDayEnd;
    const isDay = h => dayStart < dayEnd
      ? h >= dayStart && h < dayEnd
      : h >= dayStart || h < dayEnd;

    let dailyHeaterOnHours = 0;
    let dailyQ_heater = 0;
    let dailyQ_saved  = 0;
    let dailyQ_strat  = 0;
    let dailyQ_wasted = 0;
    let dailyElec_pv   = 0;
    let dailyElec_grid = 0;
    let dailyGridCost  = 0;

    for (let h = 0; h < 24; h++) {
      const T_start = T;
      const P_PV    = simPV.hours[h].power;
      const m_pobor = simDHW.hours[h].water * 1000;
      const day     = isDay(h);
      const strat   = day ? P.state.heaterStratDay : P.state.heaterStratNight;
      const gridPrice = day ? P.state.gridPriceDay : P.state.gridPriceNight;

      const m_per = m_pobor / P.TANK_SUBSTEPS;

      let Q_saved_h = 0, Q_strat_h = 0, Q_wasted_h = 0, Q_heater_actual_h = 0;
      let elec_pv_h = 0, elec_grid_h = 0;
      let heaterOn = false;

      for (let s = 0; s < P.TANK_SUBSTEPS; s++) {
        // 1) Pobór — oszczędność = ile mniej musi włożyć węzeł ECO (Δ od T_in)
        Q_saved_h += m_per * cw * Math.max(T - T_in, 0);
        if (m_per >= m_zas) {
          T = T_in;
        } else if (m_per > 0) {
          T = (T * (m_zas - m_per) + T_in * m_per) / m_zas;
        }

        // 2) Wyznaczenie mocy grzałki dla tego podkroku wg strategii
        let Q_per = 0;    // docelowa energia podkroku [kWh]
        let pvShare = 0;  // udział PV w tej energii [0..1]
        let T_cap = P.TANK_T_MAX;  // pułap grzania dla tego podkroku
        if (strat === 'off-grid') {
          // diverter grzeje tylko do setpointu T_hot (nie wyżej niż termostat)
          T_cap = Math.min(T_hot, P.TANK_T_MAX);
          if (P_PV >= threshold) {
            Q_per   = Math.min(P_PV, heaterKW) * dt;
            pvShare = 1;
          }
        } else if (strat === 'on-grid') {
          const frac = Math.max(0, Math.min(1, (T_hot - T) / band));
          const Q_kW = heaterKW * frac;
          if (Q_kW > 0) {
            Q_per   = Q_kW * dt;
            pvShare = Math.min(Q_kW, P_PV) / Q_kW;
          }
        }

        // 3) Grzanie (z termostatem T_MAX)
        if (Q_per > 0) {
          heaterOn = true;
          const dT_full = Q_per / (m_zas * cw);
          let T_after = T + dT_full;
          let Q_actual;
          if (T_after > T_cap) {
            Q_actual = Math.max((T_cap - T) * m_zas * cw, 0);
            Q_wasted_h += Math.max(Q_per - Q_actual, 0);
            T_after = T_cap;
          } else {
            Q_actual = Q_per;
          }
          Q_heater_actual_h += Q_actual;
          elec_pv_h   += Q_actual * pvShare;
          elec_grid_h += Q_actual * (1 - pvShare);
          T = T_after;
        }

        // 4) Straty postojowe (do otoczenia)
        const Q_loss = UA_kWh * Math.max(T - P.TANK_T_AMB, 0) * dt;
        Q_strat_h += Q_loss;
        T = Math.max(T - Q_loss / (m_zas * cw), T_in);
      }

      hours.push({
        hour: h,
        T_start, T_end: T,
        heaterOn,
        day,
        strategy: strat,
        P_heater_eff: Q_heater_actual_h,
        Q_saved: Q_saved_h,
        Q_strat: Q_strat_h,
        Q_wasted: Q_wasted_h,
        elec_pv: elec_pv_h,
        elec_grid: elec_grid_h
      });

      if (heaterOn) dailyHeaterOnHours++;
      dailyQ_heater  += Q_heater_actual_h;
      dailyQ_saved   += Q_saved_h;
      dailyQ_strat   += Q_strat_h;
      dailyQ_wasted  += Q_wasted_h;
      dailyElec_pv   += elec_pv_h;
      dailyElec_grid += elec_grid_h;
      dailyGridCost  += elec_grid_h * gridPrice;
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
      T_end: T,
      daily: {
        Q_heater:    dailyQ_heater,
        Q_saved:     dailyQ_saved,
        Q_strat:     dailyQ_strat,
        Q_wasted:    dailyQ_wasted,
        heaterHours: dailyHeaterOnHours,
        coveragePct,
        Q_residual,
        savingPLN:   savingPLN_d,
        elec_pv:     dailyElec_pv,
        elec_grid:   dailyElec_grid,
        elec_total:  dailyElec_pv + dailyElec_grid,
        gridCost:    dailyGridCost
      },
      monthly: {
        Q_saved:   dailyQ_saved * days,
        savingPLN: savingPLN_d * days,
        elec_pv:    dailyElec_pv   * days,
        elec_grid:  dailyElec_grid * days,
        elec_total: (dailyElec_pv + dailyElec_grid) * days,
        gridCost:   dailyGridCost  * days
      },
      params: { heaterKW, tankL, UA }
    };
  };

  // ===== SYMULACJA MIESIĘCZNA ZASOBNIKA (Moduł 05) =====
  // Symulacja ciągła przez cały miesiąc: pierwsza doba startuje zimna (T_in),
  // każda następna dziedziczy temperaturę końcową poprzedniej. Wejścia PV i CWU
  // są takie same dla każdej doby — jedyne, co przenosi się między dobami, to
  // temperatura zasobnika, więc po kilku dobach układ wchodzi w stan ustalony.
  P.simulateTankMonth = function(simPV, simDHW, heaterKW, tankL, monthIdx) {
    const mi    = (monthIdx === undefined ? P.state.monthIdx : monthIdx);
    const days  = P.MONTHS[mi].days;
    const T_in  = simDHW.T_in;
    const hours = [];

    const daysData = [];   // agregaty na dobę — wykres dobowy energii (Moduł 05)
    let T = T_in;  // start zimny
    let monthQ_saved = 0, monthQ_strat = 0;
    let monthElec_pv = 0, monthElec_grid = 0;
    let monthGridCost = 0, monthHeaterHours = 0;

    for (let d = 0; d < days; d++) {
      const day = P.simulateTank(simPV, simDHW, heaterKW, tankL, T);
      day.hours.forEach(h => {
        hours.push(Object.assign({}, h, { day: d, gh: d * 24 + h.hour }));
      });
      T = day.T_end;
      daysData.push({
        day:       d,
        elec_pv:   day.daily.elec_pv,
        elec_grid: day.daily.elec_grid,
        gridCost:  day.daily.gridCost
      });
      monthQ_saved     += day.daily.Q_saved;
      monthQ_strat     += day.daily.Q_strat;
      monthElec_pv     += day.daily.elec_pv;
      monthElec_grid   += day.daily.elec_grid;
      monthGridCost    += day.daily.gridCost;
      monthHeaterHours += day.daily.heaterHours;
    }

    const Q_CWU_month = simDHW.daily.energy * days;
    const coveragePct = Q_CWU_month > 0 ? (monthQ_saved / Q_CWU_month * 100) : 0;

    return {
      hours,
      daysData,
      days,
      T_in,
      monthly: {
        Q_saved:     monthQ_saved,
        Q_strat:     monthQ_strat,
        coveragePct,
        heaterHours: monthHeaterHours,
        savingPLN:   monthQ_saved * P.PRICE_PER_KWH,
        elec_pv:     monthElec_pv,
        elec_grid:   monthElec_grid,
        elec_total:  monthElec_pv + monthElec_grid,
        gridCost:    monthGridCost,
        // bilans: oszczędność na cieple sieciowym − koszt energii z sieci
        balancePLN:  monthQ_saved * P.PRICE_PER_KWH - monthGridCost
      },
      params: { heaterKW, tankL }
    };
  };

  // ===== SYMULACJA ROCZNA ZASOBNIKA (Moduł 06) =====
  // Uruchamia symulację miesięczną P.simulateTankMonth() dla każdego z 12
  // miesięcy. Każdy miesiąc liczony jest niezależnie (start zimny w 1. dobie),
  // z własnymi wejściami PV i CWU — produkcja PV oraz temperatura wody zimnej
  // zmieniają się sezonowo. Zwraca agregaty miesięczne (jeden wpis na miesiąc,
  // do wykresu słupkowego) oraz sumy roczne.
  P.simulateTankYear = function() {
    const monthsData = [];
    let elec_pv = 0, elec_grid = 0, gridCost = 0;
    let savingPLN = 0, Q_saved = 0, Q_strat = 0, Q_CWU = 0;
    let heaterHours = 0, balancePLN = 0;

    for (let mi = 0; mi < 12; mi++) {
      const days   = P.MONTHS[mi].days;
      const simPV  = P.simulateDay(P.state.kWp, mi, P.state.pvMode);
      const simDHW = P.simulateDHW(P.state.residents, mi, P.state.T_hot);
      const simMonth = P.simulateTankMonth(simPV, simDHW, P.state.heaterKW, P.state.tankL, mi);
      const mo = simMonth.monthly;
      const cwu_m = simDHW.daily.energy * days;

      monthsData.push({
        monthIdx:    mi,
        abbr:        P.MONTHS[mi].abbr,
        elec_pv:     mo.elec_pv,
        elec_grid:   mo.elec_grid,
        elec_total:  mo.elec_total,
        gridCost:    mo.gridCost,
        savingPLN:   mo.savingPLN,
        Q_saved:     mo.Q_saved,
        Q_strat:     mo.Q_strat,
        heaterHours: mo.heaterHours,
        balancePLN:  mo.balancePLN,
        Q_CWU:       cwu_m
      });

      elec_pv     += mo.elec_pv;
      elec_grid   += mo.elec_grid;
      gridCost    += mo.gridCost;
      savingPLN   += mo.savingPLN;
      Q_saved     += mo.Q_saved;
      Q_strat     += mo.Q_strat;
      heaterHours += mo.heaterHours;
      balancePLN  += mo.balancePLN;
      Q_CWU       += cwu_m;
    }

    return {
      monthsData,
      yearly: {
        elec_pv,
        elec_grid,
        elec_total:  elec_pv + elec_grid,
        gridCost,
        savingPLN,
        Q_saved,
        Q_strat,
        heaterHours,
        balancePLN,
        coveragePct: Q_CWU > 0 ? (Q_saved / Q_CWU * 100) : 0
      }
    };
  };

  // ===== KALKULATOR INWESTYCJI (Moduł 07) =====
  // Sumuje koszt całej inwestycji z czterech pozycji: instalacja PV,
  // grzałki, zasobnik i automatyka + SCADA. Ceny jednostkowe pochodzą
  // z P.state (suwaki Modułu 07), mnożniki — z modułów 01/04.
  // Zwrot inwestycji liczony względem bilansu rocznego netto
  // (oszczędność na cieple − koszt prądu z sieci). Gdy bilans ≤ 0,
  // paybackYears = Infinity (brak zwrotu).
  P.computeInvestment = function(simYear) {
    const s = P.state;
    const costPV     = s.kWp * s.pricePVkWp;
    const costHeater = s.heaterKW * s.priceHeaterKW;
    const costTank   = (s.tankL / 100) * s.priceTank100;
    const costScada  = s.priceScada;
    const total      = costPV + costHeater + costTank + costScada;
    const annual     = simYear.yearly.balancePLN;
    const paybackYears = annual > 0 ? total / annual : Infinity;
    return { costPV, costHeater, costTank, costScada, total, annual, paybackYears };
  };

})(window.PVSIM);
