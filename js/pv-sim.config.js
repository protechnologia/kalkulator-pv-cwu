/* =========================================================
   PV.SIM — Konfiguracja i stałe aplikacji

   Tworzy globalną przestrzeń nazw window.PVSIM i definiuje:
   - stałe fizyczno-geograficzne (szerokość Opola, skaler clear-sky)
   - parametry CWU: zużycie wody na osobę, ciepło właściwe wody,
     model temperatury wody zimnej (sinusoida z opóźnieniem fazowym),
     domyślną cenę ciepła sieciowego (P.state.priceHeatGJ — edytowalna z UI),
     kotwice strat cyrkulacji CIRC_LOSS (stary/nowy budynek — znaczniki suwaka)
   - godzinowy profil zużycia CWU znormalizowany do 1.0
     (źródło: Chmielewska 2025, Energies 18(17), 42 budynki w PL)
   - parametry zasobnika: termostat, straty UA, liczba podkroków,
     pasmo proporcjonalne sterowania on-grid (TANK_ONGRID_BAND)
   - tablicę MONTHS z danymi PVGIS dla każdego miesiąca
     (doy, dni w miesiącu, przeciętna dzienna produkcja kWh/kWp)
   - ziarno PRNG zmienności pogody dobowej (WEATHER_SEED)
   - obiekt state — bieżące wartości wszystkich suwaków i pól UI,
     w tym parametry taryfy elektrycznej (moduł 03), strategie grzałki
     dla strefy dziennej i nocnej oraz trasę cyrkulacji circRoute
     ('eco' | 'tank', moduł 04), ceny inwestycji (moduł 07) oraz
     parametry optymalizacji (moduł 08)
   - siatkę OPT_GRID przeszukiwaną przez grid search (moduł 08)

   Musi być ładowany jako PIERWSZY spośród plików JS,
   bo physics.js, render.js i app.js korzystają z P.state i stałych.
   ========================================================= */
window.PVSIM = window.PVSIM || {};
(function(P) {
  'use strict';

  // ===== FIZYKA / GEOGRAFIA =====
  P.LAT = 50.67;        // szerokość geograficzna Opola (deg)
  P.Y_MAX_KW = 45;      // stała skala osi Y wykresu PV

  // Skaler dla trybu "clear-sky" — kalibruje raw clear-sky tak, by suma dobowa w czerwcu
  // dawała ~7.8 kWh/kWp/dobę (typowy słoneczny dzień w PL). Wartość 1.4577 = 7.8 / 5.351,
  // gdzie 5.351 to suma raw clear-sky dla 21 czerwca w Opolu.
  P.CLEAR_SCALE = 1.4577;

  // Bazowe ziarno deterministycznego PRNG zmienności pogody dobowej (Moduł 05/06).
  // Ziarno każdego miesiąca = WEATHER_SEED + monthIdx — wzorzec jest powtarzalny.
  P.WEATHER_SEED = 20260101;

  // ===== CWU =====
  P.DHW_L_PER_PERSON = 40;   // l/osobę/dobę przy temp. docelowej (typowo PL: 30–50)
  P.C_WATER = 4.186;          // kJ/(kg·K) — ciepło właściwe wody

  // Temperatura wody zimnej z wodociągu — model sinusoidalny z opóźnieniem fazowym.
  // Rurociąg leży 1.5–2m pod ziemią → podąża za temp. gruntu, opóźniony ~1.5 mies. za powietrzem,
  // z amplitudą ~5°C. Min w lutym (~6°C), max w sierpniu (~16°C). Średnia roczna 11°C.
  // Źródło modelu: Górka A., "Zapotrzebowanie na energię cieplną do przygotowania c.w.u.
  //   w budynku mieszkalnym", RynekInstalacyjny.pl — pomiary 90 punktów sieci PL.
  P.T_COLD_AVG   = 11.0;  // °C, średnia roczna
  P.T_COLD_AMP   = 5.0;   // °C, amplituda sezonowa
  P.T_COLD_PHASE = 1.5;   // mies. opóźnienia za temp. powietrza

  // monthIdx: 0..11 (sty=0). Min w lutym, max w sierpniu.
  P.T_cold = function(monthIdx) {
    const m = monthIdx + 1;
    return P.T_COLD_AVG - P.T_COLD_AMP * Math.cos(2 * Math.PI * (m - 1 - P.T_COLD_PHASE) / 12);
  };

  // Energia [kWh] do podgrzania 1 m³ od T_cold(m) do T_hot
  P.kWh_per_m3 = function(monthIdx, T_hot) {
    return 1000 * P.C_WATER * (T_hot - P.T_cold(monthIdx)) / 3600;
  };

  // Stały przelicznik fizyczny: 1 GJ ≈ 277.78 kWh.
  // Cena ciepła sieciowego siedzi w P.state.priceHeatGJ (edytowalna z UI Modułu 02).
  P.KWH_PER_GJ = 1000 / 3.6;

  // Profil godzinowy zużycia CWU w bud. wielorodzinnym [% zużycia dobowego]
  // Źródło: Chmielewska, A. (2025). "Characteristics of Domestic Hot Water Consumption
  //   Profiles in Multi-Family Buildings for Energy Modeling Purposes". Energies 18(17), 4578.
  //   DOI: 10.3390/en18174578. Otwarty dostęp (CC BY).
  //   Badanie: 42 budynki, 1376 mieszkań w Polsce (Wrocław, Zawidów), 3–5 lat pomiarów.
  // Profil dnia roboczego. ~18% rano (peak 07–08), ~45% wieczorem (peak 20–22).
  const DHW_PROFILE_RAW = [
    0.5, 0.3, 0.3, 0.3, 0.5, 1.0,    // 00..05  noc — minimum
    2.5, 6.5, 6.5, 3.5, 3.0, 3.5,    // 06..11  peak poranny 07–08
    4.0, 4.0, 3.5, 3.5, 4.0, 4.0,    // 12..17  popołudnie
    5.5, 8.5, 10.5, 11.5, 8.0, 4.5   // 18..23  peak wieczorny 20–22
  ];
  const _profileSum = DHW_PROFILE_RAW.reduce((s, x) => s + x, 0);
  P.DHW_PROFILE = DHW_PROFILE_RAW.map(x => x / _profileSum);

  // Skale wykresów CWU
  P.Y_MAX_M3H    = 1.0;   // m³/h (lewa oś wykresu CWU)
  P.Y_MAX_KW_DHW = 60;    // kW  (prawa oś wykresu CWU)

  // ===== CYRKULACJA CWU =====
  // Straty ciepła w pętli cyrkulacyjnej jako % energii użytecznej CWU.
  // Realna wartość jest ciągła (suwak `circLossPct` w P.state), a poniższe
  // dwa punkty referencyjne służą tylko jako kotwice/znaczniki na suwaku:
  //   nowy budynek (izolacja nowsza, krótsze piony): ~35%
  //   stary budynek (brak izolacji rur, długie piony): ~60%
  // Źródło rzędów wielkości: POBE, Feist & Schnieders (2009), Badescu & Staicovici (2006)
  P.CIRC_LOSS = { new: 0.35, old: 0.60 };

  // ===== ZASOBNIK + GRZAŁKA (Moduł 04) =====
  P.TANK_T_AMB  = 15;    // °C — otoczenie zasobnika (piwnica/kotłownia)
  // UA dla zasobnika izolowanego pianką PU 50mm, smukły walec H/D≈3:
  //   UA(V) = UA_REF · (V/V_REF)^(2/3) — klasa energetyczna B/C wg PN-EN 12897
  P.TANK_UA_REF  = 1.75; // W/K przy V_REF = 500 L
  P.TANK_V_REF   = 500;  // L
  P.TANK_SUBSTEPS = 6;   // 6 podkroków × 10 min — stabilność numeryczna
  P.Y_MAX_TEMP   = 70;   // °C — skala osi temperatury zasobnika
  // Pasmo proporcjonalne regulatora on-grid [°C]: pełna moc gdy T ≤ T_hot - BAND,
  // moc 0 gdy T ≥ T_hot, liniowo modulowana pomiędzy.
  P.TANK_ONGRID_BAND = 5;

  // ===== MIESIĄCE =====
  // dailyYield = przeciętna dobowa produkcja [kWh/kWp], dane PSH z PVGIS dla PL, 30° opt.
  P.MONTHS = [
    { id: 1,  abbr: 'STY', name: 'Styczeń',     doy: 15,  days: 31, dailyYield: 0.65 },
    { id: 2,  abbr: 'LUT', name: 'Luty',        doy: 45,  days: 28, dailyYield: 1.20 },
    { id: 3,  abbr: 'MAR', name: 'Marzec',      doy: 74,  days: 31, dailyYield: 2.30 },
    { id: 4,  abbr: 'KWI', name: 'Kwiecień',    doy: 105, days: 30, dailyYield: 3.50 },
    { id: 5,  abbr: 'MAJ', name: 'Maj',         doy: 135, days: 31, dailyYield: 4.30 },
    { id: 6,  abbr: 'CZE', name: 'Czerwiec',    doy: 166, days: 30, dailyYield: 4.55 },
    { id: 7,  abbr: 'LIP', name: 'Lipiec',      doy: 196, days: 31, dailyYield: 4.45 },
    { id: 8,  abbr: 'SIE', name: 'Sierpień',    doy: 227, days: 31, dailyYield: 3.90 },
    { id: 9,  abbr: 'WRZ', name: 'Wrzesień',    doy: 258, days: 30, dailyYield: 2.80 },
    { id: 10, abbr: 'PAŹ', name: 'Październik', doy: 288, days: 31, dailyYield: 1.60 },
    { id: 11, abbr: 'LIS', name: 'Listopad',    doy: 319, days: 30, dailyYield: 0.75 },
    { id: 12, abbr: 'GRU', name: 'Grudzień',    doy: 349, days: 31, dailyYield: 0.50 }
  ];

  // ===== STAN APLIKACJI =====
  P.state = {
    kWp: 10.0,
    monthIdx: 4,        // Maj domyślnie
    pvMode: 'avg',      // 'avg' = doba przeciętna (PVGIS), 'clear' = clear-sky (bezchmurnie)
    pvVariability: 0.5, // siła odchyleń dobowych PV [0..1] — zmienność pogody w miesiącu
    residents: 50,
    T_hot: 50,          // °C — temperatura docelowa CWU
    priceHeatGJ: 130,   // zł/GJ brutto — domyślna cena ciepła sieciowego (edytowalna z UI)
    heaterKW: 3.0,      // moc grzałki [kW]
    heaterThreshold: 0.1, // próg włączenia: PV >= threshold * heaterKW
    // Strategia grzałki, osobno dla strefy dziennej i nocnej taryfy elektrycznej:
    //   'off'          — grzałka wyłączona w danej strefie
    //   'off-grid'     — moc modulowana do nadwyżki PV (power diverter)
    //   'on-grid'      — moc modulowana proporcjonalnie do T_hot (pobór z PV + sieci, zawsze gdy T < T_set)
    //   'on-grid-eco'  — j.w., ale grzeje PC/grzałką tylko, gdy kWh ciepła z prądu (mix PV+sieć w bieżącej
    //                    strefie taryfy) wychodzi taniej niż kWh ciepła sieciowego (per urządzenie)
    heaterStratDay:   'off-grid',
    heaterStratNight: 'off-grid',
    tankL: 500,         // pojemność zasobnika [l]
    heaterTargetC: 50,  // °C — temperatura, do której grzeje grzałka (setpoint, niezależny od T_hot)
    // Pompa ciepła (PC) — równoległe źródło ciepła do CWU obok grzałki (Moduł 04)
    hpKW:         2.0,  // moc elektryczna PC [kW] (0 = PC wyłączona)
    hpCOPSummer:  3.5,  // COP letni — używany dla miesięcy Kwi–Wrz (mi ∈ [3..8])
    hpCOPWinter:  2.5,  // COP zimowy — używany dla miesięcy Paź–Mar
    hpGears:      2,    // liczba biegów PC; bieg k z N daje moc (k/N)·hpKW
    hpOnlyBandC:  5,    // °C — szerokość pasma "tylko PC" pod setpointem (strategia on-grid)
    circLossPct: 0.60,   // straty cyrkulacji jako ułamek energii użytecznej CWU (0..1)
    // Trasa pętli cyrkulacyjnej CWU:
    //   'eco'  — pętla wpięta w stary węzeł cieplny (poza zasobnikiem) — model dzisiejszy
    //   'tank' — pętla przepięta do naszego zasobnika; P_circ ciągle drenuje ciepło z zasobnika,
    //            mianownik pokrycia spada do energii użytecznej (kran), bilans rośnie
    circRoute: 'eco',
    // Moduł 03 — taryfa energii elektrycznej z sieci
    gridPriceDay:   1.20,   // zł/kWh — strefa dzienna
    gridPriceNight: 1.20,   // zł/kWh — strefa nocna
    gridDayStart:   6,      // godz. początku strefy dziennej (0–23)
    gridDayEnd:     22,     // godz. końca strefy dziennej (0–23)
    // Moduł 07 — inwestycja (ceny jednostkowe)
    pricePVkWp:    4500,    // zł / 1 kWp instalacji PV
    priceHeaterKW: 500,     // zł / 1 kW grzałki
    priceTank100:  1100,    // zł / 100 l zasobnika
    priceScada:    10000,   // zł — automatyka + SCADA (ryczałt)
    priceHPkWth:   3000,    // zł / 1 kW mocy grzewczej PC (kW × COP_średni)
    // Moduł 08 — optymalizacja (grid search)
    optMaxPayback: 5,       // maksymalny dopuszczalny czas zwrotu [lata]
    optLifetime:   20,      // zakładany okres życia inwestycji [lata]
    optObjective:  'profit' // kryterium sortowania: 'profit' | 'payback' | 'coverage'
  };

  // ===== SIATKA OPTYMALIZACJI (Moduł 08) =====
  // Zgrubne zbiory wartości przeszukiwane przez P.optimize() — grid search.
  P.OPT_GRID = {
    kWp:           [0, 5, 10, 15, 20, 30, 40, 50],
    heaterKW:      [0, 2, 5, 10, 15],
    tankL:         [300, 500, 1000, 2000, 3500, 5000],
    heaterTargetC: [50, 60, 70],
    hpKW:          [0, 3, 5, 8, 10, 12, 15],
    strat:         ['off', 'off-grid', 'on-grid', 'on-grid-eco']
  };

})(window.PVSIM);
