import { generateMental, MENTAL_TYPES } from '../assets/js/gen/mental.js';
import { generateNumerical } from '../assets/js/gen/numerical.js';
import { generateSeries } from '../assets/js/gen/series.js';
import { generateShapes } from '../assets/js/gen/shapes.js';

let fails = 0, n = 0;
const bad = (msg, q) => { fails++; if (fails <= 25) console.log('FAIL', msg, JSON.stringify({ id: q.id, stem: q.stem, options: q.optionsHTML ? '[svg]' : q.options, answer: q.answer }).slice(0, 400)); };
function check(q) {
  n++;
  if (!q.stem || /undefined|NaN|Infinity/.test(q.stem)) bad('stem', q);
  if (!Array.isArray(q.options) || q.options.length < 4) bad('options count', q);
  if (q.answer < 0 || q.answer >= q.options.length || !Number.isInteger(q.answer)) bad('answer index', q);
  if (new Set(q.options).size !== q.options.length) bad('duplicate options', q);
  for (const o of q.options) if (/undefined|NaN|Infinity/.test(String(o))) bad('option value', q);
  const e = q.explanation || {};
  for (const k of ['steps', 'shortcut', 'trap', 'rule']) if (!e[k] || (Array.isArray(e[k]) && !e[k].length)) bad('explanation ' + k, q);
  for (const s of [...(e.steps || []), e.shortcut, e.trap, e.rule]) if (/undefined|NaN/.test(String(s))) bad('explanation value', q);
  if (!q.timeTarget) bad('timeTarget', q);
}
for (let s = 1; s <= 3000; s++) for (const t of MENTAL_TYPES) check(generateMental(s * 7 + t.length, t));
for (let s = 1; s <= 6000; s++) check(generateNumerical(s * 13));
for (let s = 1; s <= 4000; s++) check(generateSeries(s * 17));
for (let s = 1; s <= 4000; s++) check(generateShapes(s * 19));

// semantic spot checks: mental pctOf / pctChange recompute from stem
for (let s = 1; s <= 2000; s++) {
  const q = generateMental(s, 'pctOf');
  const m = q.stem.match(/What is ([\d.]+)% of ([\d,]+)\?/);
  const v = parseFloat(m[1]) * parseFloat(m[2].replace(/,/g, '')) / 100;
  if (parseFloat(q.options[q.answer].replace(/,/g, '')) !== Math.round(v * 100) / 100) bad('pctOf value', q);
}
for (let s = 1; s <= 2000; s++) {
  const q = generateMental(s, 'pctChange');
  const m = q.stem.match(/from ([\d.,]+) to ([\d.,]+)/);
  const a = parseFloat(m[1].replace(/,/g, '')), b = parseFloat(m[2].replace(/,/g, ''));
  const v = Math.round((b - a) / a * 1000) / 10;
  if (Math.abs(parseFloat(q.options[q.answer]) - v) > 0.11) bad('pctChange value ' + v, q);
}
// numerical: recompute percent-change questions from the dataset
for (let s = 1; s <= 3000; s++) {
  const q = generateNumerical(s);
  if (!q.tags.includes('percent-change')) continue;
  const ds = q.context.dataset; const m = q.stem.match(/change in (.+?)'s revenue between (\d{4}) and (\d{4})/);
  const row = ds.rows.find(r => r[0] === m[1]); const a = row[ds.columns.indexOf(m[2])], b = row[ds.columns.indexOf(m[3])];
  const v = Math.round((b - a) / a * 1000) / 10;
  if (Math.abs(parseFloat(q.options[q.answer]) - v) > 0.11) bad('num change value', q);
}
// series: recompute arithmetic answers
for (let s = 1; s <= 3000; s++) {
  const q = generateSeries(s);
  if (!q.id.includes('-arithmetic-')) continue;
  const nums = q.stem.split('?')[1].split(',').map(x => x.trim()).filter(x => x && x !== '?').map(Number);
  const d = nums[1] - nums[0];
  if (Number(q.options[q.answer].replace(/,/g, '')) !== nums[nums.length - 1] + d) bad('series arithmetic', q);
}
// abstract panels: every square drawn inside the panel, never more than 12, and options visually distinct
for (let s = 1; s <= 20000; s++) {
  const q = generateShapes(s);
  const sig = svg => {
    const sq = [...svg.matchAll(/<rect x="([-\d.]+)" y="[-\d.]+" width="6"/g)].map(m => Number(m[1]));
    if (sq.some(x => x < 0) || sq.length > 12) bad('abstract squares outside panel or > 12', q);
    return svg.replace(/<rect x="[-\d.]+" y="[-\d.]+" width="6"[^>]*>/g, '') + '#' + sq.length; // what the eye sees
  };
  const seen = new Set(q.options.map(sig));
  if (seen.size !== q.options.length) bad('abstract options look identical', q);
}
// numerical: no ties for "largest growth" questions
// counts offered as options must be possible counts
for (let s = 1; s <= 6000; s++) {
  const q = generateNumerical(s * 13);
  if (!/How many departments/.test(q.stem)) continue;
  const nDep = q.context.dataset.rows.length;
  if (q.options.some(o => Number(o) < 0 || Number(o) > nDep)) bad('impossible count option', q);
}
for (let s = 1; s <= 6000; s++) {
  const q = generateNumerical(s * 13);
  if (!q.tags.includes('largest-growth') && !/highest percentage growth|largest percentage/i.test(q.stem)) continue;
  const ds = q.context.dataset; const yy = q.stem.match(/between (\d{4}) and (\d{4})/);
  if (!yy) continue;
  const i0 = ds.columns.indexOf(yy[1]), i1 = ds.columns.indexOf(yy[2]);
  const g = ds.rows.map(r => Math.round((Number(r[i1]) / Number(r[i0]) - 1) * 1e6));
  const max = Math.max(...g);
  if (g.filter(x => x === max).length > 1) bad('largest growth tie', q);
}
console.log(`checked ${n} generated items, ${fails} failures`);
process.exit(fails ? 1 : 0);
