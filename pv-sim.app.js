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
     - przełącznik typu budynku (stary/nowy — współczynnik strat cyrkulacji)
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
     - suwaki cen inwestycji: PV, grzałki, PC, zasobnik, SCADA (moduł 07)
     - suwaki limitu zwrotu i okresu życia, checkboxy włączania
       poszczególnych wymiarów siatki, przyciski start/stop optymalizacji
       (moduł 08)
     - przycisk pokaż/ukryj sidebar z podsumowaniem rocznym
       (start: widoczny dla okna ≥1100 px, ukryty poniżej)
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
    P.renderYearStats(simYear);

    const inv = P.computeInvestment(simYear);
    P.renderInvestStats(inv);

    P.renderGridChart();
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

    // Toggle typu budynku (Moduł 02 / CWU)
    const buildingBtns = document.querySelectorAll('#pvsim-building-toggle .pvsim-toggle-btn');
    buildingBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        P.state.buildingType = btn.dataset.building;
        buildingBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        P.update();
      });
    });

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
      setSlider('pvsim-heater-threshold', Math.round(r.heaterThreshold * 100));
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
      ['threshold',     'Próg włącz.',  ''],
      ['tankL',         'Zasobnik',     'L'],
      ['heaterTargetC', 'T docelowa',   '°C'],
      ['strat',         'Strategie',    '']
    ];
    const optEnabled = { kWp:true, heaterKW:true, hpKW:true, threshold:true, tankL:true, heaterTargetC:true, strat:true };

    function renderOptParams() {
      const G = P.OPT_GRID;
      const thrLen   = optEnabled.threshold ? G.threshold.length : 1;
      // Para 'off'/'off' przybija próg do 1 (nic nie grzeje). Liczymy ile par
      // w aktualnej siatce strategii NIE jest off/off — te dostają pełny zestaw progów.
      let stratPairs, offOffPairs;
      if (optEnabled.strat) {
        const n = G.strat.length;
        stratPairs = n * n;
        offOffPairs = 1; // dokładnie jedna para off/off
      } else {
        stratPairs = 1;
        offOffPairs = (P.state.heaterStratDay === 'off' && P.state.heaterStratNight === 'off') ? 1 : 0;
      }
      const stratThr = (stratPairs - offOffPairs) * thrLen + offOffPairs;
      const lens = {
        kWp:           optEnabled.kWp           ? G.kWp.length           : 1,
        heaterKW:      optEnabled.heaterKW      ? G.heaterKW.length      : 1,
        hpKW:          optEnabled.hpKW          ? G.hpKW.length          : 1,
        tankL:         optEnabled.tankL         ? G.tankL.length         : 1,
        heaterTargetC: optEnabled.heaterTargetC ? G.heaterTargetC.length : 1
      };
      const total = lens.kWp * lens.heaterKW * lens.hpKW * lens.tankL * lens.heaterTargetC * stratThr;
      const rows = paramLabels.map(([k, name, unit]) => {
        const vals = G[k];
        if (!vals) return '';
        const on = optEnabled[k];
        const valsTxt = on ? (vals.join(' · ') + (unit ? ' ' + unit : '')) : `stałe: ${currentParamVal(k)}${unit ? ' ' + unit : ''}`;
        let countTxt;
        if (!on)                    countTxt = '× 1';
        else if (k === 'strat')     countTxt = `${vals.length}² par`;
        else if (k === 'threshold') countTxt = `× ${vals.length} *`;
        else                        countTxt = `× ${vals.length}`;
        return `<li>`
             + `<label class="name"><input type="checkbox" data-opt="${k}" ${on?'checked':''}> ${name}</label>`
             + `<span class="vals">${valsTxt}</span>`
             + `<span class="count">${countTxt}</span>`
             + `</li>`;
      }).join('');
      optParams.innerHTML = rows
        + `<div class="total"><span>Razem kombinacji</span><b>${P.fmt.pl0(total)}</b></div>`
        + (optEnabled.threshold ? `<div class="total" style="text-transform:none; letter-spacing:0; font-size:9.5px; color: var(--pvsim-text-3); padding-top:2px; border-top:0;">* próg pomijany tylko gdy obie strefy = off</div>` : '');
    }
    function currentParamVal(k) {
      const s = P.state;
      switch (k) {
        case 'kWp': return s.kWp;
        case 'heaterKW': return s.heaterKW;
        case 'hpKW': return s.hpKW;
        case 'threshold': return s.heaterThreshold;
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
      P.optimize(P.state.optMaxPayback, P.state.optLifetime, (frac, done, total) => {
        optBar.style.width = Math.round(frac * 100) + '%';
        optLabel.innerHTML = '<span class="count">' + P.fmt.pl0(done) + '</span> / ' + P.fmt.pl0(total);
      }, optEnabled, optCancel).then(res => {
        optResults = res.results;
        P.renderOptimTable(optResults);
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

    updateSlider();  // pierwsza inicjalizacja + render
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window.PVSIM);
