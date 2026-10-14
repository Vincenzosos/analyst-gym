// Shared view helpers: mastery badges, skill tags, recommended session, navigation.
import { h } from '../util.js';
import { SKILLS, SKILL, lessonsFor, content } from '../content.js';
import { mastery, dueMistakes, load, LEVELS } from '../store.js';
import { currentMission } from '../mission.js';

export const SCORED = SKILLS.filter(s => s.id !== 'behavioural');
export const TEST_SKILLS = SKILLS.filter(s => s.group === 'Online tests');
export const TECH_SKILLS = SKILLS.filter(s => s.group === 'Technical');

export const go = (hash) => { location.hash = hash; };

export function levelBadge(m) {
  return h('span', { class: `lvl-badge ${m.key}${m.stale ? ' stale' : ''}`, title: m.stale ? `Last practised ${m.idleDays} days ago: the level drops until you train again` : '' }, m.label);
}
export const GROUP_TONE = { 'Online tests': 'indigo', 'Technical': 'teal', 'Culture and current affairs': 'amber', 'Interview': 'violet' };
const THEME_TONE = { 'Monetary policy': 'indigo', 'Macro': 'sky', 'Markets': 'teal', 'FX and commodities': 'amber', 'Deals and corporate finance': 'violet', 'Earnings and strategy': 'green', 'Banks and credit': 'sky', 'Technology and industry': 'indigo', 'Geopolitics': 'rose', 'Institutions and politics': 'indigo', 'Society and technology': 'teal', 'Global economy': 'amber' };
export const toneOf = s => `tone-${(s && GROUP_TONE[s.group]) || 'indigo'}`;
export const themeTone = theme => `tone-${THEME_TONE[theme] || 'indigo'}`;
export function skillTag(s) { return h('span', { class: `sk-tag ${toneOf(s)}` }, s ? s.code : '•'); }

export function allMastery() { return Object.fromEntries(SKILLS.map(s => [s.id, mastery(s.id)])); }

export function readiness() {
  const ms = SCORED.map(s => mastery(s.id));
  const started = ms.filter(m => m.total > 0);
  if (!started.length) return { value: 0, started: 0 };
  // unstarted skills count as 0 to avoid flattering numbers
  return { value: ms.reduce((s, m) => s + m.score, 0) / ms.length / 100, started: started.length };
}

const drillHref = (id, m, n) => `#/train/${id}?mode=${m.level < 2 ? 'learn' : 'timed'}&n=${n}`;

// Recommended session: what the weekly mission still needs, ordered by impact, plus the weakest areas.
export function recommendedSession() {
  const S = load();
  const mission = currentMission();
  const todo = Object.fromEntries(mission.tasks.map(t => [t.id, t]));
  const steps = [];
  if (!S.diag) steps.push({ kind: 'diag', title: 'Diagnostic test (40 questions)', sub: 'Your starting point: it measures every area and sets the plan', href: '#/mocks/diag', minutes: 45 });
  const due = dueMistakes();
  if (due.length) steps.push({ kind: 'review', title: `Review mistakes (${Math.min(due.length, 15)})`, sub: 'Spaced repetition: 1, 3, 7, 14 days', href: '#/train/mistakes/review', minutes: Math.min(due.length, 15) });
  if (!todo.brief.done) steps.push({ kind: 'news', title: 'Weekly wrap (2 min) + headlines', sub: `Mission: ${todo.brief.label}`, href: '#/news', minutes: 8 });
  const rank = arr => arr.map(s => ({ s, m: mastery(s.id) })).sort((a, b) => a.m.score - b.m.score || a.m.total - b.m.total);
  const weakTest = rank(TEST_SKILLS)[0];
  if (weakTest) {
    const { s, m } = weakTest;
    const ls = lessonsFor(s.id).filter(l => !S.lessonsRead[l.id]);
    if (m.level < 2 && ls.length) steps.push({ kind: 'lesson', title: `Lesson: ${ls[0].title}`, sub: `${s.name} · ${ls[0].minutes || 10} min`, href: `#/train/lesson/${ls[0].id}`, minutes: ls[0].minutes || 10 });
    steps.push({ kind: 'drill', title: `${s.name}: ${m.level < 2 ? 'learn' : 'timed'} × 12`, sub: `Weakest test area · ${m.label}`, href: drillHref(s.id, m, 12), minutes: 15 });
  }
  if (!todo.newsq.done) steps.push({ kind: 'news', title: 'News and markets quiz × 12', sub: `Real data and this week's themes · ${todo.newsq.label}`, href: '#/news/practice?mode=mix&n=12', minutes: 15 });
  if (!todo.culture.done) { const m = mastery('culture'); steps.push({ kind: 'drill', title: 'General knowledge × 15', sub: `${todo.culture.label} · ${m.label}`, href: drillHref('culture', m, 15), minutes: 12 }); }
  const weakTech = rank(TECH_SKILLS)[0];
  if (weakTech) steps.push({ kind: 'drill', title: `${weakTech.s.name} × 10`, sub: `Weakest technical area · ${weakTech.m.label}`, href: drillHref(weakTech.s.id, weakTech.m, 10), minutes: 12 });
  if (!todo.mock.done && (mission.daysLeft <= 2 || [0, 6].includes(new Date().getDay()))) steps.push({ kind: 'mock', title: 'One full mock test', sub: 'Rotate numerical, verbal, Cappfinity, BofA', href: '#/mocks', minutes: 40 });
  if (!todo.video.done) {
    // a core question (motivation, competency, banking), rotating each week
    const core = content().behavioural.filter(x => ['motivation', 'competency', 'banking-specific', 'strengths'].includes(x.category));
    const wk = Math.floor(Date.now() / (7 * 86400000));
    const pickQ = core.length ? core[(wk * 7 + (todo.video.value || 0)) % core.length] : null;
    steps.push({ kind: 'video', title: '1 video answer', sub: pickQ ? `“${pickQ.q.length > 70 ? pickQ.q.slice(0, 68) + '…' : pickQ.q}”` : '30 s to think, 2 min to answer', href: pickQ ? `#/interviews/video?q=${encodeURIComponent(pickQ.id)}` : '#/interviews/video', minutes: 5 });
  }
  return steps.slice(0, 7);
}

export function emptyContentNotice() {
  const C = content();
  if (!C.missing.length) return null;
  return h('div', { class: 'notice' }, `Some content did not load: ${C.missing.join(', ')}. Open the site through a web server, not as a local file.`);
}

// Page header in the display style: kicker, big title with an accent part, subtitle, optional right side.
export function pageHead({ kicker = '', title = '', accent = '', sub = '', right = null } = {}) {
  return h('div', { class: 'page-h' },
    h('div', {}, kicker ? h('div', { class: 'kicker' }, kicker) : '', h('h1', { class: 'display' }, title, accent ? h('span', { class: 'hl' }, ` ${accent}`) : ''), sub ? h('div', { class: 'muted page-sub' }, sub) : ''),
    right || '');
}

// Segmented tabs rendered as links.
export function tabs(items, cur) {
  return h('div', { class: 'tabs' }, items.map(([k, t, href, badge]) => h('a', { class: 'tab' + (k === cur ? ' on' : ''), href }, t, badge ? h('span', { class: 'badge' }, String(badge)) : '')));
}

export const LEVEL_KEYS = LEVELS.map(l => l.key);
export { SKILLS, SKILL };
