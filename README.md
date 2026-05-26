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

## Algorytmy

### Produkcja PV — clear-sky × skalowanie do PVGIS
Krzywa godzinowa zaczyna się od czystej fizyki: kąt wysokości słońca liczony
modelem Coopera (1969) na podstawie szerokości geograficznej, deklinacji i kąta
godzinnego, a wartość napromienienia w danej godzinie — uproszczonym modelem
clear-sky Hottela (transmisja atmosfery jako funkcja masy powietrza). Dla
trybu **clear** wynik mnożony jest przez stały skaler `CLEAR_SCALE`, żeby suma
dobowa zgadzała się z idealnym bezchmurnym dniem. Dla trybu **avg** skaler
dobierany jest na bieżąco tak, by suma dobowa równała się dobowemu uzyskowi
PVGIS dla danego miesiąca (chmury wliczone). Kształt krzywej w obu trybach jest
ten sam — różni je tylko amplituda.

**Model Coopera (1969)** — prosty wzór astronomiczny na deklinację Słońca
(czyli kąt między płaszczyzną równika a kierunkiem na Słońce) w zależności od
dnia roku. Pozwala policzyć, jak wysoko Słońce stoi nad horyzontem o danej
godzinie w danym dniu i miejscu na Ziemi — to wejście do każdego dalszego
modelu napromienienia.

**Model clear-sky Hottela** — empiryczny model bezchmurnego nieba: dla danej
wysokości Słońca i wysokości n.p.m. szacuje, jaka część stałej słonecznej
dociera do powierzchni Ziemi po przejściu przez czystą atmosferę (im niżej
Słońce, tym dłuższa droga w atmosferze i większe tłumienie). Daje kształt
godzinowej krzywej napromienienia w idealnym dniu — w aplikacji ta krzywa
jest następnie przeskalowana do realnych warunków danego miesiąca.

### Rozrzut dobowy PV — inverse CDF + korekta średniej
Dla symulacji miesięcznej i rocznej każda doba dostaje dobowy mnożnik
produkcji `g[d] ∈ [0, g_max]`, gdzie `g_max = clear-sky / avg` (sezonowy —
zimą ~3, latem ~1,5). Surowa „czystość nieba" losowana jest metodą odwrotnej
dystrybuanty: `r = U^p` z `U ~ Uniform(0,1)` i `p = g_max − 1` — taki rozkład
ma `E[r^p] = 1/g_max`, więc bez korekty średnia dobowa już z grubsza pasuje.
Następnie blendowana z suwakiem `pvVariability` (`0` → wszystkie doby
identyczne, `1` → pełny zakres od pochmurnych do clear-sky), a na końcu
monotoniczna korekta wymusza **dokładną** średnią — suma miesięczna PV jest
zachowana bit-w-bit. Generator (`mulberry32`, ziarno = `WEATHER_SEED + monthIdx`)
jest deterministyczny: ten sam wzorzec dni przy każdym renderze, suwak tylko
skaluje rozrzut bez tasowania.

### Strategie pracy pary PC + grzałka
Każda godzina doby jest przypisana do strefy dziennej lub nocnej (Moduł 03),
a strategia wybierana jest osobno dla każdej strefy:

- **off** — oba urządzenia wyłączone w tej strefie.
- **off-grid** (power diverter) — grzejemy **wyłącznie nadwyżką PV**. PC ma
  priorytet: wybiera największy bieg `k`, dla którego `(k/N)·hpKW ≤ P_PV`;
  grzałka throttluje do reszty nadwyżki. Próg włączenia `heaterThreshold ×
  heaterKW` zapobiega cyklicznym startom przy słabej PV. Po osiągnięciu
  setpointu — stop, nadwyżka PV zapisana jako `Q_wasted`.
- **on-grid** — pełna moc proporcjonalna do brakującej temperatury, nadwyżka
  PV używana w pierwszej kolejności, resztę dobiera sieć (po cenie strefy).
  W pasmie `[T_set − hpOnlyBand, T_set)` pracuje **tylko PC** (bieg dobrany
  proporcjonalnie do zapotrzebowania); poniżej pasma PC bierze top bieg,
  a grzałka modulowana wg `(T_set − T) / BAND` dobiera resztę.

### Fizyka zasobnika
Model 1-węzłowy (fully-mixed) — zasobnik traktowany jako jednorodna masa
wody o temperaturze `T(t)`. Każda godzina liczona w **6 podkrokach**, w każdym:

1. **Pobór** — strumień ciepłej wody zastępowany wodą wodociągową `T_in`,
   nowa temperatura jako średnia ważona masami. Oszczędność `Q_saved`
   = ile mniej ciepła musiałby dostarczyć stary węzeł ECO (Δ od `T_in`).
2. **Grzanie** — moce PC i grzałki wg strategii (powyżej), cap mocy do
   ilości potrzebnej, by nie przekroczyć setpointu w tym podkroku.
3. **Straty postojowe** — `Q_strat = UA · (T − T_otoczenia) · dt`,
   gdzie `UA(V) = UA_REF · (V/V_REF)^(2/3)` (skalowanie powierzchni
   zasobnika z objętością, klasa B/C wg PN-EN 12897).

COP pompy ciepła sezonowy — letni (Kwi–Wrz) lub zimowy (Paź–Mar) — więc
ciepło dostarczone do zasobnika to `Q_hp = elec_hp × COP_sezonowy`. Cena
energii z sieci uwzględnia strefę godziny pracy.

W symulacji miesięcznej i rocznej (Moduły 05–06) temperatura zasobnika
przenosi się między dobami (`T_end` jednej doby = `T_start` następnej),
więc układ wchodzi w stan ustalony po kilku pierwszych dobach.

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
