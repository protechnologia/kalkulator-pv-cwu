/* =========================================================
   PV.SIM — Model fizyczny symulacji

   Zawiera funkcje obliczeniowe symulacji oraz kalkulator inwestycji.
   Optymalizacja (grid search, Moduł 08) → pv-sim.optimize.js.

   P.simulateDay(kWp, monthIdx, pvMode)
     Godzinowa produkcja PV. Wyznacza wysokość słońca (model Coopera 1969),
     przelicza przez model bezchmurny Hottela, a następnie skaluje wynik
     do średniej dobowej z PVGIS (tryb 'avg') lub do idealnego
     dnia słonecznego (tryb 'clear'). Zwraca tablicę 24 godzin + sumy.

   P.simulateDHW(residents, monthIdx, T_hot)
     Godzinowe zapotrzebowanie na ciepłą wodę użytkową dla N mieszkańców.
     Rozkłada dobową objętość wg znormalizowanego profilu godzinowego,
     oblicza energię użyteczną oraz straty cyrkulacji (procent energii
     użytecznej wg suwaka P.state.circLossPct — kotwice w P.CIRC_LOSS:
     stary budynek ~60%, nowy ~35%) i koszt całkowity przy aktualnej
     taryfie ECO.

   P.simulateTank(simPV, simDHW, heaterKW, tankL, T_init)
     Model zasobnika 1-węzłowego (fully-mixed) z 6 podkrokami na godzinę.
     Symuluje: pobór CWU (rozcieńczenie), grzanie parą PC + grzałka wg strategii
     wybranej osobno dla strefy dziennej i nocnej taryfy, straty postojowe.
     Para grzeje do wspólnego setpointu P.state.heaterTargetC („Temperatura
     docelowa zasobnika", suwak Modułu 04 — niezależny od T_hot z Modułu 02).
     Pompa ciepła (P.state.hpKW, hpGears, hpCOPSummer/Winter, hpOnlyBandC) ma
     priorytet w off-grid (wybiera największy bieg ≤ nadwyżki PV, grzałka dobiera
     resztę) oraz w on-grid pracuje sama w pasmie pod setpointem (bieg
     proporcjonalny do zapotrzebowania), poniżej pasma dochodzi grzałka.
     hpKW = 0 ⇒ PC wyłączona; heaterKW = 0 ⇒ grzałka wyłączona.
     Strategie: 'off', 'off-grid' (power diverter — moc do nadwyżki PV, grzeje
     tylko do setpointu), 'on-grid' (moc proporcjonalna, pobór z PV + sieci).
     Śledzi pokrycie CWU, oszczędności oraz zużycie energii rozbite na PV/sieć
     i grzałkę/PC.

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
     Kalkulator inwestycji — sumuje koszt instalacji PV, grzałki, pompy
     ciepła, zasobnika i automatyki + SCADA (ceny jednostkowe z P.state)
     oraz liczy zwrot inwestycji względem bilansu rocznego netto.

   P.dailyWeatherFactors(monthIdx, days)
     Deterministyczne mnożniki zmienności pogody dobowej — losują
     produkcję PV poszczególnych dób przy zachowanej średniej miesięcznej
     (PRNG ziarnowany per miesiąc, siła z P.state.pvVariability).
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
  // obliczona jako procent Q_użytecznej wg P.state.circLossPct (suwak,
  // kotwice 35%/60% z P.CIRC_LOSS).
  P.simulateDHW = function(residents, monthIdx, T_hot, params) {
    const ps = params || P.state;
    const priceKWh = ps.priceHeatGJ / P.KWH_PER_GJ;  // zł/kWh ciepła sieciowego
    const m = P.MONTHS[monthIdx];
    const T_in   = P.T_cold(monthIdx);
    const kwhM3  = P.kWh_per_m3(monthIdx, T_hot);
    const priceM3 = kwhM3 * priceKWh;
    const dailyM3 = (residents * P.DHW_L_PER_PERSON) / 1000;

    const Q_useful = dailyM3 * kwhM3;
    const circRatio = ps.circLossPct;
    const Q_circ = Q_useful * circRatio;       // kWh/dobę strat cyrkulacji
    const P_circ = Q_circ / 24;               // kW — stała moc strat przez całą dobę

    const hours = P.DHW_PROFILE.map((frac, h) => {
      const water  = dailyM3 * frac;         // m³/h (bo 1h)
      const energy = water * kwhM3;          // kWh w godzinie (użyteczna)
      const cost   = energy * priceKWh;
      return { hour: h, water, power: energy, energy, cost };
    });

    const Q_total = Q_useful + Q_circ;
    const cost_useful = Q_useful * priceKWh;
    const cost_circ   = Q_circ   * priceKWh;

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
  //                grzeje tylko do setpointu T_set, nadwyżka ponad to → Q_wasted
  //   'on-grid'  — moc proporcjonalna do (T_set - T)/BAND; nadwyżkę PV
  //                wykorzystujemy w pierwszej kolejności, resztę dobiera sieć
  // Temperatura startowa T_zas(00:00):
  //   T_init === undefined → start zimny = T_in (temp. wody wodociągowej),
  //   T_init podane         → ciągłość dobowa (Moduł 05 — symulacja miesięczna).
  P.simulateTank = function(simPV, simDHW, heaterKW, tankL, T_init, params) {
    const ps    = params || P.state;
    const cw    = P.C_WATER / 3600;                           // kWh/(kg·K)
    const m_zas = tankL;                                      // kg
    const UA    = P.TANK_UA_REF * Math.pow(tankL / P.TANK_V_REF, 2/3);  // W/K
    const UA_kWh = UA / 1000;                                // kWh/(K·h)
    const dt    = 1 / P.TANK_SUBSTEPS;

    const T_in  = simDHW.T_in;
    const T_set = ps.heaterTargetC;  // setpoint grzałki (Moduł 04)
    const band  = P.TANK_ONGRID_BAND;
    const threshold = ps.heaterThreshold * heaterKW;
    // Pompa ciepła — parametry sezonowe (COP zależny od miesiąca)
    const hpKW    = ps.hpKW;
    const hpGears = Math.max(1, ps.hpGears | 0);
    const hpBand  = ps.hpOnlyBandC;
    const mi      = ps.monthIdx;
    const hpCOP   = (mi >= 3 && mi <= 8) ? ps.hpCOPSummer : ps.hpCOPWinter;
    const hpStep  = hpKW / hpGears;       // moc elektryczna jednego biegu
    const hpThreshold = ps.heaterThreshold * hpKW;  // próg dla PC (wspólny ze grzałką)
    let T = (T_init === undefined ? T_in : T_init);
    const hours = [];

    // Przynależność godziny do strefy dziennej taryfy (Moduł 03)
    const dayStart = ps.gridDayStart, dayEnd = ps.gridDayEnd;
    const isDay = h => dayStart < dayEnd
      ? h >= dayStart && h < dayEnd
      : h >= dayStart || h < dayEnd;

    let dailyHeaterOnHours = 0;
    let dailyHpOnHours = 0;
    let dailyQ_heater = 0;
    let dailyQ_hp     = 0;
    let dailyQ_saved  = 0;
    let dailyQ_strat  = 0;
    let dailyQ_wasted = 0;
    let dailyElec_pv      = 0;   // tylko grzałka (jak dotąd)
    let dailyElec_grid    = 0;
    let dailyElec_hp_pv   = 0;
    let dailyElec_hp_grid = 0;
    let dailyGridCost  = 0;
    let dailyGridCost_heater = 0;
    let dailyGridCost_hp     = 0;

    for (let h = 0; h < 24; h++) {
      const T_start = T;
      const P_PV    = simPV.hours[h].power;
      const m_pobor = simDHW.hours[h].water * 1000;
      const day     = isDay(h);
      const strat   = day ? ps.heaterStratDay : ps.heaterStratNight;
      const gridPrice = day ? ps.gridPriceDay : ps.gridPriceNight;

      const m_per = m_pobor / P.TANK_SUBSTEPS;

      let Q_saved_h = 0, Q_strat_h = 0, Q_wasted_h = 0;
      let Q_heater_actual_h = 0, Q_hp_actual_h = 0;
      let elec_pv_h = 0,     elec_grid_h = 0;       // grzałka
      let elec_hp_pv_h = 0,  elec_hp_grid_h = 0;    // pompa ciepła
      let heaterOn = false, hpOn = false;

      for (let s = 0; s < P.TANK_SUBSTEPS; s++) {
        // 1) Pobór — oszczędność = ile mniej musi włożyć węzeł ECO (Δ od T_in)
        Q_saved_h += m_per * cw * Math.max(T - T_in, 0);
        if (m_per >= m_zas) {
          T = T_in;
        } else if (m_per > 0) {
          T = (T * (m_zas - m_per) + T_in * m_per) / m_zas;
        }

        // 2) Wyznaczenie mocy PC i grzałki dla tego podkroku wg strategii
        // Para PC + grzałka. PC ma priorytet (off-grid: pierwsza w kolejce PV;
        // on-grid: pasmo "tylko PC" wokół setpointu).
        let Q_hp_per = 0, hp_pvShare = 0;
        let Q_heater_per = 0, heater_pvShare = 0;
        const T_cap_pair = Math.min(T_set, P.TANK_T_MAX);  // wspólny cap = setpoint

        if (strat === 'off-grid') {
          // PC: największy bieg k taki, że (k/N)·hpKW ≤ P_PV oraz ≥ progu PC
          let P_hp_el = 0;
          if (hpKW > 0 && hpStep > 0 && P_PV > 0) {
            const k = Math.min(hpGears, Math.floor(P_PV / hpStep));
            if (k >= 1 && (k * hpStep) >= hpThreshold) {
              P_hp_el = k * hpStep;
            }
          }
          if (P_hp_el > 0) {
            Q_hp_per   = P_hp_el * hpCOP * dt;
            hp_pvShare = 1;
          }
          // Grzałka — z reszty PV (PC ma priorytet)
          const P_PV_left = Math.max(P_PV - P_hp_el, 0);
          if (heaterKW > 0 && P_PV_left >= threshold) {
            const P_h = Math.min(P_PV_left, heaterKW);
            Q_heater_per   = P_h * dt;
            heater_pvShare = 1;
          }
        } else if (strat === 'on-grid') {
          if (T < T_set) {
            if (hpKW > 0 && T >= T_set - hpBand) {
              // Pasmo "tylko PC" — bieg proporcjonalny do zapotrzebowania
              const req = hpBand > 0 ? (T_set - T) / hpBand : 1;
              const k = Math.max(1, Math.min(hpGears, Math.ceil(req * hpGears)));
              const P_hp_el = k * hpStep;
              Q_hp_per   = P_hp_el * hpCOP * dt;
              hp_pvShare = P_hp_el > 0 ? Math.min(P_hp_el, P_PV) / P_hp_el : 0;
            } else {
              // Poniżej pasma "tylko PC" (lub PC wyłączona) → PC top bieg + grzałka proporcjonalnie
              let P_hp_el = 0;
              if (hpKW > 0) {
                P_hp_el = hpKW;  // top bieg
                Q_hp_per   = P_hp_el * hpCOP * dt;
                hp_pvShare = P_hp_el > 0 ? Math.min(P_hp_el, P_PV) / P_hp_el : 0;
              }
              if (heaterKW > 0) {
                // Grzałka modulowana od dolnej krawędzi pasma "tylko PC" w dół
                const T_eff   = T_set - (hpKW > 0 ? hpBand : 0);
                const frac    = Math.max(0, Math.min(1, (T_eff - T) / band));
                const P_h_kW  = heaterKW * frac;
                if (P_h_kW > 0 && P_h_kW >= threshold) {
                  Q_heater_per = P_h_kW * dt;
                  const P_PV_left = Math.max(P_PV - P_hp_el, 0);
                  heater_pvShare = Math.min(P_h_kW, P_PV_left) / P_h_kW;
                }
              }
            }
          }
        }

        // 3a) Grzanie PC (priorytet — pierwsza wchodzi do zasobnika)
        if (Q_hp_per > 0) {
          const dT_full = Q_hp_per / (m_zas * cw);
          let T_after = T + dT_full;
          let Q_actual_th = Q_hp_per;
          if (T_after > T_cap_pair) {
            Q_actual_th = Math.max((T_cap_pair - T) * m_zas * cw, 0);
            Q_wasted_h += Math.max(Q_hp_per - Q_actual_th, 0);
            T_after = T_cap_pair;
          }
          if (Q_actual_th > 0) hpOn = true;
          const ratio = Q_hp_per > 0 ? Q_actual_th / Q_hp_per : 0;
          const Q_hp_el_actual = (Q_hp_per / hpCOP) * ratio;  // kWh elektr. faktyczne
          Q_hp_actual_h   += Q_actual_th;
          elec_hp_pv_h    += Q_hp_el_actual * hp_pvShare;
          elec_hp_grid_h  += Q_hp_el_actual * (1 - hp_pvShare);
          T = T_after;
        }

        // 3b) Grzanie grzałką (po PC)
        if (Q_heater_per > 0) {
          const dT_full = Q_heater_per / (m_zas * cw);
          let T_after = T + dT_full;
          let Q_actual = Q_heater_per;
          if (T_after > T_cap_pair) {
            Q_actual = Math.max((T_cap_pair - T) * m_zas * cw, 0);
            Q_wasted_h += Math.max(Q_heater_per - Q_actual, 0);
            T_after = T_cap_pair;
          }
          if (Q_actual > 0) heaterOn = true;
          Q_heater_actual_h += Q_actual;
          elec_pv_h   += Q_actual * heater_pvShare;
          elec_grid_h += Q_actual * (1 - heater_pvShare);
          T = T_after;
        }

        // 4) Straty postojowe (do otoczenia)
        const Q_loss = UA_kWh * Math.max(T - P.TANK_T_AMB, 0) * dt;
        Q_strat_h += Q_loss;
        T = Math.max(T - Q_loss / (m_zas * cw), T_in);
      }

      const elec_pair_pv_h   = elec_pv_h + elec_hp_pv_h;
      const elec_pair_grid_h = elec_grid_h + elec_hp_grid_h;

      hours.push({
        hour: h,
        T_start, T_end: T,
        heaterOn, hpOn,
        day,
        strategy: strat,
        P_heater_eff: Q_heater_actual_h,
        Q_heater:     Q_heater_actual_h,
        Q_hp:         Q_hp_actual_h,
        Q_saved: Q_saved_h,
        Q_strat: Q_strat_h,
        Q_wasted: Q_wasted_h,
        // Grzałka osobno (kompatybilność wstecz dla wykresów dobowego stosu)
        elec_pv: elec_pv_h,
        elec_grid: elec_grid_h,
        // PC osobno
        elec_hp_pv: elec_hp_pv_h,
        elec_hp_grid: elec_hp_grid_h,
        // Para łącznie (PC + grzałka) — dla wykresów M05/M06
        elec_pair_pv:   elec_pair_pv_h,
        elec_pair_grid: elec_pair_grid_h
      });

      if (heaterOn) dailyHeaterOnHours++;
      if (hpOn)     dailyHpOnHours++;
      dailyQ_heater     += Q_heater_actual_h;
      dailyQ_hp         += Q_hp_actual_h;
      dailyQ_saved      += Q_saved_h;
      dailyQ_strat      += Q_strat_h;
      dailyQ_wasted     += Q_wasted_h;
      dailyElec_pv      += elec_pv_h;
      dailyElec_grid    += elec_grid_h;
      dailyElec_hp_pv   += elec_hp_pv_h;
      dailyElec_hp_grid += elec_hp_grid_h;
      dailyGridCost_heater += elec_grid_h * gridPrice;
      dailyGridCost_hp     += elec_hp_grid_h * gridPrice;
      dailyGridCost        += (elec_grid_h + elec_hp_grid_h) * gridPrice;
    }

    // Pokrycie liczone względem Q_total (użyteczna + cyrkulacja) — to jest
    // rachunek starego ECO, który zastępujemy. Cyrkulacja w obecnym modelu
    // pozostaje wpięta do starego węzła ECO; przy przepięciu trasy do naszego
    // zasobnika mianownik powinien wrócić do Q_useful (osobne TODO).
    const Q_CWU_total = simDHW.daily.totalEnergy;
    const coveragePct = Q_CWU_total > 0 ? (dailyQ_saved / Q_CWU_total * 100) : 0;
    const priceKWh = ps.priceHeatGJ / P.KWH_PER_GJ;
    const savingPLN_d = dailyQ_saved * priceKWh;
    const days = P.MONTHS[mi].days;

    // Ciepło zmagazynowane w zasobniku o 24:00 — energia ponad T_in,
    // która nie została pobrana przez CWU (start zimny, model jednodobowy).
    const Q_residual = Math.max(T - T_in, 0) * m_zas * cw;

    return {
      hours,
      T_in,
      T_end: T,
      daily: {
        Q_heater:    dailyQ_heater,
        Q_hp:        dailyQ_hp,
        Q_saved:     dailyQ_saved,
        Q_strat:     dailyQ_strat,
        Q_wasted:    dailyQ_wasted,
        heaterHours: dailyHeaterOnHours,
        hpHours:     dailyHpOnHours,
        coveragePct,
        Q_residual,
        savingPLN:   savingPLN_d,
        elec_pv:     dailyElec_pv,
        elec_grid:   dailyElec_grid,
        elec_total:  dailyElec_pv + dailyElec_grid,
        elec_hp_pv:    dailyElec_hp_pv,
        elec_hp_grid:  dailyElec_hp_grid,
        elec_hp_total: dailyElec_hp_pv + dailyElec_hp_grid,
        elec_pair_pv:    dailyElec_pv + dailyElec_hp_pv,
        elec_pair_grid:  dailyElec_grid + dailyElec_hp_grid,
        elec_pair_total: dailyElec_pv + dailyElec_grid + dailyElec_hp_pv + dailyElec_hp_grid,
        gridCost:    dailyGridCost,
        gridCost_heater: dailyGridCost_heater,
        gridCost_hp:     dailyGridCost_hp
      },
      monthly: {
        Q_saved:   dailyQ_saved * days,
        Q_hp:      dailyQ_hp * days,
        Q_heater:  dailyQ_heater * days,
        savingPLN: savingPLN_d * days,
        elec_pv:    dailyElec_pv   * days,
        elec_grid:  dailyElec_grid * days,
        elec_total: (dailyElec_pv + dailyElec_grid) * days,
        elec_hp_pv:    dailyElec_hp_pv * days,
        elec_hp_grid:  dailyElec_hp_grid * days,
        elec_pair_pv:    (dailyElec_pv + dailyElec_hp_pv) * days,
        elec_pair_grid:  (dailyElec_grid + dailyElec_hp_grid) * days,
        elec_pair_total: (dailyElec_pv + dailyElec_grid + dailyElec_hp_pv + dailyElec_hp_grid) * days,
        gridCost:   dailyGridCost  * days,
        gridCost_heater: dailyGridCost_heater * days,
        gridCost_hp:     dailyGridCost_hp * days
      },
      params: { heaterKW, tankL, UA, hpKW, hpCOP, hpGears }
    };
  };

  // ===== ZMIENNOŚĆ POGODY DOBOWEJ (Moduł 05/06) =====
  // Deterministyczny generator pseudolosowy (mulberry32) — ten sam wzorzec
  // dni przy każdym renderze, dzięki czemu przesunięcie suwaka tylko skaluje
  // rozrzut, a doby się nie tasują.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function() {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Cache na g_max per miesiąc (zależy tylko od monthIdx, LAT i stałych).
  const _gMaxCache = [];
  function gMaxForMonth(monthIdx) {
    if (_gMaxCache[monthIdx] === undefined) {
      const clearDaily = P.simulateDay(1, monthIdx, 'clear').daily;
      const avgDaily   = P.simulateDay(1, monthIdx, 'avg').daily;
      _gMaxCache[monthIdx] = avgDaily > 0 ? clearDaily / avgDaily : 1;
    }
    return _gMaxCache[monthIdx];
  }

  // Zwraca tablicę dobowych mnożników produkcji PV dla danego miesiąca.
  //   mean(g) = 1 dokładnie (zachowana średnia miesięczna),
  //   g[d] ∈ [0, g_max], gdzie g_max = clear-sky / avg danego miesiąca.
  // Siłę rozrzutu reguluje P.state.pvVariability ∈ [0,1]:
  //   0 → wszystkie dni identyczne (g[d]=1), 1 → pełny rozrzut [0, g_max].
  // Surowa czystość = r^p, gdzie p = g_max−1, więc E[r^p] = mu — rozkład sięga
  // od dni bez słońca (r≈0) po dni clear-sky (r≈1) przy zachowanej średniej.
  P.dailyWeatherFactors = function(monthIdx, days, params) {
    const ps   = params || P.state;
    const gMax = gMaxForMonth(monthIdx);
    const mu   = gMax > 0 ? 1 / gMax : 1;          // średnia "czystość nieba" [0..1]
    const p    = Math.max(0, gMax - 1);            // wykładnik: E[r^p] = mu
    const s    = Math.max(0, Math.min(1, ps.pvVariability));
    const rng  = mulberry32(P.WEATHER_SEED + monthIdx);

    // 1) Surowe czystości v ∈ [0,1] — przy s=0 wszystkie równe mu.
    const v = [];
    let vSum = 0;
    for (let d = 0; d < days; d++) {
      const raw = Math.pow(rng(), p);
      const val = (1 - s) * mu + s * raw;
      v.push(val);
      vSum += val;
    }
    const vMean = days > 0 ? vSum / days : mu;

    // 2) Korekta do dokładnej średniej mu (blend monotoniczny, zakres [0,1]).
    const factors = [];
    for (let d = 0; d < days; d++) {
      let k;
      if (vMean <= mu) {
        k = vMean < 1
          ? v[d] + (mu - vMean) / (1 - vMean) * (1 - v[d])
          : mu;
      } else {
        k = v[d] * (mu / vMean);
      }
      factors.push(mu > 0 ? k / mu : 1);           // g[d] = k/mu → mean(g)=1
    }
    return factors;
  };

  // ===== SYMULACJA MIESIĘCZNA ZASOBNIKA (Moduł 05) =====
  // Symulacja ciągła przez cały miesiąc: pierwsza doba startuje zimna (T_in),
  // każda następna dziedziczy temperaturę końcową poprzedniej. Profil CWU jest
  // taki sam dla każdej doby, natomiast produkcja PV jest skalowana dobowym
  // mnożnikiem zmienności pogody (P.dailyWeatherFactors) — średnia miesięczna
  // pozostaje zachowana. Temperatura zasobnika przenosi się między dobami.
  P.simulateTankMonth = function(simPV, simDHW, heaterKW, tankL, monthIdx, params) {
    const ps    = params || P.state;
    const mi    = (monthIdx === undefined ? ps.monthIdx : monthIdx);
    const days  = P.MONTHS[mi].days;
    const priceKWh = ps.priceHeatGJ / P.KWH_PER_GJ;
    const T_in  = simDHW.T_in;
    const hours = [];
    // Podparams z faktycznie symulowanym miesiącem — żeby simulateTank brał COP
    // i dni z bieżącego mi, nie z monthIdx z UI.
    const psMonth = (ps.monthIdx === mi) ? ps : Object.assign({}, ps, { monthIdx: mi });

    const daysData = [];   // agregaty na dobę — wykres dobowy energii (Moduł 05)
    const factors = P.dailyWeatherFactors(mi, days, ps);  // dobowe mnożniki PV
    let T = T_in;  // start zimny
    let lastDayResidual = 0;
    let monthQ_saved = 0, monthQ_strat = 0;
    let monthQ_hp = 0, monthQ_heater = 0;
    let monthElec_pv = 0, monthElec_grid = 0;
    let monthElec_hp_pv = 0, monthElec_hp_grid = 0;
    let monthGridCost = 0, monthHeaterHours = 0, monthHpHours = 0;
    // Pokrycie dobowe — min/max % w miesiącu. Q_CWU/dobę jest stałe
    // (z profilu DHW), więc % to po prostu Q_saved/Q_CWU dla każdej doby.
    // Pierwsza doba startuje zimna ("warmup") i pokrycie jest sztucznie
    // niskie, więc do min/max bierzemy dni 1..N-1 (gdy days >= 2).
    // Mianownik = Q_total (użyteczna + cyrkulacja), por. komentarz w simulateTank.
    const Q_CWU_day = simDHW.daily.totalEnergy;
    let coverMinPct = Infinity, coverMaxPct = -Infinity;

    for (let d = 0; d < days; d++) {
      const g = factors[d];
      const dayPV = { hours: simPV.hours.map(h => ({
        hour: h.hour, power: h.power * g, energy: h.energy * g
      })) };
      const day = P.simulateTank(dayPV, simDHW, heaterKW, tankL, T, psMonth);
      day.hours.forEach(h => {
        hours.push(Object.assign({}, h, { day: d, gh: d * 24 + h.hour }));
      });
      T = day.T_end;
      lastDayResidual = day.daily.Q_residual;
      daysData.push({
        day:       d,
        elec_pv:        day.daily.elec_pv,
        elec_grid:      day.daily.elec_grid,
        elec_hp_pv:     day.daily.elec_hp_pv,
        elec_hp_grid:   day.daily.elec_hp_grid,
        elec_pair_pv:   day.daily.elec_pair_pv,
        elec_pair_grid: day.daily.elec_pair_grid,
        gridCost:  day.daily.gridCost
      });
      monthQ_saved     += day.daily.Q_saved;
      monthQ_strat     += day.daily.Q_strat;
      monthQ_hp        += day.daily.Q_hp;
      monthQ_heater    += day.daily.Q_heater;
      monthElec_pv     += day.daily.elec_pv;
      monthElec_grid   += day.daily.elec_grid;
      monthElec_hp_pv  += day.daily.elec_hp_pv;
      monthElec_hp_grid+= day.daily.elec_hp_grid;
      monthGridCost    += day.daily.gridCost;
      monthHeaterHours += day.daily.heaterHours;
      monthHpHours     += day.daily.hpHours;

      // min/max pokrycia dobowego — pomijamy dobę 0 (warmup ze startu zimnego),
      // chyba że miesiąc miałby tylko 1 dobę (defensywnie)
      if (Q_CWU_day > 0.001 && (d > 0 || days < 2)) {
        const pct = day.daily.Q_saved / Q_CWU_day * 100;
        if (pct < coverMinPct) coverMinPct = pct;
        if (pct > coverMaxPct) coverMaxPct = pct;
      }
    }

    if (coverMinPct === Infinity) { coverMinPct = 0; coverMaxPct = 0; }

    const Q_CWU_month = simDHW.daily.totalEnergy * days;
    const coveragePct = Q_CWU_month > 0 ? (monthQ_saved / Q_CWU_month * 100) : 0;

    return {
      hours,
      daysData,
      days,
      T_in,
      monthly: {
        Q_saved:     monthQ_saved,
        Q_strat:     monthQ_strat,
        Q_residual:  lastDayResidual,
        Q_hp:        monthQ_hp,
        Q_heater:    monthQ_heater,
        coveragePct,
        coverMinPct,
        coverMaxPct,
        heaterHours: monthHeaterHours,
        hpHours:     monthHpHours,
        savingPLN:   monthQ_saved * priceKWh,
        elec_pv:     monthElec_pv,
        elec_grid:   monthElec_grid,
        elec_total:  monthElec_pv + monthElec_grid,
        elec_hp_pv:    monthElec_hp_pv,
        elec_hp_grid:  monthElec_hp_grid,
        elec_pair_pv:   monthElec_pv + monthElec_hp_pv,
        elec_pair_grid: monthElec_grid + monthElec_hp_grid,
        elec_pair_total: monthElec_pv + monthElec_grid + monthElec_hp_pv + monthElec_hp_grid,
        gridCost:    monthGridCost,
        // bilans: oszczędność na cieple sieciowym − koszt energii z sieci
        balancePLN:  monthQ_saved * priceKWh - monthGridCost
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
  P.simulateTankYear = function(params) {
    const ps = params || P.state;
    const monthsData = [];
    let elec_pv = 0, elec_grid = 0, gridCost = 0;
    let elec_hp_pv = 0, elec_hp_grid = 0;
    let Q_hp = 0, Q_heater = 0;
    let savingPLN = 0, Q_saved = 0, Q_strat = 0, Q_CWU = 0;
    let heaterHours = 0, hpHours = 0, balancePLN = 0;
    let Q_residual_dec = 0;

    for (let mi = 0; mi < 12; mi++) {
      const days   = P.MONTHS[mi].days;
      // Symulacja roczna zawsze korzysta z doby przeciętnej PV (PVGIS), nie z trybu clear-sky
      const simPV  = P.simulateDay(ps.kWp, mi, 'avg');
      const simDHW = P.simulateDHW(ps.residents, mi, ps.T_hot, ps);
      const simMonth = P.simulateTankMonth(simPV, simDHW, ps.heaterKW, ps.tankL, mi, ps);
      const mo = simMonth.monthly;
      const cwu_m = simDHW.daily.totalEnergy * days;

      monthsData.push({
        monthIdx:    mi,
        abbr:        P.MONTHS[mi].abbr,
        elec_pv:     mo.elec_pv,
        elec_grid:   mo.elec_grid,
        elec_total:  mo.elec_total,
        elec_hp_pv:    mo.elec_hp_pv,
        elec_hp_grid:  mo.elec_hp_grid,
        elec_pair_pv:   mo.elec_pair_pv,
        elec_pair_grid: mo.elec_pair_grid,
        elec_pair_total: mo.elec_pair_total,
        Q_hp:        mo.Q_hp,
        Q_heater:    mo.Q_heater,
        gridCost:    mo.gridCost,
        savingPLN:   mo.savingPLN,
        Q_saved:     mo.Q_saved,
        Q_strat:     mo.Q_strat,
        heaterHours: mo.heaterHours,
        hpHours:     mo.hpHours,
        balancePLN:  mo.balancePLN,
        Q_CWU:       cwu_m,
        coverMinPct: mo.coverMinPct,
        coverMaxPct: mo.coverMaxPct
      });

      elec_pv     += mo.elec_pv;
      elec_grid   += mo.elec_grid;
      elec_hp_pv  += mo.elec_hp_pv;
      elec_hp_grid+= mo.elec_hp_grid;
      Q_hp        += mo.Q_hp;
      Q_heater    += mo.Q_heater;
      gridCost    += mo.gridCost;
      savingPLN   += mo.savingPLN;
      Q_saved     += mo.Q_saved;
      Q_strat     += mo.Q_strat;
      heaterHours += mo.heaterHours;
      hpHours     += mo.hpHours;
      balancePLN  += mo.balancePLN;
      Q_CWU       += cwu_m;
      Q_residual_dec = mo.Q_residual;  // ciepło zmagazynowane na koniec roku = koniec grudnia
    }

    return {
      monthsData,
      yearly: {
        elec_pv,
        elec_grid,
        elec_total:  elec_pv + elec_grid,
        elec_hp_pv,
        elec_hp_grid,
        elec_pair_pv:    elec_pv + elec_hp_pv,
        elec_pair_grid:  elec_grid + elec_hp_grid,
        elec_pair_total: elec_pv + elec_grid + elec_hp_pv + elec_hp_grid,
        Q_hp,
        Q_heater,
        gridCost,
        savingPLN,
        Q_saved,
        Q_strat,
        Q_residual:  Q_residual_dec,
        heaterHours,
        hpHours,
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
  P.computeInvestment = function(simYear, params) {
    const s = params || P.state;
    const costPV     = s.kWp * s.pricePVkWp;
    const costHeater = s.heaterKW * s.priceHeaterKW;
    const costTank   = (s.tankL / 100) * s.priceTank100;
    const costScada  = s.priceScada;
    const copAvg     = (s.hpCOPSummer + s.hpCOPWinter) / 2;
    const costHP     = s.hpKW * copAvg * s.priceHPkWth;
    const total      = costPV + costHeater + costHP + costTank + costScada;
    const annual     = simYear.yearly.balancePLN;
    const paybackYears = annual > 0 ? total / annual : Infinity;
    return { costPV, costHeater, costHP, costTank, costScada, total, annual, paybackYears };
  };

  // Optymalizacja (Moduł 08) wydzielona do pv-sim.optimize.js
  // — używa P.simulateTankYear() i P.computeInvestment() z tego pliku.

})(window.PVSIM);
