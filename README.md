# kalkulator-pv-cwu

Interaktywny symulator fotowoltaiki dla budynków wielorodzinnych z modułem ciepłej wody użytkowej (CWU) i zasobnikiem podgrzewanym pompą ciepła oraz grzałką elektryczną.

Działa bezpośrednio z systemu plików (`file://`) — bez serwera, bez instalacji, bez frameworków.

## Uruchamianie

Pobierz repozytorium i otwórz `pv-sim.v1.5.html` w przeglądarce.

## Funkcje

### Moduł 01 — PV (fotowoltaika)
- Moc instalacji: 0–50 kWp (0 = PV wyłączone)
- Dwa tryby symulacji: **avg** (dane PVGIS z uwzględnieniem zachmurzenia) i **clear** (bezchmurny dzień)
- Suwak zmienności pogody dobowej — losowy, powtarzalny rozrzut produkcji
  poszczególnych dób przy zachowanej średniej miesięcznej (wpływa na moduły 05–08)
- Model słońca: deklinacja Coopera (1969), model clear-sky Hottela
- Dwa wykresy: godzinowa moc reprezentatywnej doby oraz produkcja dobowa
  przez cały miesiąc
- Dane nasłonecznienia: PVGIS, Opole (φ = 50.67°N), nachylenie 30°, optymalne azymut

### Moduł 02 — CWU (ciepła woda użytkowa)
- Liczba mieszkańców: 1–200
- Temperatura docelowa: 35–65°C
- Profil godzinowy poboru wody wg Chmielewska (2025), badania 42 budynków w Polsce
- Temperatura wody zimnej: model sinusoidalny (min ~6°C w lutym, max ~16°C w sierpniu)
- Taryfa ciepła: domyślnie 130 zł/GJ (edytowalna z UI)

### Moduł 03 — Sieć (taryfa energii elektrycznej)
- Konfigurowalna taryfa 2-strefowa: cena dzienna i nocna [zł/kWh]
- Regulowane godziny granic strefy dziennej (start/koniec)
- Wartości domyślne: dzień 1,20 zł/kWh, noc 1,20 zł/kWh
- Ceny i godziny stref wykorzystuje Moduł 04 (strategie grzałki, koszt z sieci)

### Moduł 04 — Zasobnik z pompą ciepła i grzałką elektryczną
- Moc grzałki: 0–15 kW (0 = grzałka wyłączona)
- Pojemność zasobnika: 200–3000 L
- Temperatura docelowa zasobnika: 0–60°C — wspólny setpoint pary PC+grzałka
  (oba urządzenia zatrzymują grzanie po osiągnięciu tej temperatury,
  niezależny od temperatury CWU z Modułu 02)
- Pompa ciepła powietrze→woda (drugie źródło ciepła, równolegle z grzałką):
  moc elektryczna 0–15 kW (0 = PC wyłączona), 1–5 biegów (równe stopnie mocy),
  pasmo „tylko PC" pod setpointem 0–20°C, sezonowy COP — letni (Kwi–Wrz)
  i zimowy (Paź–Mar) w zakresie 2,0–5,0
- W off-grid PC ma priorytet — wybiera największy bieg, dla którego moc
  elektryczna mieści się w nadwyżce PV; grzałka dobiera resztę
- W on-grid PC pracuje sama w pasmie pod setpointem (bieg proporcjonalny
  do zapotrzebowania), poniżej pasma dochodzi grzałka
- Model termodynamiczny 1-węzłowy (fully-mixed), 6 podkroków na godzinę
- Trzy strategie pary PC + grzałka wybierane osobno dla strefy dziennej i nocnej:
  **off**, **off-grid**, **on-grid**
- Termostat: max 60°C (granica anty-Legionella wg PN-EN 12897)
- Straty ciepła klasy B/C wg PN-EN 12897

### Moduł 05 — Symulacja miesięczna
- Ciągła symulacja zasobnika przez cały miesiąc — każda doba dziedziczy
  temperaturę końcową poprzedniej, po kilku dobach układ wchodzi w stan ustalony
- Dziedziczy parametry modułów 01–04 (bez własnych kontrolek)
- Statystyki miesięczne: pokrycie CWU, grzałka i PC (h pracy, kWh ciepła),
  zużycie prądu — źródło (PV vs sieć) i — urządzenie (grzałka vs PC),
  koszt energii z sieci, ciepło zaoszczędzone, bilans miesięczny

### Moduł 06 — Symulacja roczna
- Symulacja wszystkich 12 miesięcy z osobnymi wejściami PV i CWU
- Dziedziczy parametry modułów 01–04 (bez własnych kontrolek)
- Wykres słupkowy energii elektrycznej pary PC + grzałki (jeden słupek na miesiąc)
- Statystyki roczne (te same kafelki co M05 w skali roku); skrót podsumowania
  dostępny w stale widocznym sidebarze

### Moduł 07 — Inwestycja
- Kalkulator kosztu całej inwestycji (PV, grzałki, pompa ciepła, zasobnik,
  automatyka + SCADA) i czasu jej zwrotu względem bilansu rocznego netto
- Pięć suwaków cen jednostkowych (research rynkowy PL 2025)

### Moduł 08 — Optymalizacja (grid search)
- Automatyczny dobór najlepszej konfiguracji PV, grzałki, PC i zasobnika
- Użytkownik podaje maksymalny czas zwrotu, zakładany okres życia inwestycji
  oraz kryterium optymalizacji (maks. zysk netto / min. czas zwrotu /
  maks. pokrycie CWU)
- Przeszukuje siatkę kombinacji (moc PV, grzałka, moc PC, próg, zasobnik,
  temperatura grzania, strategie dzień/noc) i prezentuje top 10 wariantów
  posortowanych wg wybranego kryterium (z bilansem netto jako tiebreakerem).
  Wiersze o identycznym
  wyniku ekonomicznym są łączone — kolumna # pokazuje zakres rang `1–3`,
  a w komórkach różniących się parametrów (np. próg dla off/off) widać listę
  `v1 / v2 / v3`. Każdy parametr można checkboxem wyłączyć z optymalizacji
  (przypięty do bieżącej wartości suwaka). Pasek postępu pokazuje licznik
  i ETA; trwającą optymalizację można zatrzymać
- Wynik można jednym kliknięciem przenieść do kontrolek Modułu 04

## Struktura plików

```
pv-sim.v1.5.html      — jedyna strona HTML
pv-sim.tokens.css     — zmienne CSS (kolory, tła, akcenty)
pv-sim.layout.css     — nagłówek, suwaki, siatka miesięcy, stopka, responsive
pv-sim.components.css — wykresy SVG, karty statystyk, warianty kolorów, sidebar
pv-sim.config.js      — stałe, MONTHS[], state{}, OPT_GRID, funkcje pomocnicze
pv-sim.physics.js     — simulateDay/DHW/Tank/TankMonth/TankYear, computeInvestment
pv-sim.optimize.js    — optimize() (grid search, Moduł 08)
pv-sim.render.js      — renderowanie wykresów SVG i kart statystyk
pv-sim.app.js         — P.update(), init(), obsługa UI
```

## Dane źródłowe

| Dane | Źródło |
|------|--------|
| Produkcja PV | PVGIS, Komisja Europejska |
| Profil poboru CWU | Chmielewska A. (2025), *Energies* 18(17), DOI: [10.3390/en18174578](https://doi.org/10.3390/en18174578) |
| Temperatura wody zimnej | Górka A., RynekInstalacyjny.pl, 90 punktów sieci PL |

## Technologie

Czysty HTML/CSS/JS — bez frameworków, bez bundlerów, bez Node.js.  
Architektura IIFE + globalny namespace `window.PVSIM` (kompatybilna z protokołem `file://`).
