// Shared view helpers: mastery badges, recommended session, navigation.
import { h } from '../util.js';
import { SKILLS, SKILL, lessonsFor, content } from '../content.js';
import { mastery, dueMistakes, load, LEVELS } from '../store.js';

export const SCORED = SKILLS.filter(s => s.id !== 'behavioural');
export const TEST_SKILLS = SKILLS.filter(s => s.group === 'Test online');
export const TECH_SKILLS = SKILLS.filter(s => s.group === 'Tecnico' || s.id === 'commercial');

export const go = (hash) => { location.hash = hash; };

export function levelBadge(m) {
  return h('span', { class: `lvl-badge ${m.key}` }, m.label);
}

export function allMastery() { return Object.fromEntries(SKILLS.map(s => [s.id, mastery(s.id)])); }

export function readiness() {
  const ms = SCORED.map(s => mastery(s.id));
  const started = ms.filter(m => m.total > 0);
  if (!started.length) return { value: 0, started: 0 };
  // unstarted skills count as 0 to avoid flattering numbers
  return { value: ms.reduce((s, m) => s + m.score, 0) / ms.length / 100, started: started.length };
}

// Recommended session: due mistakes + 2 weakest test skills + weakest technical skill + 1 video answer.
export function recommendedSession() {
  const S = load();
  const steps = [];
  const due = dueMistakes();
  if (due.length) steps.push({ kind: 'review', title: `Ripasso errori (${Math.min(due.length, 15)})`, sub: 'Quaderno degli errori, ripetizione dilazionata', href: '#/errori/ripasso', minutes: Math.min(due.length, 15) });
  const rank = arr => arr.map(s => ({ s, m: mastery(s.id) })).sort((a, b) => a.m.score - b.m.score || a.m.total - b.m.total);
  const weakTests = rank(TEST_SKILLS).slice(0, 2);
  for (const { s, m } of weakTests) {
    const ls = lessonsFor(s.id).filter(l => !S.lessonsRead[l.id]);
    if (m.level < 2 && ls.length) steps.push({ kind: 'lesson', title: `Lezione: ${ls[0].title}`, sub: `${s.name} · ${ls[0].minutes || 10} min`, href: `#/lezioni/${ls[0].id}`, minutes: ls[0].minutes || 10 });
    steps.push({ kind: 'drill', title: `${s.icon} ${s.name}: ${m.level < 2 ? 'impara' : 'cronometrato'} × 12`, sub: `Livello attuale: ${m.label} · ${m.total ? Math.round(m.acc * 100) + '% accuratezza' : 'mai fatto'}`, href: `#/allenamento/${s.id}?mode=${m.level < 2 ? 'learn' : 'timed'}&n=12`, minutes: 15 });
  }
  const weakTech = rank(TECH_SKILLS.filter(s => s.id !== 'commercial'))[0];
  if (weakTech) steps.push({ kind: 'drill', title: `${weakTech.s.icon} ${weakTech.s.name} × 10`, sub: `Tecnico · ${weakTech.m.label}`, href: `#/allenamento/${weakTech.s.id}?mode=${weakTech.m.level < 2 ? 'learn' : 'timed'}&n=10`, minutes: 12 });
  steps.push({ kind: 'video', title: '🎥 1 risposta in video', sub: '30 s per pensare, 2 min per rispondere', href: '#/colloqui/video', minutes: 5 });
  return steps;
}

export function emptyContentNotice() {
  const C = content();
  if (!C.missing.length) return null;
  return h('div', { class: 'notice' }, `Contenuti non caricati: ${C.missing.join(', ')}. Avvia il sito da un server (non aprendo il file direttamente).`);
}

export const LEVEL_KEYS = LEVELS.map(l => l.key);
export { SKILLS, SKILL };
