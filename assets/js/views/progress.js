// Progress charts, diagnostic baseline vs now, history; data backup and settings.
import { h, fmtTime, DAY } from '../util.js';
import { progressSVG } from '../charts.js';
import { SKILLS, SKILL } from '../content.js';
import { load, save, mastery, dailySeries, exportJSON, importJSON, resetAll, upsert, remove, storageAvailable } from '../store.js';
import { levelBadge, SCORED } from './common.js';

export function progressView(root, q) {
  const S = load();
  const sel = q.skill || '';
  root.append(h('div', { class: 'page-h' }, h('h1', {}, 'Progressi'), h('span', { class: 'muted' }, `${S.attempts.length} risposte registrate dal ${new Date(S.created).toLocaleDateString('it-IT')}`)));
  if (!storageAvailable()) root.append(h('div', { class: 'notice' }, 'Il browser non permette di salvare i progressi (modalità privata?). Esporta un backup in Dati.'));

  // baseline vs now
  if (S.diag) {
    const rows = SCORED.filter(s => S.diag.perSkill[s.id] !== undefined).map(s => ({ s, base: S.diag.perSkill[s.id], now: mastery(s.id) }));
    root.append(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Punto di partenza → oggi'), h('span', { class: 'muted' }, `diagnostico del ${new Date(S.diag.t).toLocaleDateString('it-IT')}`)),
      h('div', { class: 'bvn' }, rows.map(({ s, base, now }) => {
        const n = now.total ? now.acc : base; const d = Math.round((n - base) * 100);
        return h('div', { class: 'bvn-row' }, h('span', {}, `${s.icon} ${s.short}`), h('div', { class: 'bvn-bars' }, h('div', { class: 'meter base' }, h('i', { style: { width: `${base * 100}%` } })), h('div', { class: 'meter' }, h('i', { style: { width: `${n * 100}%` } }))), h('b', { class: d > 0 ? 'ok' : d < 0 ? 'ko' : '' }, `${Math.round(base * 100)}% → ${Math.round(n * 100)}% (${d > 0 ? '+' : ''}${d})`));
      }))));
  }

  // chart
  const chooser = h('div', { class: 'chips-row' }, [['', 'Tutte le aree'], ...SKILLS.map(s => [s.id, s.short])].map(([k, t]) => h('a', { class: 'chip' + (k === sel ? ' on' : ''), href: `#/progressi${k ? `?skill=${k}` : ''}` }, t)));
  const ser = dailySeries(sel || null, 90);
  root.append(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Accuratezza e velocità per giorno'), h('span', { class: 'muted' }, 'blu = accuratezza · giallo = % giuste nel tempo · verde tratteggiato = obiettivo 75%')), chooser,
    h('div', { html: progressSVG([{ points: ser.map(p => ({ d: p.d, v: p.acc })), color: '#5aa9ff' }, { points: ser.map(p => ({ d: p.d, v: p.speed })), color: '#f5b453' }], { target: 0.75 }) })));

  // mastery table
  root.append(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Livelli')),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'data-table compact' }, h('thead', {}, h('tr', {}, ['Area', 'Livello', 'Punteggio', 'Accuratezza', 'Nel tempo', 'Totale'].map(t => h('th', {}, t)))),
      h('tbody', {}, SKILLS.map(s => { const m = mastery(s.id); return h('tr', {}, h('td', {}, `${s.icon} ${s.name}`), h('td', {}, levelBadge(m)), h('td', { class: 'num' }, m.total ? String(m.score) : '–'), h('td', { class: 'num' }, m.total ? `${Math.round(m.acc * 100)}%` : '–'), h('td', { class: 'num' }, m.timedN ? `${Math.round(m.speed * 100)}%` : '–'), h('td', { class: 'num' }, String(m.total))); }))))));

  // sessions history
  const sess = (S.sessions || []).slice(-15).reverse();
  if (sess.length) root.append(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Ultime sessioni')),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'data-table compact' }, h('thead', {}, h('tr', {}, ['Quando', 'Tipo', 'Area', 'Risultato', 'Tempo'].map(t => h('th', {}, t)))),
      h('tbody', {}, sess.map(x => h('tr', {}, h('td', {}, new Date(x.t).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })), h('td', {}, x.kind), h('td', {}, x.skill ? (SKILL[x.skill] || {}).short || x.skill : '–'), h('td', { class: 'num' }, x.n ? `${x.correct}/${x.n}` : (x.score !== undefined ? `${Math.round(x.score * 100)}%` : '–')), h('td', { class: 'num' }, fmtTime(x.ms || 0)))))))));
}

export function dataView(root) {
  const S = load();
  root.append(h('div', { class: 'page-h' }, h('h1', {}, 'Dati e impostazioni'), h('span', { class: 'muted' }, 'Tutto resta in questo browser. Esporta un backup ogni tanto.')));
  // events
  const evBox = h('div', { class: 'stories' });
  const renderEv = () => {
    evBox.innerHTML = '';
    for (const e of load().events) evBox.append(h('div', { class: 'ev-row' }, h('input', { value: e.title || '', placeholder: 'es. HSBC Job Simulation', oninput: x => { e.title = x.target.value; upsert('events', e); } }), h('input', { type: 'date', value: e.date || '', oninput: x => { e.date = x.target.value; upsert('events', e); } }), h('button', { class: 'ghost small', onclick: () => { remove('events', e.id); renderEv(); } }, '✕')));
    evBox.append(h('button', { class: 'ghost small', onclick: () => { upsert('events', { title: '', date: '' }); renderEv(); } }, '+ Aggiungi scadenza'));
  };
  renderEv();
  root.append(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Le mie scadenze'), h('span', { class: 'muted' }, 'compaiono con il conto alla rovescia nella dashboard')), evBox));
  // goal
  const goal = h('input', { type: 'number', min: 30, step: 30, value: S.settings.weeklyGoalMin || 180, oninput: e => { S.settings.weeklyGoalMin = Number(e.target.value) || 180; save(); } });
  root.append(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Obiettivo settimanale (minuti)')), goal));
  // backup
  const file = h('input', { type: 'file', accept: 'application/json', class: 'hidden', onchange: async e => { const f = e.target.files[0]; if (!f) return; try { importJSON(await f.text()); alertBox.textContent = 'Backup importato.'; } catch (err) { alertBox.textContent = 'Errore: ' + err.message; } } });
  const alertBox = h('div', { class: 'muted small' });
  root.append(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Backup')),
    h('div', { class: 'row-start' },
      h('button', { class: 'primary', onclick: () => { const blob = new Blob([exportJSON()], { type: 'application/json' }); const a = h('a', { href: URL.createObjectURL(blob), download: `analyst-gym-backup-${new Date().toISOString().slice(0, 10)}.json` }); document.body.append(a); a.click(); a.remove(); } }, 'Esporta backup'),
      h('button', { class: 'ghost', onclick: () => file.click() }, 'Importa backup'), file,
      h('button', { class: 'ghost danger', onclick: () => { if (window.confirm('Cancellare tutti i progressi da questo browser?')) { resetAll(); location.hash = '#/oggi'; } } }, 'Azzera tutto')),
    alertBox, h('p', { class: 'muted small' }, 'Per usare il sito su un altro computer: esporta qui e importa là.')));
}
