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
Chcemy policzyć, ile prądu wyprodukuje instalacja PV w każdej godzinie doby
wybranego miesiąca. Robimy to dwuetapowo: najpierw fizyka daje **kształt**
godzinowej krzywej (kiedy i jak wysoko stoi Słońce), a potem skalowanie
dopasowuje **wysokość** krzywej do realnego uzysku dobowego z PVGIS
(chmury wliczone) albo do idealnego dnia bezchmurnego.

**Model Coopera (1969).** Używamy go, żeby wiedzieć, jak wysoko nad
horyzontem stoi Słońce o danej godzinie w wybranym dniu roku — im wyżej,
tym krótsza droga promieni przez atmosferę i więcej energii na panelu.

Cooper to prosty wzór, który dla dnia roku zwraca **deklinację `δ`** — kąt
między płaszczyzną równika a kierunkiem na Słońce. Ziemia obiega nachylone
o 23,45° Słońce, więc `δ` zmienia się sezonowo: czerwiec `+23,45°` (półkula
północna nadstawiona), grudzień `−23,45°` (półkula południowa), równonoce
`0°`. To właśnie z tej zmiany biorą się pory roku.

Sama `δ` nie mówi jeszcze, jak wysoko Słońce wzejdzie u nas — łączymy ją
z szerokością geograficzną `φ` i godziną doby `ω` trygonometrią sferyczną
(wzór `sin α = …` w „Łączeniu obu modeli" niżej).

**Model clear-sky Hottela.** Używamy go, żeby z wysokości Słońca `α` dostać
**kształt** dziennej krzywej napromienienia — względne (bezwymiarowe)
wartości godzina po godzinie, bez przesądzania, ile to fizycznie kWh.

Hottel to empiryczny wzór, który dla danego `α` zwraca **względne**
napromienienie bezchmurnego nieba: ile w tej chwili dochodzi przez atmosferę
w porównaniu z momentem, gdy Słońce stoi najwyżej. Im niżej Słońce, tym
dłuższa droga promieni przez atmosferę i tym większe tłumienie — dlatego
krzywa dzienna ma kształt dzwonu z maksimum w południe.

Dlaczego niskie Słońce = dłuższa droga, mimo że Ziemia jest kulą? Bo
atmosfera to cienka skorupka (~100 km) wokół promienia ~6370 km — w skali
doby odległość do Słońca się nie zmienia, zmienia się tylko **kąt padania**
promieni na tę warstwę. Słońce w zenicie wchodzi prostopadle (najkrótsza
droga, masa powietrza AM = 1); Słońce nisko nad horyzontem ślizga się przez
atmosferę ukośnie, pokonując w niej kilkukrotnie dłuższą drogę
(AM ≈ 1/sin α — przy `α = 10°` to już ~5,7×). Więcej drogi = więcej
rozpraszania i pochłaniania, mniej energii dochodzi do panelu. To samo
zjawisko, dla którego o świcie i zachodzie Słońce jest pomarańczowe i
słabsze.

Sam Hottel **nie zna kWh** — nie liczy konwersji napromienienia na płaszczyznę
nachylonego panelu, sprawności modułu, strat temperaturowych ani strat
falownika. Daje tylko **kształt** krzywej; jej **wysokość** (czyli faktyczną
energię) ustala dopiero skalowanie sumy dobowej — do `CLEAR_SCALE` (tryb
`clear`, kalibracja do 7,8 kWh/kWp/dobę typowego słonecznego czerwca w PL)
albo do dobowego uzysku PVGIS dla danego miesiąca (tryb `avg`, chmury
wliczone). Jeden mnożnik pochłania cały łańcuch strat układu PV.

**Łączenie obu modeli.** Cooper daje wartość astronomiczną — deklinację `δ`
dla wybranego dnia roku. Razem z szerokością geograficzną `φ` (Opole, 50,67°N)
i kątem godzinnym `ω` (przeliczonym z godziny doby) wyznaczamy wysokość
Słońca nad horyzontem: `sin α = sin φ · sin δ + cos φ · cos δ · cos ω`.
To `α` jest wejściem do modelu Hottela, który dla każdej godziny zwraca
względne napromienienie. Sumując 24 godziny dostajemy surowy uzysk dobowy
(jeszcze bez kalibracji do realnych warunków) — i dopiero ta suma jest
skalowana do `CLEAR_SCALE` (tryb `clear`) lub do dobowego uzysku PVGIS dla
danego miesiąca (tryb `avg`).

Interpretacja `CLEAR_SCALE`: **ile kWh/kWp/dobę daje jedna jednostka
„surowego Hottela"**. Wartość `1,4577` = `7,8 / 5,351` — kotwica kWh/kWp
typowego słonecznego czerwcowego dnia w PL podzielona przez surową sumę
Hottela dla 21 czerwca w Opolu. Jedna stała wystarcza na cały rok, bo
sezonowość siedzi już w `raw` (krótszy dzień, niższe `α` → mniejsza suma);
skala tylko zamienia bezwymiarowy kształt na energię.

**Krok po kroku, jak liczymy moc PV dla wybranego miesiąca:**

1. **Dzień reprezentatywny miesiąca** — bierzemy 15. dzień miesiąca (`n` ∈ 1..365).
2. **Deklinacja Słońca** (Cooper): `δ = 23,45° · sin(360° · (284 + n) / 365)` —
   to kąt między równikiem a kierunkiem na Słońce dla tego dnia.
3. **Dla każdej godziny doby `h ∈ 0..23`:**
   - **Kąt godzinny:** `ω = 15° · (h − 12)` — położenie Słońca w stosunku do
     południa lokalnego (15° na godzinę).
   - **Wysokość Słońca:** `sin α = sin φ · sin δ + cos φ · cos δ · cos ω`.
     Jeśli `α ≤ 0` (Słońce pod horyzontem) → moc dla tej godziny = 0, idziemy
     dalej.
   - **Względne napromienienie** `I_rel(α)` z modelu Hottela — funkcja tylko
     od wysokości Słońca, bez jednostek (kształt krzywej dziennej).
4. **Surowy uzysk dobowy:** `raw = Σ I_rel(α_h)` po 24 godzinach.
5. **Skalowanie do realnych warunków.** `raw` jest bezwymiarowy — żeby
   dostać kWh/kWp, mnożymy go przez `scale`, czyli **cenę jednej jednostki
   Hottela w kWh/kWp**:
   - tryb `clear` → `scale = CLEAR_SCALE = 1,4577` (stała na cały rok,
     skalibrowana raz: `7,8 kWh/kWp ÷ raw_21cze = 7,8 / 5,351`; kotwicą jest
     typowy bezchmurny czerwcowy dzień w PL). Dobowy uzysk clear-sky dla
     dowolnego miesiąca = `raw × 1,4577` — krótsze i niższe Słońce zimą daje
     mniejszy `raw`, więc i mniejszy uzysk.
   - tryb `avg` → `scale = dailyYield_PVGIS[miesiąc] / raw` (12 osobnych
     wartości — `dailyYield_PVGIS` to wieloletnia średnia kWh/kWp/dobę z PVGIS
     dla PL, panel 30°, **chmury wliczone**). `scale` zimą jest dużo mniejsza
     niż latem — bo średnia statystyczna doba grudnia jest pochmurna i daje
     w realu ułamek tego, co dałby clear-sky.

   Oba `scale` mają tę samą interpretację (kWh/kWp na jednostkę Hottela) —
   różnią się tylko kotwicą: `clear` celuje w idealny dzień, `avg` w realną
   średnią miesiąca.
6. **Moc godzinowa dla instalacji `kWp`:** `P(h) = kWp · I_rel(α_h) · scale`.
   Suma `P(h)` po dobie = uzysk dobowy [kWh], suma po miesiącu = uzysk
   miesięczny.

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
