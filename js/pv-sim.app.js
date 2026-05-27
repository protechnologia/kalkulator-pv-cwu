/* =========================================================
   PV.SIM — Główna logika aplikacji i obsługa interfejsu

   P.update() — wywołuje kolejno wszystkie symulacje/rendery
     (simulateDay → simulateDHW → simulateTank → simulateTankMonth →
     simulateTankYear → computeInvestment → renderGridChart)
     i przekazuje wyniki do odpowiednich funkcji render.
     Wywoływana przy każdej zmianie parametrów przez użytkownika.

   Prywatna init() — jednorazowa inicjalizacja UI:
     - suwak mocy PV (kWp)
     - przełącznik trybu PV (doba przeciętna / pełne usłonecznienie)
     - suwak zmienności pogody dobowej (moduł 01)
     - siatka przycisków wyboru miesiąca (generowana dynamicznie z P.MONTHS)
     - suwak liczby mieszkańców (moduł 02 CWU)
     - suwak temperatury docelowej CWU (moduł 02)
     - pole ceny energii cieplnej w zł/GJ (moduł 02)
     - suwak strat cyrkulacji CWU (% energii użytecznej; znaczniki 35%/60%
       z P.CIRC_LOSS jako kotwice „nowy" / „stary budynek")
     - pola cen energii elektrycznej dzień/noc w zł/kWh (moduł 03)
     - suwaki początku i końca strefy dziennej (moduł 03)
     - suwak mocy grzałki (moduł 04, 0 = wyłączona)
     - suwak progu włączenia grzałki (moduł 04)
     - suwak pojemności zasobnika (moduł 04)
     - suwak temperatury docelowej zasobnika (moduł 04 —
       wspólny setpoint pary PC+grzałka)
     - suwaki pompy ciepła: moc, liczba biegów, pasmo „tylko PC",
       COP letni i zimowy (moduł 04, hpKW = 0 = PC wyłączona)
     - przełączniki strategii pary PC+grzałka dzień/noc (moduł 04)
     - przełącznik trasy cyrkulacji CWU: stary węzeł / nasz zasobnik
       (moduł 04, P.state.circRoute)
     - suwaki cen inwestycji: PV, grzałki, PC, zasobnik, SCADA (moduł 07)
     - suwaki limitu zwrotu i okresu życia, przełącznik kryterium
       optymalizacji (maks. zysk / min. zwrot / maks. pokrycie),
       checkboxy włączania poszczególnych wymiarów siatki, przyciski
       start/stop optymalizacji (moduł 08)
     - przycisk pokaż/ukryj sidebar z podsumowaniem rocznym
       (start: widoczny dla okna ≥1100 px, ukryty poniżej)
     - pinezki (setupPins) — klik 📌 przykleja sekcję wykresu lub blok
       statystyk do prawego dolnego rogu (position:fixed), z placeholderem
       w oryginalnym miejscu; wiele pinów układa się w pionowy stos
   Każda kontrolka przy zmianie synchronizuje P.state, odświeża etykietę,
   ustawia CSS --pvsim-fill (WebKit track fill) i wywołuje P.requestUpdate()
   (suwaki — debouncing rAF) lub P.update() (kliki — synchronicznie).

   Musi być ładowany jako OSTATNI spośród plików JS —
   po config.js, physics.js i render.js.
   ========================================================= */
window.PVSIM = window.PVSIM || {};
(function(P) {
  'use strict';

  // Hook ustawiany przez init() — odświeża widget „Parametry siatki" (Moduł 08)
  // po zmianie wartości w P.state, żeby pola „stałe: …" pokazywały aktualne dane.
  let renderOptParamsHook = null;

  // Opisy strategii grzałka + PC — pokazywane pod aktywnym przyciskiem
  // togglea (Moduł 04). Treść identyczna dla strefy dziennej i nocnej —
  // strategia ma to samo znaczenie, różni się tylko cena prądu z sieci.
  const STRAT_DESC = {
    'off':
      '<strong>Grzanie wyłączone.</strong> W tej strefie taryfy ani grzałka, ani pompa ciepła nie pracują. ' +
      'Zasobnik traci ciepło na rozbiór CWU i straty postojowe, a temperatura spada. ' +
      'Sensowne w strefie nocnej, gdy zakładamy, że dzienna nadwyżka PV w pełni naładuje zasobnik, ' +
      'albo gdy chcemy świadomie zrezygnować z grzania w drogiej strefie taryfy.',
    'off-grid':
      '<strong>Tylko nadwyżka PV (power diverter).</strong> Układ grzeje wyłącznie wtedy, gdy produkcja PV przekracza próg włączenia, ' +
      'i pobiera tylko tyle prądu, ile aktualnie produkują panele — nic z sieci. ' +
      'Pompa ciepła ma priorytet (wybiera najwyższy bieg mieszczący się w nadwyżce), a grzałka dobiera resztę PV. ' +
      'Grzanie zatrzymuje się po osiągnięciu temperatury docelowej zasobnika — nadwyżka PV ponad ten setpoint jest tracona. ' +
      'Najtańszy tryb w eksploatacji, ale w pochmurne dni lub po dużym poborze CWU zasobnik może zostać niedogrzany.',
    'on-grid':
      '<strong>Z dopłatą z sieci — zawsze grzej.</strong> Układ grzeje zawsze, gdy temperatura zasobnika jest poniżej setpointu, ' +
      'nawet jeśli prąd z sieci akurat wychodzi drożej od ciepła sieciowego. ' +
      'W wąskim paśmie tuż pod setpointem pracuje sama pompa ciepła, dobierając bieg proporcjonalnie do bieżącego zapotrzebowania, ' +
      'a grzałka pozostaje wyłączona. Poniżej tego pasa pompa ciepła przechodzi na najwyższy bieg, ' +
      'a grzałka dołącza jako dopalacz, modulując moc do dogrzewania. ' +
      'Nadwyżka PV jest wykorzystywana w pierwszej kolejności, a brakującą energię układ pobiera z sieci po cenie aktualnej strefy taryfy.',
    'on-grid-eco':
      '<strong>Z dopłatą z sieci — tylko gdy taniej niż ciepło sieciowe.</strong> ' +
      'Taka sama logika sterowania jak w trybie „zawsze grzej", ale z dodatkową bramką opłacalności sprawdzaną osobno dla PC i dla grzałki w każdym podkroku. ' +
      'Dla każdego urządzenia liczony jest koszt 1 kWh ciepła z miksu PV + sieć ' +
      '(<em>cost/kWh<sub>th</sub> = (1 − udział PV) · cena strefy / COP</em> dla PC; ' +
      '<em>= (1 − udział PV) · cena strefy</em> dla grzałki) i porównywany z ceną ciepła sieciowego po przeliczeniu na zł/kWh. ' +
      'Jeśli dane urządzenie wyszłoby drożej niż stary węzeł — zostaje wyłączone w tym podkroku i ciepło bierzemy z sieci ciepłowniczej. ' +
      'PC z reguły mieści się w opłacalności znacznie szerzej niż grzałka (bo dzieli koszt przez COP).'
  };

  function renderStratDesc() {
    const dEl = document.getElementById('pvsim-strat-day-desc');
    const nEl = document.getElementById('pvsim-strat-night-desc');
    if (dEl) dEl.innerHTML = STRAT_DESC[P.state.heaterStratDay]   || '';
    if (nEl) nEl.innerHTML = STRAT_DESC[P.state.heaterStratNight] || '';
    const cEl = document.getElementById('pvsim-circroute-desc');
    if (cEl) cEl.innerHTML = CIRCROUTE_DESC[P.state.circRoute] || '';
  }

  // Opisy trasy cyrkulacji CWU — pokazywane pod aktywnym przyciskiem
  // togglea „Trasa cyrkulacji CWU" (Moduł 04).
  const CIRCROUTE_DESC = {
    'eco':
      '<strong>Cyrkulację podgrzewa stary węzeł.</strong> Nasz zasobnik jest wpięty na przyłączu zimnej wody, przed starym węzłem — ' +
      'podgrzewa cały strumień wody zasilający węzeł, który dogrzewa go do T_hot i obsługuje pętlę cyrkulacyjną. ' +
      'Każdy kWh ciepła, który dostarczymy (Q_saved), zmniejsza zapotrzebowanie starego węzła — ' +
      'a węzeł potrzebuje energii zarówno na kran, jak i na cyrkulację. Stąd mianownik pokrycia to pełna energia CWU budynku ' +
      '(użyteczna + straty pętli). ' +
      '<em>Ograniczenie:</em> ciepło trafia do węzła tylko strumieniem rozbiorów, więc maksymalnie możemy dostarczyć tyle, ' +
      'ile zmieści się w wodzie kranowej podgrzanej od T_cold do T_hot (Q_saved ≤ Q_useful).',
    'tank':
      '<strong>Cyrkulację bierze nasz zasobnik.</strong> Pętla powrotna jest przepięta do naszego zasobnika zamiast do starego węzła. ' +
      'Uproszczony model pętli umie tylko wysysać energię ze zbiornika (stałą mocą P_circ, aż do poziomu wody wodociągowej — niżej nie schłodzi). ' +
      'Ciepło dostarczone do pętli wlicza się do Q_saved zasobnika, więc nasz układ pokrywa kran + cyrkulację. ' +
      'Mianownik pokrycia pozostaje ten sam — pełna energia CWU budynku — bo fizyczna potrzeba nie zależy od trasy. ' +
      '<em>Brak limitu rozbiorów:</em> pętla wysysa ciepło ciągle, niezależnie od poboru kranu, więc Q_saved nie jest już ograniczone strumieniem rozbiorów i może realnie sięgnąć Q_total.'
  };

  // ===== AKTUALIZACJA =====
  P.update = function() {
    const sim = P.simulateDay(P.state.kWp, P.state.monthIdx, P.state.pvMode);
    P.renderChart(sim);
    P.renderStats(sim);

    const simDHW = P.simulateDHW(P.state.residents, P.state.monthIdx, P.state.T_hot);
    P.renderDHWChart(simDHW);
    P.renderDHWStats(simDHW);

    const simTank = P.simulateTank(sim, simDHW, P.state.heaterKW, P.state.tankL);
    P.renderTankChart(simTank);
    P.renderTankElecChart(simTank);
    P.renderHeatSplitChart(simTank);
    P.renderTankCostChart(simTank);
    P.renderTankStats(simTank);

    // Moduł 05 zawsze korzysta z doby przeciętnej PV (PVGIS), niezależnie od pvMode
    const simAvg = P.simulateDay(P.state.kWp, P.state.monthIdx, 'avg');
    P.renderPVMonthChart(P.state.monthIdx, simAvg.daily);
    const simMonth = P.simulateTankMonth(simAvg, simDHW, P.state.heaterKW, P.state.tankL);
    P.renderMonthTankChart(simMonth);
    P.renderMonthElecChart(simMonth);
    P.renderMonthStats(simMonth);

    const simYear = P.simulateTankYear();
    P.renderYearChart(simYear);
    P.renderYearCoverChart(simYear);
    P.renderYearStats(simYear);

    const inv = P.computeInvestment(simYear);
    P.renderInvestStats(inv);

    P.renderGridChart();
    renderStratDesc();
    if (renderOptParamsHook) renderOptParamsHook();
  };

  // Debouncing przez requestAnimationFrame — wiele zdarzeń `input` w jednym
  // tasku (szybki ruch suwakiem) składa się do jednego P.update() per klatka.
  // Listenery wołają requestUpdate(); init() i applyOptimRow() używają
  // synchronicznego P.update() bezpośrednio, gdy potrzebny natychmiastowy render.
  let updatePending = false;
  P.requestUpdate = function() {
    if (updatePending) return;
    updatePending = true;
    requestAnimationFrame(() => {
      updatePending = false;
      P.update();
    });
  };

  // ===== INICJALIZACJA UI =====
  function init() {
    // Hydracja kontrolek z P.state — JS jest jedynym źródłem prawdy dla wartości
    // domyślnych. HTML nie ma już atrybutów value="..." / class="active" duplikujących
    // defaults; ustawiamy je tu raz, a istniejące sync*/update*/wire* poniżej działają
    // jak dotąd (czytają z DOM, ustawiają --pvsim-fill i etykiety).
    const HYDRATE_INPUTS = [
      ['pvsim-power',            'kWp'],
      ['pvsim-pv-variability',   'pvVariability',    v => Math.round(v * 100)],
      ['pvsim-circ-loss',        'circLossPct',      v => Math.round(v * 100)],
      ['pvsim-price-gj',         'priceHeatGJ'],
      ['pvsim-residents',        'residents'],
      ['pvsim-thot',             'T_hot'],
      ['pvsim-heater',           'heaterKW'],
      ['pvsim-heater-threshold', 'heaterThreshold',  v => Math.round(v * 100)],
      ['pvsim-tank',             'tankL'],
      ['pvsim-heater-target',    'heaterTargetC'],
      ['pvsim-hp',               'hpKW'],
      ['pvsim-hp-gears',         'hpGears'],
      ['pvsim-hp-band',          'hpOnlyBandC'],
      ['pvsim-hp-cop-summer',    'hpCOPSummer'],
      ['pvsim-hp-cop-winter',    'hpCOPWinter'],
      ['pvsim-grid-price-day',   'gridPriceDay'],
      ['pvsim-grid-price-night', 'gridPriceNight'],
      ['pvsim-grid-day-start',   'gridDayStart'],
      ['pvsim-grid-day-end',     'gridDayEnd'],
      ['pvsim-price-pv',         'pricePVkWp'],
      ['pvsim-price-heater',     'priceHeaterKW'],
      ['pvsim-price-hp',         'priceHPkWth'],
      ['pvsim-price-tank',       'priceTank100'],
      ['pvsim-price-scada',      'priceScada'],
      ['pvsim-opt-payback',      'optMaxPayback'],
      ['pvsim-opt-lifetime',     'optLifetime'],
    ];
    HYDRATE_INPUTS.forEach(([id, key, transform]) => {
      const el = document.getElementById(id);
      if (!el) return;
      const v = P.state[key];
      el.value = String(transform ? transform(v) : v);
    });
    const HYDRATE_TOGGLES = [
      ['pvsim-mode-toggle',          'mode',     'pvMode'],
      ['pvsim-strat-day-toggle',     'strat',    'heaterStratDay'],
      ['pvsim-strat-night-toggle',   'strat',    'heaterStratNight'],
      ['pvsim-circroute-toggle',     'route',    'circRoute'],
      ['pvsim-opt-objective-toggle', 'obj',      'optObjective'],
    ];
    HYDRATE_TOGGLES.forEach(([toggleId, dataAttr, stateKey]) => {
      const wanted = String(P.state[stateKey]);
      document.querySelectorAll('#' + toggleId + ' .pvsim-toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset[dataAttr] === wanted);
      });
    });

    // Suwak mocy
    const slider = document.getElementById('pvsim-power');
    const sliderVal = document.getElementById('pvsim-power-val');
    function updateSlider() {
      P.state.kWp = parseFloat(slider.value);
      sliderVal.textContent = P.fmt.pl1(P.state.kWp);
      const min = parseFloat(slider.min), max = parseFloat(slider.max);
      const pct = ((P.state.kWp - min) / (max - min)) * 100;
      slider.style.setProperty('--pvsim-fill', pct + '%');
      P.requestUpdate();
    }
    slider.addEventListener('input', updateSlider);

    // Suwak zmienności pogody dobowej (Moduł 01 → wpływa na moduły 05–08)
    const sliderV = document.getElementById('pvsim-pv-variability');
    const sliderVVal = document.getElementById('pvsim-pv-variability-val');
    function updateVariability() {
      const pctVal = parseInt(sliderV.value, 10);
      P.state.pvVariability = pctVal / 100;
      sliderVVal.textContent = pctVal;
      const min = parseFloat(sliderV.min), max = parseFloat(sliderV.max);
      sliderV.style.setProperty('--pvsim-fill', ((pctVal - min) / (max - min) * 100) + '%');
      P.requestUpdate();
    }
    sliderV.addEventListener('input', updateVariability);
    updateVariability();

    // Toggle trybu PV (doba przeciętna vs pełne usłonecznienie)
    const toggleBtns = document.querySelectorAll('#pvsim-mode-toggle .pvsim-toggle-btn');
    toggleBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        P.state.pvMode = btn.dataset.mode;
        toggleBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        P.update();
      });
    });

    // Siatka miesięcy
    const grid = document.getElementById('pvsim-months');
    P.MONTHS.forEach((m, idx) => {
      const btn = document.createElement('button');
      btn.className = 'pvsim-month-btn' + (idx === P.state.monthIdx ? ' active' : '');
      btn.innerHTML = `<span class="num">${String(m.id).padStart(2, '0')}</span>${m.abbr}`;
      btn.addEventListener('click', () => {
        P.state.monthIdx = idx;
        grid.querySelectorAll('.pvsim-month-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        P.update();
      });
      grid.appendChild(btn);
    });

    // Suwak strat cyrkulacji CWU (Moduł 02). Znaczniki na suwaku odpowiadają
    // kotwicom z P.CIRC_LOSS: stary budynek ~60%, nowy ~35%.
    const sliderC = document.getElementById('pvsim-circ-loss');
    const sliderCVal = document.getElementById('pvsim-circ-loss-val');
    function updateCircLoss() {
      const pctVal = parseInt(sliderC.value, 10);
      P.state.circLossPct = pctVal / 100;
      sliderCVal.textContent = pctVal;
      const min = parseFloat(sliderC.min), max = parseFloat(sliderC.max);
      sliderC.style.setProperty('--pvsim-fill', ((pctVal - min) / (max - min) * 100) + '%');
      P.requestUpdate();
    }
    sliderC.addEventListener('input', updateCircLoss);
    updateCircLoss();
    // Pozycje znaczników z P.CIRC_LOSS — jedno źródło prawdy dla kotwic
    const tickNew = document.getElementById('pvsim-circ-tick-new');
    const tickOld = document.getElementById('pvsim-circ-tick-old');
    if (tickNew) {
      const p = Math.round(P.CIRC_LOSS.new * 100);
      tickNew.style.left = p + '%';
      tickNew.setAttribute('data-label', 'NOWY ' + p + '%');
    }
    if (tickOld) {
      const p = Math.round(P.CIRC_LOSS.old * 100);
      tickOld.style.left = p + '%';
      tickOld.setAttribute('data-label', 'STARY ' + p + '%');
    }

    // Pole ceny energii cieplnej (Moduł 02 / CWU)
    const inputPrice = document.getElementById('pvsim-price-gj');
    function syncPriceGJ() {
      const val = parseFloat(inputPrice.value);
      if (!isNaN(val) && val > 0) {
        P.state.priceHeatGJ = val;
      }
      const kwhEl = document.getElementById('pvsim-price-kwh');
      if (kwhEl) kwhEl.textContent = P.fmt.pl2(P.state.priceHeatGJ / P.KWH_PER_GJ);
    }
    inputPrice.addEventListener('input', function() { syncPriceGJ(); P.requestUpdate(); });
    syncPriceGJ();

    // Suwak mieszkańców (Moduł 02 / CWU)
    const sliderR = document.getElementById('pvsim-residents');
    const sliderRVal = document.getElementById('pvsim-residents-val');
    function updateResidents() {
      P.state.residents = parseInt(sliderR.value, 10);
      sliderRVal.textContent = P.state.residents;
      const min = parseFloat(sliderR.min), max = parseFloat(sliderR.max);
      const pct = ((P.state.residents - min) / (max - min)) * 100;
      sliderR.style.setProperty('--pvsim-fill', pct + '%');
      P.requestUpdate();
    }
    sliderR.addEventListener('input', updateResidents);
    updateResidents();

    // Suwak temperatury docelowej CWU (Moduł 02)
    const sliderTH = document.getElementById('pvsim-thot');
    const sliderTHVal = document.getElementById('pvsim-thot-val');
    function updateThot() {
      P.state.T_hot = parseInt(sliderTH.value, 10);
      sliderTHVal.textContent = P.state.T_hot;
      const min = parseFloat(sliderTH.min), max = parseFloat(sliderTH.max);
      const pct = ((P.state.T_hot - min) / (max - min)) * 100;
      sliderTH.style.setProperty('--pvsim-fill', pct + '%');
      P.requestUpdate();
    }
    sliderTH.addEventListener('input', updateThot);
    updateThot();

    // Suwak mocy grzałki (Moduł 04)
    const sliderH = document.getElementById('pvsim-heater');
    const sliderHVal = document.getElementById('pvsim-heater-val');
    function updateHeater() {
      P.state.heaterKW = parseFloat(sliderH.value);
      sliderHVal.textContent = P.fmt.pl1(P.state.heaterKW);
      const min = parseFloat(sliderH.min), max = parseFloat(sliderH.max);
      const pct = ((P.state.heaterKW - min) / (max - min)) * 100;
      sliderH.style.setProperty('--pvsim-fill', pct + '%');
      P.requestUpdate();
    }
    sliderH.addEventListener('input', updateHeater);
    updateHeater();

    // Suwak progu włączenia grzałki (Moduł 04)
    const sliderHT = document.getElementById('pvsim-heater-threshold');
    const sliderHTVal = document.getElementById('pvsim-heater-threshold-val');
    function updateHeaterThreshold() {
      P.state.heaterThreshold = parseInt(sliderHT.value, 10) / 100;
      sliderHTVal.textContent = sliderHT.value;
      const min = parseFloat(sliderHT.min), max = parseFloat(sliderHT.max);
      sliderHT.style.setProperty('--pvsim-fill', ((parseInt(sliderHT.value, 10) - min) / (max - min) * 100) + '%');
      P.requestUpdate();
    }
    sliderHT.addEventListener('input', updateHeaterThreshold);
    updateHeaterThreshold();

    // Suwak pojemności zasobnika (Moduł 04)
    const sliderT = document.getElementById('pvsim-tank');
    const sliderTVal = document.getElementById('pvsim-tank-val');
    function updateTank() {
      P.state.tankL = parseInt(sliderT.value, 10);
      sliderTVal.textContent = P.state.tankL;
      const min = parseFloat(sliderT.min), max = parseFloat(sliderT.max);
      const pct = ((P.state.tankL - min) / (max - min)) * 100;
      sliderT.style.setProperty('--pvsim-fill', pct + '%');
      P.requestUpdate();
    }
    sliderT.addEventListener('input', updateTank);
    updateTank();

    // Suwak temperatury grzania grzałki (Moduł 04)
    const sliderHTg = document.getElementById('pvsim-heater-target');
    const sliderHTgVal = document.getElementById('pvsim-heater-target-val');
    function updateHeaterTarget() {
      P.state.heaterTargetC = parseInt(sliderHTg.value, 10);
      sliderHTgVal.textContent = P.state.heaterTargetC;
      const min = parseFloat(sliderHTg.min), max = parseFloat(sliderHTg.max);
      const pct = ((P.state.heaterTargetC - min) / (max - min)) * 100;
      sliderHTg.style.setProperty('--pvsim-fill', pct + '%');
      P.requestUpdate();
    }
    sliderHTg.addEventListener('input', updateHeaterTarget);
    updateHeaterTarget();

    // Suwaki pompy ciepła (Moduł 04)
    function wireHpSlider(sliderId, valId, stateKey, fmtFn) {
      const sl  = document.getElementById(sliderId);
      const val = document.getElementById(valId);
      function upd() {
        const v = parseFloat(sl.value);
        P.state[stateKey] = v;
        val.textContent = fmtFn ? fmtFn(v) : v;
        const min = parseFloat(sl.min), max = parseFloat(sl.max);
        sl.style.setProperty('--pvsim-fill', ((v - min) / (max - min) * 100) + '%');
        P.requestUpdate();
      }
      sl.addEventListener('input', upd);
      upd();
    }
    wireHpSlider('pvsim-hp',            'pvsim-hp-val',            'hpKW',         v => P.fmt.pl1(v));
    wireHpSlider('pvsim-hp-gears',      'pvsim-hp-gears-val',      'hpGears',      v => String(v|0));
    wireHpSlider('pvsim-hp-band',       'pvsim-hp-band-val',       'hpOnlyBandC',  v => String(v|0));
    wireHpSlider('pvsim-hp-cop-summer', 'pvsim-hp-cop-summer-val', 'hpCOPSummer',  v => P.fmt.pl1(v));
    wireHpSlider('pvsim-hp-cop-winter', 'pvsim-hp-cop-winter-val', 'hpCOPWinter',  v => P.fmt.pl1(v));

    // Toggle strategii grzałki — strefa dzienna i nocna (Moduł 04)
    function wireStratToggle(toggleId, stateKey) {
      const btns = document.querySelectorAll('#' + toggleId + ' .pvsim-toggle-btn');
      btns.forEach(btn => {
        btn.addEventListener('click', () => {
          P.state[stateKey] = btn.dataset.strat;
          btns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          P.update();
        });
      });
    }
    wireStratToggle('pvsim-strat-day-toggle', 'heaterStratDay');
    wireStratToggle('pvsim-strat-night-toggle', 'heaterStratNight');

    // Toggle trasy cyrkulacji CWU (Moduł 04) — 'eco' | 'tank'
    (function() {
      const btns = document.querySelectorAll('#pvsim-circroute-toggle .pvsim-toggle-btn');
      btns.forEach(btn => {
        btn.addEventListener('click', () => {
          P.state.circRoute = btn.dataset.route;
          btns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          P.update();
        });
      });
    })();

    // Przełącznik kryterium optymalizacji (Moduł 08) — nie wywołuje P.update(),
    // bo optymalizator startuje tylko przyciskiem, a moduł 08 nie jest częścią `update()`.
    (function() {
      const btns = document.querySelectorAll('#pvsim-opt-objective-toggle .pvsim-toggle-btn');
      btns.forEach(btn => {
        btn.addEventListener('click', () => {
          P.state.optObjective = btn.dataset.obj;
          btns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });
    })();

    // Pola cen energii elektrycznej (Moduł 03)
    const inputGridDay = document.getElementById('pvsim-grid-price-day');
    const inputGridNight = document.getElementById('pvsim-grid-price-night');
    function syncGridPrice(input, key) {
      const val = parseFloat(input.value);
      if (!isNaN(val) && val > 0) { P.state[key] = val; }
    }
    inputGridDay.addEventListener('input', function() {
      syncGridPrice(this, 'gridPriceDay'); P.requestUpdate();
    });
    inputGridNight.addEventListener('input', function() {
      syncGridPrice(this, 'gridPriceNight'); P.requestUpdate();
    });
    syncGridPrice(inputGridDay, 'gridPriceDay');
    syncGridPrice(inputGridNight, 'gridPriceNight');

    // Suwaki strefy dziennej (Moduł 03)
    const sliderGS = document.getElementById('pvsim-grid-day-start');
    const sliderGSVal = document.getElementById('pvsim-grid-day-start-val');
    function updateGridDayStart() {
      P.state.gridDayStart = parseInt(sliderGS.value, 10);
      sliderGSVal.textContent = P.state.gridDayStart;
      const pct = ((P.state.gridDayStart - 0) / 23) * 100;
      sliderGS.style.setProperty('--pvsim-fill', pct + '%');
      P.requestUpdate();
    }
    sliderGS.addEventListener('input', updateGridDayStart);
    updateGridDayStart();

    const sliderGE = document.getElementById('pvsim-grid-day-end');
    const sliderGEVal = document.getElementById('pvsim-grid-day-end-val');
    function updateGridDayEnd() {
      P.state.gridDayEnd = parseInt(sliderGE.value, 10);
      sliderGEVal.textContent = P.state.gridDayEnd;
      const pct = ((P.state.gridDayEnd - 0) / 23) * 100;
      sliderGE.style.setProperty('--pvsim-fill', pct + '%');
      P.requestUpdate();
    }
    sliderGE.addEventListener('input', updateGridDayEnd);
    updateGridDayEnd();

    // Suwaki cen inwestycji (Moduł 07)
    function wirePriceSlider(sliderId, valId, stateKey) {
      const sl  = document.getElementById(sliderId);
      const val = document.getElementById(valId);
      function upd() {
        P.state[stateKey] = parseInt(sl.value, 10);
        val.textContent = P.fmt.pl0(P.state[stateKey]);
        const min = parseFloat(sl.min), max = parseFloat(sl.max);
        const pct = ((P.state[stateKey] - min) / (max - min)) * 100;
        sl.style.setProperty('--pvsim-fill', pct + '%');
        P.requestUpdate();
      }
      sl.addEventListener('input', upd);
      upd();
    }
    wirePriceSlider('pvsim-price-pv',     'pvsim-price-pv-val',     'pricePVkWp');
    wirePriceSlider('pvsim-price-heater', 'pvsim-price-heater-val', 'priceHeaterKW');
    wirePriceSlider('pvsim-price-hp',     'pvsim-price-hp-val',     'priceHPkWth');
    wirePriceSlider('pvsim-price-tank',   'pvsim-price-tank-val',   'priceTank100');
    wirePriceSlider('pvsim-price-scada',  'pvsim-price-scada-val',  'priceScada');

    // ===== Moduł 08 — optymalizacja (grid search) =====
    // Suwaki limitu zwrotu i okresu życia — nie uruchamiają P.update(),
    // tylko synchronizują P.state. Search startuje wyłącznie przyciskiem.
    function wireOptSlider(sliderId, valId, stateKey) {
      const sl  = document.getElementById(sliderId);
      const val = document.getElementById(valId);
      function upd() {
        P.state[stateKey] = parseInt(sl.value, 10);
        val.textContent = P.state[stateKey];
        const min = parseFloat(sl.min), max = parseFloat(sl.max);
        sl.style.setProperty('--pvsim-fill', ((P.state[stateKey] - min) / (max - min) * 100) + '%');
      }
      sl.addEventListener('input', upd);
      upd();
    }
    wireOptSlider('pvsim-opt-payback',  'pvsim-opt-payback-val',  'optMaxPayback');
    wireOptSlider('pvsim-opt-lifetime', 'pvsim-opt-lifetime-val', 'optLifetime');

    // Przenosi parametry wybranego wiersza wyniku do modułów 04/07.
    // Reużywa istniejące listenery suwaków/przełączników przez zdarzenia DOM,
    // dzięki czemu P.state, etykiety, --pvsim-fill i P.update() liczą się same.
    function applyOptimRow(r) {
      const setSlider = (id, value) => {
        const sl = document.getElementById(id);
        if (!sl) return;
        sl.value = value;
        sl.dispatchEvent(new Event('input'));
      };
      const clickStrat = (toggleId, strat) => {
        const btn = document.querySelector('#' + toggleId + ' .pvsim-toggle-btn[data-strat="' + strat + '"]');
        if (btn) btn.click();
      };
      setSlider('pvsim-power', r.kWp);
      setSlider('pvsim-heater', r.heaterKW);
      if (r.hpKW !== undefined) setSlider('pvsim-hp', r.hpKW);
      setSlider('pvsim-tank', r.tankL);
      setSlider('pvsim-heater-target', r.heaterTargetC);
      clickStrat('pvsim-strat-day-toggle',   r.stratDay);
      clickStrat('pvsim-strat-night-toggle', r.stratNight);
    }

    // Przycisk „Optymalizuj" — uruchamia asynchroniczny grid search.
    // Pasek postępu rośnie w trakcie (callback onProgress), przycisk jest
    // zablokowany do końca obliczeń.
    // Lista parametrów siatki — generowana z P.OPT_GRID, z checkboxami
    const optParams = document.getElementById('pvsim-opt-params');
    const paramLabels = [
      ['kWp',           'Moc PV',       'kWp'],
      ['heaterKW',      'Moc grzałki',  'kW'],
      ['hpKW',          'Moc PC',       'kW'],
      ['tankL',         'Zasobnik',     'L'],
      ['heaterTargetC', 'T docelowa',   '°C'],
      ['strat',         'Strategie',    '']
    ];
    const optEnabled = { kWp:true, heaterKW:true, hpKW:true, tankL:true, heaterTargetC:true, strat:true };

    function renderOptParams() {
      const G = P.OPT_GRID;
      const stratPairs = optEnabled.strat ? G.strat.length * G.strat.length : 1;
      const lens = {
        kWp:           optEnabled.kWp           ? G.kWp.length           : 1,
        heaterKW:      optEnabled.heaterKW      ? G.heaterKW.length      : 1,
        hpKW:          optEnabled.hpKW          ? G.hpKW.length          : 1,
        tankL:         optEnabled.tankL         ? G.tankL.length         : 1,
        heaterTargetC: optEnabled.heaterTargetC ? G.heaterTargetC.length : 1
      };
      const total = lens.kWp * lens.heaterKW * lens.hpKW * lens.tankL * lens.heaterTargetC * stratPairs;
      const rows = paramLabels.map(([k, name, unit]) => {
        const vals = G[k];
        if (!vals) return '';
        const on = optEnabled[k];
        const unitSuffix = unit ? ' ' + unit : '';
        const valsTxt = on ? (vals.join(' · ') + unitSuffix) : `stałe: ${currentParamVal(k)}${unitSuffix}`;
        let countTxt;
        if (!on)                countTxt = '× 1';
        else if (k === 'strat') countTxt = `${vals.length}² par`;
        else                    countTxt = `× ${vals.length}`;
        return `<tr>`
             + `<td class="name"><label><input type="checkbox" data-opt="${k}" ${on?'checked':''}> ${name}</label></td>`
             + `<td class="vals">${valsTxt}</td>`
             + `<td class="count">${countTxt}</td>`
             + `</tr>`;
      }).join('');
      optParams.innerHTML = `<tbody>${rows}</tbody>`
        + `<tfoot>`
        + `<tr class="total"><td colspan="2">Razem kombinacji</td><td><b>${P.fmt.pl0(total)}</b></td></tr>`
        + `</tfoot>`;
    }
    function currentParamVal(k) {
      const s = P.state;
      switch (k) {
        case 'kWp': return s.kWp;
        case 'heaterKW': return s.heaterKW;
        case 'hpKW': return s.hpKW;
        case 'tankL': return s.tankL;
        case 'heaterTargetC': return s.heaterTargetC;
        case 'strat': return `${s.heaterStratDay}/${s.heaterStratNight}`;
      }
    }
    optParams.addEventListener('change', (e) => {
      const cb = e.target.closest('input[data-opt]');
      if (!cb) return;
      optEnabled[cb.dataset.opt] = cb.checked;
      renderOptParams();
    });
    renderOptParamsHook = renderOptParams;
    renderOptParams();
    P.renderOptimTable(null);

    const optRun   = document.getElementById('pvsim-opt-run');
    const optBar   = document.getElementById('pvsim-opt-progress-fill');
    const optLabel = document.getElementById('pvsim-opt-progress-label');
    let optResults = [];
    let optCancel  = null;       // { cancelled: bool } gdy trwa optymalizacja
    const RUN_LABEL  = 'Optymalizuj →';
    const STOP_LABEL = 'Zatrzymaj ◼';
    optRun.addEventListener('click', () => {
      // Tryb zatrzymywania
      if (optCancel) {
        optCancel.cancelled = true;
        optRun.textContent = 'Zatrzymuję…';
        optRun.disabled = true;
        return;
      }
      // Tryb startu
      optCancel = { cancelled: false };
      optRun.textContent = STOP_LABEL;
      optRun.classList.add('stopping');
      optBar.style.width = '0%';
      optLabel.innerHTML = '<span class="count">0</span> / 0';
      renderOptParams(); // odśwież „stałe: …" jeśli zmieniło się P.state
      const optStartMs = performance.now();
      const fmtEta = (s) => {
        if (!isFinite(s) || s < 0) return '—';
        s = Math.round(s);
        if (s < 60) return s + ' s';
        const m = Math.floor(s / 60), r = s % 60;
        if (m < 60) return m + ' min ' + (r < 10 ? '0' : '') + r + ' s';
        const h = Math.floor(m / 60), mm = m % 60;
        return h + ' h ' + (mm < 10 ? '0' : '') + mm + ' min';
      };
      P.optimize(P.state.optMaxPayback, P.state.optLifetime, (frac, done, total) => {
        optBar.style.width = Math.round(frac * 100) + '%';
        const elapsed = (performance.now() - optStartMs) / 1000;
        const etaTxt = (done > 0 && frac < 1)
          ? ' — ETA ' + fmtEta(elapsed * (total - done) / done)
          : '';
        optLabel.innerHTML = '<span class="count">' + P.fmt.pl0(done) + '</span> / ' + P.fmt.pl0(total) + etaTxt;
      }, optEnabled, optCancel, P.state.optObjective).then(res => {
        optResults = res.results;
        P.renderOptimTable(
          optResults,
          'Brak wariantu spełniającego limit zwrotu — zwiększ dopuszczalny czas zwrotu lub zmień parametry modułów 01–03.'
        );
        if (res.cancelled) {
          optLabel.innerHTML = '<span class="count">' + P.fmt.pl0(res.done) + '</span> / ' + P.fmt.pl0(res.total) + ' — zatrzymano';
        }
        optCancel = null;
        optRun.textContent = RUN_LABEL;
        optRun.classList.remove('stopping');
        optRun.disabled = false;
      });
    });

    // Delegacja kliknięć przycisków „Przenieś" w tabeli wyników.
    document.getElementById('pvsim-optim-table').addEventListener('click', (e) => {
      const btn = e.target.closest('.pvsim-optim-apply');
      if (!btn) return;
      const row = optResults[parseInt(btn.dataset.row, 10)];
      if (row) applyOptimRow(row);
    });

    // Przycisk pokaż/ukryj sidebar — start widoczny na szerokich ekranach
    const sidebar = document.getElementById('pvsim-sidebar');
    const sidebarToggle = document.getElementById('pvsim-sidebar-toggle');
    function setSidebar(visible) {
      sidebar.classList.toggle('hidden', !visible);
      sidebarToggle.setAttribute('aria-expanded', String(visible));
      sidebarToggle.textContent = 'Podsumowanie ' + (visible ? '▾' : '▸');
    }
    setSidebar(window.innerWidth >= 1100);
    sidebarToggle.addEventListener('click', () => {
      setSidebar(sidebar.classList.contains('hidden'));
    });

    // Lewy sidebar — spis treści modułów
    const toc = document.getElementById('pvsim-toc');
    const tocToggle = document.getElementById('pvsim-toc-toggle');
    function setToc(visible) {
      toc.classList.toggle('hidden', !visible);
      tocToggle.setAttribute('aria-expanded', String(visible));
      tocToggle.textContent = 'Moduły ' + (visible ? '▾' : '▸');
    }
    setToc(window.innerWidth >= 1100);
    tocToggle.addEventListener('click', () => {
      setToc(toc.classList.contains('hidden'));
    });

    const tocItems = Array.from(toc.querySelectorAll('.pvsim-toc-item'));
    const tocById = new Map(tocItems.map(a => [a.dataset.target, a]));
    const moduleSections = tocItems
      .map(a => document.getElementById(a.dataset.target))
      .filter(Boolean);
    if ('IntersectionObserver' in window && moduleSections.length) {
      const visible = new Set();
      const io = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        });
        const firstVisible = moduleSections.find(s => visible.has(s.id));
        if (firstVisible) {
          tocItems.forEach(a => a.classList.remove('active'));
          const a = tocById.get(firstVisible.id);
          if (a) a.classList.add('active');
        }
      }, { rootMargin: '-20% 0px -60% 0px', threshold: 0 });
      moduleSections.forEach(s => io.observe(s));
    }

    // Przełącznik motywu (Ciemny / Jasny) — klasa .theme-light na .pvsim
    // i <body> jednocześnie (body steruje tłem strony, .pvsim tokenami
    // wnętrza). Wybór trwały w localStorage. Klucz: 'pvsim-theme'.
    const pvsimRoot = document.querySelector('.pvsim');
    const themeBtns = Array.from(document.querySelectorAll('.pvsim-theme-btn'));
    function applyTheme(theme) {
      const light = theme === 'light';
      pvsimRoot.classList.toggle('theme-light', light);
      document.body.classList.toggle('theme-light', light);
      themeBtns.forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
      try { localStorage.setItem('pvsim-theme', theme); } catch (e) {}
    }
    let savedTheme = 'light';
    try { savedTheme = localStorage.getItem('pvsim-theme') || 'light'; } catch (e) {}
    applyTheme(savedTheme);
    themeBtns.forEach(b => b.addEventListener('click', () => applyTheme(b.dataset.theme)));

    setupPins();

    updateSlider();  // pierwsza inicjalizacja + render

    // Firefox: pierwszy focus na input[type=range] wywołuje scroll-into-view.
    // Konsumujemy go programowo — pozwalamy Firefoxowi zrobić skok,
    // natychmiast cofamy scroll i blurrujemy.
    requestAnimationFrame(() => {
      const sliders = document.querySelectorAll('.pvsim-slider');
      if (!sliders.length) return;
      const sx = window.scrollX, sy = window.scrollY;
      sliders.forEach(sl => {
        try { sl.focus(); } catch (e) {}
        sl.blur();
      });
      window.scrollTo(sx, sy);
    });
  }

  // Pinezki — klik przykleja sekcję wykresu lub pojedynczy kafelek statystyk
  // do prawego dolnego rogu okna (position:fixed) i wstawia w oryginalnym
  // miejscu placeholder o tej samej wysokości (brak skoku layoutu). Wiele
  // pinów układa się w stos w pionie. Elementy zostają w DOM-ie, więc kolejne
  // P.update() renderują do tych samych węzłów (wykresy, kafelki).
  function setupPins() {
    const pinned = [];
    const sidebar = document.querySelector('.pvsim-sidebar');
    document.querySelectorAll('.pvsim-chart-section, .pvsim-stat').forEach(section => {
      const btn = section.querySelector(':scope > .pvsim-pin, :scope .pvsim-chart-header > .pvsim-pin');
      if (!btn) return;
      btn.addEventListener('click', () => togglePin(section, btn));
    });
    // Relayout przy pokazaniu/ukryciu sidebara — żeby przypięte wykresy
    // nie były nim przykrywane (pchamy je w lewo o szerokość sidebara).
    if (sidebar) {
      new MutationObserver(() => relayout()).observe(sidebar, {
        attributes: true, attributeFilter: ['class']
      });
    }

    function togglePin(section, btn) {
      if (section.classList.contains('pinned')) unpin(section, btn);
      else pin(section, btn);
      relayout();
    }
    function pin(section, btn) {
      const rect = section.getBoundingClientRect();
      const placeholder = document.createElement('div');
      placeholder.className = 'pvsim-chart-pin-placeholder';
      placeholder.style.height = rect.height + 'px';
      section.parentNode.insertBefore(placeholder, section);
      section._pinPlaceholder = placeholder;
      section.classList.add('pinned');
      btn.setAttribute('aria-pressed', 'true');
      btn.title = 'Odepnij wykres';
      pinned.push(section);
    }
    function unpin(section, btn) {
      section.classList.remove('pinned');
      section.style.bottom = '';
      section.style.right = '';
      if (section._pinPlaceholder) {
        section._pinPlaceholder.remove();
        section._pinPlaceholder = null;
      }
      btn.setAttribute('aria-pressed', 'false');
      btn.title = 'Przypnij wykres do rogu ekranu';
      const i = pinned.indexOf(section);
      if (i >= 0) pinned.splice(i, 1);
    }
    function relayout() {
      let bottom = 16;
      const gap = 12;
      const sbVisible = sidebar && !sidebar.classList.contains('hidden');
      const sbW = sbVisible ? sidebar.getBoundingClientRect().width : 0;
      const right = (sbVisible ? sbW + 16 : 0) + 16;
      pinned.forEach(s => {
        s.style.right = right + 'px';
        s.style.bottom = bottom + 'px';
        bottom += s.getBoundingClientRect().height + gap;
      });
    }
    window.addEventListener('resize', relayout);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window.PVSIM);
