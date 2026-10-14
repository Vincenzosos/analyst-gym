// Quiz engine: renders any item type, timing, feedback with explanations, logging, report.
import { h, esc, md, fmtTime, fmt } from './util.js';
import { datasetHTML } from './charts.js';
import { logAttempt, addMistake, reviewResult } from './store.js';
import { SKILL } from './content.js';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const TFC = [['T', 'True'], ['F', 'False'], ['C', 'Cannot say']];

export function contextNode(item) {
  const c = item.context;
  if (!c) return null;
  if (c.kind === 'passage') return h('div', { class: 'passage', lang: 'en' }, h('div', { class: 'passage-title' }, c.passage.title || ''), h('div', { class: 'passage-text', html: esc(c.passage.text).replace(/\n/g, '<br>') }));
  if (c.kind === 'dataset') return h('div', { class: 'ctx', html: datasetHTML(c.dataset) });
  if (c.kind === 'html') return h('div', { class: 'ctx', html: c.html });
  return null;
}

export function correctLabel(item) {
  if (item.type === 'tfc') return (TFC.find(x => x[0] === item.answer) || [])[1];
  if (item.type === 'numeric') return `${fmt(item.answer, 4)}${item.unit ? ' ' + item.unit : ''}`;
  if (item.type === 'sjt') return `Most: ${LETTERS[item.best]} · Least: ${LETTERS[item.worst]}`;
  return item.optionsHTML ? `Option ${LETTERS[item.answer]}` : `${LETTERS[item.answer]}. ${item.options[item.answer]}`;
}

export function explanationNode(item, { open = true } = {}) {
  const e = item.explanation || {};
  const wrap = h('div', { class: 'expl' + (open ? ' open' : '') });
  const body = h('div', { class: 'expl-body' });
  if (item.type === 'sjt' && item.ratings) {
    body.append(h('div', { class: 'sjt-ratings' }, item.options.map((o, i) => h('div', { class: 'sjt-r' }, h('span', { class: `rate r${item.ratings[i]}` }, ['', 'Counterproductive', 'Ineffective', 'Fairly effective', 'Most effective'][item.ratings[i]] || ''), h('span', {}, `${LETTERS[i]}. ${o}`)))));
  }
  if (e.steps && e.steps.length) body.append(h('div', { class: 'expl-sec' }, h('div', { class: 'expl-h' }, 'How to solve it'), h('ol', {}, e.steps.map(s => h('li', { html: md(s).replace(/^<p>|<\/p>$/g, '') })))));
  const tri = [['Shortcut', e.shortcut, 'sc'], ['Trap', e.trap, 'tr'], ['Rule', e.rule, 'ru']];
  for (const [t, v, cls] of tri) if (v) body.append(h('div', { class: `expl-chip ${cls}` }, h('b', {}, t), h('span', { html: md(v).replace(/^<p>|<\/p>$/g, '') })));
  if (!open) {
    const btn = h('button', { class: 'linkbtn', onclick: () => { wrap.classList.toggle('open'); btn.textContent = wrap.classList.contains('open') ? 'Hide explanation' : 'Show explanation'; } }, 'Show explanation');
    wrap.append(btn);
  }
  wrap.append(body);
  return wrap;
}

function makeCalculator() {
  const box = h('div', { class: 'calc hidden' });
  const input = h('input', { class: 'calc-in', placeholder: 'e.g. (132-120)/120*100', autocomplete: 'off' });
  const out = h('div', { class: 'calc-out' }, '');
  const evalIt = () => {
    const src = input.value.replace(/,/g, '.').replace(/x/gi, '*').replace(/÷/g, '/');
    if (!/^[\d+\-*/().%\s^]*$/.test(src) || !src.trim()) { out.textContent = ''; return; }
    try {
      // eslint-disable-next-line no-new-func
      const v = Function(`"use strict";return (${src.replace(/\^/g, '**').replace(/(\d+(?:\.\d+)?)%/g, '($1/100)')})`)();
      out.textContent = Number.isFinite(v) ? `= ${fmt(v, 6)}` : '';
    } catch { out.textContent = ''; }
  };
  input.addEventListener('input', evalIt);
  input.addEventListener('keydown', e => e.stopPropagation());
  input.setAttribute('inputmode', 'decimal');
  const keys = h('div', { class: 'calc-keys' }, ['(', ')', '÷', '×', '−', '+', '%', '⌫'].map(k => h('button', { type: 'button', 'aria-label': k === '⌫' ? 'Delete' : k, onclick: () => { input.value = k === '⌫' ? input.value.slice(0, -1) : input.value + ({ '÷': '/', '×': '*', '−': '-' }[k] || k); evalIt(); } }, k)));
  box.toggle = (on = box.classList.contains('hidden')) => { box.classList.toggle('hidden', !on); document.body.classList.toggle('calc-open', on); if (on && !matchMedia('(pointer: coarse)').matches) input.focus(); };
  const close = h('button', { type: 'button', class: 'calc-x', 'aria-label': 'Close the calculator', onclick: () => box.toggle(false) }, '✕');
  box.append(h('div', { class: 'calc-h' }, h('span', {}, 'Calculator'), close), input, keys, out);
  return box;
}

// Every sensible reading of a typed number: "6,150" may be 6150 (thousands) or 6.15 (decimal comma);
// "1.457,1" is Italian format. The answer is accepted if any reading is within tolerance.
export function numberReadings(raw) {
  const t = String(raw ?? '').trim().replace(/[−‒–]/g, '-').replace(/\s|%|€|\$|£/g, '').replace(/(x|bps|bp|bn|mn|m|k|days?|years?|yrs?)$/i, '').replace(/^\+/, '');
  if (!t || !/\d/.test(t)) return [];
  const out = new Set();
  const add = x => { const v = Number(x); if (Number.isFinite(v)) out.add(v); };
  if (/^-?\d*\.?\d+$/.test(t)) add(t);                                              // 6150, 6.15
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) add(t.replace(/,/g, ''));             // 6,150 or 1,200.50
  if (/^-?\d*,\d+$/.test(t)) add(t.replace(',', '.'));                               // 6,15 (decimal comma)
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) add(t.replace(/\./g, '').replace(',', '.')); // 1.457,1
  return [...out];
}

// The user's own answer, as text (report and mistake notebook).
export function yourAnswer(it, value, skipped) {
  if (skipped || value === null || value === undefined || value === '') return skipped ? 'not answered' : '';
  if (it.type === 'tfc') return ({ T: 'True', F: 'False', C: 'Cannot say' })[value] || String(value);
  if (it.type === 'numeric') return `${value}${it.unit ? ' ' + it.unit : ''}`;
  if (it.type === 'sjt' && Array.isArray(value)) return `Most: ${LETTERS[value[0]]} · Least: ${LETTERS[value[1]]}`;
  if (it.type === 'mcq') return it.optionsHTML ? `Option ${LETTERS[value]}` : `${LETTERS[value]}. ${it.options[value] ?? ''}`;
  return String(value);
}

// Learn-mode hint: the general rule, never a line that gives the answer away.
function hintFor(it) {
  const e = it.explanation || {};
  const cand = [e.rule, e.shortcut].filter(Boolean);
  const ans = it.type === 'mcq' && !it.optionsHTML ? String(it.options[it.answer] || '').trim() : it.type === 'numeric' ? String(it.answer) : '';
  const nums = ans.match(/\d+(?:[.,]\d+)?/g) || [];
  for (const c of cand) {
    const leaks = (ans && ans.length > 3 && c.includes(ans)) || nums.some(n => n.length >= 2 && c.includes(n));
    if (!leaks) return c;
  }
  return cand.length ? 'Reread the question: what exactly is it asking, and which figure in the table or text do you need? Write the calculation down before looking at the options.' : null;
}

/**
 * Run a sequence of items.
 * opts: { mode: 'learn'|'timed'|'mock'|'review'|'diag', title, timeLimit (sec, whole set), passMark, onDone(results) }
 */
export function runQuiz(root, items, opts = {}) {
  const mode = opts.mode || 'timed';
  const feedback = mode === 'learn' || mode === 'timed' || mode === 'review';
  const results = [];
  let idx = 0, itemStart = 0, setStart = performance.now(), tick = null, finished = false, nextBtn = null;
  const calc = makeCalculator();

  root.innerHTML = '';
  const head = h('div', { class: 'quiz-head' });
  const title = h('h1', { class: 'quiz-title' }, opts.title || '');
  const prog = h('div', { class: 'quiz-prog' });
  const timer = h('div', { class: 'quiz-timer' });
  const calcBtn = h('button', { class: 'btn ghost small icon-btn', title: 'Calculator (K)', 'aria-label': 'Calculator', onclick: () => calc.toggle(), html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8.5 7h7M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01M8.5 18h.01M12 18h.01M15.5 18h.01"/></svg>' });
  const quitBtn = h('button', { class: 'btn ghost small', onclick: () => { if (results.length < items.length && !window.confirm('End this set? You will see the report for the questions you answered.')) return; finish(true); } }, 'End');
  head.append(title, prog, timer, calcBtn, quitBtn);
  const bar = h('div', { class: 'quiz-bar' }, h('i'));
  const stage = h('div', { class: 'quiz-stage' });
  root.append(head, bar, stage);
  document.body.append(calc);
  document.body.classList.add('quiz-on'); // phones: hide the bottom nav while a set is running // fixed to the viewport, outside any transformed ancestor

  function updateTimer() {
    const now = performance.now();
    if (opts.timeLimit) {
      const left = opts.timeLimit * 1000 - (now - setStart);
      timer.textContent = fmtTime(left);
      timer.classList.toggle('warn', left < 60000);
      if (left <= 0) finish(false);
    } else {
      const it = items[idx];
      const el = now - itemStart;
      const tgt = (it && it.timeTarget) ? it.timeTarget * 1000 : 0;
      timer.textContent = tgt ? `${fmtTime(el)} / ${fmtTime(tgt)}` : fmtTime(el);
      timer.classList.toggle('warn', !!tgt && el > tgt && mode !== 'learn');
    }
  }

  function show() {
    if (idx >= items.length) return finish(false);
    const it = items[idx];
    itemStart = performance.now();
    prog.textContent = `${idx + 1} / ${items.length}`;
    bar.firstChild.style.width = `${(idx / items.length) * 100}%`;
    stage.innerHTML = '';
    const sk = SKILL[it.skill];
    stage.append(h('div', { class: 'item-meta' }, h('span', { class: 'chip' }, h('span', { class: 'sk-tag' }, sk ? sk.code : '•'), sk ? sk.short : it.skill), h('span', { class: 'lvl', title: `Difficulty ${it.level || 1}/3` }, h('i', { class: (it.level || 1) >= 1 ? 'on' : '' }), h('i', { class: (it.level || 1) >= 2 ? 'on' : '' }), h('i', { class: (it.level || 1) >= 3 ? 'on' : '' })), it.realData ? h('span', { class: 'chip live' }, 'Real data' + (it.asOf ? ` · to ${new Date(it.asOf + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : '')) : (it.news ? h('span', { class: 'chip live' }, 'This week’s news') : '')));
    const ctx = contextNode(it);
    const layout = h('div', { class: ctx ? 'item-grid' : 'item-single' });
    if (ctx) layout.append(h('div', { class: 'item-ctx' }, ctx));
    const qcol = h('div', { class: 'item-q' });
    qcol.append(h('div', { class: 'stem', lang: 'en', html: esc(it.stem).replace(/\n/g, '<br>') }));
    const ans = h('div', { class: 'answers' });
    qcol.append(ans);
    const fb = h('div', { class: 'feedback' });
    qcol.append(fb);
    layout.append(qcol);
    stage.append(layout);
    const hintText = mode === 'learn' ? hintFor(it) : null;
    if (hintText) {
      const hint = h('button', { class: 'linkbtn hintbtn', onclick: () => { hint.replaceWith(h('div', { class: 'hint', html: '<b>Hint</b> ' + md(hintText).replace(/^<p>|<\/p>$/g, '') })); } }, 'Show a hint');
      qcol.insertBefore(hint, fb);
    }
    renderAnswers(it, ans, fb);
    updateTimer();
  }

  function renderAnswers(it, ans, fb) {
    let locked = false;
    const submit = (value) => {
      if (locked) return; locked = true;
      const ms = performance.now() - itemStart;
      let ok = false, score = 0;
      if (it.type === 'numeric') { const tol = it.tolerance ?? Math.max(0.01, Math.abs(it.answer) * 0.005); ok = numberReadings(value).some(v => Math.abs(v - it.answer) <= tol); score = ok ? 1 : 0; }
      else if (it.type === 'sjt') { const [m, l] = value; score = (m === it.best ? 0.5 : 0) + (l === it.worst ? 0.5 : 0); ok = score === 1; }
      else { ok = value === it.answer; score = ok ? 1 : 0; }
      results.push({ item: it, value, ok, score, ms });
      logAttempt({ id: it.id, skill: it.skill, level: it.level, ok, score, ms, target: it.timeTarget, mode, src: it.news ? 'news' : undefined });
      if (ans._lock) ans._lock();
      if (mode === 'review') reviewResult(it.id, ok);
      else if (!ok) addMistake(it, value);
      // mark UI
      if (it.type === 'mcq' || it.type === 'tfc') {
        [...ans.querySelectorAll('.opt')].forEach(b => {
          const v = it.type === 'tfc' ? b.dataset.v : Number(b.dataset.v);
          b.disabled = true;
          if (feedback && v === it.answer) b.classList.add('right');
          if (v === value) b.classList.add(feedback ? (ok ? 'right' : 'wrong') : 'picked');
        });
      }
      if (!feedback) { setTimeout(next, 120); return; }
      const tgt = it.timeTarget ? it.timeTarget * 1000 : 0;
      const verdict = ok ? '✓ Correct' : (it.type === 'sjt' && score > 0 ? '◐ Partly correct' : '✗ Wrong');
      fb.innerHTML = '';
      const hb = ans.parentNode && ans.parentNode.querySelector('.hintbtn'); if (hb) hb.remove();
      fb.append(h('div', { class: `verdict ${ok ? 'ok' : score > 0 ? 'mid' : 'ko'}` }, h('b', {}, verdict), h('span', {}, ` · ${fmtTime(ms)}${tgt ? (ms <= tgt ? (ok ? ' · on time' : '') : ` · over the target time (${fmtTime(tgt)})`) : ''}`)));
      if (!ok) fb.append(h('div', { class: 'correct-ans' }, 'Correct answer: ', h('b', { html: item_label_html(it) })));
      fb.append(explanationNode(it, { open: !ok }));
      const nb = h('button', { class: 'btn primary', onclick: next }, idx + 1 < items.length ? 'Next' : 'See result', h('span', { class: 'kbd' }, '↵'));
      nextBtn = nb;
      fb.append(h('div', { class: 'row-end' }, nb));
      nb.focus({ preventScroll: true });
      requestAnimationFrame(() => {
        const v = fb.querySelector('.verdict'); if (!v) return;
        const nav = document.getElementById('nav');
        const limit = nav && getComputedStyle(nav).position === 'fixed' ? nav.getBoundingClientRect().top : innerHeight;
        if (v.getBoundingClientRect().bottom > limit - 12) v.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      });
    };

    if (it.type === 'tfc') {
      TFC.forEach(([v, label], i) => ans.append(h('button', { class: 'opt', 'data-v': v, onclick: () => submit(v) }, h('span', { class: 'k' }, v), label)));
    } else if (it.type === 'numeric') {
      const inp = h('input', { class: 'num-in', inputmode: 'decimal', lang: 'en', 'aria-label': 'Numeric answer', placeholder: it.unit ? `answer (${it.unit})` : 'answer', onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); trySubmit(); } } });
      const trySubmit = () => { if (!numberReadings(inp.value).length) { ans.querySelector('.num-hint')?.classList.remove('hidden'); inp.classList.add('shake'); inp.focus(); setTimeout(() => inp.classList.remove('shake'), 400); return; } submit(inp.value); };
      const nb = h('button', { class: 'btn primary', onclick: () => trySubmit() }, 'Confirm');
      const pm = h('button', { type: 'button', class: 'btn ghost num-pm', 'aria-label': 'Change sign', onclick: () => { const v = inp.value.trim(); inp.value = v.startsWith('-') ? v.slice(1) : '-' + v; inp.focus(); } }, '±');
      const numHint = h('div', { class: 'muted small num-hint hidden' }, 'Type just the number, e.g. 3.5 or -4.17 (units are optional).');
      ans.append(h('div', { class: 'num-row' }, pm, inp, nb), numHint);
      ans._lock = () => { inp.disabled = true; nb.classList.add('hidden'); };
      setTimeout(() => inp.focus(), 30);
    } else if (it.type === 'sjt') {
      let most = null, least = null;
      const grid = h('div', { class: 'sjt-grid' });
      grid.append(h('div', { class: 'sjt-hd' }, ''), h('div', { class: 'sjt-hd' }, 'Most'), h('div', { class: 'sjt-hd' }, 'Least'));
      const btns = [];
      it.options.forEach((o, i) => {
        const bm = h('button', { class: 'pick pick-most', 'aria-label': `Most effective: ${LETTERS[i]}`, 'aria-pressed': 'false', onclick: () => { most = i; if (least === i) least = null; paint(); } }, h('span', { class: 'pick-dot' }, '●'), h('span', { class: 'pick-l' }, 'Most'));
        const bl = h('button', { class: 'pick pick-least', 'aria-label': `Least effective: ${LETTERS[i]}`, 'aria-pressed': 'false', onclick: () => { least = i; if (most === i) most = null; paint(); } }, h('span', { class: 'pick-dot' }, '●'), h('span', { class: 'pick-l' }, 'Least'));
        btns.push([bm, bl]);
        grid.append(h('div', { class: 'sjt-opt' }, h('span', { class: 'k' }, LETTERS[i]), o), bm, bl);
      });
      const go = h('button', { class: 'btn primary', disabled: true, onclick: () => {
        btns.flat().forEach(b => b.disabled = true); go.disabled = true; go.classList.add('hidden');
        submit([most, least]);
        if (feedback) { // show the key next to the picks
          btns[it.best][0].classList.add('right'); if (most !== it.best) btns[most][0].classList.add('wrong');
          btns[it.worst][1].classList.add('right'); if (least !== it.worst) btns[least][1].classList.add('wrong');
        }
      } }, 'Confirm');
      const paint = () => { btns.forEach(([bm, bl], i) => { bm.classList.toggle('on', most === i); bl.classList.toggle('on', least === i); bm.setAttribute('aria-pressed', String(most === i)); bl.setAttribute('aria-pressed', String(least === i)); }); go.disabled = most === null || least === null; };
      ans.append(grid, h('div', { class: 'row-end' }, go));
    } else {
      it.options.forEach((o, i) => {
        const b = h('button', { class: 'opt' + (it.optionsHTML ? ' opt-html' : ''), 'data-v': i, onclick: () => submit(i) }, h('span', { class: 'k' }, LETTERS[i]));
        if (it.optionsHTML) b.append(h('span', { html: o })); else b.append(h('span', {}, o));
        ans.append(b);
      });
    }
    // keyboard
    root._keys = (e) => {
      if (finished || e.metaKey || e.ctrlKey || e.altKey) return;
      const ae = document.activeElement;
      const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
      if (e.key === 'Enter' && locked && feedback) {
        if (typing || (ae && ae !== nextBtn && (ae.tagName === 'BUTTON' || ae.tagName === 'A' || ae.tagName === 'SUMMARY'))) return; // let the focused control act
        e.preventDefault(); next(); return;
      }
      if (typing) return;
      if (locked) return;
      const k = e.key.toUpperCase();
      if (it.type === 'tfc' && ['T', 'F', 'C'].includes(k)) submit(k);
      else if ((it.type === 'mcq') && /^[1-6]$/.test(k) && Number(k) <= it.options.length) submit(Number(k) - 1);
      else if ((it.type === 'mcq') && LETTERS.slice(0, it.options.length).includes(k) && !e.metaKey && !e.ctrlKey) submit(LETTERS.indexOf(k));
    };
  }
  function item_label_html(it) { return it.optionsHTML ? `${LETTERS[it.answer]}<div class="mini-opt">${it.options[it.answer]}</div>` : esc(correctLabel(it)); }

  function next() { idx++; show(); }

  function finish(early) {
    calc.remove(); document.body.classList.remove('calc-open', 'quiz-on');
    if (finished) return; finished = true;
    clearInterval(tick); document.removeEventListener('keydown', onKey);
    // unanswered items in timed sets count as wrong (not logged as attempts)
    const unanswered = items.slice(results.length).map(item => ({ item, value: null, ok: false, score: 0, ms: 0, skipped: true }));
    const all = early ? results : results.concat(unanswered);
    const totalMs = performance.now() - setStart;
    if (opts.onDone) opts.onDone({ results: all, answered: results.length, totalMs, early });
  }

  const onKey = (e) => {
    if (root._keys) root._keys(e);
    const ae = document.activeElement;
    const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
    if (e.key.toLowerCase() === 'k' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) calc.toggle();
  };
  document.addEventListener('keydown', onKey);
  tick = setInterval(updateTimer, 250);
  const dispose = () => { calc.remove(); document.body.classList.remove('calc-open', 'quiz-on'); if (!finished) { finished = true; clearInterval(tick); document.removeEventListener('keydown', onKey); } };
  window.addEventListener('hashchange', dispose, { once: true });
  show();
  return { stop: () => finish(true) };
}

// Report after a set: score, per-skill breakdown, time, review list.
export function renderReport(root, { results, totalMs, title, passMark = 0.7, sections = null, onRetry, onBack }) {
  root.innerHTML = '';
  const n = results.length || 1;
  const score = results.reduce((s, r) => s + r.score, 0) / n;
  const inTime = results.filter(r => r.ok && r.item.timeTarget && r.ms <= r.item.timeTarget * 1000).length;
  const pass = score >= passMark;
  root.append(h('div', { class: 'report-hero' },
    h('div', { class: `big ${pass ? 'ok' : 'ko'}` }, `${Math.round(score * 100)}%`),
    h('div', {}, h('div', { class: 'rh-title' }, title || 'Result'), h('div', { class: 'muted' }, `${results.filter(r => r.ok).length}/${results.length} correct · ${fmtTime(totalMs)} · ${inTime} within target time · pass mark ${Math.round(passMark * 100)}% ${pass ? '✓ passed' : '✗ not reached'}`))));
  const by = new Map();
  for (const r of results) { const k = sections ? (r.section || r.item.skill) : r.item.skill; const e = by.get(k) || { n: 0, s: 0, ms: 0 }; e.n++; e.s += r.score; e.ms += r.ms; by.set(k, e); }
  root.append(h('div', { class: 'breakdown' }, [...by.entries()].map(([k, e]) => h('div', { class: 'bd' }, h('span', {}, SKILL[k] ? SKILL[k].short : k), h('div', { class: 'meter' }, h('i', { style: { width: `${(e.s / e.n) * 100}%` } })), h('b', {}, `${Math.round((e.s / e.n) * 100)}%`), h('span', { class: 'muted' }, `${e.n} q · ${fmtTime(e.ms / e.n)}/q`)))));
  const wrong = results.filter(r => !r.ok);
  if (wrong.length) {
    root.append(h('h3', {}, `Mistakes to understand (${wrong.length})`));
    const list = h('div', { class: 'review-list' });
    wrong.forEach(r => {
      const it = r.item;
      const card = h('details', { class: 'rev' });
      card.append(h('summary', {}, h('span', { class: 'sk-tag' }, SKILL[it.skill] ? SKILL[it.skill].code : '•'), h('span', { class: 'rev-stem' }, it.stem), r.skipped ? h('em', { class: 'muted' }, ' (not answered)') : ''));
      const ctx = contextNode(it); if (ctx) card.append(h('div', { class: 'rev-ctx' }, ctx));
      if (it.options && !it.optionsHTML && it.type !== 'sjt') card.append(h('ol', { class: 'rev-opts', type: 'A' }, it.options.map((o, i) => h('li', { class: i === it.answer ? 'right' : (i === r.value ? 'wrong' : '') }, o))));
      card.append(h('div', { class: 'correct-ans' }, 'Correct answer: ', h('b', { html: it.optionsHTML ? `${LETTERS[it.answer]}<div class="mini-opt">${it.options[it.answer]}</div>` : esc(correctLabel(it)) })));
      const yours = yourAnswer(it, r.value, r.skipped); if (yours) card.append(h('div', { class: 'your-ans' }, 'Your answer: ', h('b', { class: 'ko' }, yours)));
      card.append(explanationNode(it, { open: true }));
      list.append(card);
    });
    root.append(list, h('p', { class: 'muted' }, 'These mistakes are now in your notebook: they come back for review after 1, 3, 7 and 14 days.'));
  } else root.append(h('p', { class: 'muted' }, 'No mistakes: excellent.'));
  root.append(h('div', { class: 'row-end' }, onBack ? h('button', { class: 'btn ghost', onclick: onBack }, 'Back') : '', onRetry ? h('button', { class: 'btn primary', onclick: onRetry }, 'New set') : ''));
}
