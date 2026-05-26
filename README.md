# kalkulator-pv-cwu

Interaktywny symulator fotowoltaiki dla budynków wielorodzinnych z modułem ciepłej wody użytkowej (CWU) i zasobnikiem podgrzewanym pompą ciepła oraz grzałką elektryczną.

Działa bezpośrednio z systemu plików (`file://`) — bez serwera, bez instalacji, bez frameworków.

## Uruchamianie

Pobierz repozytorium i otwórz `pv-sim.v1.5.html` w przeglądarce.

## Funkcje

### Moduł 01 — PV (fotowoltaika)
Symuluje godzinową produkcję instalacji PV w wybranym miesiącu, na bazie danych
PVGIS dla Opola. Pokazuje reprezentatywną dobę i rozrzut produkcji w obrębie
miesiąca.

### Moduł 02 — CWU (ciepła woda użytkowa)
Wylicza profil godzinowy zapotrzebowania na ciepłą wodę w budynku
wielorodzinnym oraz koszt jego pokrycia z sieci ciepłowniczej. Punkt
odniesienia dla pozostałych modułów — to z nim porównujemy oszczędności.

### Moduł 03 — Sieć (taryfa energii elektrycznej)
Konfiguruje taryfę 2-strefową (cena dzienna/nocna i godziny stref). Używana
przez Moduł 04 do wyceny energii dobranej z sieci i do rozdzielania strategii
grzania na strefę dzienną i nocną.

### Moduł 04 — Zasobnik z pompą ciepła i grzałką elektryczną
Sercem aplikacji. Symuluje pracę zasobnika ogrzewanego równolegle pompą
ciepła powietrze→woda i grzałką elektryczną, na podstawie produkcji PV
(Moduł 01), zapotrzebowania CWU (Moduł 02) i taryfy (Moduł 03). Trzy
strategie współpracy z siecią (off / off-grid / on-grid) wybierane osobno
dla strefy dziennej i nocnej.

### Moduł 05 — Symulacja miesięczna
Rozwija symulację z Modułu 04 na cały miesiąc, z ciągłością temperatury
zasobnika między dobami i sezonowym rozrzutem pogody. Pokazuje miesięczne
pokrycie CWU, zużycie prądu i koszty.

### Moduł 06 — Symulacja roczna
Liczy wszystkie 12 miesięcy z osobnymi wejściami PV i CWU, uwzględniając
sezonową zmienność temperatury wody zimnej (a więc i zapotrzebowania na
ciepło). Daje podsumowanie roczne — pokrycie CWU, koszty, ciepło
zaoszczędzone i bilans netto — dostępne też w stale widocznym sidebarze.

### Moduł 07 — Inwestycja
Liczy koszt całej inwestycji (PV, grzałki, pompa ciepła, zasobnik,
automatyka + SCADA) i czas jej zwrotu na podstawie bilansu rocznego netto
z Modułu 06. Ceny jednostkowe konfigurowalne.

### Moduł 08 — Optymalizacja (grid search)
Automatycznie dobiera najlepszą konfigurację układu pod zadane kryterium
(maks. zysk netto / min. czas zwrotu / maks. pokrycie CWU) przy zadanym
maksymalnym czasie zwrotu. Top 10 wariantów można jednym kliknięciem
przenieść do kontrolek Modułu 04.

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
