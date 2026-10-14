// "News": the 2-minute weekly wrap (default), the brief (real markets + headlines by theme), news drills,
// theme cards, commercial-awareness notes and the 60-second market update in the video room.
import { h, md, newSeed } from '../util.js';
import { load, upsert, remove, markNewsRead, markWrapSeen, logSession } from '../store.js';
import { SKILL, newsSet } from '../content.js';
import { runQuiz, renderReport } from '../quiz.js';
import { go, pageHead, tabs, themeTone } from './common.js';
import { news, weekThemes, recentHeadlines, conceptById, dateShort, STRIP, seriesStats, fmtLevel, fmtChange, sparkSVG, marketReady, shortName } from '../news.js';
import { buildWrap } from '../wrap.js';
import { currentMission } from '../mission.js';
import { videoRoom, confirmDelete } from './interview.js';

const LOCALE = 'en-GB';
const SUBS = ['brief', 'practice', 'themes', 'notes', 'update'];

export function newsView(root, sub, q) {
  const N = news();
  if (sub === 'practice' && q.mode) { root.append(h('div', { class: 'crumbs' }, h('a', { href: '#/news' }, 'News'), ' / ', h('a', { href: '#/news/practice' }, 'Practice'))); return runNewsDrill(root, q.mode, Number(q.n) || 12, q.c || null); }
  const mission = currentMission();
  const t = Object.fromEntries(mission.tasks.map(x => [x.id, x]));
  const cur = SUBS.includes(sub) ? (sub === 'update' ? 'brief' : sub) : 'wrap';
  root.append(pageHead({
    kicker: N.updated ? `Updated ${new Date(N.updated).toLocaleString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'News',
    title: 'The world', accent: 'this week',
    sub: 'Two minutes to see it all, then the mechanism behind the news and practice on real numbers. General knowledge and commercial awareness, every week.',
  }));
  root.append(tabs([
    ['wrap', 'Weekly wrap · 2 min', '#/news'],
    ['brief', `Brief · ${t.brief.label.split(' ')[0]}`, '#/news/brief'],
    ['practice', `Practice · ${t.newsq.label.split(' ')[0]}`, '#/news/practice'],
    ['themes', 'Themes', '#/news/themes'],
    ['notes', `Notes · ${t.note.label.split(' ')[0]}`, '#/news/notes'],
  ], cur));
  if (!N.headlines.length && !N.markets && sub !== 'notes') {
    root.append(h('div', { class: 'notice' }, 'News is not available yet: it updates automatically every day. Try again later.'));
    if (sub !== 'themes') return;
  }
  if (sub === 'brief') return brief(root, q);
  if (sub === 'practice') return drills(root, q);
  if (sub === 'themes') return themes(root, q);
  if (sub === 'notes') return notes(root, q);
  if (sub === 'update') return marketUpdate(root);
  return wrapView(root, q);
}

// ---------- weekly wrap (story viewer) ----------
const PILL_MS = 13000;
function wrapView(root, q = {}) {
  const W = buildWrap();
  if (!W.pills.length) { root.append(h('div', { class: 'notice' }, 'Not enough data for this week’s wrap yet.')); return; }
  const n = W.pills.length;
  let idx = 0, playing = !matchMedia('(prefers-reduced-motion: reduce)').matches, timer = null;
  const segs = h('div', { class: 'wrap-segs', 'aria-hidden': 'true' }, W.pills.map(() => h('i', {}, h('b'))));
  const track = h('div', { class: 'wrap-track', tabindex: '0', 'aria-label': 'Weekly wrap, use the arrow keys to move' });
  W.pills.forEach((p, i) => track.append(renderPill(p, i, n)));
  const counter = h('span', { class: 'wrap-count' }, `1 / ${n}`);
  const playBtn = h('button', { class: 'btn ghost small', 'aria-label': 'Pause', onclick: () => setPlaying(!playing) }, 'Pause');
  const prevBtn = h('button', { class: 'btn ghost small icon-btn', 'aria-label': 'Previous', onclick: () => goTo(idx - 1, true) }, '←');
  const nextBtn = h('button', { class: 'btn primary small icon-btn', 'aria-label': 'Next', onclick: () => goTo(idx + 1, true) }, '→');
  const listBtn = h('button', { class: 'btn ghost small', onclick: () => { box.classList.toggle('list'); const list = box.classList.contains('list'); listBtn.textContent = list ? 'Story mode' : 'All on one page'; history.replaceState(null, '', list ? '#/news?view=list' : '#/news'); if (list) setPlaying(false); else goTo(idx); } }, 'All on one page');
  const box = h('section', { class: 'wrap' + (playing ? ' playing' : '') },
    h('div', { class: 'wrap-top' }, segs, h('div', { class: 'wrap-ctrl' }, h('span', { class: 'kicker' }, `2-minute wrap${W.asOf ? ` · data to ${dateShort(Date.parse(W.asOf + 'T12:00:00'))}` : ''}`), h('div', { class: 'row-start' }, counter, prevBtn, playBtn, nextBtn, listBtn))),
    track);
  box.style.setProperty('--pill-ms', `${PILL_MS}ms`);
  root.append(box);
  if (q.view === 'list') { box.classList.add('list'); listBtn.textContent = 'Story mode'; playing = false; box.classList.remove('playing'); playBtn.textContent = 'Play'; }
  root.append(h('p', { class: 'muted small sources' }, 'Generated automatically every day from public market data (FRED, ECB, US Treasury, Yahoo) and headlines (titles only). It describes the moves and the usual mechanism; the headlines say why.'));

  function paint() {
    [...segs.children].forEach((s, i) => { s.className = i < idx ? 'done' : i === idx ? 'cur' : ''; });
    void segs.offsetWidth; // restart the current segment animation
    counter.textContent = `${idx + 1} / ${n}`;
    prevBtn.disabled = idx === 0; nextBtn.disabled = idx === n - 1;
    if (idx === n - 1) markWrapSeen();
  }
  function schedule() { clearTimeout(timer); if (playing && idx < n - 1) timer = setTimeout(() => goTo(idx + 1), PILL_MS); if (idx === n - 1) setPlaying(false, true); }
  function goTo(i, user = false) {
    i = Math.max(0, Math.min(n - 1, i));
    idx = i;
    if (!box.classList.contains('list')) track.scrollTo({ left: i * track.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    paint(); schedule();
    if (user) track.focus({ preventScroll: true });
  }
  function setPlaying(v, silent = false) {
    playing = v; box.classList.toggle('playing', v);
    playBtn.textContent = v ? 'Pause' : 'Play'; playBtn.setAttribute('aria-label', v ? 'Pause' : 'Play');
    if (!silent) { paint(); schedule(); }
  }
  // swipe / scroll by hand
  let scrollT = null;
  track.addEventListener('scroll', () => {
    if (box.classList.contains('list')) return;
    clearTimeout(scrollT);
    scrollT = setTimeout(() => { const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth)); if (i !== idx) { idx = i; paint(); schedule(); } }, 120);
  }, { passive: true });
  track.addEventListener('pointerdown', () => { if (playing) setPlaying(false); });
  // in list mode, reaching the last pill counts as read
  const last = track.lastElementChild;
  if ('IntersectionObserver' in window) { const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting) && box.classList.contains('list')) markWrapSeen(); }, { threshold: 0.6 }); io.observe(last); }
  const onKey = e => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(idx + 1, true); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(idx - 1, true); }
    else if (e.key === ' ' && document.activeElement === track) { e.preventDefault(); setPlaying(!playing); }
  };
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', () => { clearTimeout(timer); document.removeEventListener('keydown', onKey); }, { once: true });
  paint(); schedule();
}

function renderPill(p, i, n) {
  const tone = p.tone === 'theme' ? themeTone(p.theme) : `tone-${p.tone}`;
  const card = h('article', { class: `pill ${tone} pill-${p.kind}`, 'aria-label': `${i + 1} of ${n}: ${p.title}` });
  card.append(h('div', { class: 'pill-k' }, h('span', { class: 'pill-n' }, String(i + 1).padStart(2, '0')), p.kicker), h('h2', { class: 'pill-t' }, p.title));
  const body = h('div', { class: 'pill-b' });
  if (p.kind === 'cover') {
    body.append(h('div', { class: 'pill-stats' }, p.stats.map(s => h('div', { class: 'pill-stat' + (s.text ? ' text' : '') }, h('span', {}, s.k), h('b', { class: s.text ? '' : (s.up ? 'up' : 'down') }, s.v)))));
    body.append(...p.lines.map(l => h('p', {}, l)));
  } else if (p.kind === 'bars') {
    const max = Math.max(...p.bars.map(b => Math.abs(b.v)), 0.5);
    body.append(h('div', { class: 'pbars' }, p.bars.map(b => h('div', { class: 'pbar' },
      h('span', { class: 'pbar-k' }, b.k),
      h('div', { class: 'pbar-track' }, h('i', { class: b.v >= 0 ? 'pos' : 'neg', style: { width: `${Math.abs(b.v) / max * 50}%` } })),
      h('b', { class: b.v >= 0 ? 'up' : 'down' }, b.label), h('span', { class: 'pbar-l' }, b.level)))));
    body.append(...p.lines.map(l => h('p', {}, l)));
  } else if (p.kind === 'tiles' || p.kind === 'numbers') {
    body.append(h('div', { class: 'ptiles' }, p.tiles.map(x => h('div', { class: 'ptile' }, h('span', {}, x.k), h('b', {}, x.v), h('em', { class: x.up ? 'up' : 'down' }, x.d)))));
    body.append(...(p.lines || []).map(l => h('p', {}, l)));
    if (p.note) body.append(h('p', { class: 'pill-note' }, p.note));
    if (p.kind === 'numbers') body.append(h('div', { class: 'row-start' }, h('a', { class: 'btn primary small', href: '#/news/practice?mode=market&n=5' }, 'Quick quiz on these numbers →')));
  } else if (p.kind === 'theme') {
    body.append(h('div', { class: 'pill-count' }, h('b', {}, String(p.count)), ` headline${p.count === 1 ? '' : 's'} this week`));
    if (p.why) body.append(h('p', { class: 'pill-why' }, p.why));
    body.append(h('div', { class: 'pill-heads' }, p.heads.map(x => (x.url ? h('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer', class: 'pill-head' }, h('span', {}, x.title), h('em', {}, `${x.source} · ${x.date}`)) : h('div', { class: 'pill-head' }, h('span', {}, x.title), h('em', {}, `${x.source} · ${x.date}`))))));
    if (p.watch) body.append(h('p', { class: 'pill-note' }, h('b', {}, 'Watch next: '), p.watch));
    body.append(h('div', { class: 'row-start' }, h('a', { class: 'btn ghost small', href: `#/news/themes?c=${p.concept}` }, 'Open the theme'), h('a', { class: 'btn primary small', href: `#/news/practice?mode=theme&n=3&c=${p.concept}` }, 'Practise it →')));
  } else if (p.kind === 'script') {
    const quote = h('blockquote', { class: 'pill-script', lang: 'en' }, p.script);
    body.append(quote, h('p', { class: 'pill-note' }, p.note),
      h('div', { class: 'row-start' }, h('a', { class: 'btn primary small', href: '#/news/update' }, 'Record it on video'), h('button', { class: 'btn ghost small', onclick: e => { try { navigator.clipboard.writeText(p.script); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Select and copy'; } } }, 'Copy')));
  }
  if (p.rule) body.append(h('div', { class: 'pill-rule' }, h('b', {}, 'Rule'), h('span', {}, p.rule)));
  card.append(body);
  return card;
}

// Update the counters on the page after a headline is marked (no full re-render).
function refreshCounters() {
  const t = currentMission().tasks.find(x => x.id === 'brief');
  const live = document.querySelector('[data-live="brief"]');
  if (live) live.textContent = `${t.label} this week · click a headline or its tick to mark it`;
  const tab = document.querySelector('.tabs a[href="#/news/brief"]');
  if (tab) tab.textContent = `Brief · ${t.label.split(' ')[0]}`;
}

// ---------- brief ----------
function ticker() {
  const stats = STRIP.map(k => seriesStats(k, 5)).filter(Boolean);
  if (!stats.length) return '';
  const cell = st => h('div', { class: 'tk' }, h('span', { class: 'tk-n' }, shortName(st)), h('span', { class: 'tk-v' }, fmtLevel(st.s, st.last)), h('span', { class: 'tk-c ' + (st.chg >= 0 ? 'up' : 'down') }, fmtChange(st)));
  return h('div', { class: 'ticker', 'aria-label': 'Markets, change over 5 sessions' }, h('div', { class: 'tk-track' }, stats.map(cell), stats.map(cell)));
}

function marketCards() {
  const stats = STRIP.map(k => seriesStats(k, 5)).filter(Boolean);
  if (!stats.length) return '';
  return h('section', { class: 'card' },
    h('div', { class: 'card-h' }, h('h2', {}, 'Markets'), h('span', { class: 'muted small' }, 'change over the last 5 sessions · yields in basis points')),
    h('div', { class: 'mkt-grid' }, stats.map(st => h('div', { class: 'mkt' },
      h('div', { class: 'mkt-top' }, h('span', { class: 'mkt-n', title: st.s.name }, shortName(st)), h('span', { class: 'mkt-c ' + (st.chg >= 0 ? 'up' : 'down') }, fmtChange(st))),
      h('div', { class: 'mkt-v' }, fmtLevel(st.s, st.last)),
      h('div', { class: 'mkt-spark', html: sparkSVG(st.spark, { up: st.chg >= 0, recent: 5 }) }),
      h('div', { class: 'mkt-d' }, `${st.s.source || ''} · ${dateShort(Date.parse(st.date + 'T12:00:00'))}`)))),
    h('div', { class: 'row-end' }, h('a', { class: 'btn ghost', href: '#/news/update' }, 'Record a 60-second market update'), h('a', { class: 'btn primary', href: '#/news/practice?mode=market&n=10' }, 'Practise on these numbers', h('span', { class: 'arrow' }, '→'))));
}

function headlineRow(x, S, { chips = true } = {}) {
  const read = !!S.newsRead[x.id];
  const row = h('div', { class: 'hl-item' + (read ? ' read' : '') });
  const mark = () => { markNewsRead(x.id); row.classList.add('read'); tick.textContent = '✓'; refreshCounters(); };
  const tick = h('button', { class: 'hl-tick', title: 'Mark as read', 'aria-label': `Mark as read: ${x.title}`, 'aria-pressed': String(read), onclick: () => { mark(); tick.setAttribute('aria-pressed', 'true'); } }, read ? '✓' : '');
  const themesOf = chips ? x.themes.map(id => conceptById(id)).filter(Boolean) : [];
  row.append(tick,
    h('div', { class: 'hl-b' },
      x.url ? h('a', { class: 'hl-title', href: x.url, target: '_blank', rel: 'noopener noreferrer', onclick: mark }, x.title) : h('span', { class: 'hl-title' }, x.title),
      h('div', { class: 'hl-meta' }, h('span', {}, x.source), h('span', {}, dateShort(x.t)), themesOf.map(c => h('a', { class: 'chip accent', href: `#/news/themes?c=${c.id}` }, c.title)))),
    h('a', { class: 'btn ghost small hl-note', href: `#/news/notes?from=${encodeURIComponent(x.id)}`, title: 'Write a commercial awareness note on this story' }, '+ Note'));
  return row;
}

function brief(root, q) {
  const S = load();
  root.append(ticker());
  const wt = weekThemes(7);
  if (wt.length) {
    root.append(h('section', { class: 'card' },
      h('div', { class: 'card-h' }, h('h2', {}, 'Themes of the week'), h('span', { class: 'muted small' }, 'open a theme to understand the mechanism, then practise')),
      h('div', { class: 'theme-grid' }, wt.slice(0, 8).map(({ c, items }) => h('a', { class: `theme-card ${themeTone(c.theme)}`, href: `#/news/themes?c=${c.id}` },
        h('div', { class: 'tc-k' }, c.theme), h('div', { class: 'tc-title' }, c.title),
        h('div', { class: 'tc-count' }, h('b', {}, String(items.length)), ` headline${items.length === 1 ? '' : 's'}`),
        h('div', { class: 'tc-hl' }, items[0].title))))));
  }
  root.append(marketCards());
  const filter = q.t || 'tagged';
  const all = recentHeadlines(7);
  const shown = filter === 'all' ? all : filter === 'tagged' ? all.filter(x => x.themes.length) : all.filter(x => x.themes.includes(filter));
  const readWeek = currentMission().tasks.find(t => t.id === 'brief');
  // 30 at a time: the list stays short on a phone
  let shownN = 0;
  const feed = h('div', { class: 'hl-feed' });
  const more = h('button', { class: 'btn ghost small', onclick: () => addMore() }, 'Show more');
  const addMore = () => { shown.slice(shownN, shownN + 30).forEach(x => feed.append(headlineRow(x, S))); shownN += 30; more.classList.toggle('hidden', shownN >= shown.length); more.textContent = `Show more (${Math.max(0, shown.length - shownN)})`; };
  addMore();
  root.append(h('section', { class: 'card' },
    h('div', { class: 'card-h' }, h('h2', {}, 'Headlines'), h('span', { class: 'muted small', 'data-live': 'brief' }, `${readWeek.label} this week · click a headline or its tick to mark it`)),
    h('div', { class: 'chips-row' }, [['tagged', `With a theme ${all.filter(x => x.themes.length).length}`], ['all', `All ${all.length}`], ...wt.slice(0, 8).map(({ c, items }) => [c.id, `${c.title} ${items.length}`])].map(([k, t]) => h('a', { class: 'chip' + (k === filter ? ' on' : ''), href: `#/news/brief${k === 'tagged' ? '' : `?t=${k}`}` }, t))),
    feed,
    more,
    !shown.length ? h('p', { class: 'muted' }, 'No headlines for this filter.') : ''));
  const N = news();
  if (N.sources.length) root.append(h('div', { class: 'muted small sources' }, 'Sources: ', N.sources.filter(s => s.ok !== false).map(s => s.name).join(' · '), '. Titles and links only: read the articles on the publishers’ sites.'));
}

// ---------- drills ----------
const DRILL_TONE = { mix: 'indigo', market: 'teal', theme: 'violet', culture: 'amber' };
const DRILLS = [
  ['mix', 'Weekly mix', 'Half real market data, half the themes in this week’s news.'],
  ['market', 'Market data', 'Percentage moves, basis points, FX, spreads, duration: with real numbers from the last three weeks.'],
  ['theme', 'News themes', 'The economics behind this week’s news: rates, M&A, IPOs, geopolitics.'],
  ['culture', 'General knowledge', 'Economic history, institutions, geopolitics, business, science and technology.'],
];
function drills(root) {
  const okMarket = marketReady();
  const okTheme = news().concepts.length > 0;
  root.append(h('div', { class: 'drill-grid' }, DRILLS.map(([k, t, d]) => {
    const disabled = (k === 'market' && !okMarket) || (k === 'theme' && !okTheme) || (k === 'mix' && !okMarket && !okTheme);
    const n = k === 'culture' ? 15 : 12;
    return h(disabled ? 'div' : 'a', { class: `drill-card tone-${DRILL_TONE[k]}` + (disabled ? ' off' : ''), href: disabled ? null : (k === 'culture' ? `#/train/culture?mode=learn&n=${n}` : `#/news/practice?mode=${k}&n=${n}`) },
      h('div', { class: 'kicker' }, `${n} questions`), h('div', { class: 'dc-t' }, t), h('div', { class: 'muted small' }, disabled ? 'Data not available yet.' : d), h('span', { class: 'go' }, '→'));
  })));
  root.append(h('p', { class: 'muted small' }, 'News questions count towards Markets, Commercial awareness, General knowledge, Numerical and Mental arithmetic. Mistakes go into the notebook like all the others.'));
}

function runNewsDrill(root, mode, n, concept = null) {
  const S = load();
  const seen = new Set(S.attempts.map(a => a.id));
  const items = newsSet(mode, n, { seenIds: seen, seed: newSeed(), concept });
  if (!items.length) { root.append(h('div', { class: 'notice' }, 'No questions available right now: this week’s data has not loaded yet.')); return; }
  const box = h('div', { class: 'quiz' }); root.append(box);
  const focus = concept ? conceptById(concept) : null;
  const title = focus ? `Theme · ${focus.title}` : `News · ${(DRILLS.find(d => d[0] === mode) || [0, 'Mix'])[1]}`;
  runQuiz(box, items, {
    mode: 'learn', title,
    onDone: ({ results, totalMs, answered }) => {
      if (answered) logSession({ kind: 'news', mode, n: answered, correct: results.filter(r => r.ok).length, ms: totalMs });
      renderReport(box, { results: results.filter(r => !r.skipped), totalMs, title, passMark: 0.7, onRetry: () => { location.hash = `#/news/practice?mode=${mode}&n=${n}${concept ? `&c=${concept}` : ''}&r=${Date.now()}`; }, onBack: () => go(focus ? `#/news/themes?c=${concept}` : '#/news/practice') });
    },
  });
}

// ---------- theme cards ----------
function themes(root, q) {
  const N = news();
  if (!N.concepts.length) { root.append(h('p', { class: 'muted' }, 'Theme cards not loaded yet.')); return; }
  const counts = new Map(weekThemes(7).map(x => [x.c.id, x.items.length]));
  const groups = new Map();
  for (const c of N.concepts) { if (!groups.has(c.theme)) groups.set(c.theme, []); groups.get(c.theme).push(c); }
  const sel = q.c ? conceptById(q.c) : null;
  if (sel) {
    const items = (N.byConcept.get(sel.id) || []).slice(0, 12);
    const S = load();
    root.append(h('div', { class: 'crumbs' }, h('a', { href: '#/news/themes' }, 'Themes'), ' / ', sel.title));
    root.append(h('div', { class: 'grid-2 wide-left' },
      h('section', { class: `card theme-detail ${themeTone(sel.theme)}` },
        h('div', { class: 'kicker' }, `${sel.theme} · ${SKILL[sel.skill] ? SKILL[sel.skill].short : sel.skill}`),
        h('h2', { class: 'display md' }, sel.title),
        sel.pill && sel.pill.why ? h('p', { class: 'lead' }, sel.pill.why) : '',
        h('div', { class: 'md', html: md(sel.explainer || '') }),
        sel.watch && sel.watch.length ? h('div', { class: 'cheat' }, h('div', { class: 'cheat-h' }, 'When you read a story like this, ask yourself'), h('ul', {}, sel.watch.map(w => h('li', {}, w)))) : '',
        sel.interview ? h('div', { class: 'interview-box' }, h('div', { class: 'expl-h' }, 'How to use it in an interview'), h('div', { class: 'md', html: md(sel.interview.replace(/EN:\s*/, '\n\n**Say it:** ')) })) : '',
        h('div', { class: 'row-end' }, h('a', { class: 'btn primary', href: `#/news/practice?mode=theme&n=3&c=${sel.id}` }, 'Practise this theme', h('span', { class: 'arrow' }, '→')))),
      h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Recent headlines'), h('span', { class: 'muted small' }, `${items.length}`)),
        items.length ? h('div', { class: 'hl-feed' }, items.map(x => headlineRow(x, S, { chips: false }))) : h('p', { class: 'muted small' }, 'No recent headlines on this theme.'))));
    return;
  }
  for (const [g, list] of groups) {
    root.append(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, g)),
      h('div', { class: 'theme-grid' }, list.map(c => h('a', { class: `theme-card ${themeTone(c.theme)}` + (counts.get(c.id) ? '' : ' quiet'), href: `#/news/themes?c=${c.id}` },
        h('div', { class: 'tc-k' }, SKILL[c.skill] ? SKILL[c.skill].short : ''), h('div', { class: 'tc-title' }, c.title),
        h('div', { class: 'tc-count' }, counts.get(c.id) ? h('b', {}, String(counts.get(c.id))) : '', counts.get(c.id) ? ' this week' : 'no headlines this week'))))));
  }
}

// ---------- notes (commercial awareness) ----------
function notes(root, q) {
  const S = load();
  if (q.from) {
    const x = news().headlines.find(y => y.id === q.from);
    const existing = x && S.commercial.find(c => c.newsId === x.id);
    if (existing) { existing.open = true; upsert('commercial', existing); }
    else if (x) upsert('commercial', { title: x.title, event: '', impact: '', link: '', source: x.url, newsId: x.id, open: true });
    history.replaceState(null, '', '#/news/notes');
  }
  root.append(h('section', { class: 'card' }, h('div', { class: 'md', html: md('A classic question (BofA, JPM, HSBC): **"Tell us about a current event and how it affects markets and our business."** Answer in 3 steps, 60 to 90 seconds:\n\n1. **The event**: what happened, in one sentence, with a number or a date.\n2. **Market impact**: rates, FX, credit spreads, equities, the sector. Explain the mechanism.\n3. **Link to the role**: what changes for the bank’s clients (M&A, financing, IPOs) and what you would do as an analyst.\n\nOne note a week is part of the mission (at least 40 characters across event and impact). Start from a headline in the brief with **+ Note**.') })));
  const list = h('div', { class: 'stories' });
  const render = () => {
    list.innerHTML = '';
    const all = load().commercial.slice().sort((a, b) => (b.created || 0) - (a.created || 0));
    for (const c of all) {
      const f = (k, label, rows = 2) => h('label', { class: 'fld' }, h('span', {}, label), h('textarea', { rows, oninput: e => { c[k] = e.target.value; upsert('commercial', c); } }, c[k] || ''));
      const d = h('details', { class: 'story' }, h('summary', {}, h('b', {}, c.title || 'New note'), h('span', { class: 'muted small' }, c.created ? ` · ${new Date(c.created).toLocaleDateString(LOCALE)}` : '')),
        h('div', { class: 'story-b' }, h('label', { class: 'fld' }, h('span', {}, 'Title'), h('input', { value: c.title || '', oninput: e => { c.title = e.target.value; upsert('commercial', c); } })),
          f('event', '1 · The event (what, when, one number)'), f('impact', '2 · Market impact (the mechanism)', 3), f('link', '3 · Link to the role and the clients', 3), f('source', 'Source (link)', 1),
          h('div', { class: 'row-end' }, c.source && /^https?:/.test(c.source) ? h('a', { class: 'btn ghost small', href: c.source, target: '_blank', rel: 'noopener noreferrer' }, 'Open the source') : '', h('button', { class: 'btn ghost small danger', onclick: () => { if (confirmDelete()) { remove('commercial', c.id); render(); } } }, 'Delete'))));
      if (c.open) { d.open = true; c.open = false; upsert('commercial', c); setTimeout(() => d.scrollIntoView({ block: 'center' }), 60); }
      list.append(d);
    }
    list.prepend(h('button', { class: 'btn ghost', onclick: () => { upsert('commercial', { title: '', event: '', impact: '', link: '', source: '', open: true }); render(); } }, '+ New note'));
  };
  render();
  root.append(list);
}

// ---------- 60-second market update ----------
function marketUpdate(root) {
  const stats = STRIP.map(k => seriesStats(k, 5)).filter(Boolean);
  const top = weekThemes(7).slice(0, 3);
  const data = stats.slice(0, 10).map(st => `${shortName(st)} ${fmtLevel(st.s, st.last)} (${fmtChange(st)})`).join(' · ');
  root.append(h('div', { class: 'crumbs' }, h('a', { href: '#/news' }, 'News'), ' / Market update'));
  root.append(h('section', { class: 'card' }, h('div', { class: 'expl-h' }, 'This week’s numbers'), h('p', { class: 'small mono' }, data || 'Data not available.'),
    top.length ? h('p', { class: 'small' }, h('b', {}, 'Themes: '), top.map(x => x.c.title).join(', ')) : ''));
  const qx = {
    id: 'market-update', q: 'Give me a 60-second update on what happened in markets this week and why it matters for our clients.',
    structure: ['One summary sentence: the dominant theme of the week', 'Two or three moves with the number (index, yield in bps, FX, oil) and why', 'What it means for clients: cost of debt, IPO and M&A windows, valuations', 'Close: what you will watch next week (macro data, a central bank, earnings)'],
    skeleton: 'This week markets were driven by [theme]. [Index] moved [x%] as [reason], while the 10-year yield [rose/fell] [n] bps on [data]. For our clients this matters because [financing costs / deal windows / valuations]. Next week I am watching [event].',
  };
  const box = h('div', {}); root.append(box);
  videoRoom(box, { questions: [qx], prep: 30, answer: 90, onDone: () => { box.innerHTML = ''; box.append(h('div', { class: 'cta' }, h('div', {}, h('div', { class: 'cta-t' }, 'Market update saved'), h('div', { class: 'muted' }, 'Do it again next week with the new numbers: it is the most common question in markets interviews.')), h('div', { class: 'row-start' }, h('a', { class: 'btn ghost', href: `#/news/update?r=${Date.now()}` }, 'Again'), h('a', { class: 'btn primary', href: '#/news' }, 'Back to the wrap')))); } });
}
