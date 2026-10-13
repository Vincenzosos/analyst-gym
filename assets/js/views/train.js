// Practice: choose an area and mode, run a set, report. Also the mistake notebook.
import { h, fmtTime, DAY } from '../util.js';
import { SKILLS, SKILL, practiceSet, content, lessonsFor } from '../content.js';
import { mastery, load, logSession, dueMistakes, openMistakes, mistakes } from '../store.js';
import { runQuiz, renderReport, explanationNode, correctLabel } from '../quiz.js';
import { go, levelBadge, emptyContentNotice } from './common.js';

const MODES = [
  ['learn', 'Impara', 'Senza fretta, suggerimenti, spiegazione dopo ogni domanda'],
  ['timed', 'Cronometrato', 'Tempo target per domanda, come nel test reale'],
];

export function trainHome(root) {
  root.append(emptyContentNotice() || '');
  root.append(h('div', { class: 'page-h' }, h('h1', {}, 'Allenamento'), h('span', { class: 'muted' }, 'Scegli un’area. Le domande numeriche, di calcolo e astratte sono generate nuove ogni volta.')));
  const groups = ['Test online', 'Tecnico', 'Colloquio'];
  const C = content();
  for (const g of groups) {
    const list = SKILLS.filter(s => s.group === g && s.id !== 'behavioural');
    root.append(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, g)), h('div', { class: 'train-grid' }, list.map(s => {
      const m = mastery(s.id);
      const nBank = (C.bySkill.get(s.id) || []).length;
      const gen = ['mental', 'numerical', 'inductive'].includes(s.id);
      return h('a', { class: 'train-card', href: `#/allenamento/${s.id}` }, h('div', { class: 'tc-t' }, `${s.icon} ${s.name}`), levelBadge(m), h('div', { class: 'muted small' }, `${gen ? '∞ generate' : ''}${gen && nBank ? ' + ' : ''}${nBank ? nBank + ' in banca' : ''}`));
    }))));
  }
}

export function trainSkill(root, skill, q) {
  const s = SKILL[skill];
  if (!s) { root.append(h('p', {}, 'Area non trovata.')); return; }
  if (q.mode) return startSet(root, skill, q.mode, Number(q.n) || 12, q.level ? Number(q.level) : null);
  const m = mastery(skill);
  const ls = lessonsFor(skill);
  const S = load();
  let mode = m.level < 2 ? 'learn' : 'timed', n = 12, level = null;
  root.append(h('div', { class: 'crumbs' }, h('a', { href: '#/allenamento' }, 'Allenamento'), ' / ', s.name));
  root.append(h('div', { class: 'page-h' }, h('h1', {}, `${s.icon} ${s.name}`), levelBadge(m)));
  root.append(h('div', { class: 'kpis three' },
    h('div', { class: 'kpi' }, h('div', { class: 'kpi-big' }, m.total ? `${Math.round(m.acc * 100)}%` : '–'), h('div', { class: 'kpi-l' }, 'Accuratezza (ultime 30)')),
    h('div', { class: 'kpi' }, h('div', { class: 'kpi-big' }, m.timedN ? `${Math.round(m.speed * 100)}%` : '–'), h('div', { class: 'kpi-l' }, 'Risposte giuste nel tempo')),
    h('div', { class: 'kpi' }, h('div', { class: 'kpi-big' }, String(m.total)), h('div', { class: 'kpi-l' }, 'Domande fatte'))));
  if (ls.length) root.append(h('div', { class: 'lesson-strip' }, h('span', { class: 'muted' }, 'Lezioni: '), ls.map(l => h('a', { href: `#/lezioni/${l.id}`, class: S.lessonsRead[l.id] ? 'read' : '' }, `${S.lessonsRead[l.id] ? '✓ ' : ''}${l.title}`))));
  const modeBox = h('div', { class: 'seg' });
  const paintMode = () => [...modeBox.children].forEach(b => b.classList.toggle('on', b.dataset.v === mode));
  MODES.forEach(([v, t, d]) => modeBox.append(h('button', { 'data-v': v, title: d, onclick: () => { mode = v; paintMode(); } }, t)));
  const nBox = h('div', { class: 'seg' });
  const paintN = () => [...nBox.children].forEach(b => b.classList.toggle('on', Number(b.dataset.v) === n));
  [8, 12, 20].forEach(v => nBox.append(h('button', { 'data-v': v, onclick: () => { n = v; paintN(); } }, `${v} domande`)));
  const lvBox = h('div', { class: 'seg' });
  const paintL = () => [...lvBox.children].forEach(b => b.classList.toggle('on', String(b.dataset.v) === String(level)));
  [[null, 'Tutti'], [1, 'Base'], [2, 'Standard'], [3, 'Difficile']].forEach(([v, t]) => lvBox.append(h('button', { 'data-v': String(v), onclick: () => { level = v; paintL(); } }, t)));
  paintMode(); paintN(); paintL();
  root.append(h('section', { class: 'card setup' },
    h('div', { class: 'setup-row' }, h('span', { class: 'muted' }, 'Modalità'), modeBox),
    h('div', { class: 'setup-row' }, h('span', { class: 'muted' }, 'Lunghezza'), nBox),
    h('div', { class: 'setup-row' }, h('span', { class: 'muted' }, 'Difficoltà'), lvBox),
    h('div', { class: 'muted small' }, mode === 'learn' ? MODES[0][2] : MODES[1][2]),
    h('div', { class: 'row-end' }, h('button', { class: 'primary big', onclick: () => go(`#/allenamento/${skill}?mode=${mode}&n=${n}${level ? `&level=${level}` : ''}`) }, 'Inizia ↵'))));
}

function startSet(root, skill, mode, n, level) {
  const S = load();
  const seen = new Set(S.attempts.filter(a => a.skill === skill).map(a => a.id));
  const items = practiceSet(skill, n, { level, seenIds: seen });
  if (!items.length) { root.append(h('p', {}, 'Nessuna domanda disponibile per questa area (contenuti non caricati?).')); return; }
  const box = h('div', { class: 'quiz' });
  root.append(box);
  runQuiz(box, items, {
    mode, title: `${SKILL[skill].icon} ${SKILL[skill].name} · ${mode === 'learn' ? 'impara' : 'cronometrato'}`,
    onDone: ({ results, totalMs, answered }) => {
      if (answered) logSession({ kind: 'drill', skill, mode, n: answered, correct: results.filter(r => r.ok).length, ms: totalMs });
      renderReport(box, { results: results.filter(r => !r.skipped || mode !== 'learn'), totalMs, title: `${SKILL[skill].name} · ${mode === 'learn' ? 'impara' : 'cronometrato'}`, passMark: mode === 'learn' ? 0.6 : 0.75,
        onRetry: () => { location.hash = `#/allenamento/${skill}?mode=${mode}&n=${n}${level ? `&level=${level}` : ''}&r=${Date.now()}`; },
        onBack: () => go(`#/allenamento/${skill}`) });
    },
  });
}

// ---------- mistake notebook ----------
export function mistakesView(root, sub) {
  if (sub === 'ripasso' || sub === 'tutti') return reviewRun(root, sub === 'tutti');
  const due = dueMistakes(); const open = openMistakes(); const all = mistakes();
  const mastered = all.filter(e => e.done).length;
  root.append(h('div', { class: 'page-h' }, h('h1', {}, 'Quaderno degli errori'), h('span', { class: 'muted' }, 'Ogni errore torna dopo 1, 3, 7 e 14 giorni; dopo 4 risposte giuste di fila è chiuso.')));
  root.append(h('div', { class: 'kpis three' },
    h('div', { class: 'kpi' }, h('div', { class: 'kpi-big' + (due.length ? ' warn' : '') }, String(due.length)), h('div', { class: 'kpi-l' }, 'Da ripassare oggi')),
    h('div', { class: 'kpi' }, h('div', { class: 'kpi-big' }, String(open.length)), h('div', { class: 'kpi-l' }, 'Aperti')),
    h('div', { class: 'kpi' }, h('div', { class: 'kpi-big ok' }, String(mastered)), h('div', { class: 'kpi-l' }, 'Chiusi (imparati)'))));
  root.append(h('div', { class: 'row-end' },
    h('button', { class: 'ghost', disabled: !open.length, onclick: () => go('#/errori/tutti') }, `Ripassa tutti gli aperti (${open.length})`),
    h('button', { class: 'primary', disabled: !due.length, onclick: () => go('#/errori/ripasso') }, `Ripassa ora (${Math.min(due.length, 15)})`)));
  // by skill
  const by = new Map(); for (const e of open) { const k = e.item.skill; by.set(k, (by.get(k) || 0) + 1); }
  if (by.size) root.append(h('div', { class: 'chips-row' }, [...by.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => h('span', { class: 'chip' }, `${SKILL[k] ? SKILL[k].short : k}: ${v}`))));
  const list = h('div', { class: 'review-list' });
  open.sort((a, b) => a.due - b.due).slice(0, 80).forEach(e => {
    const it = e.item;
    const d = Math.ceil((e.due - Date.now()) / DAY);
    list.append(h('details', { class: 'rev' }, h('summary', {}, h('span', { class: 'chip' }, SKILL[it.skill] ? SKILL[it.skill].short : it.skill), ' ', h('span', {}, it.stem.slice(0, 120) + (it.stem.length > 120 ? '…' : '')), h('span', { class: 'muted small' }, ` · box ${e.box}/4 · ${d <= 0 ? 'da ripassare' : 'tra ' + d + ' gg'} · sbagliata ${e.wrong}×`)),
      h('div', { class: 'correct-ans' }, 'Risposta corretta: ', h('b', { html: it.optionsHTML ? `${'ABCDE'[it.answer]}<div class="mini-opt">${it.options[it.answer]}</div>` : correctLabel(it) })), explanationNode(it, { open: true })));
  });
  if (!open.length) list.append(h('p', { class: 'muted' }, 'Nessun errore aperto. Gli errori che fai negli esercizi finiscono qui automaticamente.'));
  root.append(list);
}

function reviewRun(root, everything) {
  const entries = everything ? openMistakes() : dueMistakes().slice(0, 15);
  if (!entries.length) { root.append(h('p', {}, 'Niente da ripassare ora.')); return; }
  const items = entries.map(e => e.item);
  const box = h('div', { class: 'quiz' }); root.append(box);
  runQuiz(box, items, {
    mode: 'review', title: '🔁 Ripasso errori',
    onDone: ({ results, totalMs, answered }) => {
      if (answered) logSession({ kind: 'review', n: answered, correct: results.filter(r => r.ok).length, ms: totalMs });
      renderReport(box, { results, totalMs, title: 'Ripasso errori', passMark: 0.8, onBack: () => go('#/errori'), onRetry: () => go('#/errori') });
    },
  });
}
