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

     Funkcja tymczasowo nadpisuje P.state na czas pętli; przed
     resolve przywraca pierwotne wartości — moduły 01–07 dalej
     pokazują ustawienia użytkownika.
   ========================================================= */
window.PVSIM = window.PVSIM || {};
(function(P) {
  'use strict';

  P.optimize = function(maxPayback, lifetime, onProgress, enabled, cancelToken) {
    const g = P.OPT_GRID;
    const s = P.state;
    // enabled — mapa param→bool; brak = wszystkie włączone (domyślny grid search).
    // Wyłączony parametr przybijamy do bieżącej wartości z P.state (siatka = [1]).
    const en = enabled || {};
    const e = {
      kWp:           en.kWp           !== false,
      heaterKW:      en.heaterKW      !== false,
      hpKW:          en.hpKW          !== false,
      threshold:     en.threshold     !== false,
      tankL:         en.tankL         !== false,
      heaterTargetC: en.heaterTargetC !== false,
      strat:         en.strat         !== false
    };
    const gridKWp        = e.kWp           ? g.kWp           : [s.kWp];
    const gridHeaterKW   = e.heaterKW      ? g.heaterKW      : [s.heaterKW];
    const gridHpKW       = e.hpKW          ? g.hpKW          : [s.hpKW];
    const gridThreshold  = e.threshold     ? g.threshold     : [s.heaterThreshold];
    const gridTankL      = e.tankL         ? g.tankL         : [s.tankL];
    const gridTargetC    = e.heaterTargetC ? g.heaterTargetC : [s.heaterTargetC];
    const gridStratDay   = e.strat         ? g.strat         : [s.heaterStratDay];
    const gridStratNight = e.strat         ? g.strat         : [s.heaterStratNight];
    const saved = {
      kWp:              s.kWp,
      heaterKW:         s.heaterKW,
      hpKW:             s.hpKW,
      heaterThreshold:  s.heaterThreshold,
      tankL:            s.tankL,
      heaterTargetC:    s.heaterTargetC,
      heaterStratDay:   s.heaterStratDay,
      heaterStratNight: s.heaterStratNight
    };

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

    return new Promise(resolve => {
      let i = 0;
      function step() {
        const end = Math.min(i + CHUNK, total);
        for (; i < end; i++) {
          const c = combos[i];
          s.kWp              = c.kWp;
          s.heaterKW         = c.heaterKW;
          s.hpKW             = c.hpKW;
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

        if (cancelToken && cancelToken.cancelled) {
          Object.assign(s, saved);
          results.sort((a, b) => b.lifetimeProfit - a.lifetimeProfit);
          resolve({ results: results.slice(0, 3), cancelled: true, done: i, total });
          return;
        }
        if (i < total) {
          setTimeout(step, 0);
        } else {
          Object.assign(s, saved);   // przywróć ustawienia użytkownika
          results.sort((a, b) => b.lifetimeProfit - a.lifetimeProfit);
          resolve({ results: results.slice(0, 3), cancelled: false, done: i, total });
        }
      }
      step();
    });
  };

})(window.PVSIM);
