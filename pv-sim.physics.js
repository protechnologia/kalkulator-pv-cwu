/* =========================================================
   PV.SIM — Model fizyczny symulacji

   Zawiera funkcje obliczeniowe symulacji oraz optymalizacji:

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

   P.simulateTank(simPV, simDHW, heaterKW, tankL, T_init)
     Model zasobnika 1-węzłowego (fully-mixed) z 6 podkrokami na godzinę.
     Symuluje: pobór CWU (rozcieńczenie), grzanie grzałką wg strategii
     wybranej osobno dla strefy dziennej i nocnej taryfy, straty postojowe.
     Grzałka grzeje do setpointu P.state.heaterTargetC (suwak Modułu 04,
     niezależny od T_hot z Modułu 02).
     Strategie: 'off' (wyłączona), 'off-grid' (power diverter — moc do nadwyżki
     PV, grzeje tylko do setpointu), 'on-grid' (moc proporcjonalna do różnicy
     setpoint − T, pobór z PV + sieci).
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

   P.optimize(maxPayback, lifetime, onProgress)
     Grid search (Moduł 08) — przeszukuje siatkę P.OPT_GRID po mocy PV,
     mocy grzałki, progu, pojemności zasobnika, temperaturze grzania
     i strategiach dzień/noc. Asynchroniczny (porcje + setTimeout 0,
     callback postępu). Zwraca Promise z 3 najlepszymi wariantami wg
     zysku netto za cały okres życia inwestycji.

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
  //                grzeje tylko do setpointu T_set, nadwyżka ponad to → Q_wasted
  //   'on-grid'  — moc proporcjonalna do (T_set - T)/BAND; nadwyżkę PV
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
    const T_set = P.state.heaterTargetC;  // setpoint grzałki (Moduł 04)
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
          // diverter grzeje tylko do setpointu T_set (nie wyżej niż termostat)
          T_cap = Math.min(T_set, P.TANK_T_MAX);
          if (P_PV >= threshold) {
            Q_per   = Math.min(P_PV, heaterKW) * dt;
            pvShare = 1;
          }
        } else if (strat === 'on-grid') {
          const frac = Math.max(0, Math.min(1, (T_set - T) / band));
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
  P.dailyWeatherFactors = function(monthIdx, days) {
    const gMax = gMaxForMonth(monthIdx);
    const mu   = gMax > 0 ? 1 / gMax : 1;          // średnia "czystość nieba" [0..1]
    const p    = Math.max(0, gMax - 1);            // wykładnik: E[r^p] = mu
    const s    = Math.max(0, Math.min(1, P.state.pvVariability));
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
  P.simulateTankMonth = function(simPV, simDHW, heaterKW, tankL, monthIdx) {
    const mi    = (monthIdx === undefined ? P.state.monthIdx : monthIdx);
    const days  = P.MONTHS[mi].days;
    const T_in  = simDHW.T_in;
    const hours = [];

    const daysData = [];   // agregaty na dobę — wykres dobowy energii (Moduł 05)
    const factors = P.dailyWeatherFactors(mi, days);  // dobowe mnożniki PV
    let T = T_in;  // start zimny
    let monthQ_saved = 0, monthQ_strat = 0;
    let monthElec_pv = 0, monthElec_grid = 0;
    let monthGridCost = 0, monthHeaterHours = 0;

    for (let d = 0; d < days; d++) {
      const g = factors[d];
      const dayPV = { hours: simPV.hours.map(h => ({
        hour: h.hour, power: h.power * g, energy: h.energy * g
      })) };
      const day = P.simulateTank(dayPV, simDHW, heaterKW, tankL, T);
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
      // Symulacja roczna zawsze korzysta z doby przeciętnej PV (PVGIS), nie z trybu clear-sky
      const simPV  = P.simulateDay(P.state.kWp, mi, 'avg');
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

  // ===== OPTYMALIZACJA — GRID SEARCH (Moduł 08) =====
  // Przeszukuje zgrubną siatkę P.OPT_GRID po parametrach: moc PV, moc grzałki,
  // próg włączenia, pojemność zasobnika, temperatura grzania grzałki oraz
  // strategia grzałki dla strefy dziennej i nocnej. Dla każdej kombinacji
  // uruchamia istniejącą symulację
  // roczną i kalkulator inwestycji, a następnie liczy zysk netto za cały
  // okres życia inwestycji:
  //   lifetimeProfit = bilans roczny netto × lata życia − koszt inwestycji
  // Odrzuca warianty bez zwrotu (bilans ≤ 0) oraz z czasem zwrotu powyżej
  // limitu maxPayback. Zwraca 3 najlepsze warianty (malejąco wg lifetimeProfit).
  //
  // Funkcja tymczasowo nadpisuje P.state, więc na końcu przywraca pierwotne
  // wartości — moduły 01–07 dalej pokazują ustawienia użytkownika.
  //
  // Pruning: heaterThreshold wpływa tylko na strategię 'off-grid'. Gdy ani
  // strefa dzienna, ani nocna nie używa 'off-grid', próg iterowany jest raz.
  //
  // Działa asynchronicznie: kombinacje liczone są w porcjach (CHUNK), między
  // porcjami sterowanie wraca do przeglądarki (setTimeout 0), dzięki czemu
  // pasek postępu może rosnąć. Zwraca Promise z top 3 wariantami. Opcjonalny
  // callback onProgress(frac) dostaje ułamek 0..1 ukończenia.
  P.optimize = function(maxPayback, lifetime, onProgress) {
    const g = P.OPT_GRID;
    const s = P.state;
    const saved = {
      kWp:              s.kWp,
      heaterKW:         s.heaterKW,
      heaterThreshold:  s.heaterThreshold,
      tankL:            s.tankL,
      heaterTargetC:    s.heaterTargetC,
      heaterStratDay:   s.heaterStratDay,
      heaterStratNight: s.heaterStratNight
    };

    // Lista wszystkich kombinacji do przeliczenia (z pruningiem progu).
    const combos = [];
    for (const stratDay of g.strat) {
      for (const stratNight of g.strat) {
        const usesOffGrid = stratDay === 'off-grid' || stratNight === 'off-grid';
        const thresholds = usesOffGrid ? g.threshold : [g.threshold[0]];
        for (const kWp of g.kWp) {
          for (const heaterKW of g.heaterKW) {
            for (const tankL of g.tankL) {
              for (const heaterTargetC of g.heaterTargetC) {
                for (const threshold of thresholds) {
                  combos.push({ kWp, heaterKW, threshold, tankL, heaterTargetC, stratDay, stratNight });
                }
              }
            }
          }
        }
      }
    }

    const results = [];
    const total = combos.length;
    const CHUNK = 24;

    return new Promise(resolve => {
      let i = 0;
      function step() {
        const end = Math.min(i + CHUNK, total);
        for (; i < end; i++) {
          const c = combos[i];
          s.kWp              = c.kWp;
          s.heaterKW         = c.heaterKW;
          s.heaterThreshold  = c.threshold;
          s.tankL            = c.tankL;
          s.heaterTargetC    = c.heaterTargetC;
          s.heaterStratDay   = c.stratDay;
          s.heaterStratNight = c.stratNight;

          const simYear = P.simulateTankYear();
          const inv     = P.computeInvestment(simYear);
          const balance = simYear.yearly.balancePLN;
          if (balance <= 0 || !isFinite(inv.paybackYears)) continue;
          if (inv.paybackYears > maxPayback) continue;

          results.push({
            kWp:            c.kWp,
            heaterKW:       c.heaterKW,
            heaterThreshold: c.threshold,
            tankL:          c.tankL,
            heaterTargetC:  c.heaterTargetC,
            stratDay:       c.stratDay,
            stratNight:     c.stratNight,
            cost:           inv.total,
            balancePLN:     balance,
            paybackYears:   inv.paybackYears,
            lifetimeProfit: balance * lifetime - inv.total
          });
        }
        if (onProgress) onProgress(total > 0 ? i / total : 1);

        if (i < total) {
          setTimeout(step, 0);
        } else {
          Object.assign(s, saved);   // przywróć ustawienia użytkownika
          results.sort((a, b) => b.lifetimeProfit - a.lifetimeProfit);
          resolve(results.slice(0, 3));
        }
      }
      step();
    });
  };

})(window.PVSIM);
