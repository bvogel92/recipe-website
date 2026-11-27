// Recipe page: times, servings scaling, ingredient checkboxes, step cards, cook mode, phone tabs,
// plus the recipe form's live total time and photo preview.
(() => {
  'use strict';
  const $ = s => document.querySelector(s);

  // ---------- Durations ----------
  // Prep and cook time are free text ("15 minutes", "1 hr 15 min", "overnight").
  // Imports may bring ISO 8601 durations ("PT1H15M"), which are converted to text.

  function formatMinutes(total) {
    const m = Math.round(total);
    if (m < 60) return m + (m === 1 ? ' minute' : ' minutes');
    const h = Math.floor(m / 60), r = m % 60;
    return r ? h + ' hr ' + r + ' min' : h + (h === 1 ? ' hour' : ' hours');
  }

  function isoMinutes(value) {
    const m = String(value || '').trim().match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
    if (!m || !(m[1] || m[2] || m[3] || m[4])) return null;
    const total = (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0) + (+m[4] || 0) / 60;
    return total > 0 ? Math.round(total) : null;
  }

  // Text for the form from an imported value: ISO durations become "1 hr 15 min"; other text is kept.
  function durationText(value) {
    if (value == null) return '';
    const s = String(Array.isArray(value) ? value[0] : value).trim();
    const iso = isoMinutes(s);
    if (iso) return formatMinutes(iso);
    return /^P/i.test(s) ? '' : s.replace(/\s+/g, ' ');
  }

  // Minutes from free text, or null when it can't be read ("overnight", "until done").
  function parseMinutes(text) {
    let s = String(text || '').toLowerCase().trim();
    if (!s) return null;
    const iso = isoMinutes(s.toUpperCase());
    if (iso) return iso;
    s = s.replace(/½/g, '.5').replace(/¼/g, '.25').replace(/¾/g, '.75')
      .replace(/(\d+)\s+1\/2\b/g, (_, n) => String(+n + 0.5)).replace(/\b1\/2\b/g, '0.5')
      .replace(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)/g, '$2')          // ranges: use the longer time
      .replace(/(\d+)\s*h\s*(\d+)(?!\s*[a-z\d])/g, '$1 h $2 m');                 // "1h30"
    const hm = s.match(/^(\d+):(\d{2})$/);
    if (hm) return +hm[1] * 60 + +hm[2];
    if (/^\d+(?:\.\d+)?$/.test(s)) return Math.round(+s);
    const re = /(\d+(?:\.\d+)?|an?|one|half an?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m)\b/g;
    let total = 0, found = false, m;
    while ((m = re.exec(s))) {
      const n = /^half/.test(m[1]) ? 0.5 : /^(an?|one)$/.test(m[1]) ? 1 : parseFloat(m[1]);
      total += m[2][0] === 'd' ? n * 1440 : m[2][0] === 'h' ? n * 60 : n;
      found = true;
    }
    return found && total > 0 ? Math.round(total) : null;
  }

  // Total only when both prep and cook can be read, so "overnight" never shows a wrong total.
  function totalTime(prep, cook) {
    const p = parseMinutes(prep), c = parseMinutes(cook);
    return p != null && c != null ? formatMinutes(p + c) : '';
  }

  // ---------- Amounts and scaling ----------

  const FRACTIONS = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
  const NICE = [[0, ''], [1 / 8, '1/8'], [1 / 4, '1/4'], [1 / 3, '1/3'], [3 / 8, '3/8'], [1 / 2, '1/2'], [5 / 8, '5/8'], [2 / 3, '2/3'], [3 / 4, '3/4'], [7 / 8, '7/8'], [1, '']];
  const UNIT_FORMS = [
    ['cup', 'cups'], ['tablespoon', 'tablespoons'], ['teaspoon', 'teaspoons'], ['pound', 'pounds'], ['ounce', 'ounces'],
    ['can', 'cans'], ['clove', 'cloves'], ['package', 'packages'], ['pkg', 'pkgs'], ['stick', 'sticks'], ['slice', 'slices'],
    ['pinch', 'pinches'], ['dash', 'dashes'], ['quart', 'quarts'], ['pint', 'pints'], ['gallon', 'gallons'],
    ['liter', 'liters'], ['litre', 'litres'], ['gram', 'grams'], ['kilogram', 'kilograms'], ['jar', 'jars'],
    ['bunch', 'bunches'], ['head', 'heads'], ['sprig', 'sprigs'], ['bottle', 'bottles'], ['box', 'boxes'],
    ['bag', 'bags'], ['envelope', 'envelopes'], ['egg', 'eggs'], ['large egg', 'large eggs']
  ];
  const ABBREVIATIONS = { test: u => u.replace(/\.$/, '').length > 1 ? /^(?:tbsps?|tbs|tbl|tsps?|lbs?|oz|ml|kg|qt|pt|gal)\.?$/i.test(u) : /^[Ttlgc]\.?$/.test(u) };

  function parseQty(text) {
    let s = String(text).trim();
    for (const [ch, v] of Object.entries(FRACTIONS)) s = s.replace(ch, ' ' + v);
    s = s.replace(/(\d)-(?=\d+\/\d+)/, '$1 ').replace(/\s+/g, ' ').trim();
    let total = 0;
    for (const part of s.split(' ')) {
      if (/^\d+\/\d+$/.test(part)) { const [a, b] = part.split('/').map(Number); if (!b) return NaN; total += a / b; }
      else if (/^\d*\.?\d+$/.test(part)) total += Number(part);
      else return NaN;
    }
    return total;
  }

  function formatQty(n) {
    if (!(n > 0)) return String(n);
    const whole = Math.floor(n + 1e-9), rest = n - whole;
    let best = NICE[0], diff = Infinity;
    for (const pair of NICE) { const d = Math.abs(rest - pair[0]); if (d < diff) { diff = d; best = pair; } }
    if (diff > 0.03) return String(Math.round(n * 100) / 100);
    const w = whole + (best[0] === 1 ? 1 : 0);
    if (!best[1] || best[0] === 1) return String(w);
    return w ? w + ' ' + best[1] : best[1];
  }

  const NUM = '(?:\\d+(?:\\s+|-)\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?(?:\\s*[¼½¾⅓⅔⅛⅜⅝⅞])?|[¼½¾⅓⅔⅛⅜⅝⅞])';
  const AMOUNT = new RegExp('^(\\s*)(' + NUM + ')(?:\\s*(?:-|–|to)\\s*(' + NUM + '))?(?:(\\s*)((?:large\\s+)?[A-Za-z]+\\.?))?');

  // Splits "1 1/2 cups flour" into amount ("1 1/2 cups", scaled) and the rest; null if no leading amount.
  function scaleAmount(text, factor) {
    const m = String(text).match(AMOUNT);
    if (!m) return null;
    const a = parseQty(m[2]), b = m[3] ? parseQty(m[3]) : null;
    if (!Number.isFinite(a) || (m[3] && !Number.isFinite(b))) return null;
    let qty = factor === 1 ? m[2].trim() : formatQty(a * factor);
    if (m[3]) qty += '–' + (factor === 1 ? m[3].trim() : formatQty(b * factor));
    const unit = m[5] || '';
    let unitText = '';
    const form = UNIT_FORMS.find(([one, many]) => unit.toLowerCase() === one || unit.toLowerCase() === many);
    if (form) {
      let word = (b ?? a) * factor > 1 ? form[1] : form[0];
      if (unit[0] !== unit[0].toLowerCase()) word = word[0].toUpperCase() + word.slice(1);
      unitText = word;
    } else if (unit && ABBREVIATIONS.test(unit)) {
      unitText = unit;
    }
    // Known unit: the amount includes it. Otherwise stop after the number (or range).
    const consumed = unitText ? m[0].length : m[0].length - (m[4] || '').length - unit.length;
    return { amount: unitText ? qty + ' ' + unitText : qty, rest: String(text).slice(consumed) };
  }

  // ---------- State ----------

  let recipe = null, factor = 1, checked = new Set(), stepsDone = new Set(), tab = 'ingredients', wakeLock = null, cooking = false;
  const BATCH_STEPS = [0.25, 0.5, 1, 1.5, 2, 3, 4];

  function yieldBase(text) {
    const m = String(text || '').match(/(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|[¼½¾⅓⅔])/);
    if (!m) return null;
    const n = parseQty(m[1]);
    const label = String(text).replace(m[0], ' ').replace(/\s+/g, ' ').trim().replace(/^(?:makes|serves|yields?)\b:?\s*/i, '').replace(/^[-–:]\s*/, '');
    return n > 0 ? { n, label } : null;
  }

  // ---------- Rendering ----------

  function fact(label, value, extra) {
    const div = document.createElement('div');
    div.className = 'rp-fact' + (extra ? ' ' + extra : '');
    const dt = document.createElement('dt'); dt.textContent = label;
    const dd = document.createElement('dd'); dd.textContent = value;
    div.append(dt, dd);
    return div;
  }

  function renderFacts(r) {
    const box = $('#dfacts');
    const items = [];
    if (String(r.yield || '').trim()) items.push(fact('Makes', r.yield.trim()));
    if (String(r.prepTime || '').trim()) items.push(fact('Prep time', r.prepTime.trim()));
    if (String(r.cookTime || '').trim()) items.push(fact('Cook time', r.cookTime.trim()));
    const total = totalTime(r.prepTime, r.cookTime);
    if (total) items.push(fact('Total', total, 'total'));
    box.replaceChildren(...items);
    box.hidden = !items.length;
    box.style.setProperty('--fact-count', String(Math.max(items.length, 1)));
  }

  function renderServings(r) {
    const base = yieldBase(r.yield);
    const box = $('#dservings');
    const label = box.querySelector('.rp-servings-label');
    const value = box.querySelector('.rp-servings-value');
    const state = box.querySelector('.rp-servings-state');
    if (base) {
      label.textContent = 'Makes';
      value.textContent = formatQty(base.n * factor) + (base.label ? ' ' + base.label : '');
    } else {
      label.textContent = 'Batch';
      value.textContent = '×' + formatQty(factor);
    }
    $('#dservings-less').disabled = factor <= BATCH_STEPS[0];
    $('#dservings-more').disabled = factor >= BATCH_STEPS[BATCH_STEPS.length - 1];
    state.textContent = factor === 1 ? 'As written' : 'Amounts scaled ×' + formatQty(factor);
    $('#dservings-reset').hidden = factor === 1;
  }

  // Steps through clean multiples (×¼ … ×4) so scaled amounts stay readable fractions.
  function changeServings(direction) {
    let i = BATCH_STEPS.findIndex(x => Math.abs(x - factor) < 1e-9);
    if (i < 0) i = BATCH_STEPS.indexOf(1);
    factor = BATCH_STEPS[Math.min(BATCH_STEPS.length - 1, Math.max(0, i + direction))];
    renderServings(recipe);
    renderIngredients(recipe);
  }

  function boldAmount(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.nodeValue.trim()) node = walker.nextNode();
    if (!node) return;
    const parts = scaleAmount(node.nodeValue, factor);
    if (!parts) return;
    const b = document.createElement('b');
    b.className = 'ing-amount';
    b.textContent = parts.amount;
    const inStrong = node.parentElement && node.parentElement !== el && /^(STRONG|B)$/.test(node.parentElement.tagName);
    if (inStrong) { node.nodeValue = parts.amount + parts.rest; return; }
    node.nodeValue = parts.rest.replace(/^(?=\S)/, ' ');
    node.parentNode.insertBefore(b, node);
  }

  function renderIngredients(r) {
    const box = $('#ding');
    recipeMarkdown(box, r.ingredients || 'No ingredients added.', true);
    if (!String(r.ingredients || '').trim()) return;
    box.querySelectorAll('.ingredient-line, li').forEach(boldAmount);
    window.recipeSubstitutions?.addSubstitutionHints(box);
    box.querySelectorAll('.ingredient-line, li').forEach((el, i) => {
      const label = document.createElement('label');
      label.className = 'ing-check';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = checked.has(i);
      const text = document.createElement('span');
      text.className = 'ing-text';
      const hint = el.querySelector(':scope > .sub-hint');
      text.append(...[...el.childNodes].filter(n => n !== hint));
      if (hint) text.append(hint);   // stays on the ingredient's line; clicking it doesn't tick the box
      label.append(input, text);
      label.classList.toggle('done', input.checked);
      input.onchange = () => { input.checked ? checked.add(i) : checked.delete(i); label.classList.toggle('done', input.checked); };
      el.replaceChildren(label);
    });
  }

  function renderSteps(r) {
    const box = $('#dinst');
    box.replaceChildren();
    if (!String(r.instructions || '').trim()) {
      const p = document.createElement('p'); p.className = 'sub'; p.textContent = 'No instructions added.'; box.append(p); return;
    }
    const scratch = document.createElement('div');
    recipeMarkdown(scratch, r.instructions);
    let list = null, n = 0;
    const addStep = nodes => {
      if (!list) { list = document.createElement('ol'); list.className = 'rp-steps'; if (n) list.start = n + 1; box.append(list); }
      n += 1;
      const li = document.createElement('li');
      li.className = 'rp-step';
      li.dataset.step = String(n);
      const num = document.createElement('span'); num.className = 'rp-step-num'; num.setAttribute('aria-hidden', 'true'); num.textContent = String(n);
      const text = document.createElement('div'); text.className = 'rp-step-text'; text.append(...nodes);
      li.append(num, text);
      li.classList.toggle('done', stepsDone.has(n));
      li.onclick = () => {
        if (!cooking) return;
        const k = Number(li.dataset.step);
        stepsDone.has(k) ? stepsDone.delete(k) : stepsDone.add(k);
        li.classList.toggle('done', stepsDone.has(k));
        markCurrentStep();
      };
      list.append(li);
    };
    for (const child of [...scratch.children]) {
      if (/^H[4-6]$/.test(child.tagName)) { child.className = 'rp-step-heading'; box.append(child); list = null; }
      else if (/^(OL|UL)$/.test(child.tagName)) [...child.children].forEach(li => addStep([...li.childNodes]));
      else if (child.classList.contains('md-line') && child.textContent.trim()) addStep([...child.childNodes]);
    }
    markCurrentStep();
  }

  function markCurrentStep() {
    const steps = [...document.querySelectorAll('#dinst .rp-step')];
    steps.forEach(s => s.classList.remove('current'));
    if (!cooking) return;
    const next = steps.find(s => !s.classList.contains('done'));
    if (next) next.classList.add('current');
  }

  function renderPlanButton() {
    const button = $('#dplan');
    if (!window.mealPlan || !recipe) { button.hidden = true; return; }
    const inPlan = mealPlan.has(recipe.id);
    button.hidden = false;
    button.textContent = inPlan ? '✓ In this week’s plan' : '＋ Add to this week';
    button.setAttribute('aria-pressed', String(inPlan));
  }

  function setTab(next) {
    tab = next;
    $('.rp-body').dataset.tab = tab;
    $('#tab-ingredients').setAttribute('aria-selected', String(tab === 'ingredients'));
    $('#tab-steps').setAttribute('aria-selected', String(tab === 'steps'));
  }

  // ---------- Cook mode ----------

  async function keepAwake() {
    if (!('wakeLock' in navigator)) return false;
    try { wakeLock = await navigator.wakeLock.request('screen'); return true; } catch { return false; }
  }

  async function setCooking(on) {
    cooking = on;
    $('#detail').classList.toggle('cooking', on);
    const button = $('#dcook');
    button.setAttribute('aria-pressed', String(on));
    button.textContent = on ? 'Exit cook mode' : 'Cook mode';
    const status = $('#cook-status');
    if (on) {
      setTab('steps');
      const awake = await keepAwake();
      status.textContent = 'Cook mode is on. Tap a step when it’s done. ' +
        (awake ? 'Your screen will stay on.' : 'This browser can’t keep the screen on, so it may still dim.');
    } else {
      status.textContent = '';
      if (wakeLock) { try { await wakeLock.release(); } catch {} wakeLock = null; }
    }
    markCurrentStep();
  }

  document.addEventListener('visibilitychange', () => {
    if (cooking && document.visibilityState === 'visible' && (!wakeLock || wakeLock.released)) keepAwake();
  });

  // ---------- Copy ingredients ----------

  // An ingredient line's text without its Swap button.
  function lineText(el) {
    const copy = (el.querySelector('.ing-text') || el).cloneNode(true);
    copy.querySelectorAll('.sub-hint').forEach(b => b.remove());
    return copy.textContent.replace(/\s+/g, ' ').trim();
  }

  async function copyIngredients() {
    const lines = [...$('#ding').children].map(el => {
      if (/^H[4-6]$/.test(el.tagName)) return '\n' + el.textContent.trim() + ':';
      if (/^(UL|OL)$/.test(el.tagName)) return [...el.children].map(lineText).join('\n');
      if (el.classList.contains('md-gap')) return '';
      return lineText(el);
    });
    const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {
      const area = document.createElement('textarea');
      area.value = text; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.append(area); area.select();
      try { ok = document.execCommand('copy'); } catch {}
      area.remove();
    }
    const button = $('#dcopy');
    button.textContent = ok ? 'Copied ✓' : 'Copy failed';
    setTimeout(() => { button.textContent = 'Copy'; }, 1800);
  }

  // ---------- Public: show a recipe ----------

  function show(r) {
    const sameRecipe = recipe && recipe.id === r.id && $('#detail').open;
    recipe = r;
    if (!sameRecipe) {
      factor = 1; checked = new Set(); stepsDone = new Set();
      setTab('ingredients');
      if (cooking) setCooking(false);
    }
    const photo = $('.rp-photo');
    photo.classList.toggle('has-photo', !!r.image);
    renderFacts(r);
    renderServings(r);
    renderIngredients(r);
    renderSteps(r);
    renderPlanButton();
    closeMenu();
    $('#dcopy').textContent = 'Copy';
  }

  // ---------- More menu ----------

  function closeMenu() {
    const menu = $('#dmenu');
    if (!menu || menu.hidden) return false;
    menu.hidden = true;
    $('#dmore').setAttribute('aria-expanded', 'false');
    return true;
  }

  // ---------- Recipe form: total time and photo preview ----------

  function updateFormTotal() {
    const form = $('#form');
    const chip = $('#form-total');
    const total = totalTime(form.elements.prepTime.value, form.elements.cookTime.value);
    chip.hidden = !total;
    chip.textContent = total ? 'Total ' + total : '';
  }

  let previewUrl = null;
  function setFormPhoto(src) {
    const img = $('#form-photo-preview img');
    if (previewUrl && src !== previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    img.hidden = !src;
    if (src) { img.onerror = () => { img.hidden = true; }; img.src = src; } else img.removeAttribute('src');
  }

  function init() {
    $('#dservings-less').onclick = () => changeServings(-1);
    $('#dservings-more').onclick = () => changeServings(1);
    $('#dservings-reset').onclick = () => { factor = 1; renderServings(recipe); renderIngredients(recipe); };
    $('#dcopy').onclick = copyIngredients;
    $('#dcook').onclick = () => setCooking(!cooking);
    $('#tab-ingredients').onclick = () => setTab('ingredients');
    $('#tab-steps').onclick = () => setTab('steps');
    $('#dplan').onclick = () => { if (window.mealPlan && recipe) { mealPlan.toggle(recipe.id); renderPlanButton(); } };
    $('#dmore').onclick = e => {
      e.stopPropagation();
      const menu = $('#dmenu');
      const opening = menu.hidden;
      menu.hidden = !opening;
      $('#dmore').setAttribute('aria-expanded', String(opening));
      if (opening) menu.querySelector('button').focus();
    };
    $('#dmenu').addEventListener('click', () => closeMenu());
    document.addEventListener('click', e => { if (!e.target.closest('.rp-more')) closeMenu(); });
    $('#detail').addEventListener('cancel', e => { if (closeMenu()) { e.preventDefault(); $('#dmore').focus(); } });
    $('#detail').addEventListener('close', () => { if (cooking) setCooking(false); recipe = null; });
    $('.rp-photo img').addEventListener('error', () => $('.rp-photo').classList.remove('has-photo'));

    const form = $('#form');
    ['prepTime', 'cookTime'].forEach(name => form.elements[name].addEventListener('input', updateFormTotal));
    $('#recipeimage').addEventListener('change', e => {
      const file = e.target.files[0];
      if (file && file.type.startsWith('image/')) { setFormPhoto(previewUrl = URL.createObjectURL(file)); }
    });
    // When the editor opens (add, edit or import), show its current photo and total time.
    new MutationObserver(() => {
      if (!$('#editor').open) return;
      const existing = typeof editing !== 'undefined' && editing ? recipes.find(x => x.id === editing) : null;
      setFormPhoto((typeof pendingImage !== 'undefined' && pendingImage) || (existing && existing.image) || '');
      updateFormTotal();
    }).observe($('#editor'), { attributes: true, attributeFilter: ['open'] });
  }

  window.recipePage = { show, durationText, parseMinutes, formatMinutes, totalTime, scaleAmount, formatQty, parseQty, yieldBase };
  init();
})();
