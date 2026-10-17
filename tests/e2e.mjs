#!/usr/bin/env node
// End-to-end browser tests for Analyst Gym: drives the real site in headless Google Chrome
// through the Chrome DevTools Protocol. Zero npm dependencies (Node >= 22, python3, Chrome).
//
//   npm run e2e                         # everything
//   node tests/e2e.mjs --list           # list scenarios
//   node tests/e2e.mjs --only drill:    # scenarios whose name contains "drill:" (comma separated or repeated)
//   node tests/e2e.mjs --only smoke -v  # legacy-route smoke run with step logging
//   node tests/e2e.mjs --help
//
// Screenshots and the JSON report go to tests/out/ (git-ignored).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CDP, Page, freePort, startStaticServer, launchChrome, cleanupAll, cleanupSync, sleep, slug } from './e2e-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ===========================================================================
// CONFIG: every selector, text and route the tests depend on lives here.
// Regex-like strings (…Text) are case-insensitive RegExp sources.
// ===========================================================================
export const CONFIG = {
  root: ROOT,
  outDir: path.join(ROOT, 'tests', 'out'),
  chromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  chromeExtraArgs: [
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', // video room never blocks on a permission prompt
    '--mute-audio', '--hide-scrollbars', '--force-color-profile=srgb',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--window-size=1280,900',
  ],
  overallTimeoutMs: 20 * 60 * 1000,
  scenarioTimeoutMs: 3 * 60 * 1000,
  viewports: {
    desktop: { name: 'desktop', width: 1280, height: 900, dpr: 1, mobile: false },
    mobile: { name: 'mobile', width: 375, height: 812, dpr: 2, mobile: true },
  },

  // ----- generic checks (run per route / per viewport) -----
  minMainText: 50,                       // main.innerText must be longer than this unless the route allows short
  externalRequestFailures: 'warn',       // 'warn' | 'fail' for failed requests to other origins (e.g. Google Fonts offline)
  ignoreRequests: [/\/favicon\.ico$/],
  ignoreConsole: [],
  acceptDialogs: true,                   // confirm()/alert() are auto-accepted and reported as warnings
  badText: [/\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /\bnull%/, /\bInfinity\b/, /\u2014/], // visible body text; last = em dash
  badMainText: [/^Errore: /m, /^Error: /m, /Contenuti non caricati/, /Some content did not load/, /\b(area|lezione|simulazione|pagina|sezione|esercizio|notizia|news) non trovat[ao]\b/i, /\b(area|lesson|mock|page|section) not found\b/i],

  selectors: {
    main: '#main',
    loading: '.loading',
    nav: 'header a[href^="#/"], nav a[href^="#/"], .tabbar a[href^="#/"]',
    menuToggle: '.menu-toggle, .burger, button[aria-label*="menu" i], [data-test="menu"]',
    mistakeEntry: '.review-list .rev, [data-test="mistake"]',
  },

  // ----- quiz engine (assets/js/quiz.js) -----
  quiz: {
    stage: '.quiz-stage',
    stageWithin: '.quiz-stage',          // container used for option / input clicks
    stem: '.stem',
    progress: '.quiz-prog',
    option: '.opt',                      // mcq and True/False/Cannot say buttons
    numericInput: '.num-in',
    numericSubmit: '.num-row button.primary',
    sjtGrid: '.sjt-grid',
    sjtPick: '.pick',                    // per option: [most, least]
    confirmText: '^(Conferma|Confirm)',
    verdict: '.verdict',                 // + .ok | .ko | .mid
    expl: '.expl',
    explSteps: 'ol li',                  // inside .expl
    explToggleText: '^((Vedi|Mostra) (la )?spiegazione|Show explanation)',
    hintButton: '.hintbtn',
    hintText: '^((mostra (un )?)?suggerimento|show a hint)',
    hint: '.hint',
    nextText: '^(Avanti|Vedi risultato|Continua|Prossima|Next|See result)',
    startText: '^(▶\\s*)?(Inizia|Comincia|Start)',
    quitText: '^(Termina|End)$',
    report: '.report-hero',
    contentModule: 'assets/js/content.js', // used only to answer {correct:true/false} for bank items
    allowHashChange: [],                 // RegExps of hashes a quiz may move to without failing runQuiz
    mockShowsFeedback: false,            // mocks must not show verdicts before the end
    timedShowsExplanation: true,         // timed drills show the explanation after each answer
  },

  lesson: {
    exampleToggle: '.example button, [data-test="example-toggle"]',
    exampleToggleText: '(soluzione|solution)',
  },

  news: {
    dataPaths: ['data/news/headlines.json', 'data/news/markets.json'],
    dataUrlRe: /\/data\/news\/(headlines|markets)[^/?#]*\.json/i,
    headline: '.hl-item, .news-item, [data-test="headline"]',
    marketCard: '.mkt, .market-card, [data-test="market"]',
    // links on #/news/practice that start a news exercise set (followed when the page itself is not a quiz)
    exerciseLinkRe: /^#\/(news\/practice\?|train\/[^/?]+\?mode=)/,
    maxExerciseSets: 6,
  },

  storage: {
    key: 'analystgym.v1',
    // page function: make every open mistake due now; returns how many entries were touched
    makeAllMistakesDue: (key) => {
      const s = JSON.parse(localStorage.getItem(key) || 'null');
      if (!s || !s.srs) return 0;
      let n = 0;
      for (const e of Object.values(s.srs)) { if (!e.done) { e.due = 0; n++; } }
      localStorage.setItem(key, JSON.stringify(s));
      return n;
    },
  },

  // Trainable skills. Union of this list and SKILLS exported by assets/js/content.js (minus skillsExclude).
  skills: ['numerical', 'mental', 'verbal', 'logical', 'inductive', 'sjt', 'fin-acc', 'fin-val', 'fin-ma', 'fin-lbo', 'markets', 'commercial'],
  skillsExclude: ['behavioural', 'workstyle'],
  mobileDrillSkills: ['numerical', 'verbal', 'inductive', 'sjt'],
  mockIds: ['diag', 'shl-num', 'shl-verb', 'inductive', 'capp', 'bofa', 'tech', 'tmt', 'video'],
  videoMocks: ['video'],
  drillSize: 5,
  maxDiscoveredLinks: 60,

  // Old hashes must land on these (string = exact, RegExp = pattern). {lesson} = a real lesson id.
  redirects: [
    { from: '#/oggi', to: '#/today' },
    { from: '#/percorso', to: '#/today/progress' },
    { from: '#/lezioni', to: '#/train/lessons' },
    { from: '#/lezioni/{lesson}', to: '#/train/lesson/{lesson}' },
    { from: '#/allenamento', to: '#/train' },
    { from: '#/allenamento/numerical', to: '#/train/numerical' },
    { from: '#/allenamento/mental?mode=learn&n=5', to: '#/train/mental?mode=learn&n=5' },
    { from: '#/errori', to: '#/train/mistakes' },
    { from: '#/errori/ripasso', to: '#/train/mistakes/review' },
    { from: '#/progressi', to: '#/today/progress' },
    { from: '#/train/mistakes/review', to: '#/train/mistakes/review' },
    { from: '#/mocks/bofa', to: '#/mocks/bofa' },
    { from: '#/colloqui/storie', to: '#/interviews/stories' },
    { from: '#/news/practice', to: '#/news/practice' },
    { from: '#/dati', to: '#/settings' },
  ],
  legacyPrefixes: ['#/percorso', '#/lezioni', '#/allenamento', '#/errori', '#/progressi', '#/oggi', '#/allenati', '#/simulazioni', '#/colloqui', '#/dati', '#/news/practice', '#/news/temi', '#/news/note'],

  // Routes of the NEW route map. Built from data (lessons, mock titles, skill names) in buildRoutes().
  // Per route: shot (screenshot name), expect: 'quiz', expectText: [any of], allowShort.
  routes: null,
};

function buildRoutes(D) {
  const R = [];
  const add = (hash, o = {}) => R.push({ hash, ...o });
  add('#/', { shot: 'today' });
  add('#/today/progress', { shot: 'progress' });
  add('#/train', { shot: 'train' });
  for (const s of CONFIG.skills) add(`#/train/${s}`, { shot: s === 'numerical' ? 'skill-numerical' : null, expectText: D.skillNames[s] });
  for (const s of CONFIG.skills) add(`#/train/${s}?mode=learn&n=${CONFIG.drillSize}`, { expect: 'quiz', shot: s === 'numerical' ? 'drill-numerical' : null });
  for (const s of CONFIG.skills) add(`#/train/${s}?mode=timed&n=${CONFIG.drillSize}`, { expect: 'quiz' });
  D.lessonSample.forEach((l, i) => add(`#/train/lesson/${l.id}`, { expectText: [l.title], shot: i === 0 ? 'lesson' : null }));
  add('#/train/lessons', { shot: 'lessons' });
  add('#/train/mistakes', { shot: 'mistakes' });
  add('#/train/mistakes/review', { allowShort: true });
  add('#/mocks', { shot: 'mocks' });
  for (const id of CONFIG.mockIds) add(`#/mocks/${id}`, { expectText: D.mocks[id] ? [D.mocks[id].title] : null, shot: id === 'diag' ? 'mock-intro' : null });
  add('#/interviews', { shot: 'interviews' });
  add('#/interviews/stories');
  add('#/interviews/video', { shot: 'video-room' });
  add('#/news', { shot: 'news-wrap' });
  add('#/news?view=list', { shot: 'news-wrap-list' });
  add('#/news/brief', { shot: 'news-brief' });
  add('#/news/practice', { shot: 'news-practice' });
  add('#/news/themes', { shot: 'news-themes' });
  add('#/news/notes');
  add('#/settings', { shot: 'settings' });
  return R;
}

// ===========================================================================
// Data discovery (Node side): lessons, mocks, skill names
// ===========================================================================
async function loadData() {
  const D = { lessons: [], lessonSample: [], mocks: {}, skillNames: {}, problems: [] };
  const ldir = path.join(ROOT, 'data', 'lessons');
  for (const f of fs.existsSync(ldir) ? fs.readdirSync(ldir).filter((x) => x.endsWith('.json')).sort() : []) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(ldir, f), 'utf8'));
      for (const l of d.lessons || []) D.lessons.push({ id: l.id, skill: l.skill, title: l.title, pack: f, firstSection: (l.sections && l.sections[0] && l.sections[0].h) || '', examples: l.examples || [] });
    } catch (e) { D.problems.push(`lessons ${f}: ${e.message}`); }
  }
  const seen = new Set();
  for (const l of D.lessons) if (!seen.has(l.skill)) { seen.add(l.skill); D.lessonSample.push(l); }
  try {
    const m = await import(pathToFileURL(path.join(ROOT, 'assets', 'js', 'mocks.js')).href);
    for (const x of m.MOCKS || []) {
      D.mocks[x.id] = { title: x.title, video: !!x.video, single: !!x.single, sections: (x.sections || []).length, size: (x.sections || []).reduce((s, y) => s + (y.n || 0), 0) };
    }
  } catch (e) { D.problems.push(`mocks.js import: ${e.message}`); }
  try {
    const c = await import(pathToFileURL(path.join(ROOT, 'assets', 'js', 'content.js')).href);
    for (const s of c.SKILLS || []) D.skillNames[s.id] = [s.name, s.short].filter(Boolean);
    for (const s of c.SKILLS || []) if (!CONFIG.skills.includes(s.id) && !CONFIG.skillsExclude.includes(s.id)) CONFIG.skills.push(s.id);
  } catch (e) { D.problems.push(`content.js import: ${e.message}`); }
  return D;
}

// ===========================================================================
// Reusable flows
// ===========================================================================
const norm = (s) => String(s || '').replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const normHash = (h) => (!h || h === '#' ? '#/' : h);
const re = (src) => new RegExp(src, 'i');

// Route-specific expectations shared by the crawls
async function checkRoute(page, r) {
  if (r.expect === 'quiz') {
    let st = null;
    for (let i = 0; i < 20; i++) { st = await page.quizState(); if (st.kind || st.start) break; await sleep(100); }
    await page.check(st && (st.kind || st.start), `expected a quiz item on ${r.hash}, found none (main: "${(await page.text()).slice(0, 120).replace(/\s+/g, ' ')}")`);
  }
  if (r.expectText && r.expectText.length) {
    const t = norm(await page.text());
    await page.check(r.expectText.some((x) => t.includes(norm(x))), `expected text ${JSON.stringify(r.expectText)} on ${r.hash}`);
  }
  const h = normHash(await page.hash());
  if (h !== normHash(r.hash)) page.warn(`${r.hash} ended on ${h}`);
}

async function collectLinks(page) {
  return page.eval(() => [...document.querySelectorAll('a[href^="#/"]')].map((a) => a.getAttribute('href')));
}
const cleanLink = (h) => h.replace(/([?&])r=\d+&?/, '$1').replace(/[?&]$/, '');
const isLegacy = (h) => CONFIG.legacyPrefixes.some((p) => h === p || h.startsWith(p + '/') || h.startsWith(p + '?'));

async function crawl(page, D, { fresh }) {
  const routes = CONFIG.routes;
  const links = new Map(); // href -> first page seen on
  for (const r of routes) {
    page.step(`route ${r.hash}`);
    try {
      await page.goto(r.hash, { fresh });
      await page.verify(null, { allowShort: r.allowShort });
      await checkRoute(page, r);
      if (r.shot) await page.screenshot(r.shot);
      for (const l of await collectLinks(page)) { const c = cleanLink(l); if (!links.has(c)) links.set(c, r.hash); }
    } catch (e) { await page.fail(`ERROR ${e.message}`); }
  }
  return links;
}

async function drillFlow(page, hash, { mode = 'learn', n = CONFIG.drillSize, perItemVerify = false, answer = 'first', shot = 'report' } = {}) {
  const Q = CONFIG.quiz;
  page.step('open drill');
  await page.goto(hash);
  await page.verify('drill: first item');
  const st0 = await page.quizState();
  page.expect(st0.kind, `no quiz item rendered at ${st0.hash} (main: "${(await page.text()).slice(0, 140).replace(/\s+/g, ' ')}")`);
  const hintTarget = (await page.has(Q.hintButton, { within: Q.stageWithin })) ? Q.hintButton : { text: re(Q.hintText) };
  if (mode === 'learn' && await page.has(hintTarget, { within: Q.stageWithin })) {
    page.step('hint');
    await page.click(hintTarget, { within: Q.stageWithin });
    await page.check(await page.waitFor(`${Q.stage} ${Q.hint}`, 2000, { visible: true }).catch(() => false), 'hint button did not reveal a hint');
  }
  let toggled = false;
  const showExpl = mode === 'learn' || (mode === 'timed' && Q.timedShowsExplanation);
  const run = await page.runQuiz({
    answer, maxItems: n + 3,
    onAnswered: async (r, i) => {
      page.step(`item ${i + 1}/${n} ${r.kind}`);
      await page.check(['ok', 'ko', 'mid'].includes(r.verdict), `no verdict (${Q.verdict}.ok|.ko|.mid) after answering "${r.stem.slice(0, 90)}" (got ${r.verdict})`);
      if (showExpl && r.verdict) {
        await page.check(r.explanation && r.explanation.present, `no explanation block (${Q.expl}) after answering "${r.stem.slice(0, 90)}"`);
        await page.check(r.explanation && r.explanation.steps >= 1, `explanation without steps (${Q.expl} ${Q.explSteps}) for "${r.stem.slice(0, 90)}"`);
      }
      if (!toggled && r.explanation && r.explanation.present && !r.explanation.open && await page.has({ text: re(Q.explToggleText) }, { within: Q.stageWithin })) {
        toggled = true;
        await page.click({ text: re(Q.explToggleText) }, { within: Q.stageWithin });
        const vis = await page.eval((q) => { const el = document.querySelector(`${q.stage} ${q.expl} ${q.explSteps}`); return __vis(el); }, Q);
        await page.check(vis, 'explanation toggle did not reveal the steps');
      }
      if (perItemVerify) await page.verify(`item ${i + 1} layout`);
    },
  });
  page.step('report');
  await page.check(run.answered.length === n, `answered ${run.answered.length} items, expected ${n}`);
  await page.check(run.report.score !== null, `report without a % score: "${run.report.text}"`);
  if (shot) await page.screenshot(shot, { fullPage: false });
  await page.verify('report');
  const v = run.answered.map((a) => a.verdict);
  page.note(`${run.answered.length} answered (${v.filter((x) => x === 'ok').length} ok, ${v.filter((x) => x === 'ko' || x === 'mid').length} wrong), score ${run.report.score}%`);
  return run;
}

async function mockFlow(page, hash, D, id) {
  page.step('mock intro');
  await page.goto(hash);
  await page.verify('mock intro');
  let verdicts = 0;
  const meta = D.mocks[id];
  page.step('run mock');
  const run = await page.runQuiz({ answer: 'first', maxItems: (meta && meta.size ? meta.size : 60) + 5, onAnswered: (r) => { if (r.verdict) verdicts++; } });
  page.step('mock report');
  await page.check(run.report.score !== null, `final report without a % score: "${run.report.text}"`);
  if (meta && meta.size) await page.check(run.answered.length === meta.size, `mock "${id}" served ${run.answered.length} questions, mocks.js promises ${meta.size}`);
  if (!CONFIG.quiz.mockShowsFeedback) await page.check(verdicts === 0, `mock showed a verdict during the test on ${verdicts} items (feedback should wait for the end)`);
  if (meta && !meta.single && meta.sections > 1) await page.check(run.starts >= meta.sections, `expected ${meta.sections} section starts, clicked ${run.starts}`);
  await page.screenshot('report');
  await page.verify('mock report');
  page.note(`${run.answered.length} answered, ${run.starts} start/section buttons, score ${run.report.score}%`);
  return run;
}

// ===========================================================================
// SCENARIOS: { name, viewport, run(page, ctx), keepStorage?, timeout? }
// ===========================================================================
export function buildScenarios(D) {
  const S = [];
  const V = CONFIG.viewports;

  // --- smoke: works on the current site and, through the redirects, on the new one ---
  S.push({
    name: 'smoke', viewport: 'desktop', run: async (page) => {
      page.step('#/oggi');
      await page.goto('#/oggi');
      await page.verify('#/oggi');
      await page.screenshot('oggi');
      await drillFlow(page, '#/allenamento/mental?mode=learn&n=5', { shot: 'drill-report' });
      await mockFlow(page, '#/mocks/bofa', D, 'bofa');
    },
  });

  // --- crawls ---
  S.push({
    name: 'crawl', viewport: 'desktop', timeout: 6 * 60 * 1000, run: async (page) => {
      const links = await crawl(page, D, { fresh: true });
      // follow links discovered on the pages that are not in the route list
      const known = new Set(CONFIG.routes.map((r) => r.hash));
      const legacy = [...links.entries()].filter(([h]) => isLegacy(h));
      for (const [h, from] of legacy) page.warn(`legacy link ${h} on ${from}`);
      // one link per distinct path first, then the remaining variants (query strings), up to the cap
      const unseen = [...links.keys()].filter((h) => !known.has(h));
      const byPath = new Map();
      for (const h of unseen) { const k = h.split('?')[0]; if (!byPath.has(k)) byPath.set(k, h); }
      const firsts = [...byPath.values()];
      const extra = [...firsts, ...unseen.filter((h) => !firsts.includes(h))].slice(0, CONFIG.maxDiscoveredLinks);
      for (const h of extra) {
        page.step(`link ${h} (from ${links.get(h)})`);
        try { await page.goto(h); await page.verify(null, { allowShort: /ripasso|tutti/.test(h) }); } catch (e) { await page.fail(`ERROR ${e.message}`); }
      }
      page.note(`${CONFIG.routes.length} routes, ${extra.length} extra links followed, ${legacy.length} legacy links`);
    },
  });
  S.push({
    name: 'crawl', viewport: 'mobile', timeout: 6 * 60 * 1000, run: async (page) => {
      await crawl(page, D, { fresh: false }); // in-app navigation (hashchange) on mobile, full loads on desktop
    },
  });

  // --- navigation menu ---
  for (const vp of ['desktop', 'mobile']) S.push({
    name: 'nav', viewport: vp, run: async (page) => {
      page.step('open #/');
      await page.goto('#/');
      const sel = CONFIG.selectors;
      const visibleLinks = () => page.eval((s) => [...new Set([...document.querySelectorAll(s)].filter(__vis).map((a) => a.getAttribute('href')))], sel.nav);
      let links = await visibleLinks();
      if (!links.length && await page.has(sel.menuToggle)) { await page.click(sel.menuToggle); links = await visibleLinks(); }
      await page.check(links.length >= 3, `only ${links.length} visible navigation links (${sel.nav})`);
      for (const href of links) {
        page.step(`nav ${href}`);
        try {
          if (!(await page.has(`a[href="${href}"]`)) && await page.has(sel.menuToggle)) await page.click(sel.menuToggle);
          await page.click(`a[href="${href}"]`);
          await page.settle();
          const h = normHash(await page.hash());
          if (isLegacy(href)) page.warn(`nav link uses legacy route ${href} (landed on ${h})`);
          else await page.check(h.split('?')[0] === normHash(href).split('?')[0], `nav link ${href} landed on ${h}`);
          await page.verify(null);
        } catch (e) { await page.fail(`ERROR ${e.message}`); }
      }
      await page.screenshot('nav-last', { fullPage: false });
    },
  });

  // --- old routes redirect to the new map ---
  S.push({
    name: 'redirects', viewport: 'desktop', run: async (page) => {
      const lesson = D.lessons[0] ? D.lessons[0].id : 'les-num-01';
      for (const r of CONFIG.redirects) {
        const from = r.from.replace('{lesson}', lesson);
        const to = typeof r.to === 'string' ? r.to.replace('{lesson}', lesson) : r.to;
        page.step(`redirect ${from}`);
        try {
          await page.goto(from, { fresh: true });
          await sleep(100);
          await page.settle();
          const h = normHash(await page.hash());
          const ok = typeof to === 'string' ? h === to : to.test(h);
          await page.check(ok, `${from} landed on ${h}, expected ${to}`);
          await page.verify(null, { allowShort: /ripasso/.test(from) });
        } catch (e) { await page.fail(`ERROR ${e.message}`); }
      }
    },
  });

  // --- learn drills, every skill ---
  for (const sk of CONFIG.skills) S.push({
    name: `drill:${sk}`, viewport: 'desktop', run: (page) => drillFlow(page, `#/train/${sk}?mode=learn&n=${CONFIG.drillSize}`),
  });
  for (const sk of CONFIG.mobileDrillSkills) S.push({
    name: `drill:${sk}`, viewport: 'mobile', run: (page) => drillFlow(page, `#/train/${sk}?mode=learn&n=${CONFIG.drillSize}`, { perItemVerify: true }),
  });
  // --- timed drills, every skill ---
  for (const sk of CONFIG.skills) S.push({
    name: `timed:${sk}`, viewport: 'desktop', run: (page) => drillFlow(page, `#/train/${sk}?mode=timed&n=${CONFIG.drillSize}`, { mode: 'timed', shot: null }),
  });

  // --- quit a set early with "Termina" ---
  S.push({
    name: 'quit', viewport: 'desktop', run: async (page) => {
      const Q = CONFIG.quiz;
      page.step('open timed set');
      await page.goto(`#/train/numerical?mode=timed&n=${CONFIG.drillSize}`);
      for (let i = 0; i < 2; i++) {
        page.step(`answer ${i + 1}`);
        await page.answerCurrent();
        if (await page.has({ text: re(Q.nextText) })) await page.click({ text: re(Q.nextText) });
      }
      page.step('Termina');
      await page.click({ text: re(Q.quitText) });
      await page.check(await page.waitFor(Q.report, 3000, { visible: true }).catch(() => false), `no report (${Q.report}) after clicking Termina`);
      await page.verify('report after Termina');
    },
  });

  // --- mistakes notebook: wrong answers show up, review run works ---
  S.push({
    name: 'errori', viewport: 'desktop', run: async (page) => {
      page.step('make mistakes');
      await page.goto(`#/train/fin-acc?mode=learn&n=${CONFIG.drillSize}`);
      const run = await page.runQuiz({ answer: 'wrong', maxItems: CONFIG.drillSize + 3 });
      const wrong = run.answered.filter((a) => a.verdict && a.verdict !== 'ok');
      page.note(`${wrong.length}/${run.answered.length} wrong (${run.answered.filter((a) => a.correctKnown).length} resolved from the bank)`);
      page.expect(wrong.length > 0, 'could not produce any wrong answer to test the notebook');
      page.step('errori list');
      await page.goto('#/train/mistakes');
      await page.verify('errori page');
      const txt = norm(await page.text());
      const stems = [...new Set(wrong.map((w) => norm(w.stem).slice(0, 40)))];
      const missing = stems.filter((s) => !txt.includes(s));
      await page.check(!missing.length, `${missing.length}/${stems.length} wrong items missing from #/train/mistakes: ${missing.map((m) => `"${m}"`).join(', ')}`);
      const entries = await page.count(CONFIG.selectors.mistakeEntry);
      if (entries) await page.check(entries >= stems.length, `${entries} mistake entries (${CONFIG.selectors.mistakeEntry}), expected at least ${stems.length}`);
      await page.screenshot('errori');
      page.step('ripasso');
      const due = await page.eval(CONFIG.storage.makeAllMistakesDue, CONFIG.storage.key);
      if (!due) { page.warn(`could not make mistakes due via localStorage["${CONFIG.storage.key}"].srs: skipped the review run`); return; }
      await page.load('#/train/mistakes/review');
      const rev = await page.runQuiz({ answer: 'correct', maxItems: due + 3 });
      await page.check(rev.answered.length >= Math.min(due, stems.length), `review served ${rev.answered.length} items, ${due} were due`);
      await page.check(rev.report.score !== null, `review report without score: "${rev.report.text}"`);
      page.note(`notebook: ${stems.length} wrong items listed; review run ${rev.answered.length} items, score ${rev.report.score}%`);
      await page.verify('ripasso report');
    },
  });

  // --- mocks (all but video) ---
  for (const id of CONFIG.mockIds.filter((x) => !CONFIG.videoMocks.includes(x))) S.push({
    name: `mock:${id}`, viewport: 'desktop', run: (page) => mockFlow(page, `#/mocks/${id}`, D, id),
  });
  S.push({ name: 'mock:bofa', viewport: 'mobile', run: (page) => mockFlow(page, '#/mocks/bofa', D, 'bofa') });

  // --- lessons: every lesson renders, examples toggle ---
  S.push({
    name: 'lessons', viewport: 'desktop', run: async (page) => {
      page.expect(D.lessons.length, 'no lessons found in data/lessons');
      for (const l of D.lessons) {
        page.step(`lesson ${l.id}`);
        try {
          await page.goto(`#/train/lesson/${l.id}`);
          await page.verify(null);
          const t = norm(await page.text());
          await page.check(t.includes(norm(l.title)), `lesson title "${l.title}" not on page`);
          if (l.firstSection) await page.check(t.includes(norm(l.firstSection)), `first section "${l.firstSection}" not on page`);
        } catch (e) { await page.fail(`ERROR ${e.message}`); }
      }
    },
  });
  const exLessons = [];
  for (const l of D.lessons) if (l.examples.length && l.examples[0].steps && l.examples[0].steps.length && !exLessons.some((x) => x.pack === l.pack)) exLessons.push(l);
  for (const vp of ['desktop', 'mobile']) S.push({
    name: 'lesson-examples', viewport: vp, run: async (page) => {
      page.expect(exLessons.length, 'no lesson with worked examples');
      for (const l of exLessons) {
        page.step(`lesson ${l.id}`);
        await page.goto(`#/train/lesson/${l.id}`);
        await page.verify(null);
        const expected = norm(l.examples[0].steps[0]).slice(0, 30);
        const visible = async () => norm(await page.text()).includes(expected);
        await page.check(!(await visible()), `example solution of ${l.id} is visible before the toggle`);
        page.step(`toggle ${l.id}`);
        const hasSel = await page.has(CONFIG.lesson.exampleToggle);
        await page.click(hasSel ? CONFIG.lesson.exampleToggle : { text: re(CONFIG.lesson.exampleToggleText) });
        await sleep(150);
        await page.check(await visible(), `example solution of ${l.id} not visible after the toggle (looked for "${expected}")`);
        if (l === exLessons[0]) await page.screenshot('example-open');
        await page.click(hasSel ? CONFIG.lesson.exampleToggle : { text: re(CONFIG.lesson.exampleToggleText) });
        await sleep(150);
        await page.check(!(await visible()), `example solution of ${l.id} still visible after toggling back`);
        await page.verify(null);
      }
    },
  });

  // --- news ---
  for (const vp of ['desktop', 'mobile']) S.push({
    name: 'news', viewport: vp, run: async (page, ctx) => {
      const N = CONFIG.news;
      page.step('#/news/brief');
      const t0 = Date.now();
      await page.goto('#/news/brief');
      await page.verify('#/news/brief');
      const urls = new Set(page.responses(N.dataUrlRe, t0).filter((r) => r.status === 200).map((r) => r.url.split('?')[0]));
      for (const p of N.dataPaths) { const r = await fetch(ctx.baseUrl + p).catch(() => null); if (r && r.ok) urls.add(ctx.baseUrl + p); }
      const headlines = [], markets = [];
      for (const url of urls) {
        try { const x = extractNews(await (await fetch(url)).json()); headlines.push(...x.headlines); markets.push(...x.markets); }
        catch (e) { await page.fail(`news data ${url} is not valid JSON: ${e.message}`); }
      }
      const hasData = headlines.length > 0 || markets.length > 0;
      if (!urls.size) page.note('no news data found (none fetched by the page, none at CONFIG.news.dataPaths): data assertions skipped');
      else {
        const txt = norm(await page.text());
        const nh = await page.count(N.headline, { visible: true }), nm = await page.count(N.marketCard, { visible: true });
        if (headlines.length) await page.check(headlines.slice(0, 300).some((h) => txt.includes(norm(h).slice(0, 40))), `no headline from the data is rendered on #/news/brief (e.g. "${headlines[0].slice(0, 60)}")`);
        if (markets.length) await page.check(markets.some((m) => txt.includes(norm(m))), `no market card rendered on #/news/brief (e.g. "${markets[0]}")`);
        page.note(`news data: ${headlines.length} headlines, ${markets.length} market series; on page: ${nh} headline rows, ${nm} market cards`);
      }
      await page.screenshot('news');
      page.step('#/news/practice');
      await page.goto('#/news/practice');
      await page.verify('#/news/practice');
      const st = await page.quizState();
      const runSet = async (label) => {
        const run = await page.runQuiz({ answer: 'first', maxItems: 40 });
        await page.check(run.report.score !== null, `${label}: report without score: "${run.report.text}"`);
        await page.check(run.answered.every((a) => !a.verdict || (a.explanation && a.explanation.present)), `${label}: some answers had no explanation block`);
        await page.verify(`${label} report`);
        return run;
      };
      if (st.kind || st.start) { const run = await runSet('news exercises'); page.note(`news exercises: ${run.answered.length} answered, score ${run.report.score}%`); }
      else {
        const links = [...new Set((await page.eval((m) => [...document.querySelectorAll(`${m} a[href^="#/"]`)].map((a) => a.getAttribute('href')), CONFIG.selectors.main)).filter((h) => N.exerciseLinkRe.test(h)))].slice(0, N.maxExerciseSets);
        if (!links.length && hasData) await page.fail('news data exists but #/news/practice offers no exercise (no quiz and no exercise link)');
        const done = [];
        for (const l of links) {
          page.step(`news set ${l}`);
          try {
            await page.goto(l);
            await page.verify(null);
            const s2 = await page.quizState();
            if (!s2.kind && !s2.start) { await page.fail(`${l} shows no quiz item (main: "${(await page.text()).slice(0, 140).replace(/\s+/g, ' ')}")`); continue; }
            const run = await runSet(l);
            done.push(`${l.replace('#/news/practice', '')}: ${run.answered.length}q ${run.report.score}%`);
          } catch (e) { await page.fail(`ERROR ${e.message}`); }
        }
        if (links.length) page.note(`news sets: ${done.join(' | ')}`);
      }
      page.step('#/news/note');
      await page.goto('#/news/note');
      await page.verify('#/news/note');
    },
  });

  // apply viewport objects
  for (const s of S) s.vp = V[s.viewport];
  return S;
}

// Pull headline strings and market labels out of an unknown news JSON shape
// (e.g. {items:[{title}]} and {series:{SP500:{name, points}}}).
function extractNews(data) {
  const headlines = [], markets = [];
  const walk = (x, depth) => {
    if (depth > 6 || !x || typeof x !== 'object') return;
    if (Array.isArray(x)) { for (const y of x) walk(y, depth + 1); return; }
    const title = x.title || x.headline;
    const label = x.name || x.label || x.symbol || x.ticker;
    const marketish = ['points', 'price', 'last', 'value', 'change', 'changePct', 'pct', 'close'].some((k) => k in x);
    if (typeof title === 'string') headlines.push(title);
    else if (typeof label === 'string' && marketish) markets.push(label);
    for (const [k, v] of Object.entries(x)) if (v && typeof v === 'object' && k !== 'points') walk(v, depth + 1);
  };
  walk(data, 0);
  return { headlines, markets };
}

// ===========================================================================
// Runner
// ===========================================================================
const HELP = `Usage: node tests/e2e.mjs [options]
  --only <a,b>      run scenarios whose "name@viewport" contains any substring (repeatable)
  --skip <a,b>      skip scenarios whose "name@viewport" contains any substring (repeatable)
  --viewport <v>    desktop | mobile
  --list            list scenarios and exit
  --base <url>      test an already running site instead of starting python3 http.server
  --chrome <path>   Chrome binary (default: ${CONFIG.chromePath})
  --headful         show the browser window
  --no-shots        only take screenshots on failures
  --ignore-request <re>  ignore failed requests whose URL matches this RegExp (repeatable), e.g. 'culture|concepts'
  --bail            stop at the first failing scenario
  --timeout <sec>   overall timeout (default ${CONFIG.overallTimeoutMs / 1000})
  -v, --verbose     log every step, click and answer
  -h, --help`;

function parseArgs(argv) {
  const a = { ignoreRequests: [], only: [], skip: [], viewport: null, list: false, base: null, chrome: CONFIG.chromePath, headful: false, noShots: false, bail: false, timeout: CONFIG.overallTimeoutMs, verbose: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Error(`missing value for ${k}`); return argv[++i]; };
    if (k === '--only') a.only.push(...val().split(',').filter(Boolean));
    else if (k === '--skip') a.skip.push(...val().split(',').filter(Boolean));
    else if (k === '--viewport') a.viewport = val();
    else if (k === '--list') a.list = true;
    else if (k === '--base') a.base = val().replace(/\/?$/, '/');
    else if (k === '--chrome') a.chrome = val();
    else if (k === '--headful') a.headful = true;
    else if (k === '--no-shots') a.noShots = true;
    else if (k === '--ignore-request') a.ignoreRequests.push(new RegExp(val()));
    else if (k === '--bail') a.bail = true;
    else if (k === '--timeout') a.timeout = Number(val()) * 1000;
    else if (k === '-v' || k === '--verbose') a.verbose = true;
    else if (k === '-h' || k === '--help') a.help = true;
    else throw new Error(`unknown option ${k}`);
  }
  return a;
}

function withTimeout(promise, ms, label) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out after ${Math.round(ms / 1000)} s`)), ms); })]).finally(() => clearTimeout(t));
}

function table(rows, head) {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (r) => r.map((c, i) => String(c).padEnd(w[i])).join('  ');
  return [line(head), w.map((n) => '-'.repeat(n)).join('  '), ...rows.map(line)].join('\n');
}

let SHUTTING = false;
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return 0; }
  CONFIG.ignoreRequests.push(...args.ignoreRequests);
  const D = await loadData();
  CONFIG.routes = buildRoutes(D);
  const all = buildScenarios(D);
  const id = (s) => `${s.name}@${s.viewport}`;
  const sel = all.filter((s) => (!args.only.length || args.only.some((o) => id(s).includes(o)))
    && !args.skip.some((o) => id(s).includes(o)) && (!args.viewport || s.viewport === args.viewport));
  if (args.list) { for (const s of all) console.log(`${sel.includes(s) ? '*' : ' '} ${id(s)}`); return 0; }
  if (!sel.length) { console.error('No scenario matches the filters (use --list).'); return 2; }
  for (const p of D.problems) console.log(`[data] ${p}`);

  const deadline = Date.now() + args.timeout;
  const overall = setTimeout(async () => {
    console.error(`\nOVERALL TIMEOUT after ${args.timeout / 1000} s: killing Chrome and the server.`);
    await cleanupAll();
    process.exit(3);
  }, args.timeout);
  overall.unref();

  fs.mkdirSync(CONFIG.outDir, { recursive: true });
  // remove stale screenshots of the selected scenarios only (another run may be using the folder)
  const prefixes = sel.map((s) => `${slug(id(s))}__`);
  for (const f of fs.readdirSync(CONFIG.outDir)) if (f.endsWith('.png') && prefixes.some((p) => f.startsWith(p))) fs.rmSync(path.join(CONFIG.outDir, f), { force: true });
  let baseUrl = args.base;
  if (!baseUrl) {
    const port = await freePort();
    ({ base: baseUrl } = await startStaticServer(ROOT, port));
  }
  const dport = await freePort();
  const chrome = await launchChrome({ chromePath: args.chrome, port: dport, headful: args.headful, extraArgs: CONFIG.chromeExtraArgs });
  const cdp = await CDP.connect(chrome.wsUrl);
  const base = new Page(cdp, { baseUrl, outDir: CONFIG.outDir, config: CONFIG, verbose: args.verbose, noShots: args.noShots });
  await base.init();
  console.log(`Analyst Gym e2e: ${sel.length}/${all.length} scenarios against ${baseUrl}\n`);

  const results = [];
  for (const s of sel) {
    const result = { scenario: s.name, viewport: s.viewport, status: 'RUN', ms: 0, step: 'start', failures: [], warnings: [], notes: [], shotSteps: new Set() };
    results.push(result);
    if (Date.now() > deadline || cdp.closed || base.crashed) { result.status = 'SKIP'; result.notes.push('not run (timeout or browser gone)'); continue; }
    const page = base.forScenario(id(s), result);
    const t0 = Date.now();
    process.stdout.write(`- ${id(s)} ... `);
    try {
      await page.setViewport(s.vp);
      if (!s.keepStorage) await page.clearStorage();
      page.takeIssues();
      await withTimeout(s.run(page, { baseUrl, data: D, config: CONFIG }), s.timeout || CONFIG.scenarioTimeoutMs, id(s));
    } catch (e) {
      const shot = await page.screenshot(`ERROR-${result.step}`, { force: true, fullPage: false }).catch(() => null);
      result.failures.push({ step: result.step, message: `ERROR ${String(e && e.message || e).replace(/\s+/g, ' ').slice(0, 900)}`, screenshot: shot });
    } finally { page.cancelled = true; }
    const left = base.classifyIssues(base.takeIssues());
    for (const e of left.errors) {
      const prevF = result.failKeys && result.failKeys.get(e);
      if (prevF) prevF.repeats = (prevF.repeats || 0) + 1; else result.failures.push({ step: `${result.step} (after)`, message: e, screenshot: null });
    }
    for (const w of left.warnings) result.warnings.push({ step: result.step, message: w });
    result.ms = Date.now() - t0;
    result.status = result.failures.length ? 'FAIL' : 'PASS';
    console.log(`${result.status} (${(result.ms / 1000).toFixed(1)} s${result.failures.length ? `, ${result.failures.length} failures` : ''}${result.warnings.length ? `, ${result.warnings.length} warnings` : ''})`);
    if (args.verbose || result.status === 'FAIL') for (const f of result.failures.slice(0, 3)) console.log(`    x [${f.step}] ${f.message.slice(0, 220)}`);
    if (args.bail && result.status === 'FAIL') break;
  }

  // ----- summary -----
  const rows = results.map((r) => [r.scenario, r.viewport, r.status, `${(r.ms / 1000).toFixed(1)}s`, r.failures.length, r.warnings.length, (r.notes[r.notes.length - 1] || '').slice(0, 70)]);
  console.log(`\n${table(rows, ['Scenario', 'Viewport', 'Result', 'Time', 'Fail', 'Warn', 'Notes'])}`);
  const failed = results.filter((r) => r.status === 'FAIL');
  if (failed.length) {
    console.log('\nFAILURES');
    for (const r of failed) {
      console.log(`\n${r.scenario} @ ${r.viewport}`);
      for (const f of r.failures) console.log(`  step: ${f.step}\n    ${f.message}${f.repeats ? ` (repeated ${f.repeats} more times)` : ''}${f.screenshot ? `\n    screenshot: ${f.screenshot}` : ''}`);
    }
  }
  const warned = results.filter((r) => r.warnings.length);
  if (warned.length) {
    console.log('\nWARNINGS');
    for (const r of warned) for (const w of [...new Map(r.warnings.map((x) => [x.message, x])).values()].slice(0, 8)) console.log(`  ${r.scenario}@${r.viewport} [${w.step}] ${w.message.slice(0, 200)}`);
  }
  const reportFile = path.join(CONFIG.outDir, 'e2e-report.json');
  fs.writeFileSync(reportFile, JSON.stringify({ base: baseUrl, at: new Date().toISOString(), results: results.map(({ shotSteps, failKeys, step, ...r }) => r) }, null, 1));
  const pass = results.filter((r) => r.status === 'PASS').length;
  console.log(`\n${pass} passed, ${failed.length} failed, ${results.length - pass - failed.length} skipped. Report: ${path.relative(process.cwd(), reportFile)}. Screenshots: ${path.relative(process.cwd(), CONFIG.outDir)}/`);
  cdp.close();
  clearTimeout(overall);
  return failed.length || results.some((r) => r.status === 'SKIP') ? 1 : 0;
}

process.on('exit', cleanupSync);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, async () => { if (SHUTTING) return; SHUTTING = true; console.error(`\n${sig}: cleaning up`); await cleanupAll(); process.exit(130); });

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main()
    .then(async (code) => { await cleanupAll(); process.exit(code); })
    .catch(async (e) => { console.error(`\nHARNESS ERROR: ${e && e.stack || e}`); await cleanupAll(); process.exit(2); });
}
