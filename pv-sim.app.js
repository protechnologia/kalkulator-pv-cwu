/* =========================================================
   PV.SIM — Główna logika aplikacji i obsługa interfejsu

   P.update() — wywołuje kolejno wszystkie cztery symulacje/rendery
     (simulateDay → simulateDHW → simulateTank → renderGridChart) i przekazuje
     wyniki do odpowiednich funkcji render. Wywoływana przy
     każdej zmianie parametrów przez użytkownika.

   Prywatna init() — jednorazowa inicjalizacja UI:
     - suwak mocy PV (kWp)
     - przełącznik trybu PV (doba przeciętna / pełne usłonecznienie)
     - siatka przycisków wyboru miesiąca (generowana dynamicznie z P.MONTHS)
     - suwak liczby mieszkańców (moduł 02 CWU)
     - suwak temperatury docelowej CWU (moduł 02)
     - pole ceny energii cieplnej w zł/GJ (moduł 02)
     - przełącznik typu budynku (stary/nowy — współczynnik strat cyrkulacji)
     - pola cen energii elektrycznej dzień/noc w zł/kWh (moduł 03)
     - suwaki początku i końca strefy dziennej (moduł 03)
     - suwak mocy grzałki (moduł 04)
     - suwak progu włączenia grzałki (moduł 04)
     - suwak pojemności zasobnika (moduł 04)
   Każda kontrolka przy zmianie synchronizuje P.state, odświeża etykietę,
   ustawia CSS --pvsim-fill (WebKit track fill) i wywołuje P.update()
   lub renderGridChart() (moduł 03 nie uruchamia pełnej symulacji).

   Musi być ładowany jako OSTATNI spośród plików JS —
   po config.js, physics.js i render.js.
   ========================================================= */
window.PVSIM = window.PVSIM || {};
(function(P) {
  'use strict';

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
    P.renderTankStats(simTank);

    P.renderGridChart();
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
      P.update();
    }
    slider.addEventListener('input', updateSlider);

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
        P.PRICE_PER_GJ  = val;
        P.PRICE_PER_KWH = P.PRICE_PER_GJ / P.KWH_PER_GJ;
      }
    }
    inputPrice.addEventListener('input', function() { syncPriceGJ(); P.update(); });
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
      P.update();
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
      P.update();
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
      P.update();
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
      sliderHT.style.setProperty('--pvsim-fill', ((parseInt(sliderHT.value) - min) / (max - min) * 100) + '%');
      P.update();
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
      P.update();
    }
    sliderT.addEventListener('input', updateTank);
    updateTank();

    // Pola cen energii elektrycznej (Moduł 03)
    const inputGridDay = document.getElementById('pvsim-grid-price-day');
    const inputGridNight = document.getElementById('pvsim-grid-price-night');
    function syncGridPrice(input, key) {
      const val = parseFloat(input.value);
      if (!isNaN(val) && val > 0) { P.state[key] = val; }
    }
    inputGridDay.addEventListener('input', function() {
      syncGridPrice(this, 'gridPriceDay'); P.renderGridChart();
    });
    inputGridNight.addEventListener('input', function() {
      syncGridPrice(this, 'gridPriceNight'); P.renderGridChart();
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
      P.renderGridChart();
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
      P.renderGridChart();
    }
    sliderGE.addEventListener('input', updateGridDayEnd);
    updateGridDayEnd();

    updateSlider();  // pierwsza inicjalizacja + render
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window.PVSIM);
