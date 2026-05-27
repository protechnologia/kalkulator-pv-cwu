# PV.SIM — kalkulator fotowoltaiki z CWU

Interaktywny symulator fotowoltaiki dla budynków wielorodzinnych.
Działa bezpośrednio z systemu plików (`file://`) — bez serwera HTTP.
Napisany w czystym HTML/CSS/JS, bez frameworków i bundlerów.

## Uruchamianie

Otwórz `pv-sim.v1.8.html` w przeglądarce. Nie wymaga żadnej instalacji ani serwera.

## Struktura plików

```
pv-sim.v1.8.html      — jedyna strona HTML; ładuje CSS i JS w odpowiedniej kolejności
css/pv-sim.tokens.css     — zmienne CSS (kolory, tła, akcenty); bazowy kontener .pvsim
css/pv-sim.layout.css     — nagłówek, suwaki, siatka miesięcy, stopka, responsive
css/pv-sim.components.css — wykresy SVG, karty statystyk, separatory modułów, warianty kolorów
js/pv-sim.config.js      — stałe, MONTHS[], state{}, T_cold(), kWh_per_m3()
js/pv-sim.physics.js     — simulateDay(), simulateDHW(), simulateTank(), simulateTankMonth(), simulateTankYear(), computeInvestment()
js/pv-sim.optimize.js    — P.optimize() (grid search, Moduł 08)
js/pv-sim.render.js      — P.fmt, P._smoothPath() (helpery używane przez pliki render.mXX)
js/pv-sim.render.m01.js  — renderChart, renderStats, renderPVMonthChart (Moduł 01)
js/pv-sim.render.m02.js  — renderDHWChart, renderDHWStats (Moduł 02)
js/pv-sim.render.m03.js  — renderGridChart (Moduł 03)
js/pv-sim.render.m04.js  — renderTankChart, renderTankElecChart, renderHeatSplitChart, renderTankStats (Moduł 04)
js/pv-sim.render.m05.js  — renderMonthTankChart, renderMonthElecChart, renderMonthStats (Moduł 05)
js/pv-sim.render.m06.js  — renderYearChart, renderYearCoverChart, renderYearStats (Moduł 06)
js/pv-sim.render.m07.js  — renderInvestStats (Moduł 07)
js/pv-sim.render.m08.js  — renderOptimTable (Moduł 08)
js/pv-sim.app.js         — P.update(), init(), listenery suwaków i przycisków
```

### Kolejność ładowania (obowiązkowa)

CSS: `tokens` → `layout` → `components`
JS: `config` → `physics` → `optimize` → `render` → `render.m01` → `render.m02` → `render.m03` → `render.m04` → `render.m05` → `render.m06` → `render.m07` → `render.m08` → `app`

## Architektura JS

Wszystkie pliki JS współdzielą jeden globalny namespace `window.PVSIM` (alias `P`).
Każdy plik używa wzorca IIFE:

```js
window.PVSIM = window.PVSIM || {};
(function(P) {
  'use strict';
  P.coś = ...;
})(window.PVSIM);
```

**Dlaczego nie ES modules?** Chrome blokuje `import/export` przy protokole `file://`.
IIFE + `window.PVSIM` to bezpieczna alternatywa bez serwera.

Funkcje i zmienne widoczne tylko wewnątrz jednego pliku pozostają prywatne (bez `P.`).
Wszystko co używane przez inny plik musi być na namespace: `P.xxx`.

## Moduły aplikacji

### Moduł 01 — PV (fotowoltaika)
- Parametry: moc instalacji `kWp` (0–50, krok 0,5; 0 = PV wyłączone), miesiąc, tryb symulacji,
  zmienność pogody dobowej (suwak %, `P.state.pvVariability`)
- Tryb `avg` — skaluje do średniej dobowej z PVGIS (chmury wliczone)
- Tryb `clear` — bezchmurny dzień, skaler `P.CLEAR_SCALE = 1.4577`
- Model słońca: deklinacja Coopera (1969), model clear-sky Hottela
- Dwa wykresy: godzinowy wykres mocy reprezentatywnej doby (`renderChart`,
  `#pvsim-chart`) oraz słupkowy wykres produkcji dobowej PV przez cały miesiąc
  (`renderPVMonthChart`, `#pvsim-pv-month-chart`) — jeden słupek na dobę,
  z linią średniej dobowej; ujawnia zmienność pogody w obrębie miesiąca.
- Suwak zmienności pogody nie wpływa na godzinowy wykres reprezentatywnej doby,
  ale steruje rozrzutem słupków wykresu miesięcznego oraz symulacjami
  wielodobowymi modułów 05–08

### Moduł 02 — CWU (ciepła woda użytkowa)
- Parametry: liczba mieszkańców (1–1000), temperatura docelowa T_hot (35–65°C), cena energii cieplnej [zł/GJ]
- Profil godzinowy: Chmielewska 2025, Energies 18(17), 42 budynki w Polsce
- Temperatura wody zimnej: model sinusoidalny, min luty ~6°C, max sierpień ~16°C
- Taryfa: domyślnie `P.state.priceHeatGJ = 130 zł/GJ` (edytowalna z UI — pole „Cena ciepła")
- Straty cyrkulacji: `Q_circ = circLossPct × Q_useful` (kWh/dobę), rozsmarowane
  płasko na 24h jako stała moc `P_circ = Q_circ / 24` — **niezależna od
  godzinowego profilu rozbioru** (cyrkulacja to UA·ΔT pętli, nie funkcja
  chwilowego poboru). Sezonowa zmienność wchodzi przez `Q_useful` zależne od
  `T_cold(monthIdx)`: zimą `kwhM3` większe ⇒ `P_circ` ~30% wyższe niż latem
  (przy domyślnych ustawieniach: luty ≈ 0,256 kW, sierpień ≈ 0,198 kW).
  **Uwaga — uproszczenie:** fizycznie strata cyrkulacji to `UA_pętli · (T_loop − T_zewn)`,
  więc napędza ją temperatura otoczenia rur, **nie** `T_cold`. W modelu sezonowość
  wchodzi przez `T_cold(monthIdx)` tylko dlatego, że niskie `T_zewn` zimą koreluje
  z niskim `T_cold` (oba sterowane porą roku) — kierunek zmiany się zgadza,
  ale to korelacja, nie przyczyna. Na razie zostawione tak; docelowo warto
  przepisać na model `UA_pętli · (T_loop − T_zewn)` z osobnym profilem `T_zewn`.
  `P_circ` używane w Module 04 w trybie `circRoute='tank'` jako stały drenaż
  zasobnika w podkroku 1b ([physics.js:280](js/pv-sim.physics.js#L280)).

### Moduł 03 — Sieć (taryfa energii elektrycznej)
- Parametry: cena strefy dziennej [zł/kWh], cena strefy nocnej [zł/kWh], godziny strefy dziennej (start/koniec)
- Wartości domyślne: dzień 1,20 zł/kWh, noc 1,20 zł/kWh, strefa 6:00–22:00
- Wykres krokowy 24h — słupki fioletowe (dzień) i szare (noc), oś Y z ładnymi krokami
- Ceny stref i godziny granic taryfy wykorzystuje Moduł 04 (strategie grzałki, koszt energii z sieci)

### Moduł 04 — Zasobnik z grzałką + pompą ciepła
- Parametry: moc grzałki (0–15 kW, 0 = grzałka wyłączona), próg włączenia (10–100%), pojemność zasobnika (200–5000 L),
  temperatura docelowa zasobnika (0–70°C, suwak — wspólny setpoint pary PC+grzałka,
  oba urządzenia zatrzymują grzanie po jej osiągnięciu; `P.state.heaterTargetC`,
  niezależny od T_hot z Modułu 02 — nazwa pola historyczna, sprzed dodania PC),
  strategia grzałka + PC — wybierana osobno dla strefy dziennej i nocnej taryfy (Moduł 03)
- **Pompa ciepła** (drugie źródło ciepła w zasobniku, pracuje równolegle z grzałką):
  moc elektryczna `hpKW` (0–15 kW), liczba biegów `hpGears` (1–5, równe stopnie mocy
  `gear_k = k/N · hpKW`), pasmo „tylko PC" pod setpointem `hpOnlyBandC` (0–20 °C),
  sezonowy COP — `hpCOPSummer` (Kwi–Wrz) i `hpCOPWinter` (Paź–Mar), oba 2.0–5.0.
  `hpKW = 0` ⇒ PC wyłączona.
- W strategii `off-grid` PC ma priorytet: wybiera największy bieg, dla którego
  `(k/N)·hpKW ≤ nadwyżka PV`; grzałka dobiera resztę PV jak dotąd.
- W strategiach `on-grid` / `on-grid-eco`: gdy `T ∈ [T_set − hpOnlyBandC, T_set)` — pracuje tylko PC,
  bieg proporcjonalny do zapotrzebowania `k = ceil(req·N)`. Poniżej pasma PC bierze
  top bieg + dołącza grzałka modulowana wg `TANK_ONGRID_BAND`.
- Model: 1-węzłowy (fully-mixed), 6 podkroków na godzinę
- Cztery strategie pary PC+grzałka (osobno dla strefy dziennej i nocnej):
  - `off` — wyłączone w danej strefie
  - `off-grid` (power diverter) — moc throttlowana do nadwyżki PV,
    włącza się gdy `P_PV ≥ próg`, gdzie `próg = heaterThreshold × heaterKW`; energia z PV.
    Grzeje tylko do setpointu `heaterTargetC` — nadwyżka PV ponad to trafia do `Q_wasted`
  - `on-grid (zawsze)` (`'on-grid'`) — moc proporcjonalna: `heaterKW × clamp((heaterTargetC − T)/TANK_ONGRID_BAND, 0, 1)`;
    nadwyżkę PV wykorzystuje w pierwszej kolejności, resztę dobiera z sieci. Grzeje zawsze, gdy `T < T_set`
  - `on-grid (gdy taniej)` (`'on-grid-eco'`) — j.w., ale przed włączeniem PC/grzałki
    porównuje koszt kWh ciepła z prądu (mix PV+sieć w bieżącej strefie taryfy)
    z ceną kWh ciepła sieciowego (`priceHeatGJ / KWH_PER_GJ`). Per urządzenie:
    `cost_PC/kWh_th = (1 − udział PV) · cena strefy / COP`,
    `cost_grz/kWh_th = (1 − udział PV) · cena strefy`. Jeśli drożej niż ciepło
    sieciowe — dane urządzenie nie startuje (CWU zostaje na starym węźle).
    PC ma priorytet PV, grzałka liczy swój `udział PV` z resztą `P_PV − P_hp_el`
- Termostat: max 70°C (suwak `heaterTargetC` 0–70°C; powyżej 60°C — magazynowanie ciepła kosztem niższego COP PC)
- **Trasa cyrkulacji CWU** (`P.state.circRoute`, toggle „STARY WĘZEŁ" / „NASZ ZASOBNIK"):
  - `'eco'` (domyślne) — pętla cyrkulacji poza modelem zasobnika, `Q_saved` = sam kran.
  - `'tank'` — `P_circ` (kW) ciągle drenuje ciepło z zasobnika (krok 1b w podpętli),
    `Q_saved` obejmuje ciepło dostarczone do cyrkulacji (kran + pętla).
  - Mianownik pokrycia **niezależny od trasy** — zawsze `simDHW.totalEnergy`
    (użyteczna + cyrkulacja), bo fizyczna potrzeba CWU budynku jest stała.
- Straty: `UA(V) = UA_REF · (V/V_REF)^(2/3)`, klasa B/C wg PN-EN 12897
- Wykresy: temperatura zasobnika (tło grzania w osobnym odcieniu dla strefy
  dziennej i nocnej), słupkowy wykres mocy elektrycznej PC + grzałki
  (4-stos: PC·PV, grz·PV, PC·sieć, grz·sieć), słupkowy wykres podziału
  mocy cieplnej (PC vs grzałka, kwh ciepła dostarczonego do zasobnika)
  oraz wykres „Teoretyczna cena ciepła" — godzinowy marginalny koszt
  kWh ciepła z trzech źródeł: PC `(1−pvShare_PC)·cena_strefy / COP_sezonu`, grzałka
  `(1−pvShare_grz)·cena_strefy`, ciepło sieciowe `priceHeatGJ / KWH_PER_GJ`
  (linia stała); pvShare liczony przy pełnej mocy urządzenia (PC ma
  priorytet PV, grzałka bierze resztę)
- Statystyki: pokrycie CWU, bilans energii (Q_saved z rozbiciem
  `w tym X do starego węzła / w tym Y na cyrkulację` — drugi człon
  niezerowy tylko w trybie `tank`), godziny pracy grzałki i PC,
  ciepło z PC, zużycie prądu pary PC+grzałka (PV vs sieć), koszt
  energii z sieci wg cen stref z Modułu 03. Pod togglem trasy
  cyrkulacji wyświetla się tekstowy opis aktywnego wariantu.

### Moduł 05 — Symulacja miesięczna
- Symulacja ciągła zasobnika przez cały miesiąc (`days × 24 h`): pierwsza doba
  startuje zimna (`T_in`), każda następna dziedziczy temperaturę końcową
  poprzedniej. Po kilku dobach układ wchodzi w stan ustalony.
- Produkcja PV każdej doby jest skalowana dobowym mnożnikiem zmienności pogody
  (`P.dailyWeatherFactors()`): doby różnią się od pochmurnych (0) po clear-sky,
  ale średnia miesięczna PV pozostaje dokładnie zachowana. Siłę rozrzutu reguluje
  suwak `P.state.pvVariability` (Moduł 01); generator jest deterministyczny
  (`mulberry32`, ziarno `P.WEATHER_SEED + monthIdx`).
- Bez własnych kontrolek — dziedziczy parametry Modułu 04 (grzałka, zasobnik,
  strategie dzień/noc). Każda zmiana suwaka odświeża też Moduł 05.
- `P.simulateTankMonth()` wywołuje `P.simulateTank()` raz na dobę z temperaturą
  startową = `T_end` poprzedniej doby (opcjonalny 5. parametr `T_init`).
- Wykresy: temperatura zasobnika (ciągła linia, cały miesiąc) oraz słupkowy
  wykres dobowego bilansu energii elektrycznej pary PC + grzałki
  (jeden słupek na dobę, 4-stos: PC·PV, grz·PV, PC·sieć, grz·sieć).
- Statystyki miesięczne: pokrycie CWU, grzałka (h pracy + kWh ciepła), PC
  (h pracy + kWh ciepła), zużycie prądu — źródło (PV vs sieć) i — urządzenie
  (grzałka vs PC), koszt energii z sieci, ciepło zaoszczędzone oraz bilans
  miesięczny (oszczędność na cieple − koszt energii z sieci).

### Moduł 06 — Symulacja roczna
- Symulacja całego roku — `P.simulateTankYear()` wywołuje
  `P.simulateTankMonth()` dla każdego z 12 miesięcy, z osobnymi wejściami PV
  i CWU (produkcja PV oraz temperatura wody zimnej zmieniają się sezonowo).
  Każdy miesiąc liczony niezależnie (start zimny w pierwszej dobie).
- Bez własnych kontrolek — dziedziczy parametry modułów 01–04. Każda zmiana
  suwaka odświeża też Moduł 06.
- `P.simulateTankMonth()` przyjmuje opcjonalny 5. parametr `monthIdx`
  (domyślnie `P.state.monthIdx`), dzięki czemu można policzyć dowolny miesiąc.
- Wykresy: słupkowy wykres energii elektrycznej pary PC + grzałki
  (jeden słupek na miesiąc, 4-stos: PC·PV, grz·PV, PC·sieć, grz·sieć)
  — `P.renderYearChart()` — oraz
  słupkowy wykres miesięcznego pokrycia CWU (pokryte z układu vs brak,
  z etykietą % nad każdym słupkiem) — `P.renderYearCoverChart()`.
- Statystyki roczne (te same kafelki co M05 w skali roku): pokrycie CWU,
  grzałka (h + kWh ciepła), PC (h + kWh ciepła), zużycie prądu — źródło
  i — urządzenie, koszt energii z sieci, ciepło zaoszczędzone, bilans roczny.

### Moduł 07 — Inwestycja
- Kalkulator kosztu całej inwestycji i czasu jej zwrotu. Inwestycja
  obejmuje pięć pozycji: instalację PV, grzałki, pompę ciepła, zasobnik oraz
  automatykę + SCADA.
- Ma własne kontrolki — pięć suwaków cen jednostkowych (`pvsim-price-*`):
  cena PV [zł/kWp], cena grzałek [zł/kW], cena PC [zł / 1 kW grzewczej],
  cena zasobnika [zł/100 l], automatyka + SCADA [zł, ryczałt]. Domyślne wartości:
  4500 / 500 / 3000 / 1100 / 10000 (research rynkowy PL 2025).
- `P.computeInvestment(simYear)` liczy:
  `koszt = kWp·cenaPV + heaterKW·cenaGrzałki + hpKW·COP_śr·cenaPC
  + (tankL/100)·cenaZasobnika + cenaScada`
  (gdzie `COP_śr = (hpCOPSummer + hpCOPWinter)/2`)
  oraz `lata na zwrot = koszt ÷ bilans roczny netto`
  (`simYear.yearly.balancePLN`). Gdy bilans ≤ 0 → `paybackYears =
  Infinity`, panel pokazuje „—".
- Statystyki (2 panele): koszt inwestycji (z rozbiciem na 4 pozycje)
  oraz zwrot inwestycji w latach.

### Moduł 08 — Optymalizacja (grid search)
- Automatyczny dobór najlepszej konfiguracji PV, grzałki, PC i zasobnika. Użytkownik
  podaje maksymalny czas zwrotu inwestycji, zakładany okres życia oraz kryterium
  optymalizacji, a aplikacja przeszukuje siatkę kombinacji i prezentuje top 10.
- Ma własne kontrolki — dwa suwaki (`pvsim-opt-payback` 1–25 lat,
  `pvsim-opt-lifetime` 5–40 lat), 3-przyciskowy przełącznik kryterium
  (`pvsim-opt-objective-toggle` z `data-obj` = `profit`/`payback`/`coverage`),
  widget „Parametry siatki" (lista parametrów z checkboxami i bieżącą liczbą
  kombinacji), przycisk `pvsim-opt-run` (w trakcie pracy zmienia się w
  „Zatrzymaj ◼" i pozwala przerwać optymalizację) z paskiem postępu
  `pvsim-opt-progress` pokazującym licznik „N / total — ETA …" (ETA liczone
  z `performance.now()` w app.js, format s / min / h). Suwaki i przełącznik
  kryterium nie wywołują `P.update()`.
- `P.OPT_GRID` (`config.js`) definiuje przeszukiwaną siatkę: `kWp` (moc PV,
  `[0, 5, 10, 15, 20, 30, 40, 50]`), `heaterKW`
  (`[0, 2, 5, 10, 15]`), `hpKW` (moc PC, `[0, 3, 5, 8, 10, 12, 15]`),
  `tankL`, `heaterTargetC` (temperatura docelowa zasobnika) oraz
  `strat` (`off`/`off-grid`/`on-grid`/`on-grid-eco` dla strefy dziennej
  i nocnej). COP-y, liczba biegów PC oraz `heaterThreshold` nie są wymiarem
  siatki — czytane są z aktualnego `P.state` (próg włączenia ustawia user
  suwakiem w Module 04). Każdy wymiar można checkboxem wyłączyć — wtedy parametr jest
  przypięty do bieżącej wartości `P.state` (zamiast iterowania siatki).
- `P.optimize(maxPayback, lifetime, onProgress, enabled, cancelToken, objective)`
  (`optimize.js`) — asynchroniczna funkcja zwracająca `Promise`. Przeszukuje
  kombinacje w porcjach (24 na chunk, `setTimeout(0)` między porcjami,
  raportuje postęp przez `onProgress(frac, done, total)`), reużywa
  `P.simulateTankYear()` i `P.computeInvestment()`. `enabled` to mapa
  flag per parametr — wymiar z `false` używa tylko aktualnej wartości
  `P.state`. `cancelToken = { cancelled: bool }` pozwala przerwać między
  porcjami. Twardy filtr odrzuca warianty z `paybackYears > maxPayback` lub
  `balancePLN ≤ 0`. `objective` wybiera komparator: `'profit'` —
  `lifetimeProfit = bilans roczny × okres życia − koszt inwestycji` malejąco
  (domyślne), `'payback'` — `paybackYears` rosnąco, `'coverage'` —
  `coveragePct` malejąco; w każdym przypadku `lifetimeProfit` jest
  tiebreakerem. Funkcja nie mutuje `P.state` — buduje lokalny snapshot per
  kombinacja. Zwraca obiekt `{ results, cancelled, done, total }` z top 200
  wynikami.
- `P.renderOptimTable(results, emptyMsg)` (`render.js`) — renderuje tabelę
  wyników do `#pvsim-optim-table` (zamiast kart statystyk). Wiersze z
  identycznym wynikiem ekonomicznym (`cost`, `balancePLN`, `lifetimeProfit`)
  są łączone w jedną grupę: kolumna # pokazuje zakres rang (`1–3`), a w
  komórkach parametrów, w których członkowie się różnią, widać listę
  `v1 / v2 / v3`. Tabela pokazuje top 10 grup. Każdy wiersz ma przycisk
  „Przenieś →" (`data-row` = indeks lidera grupy w pełnej liście wyników),
  który przez `applyOptimRow()` w `app.js` wpisuje wartości do
  suwaków/przełączników Modułu 04. Przy braku wyników (`results` puste lub
  `null`) renderowana jest pusta tabela z nagłówkami i napisem
  `emptyMsg || 'brak wyników'` w wierszu.
- Moduł 08 **nie** jest częścią `P.update()` — search uruchamia tylko przycisk.

### Sidebar — stałe podsumowanie roczne
- `<aside class="pvsim-sidebar">` — panel `position: fixed` przy prawej krawędzi
  okna, stale widoczny podczas przewijania. Zawiera kopie 4 najważniejszych
  paneli statystyk Modułu 06: zużycie prądu, koszt energii z sieci, ciepło
  zaoszczędzone, bilans roczny (id-ki `pvsim-sb-*`).
- `P.renderYearStats()` wpisuje te same wartości równolegle do paneli Modułu 06
  i do sidebara (helper `set(txt, ...ids)`).
- Przycisk `pvsim-sidebar-toggle` pokazuje/ukrywa sidebar. Stan startowy zależy
  od szerokości okna: ≥ 1100 px → widoczny, mniej → ukryty. Ukrycie = klasa
  `.hidden` na `<aside>`.

### Pinezki
- Każda sekcja `.pvsim-chart-section` (w nagłówku) oraz każdy pojedynczy
  kafelek statystyk `.pvsim-stat` (w prawym górnym rogu kafelka,
  `position: absolute`) ma przycisk `.pvsim-pin` z emoji 📌 wpisany w HTML.
  `setupPins()` w `app.js` podpina obsługę kliknięć. Kafelek statystyk
  dodatkowo dostaje modyfikator `.pvsim-pin-stat` do kotwiczenia pinezki
  (mała, półprzezroczysta, pełna nieprzezroczystość przy hoverze kafelka).
- Klik pinezki dodaje klasę `.pinned` (`position: fixed`, prawy dolny róg,
  `z-index: 50`; szerokość 345 px dla wykresu, 220 px dla kafelka) i wstawia
  w oryginalnym miejscu pasiasty placeholder (`.pvsim-pin-placeholder`)
  o tej samej wysokości — brak skoku layoutu. Węzły DOM zostają na miejscu,
  więc `P.update()` renderuje do tych samych elementów.
- Wiele pinów = pionowy stos w rogu; `bottom` każdej przypiętej sekcji liczony
  jest dynamicznie z wysokości elementów poniżej (gap 12 px, dolny margines 16 px).
  `right` liczony jest z aktualnej szerokości prawego sidebara (jeśli widoczny —
  pinezki ustawiane są na lewo od niego, żeby ich nie przykrywał).
  Przeliczane przy pin/unpin, `window.resize` oraz przy zmianie klasy `.hidden`
  na sidebarze (MutationObserver).

## Stan aplikacji

Cały stan UI trzymany jest w `P.state` (zdefiniowany w `config.js`):

```js
P.state = {
  kWp: 10.0,            // moc instalacji PV [kWp]
  monthIdx: 4,          // indeks miesiąca 0..11 (4 = maj)
  pvMode: 'avg',        // 'avg' | 'clear'
  pvVariability: 0.5,   // siła odchyleń dobowych PV [0..1] (zmienność pogody)
  residents: 50,        // liczba mieszkańców
  T_hot: 50,            // temperatura CWU [°C]
  heaterKW: 3.0,        // moc grzałki [kW]
  heaterThreshold: 0.1, // próg włączenia: PV >= threshold * heaterKW
  heaterStratDay:   'off-grid', // strategia w strefie dziennej: 'off'|'off-grid'|'on-grid'|'on-grid-eco'
  heaterStratNight: 'off-grid', // strategia w strefie nocnej
  tankL: 500,           // pojemność zasobnika [L]
  heaterTargetC: 50,    // temperatura docelowa zasobnika [°C] — wspólny setpoint pary PC+grzałka, niezależny od T_hot
  // Moduł 04 — pompa ciepła (drugie źródło ciepła)
  hpKW:         2.0,    // moc elektryczna PC [kW] (0 = PC wyłączona)
  hpCOPSummer:  3.5,    // COP letni (Kwi–Wrz)
  hpCOPWinter:  2.5,    // COP zimowy (Paź–Mar)
  hpGears:      2,      // liczba biegów PC (1–5; równe stopnie mocy k/N · hpKW)
  hpOnlyBandC:  5,      // °C — pasmo „tylko PC" pod setpointem (on-grid)
  circLossPct: 0.60,    // straty cyrkulacji jako ułamek energii użytecznej CWU (suwak 0..1; kotwice 0.35 / 0.60 z P.CIRC_LOSS)
  circRoute: 'eco',     // 'eco' | 'tank' — pętla cyrkulacji wpięta w stary węzeł ECO (domyślnie) lub w nasz zasobnik
  // Moduł 03 — taryfa energii elektrycznej (on-grid w przygotowaniu)
  gridPriceDay:   1.20,   // zł/kWh — strefa dzienna
  gridPriceNight: 1.20,   // zł/kWh — strefa nocna
  gridDayStart:   6,      // godz. początku strefy dziennej
  gridDayEnd:     22,     // godz. końca strefy dziennej
  // Moduł 07 — inwestycja (ceny jednostkowe)
  pricePVkWp:    4500,    // zł / 1 kWp instalacji PV
  priceHeaterKW: 500,     // zł / 1 kW grzałki
  priceTank100:  1100,    // zł / 100 l zasobnika
  priceScada:    10000,   // zł — automatyka + SCADA (ryczałt)
  priceHPkWth:   3000,    // zł / 1 kW grzewczej PC
  // Moduł 08 — optymalizacja (grid search)
  optMaxPayback: 5,        // maksymalny akceptowany czas zwrotu [lata]
  optLifetime:   20,       // zakładany okres życia inwestycji [lata]
  optObjective:  'profit'  // kryterium sortowania: 'profit' | 'payback' | 'coverage'
}
```

Każda zmiana w UI → `P.update()` → pięć symulacji + `computeInvestment()` + `renderGridChart()` → funkcje render wszystkich modułów.

## CSS — kolory akcentów

| Token                  | Kolor       | Moduł          |
|------------------------|-------------|----------------|
| `--pvsim-orange`       | #ff7a1a     | 01 PV          |
| `--pvsim-teal`         | #2dd4bf     | 02 CWU         |
| `--pvsim-violet`       | #a78bfa     | 03 Sieć        |
| `--pvsim-amber`        | #f59e0b     | 04 Zasobnik    |
| `--pvsim-sky`          | #38bdf8     | 05 Sym. mies.  |
| `--pvsim-lime`         | #a3e635     | 06 Sym. roczna |
| `--pvsim-rose`         | #fb7185     | 07 Inwestycja  |
| `--pvsim-fuchsia`      | #e879f9     | 08 Optymalizacja |

Warianty `-dim` (`--pvsim-orange-dim` itp.) używane jako tło aktywnych przycisków.

## Kafelki statystyk

Kafelek = `<div class="pvsim-stat KOLOR cat-KAT">` z `<div class="pvsim-stat-label">…</div>`
i `<div class="pvsim-stat-value">…</div>`. Wartość może mieć trzy warianty:

- **single** — sam `<span>` z liczbą + `<span class="unit">`. Bez dodatkowej klasy.
- **dual** — `<div class="pvsim-stat-value dual">` z dwoma wierszami:
  `<div class="primary">…</div>` (24px, kolor akcentu) i `<div class="secondary">…</div>`
  (13px, prefiks `↳`). Używane np. w M02 ZUŻYCIE WODY (doba ↳ miesiąc).
- **triple** — ta sama `dual`, dodatkowy `<div class="tertiary">…</div>` (te same style
  co `.secondary`, też z prefiksem `↳`). Używane w M02 dla wartości doba ↳ miesiąc ↳ rok
  (ENERGIA, KOSZT, ZUŻYCIE WODY).

Klasy `cat-heat` / `cat-elec` / `cat-money` ustawiają delikatne tło tematyczne (~6–8%
przez `color-mix`), niezależnie od koloru akcentu. Kolor akcentu (np. `teal`, `amber`)
maluje tylko liczbę `primary`.

## Wykresy SVG

Wykresy generowane dynamicznie przez `render.js` jako inline SVG wstrzykiwany do `.pvsim-chart`.
Krzywe wygładzane interpolacją Catmull-Rom (prywatna `smoothPath()`).
Stałe osi Y: `P.Y_MAX_KW = 45`, `P.Y_MAX_M3H = 1.0`, `P.Y_MAX_TEMP = 70`.
Moduły 02, 04, 05 i 06 dobierają `yMax` dynamicznie z ładnymi krokami osi (nie ma stałej).
Moduł 05 rozciąga oś X na `days × 24` godzin (cały miesiąc), z siatką pionową co dobę.
Moduł 06 ma 12 słupków na osi X (jeden na miesiąc, etykiety = skróty miesięcy).

## Dane źródłowe

- Produkcja PV (`dailyYield`): PVGIS, Polska, nachylenie 30°, optymalne azymut
- Lokalizacja: Opole, φ = 50.67°N (`P.LAT`)
- DHW profil: Chmielewska A. (2025), Energies 18(17), DOI: 10.3390/en18174578
- Temperatura wody zimnej: Górka A., RynekInstalacyjny.pl, 90 punktów sieci PL
- Taryfa ciepła: ECO Opole, cennik od 01.01.2026, budynki wielorodzinne

## Typowe zadania

**Zmiana lokalizacji** → `P.LAT` w `config.js`, zaktualizuj `dailyYield` w `P.MONTHS[]`

**Zmiana taryfy** → wartość domyślna `priceHeatGJ` w `P.state` (`config.js`); użytkownik może też wpisać własną w polu „Cena ciepła" Modułu 02. Przelicznik `P.KWH_PER_GJ` jest stały (fizyka).

**Nowy moduł** → dodaj nowy plik JS z wzorcem IIFE, dodaj `<script>` na końcu HTML

**Zmiana zakresu suwaka** → atrybut `min`/`max` w HTML + ewentualnie wartość domyślna w `P.state`

**Nowy kolor akcentu** → zdefiniuj zmienne w `tokens.css`, dodaj warianty `.pvsim-slider.nowy-kolor` w `components.css`

## TODO

**Sprzężenie zwrotne T_out → rozbiór (samoograniczanie pokrycia)** — obecnie
profil rozbioru `P.DHW_PROFILE` daje stałą dobową objętość niezależną od
temperatury, jaką nasz zasobnik wypuszcza na blok. W rzeczywistości jeśli
woda wychodząca jest zbyt gorąca (np. `T_zas > T_hot`), mieszkańcy mieszają
ją z większą ilością zimnej w baterii — pobór ciepła `Q_saved` rośnie wolniej
niż masowo `dailyM3`, a pokrycie CWU nie chce przekraczać 100%, bo realna
potrzeba użytkownika to `Q_użyteczne = m · cw · (T_hot − T_in)` niezależnie
od tego, jak gorącą wodę dostarczamy. Dziś `coveragePct` może urosnąć powyżej
100%, bo licznik liczy „ciepło włożone do strumienia", nie „ciepło dostarczone
użytkownikowi". Fix: cap energetyczny — `Q_saved_h += m_per · cw · min(T − T_in,
T_hot − T_in)` (ekwiwalent: użytkownik mieszający wodę przy baterii). Skutek:
pokrycie naturalnie spada do ≤ 100%, optymalizator przestaje premiować
nadmierny `heaterTargetC` bez realnego wykorzystania nadwyżek PV.
Powiązane z dawnym TODO „Cap `Q_saved` przez `T_hot`" z commita `8558bbd`.

**Strategia „grzanie przepływowe + rozładowany zasobnik"** — dziś para PC+grzałka
grzeje masę zasobnika do `T_set` i utrzymuje ją (zarówno w dzień, jak i w nocy).
Pomysł: w nocy (i w dzień dla spójności) grzejemy **tylko tyle wody, ile akurat
idzie na rozbiór** — bez akumulacji ciepła w głównym zbiorniku. Cel: trzymać
duży zasobnik „rozładowany" (chłodny), żeby w dzień miał gdzie przyjąć tanie
ciepło z PV — większa pojemność termiczna ⇒ więcej kWh PV zatkamy bez
przekroczenia setpointu, mniej `Q_wasted`. Dwa warianty realizacji fizycznej:
(a) **przepływowy podgrzewacz** wpięty między wyjściem z głównego zasobnika
a punktami poboru, zasilany ciepłem z PC+grzałki — duży zasobnik tylko
gromadzi ciepło z PV, ciepła woda do kranów leci przez podgrzewacz;
(b) **mały równoległy zasobnik** wpięty obok dużego, przełączany zaworem —
nocą rozbiór z małego, dzień ładuje duży, w razie potrzeby przełączamy
strumień. W modelu: dodać typ obiektu/strategii, którego logika grzania
ignoruje setpoint masy zasobnika i grzeje wyłącznie strumień poboru w danej
godzinie (lub utrzymuje stały, niski `T_zas` z opcjonalnym buforem rezerwy).

## Commity

- Komunikat commita: jedno zdanie, po polsku.
- Bez stopki `Co-Authored-By`.
- Zaczynaj od najważniejszej zmiany w zestawie.
