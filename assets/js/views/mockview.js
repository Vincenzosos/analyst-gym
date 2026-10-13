// Mock tests: list, sectioned runner, report, diagnostic baseline.
import { h, fmtTime, rng, newSeed, shuffle } from '../util.js';
import { MOCKS, MOCK } from '../mocks.js';
import { practiceSet, generate, content, SKILL } from '../content.js';
import { load, logMock, setDiag } from '../store.js';
import { runQuiz, renderReport } from '../quiz.js';
import { videoRoom } from './interview.js';
import { go } from './common.js';

export function mocksList(root) {
  const S = load();
  root.append(h('div', { class: 'page-h' }, h('h1', {}, 'Simulazioni'), h('span', { class: 'muted' }, 'Condizioni da test vero: tempo a sezione, nessun feedback fino alla fine.')));
  const grid = h('div', { class: 'mock-grid' });
  for (const m of MOCKS) {
    const runs = (S.mocks || []).filter(x => x.mockId === m.id);
    const best = runs.length ? Math.max(...runs.map(x => x.score)) : null;
    const last = runs.length ? runs[runs.length - 1] : null;
    grid.append(h('a', { class: 'mock-card', href: `#/simulazioni/${m.id}` },
      h('div', { class: 'mc-top' }, h('span', { class: 'chip' }, m.tag), h('span', { class: 'muted small' }, `${m.minutes}′`)),
      h('div', { class: 'mc-t' }, m.title), h('div', { class: 'muted small' }, m.desc),
      h('div', { class: 'mc-foot' }, runs.length ? h('span', {}, `Migliore ${Math.round(best * 100)}% · ultima ${Math.round(last.score * 100)}% · ${runs.length}×`) : h('span', { class: 'muted' }, 'Mai fatta'), m.passMark ? h('span', { class: 'muted small' }, `soglia ${Math.round(m.passMark * 100)}%`) : '')));
  }
  root.append(grid);
  const hist = (S.mocks || []).slice(-12).reverse();
  if (hist.length) root.append(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Storico')),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'data-table compact' }, h('thead', {}, h('tr', {}, ['Data', 'Simulazione', 'Punteggio', 'Tempo'].map(t => h('th', {}, t)))),
      h('tbody', {}, hist.map(x => h('tr', {}, h('td', {}, new Date(x.t).toLocaleDateString('it-IT')), h('td', {}, (MOCK[x.mockId] || {}).title || x.mockId), h('td', { class: 'num' + (x.score >= (x.passMark || 0.7) ? ' ok' : '') }, `${Math.round(x.score * 100)}%`), h('td', { class: 'num' }, fmtTime(x.ms || 0)))))))));
}

export function mockRun(root, id) {
  const m = MOCK[id];
  if (!m) { root.append(h('p', {}, 'Simulazione non trovata.')); return; }
  root.append(h('div', { class: 'crumbs' }, h('a', { href: '#/simulazioni' }, 'Simulazioni'), ' / ', m.title));
  if (m.video) return videoMock(root, m);
  const intro = h('section', { class: 'card' },
    h('h1', {}, m.title), h('p', { class: 'muted' }, m.desc),
    h('ul', {}, (m.sections || []).map(s => h('li', {}, `${s.name || (SKILL[s.skill] ? SKILL[s.skill].name : 'Serie numeriche')}: ${s.n} domande${s.limit ? ` · ${Math.round(s.limit / 60)} min` : ''}`))),
    h('p', { class: 'small muted' }, `${m.timeLimit ? `Tempo totale ${Math.round(m.timeLimit / 60)} min. ` : ''}Tasti rapidi: 1–5 o A–E per rispondere, T/F/C nel verbal, K per la calcolatrice. Tieni carta e penna.`),
    h('div', { class: 'row-end' }, h('button', { class: 'primary big', onclick: () => start() }, 'Inizia ↵')));
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
      box.append(h('div', { class: 'cta' }, h('div', {}, h('div', { class: 'cta-t' }, `Sezione ${k + 1}/${sections.length}: ${s.name || SKILL[s.skill].name}`), h('div', { class: 'muted' }, `${s.items.length} domande${s.limit ? ` in ${Math.round(s.limit / 60)} minuti` : ''}`)), h('button', { class: 'primary', onclick: () => {
        runQuiz(box, s.items, { mode: 'mock', title: `${m.title} · ${s.name || ''}`, timeLimit: s.limit, onDone: ({ results, totalMs: t, early }) => { all.push(...results.map(r => ({ ...r, section: s.name || s.skill }))); totalMs += t; if (early) endedEarly = true; k = early ? sections.length : k + 1; nextSection(); } });
      } }, 'Inizia sezione')));
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
    if (m.id === 'diag' && !early) setDiag(perAcc);
    renderReport(box, { results, totalMs, title: m.title, passMark: m.passMark || 0.7, sections: true, onBack: () => go('#/simulazioni'), onRetry: () => { location.hash = `#/simulazioni/${m.id}?r=${Date.now()}`; } });
    if (early) box.prepend(h('div', { class: 'notice' }, 'Simulazione interrotta: le risposte date contano per i livelli, ma la simulazione non risulta completata.'));
    else if (m.id === 'diag') box.prepend(h('div', { class: 'notice ok' }, 'Diagnostico salvato: la dashboard ora usa questi risultati come punto di partenza e propone la sessione consigliata.'));
  }
}

function videoMock(root, m) {
  const C = content();
  const r = rng(newSeed());
  const pool = C.behavioural;
  const pickCat = cat => shuffle(r, pool.filter(x => x.category === cat))[0];
  const qs = [pickCat('motivation'), pickCat('competency'), pickCat('competency'), pickCat('strengths') || pickCat('banking-specific'), pickCat('banking-specific') || pickCat('technical-explain')].filter(Boolean);
  const box = h('div', {}); root.append(h('section', { class: 'card' }, h('h1', {}, m.title), h('p', { class: 'muted' }, m.desc)), box);
  videoRoom(box, { questions: qs.length ? qs : null, onDone: () => { box.innerHTML = ''; box.append(h('div', { class: 'cta' }, h('div', {}, h('div', { class: 'cta-t' }, 'Simulazione video completata'), h('div', { class: 'muted' }, 'Le autovalutazioni contano per l’area Behavioural. Rifai le domande con un voto < 4.')), h('a', { class: 'primary btnlink', href: '#/progressi' }, 'Vedi progressi'))); } });
}
