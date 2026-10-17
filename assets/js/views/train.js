// "Train": areas hub, skill page (lessons + drill setup + mistakes), drills, lessons list, mistake notebook.
import { h, DAY, esc } from '../util.js';
import { SKILLS, SKILL, GROUPS, LESSON_SKILLS, practiceSet, content, lessonsFor } from '../content.js';
import { mastery, load, logSession, dueMistakes, openMistakes, mistakes } from '../store.js';
import { runQuiz, renderReport, explanationNode, correctLabel, contextNode, yourAnswer } from '../quiz.js';
import { go, levelBadge, skillTag, emptyContentNotice, pageHead, tabs, GROUP_TONE, toneOf } from './common.js';
import { ringSVG } from '../charts.js';
import { news, marketReady } from '../news.js';

const MODES = [
  ['learn', 'Learn', 'No rush, a hint is available, full explanation after every question'],
  ['timed', 'Timed', 'Target time per question as in the real test, explanation after every question'],
];

export function trainView(root, sub, q, rest) {
  if (sub === 'lesson') return import('./learn.js').then(m => m.lessonView(root, rest[0]));
  if (sub === 'mistakes') return mistakesView(root, rest[0], q);
  if (sub === 'lessons') return hubHead(root, 'lessons') || lessonsList(root);
  if (sub && SKILL[sub]) return sub === 'behavioural' ? go('#/interviews') : trainSkill(root, sub, q);
  if (sub) { root.append(h('p', {}, 'Area not found.')); return; }
  hubHead(root, 'areas');
  hub(root);
}

const HUB_TITLES = {
  areas: ['Every area,', 'every week', 'Method first (lessons), then practice in learn mode, then against the clock. Every mistake comes back for review until you know it.'],
  lessons: ['Method', 'before speed', 'Each lesson has worked examples to try on your own and a summary to remember. After a lesson, practise in learn mode.'],
  mistakes: ['The mistake', 'notebook', 'Every mistake comes back after 1, 3, 7 and 14 days. It closes only after 4 correct answers, each at the right time.'],
};
function hubHead(root, cur) {
  const C = content(), S = load();
  const read = C.lessons.filter(l => S.lessonsRead[l.id]).length;
  const due = dueMistakes().length;
  root.append(emptyContentNotice() || '');
  const [title, accent, sub] = HUB_TITLES[cur] || HUB_TITLES.areas;
  root.append(pageHead({ kicker: 'Train', title, accent, sub }));
  root.append(tabs([['areas', 'Areas', '#/train'], ['lessons', `Lessons ${read}/${C.lessons.length}`, '#/train/lessons'], ['mistakes', 'Mistakes', '#/train/mistakes', due || null]], cur));
}

function hub(root) {
  const C = content();
  for (const g of GROUPS) {
    const list = SKILLS.filter(s => s.group === g);
    root.append(h('section', { class: `card tone-${GROUP_TONE[g]}` }, h('div', { class: 'card-h' }, h('h2', {}, g)), h('div', { class: 'train-grid' }, list.map(s => {
      const m = mastery(s.id);
      const nBank = (C.bySkill.get(s.id) || []).length;
      const gen = ['mental', 'numerical', 'inductive'].includes(s.id);
      const newsy = (marketReady(s.id) || news().concepts.some(c => c.skill === s.id));
      const ls = lessonsFor(s.id);
      const bits = [gen ? '∞ generated' : '', nBank ? `${nBank} in the bank` : '', newsy ? '+ this week’s news' : ''].filter(Boolean).join(' · ');
      return h('a', { class: `train-card ${toneOf(s)}`, href: `#/train/${s.id}` },
        h('div', { class: 'tc-top' }, skillTag(s), h('div', { class: 'tc-ring', html: ringSVG(m.score / 100, { size: 44, label: m.total ? `${m.score}` : '–' }) })),
        h('div', { class: 'tc-t' }, s.name), levelBadge(m),
        h('div', { class: 'muted small' }, bits || '–'),
        ls.length ? h('div', { class: 'muted small' }, `${ls.length} ${ls.length === 1 ? 'lesson' : 'lessons'}`) : '');
    }))));
  }
}

export function trainSkill(root, skill, q) {
  const s = SKILL[skill];
  if (q.mode) return startSet(root, skill, q.mode, Number(q.n) || 12, q.level ? Number(q.level) : null);
  const m = mastery(skill);
  const ls = lessonsFor(skill);
  const S = load();
  const open = openMistakes().filter(e => e.item.skill === skill);
  let mode = m.level < 2 ? 'learn' : 'timed', n = 12, level = null;
  root.append(h('div', { class: 'crumbs' }, h('a', { href: '#/train' }, 'Train'), ' / ', s.name));
  root.append(pageHead({ kicker: `${s.code} · ${s.group}`, title: s.name, sub: m.stale ? `Last practised ${m.idleDays} days ago: the level has dropped by one until you train again.` : '', right: h('div', { class: 'ph-ring' }, h('div', { html: ringSVG(m.score / 100, { size: 76, label: m.total ? `${m.score}` : '–' }) }), levelBadge(m)) }));
  root.append(h('div', { class: 'kpis three' },
    h('div', { class: 'kpi' }, h('div', { class: 'kpi-big' }, m.total ? `${Math.round(m.acc * 100)}%` : '–'), h('div', { class: 'kpi-txt' }, h('div', { class: 'kpi-l' }, 'Accuracy'), h('div', { class: 'muted small' }, 'last 30 answers'))),
    h('div', { class: 'kpi' }, h('div', { class: 'kpi-big' }, m.timedN ? `${Math.round(m.speed * 100)}%` : '–'), h('div', { class: 'kpi-txt' }, h('div', { class: 'kpi-l' }, 'Correct on time'), h('div', { class: 'muted small' }, 'timed mode only'))),
    h('div', { class: 'kpi' }, h('div', { class: 'kpi-big' }, String(m.total)), h('div', { class: 'kpi-txt' }, h('div', { class: 'kpi-l' }, 'Questions done'), h('div', { class: 'muted small' }, `${open.length} open mistakes`)))));

  const modeBox = h('div', { class: 'seg', role: 'group', 'aria-label': 'Mode' });
  const desc = h('div', { class: 'muted small setup-desc' });
  const paintMode = () => { [...modeBox.children].forEach(b => { b.classList.toggle('on', b.dataset.v === mode); b.setAttribute('aria-pressed', String(b.dataset.v === mode)); }); desc.textContent = MODES.find(x => x[0] === mode)[2]; };
  MODES.forEach(([v, t]) => modeBox.append(h('button', { 'data-v': v, onclick: () => { mode = v; paintMode(); } }, t)));
  const nBox = h('div', { class: 'seg', role: 'group', 'aria-label': 'Number of questions' });
  const paintN = () => [...nBox.children].forEach(b => { b.classList.toggle('on', Number(b.dataset.v) === n); b.setAttribute('aria-pressed', String(Number(b.dataset.v) === n)); });
  [8, 12, 20].forEach(v => nBox.append(h('button', { 'data-v': v, onclick: () => { n = v; paintN(); } }, `${v}`)));
  const lvBox = h('div', { class: 'seg', role: 'group', 'aria-label': 'Difficulty' });
  const paintL = () => [...lvBox.children].forEach(b => { b.classList.toggle('on', String(b.dataset.v) === String(level)); b.setAttribute('aria-pressed', String(String(b.dataset.v) === String(level))); });
  [[null, 'All'], [1, 'Base'], [2, 'Standard'], [3, 'Hard']].forEach(([v, t]) => lvBox.append(h('button', { 'data-v': String(v), onclick: () => { level = v; paintL(); } }, t)));
  paintMode(); paintN(); paintL();
  const newsy = marketReady(skill) || news().concepts.some(c => c.skill === skill);
  const setup = h('section', { class: 'card setup' },
    h('div', { class: 'card-h' }, h('h2', {}, 'Practice')),
    h('div', { class: 'setup-row' }, h('span', { class: 'setup-k' }, 'Mode'), modeBox),
    h('div', { class: 'setup-row' }, h('span', { class: 'setup-k' }, 'Questions'), nBox),
    h('div', { class: 'setup-row' }, h('span', { class: 'setup-k' }, 'Difficulty'), lvBox),
    desc,
    newsy ? h('div', { class: 'note-accent small' }, 'The set includes questions built on this week’s news and real market data (only with difficulty "All").') : '',
    h('div', { class: 'row-end' }, h('button', { class: 'btn primary big', onclick: () => go(`#/train/${skill}?mode=${mode}&n=${n}${level ? `&level=${level}` : ''}`) }, 'Start', h('span', { class: 'arrow' }, '→'))));
  const side = h('div', { class: 'stack' });
  if (ls.length) side.append(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Lessons'), h('span', { class: 'muted small' }, `${ls.filter(l => S.lessonsRead[l.id]).length}/${ls.length} read`)),
    h('div', { class: 'lesson-list' }, ls.map(l => lessonRow(l, S)))));
  side.append(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Mistakes in this area')),
    open.length ? h('div', {}, h('p', { class: 'muted small' }, `${open.length} open, ${open.filter(e => e.due <= Date.now()).length} due now.`), h('a', { class: 'btn ghost small', href: `#/train/mistakes/all?skill=${skill}` }, 'Review this area’s mistakes'))
      : h('p', { class: 'muted small' }, 'No open mistakes. The ones you make will appear here and in the notebook.')));
  root.append(h('div', { class: 'grid-2' }, setup, side));
}

function lessonRow(l, S) {
  return h('a', { class: 'lesson-row' + (S.lessonsRead[l.id] ? ' read' : ''), href: `#/train/lesson/${l.id}` },
    h('span', { class: 'tick' }, S.lessonsRead[l.id] ? '✓' : ''),
    h('div', { class: 'lr-b' }, h('div', { class: 'lr-t' }, l.title), l.summary ? h('div', { class: 'muted small' }, l.summary) : ''),
    h('span', { class: 'lr-m' }, `${l.minutes || 10}′`));
}

function startSet(root, skill, mode, n, level) {
  const S = load();
  const seen = new Set(S.attempts.filter(a => a.skill === skill).map(a => a.id));
  const items = practiceSet(skill, n, { level, seenIds: seen });
  if (!items.length) { root.append(h('p', {}, 'No questions available for this area (content not loaded?).')); return; }
  const box = h('div', { class: 'quiz' });
  root.append(box);
  const label = `${SKILL[skill].name} · ${mode === 'learn' ? 'learn' : 'timed'}`;
  runQuiz(box, items, {
    mode, title: label,
    onDone: ({ results, totalMs, answered }) => {
      if (answered) logSession({ kind: 'drill', skill, mode, n: answered, correct: results.filter(r => r.ok).length, ms: totalMs });
      renderReport(box, { results: results.filter(r => !r.skipped || mode !== 'learn'), totalMs, title: label, passMark: mode === 'learn' ? 0.6 : 0.75,
        onRetry: () => { location.hash = `#/train/${skill}?mode=${mode}&n=${n}${level ? `&level=${level}` : ''}&r=${Date.now()}`; },
        onBack: () => go(`#/train/${skill}`) });
    },
  });
}

// ---------- lessons ----------
const ORDER = ['numerical', 'mental', 'verbal', 'logical', 'inductive', 'workstyle', 'sjt', 'fin-acc', 'fin-val', 'fin-ma', 'fin-lbo', 'fin-ecm', 'fin-tmt', 'markets', 'culture', 'commercial', 'behavioural'];
function lessonsList(root) {
  const C = content(); const S = load();
  const groups = new Map();
  for (const l of C.lessons) { if (!groups.has(l.skill)) groups.set(l.skill, []); groups.get(l.skill).push(l); }
  const keys = [...groups.keys()].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const wrap = h('div', { class: 'lesson-groups' });
  for (const k of keys) {
    const sk = SKILL[k] || LESSON_SKILLS[k] || { name: k, code: '•' };
    const m = SKILL[k] ? mastery(k) : null;
    wrap.append(h('section', { class: 'card' },
      h('div', { class: 'card-h' }, h('h2', { class: 'sk-name' }, skillTag(sk), h('span', {}, sk.name)), m ? levelBadge(m) : ''),
      h('div', { class: 'lesson-list' }, groups.get(k).map(l => lessonRow(l, S)))));
  }
  root.append(wrap);
}

// ---------- mistake notebook ----------
function mistakesView(root, sub, q) {
  const skill = q.skill && SKILL[q.skill] ? q.skill : null;
  if (sub === 'review' || sub === 'all') return reviewRun(root, sub === 'all', skill);
  hubHead(root, 'mistakes');
  const due = dueMistakes(); const open = openMistakes(); const all = mistakes();
  const mastered = all.filter(e => e.done).length;
  root.append(h('div', { class: 'kpis three' },
    h('div', { class: 'kpi' }, h('div', { class: 'kpi-big' + (due.length ? ' warn' : '') }, String(due.length)), h('div', { class: 'kpi-txt' }, h('div', { class: 'kpi-l' }, 'Due today'), h('div', { class: 'muted small' }, 'back after 1, 3, 7, 14 days'))),
    h('div', { class: 'kpi' }, h('div', { class: 'kpi-big' }, String(open.length)), h('div', { class: 'kpi-txt' }, h('div', { class: 'kpi-l' }, 'Open'), h('div', { class: 'muted small' }, 'in the notebook'))),
    h('div', { class: 'kpi' }, h('div', { class: 'kpi-big ok' }, String(mastered)), h('div', { class: 'kpi-txt' }, h('div', { class: 'kpi-l' }, 'Closed'), h('div', { class: 'muted small' }, '4 correct answers in a row')))));
  root.append(h('div', { class: 'row-start mb' },
    h('button', { class: 'btn primary', disabled: !due.length, onclick: () => go('#/train/mistakes/review') }, `Review now (${Math.min(due.length, 15)})`),
    h('button', { class: 'btn ghost', disabled: !open.length, onclick: () => go('#/train/mistakes/all') }, `Practise all open ones (${open.length})`)));
  const by = new Map(); for (const e of open) { const k = e.item.skill; by.set(k, (by.get(k) || 0) + 1); }
  if (by.size) root.append(h('div', { class: 'chips-row' }, [...by.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => h('a', { class: 'chip', href: `#/train/mistakes/all?skill=${k}` }, `${SKILL[k] ? SKILL[k].short : k}: ${v}`))));
  const list = h('div', { class: 'review-list' });
  open.sort((a, b) => a.due - b.due).slice(0, 80).forEach(e => {
    const it = e.item;
    const d = Math.ceil((e.due - Date.now()) / DAY);
    const det = h('details', { class: 'rev' }, h('summary', {}, skillTag(SKILL[it.skill]), h('span', { class: 'rev-stem' }, it.stem), h('span', { class: 'rev-meta' }, `box ${e.box}/4 · ${d <= 0 ? 'due now' : `in ${d} ${d === 1 ? 'day' : 'days'}`} · wrong ${e.wrong}×`)));
    det.addEventListener('toggle', () => { // render the context (table, passage, panels) only when opened
      if (!det.open || det.dataset.filled) return; det.dataset.filled = '1';
      const ctx = it.context ? contextNode(it) : null;
      const opts = it.options && !it.optionsHTML && it.type === 'mcq' ? h('ol', { class: 'rev-opts', type: 'A', lang: 'en' }, it.options.map((o, i) => h('li', { class: i === it.answer ? 'right' : (i === e.yours ? 'wrong' : '') }, o))) : '';
      const yours = yourAnswer(it, e.yours, false);
      det.append(ctx ? h('div', { class: 'rev-ctx' }, ctx) : '', opts,
        h('div', { class: 'correct-ans' }, 'Correct answer: ', h('b', { html: it.optionsHTML ? `${'ABCDE'[it.answer]}<div class="mini-opt">${it.options[it.answer]}</div>` : esc(correctLabel(it)) })),
        yours ? h('div', { class: 'your-ans' }, 'Your last answer: ', h('b', { class: 'ko' }, yours)) : '',
        explanationNode(it, { open: true }));
    });
    list.append(det);
  });
  if (!open.length) list.append(h('p', { class: 'muted' }, 'No open mistakes. The mistakes you make in practice land here automatically.'));
  root.append(list);
}

function reviewRun(root, everything, skill) {
  let entries = everything ? openMistakes() : dueMistakes();
  if (skill) entries = entries.filter(e => e.item.skill === skill);
  if (!everything) entries = entries.slice(0, 15);
  if (!entries.length) { root.append(h('div', { class: 'cta' }, h('div', {}, h('div', { class: 'cta-t' }, 'Nothing to review right now'), h('div', { class: 'muted' }, 'Mistakes come back automatically when they are due.')), h('a', { class: 'btn ghost', href: '#/train/mistakes' }, 'Notebook'))); return; }
  const items = entries.map(e => e.item);
  const box = h('div', { class: 'quiz' }); root.append(box);
  runQuiz(box, items, {
    mode: 'review', title: `Mistake review${skill ? ` · ${SKILL[skill].short}` : ''}`,
    onDone: ({ results, totalMs, answered }) => {
      if (answered) logSession({ kind: 'review', n: answered, correct: results.filter(r => r.ok).length, ms: totalMs });
      renderReport(box, { results, totalMs, title: 'Mistake review', passMark: 0.8, onBack: () => go('#/train/mistakes'), onRetry: () => go('#/train/mistakes') });
    },
  });
}
