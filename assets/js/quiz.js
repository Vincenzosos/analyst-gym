// Quiz engine: renders any item type, timing, feedback with explanations, logging, report.
import { h, esc, md, fmtTime, fmt } from './util.js';
import { datasetHTML } from './charts.js';
import { logAttempt, addMistake, reviewResult } from './store.js';
import { SKILL } from './content.js';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const TFC = [['T', 'True'], ['F', 'False'], ['C', 'Cannot say']];

function contextNode(item) {
  const c = item.context;
  if (!c) return null;
  if (c.kind === 'passage') return h('div', { class: 'passage' }, h('div', { class: 'passage-title' }, c.passage.title || ''), h('div', { class: 'passage-text', html: esc(c.passage.text).replace(/\n/g, '<br>') }));
  if (c.kind === 'dataset') return h('div', { class: 'ctx', html: datasetHTML(c.dataset) });
  if (c.kind === 'html') return h('div', { class: 'ctx', html: c.html });
  return null;
}

export function correctLabel(item) {
  if (item.type === 'tfc') return (TFC.find(x => x[0] === item.answer) || [])[1];
  if (item.type === 'numeric') return `${fmt(item.answer, 4)}${item.unit ? ' ' + item.unit : ''}`;
  if (item.type === 'sjt') return `Most: ${LETTERS[item.best]} · Least: ${LETTERS[item.worst]}`;
  return item.optionsHTML ? `Opzione ${LETTERS[item.answer]}` : `${LETTERS[item.answer]}. ${item.options[item.answer]}`;
}

export function explanationNode(item, { open = true } = {}) {
  const e = item.explanation || {};
  const wrap = h('div', { class: 'expl' + (open ? ' open' : '') });
  const body = h('div', { class: 'expl-body' });
  if (item.type === 'sjt' && item.ratings) {
    body.append(h('div', { class: 'sjt-ratings' }, item.options.map((o, i) => h('div', { class: 'sjt-r' }, h('span', { class: `rate r${item.ratings[i]}` }, ['', 'Controproducente', 'Inefficace', 'Abbastanza efficace', 'Più efficace'][item.ratings[i]] || ''), h('span', {}, `${LETTERS[i]}. ${o}`)))));
  }
  if (e.steps && e.steps.length) body.append(h('div', { class: 'expl-sec' }, h('div', { class: 'expl-h' }, 'Come si risolve'), h('ol', {}, e.steps.map(s => h('li', { html: md(s).replace(/^<p>|<\/p>$/g, '') })))));
  const tri = [['⚡ Scorciatoia', e.shortcut, 'sc'], ['⚠️ Trappola', e.trap, 'tr'], ['📌 Regola', e.rule, 'ru']];
  for (const [t, v, cls] of tri) if (v) body.append(h('div', { class: `expl-chip ${cls}` }, h('b', {}, t), h('span', { html: md(v).replace(/^<p>|<\/p>$/g, '') })));
  if (!open) {
    const btn = h('button', { class: 'linkbtn', onclick: () => { wrap.classList.toggle('open'); } }, 'Vedi spiegazione');
    wrap.append(btn);
  }
  wrap.append(body);
  return wrap;
}

function makeCalculator() {
  const box = h('div', { class: 'calc hidden' });
  const input = h('input', { class: 'calc-in', placeholder: 'es. (132-120)/120*100', autocomplete: 'off' });
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
  box.append(h('div', { class: 'calc-h' }, 'Calcolatrice'), input, out);
  return box;
}

/**
 * Run a sequence of items.
 * opts: { mode: 'learn'|'timed'|'mock'|'review'|'diag', title, timeLimit (sec, whole set), passMark, onDone(results) }
 */
export function runQuiz(root, items, opts = {}) {
  const mode = opts.mode || 'timed';
  const feedback = mode === 'learn' || mode === 'timed' || mode === 'review';
  const results = [];
  let idx = 0, itemStart = 0, setStart = performance.now(), tick = null, finished = false;
  const calc = makeCalculator();

  root.innerHTML = '';
  const head = h('div', { class: 'quiz-head' });
  const title = h('div', { class: 'quiz-title' }, opts.title || '');
  const prog = h('div', { class: 'quiz-prog' });
  const timer = h('div', { class: 'quiz-timer' });
  const calcBtn = h('button', { class: 'ghost small', title: 'Calcolatrice (K)', onclick: () => calc.classList.toggle('hidden') }, '🧮');
  const quitBtn = h('button', { class: 'ghost small', onclick: () => finish(true) }, 'Termina');
  head.append(title, prog, timer, calcBtn, quitBtn);
  const bar = h('div', { class: 'quiz-bar' }, h('i'));
  const stage = h('div', { class: 'quiz-stage' });
  root.append(head, bar, stage, calc);

  function updateTimer() {
    const now = performance.now();
    if (opts.timeLimit) {
      const left = opts.timeLimit * 1000 - (now - setStart);
      timer.textContent = `⏱ ${fmtTime(left)}`;
      timer.classList.toggle('warn', left < 60000);
      if (left <= 0) finish(false);
    } else {
      const it = items[idx];
      const el = now - itemStart;
      const tgt = (it && it.timeTarget) ? it.timeTarget * 1000 : 0;
      timer.textContent = tgt ? `⏱ ${fmtTime(el)} / ${fmtTime(tgt)}` : `⏱ ${fmtTime(el)}`;
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
    stage.append(h('div', { class: 'item-meta' }, h('span', { class: 'chip' }, `${sk ? sk.icon + ' ' + sk.short : it.skill}`), h('span', { class: 'lvl' }, '●'.repeat(it.level || 1) + '○'.repeat(3 - (it.level || 1)))));
    const ctx = contextNode(it);
    const layout = h('div', { class: ctx ? 'item-grid' : 'item-single' });
    if (ctx) layout.append(h('div', { class: 'item-ctx' }, ctx));
    const qcol = h('div', { class: 'item-q' });
    qcol.append(h('div', { class: 'stem', html: esc(it.stem).replace(/\n/g, '<br>') }));
    const ans = h('div', { class: 'answers' });
    qcol.append(ans);
    const fb = h('div', { class: 'feedback' });
    qcol.append(fb);
    layout.append(qcol);
    stage.append(layout);
    if (mode === 'learn' && it.explanation && it.explanation.shortcut) {
      const hint = h('button', { class: 'linkbtn hintbtn', onclick: () => { hint.replaceWith(h('div', { class: 'hint', html: '⚡ ' + md(it.explanation.shortcut).replace(/^<p>|<\/p>$/g, '') })); } }, 'Suggerimento');
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
      if (it.type === 'numeric') { const v = parseFloat(String(value).replace(/,/g, '.')); ok = Number.isFinite(v) && Math.abs(v - it.answer) <= (it.tolerance ?? Math.max(0.01, Math.abs(it.answer) * 0.005)); score = ok ? 1 : 0; }
      else if (it.type === 'sjt') { const [m, l] = value; score = (m === it.best ? 0.5 : 0) + (l === it.worst ? 0.5 : 0); ok = score === 1; }
      else { ok = value === it.answer; score = ok ? 1 : 0; }
      results.push({ item: it, value, ok, score, ms });
      logAttempt({ id: it.id, skill: it.skill, level: it.level, ok, score, ms, target: it.timeTarget, mode });
      if (ans._lock) ans._lock();
      if (mode === 'review') reviewResult(it.id, ok);
      else if (!ok) addMistake(it);
      // mark UI
      if (it.type === 'mcq' || it.type === 'tfc') {
        [...ans.querySelectorAll('.opt')].forEach(b => {
          const v = it.type === 'tfc' ? b.dataset.v : Number(b.dataset.v);
          b.disabled = true;
          if (feedback && v === it.answer) b.classList.add('right');
          if (v === value) b.classList.add(ok ? 'right' : (feedback ? 'wrong' : 'picked'));
        });
      }
      if (!feedback) { setTimeout(next, 120); return; }
      const tgt = it.timeTarget ? it.timeTarget * 1000 : 0;
      const verdict = ok ? '✓ Corretto' : (it.type === 'sjt' && score > 0 ? '◐ Parzialmente corretto' : '✗ Sbagliato');
      fb.innerHTML = '';
      const hb = ans.parentNode && ans.parentNode.querySelector('.hintbtn'); if (hb) hb.remove();
      fb.append(h('div', { class: `verdict ${ok ? 'ok' : score > 0 ? 'mid' : 'ko'}` }, h('b', {}, verdict), h('span', {}, ` · ${fmtTime(ms)}${tgt ? (ms <= tgt ? (ok ? ' · nel tempo' : '') : ` · oltre il tempo target (${fmtTime(tgt)})`) : ''}`)));
      if (!ok) fb.append(h('div', { class: 'correct-ans' }, 'Risposta corretta: ', h('b', { html: item_label_html(it) })));
      fb.append(explanationNode(it, { open: !ok }));
      const nb = h('button', { class: 'primary', onclick: next }, idx + 1 < items.length ? 'Avanti ↵' : 'Vedi risultato ↵');
      fb.append(h('div', { class: 'row-end' }, nb));
      nb.focus({ preventScroll: true });
    };

    if (it.type === 'tfc') {
      TFC.forEach(([v, label], i) => ans.append(h('button', { class: 'opt', 'data-v': v, onclick: () => submit(v) }, h('span', { class: 'k' }, v), label)));
    } else if (it.type === 'numeric') {
      const inp = h('input', { class: 'num-in', inputmode: 'decimal', placeholder: it.unit ? `risposta (${it.unit})` : 'risposta', onkeydown: e => { if (e.key === 'Enter') { e.stopPropagation(); submit(inp.value); } } });
      const nb = h('button', { class: 'primary', onclick: () => submit(inp.value) }, 'Conferma');
      ans.append(h('div', { class: 'num-row' }, inp, nb));
      ans._lock = () => { inp.disabled = true; nb.classList.add('hidden'); };
      setTimeout(() => inp.focus(), 30);
    } else if (it.type === 'sjt') {
      let most = null, least = null;
      const grid = h('div', { class: 'sjt-grid' });
      grid.append(h('div', { class: 'sjt-hd' }, ''), h('div', { class: 'sjt-hd' }, 'Most'), h('div', { class: 'sjt-hd' }, 'Least'));
      const btns = [];
      it.options.forEach((o, i) => {
        const bm = h('button', { class: 'pick', onclick: () => { most = i; if (least === i) least = null; paint(); } }, '●');
        const bl = h('button', { class: 'pick', onclick: () => { least = i; if (most === i) most = null; paint(); } }, '●');
        btns.push([bm, bl]);
        grid.append(h('div', { class: 'sjt-opt' }, h('span', { class: 'k' }, LETTERS[i]), o), bm, bl);
      });
      const go = h('button', { class: 'primary', disabled: true, onclick: () => { btns.flat().forEach(b => b.disabled = true); go.disabled = true; go.classList.add('hidden'); submit([most, least]); } }, 'Conferma');
      const paint = () => { btns.forEach(([bm, bl], i) => { bm.classList.toggle('on', most === i); bl.classList.toggle('on', least === i); }); go.disabled = most === null || least === null; };
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
      if (finished) return;
      if (e.key === 'Enter' && locked && feedback) { e.preventDefault(); next(); return; }
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
    if (finished) return; finished = true;
    clearInterval(tick); document.removeEventListener('keydown', onKey);
    // unanswered items in timed sets count as wrong (not logged as attempts)
    const unanswered = items.slice(results.length).map(item => ({ item, value: null, ok: false, score: 0, ms: 0, skipped: true }));
    const all = early ? results : results.concat(unanswered);
    const totalMs = performance.now() - setStart;
    if (opts.onDone) opts.onDone({ results: all, answered: results.length, totalMs, early });
  }

  const onKey = (e) => { if (root._keys) root._keys(e); if (e.key.toLowerCase() === 'k' && document.activeElement.tagName !== 'INPUT') calc.classList.toggle('hidden'); };
  document.addEventListener('keydown', onKey);
  tick = setInterval(updateTimer, 250);
  const dispose = () => { if (!finished) { finished = true; clearInterval(tick); document.removeEventListener('keydown', onKey); } };
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
    h('div', {}, h('div', { class: 'rh-title' }, title || 'Risultato'), h('div', { class: 'muted' }, `${results.filter(r => r.ok).length}/${results.length} corrette · ${fmtTime(totalMs)} · ${inTime} nel tempo target · soglia ${Math.round(passMark * 100)}% ${pass ? '✓ superata' : '✗ non raggiunta'}`))));
  const by = new Map();
  for (const r of results) { const k = sections ? (r.section || r.item.skill) : r.item.skill; const e = by.get(k) || { n: 0, s: 0, ms: 0 }; e.n++; e.s += r.score; e.ms += r.ms; by.set(k, e); }
  root.append(h('div', { class: 'breakdown' }, [...by.entries()].map(([k, e]) => h('div', { class: 'bd' }, h('span', {}, SKILL[k] ? `${SKILL[k].icon} ${SKILL[k].short}` : k), h('div', { class: 'meter' }, h('i', { style: { width: `${(e.s / e.n) * 100}%` } })), h('b', {}, `${Math.round((e.s / e.n) * 100)}%`), h('span', { class: 'muted' }, `${e.n} dom · ${fmtTime(e.ms / e.n)}/dom`)))));
  const wrong = results.filter(r => !r.ok);
  if (wrong.length) {
    root.append(h('h3', {}, `Errori da capire (${wrong.length})`));
    const list = h('div', { class: 'review-list' });
    wrong.forEach(r => {
      const it = r.item;
      const card = h('details', { class: 'rev' });
      card.append(h('summary', {}, h('span', { class: 'chip' }, SKILL[it.skill] ? SKILL[it.skill].short : it.skill), ' ', h('span', {}, it.stem.length > 140 ? it.stem.slice(0, 140) + '…' : it.stem), r.skipped ? h('em', { class: 'muted' }, ' (non risposta)') : ''));
      const ctx = contextNode(it); if (ctx) card.append(h('div', { class: 'rev-ctx' }, ctx));
      if (it.options && !it.optionsHTML && it.type !== 'sjt') card.append(h('ol', { class: 'rev-opts', type: 'A' }, it.options.map((o, i) => h('li', { class: i === it.answer ? 'right' : (i === r.value ? 'wrong' : '') }, o))));
      card.append(h('div', { class: 'correct-ans' }, 'Risposta corretta: ', h('b', { html: it.optionsHTML ? `${LETTERS[it.answer]}<div class="mini-opt">${it.options[it.answer]}</div>` : esc(correctLabel(it)) })));
      card.append(explanationNode(it, { open: true }));
      list.append(card);
    });
    root.append(list, h('p', { class: 'muted' }, 'Gli errori sono stati aggiunti al quaderno: torneranno in ripasso tra 1, 3, 7 e 14 giorni.'));
  } else root.append(h('p', { class: 'muted' }, 'Nessun errore: ottimo.'));
  root.append(h('div', { class: 'row-end' }, onBack ? h('button', { class: 'ghost', onclick: onBack }, 'Indietro') : '', onRetry ? h('button', { class: 'primary', onclick: onRetry }, 'Nuovo set') : ''));
}
