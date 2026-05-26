# PV.SIM — kalkulator fotowoltaiki z CWU

Interaktywny symulator fotowoltaiki dla budynków wielorodzinnych.
Działa bezpośrednio z systemu plików (`file://`) — bez serwera HTTP.
Napisany w czystym HTML/CSS/JS, bez frameworków i bundlerów.

## Uruchamianie

Otwórz `pv-sim.v1.5.html` w przeglądarce. Nie wymaga żadnej instalacji ani serwera.

## Struktura plików

```
pv-sim.v1.5.html      — jedyna strona HTML; ładuje CSS i JS w odpowiedniej kolejności
pv-sim.tokens.css     — zmienne CSS (kolory, tła, akcenty); bazowy kontener .pvsim
pv-sim.layout.css     — nagłówek, suwaki, siatka miesięcy, stopka, responsive
pv-sim.components.css — wykresy SVG, karty statystyk, separatory modułów, warianty kolorów
pv-sim.config.js      — stałe, MONTHS[], state{}, T_cold(), kWh_per_m3()
pv-sim.physics.js     — simulateDay(), simulateDHW(), simulateTank(), simulateTankMonth(), simulateTankYear(), computeInvestment()
pv-sim.optimize.js    — P.optimize() (grid search, Moduł 08)
pv-sim.render.js      — fmt, smoothPath(), renderChart/Stats dla 8 modułów
pv-sim.app.js         — P.update(), init(), listenery suwaków i przycisków
```

### Kolejność ładowania (obowiązkowa)

CSS: `tokens` → `layout` → `components`
JS: `config` → `physics` → `optimize` → `render` → `app`

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
- W strategii `on-grid`: gdy `T ∈ [T_set − hpOnlyBandC, T_set)` — pracuje tylko PC,
  bieg proporcjonalny do zapotrzebowania `k = ceil(req·N)`. Poniżej pasma PC bierze
  top bieg + dołącza grzałka modulowana wg `TANK_ONGRID_BAND`.
- Model: 1-węzłowy (fully-mixed), 6 podkroków na godzinę
- Trzy strategie grzałki:
  - `off` — grzałka wyłączona w danej strefie
  - `off-grid` (power diverter) — moc throttlowana do nadwyżki PV,
    włącza się gdy `P_PV ≥ próg`, gdzie `próg = heaterThreshold × heaterKW`; energia z PV.
    Grzeje tylko do setpointu `heaterTargetC` — nadwyżka PV ponad to trafia do `Q_wasted`
  - `on-grid` — moc proporcjonalna: `heaterKW × clamp((heaterTargetC − T)/TANK_ONGRID_BAND, 0, 1)`;
    nadwyżkę PV wykorzystuje w pierwszej kolejności, resztę dobiera z sieci
- Termostat: max 70°C (suwak `heaterTargetC` 0–70°C; powyżej 60°C — magazynowanie ciepła kosztem niższego COP PC)
- Straty: `UA(V) = UA_REF · (V/V_REF)^(2/3)`, klasa B/C wg PN-EN 12897
- Wykresy: temperatura zasobnika (tło grzania w osobnym odcieniu dla strefy
  dziennej i nocnej), słupkowy wykres mocy elektrycznej PC + grzałki
  (4-stos: PC·PV, grz·PV, PC·sieć, grz·sieć) oraz słupkowy wykres podziału
  mocy cieplnej (PC vs grzałka, kwh ciepła dostarczonego do zasobnika)
- Statystyki: pokrycie CWU, godziny pracy grzałki i PC, ciepło z PC,
  zużycie prądu pary PC+grzałka (PV vs sieć), koszt energii z sieci
  wg cen stref z Modułu 03

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
  wykres dobowego bilansu energii elektrycznej grzałki (jeden słupek na dobę,
  PV vs sieć).
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
  (jeden słupek na miesiąc, PV vs sieć) — `P.renderYearChart()` — oraz
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
  `threshold`, `tankL`, `heaterTargetC` (temperatura docelowa zasobnika) oraz
  `strat` (`off`/`off-grid`/`on-grid` dla strefy dziennej i nocnej). COP-y
  i liczba biegów PC nie są wymiarem siatki — czytane są z aktualnego
  `P.state`. Każdy wymiar można checkboxem wyłączyć — wtedy parametr jest
  przypięty do bieżącej wartości `P.state` (zamiast iterowania siatki).
- `P.optimize(maxPayback, lifetime, onProgress, enabled, cancelToken, objective)`
  (`optimize.js`) — asynchroniczna funkcja zwracająca `Promise`. Przeszukuje
  kombinacje w porcjach (24 na chunk, `setTimeout(0)` między porcjami,
  raportuje postęp przez `onProgress(frac, done, total)`), reużywa
  `P.simulateTankYear()` i `P.computeInvestment()`. `enabled` to mapa
  flag per parametr — wymiar z `false` używa tylko aktualnej wartości
  `P.state`. `cancelToken = { cancelled: bool }` pozwala przerwać między
  porcjami. Pruning: gdy obie strategie = `off`, próg iterowany jest tylko
  raz (próg nieużywany przy całkowicie wyłączonym grzaniu pary PC+grzałka).
  Twardy filtr odrzuca warianty z `paybackYears > maxPayback` lub
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
  heaterStratDay:   'off-grid', // strategia w strefie dziennej: 'off'|'off-grid'|'on-grid'
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

**Cap `Q_saved` przez `T_hot`** ([pv-sim.physics.js:252](pv-sim.physics.js#L252)) —
obecnie `Q_saved_h += m_per * cw * max(T − T_in, 0)`, gdzie `T` to faktyczna
temperatura zasobnika (do `heaterTargetC`, max 60°C). Jeśli `heaterTargetC >
T_hot` (np. grzejemy do 60 żeby zmagazynować ciepło na pochmurne dni, a
użytkownik chciał 50), obecny model liczy oszczędność do 60°C — ale bazowy
ECO grzałby tylko do `T_hot`, więc nadwyżka to magazynowanie, nie usługa.
Fix: `const T_eff = Math.min(T, ps.T_hot); Q_saved_h += m_per * cw *
max(T_eff − T_in, 0);`. Skutek: niższy `balancePLN`/`lifetimeProfit` przy
nadgrzanym setpointe, optymalizator przestaje premiować wysokie
`heaterTargetC` bez realnego pokrycia w wykorzystaniu nadwyżek PV.
`coveragePct` przestaje też móc przekraczać 100%.

**Przełącznik trasy cyrkulacji CWU** (stary węzeł ECO ↔ nasz zasobnik) —
dodać do Modułu 04 wybór, czy pętla cyrkulacyjna pozostaje wpięta do
istniejącego węzła cieplnego, czy przepinamy ją do naszego zasobnika.
Przepięcie ma sens technologiczny (np. schładzanie wody wyjściowej, żeby
nie przekraczała ~50°C), ale wnosi dodatkowy strumień ciepła z powrotu
cyrkulacji do bilansu zasobnika — trzeba oszacować jego wielkość, prawdopodobnie
korelując z `P.state.circLossPct` (kotwice 35%/60% w `P.CIRC_LOSS`).
Skutek: rośnie zapotrzebowanie ciepła pokrywane przez parę
PC+grzałka, zmienia się bilans i ekonomia.
Powiązany problem: **mianownik `coveragePct`**. Obecnie pokrycie liczone jest
względem energii całkowitej (użyteczna + cyrkulacja). Po przepięciu cyrkulacji
do naszego zasobnika mianownikiem powinna być **stara energia użyteczna** —
porównujemy to, co dostarczyliśmy użytkownikowi, z tym, co użytkownik realnie
potrzebuje (ciepła woda u kranu), a nie z całkowitym zużyciem starego źródła
(straty cyrkulacji nie są „usługą" dla użytkownika). Inaczej pokrycie sztucznie
spadnie wraz z dodaniem strat cyrkulacji do bilansu zasobnika.

**Stałe straty cyrkulacji w skali roku** — obecnie straty cyrkulacji liczone
są jako procent miesięcznej energii użytecznej, a ta zależy od `T_cold`
(sezonowo zmienna), więc straty mocno wahają się z miesiąca na miesiąc.
W rzeczywistości straty cyrkulacji są w przybliżeniu stałe (zależą od długości
i izolacji pętli, nie od temperatury wody zimnej). Fix: policzyć roczną
energię użyteczną, zaaplikować procent strat raz, a uzyskaną wartość rozdzielić
równomiernie na doby (np. `Q_circ_per_day = Q_useful_year · pctCirc / 365`).
Skutek: bardziej realistyczny profil zapotrzebowania ciepła, brak sztucznych
sezonowych skoków strat cyrkulacji.

**Dwa odcienie na słupkach PV/sieć — rozróżnienie PC vs grzałka** — na wykresach
energii elektrycznej, które obecnie pokazują tylko podział PV vs sieć (M05
dobowy, M06 miesięczny), dodać drugi odcień w obrębie każdego segmentu, żeby
od razu było widać czy energia poszła do PC czy do grzałki. Np. PV ciemny =
PV·PC, PV jasny = PV·grzałka; sieć ciemna = sieć·PC, sieć jasna = sieć·grzałka.
Wymaga 4-stack zamiast obecnego 2-stack (M04 już ma 4-stack — wzorzec do
naśladowania). Wartości `Q_pc_pv`, `Q_pc_grid`, `Q_heater_pv`, `Q_heater_grid`
są dostępne na poziomie doby z `simulateTank()`, więc dane już istnieją —
trzeba je tylko propagować w górę przez `simulateTankMonth/Year` i wyrenderować.

## Commity

- Komunikat commita: jedno zdanie, po polsku.
- Bez stopki `Co-Authored-By`.
- Zaczynaj od najważniejszej zmiany w zestawie.
