// Ingredient substitution charts.
// In a recipe's view, any ingredient line that matches a chart gets a "⇄ Swap" button that opens
// the chart. If the line's amount matches a row (for example "1/2 cup chopped onion"), that row is
// highlighted. To add another chart, add an entry to SUBSTITUTIONS.
(() => {
  'use strict';

  const SUBSTITUTIONS = [
    {
      id: 'onion',
      title: 'Onion substitutions',
      // Lines that mention onion, but not green/spring onions or scallions, which are a different ingredient.
      match: /\bonions?\b/i,
      exclude: /\b(?:green|spring)\s+onions?\b|\bscallions?\b|\bonion\s+soup\s+mix\b/i,
      columns: ['Chopped fresh onion', 'Dried minced onion', 'Onion powder'],
      // Which column an ingredient line is written in.
      columnOf: line =>
        /\bonion\s+powder\b/i.test(line) ? 2
          : /\b(?:dried|dehydrated|instant)\s+(?:minced\s+)?onions?\b|\bminced\s+dried\s+onions?\b|\bonion\s+flakes\b/i.test(line) ? 1
            : 0,
      rows: [
        ['1/4 cup', '3/4 tablespoon', '3/4 teaspoon'],
        ['1/3 cup', '1 tablespoon', '1 teaspoon'],
        ['1/2 cup', '1-1/2 tablespoons', '1/2 tablespoon'],
        ['2/3 cup', '2 tablespoons', '2 teaspoons'],
        ['3/4 cup', '2-1/4 tablespoons', '2-1/4 teaspoons'],
        ['1 cup', '3 tablespoons', '1 tablespoon']
      ]
    }
  ];

  // ---------- Amount parsing ----------

  const UNICODE_FRACTIONS = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
  const UNITS = [
    [/^(?:cups?|c\.?)$/i, 'cup'],
    [/^(?:tablespoons?|tbsps?\.?|tbs\.?|tbl\.?|T)$/, 'tbsp'],
    [/^(?:tablespoons?|tbsps?\.?|tbs\.?|tbl\.?)$/i, 'tbsp'],
    [/^(?:teaspoons?|tsps?\.?|t)$/, 'tsp'],
    [/^(?:teaspoons?|tsps?\.?)$/i, 'tsp']
  ];

  function parseNumber(text) {
    let s = String(text).trim();
    for (const [ch, v] of Object.entries(UNICODE_FRACTIONS)) s = s.replace(ch, ' ' + v + ' ');
    s = s.replace(/(\d)\s*-\s*(?=\d+\/\d+)/, '$1 ').replace(/\s+/g, ' ').trim();
    let total = 0;
    for (const part of s.split(' ')) {
      if (/^\d+\/\d+$/.test(part)) { const [a, b] = part.split('/').map(Number); if (!b) return NaN; total += a / b; }
      else if (/^\d*\.?\d+$/.test(part)) total += Number(part);
      else return NaN;
    }
    return total;
  }

  // "1/2 cup chopped onion" -> {value: 0.5, unit: 'cup'}; returns null when there is no amount + unit.
  function parseAmount(text) {
    const plain = String(text).replace(/[*_`]/g, '').trim();
    const m = plain.match(/^((?:\d+\s*-\s*)?(?:\d+\s+)?(?:\d+\/\d+|\d*\.?\d+|[¼½¾⅓⅔⅛⅜⅝⅞])(?:\s*[¼½¾⅓⅔⅛⅜⅝⅞])?)\s*([A-Za-z.]+)/);
    if (!m) return null;
    const value = parseNumber(m[1]);
    const unit = (UNITS.find(([re]) => re.test(m[2])) || [])[1];
    return Number.isFinite(value) && unit ? { value, unit } : null;
  }

  function sameAmount(a, b) { return a && b && a.unit === b.unit && Math.abs(a.value - b.value) < 0.01; }

  function chartFor(line) {
    return SUBSTITUTIONS.find(c => c.match.test(line) && !(c.exclude && c.exclude.test(line))) || null;
  }

  function matchingRow(chart, line) {
    const col = chart.columnOf ? chart.columnOf(line) : 0;
    const amount = parseAmount(line);
    if (!amount) return { col, row: -1 };
    return { col, row: chart.rows.findIndex(r => sameAmount(parseAmount(r[col]), amount)) };
  }

  // ---------- Dialog ----------

  function ensureDialog() {
    let dialog = document.getElementById('subs-dialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'subs-dialog';
    dialog.setAttribute('aria-labelledby', 'subs-title');
    dialog.innerHTML =
      '<div class="modal"><div class="modalhead"><h2 id="subs-title"></h2>' +
      '<button type="button" class="link" aria-label="Close substitutions">✕</button></div>' +
      '<p class="sub" id="subs-for"></p><div class="subs-table-wrap"><table class="subs-table"><thead><tr></tr></thead><tbody></tbody></table></div>' +
      '<p class="sub" id="subs-note"></p></div>';
    dialog.querySelector('.modalhead button').onclick = () => dialog.close();
    dialog.addEventListener('click', e => {
      if (e.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
    });
    document.body.append(dialog);
    return dialog;
  }

  function showChart(chart, line) {
    const dialog = ensureDialog();
    const { col, row } = matchingRow(chart, line);
    dialog.querySelector('#subs-title').textContent = chart.title;
    dialog.querySelector('#subs-for').textContent = 'In this recipe: ' + line;
    const head = dialog.querySelector('thead tr');
    head.replaceChildren(...chart.columns.map((name, i) => {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = name;
      if (i === col) th.className = 'subs-current-col';
      return th;
    }));
    const body = dialog.querySelector('tbody');
    body.replaceChildren(...chart.rows.map((cells, r) => {
      const tr = document.createElement('tr');
      if (r === row) { tr.className = 'subs-match'; tr.setAttribute('aria-current', 'true'); }
      cells.forEach((cell, i) => {
        const td = document.createElement(i === 0 ? 'th' : 'td');
        if (i === 0) td.scope = 'row';
        td.textContent = cell;
        if (i === col) td.classList.add('subs-current-col');
        tr.append(td);
      });
      return tr;
    }));
    dialog.querySelector('#subs-note').textContent = row >= 0
      ? 'The highlighted row matches the amount in this recipe. Read across it to swap.'
      : 'Each row is the same amount of onion flavor. Find your amount in one column and read across.';
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('.modalhead button').focus();
  }

  // Adds "⇄ Swap" buttons to ingredient lines inside `container` (the rendered ingredient list).
  function addSubstitutionHints(container) {
    if (!container) return;
    for (const el of container.querySelectorAll('.ingredient-line, li')) {
      const line = el.textContent.trim();
      const chart = chartFor(line);
      if (!chart) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sub-hint';
      button.textContent = '⇄ Swap';
      button.title = chart.title;
      button.setAttribute('aria-label', chart.title + ' for ' + line);
      button.onclick = e => { e.stopPropagation(); showChart(chart, line); };
      el.append(' ', button);
    }
  }

  window.recipeSubstitutions = { SUBSTITUTIONS, addSubstitutionHints, parseAmount, chartFor, matchingRow, showChart };
})();
