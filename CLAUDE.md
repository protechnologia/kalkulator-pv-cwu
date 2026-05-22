# PV.SIM — kalkulator fotowoltaiki z CWU

Interaktywny symulator fotowoltaiki dla budynków wielorodzinnych.
Działa bezpośrednio z systemu plików (`file://`) — bez serwera HTTP.
Napisany w czystym HTML/CSS/JS, bez frameworków i bundlerów.

## Uruchamianie

Otwórz `pv-sim.v1.1.html` w przeglądarce. Nie wymaga żadnej instalacji ani serwera.

## Struktura plików

```
pv-sim.v1.1.html      — jedyna strona HTML; ładuje CSS i JS w odpowiedniej kolejności
pv-sim.tokens.css     — zmienne CSS (kolory, tła, akcenty); bazowy kontener .pvsim
pv-sim.layout.css     — nagłówek, suwaki, siatka miesięcy, stopka, responsive
pv-sim.components.css — wykresy SVG, karty statystyk, separatory modułów, warianty kolorów
pv-sim.config.js      — stałe, MONTHS[], state{}, T_cold(), kWh_per_m3()
pv-sim.physics.js     — simulateDay(), simulateDHW(), simulateTank(), simulateTankMonth(), simulateTankYear(), computeInvestment(), optimize()
pv-sim.render.js      — fmt, smoothPath(), renderChart/Stats dla 8 modułów
pv-sim.app.js         — P.update(), init(), listenery suwaków i przycisków
```

### Kolejność ładowania (obowiązkowa)

CSS: `tokens` → `layout` → `components`
JS: `config` → `physics` → `render` → `app`

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
- Parametry: moc instalacji `kWp` (1–100), miesiąc, tryb symulacji
- Tryb `avg` — skaluje do średniej dobowej z PVGIS (chmury wliczone)
- Tryb `clear` — bezchmurny dzień, skaler `P.CLEAR_SCALE = 1.4577`
- Model słońca: deklinacja Coopera (1969), model clear-sky Hottela

### Moduł 02 — CWU (ciepła woda użytkowa)
- Parametry: liczba mieszkańców (1–200), temperatura docelowa T_hot (35–65°C), cena energii cieplnej [zł/GJ]
- Profil godzinowy: Chmielewska 2025, Energies 18(17), 42 budynki w Polsce
- Temperatura wody zimnej: model sinusoidalny, min luty ~6°C, max sierpień ~16°C
- Taryfa: ECO Opole od 01.01.2026 → domyślnie `P.PRICE_PER_GJ = 196.95 zł/GJ` (edytowalna z UI)

### Moduł 03 — Sieć (taryfa energii elektrycznej)
- Parametry: cena strefy dziennej [zł/kWh], cena strefy nocnej [zł/kWh], godziny strefy dziennej (start/koniec)
- Wartości domyślne: G12 Tauron 2026 — dzień 0,6950 zł/kWh, noc 0,3500 zł/kWh, strefa 6:00–22:00
- Wykres krokowy 24h — słupki fioletowe (dzień) i szare (noc), oś Y z ładnymi krokami
- Ceny stref i godziny granic taryfy wykorzystuje Moduł 04 (strategie grzałki, koszt energii z sieci)

### Moduł 04 — Zasobnik z grzałką
- Parametry: moc grzałki (1–15 kW), próg włączenia (10–100%), pojemność zasobnika (100–1000 L),
  strategia grzałki — wybierana osobno dla strefy dziennej i nocnej taryfy (Moduł 03)
- Model: 1-węzłowy (fully-mixed), 6 podkroków na godzinę
- Trzy strategie grzałki:
  - `off` — grzałka wyłączona w danej strefie
  - `off-grid` (power diverter) — moc throttlowana do nadwyżki PV,
    włącza się gdy `P_PV ≥ próg`, gdzie `próg = heaterThreshold × heaterKW`; energia z PV.
    Grzeje tylko do setpointu `T_hot` — nadwyżka PV ponad to trafia do `Q_wasted`
  - `on-grid` — moc proporcjonalna: `heaterKW × clamp((T_hot − T)/TANK_ONGRID_BAND, 0, 1)`;
    nadwyżkę PV wykorzystuje w pierwszej kolejności, resztę dobiera z sieci
- Termostat: max 60°C (granica higieniczna anty-Legionella)
- Straty: `UA(V) = UA_REF · (V/V_REF)^(2/3)`, klasa B/C wg PN-EN 12897
- Wykresy: temperatura zasobnika (tło grzania w osobnym odcieniu dla strefy
  dziennej i nocnej) oraz słupkowy wykres mocy elektrycznej grzałki (PV vs sieć)
- Statystyki: pokrycie CWU, godziny pracy, zużycie prądu (PV vs sieć),
  koszt energii z sieci wg cen stref z Modułu 03

### Moduł 05 — Symulacja miesięczna
- Symulacja ciągła zasobnika przez cały miesiąc (`days × 24 h`): pierwsza doba
  startuje zimna (`T_in`), każda następna dziedziczy temperaturę końcową
  poprzedniej. Po kilku dobach układ wchodzi w stan ustalony.
- Bez własnych kontrolek — dziedziczy parametry Modułu 04 (grzałka, zasobnik,
  strategie dzień/noc). Każda zmiana suwaka odświeża też Moduł 05.
- `P.simulateTankMonth()` wywołuje `P.simulateTank()` raz na dobę z temperaturą
  startową = `T_end` poprzedniej doby (opcjonalny 5. parametr `T_init`).
- Wykresy: temperatura zasobnika (ciągła linia, cały miesiąc) oraz słupkowy
  wykres dobowego bilansu energii elektrycznej grzałki (jeden słupek na dobę,
  PV vs sieć).
- Statystyki miesięczne: pokrycie CWU, godziny pracy grzałki, zużycie prądu
  (PV vs sieć), koszt energii z sieci, ciepło zaoszczędzone oraz bilans
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
- Wykres: jeden słupkowy wykres energii elektrycznej grzałki (jeden słupek na
  miesiąc, PV vs sieć) — `P.renderYearChart()`.
- Statystyki roczne: pokrycie CWU, godziny pracy grzałki, zużycie prądu
  (PV vs sieć), koszt energii z sieci, ciepło zaoszczędzone, bilans roczny.

### Moduł 07 — Inwestycja
- Kalkulator kosztu całej inwestycji i czasu jej zwrotu. Inwestycja
  obejmuje cztery pozycje: instalację PV, grzałki, zasobnik oraz
  automatykę + SCADA.
- Ma własne kontrolki — cztery suwaki cen jednostkowych (`pvsim-price-*`):
  cena PV [zł/kWp], cena grzałek [zł/kW], cena zasobnika [zł/100 l],
  automatyka + SCADA [zł, ryczałt]. Domyślne wartości: 4500 / 500 /
  1100 / 10000 (research rynkowy PL 2025).
- `P.computeInvestment(simYear)` liczy:
  `koszt = kWp·cenaPV + heaterKW·cenaGrzałki + (tankL/100)·cenaZasobnika
  + cenaScada` oraz `lata na zwrot = koszt ÷ bilans roczny netto`
  (`simYear.yearly.balancePLN`). Gdy bilans ≤ 0 → `paybackYears =
  Infinity`, panel pokazuje „—".
- Statystyki (2 panele): koszt inwestycji (z rozbiciem na 4 pozycje)
  oraz zwrot inwestycji w latach.

### Moduł 08 — Optymalizacja (grid search)
- Automatyczny dobór najlepszej konfiguracji grzałki i zasobnika. Użytkownik
  podaje maksymalny czas zwrotu inwestycji oraz zakładany okres życia, a
  aplikacja przeszukuje siatkę kombinacji i prezentuje 3 najlepsze warianty.
- Ma własne kontrolki — dwa suwaki (`pvsim-opt-payback` 1–25 lat,
  `pvsim-opt-lifetime` 5–40 lat) oraz przycisk `pvsim-opt-run` z paskiem
  postępu `pvsim-opt-progress`. Suwaki nie wywołują `P.update()`.
- `P.OPT_GRID` (`config.js`) definiuje przeszukiwaną siatkę: `heaterKW`,
  `threshold`, `tankL` oraz `strat` (`off`/`off-grid`/`on-grid` dla strefy
  dziennej i nocnej).
- `P.optimize(maxPayback, lifetime, onProgress)` (`physics.js`) — asynchroniczna
  funkcja zwracająca `Promise`. Przeszukuje kombinacje w porcjach (24 na chunk,
  `setTimeout(0)` między porcjami, raportuje postęp przez `onProgress(frac)`),
  reużywa `P.simulateTankYear()` i `P.computeInvestment()`. Pruning: gdy żadna
  strefa nie używa `off-grid`, próg iterowany jest tylko raz. Kryterium:
  `lifetimeProfit = bilans roczny × okres życia − koszt inwestycji`. Twardy
  filtr odrzuca warianty z `paybackYears > maxPayback` lub `balancePLN ≤ 0`.
  Po zakończeniu przywraca pierwotny `P.state`. Zwraca top 3.
- `P.renderOptimTable(results)` (`render.js`) — renderuje tabelę wyników do
  `#pvsim-optim-table` (zamiast kart statystyk). Każdy wiersz ma przycisk
  „Przenieś →" (`data-row`), który przez `applyOptimRow()` w `app.js` wpisuje
  wartości do suwaków/przełączników Modułu 04.
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
  residents: 50,        // liczba mieszkańców
  T_hot: 50,            // temperatura CWU [°C]
  heaterKW: 3.0,        // moc grzałki [kW]
  heaterThreshold: 0.1, // próg włączenia: PV >= threshold * heaterKW
  heaterStratDay:   'off-grid', // strategia w strefie dziennej: 'off'|'off-grid'|'on-grid'
  heaterStratNight: 'off-grid', // strategia w strefie nocnej
  tankL: 500,           // pojemność zasobnika [L]
  buildingType: 'old',  // 'old' | 'new' — straty cyrkulacji (60% / 35%)
  // Moduł 03 — taryfa energii elektrycznej (on-grid w przygotowaniu)
  gridPriceDay:   0.6950, // zł/kWh — strefa dzienna
  gridPriceNight: 0.3500, // zł/kWh — strefa nocna
  gridDayStart:   6,      // godz. początku strefy dziennej
  gridDayEnd:     22,     // godz. końca strefy dziennej
  // Moduł 07 — inwestycja (ceny jednostkowe)
  pricePVkWp:    4500,    // zł / 1 kWp instalacji PV
  priceHeaterKW: 500,     // zł / 1 kW grzałki
  priceTank100:  1100,    // zł / 100 l zasobnika
  priceScada:    10000,   // zł — automatyka + SCADA (ryczałt)
  // Moduł 08 — optymalizacja (grid search)
  optMaxPayback: 5,       // maksymalny akceptowany czas zwrotu [lata]
  optLifetime:   20       // zakładany okres życia inwestycji [lata]
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

**Zmiana taryfy** → `P.PRICE_PER_GJ` w `config.js` (reszta oblicza się automatycznie)

**Nowy moduł** → dodaj nowy plik JS z wzorcem IIFE, dodaj `<script>` na końcu HTML

**Zmiana zakresu suwaka** → atrybut `min`/`max` w HTML + ewentualnie wartość domyślna w `P.state`

**Nowy kolor akcentu** → zdefiniuj zmienne w `tokens.css`, dodaj warianty `.pvsim-slider.nowy-kolor` w `components.css`

## Commity

- Komunikat commita: jedno zdanie, po polsku.
- Bez stopki `Co-Authored-By`.
- Zaczynaj od najważniejszej zmiany w zestawie.
