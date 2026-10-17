// Validates the content packs in data/lessons, data/banks and data/news/concepts.json (or data/staging with --staging).
import fs from 'fs';
import path from 'path';

const staging = process.argv.includes('--staging');
const ROOT = new URL('../data/', import.meta.url).pathname;
const files = staging
  ? fs.readdirSync(path.join(ROOT, 'staging')).filter(f => f.endsWith('.json')).map(f => path.join(ROOT, 'staging', f))
  : [...fs.readdirSync(path.join(ROOT, 'lessons')).map(f => path.join(ROOT, 'lessons', f)), ...fs.readdirSync(path.join(ROOT, 'banks')).map(f => path.join(ROOT, 'banks', f)), path.join(ROOT, 'news', 'concepts.json')].filter(f => f.endsWith('.json') && fs.existsSync(f));

const SKILLS = new Set(['numerical', 'mental', 'verbal', 'logical', 'inductive', 'sjt', 'fin-acc', 'fin-val', 'fin-ma', 'fin-lbo', 'fin-ecm', 'fin-tmt', 'markets', 'commercial', 'behavioural', 'workstyle', 'culture']);
const CONCEPT_SKILLS = new Set(['markets', 'commercial', 'culture']);
let errors = 0, warns = 0;
const ids = new Set();
const err = (f, m) => { errors++; if (errors <= 60) console.log('ERR ', path.basename(f), m); };
const warn = (f, m) => { warns++; if (warns <= 40) console.log('WARN', path.basename(f), m); };
const EMDASH = /—/;

function checkExpl(f, id, e) {
  if (!e) return err(f, `${id}: missing explanation`);
  if (!Array.isArray(e.steps) || !e.steps.length) err(f, `${id}: explanation.steps empty`);
  for (const k of ['shortcut', 'trap', 'rule']) if (!e[k] || typeof e[k] !== 'string') err(f, `${id}: explanation.${k} missing`);
  if (EMDASH.test(JSON.stringify(e))) warn(f, `${id}: em dash in explanation`);
}

const stats = {};
for (const f of files) {
  let d;
  try { d = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { err(f, 'invalid JSON: ' + e.message); continue; }
  const name = path.basename(f);
  stats[name] = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Array.isArray(v) ? v.length : typeof v]));
  const ctx = new Set([...(d.passages || []).map(p => p.id), ...(d.datasets || []).map(x => x.id)]);
  for (const p of d.passages || []) { if (!p.text || p.text.split(/\s+/).length < 120) warn(f, `${p.id}: passage short`); }
  for (const ds of d.datasets || []) {
    if (!Array.isArray(ds.columns) || !Array.isArray(ds.rows) || !ds.rows.length) err(f, `${ds.id}: dataset columns/rows`);
    for (const r of ds.rows || []) if (r.length !== ds.columns.length) err(f, `${ds.id}: row length mismatch`);
    if (ds.kind && !['table', 'bar', 'line', 'pie'].includes(ds.kind)) err(f, `${ds.id}: kind ${ds.kind}`);
  }
  for (const l of d.lessons || []) {
    if (ids.has(l.id)) err(f, `dup id ${l.id}`); ids.add(l.id);
    if (!SKILLS.has(l.skill)) err(f, `${l.id}: skill ${l.skill}`);
    if (!l.title || !Array.isArray(l.sections) || l.sections.length < 3) err(f, `${l.id}: title/sections`);
    for (const s of l.sections || []) if (!s.h || !s.body) err(f, `${l.id}: section missing h/body`);
    if (!Array.isArray(l.examples) || !l.examples.length) warn(f, `${l.id}: no examples`);
    if (!Array.isArray(l.cheatsheet) || !l.cheatsheet.length) warn(f, `${l.id}: no cheatsheet`);
    if (EMDASH.test(JSON.stringify(l))) warn(f, `${l.id}: em dash`);
  }
  for (const it of d.items || []) {
    if (ids.has(it.id)) err(f, `dup id ${it.id}`); ids.add(it.id);
    const t = it.type;
    if (!SKILLS.has(it.skill) && t !== 'sjt') err(f, `${it.id}: skill ${it.skill}`);
    if (!it.stem) err(f, `${it.id}: stem`);
    if (it.ref && !ctx.has(it.ref)) err(f, `${it.id}: ref ${it.ref} not found`);
    if (![1, 2, 3].includes(it.level)) warn(f, `${it.id}: level ${it.level}`);
    if (!it.timeTarget) warn(f, `${it.id}: timeTarget`);
    if (t === 'mcq') {
      if (!Array.isArray(it.options) || it.options.length < 3) err(f, `${it.id}: options`);
      else {
        if (!Number.isInteger(it.answer) || it.answer < 0 || it.answer >= it.options.length) err(f, `${it.id}: answer index ${it.answer}`);
        if (new Set(it.options.map(o => String(o).trim().toLowerCase())).size !== it.options.length) err(f, `${it.id}: duplicate options`);
      }
    } else if (t === 'tfc') {
      if (!['T', 'F', 'C'].includes(it.answer)) err(f, `${it.id}: tfc answer ${it.answer}`);
    } else if (t === 'numeric') {
      if (typeof it.answer !== 'number' || !isFinite(it.answer)) err(f, `${it.id}: numeric answer`);
      if (typeof it.tolerance !== 'number') warn(f, `${it.id}: tolerance`);
    } else if (t === 'sjt') {
      if (!Array.isArray(it.options) || it.options.length !== 4) err(f, `${it.id}: sjt options`);
      if (!Array.isArray(it.ratings) || it.ratings.length !== 4) err(f, `${it.id}: ratings`);
      else {
        const mx = Math.max(...it.ratings), mn = Math.min(...it.ratings);
        if (it.ratings[it.best] !== mx) err(f, `${it.id}: best not max rating`);
        if (it.ratings[it.worst] !== mn) err(f, `${it.id}: worst not min rating`);
        if (it.ratings.filter(r => r === mx).length > 1) err(f, `${it.id}: tie on best`);
        if (it.ratings.filter(r => r === mn).length > 1) err(f, `${it.id}: tie on worst`);
      }
    } else err(f, `${it.id}: type ${t}`);
    checkExpl(f, it.id, it.explanation);
    if (EMDASH.test(it.stem + JSON.stringify(it.options || ''))) warn(f, `${it.id}: em dash in stem/options`);
  }
  const pos = [0, 0, 0, 0, 0, 0];
  for (const it of d.items || []) if (it.type === 'mcq' && Number.isInteger(it.answer)) pos[it.answer]++;
  const nMcq = pos.reduce((a, b) => a + b, 0);
  if (nMcq >= 20 && Math.max(...pos) / nMcq > 0.4) warn(f, `answer position skew ${pos.join('/')}`);
  for (const c of d.concepts || []) {
    if (ids.has(c.id)) err(f, `dup concept id ${c.id}`); ids.add(c.id);
    if (!CONCEPT_SKILLS.has(c.skill)) err(f, `${c.id}: skill ${c.skill}`);
    for (const k of ['theme', 'title', 'explainer', 'interview']) if (!c[k] || typeof c[k] !== 'string') err(f, `${c.id}: ${k} missing`);
    if (!Array.isArray(c.watch) || !c.watch.length) warn(f, `${c.id}: watch empty`);
    if (!Array.isArray(c.match) || !c.match.length) err(f, `${c.id}: match empty`);
    for (const r of [...(c.match || []), ...(c.exclude || [])]) { try { new RegExp(r, 'i'); } catch (e) { err(f, `${c.id}: bad regex ${r}`); } }
    if (!Array.isArray(c.questions) || c.questions.length < 3) err(f, `${c.id}: needs 3 questions`);
    for (const q of c.questions || []) {
      if (ids.has(q.qid)) err(f, `dup qid ${q.qid}`); ids.add(q.qid);
      if (q.type !== 'mcq' || !Array.isArray(q.options) || q.options.length !== 4) err(f, `${q.qid}: mcq with 4 options`);
      else if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) err(f, `${q.qid}: answer ${q.answer}`);
      else if (new Set(q.options.map(o => String(o).trim().toLowerCase())).size !== 4) err(f, `${q.qid}: duplicate options`);
      if (!q.stem) err(f, `${q.qid}: stem`);
      if (/this headline|the headline above/i.test(q.stem)) err(f, `${q.qid}: refers to the specific headline`);
      checkExpl(f, q.qid, q.explanation);
    }
    if (EMDASH.test(JSON.stringify(c))) warn(f, `${c.id}: em dash`);
  }
  for (const q of d.questions || []) {
    if (ids.has(q.id)) err(f, `dup id ${q.id}`); ids.add(q.id);
    for (const k of ['q', 'tests', 'structure', 'good', 'pitfalls', 'skeleton']) if (!q[k] || (Array.isArray(q[k]) && !q[k].length)) err(f, `${q.id}: ${k} missing`);
    if (EMDASH.test(JSON.stringify(q))) warn(f, `${q.id}: em dash`);
  }
}
// tfc balance
console.log(JSON.stringify(stats, null, 0));
console.log(`content check: ${errors} errors, ${warns} warnings`);
process.exit(errors ? 1 : 0);
