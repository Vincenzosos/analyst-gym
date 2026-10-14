// News: headlines, real market series and theme cards. Tags headlines to themes and builds
// news-linked questions (theme mechanism questions next to a real headline, real-data market questions).
import { esc, fmt, pick, DAY } from './util.js';

const N = { headlines: [], updated: null, sources: [], markets: null, concepts: [], compiled: [], byConcept: new Map(), mg: null, loaded: false };

async function getJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export async function loadNews() {
  if (N.loaded) return N;
  const [hl, mk, cc, mg] = await Promise.allSettled([
    getJSON('data/news/headlines.json'), getJSON('data/news/markets.json'), getJSON('data/news/concepts.json'), import('./gen/markets.js'),
  ]);
  if (cc.status === 'fulfilled') N.concepts = (cc.value.concepts || []).filter(c => c && c.id);
  N.compiled = N.concepts.map(c => ({ c, re: (c.match || []).map(safeRe).filter(Boolean), ex: (c.exclude || []).map(safeRe).filter(Boolean) }));
  for (const c of N.concepts) N.byConcept.set(c.id, []);
  if (hl.status === 'fulfilled') {
    N.updated = hl.value.updated || null;
    N.sources = hl.value.sources || [];
    N.headlines = (hl.value.items || []).filter(x => x && x.title).map(x => ({ ...x, url: safeUrl(x.url), t: Date.parse(x.date) || 0, themes: tag(x.title) })).sort((a, b) => b.t - a.t);
    for (const x of N.headlines) for (const id of x.themes) N.byConcept.get(id).push(x);
  }
  if (mk.status === 'fulfilled' && mk.value && mk.value.series) N.markets = mk.value;
  if (mg.status === 'fulfilled') N.mg = mg.value;
  N.loaded = true;
  return N;
}
export const news = () => N;

function safeRe(s) { try { return new RegExp(s, 'i'); } catch { return null; } }
function safeUrl(u) { return /^https?:\/\//i.test(String(u || '')) ? String(u) : ''; }

// Up to 2 themes per headline, most specific (priority) first.
export function tag(title) {
  const hits = N.compiled.filter(({ re, ex }) => re.some(r => r.test(title)) && !ex.some(r => r.test(title)));
  hits.sort((a, b) => (b.c.priority || 1) - (a.c.priority || 1));
  return hits.slice(0, 2).map(x => x.c.id);
}

export const conceptById = id => N.concepts.find(c => c.id === id) || null;
export const recentHeadlines = (days = 7, now = Date.now()) => N.headlines.filter(x => x.t >= now - days * DAY);

// Themes of the last `days`, most covered first.
export function weekThemes(days = 7) {
  const since = Date.now() - days * DAY;
  return N.concepts
    .map(c => ({ c, items: (N.byConcept.get(c.id) || []).filter(x => x.t >= since) }))
    .filter(x => x.items.length)
    .sort((a, b) => b.items.length - a.items.length || (b.c.priority || 1) - (a.c.priority || 1));
}

export const dateShort = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export function newsCardHTML(c, x) {
  const head = x
    ? `${x.url ? `<a class="nc-title" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a>` : `<div class="nc-title">${esc(x.title)}</div>`}<div class="nc-meta">${esc(x.source || '')} · ${dateShort(x.t)}</div>`
    : '';
  return `<div class="news-ctx"><div class="nc-kicker">${x ? 'This week’s headline' : 'Current affairs theme'}</div>${head}`
    + `<div class="nc-theme"><span class="chip accent">${esc(c.theme || '')}</span><b>${esc(c.title || '')}</b></div>`
    + `<div class="nc-note">${x ? 'The question tests the mechanism behind this kind of news, not the detail of the headline.' : 'A question on the mechanism behind the theme.'}</div></div>`;
}

export function conceptItem(c, q, headline) {
  return {
    id: `news-${q.qid}`, skill: c.skill, level: q.level || 2, type: 'mcq',
    stem: q.stem, options: q.options, answer: q.answer, timeTarget: q.timeTarget || 60,
    explanation: q.explanation, tags: ['news', c.id, ...(q.tags || [])], news: true, concept: c.id,
    context: { kind: 'html', html: newsCardHTML(c, headline) },
  };
}

// A theme question, preferring themes in this week's news and questions not answered yet.
export function newsQuestion({ skill = null, r, seenIds = new Set(), exclude = new Set(), days = 7, concept = null, sameTheme = false } = {}) {
  const since = Date.now() - days * DAY;
  const pool = [];
  const focus = concept ? conceptById(concept) : null;
  for (const c of N.concepts) {
    if (skill && c.skill !== skill) continue;
    if (focus && (sameTheme ? c.theme !== focus.theme : c.id !== focus.id)) continue;
    const hs = (N.byConcept.get(c.id) || []).filter(x => x.t >= since);
    for (const q of c.questions || []) if (!exclude.has(`news-${q.qid}`)) pool.push({ c, q, hs });
  }
  if (!pool.length) return null;
  const score = p => (p.hs.length ? 2 + Math.min(1, p.hs.length / 5) : 0) + (seenIds.has(`news-${p.q.qid}`) ? 0 : 1.5) + r() * 1.2;
  let best = null, bs = -1;
  for (const p of pool) { const s = score(p); if (s > bs) { bs = s; best = p; } }
  const hl = best.hs.length ? pick(r, best.hs.slice(0, 10)) : ((N.byConcept.get(best.c.id) || [])[0] || null);
  return conceptItem(best.c, best.q, hl);
}

// ---------- real market data ----------
export function marketReady(skill = null) {
  if (!N.mg || !N.markets) return false;
  try {
    const fams = N.mg.marketFamiliesAvailable(N.markets) || [];
    return fams.some(f => !skill || f.skill === skill);
  } catch { return false; }
}
export function marketQuestion({ skill = null, r } = {}) {
  if (!marketReady(skill)) return null;
  for (let k = 0; k < 6; k++) {
    try {
      const it = N.mg.generateMarket(Math.floor(r() * 2 ** 31), N.markets, { skill });
      if (it) return { ...it, news: true };
    } catch (e) { console.warn('market generator', e); return null; }
  }
  return null;
}

// Market strip: last value, change over `back` observations, sparkline.
export const STRIP = ['SP500', 'NASDAQ', 'STOXX50', 'FTSEMIB', 'DAX', 'FTSE100', 'EURUSD', 'EURGBP', 'US10Y', 'US2Y', 'EA10Y', 'ESTR', 'BRENT', 'GOLD', 'VIX', 'HYOAS'];
const RATE_KINDS = new Set(['yield', 'rate', 'spread']);
export function seriesStats(key, back = 5) {
  const s = N.markets && N.markets.series && N.markets.series[key];
  if (!s || !Array.isArray(s.points) || s.points.length < back + 1) return null;
  const pts = s.points;
  const last = pts[pts.length - 1], prev = pts[pts.length - 1 - back];
  const isRate = RATE_KINDS.has(s.kind);
  const chg = isRate ? (last[1] - prev[1]) * 100 : (last[1] / prev[1] - 1) * 100;
  return { key, s, last: last[1], date: last[0], chg, isRate, spark: pts.slice(-60).map(p => p[1]) };
}
export function fmtLevel(s, v) {
  if (s.kind === 'fx') return fmt(v, 4);
  if (RATE_KINDS.has(s.kind)) return `${fmt(v, 2)}%`;
  if (v >= 1000) return fmt(v, 0);
  return fmt(v, 2);
}
export function fmtChange(st) {
  const v = st.isRate ? Math.round(st.chg) : Math.round(st.chg * 10) / 10;
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return st.isRate ? `${sign}${fmt(Math.abs(v), 0)} bps` : `${sign}${fmt(Math.abs(v), 1)}%`;
}
// Short labels for tiles and ticker (the data files carry long official names).
const SHORT = { SP500: 'S&P 500', NASDAQ: 'Nasdaq', DJIA: 'Dow Jones', VIX: 'VIX', STOXX50: 'Euro Stoxx 50', DAX: 'DAX', FTSEMIB: 'FTSE MIB', FTSE100: 'FTSE 100', US10Y: 'Treasury 10Y', US2Y: 'Treasury 2Y', US3M: 'T-bill 3M', EA10Y: 'Euro AAA 10Y', EA2Y: 'Euro AAA 2Y', ESTR: '€STR', ECBDFR: 'ECB deposit rate', FEDFUNDS: 'Fed funds', HYOAS: 'US high-yield spread', EURUSD: 'EUR/USD', EURGBP: 'EUR/GBP', EURJPY: 'EUR/JPY', EURCHF: 'EUR/CHF', BRENT: 'Brent', WTI: 'WTI', GOLD: 'Gold' };
export const shortName = st => SHORT[st.key] || st.s.name;
export function sparkSVG(vals, { w = 120, h = 34, up = true, recent = 0 } = {}) {
  if (!vals || vals.length < 2) return '';
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const xy = vals.map((v, i) => [(i / (vals.length - 1) * w).toFixed(1), (h - 3 - (v - lo) / span * (h - 6)).toFixed(1)]);
  const line = arr => arr.map(p => p.join(',')).join(' ');
  const col = up ? 'var(--up)' : 'var(--down)';
  // neutral history, coloured last `recent` sessions (the period of the change figure)
  const k = recent ? Math.max(0, xy.length - 1 - recent) : 0;
  const base = recent ? `<polyline points="${line(xy.slice(0, k + 1))}" fill="none" stroke="#B9BDD3" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` : '';
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${base}<polyline points="${line(xy.slice(k))}" fill="none" stroke="${col}" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
}
