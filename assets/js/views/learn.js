// Lessons: list grouped by area, lesson reader with worked examples and cheatsheet.
import { h, md } from '../util.js';
import { content, lessonById, SKILL, LESSON_SKILLS } from '../content.js';
import { load, markLessonRead, mastery } from '../store.js';
import { go, levelBadge, emptyContentNotice } from './common.js';

const ORDER = ['numerical', 'mental', 'verbal', 'logical', 'workstyle', 'sjt', 'fin-acc', 'fin-val', 'fin-ma', 'fin-lbo', 'commercial', 'behavioural'];

export function lessonsList(root) {
  const C = content(); const S = load();
  root.append(emptyContentNotice() || '');
  const groups = new Map();
  for (const l of C.lessons) { if (!groups.has(l.skill)) groups.set(l.skill, []); groups.get(l.skill).push(l); }
  const keys = [...groups.keys()].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const read = C.lessons.filter(l => S.lessonsRead[l.id]).length;
  root.append(h('div', { class: 'page-h' }, h('h1', {}, 'Lezioni'), h('span', { class: 'muted' }, `${read}/${C.lessons.length} lette · metodo prima, velocità dopo`)));
  for (const k of keys) {
    const sk = SKILL[k] || LESSON_SKILLS[k] || { name: k, icon: '•' };
    const m = SKILL[k] ? mastery(k) : null;
    root.append(h('section', { class: 'card' },
      h('div', { class: 'card-h' }, h('h2', {}, `${sk.icon} ${sk.name}`), m ? levelBadge(m) : ''),
      h('div', { class: 'lesson-list' }, groups.get(k).map(l => h('a', { class: 'lesson-row' + (S.lessonsRead[l.id] ? ' read' : ''), href: `#/lezioni/${l.id}` },
        h('span', { class: 'tick' }, S.lessonsRead[l.id] ? '✓' : '○'),
        h('div', {}, h('div', { class: 'lr-t' }, l.title), h('div', { class: 'muted small' }, l.summary || '')),
        h('span', { class: 'muted small' }, `${l.minutes || 10}′`))))));
  }
}

export function lessonView(root, id) {
  const l = lessonById(id);
  if (!l) { root.append(h('p', {}, 'Lezione non trovata.')); return; }
  const S = load();
  const sk = SKILL[l.skill] || LESSON_SKILLS[l.skill] || { name: l.skill, icon: '' };
  root.append(h('div', { class: 'crumbs' }, h('a', { href: '#/lezioni' }, 'Lezioni'), ' / ', `${sk.icon} ${sk.name}`));
  const art = h('article', { class: 'lesson' });
  art.append(h('h1', {}, l.title), h('div', { class: 'muted' }, `${l.minutes || 10} minuti · ${l.summary || ''}`));
  const toc = h('nav', { class: 'toc' }, (l.sections || []).map((s, i) => h('a', { href: `javascript:void(0)`, onclick: () => document.getElementById(`sec-${i}`).scrollIntoView({ behavior: 'smooth' }) }, s.h)));
  art.append(toc);
  (l.sections || []).forEach((s, i) => art.append(h('section', { class: 'l-sec', id: `sec-${i}` }, h('h2', {}, s.h), h('div', { class: 'md', html: md(s.body) }))));
  if (l.examples && l.examples.length) {
    art.append(h('h2', {}, 'Esempi svolti'));
    l.examples.forEach((ex, i) => {
      const sol = h('div', { class: 'ex-sol hidden' }, h('ol', {}, (ex.steps || []).map(s => h('li', { html: md(s).replace(/^<p>|<\/p>$/g, '') }))), h('div', { class: 'ex-ans' }, h('b', {}, 'Risposta: '), ex.answer || ''));
      art.append(h('div', { class: 'example' }, h('div', { class: 'ex-q' }, h('b', {}, `Esempio ${i + 1}. `), h('span', { html: md(ex.q).replace(/^<p>|<\/p>$/g, '') })),
        h('button', { class: 'linkbtn', onclick: e => { sol.classList.toggle('hidden'); e.target.textContent = sol.classList.contains('hidden') ? 'Prova da solo, poi mostra la soluzione' : 'Nascondi soluzione'; } }, 'Prova da solo, poi mostra la soluzione'), sol));
    });
  }
  if (l.cheatsheet && l.cheatsheet.length) art.append(h('div', { class: 'cheat' }, h('div', { class: 'cheat-h' }, '📌 Da ricordare'), h('ul', {}, l.cheatsheet.map(c => h('li', { html: md(c).replace(/^<p>|<\/p>$/g, '') })))));
  const isRead = !!S.lessonsRead[l.id];
  const trainable = !!SKILL[l.skill] && l.skill !== 'behavioural';
  art.append(h('div', { class: 'row-end' },
    h('button', { class: isRead ? 'ghost' : 'primary', onclick: () => { markLessonRead(l.id); go(trainable ? `#/allenamento/${l.skill}?mode=learn&n=10` : '#/lezioni'); } }, isRead ? 'Già letta · vai agli esercizi' : (trainable ? 'Fatto · allenati ora (modalità impara)' : 'Segna come letta')),
    l.skill === 'behavioural' ? h('a', { class: 'ghost btnlink', href: '#/colloqui' }, 'Vai a Colloqui') : ''));
  root.append(art);
}
