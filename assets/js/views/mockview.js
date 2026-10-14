// Mock tests: list, sectioned runner, report, diagnostic baseline.
import { h, fmtTime, rng, newSeed, shuffle } from '../util.js';
import { MOCKS, MOCK } from '../mocks.js';
import { practiceSet, generate, content, SKILL } from '../content.js';
import { load, logMock, setDiag } from '../store.js';
import { runQuiz, renderReport } from '../quiz.js';
import { videoRoom } from './interview.js';
import { go, pageHead } from './common.js';

const MOCK_TONE = { diag: 'violet', 'shl-num': 'indigo', 'shl-verb': 'sky', inductive: 'teal', capp: 'amber', bofa: 'rose', tech: 'green', video: 'violet' };

export function mocksList(root) {
  const S = load();
  root.append(pageHead({ kicker: 'Mocks', title: 'Real test', accent: 'conditions', sub: 'Timed sections, no feedback until the end, then the explanation of every mistake. One a week is part of the mission.' }));
  const grid = h('div', { class: 'mock-grid' });
  for (const m of MOCKS) {
    const runs = (S.mocks || []).filter(x => x.mockId === m.id);
    const best = runs.length ? Math.max(...runs.map(x => x.score)) : null;
    const last = runs.length ? runs[runs.length - 1] : null;
    grid.append(h('a', { class: `mock-card tone-${MOCK_TONE[m.id] || 'indigo'}`, href: `#/mocks/${m.id}` },
      h('div', { class: 'mc-top' }, h('span', { class: 'chip' }, m.tag), h('span', { class: 'mc-min' }, `${m.minutes}′`)),
      h('div', { class: 'mc-t' }, m.title), h('div', { class: 'muted small' }, m.desc),
      h('div', { class: 'mc-foot' }, runs.length ? h('span', { class: 'mc-best' + (best >= (m.passMark || 0.7) ? ' ok' : '') }, `Best ${Math.round(best * 100)}% · last ${Math.round(last.score * 100)}% · ${runs.length}×`) : h('span', { class: 'muted' }, 'Never taken'), m.passMark ? h('span', { class: 'muted small' }, `pass mark ${Math.round(m.passMark * 100)}%`) : '')));
  }
  root.append(grid);
  const hist = (S.mocks || []).slice(-12).reverse();
  if (hist.length) root.append(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'History')),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'data-table compact' }, h('thead', {}, h('tr', {}, [['Date', ''], ['Mock', ''], ['Score', 'num'], ['Time', 'num']].map(([t, c]) => h('th', { class: c }, t)))),
      h('tbody', {}, hist.map(x => h('tr', {}, h('td', {}, new Date(x.t).toLocaleDateString('en-GB')), h('td', {}, (MOCK[x.mockId] || {}).title || x.mockId), h('td', { class: 'num' + (x.score >= (x.passMark || 0.7) ? ' ok' : '') }, `${Math.round(x.score * 100)}%`), h('td', { class: 'num' }, fmtTime(x.ms || 0)))))))));
}

export function mockRun(root, id) {
  const m = MOCK[id];
  if (!m) { root.append(h('p', {}, 'Mock not found.')); return; }
  root.append(h('div', { class: 'crumbs' }, h('a', { href: '#/mocks' }, 'Mocks'), ' / ', m.title));
  if (m.video) return videoMock(root, m);
  const intro = h('section', { class: 'card mock-intro' },
    h('div', { class: 'kicker' }, m.tag), h('h1', { class: 'display' }, m.title), h('p', { class: 'lead' }, m.desc),
    h('div', { class: 'sec-list' }, (m.sections || []).map((s, i) => h('div', { class: 'sec-item' }, h('span', { class: 'sec-n' }, String(i + 1).padStart(2, '0')), h('span', { class: 'sec-name' }, s.name || (SKILL[s.skill] ? SKILL[s.skill].name : 'Number series')), h('span', { class: 'sec-meta' }, `${s.n} ${s.n === 1 ? 'question' : 'questions'}${s.limit ? ` · ${Math.round(s.limit / 60)} min` : ''}`)))),
    h('p', { class: 'small muted' }, `${m.timeLimit ? `Total time ${Math.round(m.timeLimit / 60)} min. ` : ''}Shortcuts: 1–5 or A–E to answer, T/F/C in verbal, K for the calculator. Keep pen and paper at hand.`),
    h('div', { class: 'row-end' }, h('button', { class: 'btn primary big', onclick: () => start() }, 'Start', h('span', { class: 'arrow' }, '↵'))));
  root.append(intro);
  const onEnter = e => { if (e.key === 'Enter') { document.removeEventListener('keydown', onEnter); start(); } };
  document.addEventListener('keydown', onEnter);
  window.addEventListener('hashchange', () => document.removeEventListener('keydown', onEnter), { once: true });

  function buildSection(s, seed) {
    if (s.skill === 'series') return Array.from({ length: s.n }, (_, k) => generate('series', seed + k * 7919));
    const seen = new Set(load().attempts.filter(a => a.skill === s.skill).map(a => a.id));
    return practiceSet(s.skill, s.n, { seenIds: seen, seed });
  }

  function start() {
    document.removeEventListener('keydown', onEnter);
    intro.remove();
    const seed = newSeed();
    const sections = m.sections.map((s, k) => ({ ...s, items: buildSection(s, seed + k * 104729).map(it => it) }));
    const box = h('div', { class: 'quiz' }); root.append(box);
    const all = []; let totalMs = 0, endedEarly = false;
    if (m.single) {
      const items = sections.flatMap(s => s.items.map(it => ({ ...it, _section: s.name || s.skill })));
      runQuiz(box, items, { mode: m.mode === 'diag' ? 'diag' : 'mock', title: m.title, timeLimit: m.timeLimit, onDone: ({ results, totalMs: t, early }) => done(box, results.map(r => ({ ...r, section: r.item._section })), t, early) });
      return;
    }
    let k = 0;
    const nextSection = () => {
      if (k >= sections.length) return done(box, all, totalMs, endedEarly);
      const s = sections[k];
      box.innerHTML = '';
      box.append(h('div', { class: 'cta' }, h('div', {}, h('div', { class: 'cta-t' }, `Section ${k + 1}/${sections.length}: ${s.name || SKILL[s.skill].name}`), h('div', { class: 'muted' }, `${s.items.length} ${s.items.length === 1 ? 'question' : 'questions'}${s.limit ? ` in ${Math.round(s.limit / 60)} minutes` : ''}`)), h('button', { class: 'btn primary', onclick: () => {
        runQuiz(box, s.items, { mode: 'mock', title: `${m.title} · ${s.name || ''}`, timeLimit: s.limit, onDone: ({ results, totalMs: t, early }) => { all.push(...results.map(r => ({ ...r, section: s.name || s.skill }))); totalMs += t; if (early) endedEarly = true; k = early ? sections.length : k + 1; nextSection(); } });
      } }, 'Start section')));
    };
    nextSection();
  }

  function done(box, results, totalMs, early = false) {
    const n = results.length || 1;
    const score = results.reduce((s, r) => s + r.score, 0) / n;
    const per = {};
    for (const r of results) { const sk = r.item.skill; per[sk] = per[sk] || { n: 0, s: 0 }; per[sk].n++; per[sk].s += r.score; }
    const perAcc = Object.fromEntries(Object.entries(per).map(([k, v]) => [k, v.s / v.n]));
    logMock({ mockId: m.id, score, ms: totalMs, n: results.length, passMark: m.passMark || 0.7, per: perAcc, early });
    const remeasure = m.id === 'diag' && !early ? setDiag(perAcc) : false;
    renderReport(box, { results, totalMs, title: m.title, passMark: m.passMark || 0.7, sections: true, onBack: () => go('#/mocks'), onRetry: () => { location.hash = `#/mocks/${m.id}?r=${Date.now()}`; } });
    if (early) box.prepend(h('div', { class: 'notice' }, 'Mock ended early: your answers count towards the levels, but the mock is not marked as completed.'));
    else if (m.id === 'diag') box.prepend(h('div', { class: 'notice ok' }, remeasure ? 'New measurement saved. Your starting point stays your first diagnostic, so Progress always shows how far you have come.' : 'Diagnostic saved: this is your starting point. Today now recommends a session on your weakest areas.'));
  }
}

function videoMock(root, m) {
  const C = content();
  const r = rng(newSeed());
  const pool = C.behavioural;
  const pickCat = cat => shuffle(r, pool.filter(x => x.category === cat))[0];
  const qs = [pickCat('motivation'), pickCat('competency'), pickCat('competency'), pickCat('strengths') || pickCat('banking-specific'), pickCat('banking-specific') || pickCat('technical-explain')].filter(Boolean);
  const box = h('div', {}); root.append(h('section', { class: 'card' }, h('div', { class: 'kicker' }, m.tag), h('h1', { class: 'display' }, m.title), h('p', { class: 'lead' }, m.desc)), box);
  videoRoom(box, { questions: qs.length ? qs : null, onDone: () => { box.innerHTML = ''; box.append(h('div', { class: 'cta' }, h('div', {}, h('div', { class: 'cta-t' }, 'Video mock completed'), h('div', { class: 'muted' }, 'Your self-ratings count towards the Behavioural area. Redo any question you rated below 4.')), h('a', { class: 'btn primary', href: '#/today/progress' }, 'See progress'))); } });
}
