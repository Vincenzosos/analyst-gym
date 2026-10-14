// Router and shell: five sections plus settings, redirects from the old routes, page transitions.
import { h, $ } from './util.js';
import { loadContent } from './content.js';
import { load, dueMistakes, addActivity } from './store.js';
import { homeView } from './views/home.js';
import { trainView } from './views/train.js';
import { mocksList, mockRun } from './views/mockview.js';
import { interviewView } from './views/interview.js';
import { newsView } from './views/news.js';
import { dataView } from './views/progress.js';
import { currentMission } from './mission.js';
import { news } from './news.js';

const ICONS = {
  today: '<path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/><circle cx="12" cy="12" r="4"/>',
  train: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
  mocks: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2h5M12 2v3"/>',
  interviews: '<path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8"/>',
  news: '<path d="M4 4h13v16H6a2 2 0 0 1-2-2V4z"/><path d="M17 8h3v10a2 2 0 0 1-2 2"/><path d="M8 8h5M8 12h5M8 16h3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};
export const icon = (k, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k] || ''}</svg>`;

const NAV = [['today', 'Today'], ['train', 'Train'], ['mocks', 'Mocks'], ['interviews', 'Interviews'], ['news', 'News']];

// Old (Italian) routes -> current routes, so bookmarks and saved links keep working.
const SUB = { errori: 'mistakes', ripasso: 'review', tutti: 'all', lezioni: 'lessons', lezione: 'lesson', progressi: 'progress', storie: 'stories', esercizi: 'practice', temi: 'themes', note: 'notes', domande: '' };
function redirect(parts, qs) {
  const [p, a, b, c] = parts;
  const q = qs ? `?${qs}` : '';
  const tr = x => (x === undefined ? undefined : (SUB[x] !== undefined ? SUB[x] : x));
  const join = (...xs) => '#/' + xs.filter(x => x !== undefined && x !== '').join('/') + q;
  if (p === 'oggi') return join('today', tr(a));
  if (p === 'percorso' || p === 'progressi') return join('today', 'progress');
  if (p === 'lezioni') return a ? join('train', 'lesson', a) : join('train', 'lessons');
  if (p === 'allenamento' || p === 'allenati') return join('train', tr(a), tr(b), c);
  if (p === 'errori') return join('train', 'mistakes', tr(a));
  if (p === 'simulazioni') return join('mocks', a);
  if (p === 'colloqui') return a === 'commercial' ? join('news', 'notes') : join('interviews', tr(a));
  if (p === 'news' && a && SUB[a] !== undefined && SUB[a] !== '') return join('news', SUB[a], b);
  if (p === 'dati') return join('settings');
  return null;
}

function parse() {
  const raw = location.hash.replace(/^#\/?/, '') || 'today';
  const [p, qs] = raw.split('?');
  const dec = x => { try { return decodeURIComponent(x); } catch { return x; } };
  const parts = p.split('/').filter(Boolean).map(dec);
  const q = Object.fromEntries(new URLSearchParams(qs || ''));
  return { parts, q, qs };
}

function renderNav(active) {
  const due = dueMistakes().length;
  let M = null; try { M = currentMission(); } catch { /* storage */ }
  const S = load();
  const unread = news().headlines.filter(x => x.t > Date.now() - 2 * 86400000 && !S.newsRead[x.id]).length;
  const badge = { train: due || null, today: M && !M.complete ? `${M.done}/${M.total}` : null, news: unread ? '•' : null };
  const nav = $('#nav');
  const sig = JSON.stringify([active, badge]);
  if (nav.dataset.sig === sig) return; // unchanged: keep the DOM (and keyboard focus) as it is
  nav.dataset.sig = sig;
  nav.innerHTML = '';
  for (const [k, t] of NAV) {
    nav.append(h('a', { href: `#/${k}`, class: 'nav-a' + (k === active ? ' on' : ''), 'aria-current': k === active ? 'page' : null },
      h('span', { class: 'nav-ic', html: icon(k) }), h('span', { class: 'nav-t' }, t),
      badge[k] ? h('span', { class: 'badge' + (k === 'news' ? ' dot' : '') }, k === 'news' ? '' : String(badge[k])) : ''));
  }
  const gear = $('#gear');
  gear.className = 'gear' + (active === 'settings' ? ' on' : '');
  gear.innerHTML = icon('settings');
}

let curPage = 'today';
async function route() {
  const { parts, q, qs } = parse();
  const to = redirect(parts, qs);
  if (to) { location.replace(to); return; }
  const [page, sub, ...rest] = parts;
  const main = $('#main');
  main.innerHTML = '';
  main.classList.remove('enter'); void main.offsetWidth; main.classList.add('enter');
  window.scrollTo(0, 0);
  curPage = page || 'today';
  renderNav(curPage);
  try {
    switch (page) {
      case 'train': await trainView(main, sub, q, rest); break;
      case 'mocks': sub ? mockRun(main, sub) : mocksList(main); break;
      case 'interviews': interviewView(main, sub, q); break;
      case 'news': newsView(main, sub, q); break;
      case 'settings': dataView(main); break;
      default: homeView(main, page === 'today' ? sub : null, q);
    }
  } catch (e) {
    console.error(e);
    main.append(h('div', { class: 'notice' }, `Error: ${e.message}`));
  }
  document.title = `${(NAV.find(n => n[0] === (page || 'today')) || ['', 'Settings'])[1]} · Analyst Gym`;
  if (document.activeElement === document.body || !document.activeElement || !document.contains(document.activeElement)) main.focus({ preventScroll: true }); // keyboard users start from the new page
}

// pointer-follow glow on cards
document.addEventListener('pointermove', e => {
  const el = e.target.closest && e.target.closest('.card, .skill-card, .train-card, .mock-card, .theme-card, .drill-card, .step, .task, .mkt');
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${e.clientX - r.left}px`);
  el.style.setProperty('--my', `${e.clientY - r.top}px`);
}, { passive: true });

// Live nav badges: any save (answer, headline read, note) refreshes them.
let navTimer = null;
window.addEventListener('ag:saved', () => { clearTimeout(navTimer); navTimer = setTimeout(() => renderNav(curPage), 150); });

// Active time: every 30 s, if the page is visible and the user interacted in the last 2 minutes.
let lastInput = Date.now();
for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart']) window.addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true, capture: true });
setInterval(() => { if (document.visibilityState === 'visible' && Date.now() - lastInput < 120000) addActivity(0.5); }, 30000);

(async function init() {
  load();
  $('#main').append(h('div', { class: 'loading' }, h('div', { class: 'spinner' }), 'Loading'));
  await loadContent();
  window.addEventListener('hashchange', route);
  route();
})();
