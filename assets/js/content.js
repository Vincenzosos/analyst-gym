// Loads the JSON packs and exposes item pools per skill (bank items + generators).
import { generateMental } from './gen/mental.js';
import { generateNumerical } from './gen/numerical.js';
import { generateSeries } from './gen/series.js';
import { generateShapes } from './gen/shapes.js';
import { newSeed, shuffle, rng } from './util.js';

export const SKILLS = [
  { id: 'numerical', name: 'Numerical reasoning', short: 'Numerical', group: 'Test online', icon: '📊' },
  { id: 'mental', name: 'Calcolo mentale', short: 'Mental math', group: 'Test online', icon: '🧮' },
  { id: 'verbal', name: 'Verbal reasoning', short: 'Verbal', group: 'Test online', icon: '📖' },
  { id: 'logical', name: 'Logical reasoning', short: 'Logical', group: 'Test online', icon: '🧩' },
  { id: 'inductive', name: 'Abstract / inductive', short: 'Abstract', group: 'Test online', icon: '🔷' },
  { id: 'sjt', name: 'Situational judgement', short: 'SJT', group: 'Test online', icon: '🧭' },
  { id: 'fin-acc', name: 'Accounting & 3 statements', short: 'Accounting', group: 'Tecnico', icon: '📒' },
  { id: 'fin-val', name: 'Valuation', short: 'Valuation', group: 'Tecnico', icon: '💶' },
  { id: 'fin-ma', name: 'M&A', short: 'M&A', group: 'Tecnico', icon: '🤝' },
  { id: 'fin-lbo', name: 'LBO', short: 'LBO', group: 'Tecnico', icon: '🏦' },
  { id: 'markets', name: 'Mercati', short: 'Mercati', group: 'Tecnico', icon: '📈' },
  { id: 'commercial', name: 'Commercial awareness', short: 'Commercial', group: 'Colloquio', icon: '🌍' },
  { id: 'behavioural', name: 'Behavioural & video', short: 'Behavioural', group: 'Colloquio', icon: '🎥' },
];
export const SKILL = Object.fromEntries(SKILLS.map(s => [s.id, s]));
export const LESSON_SKILLS = { workstyle: { name: 'Questionari work-style', icon: '🧠' } };

const PACKS = {
  lessons: ['lessons-quant', 'lessons-reasoning', 'lessons-people', 'lessons-finance'],
  banks: ['bank-numerical', 'bank-verbal', 'bank-logic', 'bank-sjt', 'bank-fin-a', 'bank-fin-b', 'bank-behavioural'],
};

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
  const names = [...PACKS.lessons, ...PACKS.banks];
  results.forEach((res, i) => {
    if (res.status !== 'fulfilled') { C.missing.push(names[i]); return; }
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

// Build a practice set for a skill: mixes bank items (least-seen first) and generated items.
export function practiceSet(skill, n, { level = null, seenIds = new Set(), seed = newSeed() } = {}) {
  const r = rng(seed);
  const bank = (C.bySkill.get(skill) || []).filter(it => level === null || it.level === level);
  const out = [];
  let genShare = 0;
  if (skill === 'mental' || skill === 'inductive') genShare = 1;
  else if (skill === 'numerical') genShare = bank.length ? 0.5 : 1;
  else if (skill === 'logical') genShare = 0.25; // series generator
  const nGen = Math.round(n * genShare);
  const fresh = shuffle(r, bank.filter(it => !seenIds.has(it.id)));
  const seen = shuffle(r, bank.filter(it => seenIds.has(it.id)));
  const pool = [...fresh, ...seen];
  // keep passage/dataset siblings together for realism
  const chosen = [];
  for (const it of pool) {
    if (chosen.length >= n - nGen) break;
    if (chosen.includes(it)) continue;
    chosen.push(it);
    if (it.ref && chosen.length < n - nGen) {
      for (const sib of pool) if (sib !== it && sib.ref === it.ref && !chosen.includes(sib) && chosen.length < n - nGen) chosen.push(sib);
    }
  }
  out.push(...chosen);
  const genSkill = skill === 'logical' ? 'series' : skill;
  while (out.length < n && (genShare > 0 || !bank.length)) {
    const g = generate(genSkill, Math.floor(r() * 2 ** 31));
    if (!g) break;
    out.push(g);
  }
  // group by context so items sharing a passage/dataset stay adjacent; shuffle the groups
  const groups = new Map();
  for (const it of out) { const k = it.ref || it.id; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
  return shuffle(r, [...groups.values()]).flat().slice(0, n);
}

export function lessonsFor(skill) { return C.lessons.filter(l => l.skill === skill); }
export function lessonById(id) { return C.lessons.find(l => l.id === id); }
