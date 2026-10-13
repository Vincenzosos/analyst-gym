// Local persistence: attempts, mastery, mistake notebook (spaced repetition), notes.
import { DAY } from './util.js';

const KEY = 'analystgym.v1';
const MAX_ATTEMPTS = 25000;

const blank = () => ({
  version: 1,
  created: Date.now(),
  attempts: [],
  srs: {},
  lessonsRead: {},
  sessions: [],
  mocks: [],
  diag: null,
  stories: [],
  events: [],
  commercial: [],
  settings: { weeklyGoalMin: 180 },
});

let S = null;
let storageOk = true;

export function load() {
  if (S) return S;
  try {
    const raw = localStorage.getItem(KEY);
    S = raw ? { ...blank(), ...JSON.parse(raw) } : blank();
  } catch (e) {
    storageOk = false;
    S = blank();
  }
  return S;
}
export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); storageOk = true; }
  catch (e) { storageOk = false; }
}
export const storageAvailable = () => storageOk;
export const state = () => load();

// ---------- attempts ----------
// ok: boolean; score: 0..1 (SJT partial credit / self-rating); ms: time spent; target: seconds
export function logAttempt({ id, skill, level = 2, ok, score, ms, target, mode }) {
  load();
  S.attempts.push({ t: Date.now(), id, skill, level, ok: !!ok, score: score ?? (ok ? 1 : 0), ms: Math.round(ms || 0), target: target || 0, mode });
  if (S.attempts.length > MAX_ATTEMPTS) S.attempts.splice(0, S.attempts.length - MAX_ATTEMPTS);
  save();
}

export function logSession(s) { load(); S.sessions.push({ t: Date.now(), ...s }); save(); }
export function logMock(m) { load(); S.mocks.push({ t: Date.now(), ...m }); save(); }
export function setDiag(perSkill) { load(); S.diag = { t: Date.now(), perSkill }; save(); }
export function markLessonRead(id) { load(); S.lessonsRead[id] = Date.now(); save(); }

// ---------- mastery ----------
export const LEVELS = [
  { key: 'new', label: 'Da iniziare', min: 0 },
  { key: 'base', label: 'Base', min: 1 },
  { key: 'bronze', label: 'Bronzo', min: 2 },
  { key: 'silver', label: 'Argento', min: 3 },
  { key: 'gold', label: 'Oro', min: 4 },
];

export function mastery(skill, attempts = load().attempts) {
  const mine = attempts.filter(a => a.skill === skill);
  const recent = mine.slice(-30);
  const n = recent.length;
  if (!n) return { skill, n: 0, total: 0, acc: 0, speed: 0, timedN: 0, score: 0, level: 0, label: LEVELS[0].label, key: 'new' };
  // learn-mode attempts count half
  let wSum = 0, wOk = 0;
  for (const a of recent) { const w = a.mode === 'learn' ? 0.5 : 1; wSum += w; wOk += w * (a.score ?? (a.ok ? 1 : 0)); }
  const acc = wOk / wSum;
  const timed = recent.filter(a => a.mode !== 'learn' && a.target > 0);
  const inTime = timed.filter(a => (a.score ?? (a.ok ? 1 : 0)) >= 0.5 && a.ms <= a.target * 1000).length;
  const speed = timed.length ? inTime / timed.length : 0;
  let level = 0;
  if (mine.length >= 8) level = 1;
  if (level >= 1 && acc >= 0.6) level = 2;
  if (level >= 2 && acc >= 0.75 && speed >= 0.6 && timed.length >= 10) level = 3;
  if (level >= 3 && acc >= 0.85 && speed >= 0.8 && timed.length >= 20) level = 4;
  const score = Math.round(100 * (0.7 * acc + 0.3 * (timed.length ? speed : acc * 0.5)));
  return { skill, n, total: mine.length, acc, speed, timedN: timed.length, score, level, label: LEVELS[level].label, key: LEVELS[level].key };
}

// accuracy per day for charts
export function dailySeries(skill, days = 60) {
  const since = Date.now() - days * DAY;
  const by = new Map();
  for (const a of load().attempts) {
    if (a.t < since || (skill && a.skill !== skill)) continue;
    const d = new Date(a.t).toISOString().slice(0, 10);
    const e = by.get(d) || { n: 0, ok: 0, ms: 0, timed: 0, inTime: 0 };
    e.n++; e.ok += a.score ?? (a.ok ? 1 : 0); e.ms += a.ms;
    if (a.mode !== 'learn' && a.target) { e.timed++; if (a.ms <= a.target * 1000 && (a.score ?? 0) >= 0.5) e.inTime++; }
    by.set(d, e);
  }
  return [...by.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([d, e]) => ({ d, n: e.n, acc: e.ok / e.n, speed: e.timed ? e.inTime / e.timed : null, avgS: e.ms / e.n / 1000 }));
}

export function minutesBetween(from, to = Date.now()) {
  return Math.round(load().attempts.filter(a => a.t >= from && a.t <= to).reduce((s, a) => s + a.ms, 0) / 60000);
}
export function weekStart(d = new Date()) {
  const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - day); return x.getTime();
}
export function activeDays(days = 28) {
  const since = Date.now() - days * DAY;
  return new Set(load().attempts.filter(a => a.t >= since).map(a => new Date(a.t).toISOString().slice(0, 10))).size;
}

// ---------- mistake notebook (Leitner boxes) ----------
const INTERVAL = [0, 1, 3, 7, 14]; // days after a correct answer in box n
export function addMistake(item) {
  load();
  const id = item.id;
  const e = S.srs[id];
  const snap = JSON.parse(JSON.stringify(item));
  if (e) { e.box = 1; e.due = Date.now() + DAY; e.wrong++; e.last = Date.now(); e.item = snap; e.done = false; }
  else S.srs[id] = { item: snap, box: 1, due: Date.now() + DAY, wrong: 1, added: Date.now(), last: Date.now(), done: false };
  save();
}
export function reviewResult(id, ok) {
  load();
  const e = S.srs[id]; if (!e) return;
  e.last = Date.now();
  if (ok) {
    e.box = Math.min(5, e.box + 1);
    if (e.box >= 5) { e.done = true; e.due = Infinity; }
    else e.due = Date.now() + INTERVAL[e.box] * DAY;
  } else { e.box = 1; e.wrong++; e.due = Date.now() + DAY; e.done = false; }
  save();
}
export function mistakes() { return Object.values(load().srs); }
export function dueMistakes(now = Date.now()) { return mistakes().filter(e => !e.done && e.due <= now).sort((a, b) => a.due - b.due); }
export function openMistakes() { return mistakes().filter(e => !e.done); }

// ---------- notes ----------
const uid = () => Math.random().toString(36).slice(2, 10);
export function upsert(listName, obj) {
  load();
  const list = S[listName];
  if (!obj.id) { obj.id = uid(); obj.created = Date.now(); list.push(obj); }
  else { const i = list.findIndex(x => x.id === obj.id); if (i >= 0) list[i] = { ...list[i], ...obj }; else list.push(obj); }
  save(); return obj;
}
export function remove(listName, id) { load(); S[listName] = S[listName].filter(x => x.id !== id); save(); }

// ---------- backup ----------
export function exportJSON() { return JSON.stringify(load(), null, 1); }
export function importJSON(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || !Array.isArray(data.attempts)) throw new Error('File non valido');
  S = { ...blank(), ...data }; save();
}
export function resetAll() { S = blank(); save(); }
