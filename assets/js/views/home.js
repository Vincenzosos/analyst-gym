// "Today": weekly mission, recommended session, this week's wrap, areas. "Progress": path, charts, levels.
import { h, DAY, fmtTime, rng } from '../util.js';
import { ringSVG, progressSVG } from '../charts.js';
import { SKILLS, SKILL, GROUPS, content, lessonsFor } from '../content.js';
import { load, mastery, dueMistakes, openMistakes, minutesBetween, weekStart, activeDays, dailySeries, storageAvailable } from '../store.js';
import { readiness, recommendedSession, levelBadge, skillTag, SCORED, emptyContentNotice, tabs, GROUP_TONE, toneOf, themeTone } from './common.js';
import { currentMission, missionHistory, streak, intensity, weekNumber } from '../mission.js';
import { weekThemes, recentHeadlines, news, dateShort } from '../news.js';
import { MOCKS } from '../mocks.js';

const LOCALE = 'en-GB';

export function homeView(root, sub, q) {
  root.append(tabs([['today', 'Today', '#/today'], ['progress', 'Progress', '#/today/progress']], sub === 'progress' ? 'progress' : 'today'));
  if (sub === 'progress') { root.append(h('h1', { class: 'sr-only' }, 'Progress')); return progress(root, q); }
  return dashboard(root);
}

function dashboard(root) {
  const S = load();
  root.append(emptyContentNotice() || '');
  const M = currentMission();
  const steps = recommendedSession();
  const evs = (S.events || []).filter(e => e.date && new Date(e.date).getTime() + DAY > Date.now()).sort((a, b) => a.date < b.date ? -1 : 1);
  const nextEv = evs[0];
  const evDays = nextEv ? Math.ceil((new Date(nextEv.date).getTime() - Date.now()) / DAY) : null;

  // hero
  const first = steps[0];
  root.append(h('section', { class: 'hero' },
    h('div', { class: 'hero-l' },
      h('div', { class: 'kicker' }, `Week ${weekNumber()} · ${M.daysLeft === 1 ? 'last day' : `${M.daysLeft} days left`}${nextEv ? ` · ${nextEv.title || 'deadline'} ${evDays <= 0 ? 'today' : `in ${evDays} days`}` : ''}`),
      h('h1', { class: 'display xl' }, 'Mission ', h('span', { class: 'hl' }, `${M.done}/${M.total}`)),
      h('p', { class: 'hero-sub' }, !S.diag ? 'Start with the diagnostic: 40 questions, about 45 minutes. It measures every area and the plan starts from there. Then, every week, a fixed quota: tests, technicals, news, general knowledge, a mock, video.' : M.complete ? 'This week’s mission is complete. Every extra question raises your level: keep going on your weakest areas.' : 'A fixed quota every week: tests, technicals, news, general knowledge, a mock, video. It counts itself: the only way to tick it off is to do the work.'),
      h('div', { class: 'hero-bar' }, h('i', { style: { width: `${M.done / M.total * 100}%` } })),
      h('div', { class: 'hero-cta' },
        first ? h('a', { class: 'btn primary big', href: first.href }, h('span', { class: 'cta-txt' }, S.diag ? `Continue: ${first.title}` : 'Start with the diagnostic test'), h('span', { class: 'arrow' }, '→')) : '',
        h('button', { class: 'btn ghost', onclick: () => document.getElementById('mission').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }) }, 'See the mission'))),
    h('div', { class: 'hero-r' }, weeksStrip()),
    h('div', { class: 'hero-art', html: heroArt(M.done / M.total) })));

  // mission + session
  const tasks = h('div', { class: 'tasks' }, M.tasks.map(t => h('a', { class: `task tone-${t.tone || 'indigo'}` + (t.done ? ' done' : ''), href: t.href, title: t.why },
    h('span', { class: 'task-dot' }, t.done ? '✓' : ''),
    h('div', { class: 'task-b' }, h('div', { class: 'task-t' }, t.title), h('div', { class: 'task-l' }, t.label), h('div', { class: 'meter thin' }, h('i', { style: { width: `${t.frac * 100}%` } }))),
    h('span', { class: 'go' }, '→'))));
  const rd = readiness();
  const weekMin = minutesBetween(weekStart());
  const goal = intensity().minutes;
  const due = dueMistakes().length;
  root.append(h('div', { class: 'grid-2' },
    h('section', { class: 'card', id: 'mission' }, h('div', { class: 'card-h' }, h('h2', {}, 'This week’s mission'), h('a', { class: 'muted small', href: '#/settings' }, `${intensity().label.toLowerCase()} intensity ›`)), tasks),
    h('div', { class: 'stack' },
      h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Recommended session'), h('span', { class: 'muted small' }, `~${steps.reduce((s, x) => s + (x.minutes || 0), 0)} min`)),
        h('div', { class: 'steps' }, steps.map((s, i) => h('a', { class: 'step', href: s.href }, h('span', { class: 'step-n' }, String(i + 1).padStart(2, '0')), h('div', { class: 'step-b' }, h('div', { class: 'step-t' }, s.title), h('div', { class: 'muted small' }, s.sub)), h('span', { class: 'go' }, '→'))))),
      h('div', { class: 'kpis' },
        kpi(h('div', { class: 'kpi-ring', html: ringSVG(rd.value, { size: 56, label: `${Math.round(rd.value * 100)}` }) }), 'Readiness', `${rd.started}/${SCORED.length} areas started`),
        kpi(h('div', { class: 'kpi-big' }, `${weekMin}′`), 'Minutes this week', `target ${goal}′`, Math.min(1, weekMin / goal)),
        kpi(h('div', { class: 'kpi-big' }, `${activeDays(28)}`), 'Active days', 'last 4 weeks'),
        kpi(h('div', { class: 'kpi-big' + (due ? ' warn' : '') }, `${due}`), 'Mistakes due', `${openMistakes().length} open`)))));

  root.append(newsTeaser());

  GROUPS.forEach((g, gi) => {
    const list = SKILLS.filter(s => s.group === g);
    root.append(h('section', { class: `card tone-${GROUP_TONE[g]}` }, h('div', { class: 'card-h' }, h('h2', {}, g), gi === 0 ? h('span', { class: 'muted small' }, 'Bronze ≥60% · Silver ≥75% and 60% on time · Gold ≥85% and 80% on time') : ''),
      h('div', { class: 'skill-grid' }, list.map(s => skillCard(s)))));
  });
}

export function skillCard(s) {
  const m = mastery(s.id);
  return h('a', { class: `skill-card ${toneOf(s)}`, href: `#/train/${s.id}` },
    h('div', { class: 'sk-ring', html: ringSVG(m.score / 100, { size: 56, label: m.total ? `${m.score}` : '–' }) }),
    h('div', { class: 'sk-b' }, h('div', { class: 'sk-name' }, skillTag(s), h('span', {}, s.short)), levelBadge(m), h('div', { class: 'muted small' }, m.total ? `${Math.round(m.acc * 100)}% accuracy · ${m.timedN ? Math.round(m.speed * 100) + '% on time' : 'never timed'}` : 'not started')));
}

// Decorative rising line behind the hero; its end height follows the mission progress.
function heroArt(frac) {
  const r = rng(weekNumber() * 7919 + 13);
  const n = 48, pts = [];
  let y = 82;
  const end = 78 - 58 * frac;
  for (let i = 0; i <= n; i++) {
    const pull = (end - y) / Math.max(1, n - i) * 0.9;
    y = Math.max(12, Math.min(90, y + pull + (r() - 0.5) * 9));
    pts.push(`${(i / n * 1000).toFixed(1)},${y.toFixed(1)}`);
  }
  const d = 'M' + pts.join(' L');
  return `<svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="haf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".22"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient><linearGradient id="has" x1="0" x2="1"><stop offset="0" stop-color="#A5F3FC"/><stop offset="1" stop-color="#FDE68A"/></linearGradient></defs><path d="${d} L1000,100 L0,100 Z" fill="url(#haf)"/><path class="hero-line" pathLength="1" d="${d}" fill="none" stroke="url(#has)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

function kpi(visual, label, sub, frac) {
  return h('div', { class: 'kpi' }, visual, h('div', { class: 'kpi-txt' }, h('div', { class: 'kpi-l' }, label), h('div', { class: 'muted small' }, sub), frac !== undefined ? h('div', { class: 'meter thin' }, h('i', { style: { width: `${frac * 100}%` } })) : ''));
}

function weeksStrip() {
  const hist = missionHistory(8);
  const M = currentMission();
  const st = streak();
  const past = hist.map(w => ({ ...w, cur: false }));
  const pad = Array.from({ length: Math.max(0, 7 - past.length) }, () => ({ empty: true }));
  const cells = [...pad, ...past, { from: M.from, done: M.done, total: M.total, cur: true }];
  return h('div', { class: 'weeks' },
    h('div', { class: 'weeks-h' }, h('span', { class: 'kicker' }, 'Weeks'), h('span', { class: 'streak' }, `streak: ${st}`)),
    h('div', { class: 'weeks-row' }, cells.map(w => {
      if (w.empty) return h('div', { class: 'wk empty', title: 'Not started yet' }, h('div', { class: 'wk-bar' }), h('span', {}, '·'));
      const f = w.done / w.total;
      const cls = w.cur ? 'cur' : f === 1 ? 'full' : f >= 0.5 ? 'half' : 'miss';
      return h('div', { class: `wk ${cls}`, title: `${new Date(w.from).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' })}: ${w.done}/${w.total}` }, h('div', { class: 'wk-bar' }, h('i', { style: { height: `${Math.max(6, f * 100)}%` } })), h('span', {}, w.cur ? 'now' : `${w.done}`));
    })),
    h('div', { class: 'muted small' }, hist.some(w => w.done < w.total) ? 'Incomplete weeks stay visible.' : 'Complete every week to grow your streak.'));
}

function newsTeaser() {
  const N = news();
  if (!N.headlines.length) return '';
  const themes = weekThemes(7).slice(0, 5);
  const top = recentHeadlines(4).filter(x => x.themes.length).slice(0, 5);
  const S = load();
  return h('section', { class: 'card news-teaser' },
    h('div', { class: 'card-h' }, h('h2', {}, 'This week in the world'), h('a', { class: 'btn primary small', href: '#/news' }, 'Weekly wrap in 2 min →')),
    themes.length ? h('div', { class: 'theme-row' }, themes.map(({ c, items }) => h('a', { class: `theme-pill ${themeTone(c.theme)}`, href: `#/news/themes?c=${c.id}` }, h('b', {}, c.title), h('span', {}, `${items.length}`)))) : '',
    h('div', { class: 'hl-list' }, top.map(x => h('a', { class: 'hl-row' + (S.newsRead[x.id] ? ' read' : ''), href: '#/news/brief' }, h('span', { class: 'hl-src' }, x.source), h('span', { class: 'hl-t' }, x.title), h('span', { class: 'hl-d' }, dateShort(x.t))))));
}

// ---------- progress ----------
function progress(root, q) {
  const S = load();
  const C = content();
  if (!storageAvailable()) root.append(h('div', { class: 'notice' }, 'This browser does not allow saving progress (private mode?). Export a backup in ⚙ Settings.'));
  const ms = SCORED.map(s => ({ s, m: mastery(s.id) }));
  const lessonsTotal = C.lessons.length, lessonsRead = C.lessons.filter(l => S.lessonsRead[l.id]).length;
  const atLeast = k => ms.filter(x => x.m.level >= k).length;
  const mockIds = MOCKS.filter(m => !m.video && m.id !== 'diag').map(m => m.id);
  const passed = new Set((S.mocks || []).filter(m => !m.early && m.score >= (m.passMark || 0.7)).map(m => m.mockId));
  const nPassed = mockIds.filter(id => passed.has(id)).length;
  const stages = [
    { n: 1, t: 'Diagnostic', goal: 'Measure your starting level', prog: S.diag ? 1 : 0, label: S.diag ? 'done' : 'to do', href: '#/mocks/diag' },
    { n: 2, t: 'Foundations', goal: 'Lessons read and every area at Bronze (≥60%) in learn mode', prog: (lessonsRead / Math.max(1, lessonsTotal) + atLeast(2) / ms.length) / 2, label: `${lessonsRead}/${lessonsTotal} lessons · ${atLeast(2)}/${ms.length} at Bronze`, href: '#/train' },
    { n: 3, t: 'Speed', goal: 'Test pace: areas at Silver (≥75% and ≥60% on time)', prog: atLeast(3) / ms.length, label: `${atLeast(3)}/${ms.length} at Silver`, href: '#/train' },
    { n: 4, t: 'Mocks', goal: 'Pass every mock test and take the areas to Gold', prog: (nPassed / mockIds.length + atLeast(4) / ms.length) / 2, label: `${nPassed}/${mockIds.length} passed · ${atLeast(4)}/${ms.length} at Gold`, href: '#/mocks' },
  ];
  root.append(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'The path'), h('span', { class: 'muted small' }, `${S.attempts.length} answers since ${new Date(S.created).toLocaleDateString(LOCALE)}`)),
    h('div', { class: 'stages' }, stages.map(st => h('a', { class: 'stage' + (st.prog >= 1 ? ' done' : ''), href: st.href },
      h('div', { class: 'stage-n' }, st.prog >= 1 ? '✓' : String(st.n).padStart(2, '0')),
      h('div', { class: 'stage-t' }, st.t), h('div', { class: 'muted small' }, st.goal),
      h('div', { class: 'meter' }, h('i', { style: { width: `${Math.round(st.prog * 100)}%` } })), h('div', { class: 'small stage-l' }, st.label))))));

  root.append(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Weekend plan'), h('span', { class: 'muted small' }, 'two sessions of about 95 minutes cover the whole mission')),
    h('div', { class: 'plan' },
      planDay('Saturday', [['15′', 'Review the mistakes that are due'], ['10′', 'Weekly wrap (2 min), then read 3 headlines and write 1 commercial awareness note'], ['40′', 'Online tests, weakest area: lesson if below Bronze, then 2 sets'], ['25′', 'Technicals: accounting, valuation, M&A, LBO']]),
      planDay('Sunday', [['15′', 'News and markets quiz (real data from the last weeks)'], ['15′', 'General knowledge'], ['45′', 'One full mock, then read the explanation of every mistake'], ['15′', '2 video answers, one of them the market update']]))));

  if (S.diag) {
    const rows = SCORED.filter(s => S.diag.perSkill[s.id] !== undefined).map(s => ({ s, base: S.diag.perSkill[s.id], now: mastery(s.id) }));
    root.append(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Starting point → today'), h('span', { class: 'muted small' }, `diagnostic of ${new Date(S.diag.t).toLocaleDateString(LOCALE)}`)),
      h('div', { class: 'bvn' }, rows.map(({ s, base, now }) => {
        const n = now.total ? now.acc : base; const d = Math.round((n - base) * 100);
        return h('div', { class: 'bvn-row' }, h('span', { class: 'sk-name' }, skillTag(s), h('span', {}, s.short)), h('div', { class: 'bvn-bars' }, h('div', { class: 'meter base' }, h('i', { style: { width: `${base * 100}%` } })), h('div', { class: 'meter' }, h('i', { style: { width: `${n * 100}%` } }))), h('b', { class: d > 0 ? 'ok' : d < 0 ? 'ko' : '' }, `${Math.round(base * 100)}% → ${Math.round(n * 100)}% (${d > 0 ? '+' : ''}${d})`));
      }))));
  }

  const sel = q.skill || '';
  const chooser = h('div', { class: 'chips-row' }, [['', 'All'], ...SKILLS.map(s => [s.id, s.short])].map(([k, t]) => h('a', { class: 'chip' + (k === sel ? ' on' : ''), href: `#/today/progress${k ? `?skill=${k}` : ''}` }, t)));
  const ser = dailySeries(sel || null, 90);
  root.append(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Accuracy and speed by day'), h('span', { class: 'legend-inline' }, h('i', { class: 'lg violet' }), 'accuracy', h('i', { class: 'lg cyan' }), 'correct on time', h('i', { class: 'lg dash' }), 'target 75%')), chooser,
    h('div', { html: progressSVG([{ points: ser.map(p => ({ d: p.d, v: p.acc })), color: '#5B4BF5' }, { points: ser.map(p => ({ d: p.d, v: p.speed })), color: '#0E9F9A' }], { target: 0.75 }) })));

  root.append(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Levels by area')),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'data-table compact' }, h('thead', {}, h('tr', {}, [['Area', ''], ['Level', ''], ['Score', 'num'], ['Accuracy', 'num'], ['On time', 'num'], ['Questions', 'num'], ['Lessons', 'num']].map(([t, c]) => h('th', { class: c }, t)))),
      h('tbody', {}, SKILLS.map(s => { const m = mastery(s.id); const ls = lessonsFor(s.id); return h('tr', {}, h('td', {}, h('a', { href: `#/train/${s.id}` }, s.name)), h('td', {}, levelBadge(m)), h('td', { class: 'num' }, m.total ? String(m.score) : '–'), h('td', { class: 'num' }, m.total ? `${Math.round(m.acc * 100)}%` : '–'), h('td', { class: 'num' }, m.timedN ? `${Math.round(m.speed * 100)}%` : '–'), h('td', { class: 'num' }, String(m.total)), h('td', { class: 'num' }, ls.length ? `${ls.filter(l => S.lessonsRead[l.id]).length}/${ls.length}` : '–')); }))))));

  const sess = (S.sessions || []).slice(-15).reverse();
  const KIND = { drill: 'Practice', review: 'Review', video: 'Video', news: 'News' };
  if (sess.length) root.append(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Recent sessions')),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'data-table compact' }, h('thead', {}, h('tr', {}, [['When', ''], ['Type', ''], ['Area', ''], ['Result', 'num'], ['Time', 'num']].map(([t, c]) => h('th', { class: c }, t)))),
      h('tbody', {}, sess.map(x => h('tr', {}, h('td', {}, new Date(x.t).toLocaleString(LOCALE, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })), h('td', {}, KIND[x.kind] || x.kind), h('td', {}, x.skill ? (SKILL[x.skill] || {}).short || x.skill : '–'), h('td', { class: 'num' }, x.n ? `${x.correct}/${x.n}` : (x.score !== undefined ? `${Math.round(x.score * 100)}%` : '–')), h('td', { class: 'num' }, fmtTime(x.ms || 0)))))))));
}

function planDay(t, rows) {
  return h('div', { class: 'plan-day' }, h('div', { class: 'plan-t' }, t), rows.map(([m, d]) => h('div', { class: 'plan-row' }, h('b', {}, m), h('span', {}, d))));
}
