/* =========================================================
   PV.SIM — Główna logika aplikacji i obsługa interfejsu

   P.update() — wywołuje kolejno wszystkie trzy symulacje
     (simulateDay → simulateDHW → simulateTank) i przekazuje
     wyniki do odpowiednich funkcji render. Wywoływana przy
     każdej zmianie parametrów przez użytkownika.

   Prywatna init() — jednorazowa inicjalizacja UI:
     - suwak mocy PV (kWp)
     - przełącznik trybu PV (doba przeciętna / pełne usłonecznienie)
     - siatka przycisków wyboru miesiąca (generowana dynamicznie z P.MONTHS)
     - suwak liczby mieszkańców (moduł 02 CWU)
     - suwak temperatury docelowej CWU (moduł 02)
     - przełącznik typu budynku (stary/nowy — współczynnik strat cyrkulacji)
     - suwak mocy grzałki (moduł 03)
     - suwak pojemności zasobnika (moduł 03)
   Każdy suwak przy zmianie aktualizuje P.state, odświeża etykietę
   wartości, ustawia zmienną CSS --pvsim-fill (WebKit track fill)
   i wywołuje P.update().

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
    const minR = parseFloat(sliderR.min), maxR = parseFloat(sliderR.max);
    sliderR.style.setProperty('--pvsim-fill', ((P.state.residents - minR) / (maxR - minR) * 100) + '%');

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
    const minTH = parseFloat(sliderTH.min), maxTH = parseFloat(sliderTH.max);
    sliderTH.style.setProperty('--pvsim-fill', ((P.state.T_hot - minTH) / (maxTH - minTH) * 100) + '%');

    // Suwak mocy grzałki (Moduł 03)
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
    const minH = parseFloat(sliderH.min), maxH = parseFloat(sliderH.max);
    sliderH.style.setProperty('--pvsim-fill', ((P.state.heaterKW - minH) / (maxH - minH) * 100) + '%');

    // Suwak progu włączenia grzałki (Moduł 03)
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
    const minHT = parseFloat(sliderHT.min), maxHT = parseFloat(sliderHT.max);
    sliderHT.style.setProperty('--pvsim-fill', ((parseInt(sliderHT.value) - minHT) / (maxHT - minHT) * 100) + '%');

    // Suwak pojemności zasobnika (Moduł 03)
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
    const minT = parseFloat(sliderT.min), maxT = parseFloat(sliderT.max);
    sliderT.style.setProperty('--pvsim-fill', ((P.state.tankL - minT) / (maxT - minT) * 100) + '%');

    updateSlider();  // pierwsza inicjalizacja + render
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window.PVSIM);
