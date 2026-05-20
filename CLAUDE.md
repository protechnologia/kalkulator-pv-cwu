# PV.SIM — kalkulator fotowoltaiki z CWU

Interaktywny symulator fotowoltaiki dla budynków wielorodzinnych.
Działa bezpośrednio z systemu plików (`file://`) — bez serwera HTTP.
Napisany w czystym HTML/CSS/JS, bez frameworków i bundlerów.

## Uruchamianie

Otwórz `pv-sim.v0.6.html` w przeglądarce. Nie wymaga żadnej instalacji ani serwera.

## Struktura plików

```
pv-sim.v0.6.html      — jedyna strona HTML; ładuje CSS i JS w odpowiedniej kolejności
pv-sim.tokens.css     — zmienne CSS (kolory, tła, akcenty); bazowy kontener .pvsim
pv-sim.layout.css     — nagłówek, suwaki, siatka miesięcy, stopka, responsive
pv-sim.components.css — wykresy SVG, karty statystyk, separatory modułów, warianty kolorów
pv-sim.config.js      — stałe, MONTHS[], state{}, T_cold(), kWh_per_m3()
pv-sim.physics.js     — simulateDay(), simulateDHW(), simulateTank()
pv-sim.render.js      — fmt, smoothPath(), renderChart/Stats dla 3 modułów
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
- Parametry: liczba mieszkańców (1–200), temperatura docelowa T_hot (35–65°C)
- Profil godzinowy: Chmielewska 2025, Energies 18(17), 42 budynki w Polsce
- Temperatura wody zimnej: model sinusoidalny, min luty ~6°C, max sierpień ~16°C
- Taryfa: ECO Opole od 01.01.2026 → `P.PRICE_PER_KWH ≈ 0.7091 zł/kWh`

### Moduł 03 — Zasobnik z grzałką
- Parametry: moc grzałki (1–15 kW), próg włączenia (10–100%), pojemność zasobnika (100–1000 L)
- Model: 1-węzłowy (fully-mixed), 6 podkroków na godzinę
- Logika off-grid (power diverter): grzałka throttluje moc do nadwyżki PV,
  włącza się gdy `P_PV ≥ próg`, gdzie `próg = heaterThreshold × heaterKW`
- Termostat: max 60°C (granica higieniczna anty-Legionella)
- Straty: `UA(V) = UA_REF · (V/V_REF)^(2/3)`, klasa B/C wg PN-EN 12897

## Stan aplikacji

Cały stan UI trzymany jest w `P.state` (zdefiniowany w `config.js`):

```js
P.state = {
  kWp: 10.0,          // moc instalacji PV [kWp]
  monthIdx: 4,        // indeks miesiąca 0..11 (4 = maj)
  pvMode: 'avg',      // 'avg' | 'clear'
  residents: 50,      // liczba mieszkańców
  T_hot: 50,          // temperatura CWU [°C]
  heaterKW: 3.0,      // moc grzałki [kW]
  heaterThreshold: 0.1, // próg włączenia: PV >= threshold * heaterKW
  tankL: 500,         // pojemność zasobnika [L]
  buildingType: 'old' // 'old' | 'new' — straty cyrkulacji (60% / 35%)
}
```

Każda zmiana w UI → `P.update()` → trzy symulacje → sześć funkcji render.

## CSS — kolory akcentów

| Token                  | Kolor       | Moduł          |
|------------------------|-------------|----------------|
| `--pvsim-orange`       | #ff7a1a     | 01 PV          |
| `--pvsim-teal`         | #2dd4bf     | 02 CWU         |
| `--pvsim-amber`        | #f59e0b     | 03 Zasobnik    |

Warianty `-dim` (`--pvsim-orange-dim` itp.) używane jako tło aktywnych przycisków.

## Wykresy SVG

Wykresy generowane dynamicznie przez `render.js` jako inline SVG wstrzykiwany do `.pvsim-chart`.
Krzywe wygładzane interpolacją Catmull-Rom (prywatna `smoothPath()`).
Stałe osi Y: `P.Y_MAX_KW = 45`, `P.Y_MAX_M3H = 1.0`, `P.Y_MAX_KW_DHW = 60`, `P.Y_MAX_TEMP = 70`.

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
