// Router and shell.
import { h, $ } from './util.js';
import { loadContent } from './content.js';
import { load, dueMistakes } from './store.js';
import { dashboard, path } from './views/home.js';
import { lessonsList, lessonView } from './views/learn.js';
import { trainHome, trainSkill, mistakesView } from './views/train.js';
import { mocksList, mockRun } from './views/mockview.js';
import { interviewView } from './views/interview.js';
import { progressView, dataView } from './views/progress.js';

const NAV = [
  ['oggi', 'Oggi'], ['percorso', 'Percorso'], ['lezioni', 'Lezioni'], ['allenamento', 'Allenamento'],
  ['simulazioni', 'Simulazioni'], ['errori', 'Errori'], ['colloqui', 'Colloqui'], ['progressi', 'Progressi'],
];

function parse() {
  const raw = location.hash.replace(/^#\/?/, '') || 'oggi';
  const [p, qs] = raw.split('?');
  const parts = p.split('/').filter(Boolean);
  const q = Object.fromEntries(new URLSearchParams(qs || ''));
  return { parts, q };
}

function renderNav(active) {
  const due = dueMistakes().length;
  const nav = $('#nav');
  nav.innerHTML = '';
  for (const [k, t] of NAV) nav.append(h('a', { href: `#/${k}`, class: k === active ? 'on' : '' }, t, k === 'errori' && due ? h('span', { class: 'badge' }, String(due)) : ''));
  nav.append(h('a', { href: '#/dati', class: 'nav-data' + (active === 'dati' ? ' on' : ''), title: 'Dati e impostazioni' }, '⚙'));
}

async function route() {
  const { parts, q } = parse();
  const [page, sub] = parts;
  const main = $('#main');
  main.innerHTML = '';
  main.scrollTop = 0; window.scrollTo(0, 0);
  renderNav(page || 'oggi');
  try {
    switch (page) {
      case 'percorso': path(main); break;
      case 'lezioni': sub ? lessonView(main, sub) : lessonsList(main); break;
      case 'allenamento': sub ? trainSkill(main, sub, q) : trainHome(main); break;
      case 'simulazioni': sub ? mockRun(main, sub) : mocksList(main); break;
      case 'errori': mistakesView(main, sub); break;
      case 'colloqui': interviewView(main, sub, q); break;
      case 'progressi': progressView(main, q); break;
      case 'dati': dataView(main); break;
      default: dashboard(main);
    }
  } catch (e) {
    console.error(e);
    main.append(h('div', { class: 'notice' }, `Errore: ${e.message}`));
  }
}

(async function init() {
  load();
  $('#main').append(h('div', { class: 'loading' }, 'Caricamento…'));
  await loadContent();
  window.addEventListener('hashchange', route);
  route();
})();
