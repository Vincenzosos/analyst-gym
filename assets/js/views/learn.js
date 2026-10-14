// Lesson reader with table of contents, worked examples (try first, then reveal) and cheatsheet.
import { h, md } from '../util.js';
import { lessonById, SKILL, LESSON_SKILLS } from '../content.js';
import { load, markLessonRead } from '../store.js';
import { go } from './common.js';

export function lessonView(root, id) {
  const l = lessonById(id);
  if (!l) { root.append(h('p', {}, 'Lesson not found.')); return; }
  const S = load();
  const sk = SKILL[l.skill] || LESSON_SKILLS[l.skill] || { name: l.skill, code: '' };
  root.append(h('div', { class: 'crumbs lesson-crumbs' }, h('a', { href: '#/train/lessons' }, 'Lessons'), ' / ', SKILL[l.skill] ? h('a', { href: `#/train/${l.skill}` }, sk.name) : sk.name));
  const art = h('article', { class: 'lesson' });
  art.append(h('div', { class: 'kicker' }, `Lesson · ${l.minutes || 10} minutes`), h('h1', { class: 'display' }, l.title), l.summary ? h('p', { class: 'lead' }, l.summary) : '');
  const toc = h('nav', { class: 'toc' }, (l.sections || []).map((s, i) => h('button', { class: 'toc-a', onclick: () => document.getElementById(`sec-${i}`).scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }) }, s.h)));
  art.append(toc);
  (l.sections || []).forEach((s, i) => art.append(h('section', { class: 'l-sec', id: `sec-${i}` }, h('h2', {}, s.h), h('div', { class: 'md', html: md(s.body) }))));
  if (l.examples && l.examples.length) {
    art.append(h('h2', {}, 'Worked examples'));
    l.examples.forEach((ex, i) => {
      const sol = h('div', { class: 'ex-sol hidden' }, h('ol', {}, (ex.steps || []).map(s => h('li', { html: md(s).replace(/^<p>|<\/p>$/g, '') }))), h('div', { class: 'ex-ans' }, h('b', {}, 'Answer: '), ex.answer || ''));
      art.append(h('div', { class: 'example' }, h('div', { class: 'ex-q' }, h('b', {}, `Example ${i + 1}. `), h('span', { html: md(ex.q).replace(/^<p>|<\/p>$/g, '') })),
        h('button', { class: 'linkbtn reveal', onclick: e => { sol.classList.toggle('hidden'); e.target.textContent = sol.classList.contains('hidden') ? 'Try it yourself, then show the solution' : 'Hide the solution'; } }, 'Try it yourself, then show the solution'), sol));
    });
  }
  if (l.cheatsheet && l.cheatsheet.length) art.append(h('div', { class: 'cheat' }, h('div', { class: 'cheat-h' }, 'Remember'), h('ul', {}, l.cheatsheet.map(c => h('li', { html: md(c).replace(/^<p>|<\/p>$/g, '') })))));
  const isRead = !!S.lessonsRead[l.id];
  const trainable = !!SKILL[l.skill] && l.skill !== 'behavioural';
  art.append(h('div', { class: 'row-end' },
    h('button', { class: 'btn ' + (isRead ? 'ghost' : 'primary'), onclick: () => { markLessonRead(l.id); go(trainable ? `#/train/${l.skill}?mode=learn&n=10` : '#/train/lessons'); } }, isRead ? 'Already read · go to practice' : (trainable ? 'Done · practise now (learn mode)' : 'Mark as read')),
    l.skill === 'behavioural' ? h('a', { class: 'btn ghost', href: '#/interviews' }, 'Go to Interviews') : ''));
  root.append(art);
}
