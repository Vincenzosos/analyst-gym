// Weekly mission: a fixed weekly quota across tests, technicals, news, general culture, mocks and interviews.
// Everything is measured from the local logs, so it cannot be ticked off without doing the work.
import { load, save, weekStart, dueMistakes } from './store.js';
import { DAY } from './util.js';

export const INTENSITY = {
  leggera: { label: 'Light', k: 0.6, minutes: 120 },
  standard: { label: 'Standard', k: 1, minutes: 180 },
  intensa: { label: 'Intense', k: 1.5, minutes: 270 },
};
const TEST = new Set(['numerical', 'mental', 'verbal', 'logical', 'inductive', 'sjt']);
const TECH = new Set(['fin-acc', 'fin-val', 'fin-ma', 'fin-lbo', 'fin-ecm', 'fin-tmt', 'markets']);
// News-linked attempts: tagged at answer time (src), or recognised by id for older logs.
// Bank 'Mercati' items are mkt-001..; generated market items are mkt-<family>-<seed>.
const isNews = a => a.src === 'news' || (typeof a.id === 'string' && (a.id.startsWith('news-') || /^mkt-[a-z]/.test(a.id)));
const weekEnd = from => weekStart(new Date(from + 8 * DAY)); // next Monday 00:00 local, DST-safe

// base targets at standard intensity
const TASKS = [
  { id: 'review', tone: 'rose', title: 'Review your mistakes', unit: 'due', base: 1, href: '#/train/mistakes', why: 'A mistake you never review comes back in the real test.' },
  { id: 'brief', tone: 'amber', title: 'Weekly wrap + headlines', unit: 'read (wrap = 5)', base: 8, href: '#/news', why: 'General knowledge and commercial awareness are built week by week.' },
  { id: 'newsq', tone: 'amber', title: 'News and markets quiz', unit: 'questions', base: 12, href: '#/news/practice', why: "This week's real data and the mechanisms behind the news." },
  { id: 'culture', tone: 'amber', title: 'General knowledge', unit: 'questions', base: 15, href: '#/train/culture', why: 'Economic history, institutions, geopolitics, business.' },
  { id: 'tests', tone: 'indigo', title: 'Online tests', unit: 'questions', base: 40, href: '#/train', why: 'Numerical, verbal, logical, abstract, SJT: the first filter.' },
  { id: 'tech', tone: 'teal', title: 'Technical', unit: 'questions', base: 30, href: '#/train/fin-val', why: 'Accounting, valuation, M&A, LBO, capital markets and TMT: what every bank interview tests.' },
  { id: 'mock', tone: 'violet', title: 'Full mock test', unit: 'mock', base: 1, href: '#/mocks', why: 'Time pressure and stamina, as in the real test.' },
  { id: 'video', tone: 'sky', title: 'Video answers', unit: 'answers', base: 2, href: '#/interviews/video', why: 'Speaking to a camera only improves by speaking to a camera.' },
  { id: 'note', tone: 'green', title: 'Commercial awareness note', unit: 'note', base: 1, href: '#/news/notes', why: 'One story explained in your own words, ready for the interview.' },
];

export function intensity() { const S = load(); return INTENSITY[S.settings.intensity] || INTENSITY.standard; }

function target(t, k) {
  if (t.id === 'review') return 1;
  if (t.id === 'mock') return k >= 1.5 ? 2 : 1;
  if (t.id === 'note') return 1;
  if (t.id === 'video') return Math.max(1, Math.round(t.base * k));
  return Math.max(1, Math.round(t.base * k));
}

// Progress of every task for the week starting at `from` (ms). `current` = the running week.
export function missionFor(from, { current = false } = {}) {
  const S = load();
  const to = weekEnd(from);
  const k = intensity().k;
  const inWeek = t => t >= from && t < to;
  const att = S.attempts.filter(a => inWeek(a.t));
  const count = {
    brief: Object.values(S.newsRead || {}).filter(inWeek).length + (Object.values(S.wrapSeen || {}).some(inWeek) ? 5 : 0),
    newsq: att.filter(isNews).length,
    culture: att.filter(a => a.skill === 'culture').length,
    tests: att.filter(a => TEST.has(a.skill)).length,
    tech: att.filter(a => TECH.has(a.skill)).length,
    mock: (S.mocks || []).filter(m => inWeek(m.t) && !m.early && m.mockId !== 'video').length,
    video: att.filter(a => a.mode === 'video' && a.ms >= 20000 && a.score > 0).length,
    note: (S.commercial || []).filter(c => inWeek(c.created || 0) && ((c.event || '').length + (c.impact || '').length) >= 40).length,
  };
  const reviewed = (S.sessions || []).some(s => s.kind === 'review' && inWeek(s.t));
  return TASKS.map(t => {
    const tg = target(t, k);
    let done, value, label;
    if (t.id === 'review') {
      if (current) { const due = dueMistakes().length; done = due === 0; value = done ? 1 : 0; label = due ? `${due} due for review` : 'nothing due'; }
      else { done = true; value = 1; label = reviewed ? 'done' : 'nothing due'; } // closed weeks are read from weekLog
    } else {
      value = count[t.id]; done = value >= tg; label = `${Math.min(value, tg)}/${tg} ${t.unit}`;
    }
    return { ...t, target: tg, value, done, label, frac: t.id === 'review' ? (done ? 1 : 0) : Math.min(1, value / tg) };
  });
}

export function currentMission() {
  const from = weekStart();
  const tasks = missionFor(from, { current: true });
  const done = tasks.filter(t => t.done).length;
  const msLeft = weekEnd(from) - Date.now();
  // freeze this week's result so later setting changes or the Monday rollover cannot rewrite it
  const S = load();
  const prev = S.weekLog[from];
  if (!prev || prev.done !== done || prev.total !== tasks.length) { S.weekLog[from] = { done, total: tasks.length }; save(); }
  return { from, tasks, done, total: tasks.length, daysLeft: Math.max(0, Math.ceil(msLeft / DAY)), complete: done === tasks.length };
}

// Past weeks since the first activity (max `n`), oldest first.
export function missionHistory(n = 8) {
  const S = load();
  const first = Math.min(S.created || Date.now(), ...(S.attempts.length ? [S.attempts[0].t] : [Date.now()]));
  const out = [];
  const cur = weekStart();
  for (let i = n; i >= 1; i--) {
    const from = weekStart(new Date(cur - i * 7 * DAY + 3 * DAY));
    if (weekEnd(from) <= weekStart(new Date(first))) continue;
    const lg = (S.weekLog || {})[from];
    if (lg) { out.push({ from, done: lg.done, total: lg.total }); continue; }
    const tasks = missionFor(from);
    out.push({ from, done: tasks.filter(t => t.done).length, total: tasks.length });
  }
  return out;
}

// Consecutive fully completed weeks ending with the last closed week (plus the current one if already complete).
export function streak() {
  const hist = missionHistory(52);
  let s = 0;
  for (let i = hist.length - 1; i >= 0; i--) { if (hist[i].done === hist[i].total) s++; else break; }
  if (currentMission().complete) s++;
  return s;
}

export function weekNumber(d = new Date()) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil(((x - y0) / DAY + 1) / 7);
}
