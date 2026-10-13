// "Oggi" dashboard and "Percorso" (learning path).
import { h, DAY } from '../util.js';
import { ringSVG } from '../charts.js';
import { SKILLS, content, lessonsFor } from '../content.js';
import { load, mastery, dueMistakes, openMistakes, minutesBetween, weekStart, activeDays } from '../store.js';
import { readiness, recommendedSession, levelBadge, SCORED, go, emptyContentNotice } from './common.js';
import { MOCKS } from '../mocks.js';

export function dashboard(root) {
  const S = load();
  const rd = readiness();
  const weekMin = minutesBetween(weekStart());
  const goal = S.settings.weeklyGoalMin || 180;
  const due = dueMistakes().length;
  root.append(emptyContentNotice() || '');

  if (!S.diag) {
    root.append(h('div', { class: 'cta' },
      h('div', {}, h('div', { class: 'cta-t' }, 'Primo passo: test diagnostico'), h('div', { class: 'muted' }, '40 domande, circa 45 minuti. Misura il punto di partenza e costruisce il piano.')),
      h('button', { class: 'primary', onclick: () => go('#/simulazioni/diag') }, 'Inizia')));
  }

  const kpis = h('div', { class: 'kpis' },
    kpi(ringSVG(rd.value, { label: `${Math.round(rd.value * 100)}`, sub: 'prontezza' }), 'Prontezza complessiva', `${rd.started}/${SCORED.length} aree iniziate`),
    kpi(h('div', { class: 'kpi-big' }, `${weekMin}′`), 'Minuti questa settimana', `obiettivo ${goal}′`, Math.min(1, weekMin / goal)),
    kpi(h('div', { class: 'kpi-big' }, `${activeDays(28)}`), 'Giorni attivi (28 gg)', 'costanza > intensità'),
    kpi(h('div', { class: 'kpi-big' + (due ? ' warn' : '') }, `${due}`), 'Errori da ripassare oggi', `${openMistakes().length} aperti nel quaderno`),
  );
  root.append(kpis);

  // upcoming real tests
  const evs = (S.events || []).filter(e => e.date && new Date(e.date).getTime() + DAY > Date.now()).sort((a, b) => a.date < b.date ? -1 : 1);
  if (evs.length) root.append(h('div', { class: 'events' }, evs.slice(0, 4).map(e => { const d = Math.ceil((new Date(e.date).getTime() - Date.now()) / DAY); return h('div', { class: 'event' + (d <= 3 ? ' soon' : '') }, h('b', {}, d <= 0 ? 'oggi' : `${d} gg`), h('span', {}, e.title)); })));

  // recommended session
  const steps = recommendedSession();
  const tot = steps.reduce((s, x) => s + (x.minutes || 0), 0);
  root.append(h('section', { class: 'card' },
    h('div', { class: 'card-h' }, h('h2', {}, 'Sessione consigliata'), h('span', { class: 'muted' }, `~${tot} min · si aggiorna dopo ogni esercizio`)),
    h('div', { class: 'steps' }, steps.map((s, i) => h('a', { class: 'step', href: s.href }, h('span', { class: 'step-n' }, String(i + 1)), h('div', {}, h('div', { class: 'step-t' }, s.title), h('div', { class: 'muted' }, s.sub)), h('span', { class: 'step-go' }, '→'))))));

  // skill grid
  const grid = h('div', { class: 'skill-grid' });
  for (const s of SKILLS.filter(x => x.id !== 'behavioural')) {
    const m = mastery(s.id);
    grid.append(h('a', { class: 'skill-card', href: `#/allenamento/${s.id}` },
      h('div', { html: ringSVG(m.score / 100, { size: 64, label: m.total ? `${m.score}` : '–', sub: '' }) }),
      h('div', {}, h('div', { class: 'sk-name' }, `${s.icon} ${s.short}`), levelBadge(m), h('div', { class: 'muted small' }, m.total ? `${Math.round(m.acc * 100)}% acc · ${m.timedN ? Math.round(m.speed * 100) + '% nel tempo' : 'no cronometro'}` : 'non iniziato'))));
  }
  root.append(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Le tue aree'), h('span', { class: 'muted' }, 'Bronzo ≥60% · Argento ≥75% e 60% nel tempo · Oro ≥85% e 80% nel tempo')), grid));
}

function kpi(visual, label, sub, frac) {
  return h('div', { class: 'kpi' }, typeof visual === 'string' ? h('div', { html: visual }) : visual, h('div', {}, h('div', { class: 'kpi-l' }, label), h('div', { class: 'muted small' }, sub), frac !== undefined ? h('div', { class: 'meter thin' }, h('i', { style: { width: `${frac * 100}%` } })) : ''));
}

export function path(root) {
  const S = load();
  const C = content();
  const ms = SCORED.map(s => ({ s, m: mastery(s.id) }));
  const lessonsTotal = C.lessons.length, lessonsRead = C.lessons.filter(l => S.lessonsRead[l.id]).length;
  const atLeast = k => ms.filter(x => x.m.level >= k).length;
  const mockIds = MOCKS.filter(m => !m.video && m.id !== 'diag').map(m => m.id);
  const passed = new Set((S.mocks || []).filter(m => !m.early && m.score >= (m.passMark || 0.7)).map(m => m.mockId));
  const stages = [
    { n: 1, t: 'Diagnostico', goal: 'Misura il livello di partenza', done: !!S.diag, prog: S.diag ? 1 : 0, label: S.diag ? 'fatto' : 'da fare', actions: [['Test diagnostico', '#/simulazioni/diag']] },
    { n: 2, t: 'Fondamenta', goal: 'Leggi le lezioni e porta ogni area a Bronzo (≥60%) in modalità impara', prog: (lessonsRead / Math.max(1, lessonsTotal) + atLeast(2) / ms.length) / 2, label: `${lessonsRead}/${lessonsTotal} lezioni · ${atLeast(2)}/${ms.length} aree a Bronzo`, actions: [['Lezioni', '#/lezioni'], ['Allenamento', '#/allenamento']] },
    { n: 3, t: 'Velocità', goal: 'Stesse domande, a ritmo da test: porta le aree ad Argento (≥75% e ≥60% nel tempo)', prog: atLeast(3) / ms.length, label: `${atLeast(3)}/${ms.length} aree ad Argento`, actions: [['Allenamento cronometrato', '#/allenamento']] },
    { n: 4, t: 'Simulazioni', goal: 'Supera le simulazioni complete e porta le aree a Oro', prog: (mockIds.filter(id => passed.has(id)).length / mockIds.length + atLeast(4) / ms.length) / 2, label: `${mockIds.filter(id => passed.has(id)).length}/${mockIds.length} simulazioni superate · ${atLeast(4)}/${ms.length} a Oro`, actions: [['Simulazioni', '#/simulazioni']] },
  ];
  root.append(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Il percorso'), h('span', { class: 'muted' }, 'Ogni fase sblocca la successiva; puoi comunque saltare avanti.')),
    h('div', { class: 'stages' }, stages.map(st => h('div', { class: 'stage' + (st.prog >= 1 ? ' done' : '') },
      h('div', { class: 'stage-n' }, st.prog >= 1 ? '✓' : String(st.n)),
      h('div', { class: 'stage-b' }, h('div', { class: 'stage-t' }, st.t), h('div', { class: 'muted' }, st.goal), h('div', { class: 'meter' }, h('i', { style: { width: `${Math.round(st.prog * 100)}%` } })), h('div', { class: 'small muted' }, st.label),
        h('div', { class: 'stage-a' }, st.actions.map(([t, href]) => h('a', { class: 'ghost small btnlink', href }, t)))))))));

  root.append(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Piano del weekend'), h('span', { class: 'muted' }, '2 × 90 minuti')),
    h('div', { class: 'plan' },
      planDay('Sabato', [['20′', 'Ripasso errori + calcolo mentale (riscaldamento)'], ['40′', 'Area più debole: lezione se sotto Bronzo, poi 2 set da 12'], ['30′', 'Tecnico: accounting / valuation × 15']]),
      planDay('Domenica', [['15′', 'Ripasso errori'], ['45′', 'Una simulazione completa (alterna numerical, verbal, Cappfinity, BofA)'], ['20′', '2 risposte in video + storia STAR da rifinire'], ['10′', 'Leggi gli errori della simulazione: la spiegazione conta più del punteggio']]))));

  root.append(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Dove sei per area')),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'data-table compact' }, h('thead', {}, h('tr', {}, ['Area', 'Livello', 'Accuratezza', 'Nel tempo', 'Domande', 'Lezioni'].map(t => h('th', {}, t)))),
      h('tbody', {}, ms.map(({ s, m }) => { const ls = lessonsFor(s.id); return h('tr', {}, h('td', {}, h('a', { href: `#/allenamento/${s.id}` }, `${s.icon} ${s.name}`)), h('td', {}, levelBadge(m)), h('td', { class: 'num' }, m.total ? `${Math.round(m.acc * 100)}%` : '–'), h('td', { class: 'num' }, m.timedN ? `${Math.round(m.speed * 100)}%` : '–'), h('td', { class: 'num' }, String(m.total)), h('td', { class: 'num' }, ls.length ? `${ls.filter(l => S.lessonsRead[l.id]).length}/${ls.length}` : '–')); }))))));
}

function planDay(t, rows) {
  return h('div', { class: 'plan-day' }, h('div', { class: 'plan-t' }, t), rows.map(([m, d]) => h('div', { class: 'plan-row' }, h('b', {}, m), h('span', {}, d))));
}
