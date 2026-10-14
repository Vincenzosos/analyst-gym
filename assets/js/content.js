// Loads the JSON packs and exposes item pools per skill (bank items + generators).
import { generateMental } from './gen/mental.js';
import { generateNumerical } from './gen/numerical.js';
import { generateSeries } from './gen/series.js';
import { generateShapes } from './gen/shapes.js';
import { newSeed, shuffle, rng } from './util.js';
import { loadNews, newsQuestion, marketQuestion, marketReady, news } from './news.js';

export const SKILLS = [
  { id: 'numerical', name: 'Numerical reasoning', short: 'Numerical', group: 'Online tests', code: 'NUM' },
  { id: 'mental', name: 'Mental arithmetic', short: 'Mental maths', group: 'Online tests', code: 'MEN' },
  { id: 'verbal', name: 'Verbal reasoning', short: 'Verbal', group: 'Online tests', code: 'VRB' },
  { id: 'logical', name: 'Logical reasoning', short: 'Logical', group: 'Online tests', code: 'LOG' },
  { id: 'inductive', name: 'Abstract / inductive', short: 'Abstract', group: 'Online tests', code: 'ABS' },
  { id: 'sjt', name: 'Situational judgement', short: 'SJT', group: 'Online tests', code: 'SJT' },
  { id: 'fin-acc', name: 'Accounting & 3 statements', short: 'Accounting', group: 'Technical', code: 'ACC' },
  { id: 'fin-val', name: 'Valuation', short: 'Valuation', group: 'Technical', code: 'VAL' },
  { id: 'fin-ma', name: 'M&A', short: 'M&A', group: 'Technical', code: 'M&A' },
  { id: 'fin-lbo', name: 'LBO', short: 'LBO', group: 'Technical', code: 'LBO' },
  { id: 'markets', name: 'Markets', short: 'Markets', group: 'Technical', code: 'MKT' },
  { id: 'culture', name: 'General knowledge', short: 'General knowledge', group: 'Culture and current affairs', code: 'CUL' },
  { id: 'commercial', name: 'Commercial awareness', short: 'Commercial', group: 'Culture and current affairs', code: 'COM' },
  { id: 'behavioural', name: 'Behavioural & video', short: 'Behavioural', group: 'Interview', code: 'BEH' },
];
export const GROUPS = ['Online tests', 'Technical', 'Culture and current affairs'];
export const SKILL = Object.fromEntries(SKILLS.map(s => [s.id, s]));
export const LESSON_SKILLS = { workstyle: { name: 'Work-style questionnaires', code: 'WRK' } };

const PACKS = {
  lessons: ['lessons-quant', 'lessons-reasoning', 'lessons-people', 'lessons-finance', 'lessons-culture'],
  banks: ['bank-numerical', 'bank-verbal', 'bank-logic', 'bank-sjt', 'bank-fin-a', 'bank-fin-b', 'bank-behavioural', 'bank-culture'],
};

const OPTIONAL = new Set(['lessons-culture', 'bank-culture']);
const C = { lessons: [], items: [], byId: new Map(), bySkill: new Map(), behavioural: [], loaded: false, missing: [] };

async function getJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export async function loadContent() {
  if (C.loaded) return C;
  const results = await Promise.allSettled([
    ...PACKS.lessons.map(p => getJSON(`data/lessons/${p}.json`)),
    ...PACKS.banks.map(p => getJSON(`data/banks/${p}.json`)),
  ]);
  await loadNews().catch(e => console.warn('news', e));
  const names = [...PACKS.lessons, ...PACKS.banks];
  results.forEach((res, i) => {
    if (res.status !== 'fulfilled') { if (!OPTIONAL.has(names[i])) C.missing.push(names[i]); return; }
    const d = res.value;
    if (d.lessons) C.lessons.push(...d.lessons);
    if (d.questions) C.behavioural.push(...d.questions);
    if (d.items) {
      const ctx = new Map();
      for (const p of d.passages || []) ctx.set(p.id, { kind: 'passage', passage: p });
      for (const ds of d.datasets || []) ctx.set(ds.id, { kind: 'dataset', dataset: ds });
      for (const it of d.items) {
        const item = { ...it };
        if (item.ref && ctx.has(item.ref)) item.context = ctx.get(item.ref);
        if (item.type === 'sjt') item.skill = 'sjt';
        C.items.push(item);
        C.byId.set(item.id, item);
        if (!C.bySkill.has(item.skill)) C.bySkill.set(item.skill, []);
        C.bySkill.get(item.skill).push(item);
      }
    }
  });
  C.lessons.sort((a, b) => (a.skill === b.skill ? (a.order || 0) - (b.order || 0) : 0));
  C.loaded = true;
  return C;
}
export const content = () => C;

export const GENERATED = { mental: true, numerical: true, inductive: true };

export function generate(skill, seed = newSeed()) {
  if (skill === 'mental') return generateMental(seed);
  if (skill === 'numerical') return generateNumerical(seed);
  if (skill === 'inductive') return generateShapes(seed);
  if (skill === 'series') return generateSeries(seed);
  return null;
}

// Share of each set taken from this week's news (theme questions next to real headlines) and real market data.
const NEWS_MIX = {
  numerical: { market: 0.3 }, mental: { market: 0.25 },
  markets: { market: 0.35, theme: 0.25 }, commercial: { theme: 0.5 }, culture: { theme: 0.3 },
};

// One news-linked item for a skill (real market data or a theme question), or null.
export function newsItem(skill, r, { seenIds = new Set(), exclude = new Set(), kind = null } = {}) {
  const mix = NEWS_MIX[skill] || {};
  const wantMarket = kind ? kind === 'market' : (mix.market && (!mix.theme || r() < mix.market / (mix.market + mix.theme)));
  let it = null;
  if (wantMarket) it = marketQuestion({ skill, r });
  if (!it && kind !== 'market') it = newsQuestion({ skill, r, seenIds, exclude });
  if (!it && kind !== 'theme') it = marketQuestion({ skill, r });
  return it;
}

// Build a practice set for a skill: mixes bank items (least-seen first), generated items and news-linked items.
export function practiceSet(skill, n, { level = null, seenIds = new Set(), seed = newSeed(), withNews = true } = {}) {
  const r = rng(seed);
  const bank = (C.bySkill.get(skill) || []).filter(it => level === null || it.level === level);
  const out = [];
  // news-linked share
  const mix = NEWS_MIX[skill];
  let nNews = 0;
  if (withNews && mix && level === null) {
    const avail = (mix.market && marketReady(skill)) || (mix.theme && news().concepts.some(c => c.skill === skill));
    if (avail) nNews = Math.round(n * ((mix.market || 0) + (mix.theme || 0)));
    if (!bank.length && !GENERATED[skill]) nNews = n;
  }
  const newsOut = [], used = new Set();
  for (let k = 0; k < nNews * 3 && newsOut.length < nNews; k++) {
    const it = newsItem(skill, r, { seenIds, exclude: used });
    if (!it) break;
    if (used.has(it.id)) continue;
    used.add(it.id); newsOut.push(it);
  }
  const rest = n - newsOut.length;
  let genShare = 0;
  if (skill === 'mental' || skill === 'inductive') genShare = 1;
  else if (skill === 'numerical') genShare = bank.length ? 0.5 : 1;
  else if (skill === 'logical') genShare = 0.25; // series generator
  const nGen = Math.round(rest * genShare);
  const fresh = shuffle(r, bank.filter(it => !seenIds.has(it.id)));
  const seen = shuffle(r, bank.filter(it => seenIds.has(it.id)));
  const pool = [...fresh, ...seen];
  // keep passage/dataset siblings together for realism
  const chosen = [];
  for (const it of pool) {
    if (chosen.length >= rest - nGen) break;
    if (chosen.includes(it)) continue;
    chosen.push(it);
    if (it.ref && chosen.length < rest - nGen) {
      for (const sib of pool) if (sib !== it && sib.ref === it.ref && !chosen.includes(sib) && chosen.length < rest - nGen) chosen.push(sib);
    }
  }
  out.push(...chosen);
  const genSkill = skill === 'logical' ? 'series' : skill;
  // generated items honour the difficulty filter too
  for (let tries = 0; out.length < rest && (genShare > 0 || !bank.length) && tries < rest * 40; tries++) {
    const g = generate(genSkill, Math.floor(r() * 2 ** 31));
    if (!g) break;
    if (level !== null && g.level !== level) continue;
    out.push(g);
  }
  out.push(...newsOut);
  // top up with more news items if the bank ran short (only without a difficulty filter)
  for (let k = 0; level === null && out.length < n && k < n * 3; k++) {
    const it = newsItem(skill, r, { seenIds, exclude: used });
    if (!it) break;
    if (used.has(it.id)) continue;
    used.add(it.id); out.push(it);
  }
  // group by context so items sharing a passage/dataset stay adjacent; shuffle the groups
  const groups = new Map();
  for (const it of out) { const k = it.ref || it.id; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
  return shuffle(r, [...groups.values()]).flat().slice(0, n);
}

// News drill: 'mix' (real market data + this week's themes, all skills), 'market', 'theme'.
export function newsSet(kind, n, { seenIds = new Set(), seed = newSeed(), concept = null } = {}) {
  const r = rng(seed);
  const out = [], used = new Set();
  if (concept) { // one theme first (its own questions), then the closest themes from the same group
    for (let k = 0; out.length < n && k < n * 6; k++) {
      const it = newsQuestion({ r, seenIds, exclude: used, concept, sameTheme: k >= 3 });
      if (!it || used.has(it.id)) continue;
      used.add(it.id); out.push(it);
    }
    return out;
  }
  const skills = ['numerical', 'mental', 'markets', 'commercial', 'culture'];
  for (let k = 0; out.length < n && k < n * 8; k++) {
    const want = kind === 'mix' ? (out.length % 2 ? 'theme' : 'market') : kind;
    const skill = want === 'market' ? skills[k % 3] : ['markets', 'commercial', 'culture'][k % 3];
    let it = want === 'market' ? marketQuestion({ skill, r }) : newsQuestion({ skill, r, seenIds, exclude: used });
    if (!it && kind === 'mix') it = want === 'market' ? newsQuestion({ skill: null, r, seenIds, exclude: used }) : marketQuestion({ skill: null, r });
    if (!it || used.has(it.id)) continue;
    used.add(it.id); out.push(it);
  }
  return out;
}

export function lessonsFor(skill) { return C.lessons.filter(l => l.skill === skill); }
export function lessonById(id) { return C.lessons.find(l => l.id === id); }
