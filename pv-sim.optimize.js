/* =========================================================
   PV.SIM — Optymalizacja (Moduł 08, grid search)

   P.optimize(maxPayback, lifetime, onProgress, enabled, cancelToken)
     Przeszukuje siatkę P.OPT_GRID po mocy PV, mocy grzałki, mocy PC,
     progu, pojemności zasobnika, temperaturze grzania i strategiach
     dzień/noc. Dla każdej kombinacji uruchamia P.simulateTankYear()
     i P.computeInvestment(), liczy zysk netto za cały okres życia
     inwestycji:
        lifetimeProfit = bilans roczny netto × lifetime − koszt inwestycji
     Odrzuca warianty bez zwrotu (balancePLN ≤ 0) oraz z czasem zwrotu
     powyżej limitu maxPayback. Zwraca 3 najlepsze (malejąco wg
     lifetimeProfit).

     `enabled` — mapa flag per parametr (false ⇒ wymiar przypięty do
     bieżącej wartości P.state zamiast iterowania siatki).
     `cancelToken = { cancelled: bool }` — przerwanie między porcjami.

     Działa asynchronicznie: kombinacje liczone w porcjach (CHUNK=24),
     między porcjami sterowanie wraca do przeglądarki (setTimeout 0),
     dzięki czemu pasek postępu może rosnąć. Callback
     onProgress(frac, done, total) raportuje postęp. Zwraca Promise
     z obiektem { results, cancelled, done, total }.

     Pruning: heaterThreshold pomijany tylko gdy obie strategie = 'off'
     (wtedy żadne grzanie nie działa, próg jest bez znaczenia).

     Funkcja nie mutuje P.state — buduje lokalny obiekt `params` per kombinacja
     (snapshot wartości z momentu startu + nadpisanie pól siatki) i przekazuje
     go jawnie do P.simulateTankYear(params) / P.computeInvestment(simYear, params).
     Dzięki temu user może bez konsekwencji ruszać suwakami w trakcie pętli —
     P.update() leci na P.state, optymalizator na własnym snapshotcie.
   ========================================================= */
window.PVSIM = window.PVSIM || {};
(function(P) {
  'use strict';

  P.optimize = function(maxPayback, lifetime, onProgress, enabled, cancelToken) {
    const g = P.OPT_GRID;
    // Snapshot P.state z momentu startu — wszystkie kombinacje liczone na
    // spójnym zestawie pól spoza siatki, niezależnie czy user ruszy suwakiem.
    const baseSnapshot = Object.assign({}, P.state);
    // enabled — mapa param→bool; brak = wszystkie włączone (domyślny grid search).
    // Wyłączony parametr przybijamy do wartości ze snapshotu (siatka = [1]).
    const en = enabled || {};
    // Rozpakowanie flag z checkboxów widgetu „Parametry siatki" (Moduł 08).
    // Domyślnie true — tylko jawne false z checkboxa wyłącza wymiar.
    const e = {
      kWp:           en.kWp           !== false,
      heaterKW:      en.heaterKW      !== false,
      hpKW:          en.hpKW          !== false,
      threshold:     en.threshold     !== false,
      tankL:         en.tankL         !== false,
      heaterTargetC: en.heaterTargetC !== false,
      strat:         en.strat         !== false
    };
    // Faktyczne siatki per wymiar:
    // włączony → pełna lista z P.OPT_GRID,
    // wyłączony → siatka jednoelementowa z wartością ze snapshotu (de facto zamrożony).
    const gridKWp        = e.kWp           ? g.kWp           : [baseSnapshot.kWp];
    const gridHeaterKW   = e.heaterKW      ? g.heaterKW      : [baseSnapshot.heaterKW];
    const gridHpKW       = e.hpKW          ? g.hpKW          : [baseSnapshot.hpKW];
    const gridThreshold  = e.threshold     ? g.threshold     : [baseSnapshot.heaterThreshold];
    const gridTankL      = e.tankL         ? g.tankL         : [baseSnapshot.tankL];
    const gridTargetC    = e.heaterTargetC ? g.heaterTargetC : [baseSnapshot.heaterTargetC];
    const gridStratDay   = e.strat         ? g.strat         : [baseSnapshot.heaterStratDay];
    const gridStratNight = e.strat         ? g.strat         : [baseSnapshot.heaterStratNight];

    // Lista wszystkich kombinacji do przeliczenia (z pruningiem progu).
    const combos = [];
    for (const stratDay of gridStratDay) {
      for (const stratNight of gridStratNight) {
        // Próg ma znaczenie zarówno dla off-grid (PC + grzałka), jak i on-grid
        // (histereza grzałki przy małej modulacji proporcjonalnej). Pomijamy
        // tylko gdy obie strefy = 'off' — wtedy żadne grzanie nie działa.
        const usesHeating = stratDay !== 'off' || stratNight !== 'off';
        const thresholds = usesHeating ? gridThreshold : [gridThreshold[0]];
        for (const kWp of gridKWp) {
          for (const heaterKW of gridHeaterKW) {
            for (const hpKW of gridHpKW) {
              for (const tankL of gridTankL) {
                for (const heaterTargetC of gridTargetC) {
                  for (const threshold of thresholds) {
                    combos.push({ kWp, heaterKW, hpKW, threshold, tankL, heaterTargetC, stratDay, stratNight });
                  }
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

    return new Promise((resolve, reject) => {
      let i = 0;
      function step() {
        const end = Math.min(i + CHUNK, total);
        for (; i < end; i++) {
          const c = combos[i];
          // Świeży obiekt per kombinacja: pola spoza siatki ze snapshotu,
          // pola siatki nadpisane z c. Izolacja — nie mutuje baseSnapshot.
          const params = Object.assign({}, baseSnapshot, {
            kWp:              c.kWp,
            heaterKW:         c.heaterKW,
            hpKW:             c.hpKW,
            heaterThreshold:  c.threshold,
            tankL:            c.tankL,
            heaterTargetC:    c.heaterTargetC,
            heaterStratDay:   c.stratDay,
            heaterStratNight: c.stratNight
          });

          const simYear = P.simulateTankYear(params);
          const inv     = P.computeInvestment(simYear, params);
          const balance = simYear.yearly.balancePLN;
          if (balance <= 0 || !isFinite(inv.paybackYears)) continue;
          if (inv.paybackYears > maxPayback) continue;

          // Wiersz wyniku: parametry kombinacji (do tabeli + „Przenieś →")
          // + metryki ekonomiczne. lifetimeProfit jest kryterium sortowania.
          results.push({
            kWp:            c.kWp,
            heaterKW:       c.heaterKW,
            hpKW:           c.hpKW,
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
        if (onProgress) onProgress(total > 0 ? i / total : 1, i, total);

        // Anulowanie z UI („Zatrzymaj ◼") — sprawdzane między porcjami.
        // Zwracamy wynik częściowy (to co zdążyło się policzyć) + flagę cancelled.
        if (cancelToken && cancelToken.cancelled) {
          results.sort((a, b) => b.lifetimeProfit - a.lifetimeProfit);
          resolve({ results: results.slice(0, 3), cancelled: true, done: i, total });
          return;
        }
        // Albo zaplanuj kolejny chunk (setTimeout 0 oddaje sterowanie do UI),
        // albo finisz: sort po lifetimeProfit malejąco + top-3 do tabeli.
        if (i < total) {
          setTimeout(safeStep, 0);
        } else {
          results.sort((a, b) => b.lifetimeProfit - a.lifetimeProfit);
          resolve({ results: results.slice(0, 3), cancelled: false, done: i, total });
        }
      }
      // Wrapper łapie wyjątek z symulacji i zamienia go na reject Promise'a —
      // bez tego błąd w setTimeout-owym tasku zniknąłby w void, a Promise wisiał
      // by w nieskończoność (pasek postępu zamarznięty, przycisk wciąż „Zatrzymaj").
      function safeStep() {
        try { step(); }
        catch (err) { reject(err); }
      }
      safeStep();
    });
  };

})(window.PVSIM);
