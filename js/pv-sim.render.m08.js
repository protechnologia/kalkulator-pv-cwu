/* =========================================================
   PV.SIM — Renderowanie Modułu 08 (optymalizacja)

   renderOptimTable() — tabela top 10 wariantów grid searcha
                        (z grupowaniem wierszy o identycznym wyniku
                        ekonomicznym — kolumna # pokazuje zakres
                        `1–3`, różniące się parametry listowane jako
                        `v1 / v2 / v3`). Każdy wiersz z przyciskiem
                        „Przenieś →". Przy braku wyników wyświetla
                        pustą tabelę z napisem „brak wyników".
   ========================================================= */
window.PVSIM = window.PVSIM || {};
(function(P) {
  'use strict';

  // ===== RENDER TABELI OPTYMALIZACJI (Moduł 08) =====
  // Renderuje wynik P.optimize() jako tabelę top 3 do #pvsim-optim-table.
  // Każdy wiersz ma przycisk „Przenieś" z atrybutem data-row = indeks wyniku;
  // listener (app.js) odczytuje go i wywołuje applyOptimRow().
  P.renderOptimTable = function(results, emptyMsg) {
    const box = document.getElementById('pvsim-optim-table');
    if (!box) return;

    const stratLabel = { 'off': 'wył.', 'off-grid': 'off-grid', 'on-grid': 'on-grid' };
    const COL_COUNT = 14;

    let body;
    if (!results || results.length === 0) {
      const msg = emptyMsg || 'brak wyników';
      body = `<tr class="pvsim-optim-empty-row"><td colspan="${COL_COUNT}">${msg}</td></tr>`;
    } else {
      // Grupowanie: wiersze o identycznym wyniku ekonomicznym (cost, balancePLN,
      // lifetimeProfit) różnią się tylko parametrami nieistotnymi dla bilansu,
      // więc fizycznie to ten sam wariant. Łączymy w jeden wiersz tabeli,
      // a w kolumnie różniącego się parametru pokazujemy listę „v1 / v2 / v3".
      const groupMap = new Map();
      const groups = [];
      results.forEach((r, idx) => {
        const key = `${r.lifetimeProfit}|${r.cost}|${r.balancePLN}`;
        let g = groupMap.get(key);
        if (!g) {
          g = { leaderIdx: idx, members: [] };
          groupMap.set(key, g);
          groups.push(g);
        }
        g.members.push(r);
      });
      const topGroups = groups.slice(0, 10);

      // Komórka parametru: jeśli wszyscy członkowie mają tę samą wartość — zwraca ją;
      // inaczej zwraca listę unikatów (posortowanych liczbowo lub po kolejności) złączonych „ / ".
      const cell = (members, get, fmt) => {
        const seen = [];
        for (const m of members) {
          const v = get(m);
          if (!seen.includes(v)) seen.push(v);
        }
        seen.sort((a, b) => (typeof a === 'number' && typeof b === 'number') ? a - b : 0);
        return seen.map(fmt).join(' / ');
      };

      body = '';
      let rank = 1;
      topGroups.forEach((g) => {
        const n = g.members.length;
        const rankCell = n === 1 ? `${rank}` : `${rank}–${rank + n - 1}`;
        const first = g.members[0];
        body += `<tr>
          <td>${rankCell}</td>
          <td>${cell(g.members, r => r.kWp, P.fmt.pl1)}</td>
          <td>${cell(g.members, r => r.heaterKW, P.fmt.pl1)}</td>
          <td>${cell(g.members, r => r.hpKW != null ? r.hpKW : 0, P.fmt.pl1)}</td>
          <td>${cell(g.members, r => r.heaterThreshold, v => Math.round(v * 100))}</td>
          <td>${cell(g.members, r => r.tankL, v => v)}</td>
          <td>${cell(g.members, r => r.heaterTargetC, v => v)}</td>
          <td>${cell(g.members, r => r.stratDay, v => stratLabel[v])}</td>
          <td>${cell(g.members, r => r.stratNight, v => stratLabel[v])}</td>
          <td>${P.fmt.pl0(first.cost)}</td>
          <td>${P.fmt.pl2(first.balancePLN)}</td>
          <td>${P.fmt.pl1(first.paybackYears)}</td>
          <td class="pvsim-optim-profit">${P.fmt.pl0(first.lifetimeProfit)}</td>
          <td><button class="pvsim-optim-apply" data-row="${g.leaderIdx}">Przenieś →</button></td>
        </tr>`;
        rank += n;
      });
    }

    box.innerHTML = `
      <table class="pvsim-optim-table">
        <thead>
          <tr>
            <th>#</th>
            <th>PV [kWp]</th>
            <th>Grzałka [kW]</th>
            <th>PC [kW]</th>
            <th>Próg [%]</th>
            <th>Zasobnik [l]</th>
            <th>Temp. grz. [°C]</th>
            <th>Strat. dzień</th>
            <th>Strat. noc</th>
            <th>Koszt inw. [zł]</th>
            <th>Bilans roczny [zł]</th>
            <th>Zwrot [lat]</th>
            <th>Zysk netto [zł]</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>`;
  };

})(window.PVSIM);
