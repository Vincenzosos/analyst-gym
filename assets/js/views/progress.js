// Settings and data: mission intensity, real test deadlines, backup, reset.
import { h } from '../util.js';
import { load, save, exportJSON, importJSON, resetAll, upsert, remove, storageAvailable } from '../store.js';
import { pageHead } from './common.js';
import { INTENSITY } from '../mission.js';

export function dataView(root) {
  const S = load();
  root.append(pageHead({ kicker: 'Settings', title: 'Data and', accent: 'settings', sub: 'Everything stays in this browser: no account, no server. Export a backup now and then.' }));
  if (!storageAvailable()) root.append(h('div', { class: 'notice' }, 'This browser does not allow saving progress (private mode?). Export a backup before closing.'));

  // mission intensity
  const seg = h('div', { class: 'seg' });
  const paint = () => [...seg.children].forEach(b => b.classList.toggle('on', b.dataset.v === (S.settings.intensity || 'standard')));
  Object.entries(INTENSITY).forEach(([k, v]) => seg.append(h('button', { 'data-v': k, onclick: () => { S.settings.intensity = k; save(); paint(); } }, `${v.label} · ~${v.minutes}′`)));
  paint();
  root.append(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Weekly mission intensity')),
    seg, h('p', { class: 'muted small' }, 'Scales the weekly quotas (questions, headlines, videos). The full mock and the note stay compulsory at every level.')));

  // events
  const evBox = h('div', { class: 'stories' });
  const renderEv = () => {
    evBox.innerHTML = '';
    for (const e of load().events) evBox.append(h('div', { class: 'ev-row' }, h('input', { value: e.title || '', placeholder: 'e.g. HSBC Job Simulation', 'aria-label': 'Deadline name', oninput: x => { e.title = x.target.value; upsert('events', e); } }), h('input', { type: 'date', value: e.date || '', 'aria-label': 'Date', oninput: x => { e.date = x.target.value; upsert('events', e); } }), h('button', { class: 'btn ghost small', 'aria-label': 'Remove', onclick: () => { remove('events', e.id); renderEv(); } }, '✕')));
    evBox.append(h('button', { class: 'btn ghost small', onclick: () => { upsert('events', { title: '', date: '' }); renderEv(); } }, '+ Add a deadline'));
  };
  renderEv();
  root.append(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'My deadlines'), h('span', { class: 'muted small' }, 'real tests and interviews: they appear with a countdown on Today')), evBox));

  // backup
  const alertBox = h('div', { class: 'muted small' });
  const file = h('input', { type: 'file', accept: 'application/json', class: 'hidden', onchange: async e => { const f = e.target.files[0]; if (!f) return; try { importJSON(await f.text()); alertBox.textContent = 'Backup imported. Reloading…'; setTimeout(() => location.reload(), 600); } catch (err) { alertBox.textContent = 'Error: ' + err.message; } } });
  root.append(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Backup')),
    h('div', { class: 'row-start' },
      h('button', { class: 'btn primary', onclick: () => { const blob = new Blob([exportJSON()], { type: 'application/json' }); const a = h('a', { href: URL.createObjectURL(blob), download: `analyst-gym-backup-${new Date().toISOString().slice(0, 10)}.json` }); document.body.append(a); a.click(); a.remove(); } }, 'Export backup'),
      h('button', { class: 'btn ghost', onclick: () => file.click() }, 'Import backup'), file,
      h('button', { class: 'btn ghost danger', onclick: () => { if (window.confirm('Delete all progress from this browser?')) { resetAll(); location.hash = '#/today'; } } }, 'Reset everything')),
    alertBox, h('p', { class: 'muted small' }, 'To use the site on another device: export here and import there. Video recordings are never saved or sent anywhere.')));
}
