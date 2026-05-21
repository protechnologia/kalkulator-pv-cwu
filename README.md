# kalkulator-pv-cwu

Interaktywny symulator fotowoltaiki dla budynków wielorodzinnych z modułem ciepłej wody użytkowej (CWU) i zasobnikiem z grzałką elektryczną.

Działa bezpośrednio z systemu plików (`file://`) — bez serwera, bez instalacji, bez frameworków.

## Uruchamianie

Pobierz repozytorium i otwórz `pv-sim.v0.8.html` w przeglądarce.

## Funkcje

### Moduł 01 — PV (fotowoltaika)
- Moc instalacji: 1–100 kWp
- Dwa tryby symulacji: **avg** (dane PVGIS z uwzględnieniem zachmurzenia) i **clear** (bezchmurny dzień)
- Model słońca: deklinacja Coopera (1969), model clear-sky Hottela
- Dane nasłonecznienia: PVGIS, Opole (φ = 50.67°N), nachylenie 30°, optymalne azymut

### Moduł 02 — CWU (ciepła woda użytkowa)
- Liczba mieszkańców: 1–200
- Temperatura docelowa: 35–65°C
- Profil godzinowy poboru wody wg Chmielewska (2025), badania 42 budynków w Polsce
- Temperatura wody zimnej: model sinusoidalny (min ~6°C w lutym, max ~16°C w sierpniu)
- Taryfa ciepła: ECO Opole od 01.01.2026

### Moduł 03 — Sieć (taryfa energii elektrycznej)
- Konfigurowalna taryfa 2-strefowa: cena dzienna i nocna [zł/kWh]
- Regulowane godziny granic strefy dziennej (start/koniec)
- Wartości domyślne: G12 Tauron 2026 — dzień 0,6950 zł/kWh, noc 0,3500 zł/kWh
- Ceny i godziny stref wykorzystuje Moduł 04 (strategie grzałki, koszt z sieci)

### Moduł 04 — Zasobnik z grzałką elektryczną
- Moc grzałki: 1–15 kW
- Pojemność zasobnika: 100–1000 L
- Model termodynamiczny 1-węzłowy (fully-mixed), 6 podkroków na godzinę
- Trzy strategie grzałki wybierane osobno dla strefy dziennej i nocnej:
  **off** (wyłączona), **off-grid** (power diverter — moc do nadwyżki PV,
  grzeje do T_hot), **on-grid** (moc proporcjonalna, pobór z PV + sieci)
- Termostat: max 60°C (granica anty-Legionella wg PN-EN 12897)
- Straty ciepła klasy B/C wg PN-EN 12897

### Moduł 05 — Symulacja miesięczna
- Ciągła symulacja zasobnika przez cały miesiąc — każda doba dziedziczy
  temperaturę końcową poprzedniej, po kilku dobach układ wchodzi w stan ustalony
- Dziedziczy parametry Modułu 04 (bez własnych kontrolek)
- Statystyki miesięczne: pokrycie CWU, zużycie prądu (PV vs sieć),
  koszt energii z sieci, ciepło zaoszczędzone, bilans miesięczny
- Skrót podsumowania dostępny w stale widocznym sidebarze

## Struktura plików

```
pv-sim.v0.8.html      — jedyna strona HTML
pv-sim.tokens.css     — zmienne CSS (kolory, tła, akcenty)
pv-sim.layout.css     — nagłówek, suwaki, siatka miesięcy, stopka, responsive
pv-sim.components.css — wykresy SVG, karty statystyk, warianty kolorów, sidebar
pv-sim.config.js      — stałe, MONTHS[], state{}, funkcje pomocnicze
pv-sim.physics.js     — simulateDay(), simulateDHW(), simulateTank(), simulateTankMonth()
pv-sim.render.js      — renderowanie wykresów SVG i kart statystyk
pv-sim.app.js         — P.update(), init(), obsługa UI
```

## Dane źródłowe

| Dane | Źródło |
|------|--------|
| Produkcja PV | PVGIS, Komisja Europejska |
| Profil poboru CWU | Chmielewska A. (2025), *Energies* 18(17), DOI: [10.3390/en18174578](https://doi.org/10.3390/en18174578) |
| Temperatura wody zimnej | Górka A., RynekInstalacyjny.pl, 90 punktów sieci PL |
| Taryfa ciepła | ECO Opole, cennik od 01.01.2026 |
| Taryfa energii elektrycznej | G12 Tauron, cennik 2026 |

## Technologie

Czysty HTML/CSS/JS — bez frameworków, bez bundlerów, bez Node.js.  
Architektura IIFE + globalny namespace `window.PVSIM` (kompatybilna z protokołem `file://`).
