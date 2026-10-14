// Tests for the real-market-data generator (assets/js/gen/markets.js).
// Every answer is recomputed here, independently, from the raw series: the solvers parse the stem,
// look the numbers up in M by date, round them to display precision and redo the arithmetic.
import fs from 'fs';
import { MARKET_FAMILIES, marketFamiliesAvailable, generateMarket } from '../assets/js/gen/markets.js';

const ROOT = new URL('..', import.meta.url).pathname;
const FIXTURE = JSON.parse(fs.readFileSync(ROOT + 'tests/fixtures/markets.sample.json', 'utf8'));
const REAL_PATH = ROOT + 'data/news/markets.json';
// MARKETS_SEEDS=50000 node tests/markets.test.js runs the deep sweep (seeds 0..N-1 for every family).
const SEEDS = Number(process.env.MARKETS_SEEDS) || 3000;
const EMDASH = String.fromCharCode(0x2014);

let fails = 0, checked = 0;
const fail = (msg, q) => {
  fails++;
  if (fails <= 40) console.log('FAIL', msg, q ? JSON.stringify({ id: q.id, stem: q.stem, options: q.options, answer: q.answer }).slice(0, 600) : '');
};
const assert = (cond, msg, q) => { if (!cond) fail(msg, q); };

// ---------- independent data access ----------
// Display precision convention: rates with 3 decimals (ESTR), FX 4 decimals (JPY 2), everything else 2.
const DEC = { ESTR: 3, EURUSD: 4, EURGBP: 4, EURCHF: 4, EURJPY: 2 };
const decOf = k => DEC[k] ?? 2;
const roundHalfUp = (x, d) => { const f = 10 ** d; return Math.round((x + Number.EPSILON) * f) / f; };
const NF = [];
const fixed = (x, d) => (NF[d] ||= new Intl.NumberFormat('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d })).format(roundHalfUp(x, d) + 0);
const CCY_NAME = { USD: 'US dollar', GBP: 'pound', JPY: 'yen', CHF: 'Swiss franc' };
const NAMES = { SP500: 'S&P 500', NASDAQ: 'Nasdaq Composite', DJIA: 'Dow Jones Industrial Average', VIX: 'VIX volatility index', GOLD: 'Gold' };

const CACHE = new WeakMap();
function S(M, key) {
  if (!CACHE.has(M)) CACHE.set(M, {});
  const c = CACHE.get(M);
  if (c[key]) return c[key];
  const pts = (M.series[key].points || []).filter(p => Array.isArray(p) && /^\d{4}-\d{2}-\d{2}$/.test(p[0]) && typeof p[1] === 'number' && isFinite(p[1]));
  pts.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const dates = pts.map(p => p[0]);
  const vals = pts.map(p => roundHalfUp(p[1], decOf(key)));
  return (c[key] = { dates, vals, at: d => { const i = dates.indexOf(d); if (i < 0) throw new Error(`${key} has no ${d}`); return vals[i]; }, idx: d => dates.indexOf(d) });
}
const nameOf = (M, k) => String(M.series[k].name || NAMES[k] || k).trim();
function keyByName(M, name) {
  const ks = Object.keys(M.series).filter(k => nameOf(M, k) === name || nameOf(M, k).replace(/^(Effective|The)\b/, w => w.toLowerCase()) === name);
  if (ks.length !== 1) throw new Error(`cannot map name "${name}"`);
  return ks[0];
}

// ---------- parsing ----------
const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const DT = '(\\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \\d{4})';
const iso = s => { const m = s.match(/^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/); if (!m) throw new Error('bad date ' + s); return `${m[3]}-${String(MON[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}`; };
const dmy = isoDate => { const m = Object.keys(MON)[Number(isoDate.slice(5, 7)) - 1]; return `${Number(isoDate.slice(8, 10))} ${m} ${isoDate.slice(0, 4)}`; };
const num = s => parseFloat(String(s).replace(/[^0-9.+-]/g, ''));
const must = (re, s) => { const m = String(s).match(re); if (!m) throw new Error(`stem does not match ${re}`); return m; };

// table check: rows [date, ...cells], colKeys maps column index -> series key
function checkDateTable(q, M, colKeys) {
  const ds = q.context.dataset;
  for (const row of ds.rows) {
    const d = iso(row[0]);
    for (const [ci, k] of Object.entries(colKeys)) {
      const exp = fixed(S(M, k).at(d), decOf(k));
      if (row[ci] !== exp) fail(`table cell ${k} ${d}: ${row[ci]} != ${exp}`, q);
    }
  }
  return ds.rows.map(r => iso(r[0]));
}
const consecutive = (M, k, dates) => { const i0 = S(M, k).idx(dates[0]); return i0 >= 0 && dates.every((d, j) => S(M, k).dates[i0 + j] === d); };

// the explanation must read the right cells: step i (or all steps when i is null) contains every listed figure
function stepHas(q, i, figs, what) {
  const t = i === null ? q.explanation.steps.join(' ') : q.explanation.steps[i] || '';
  for (const f of figs) if (!t.includes(f)) { fail(`${what}: explanation step ${i} does not show ${f}`, q); return; }
}
const fx2 = (M, k, d) => fixed(S(M, k).at(d), decOf(k));
const tableSpan = (q, d0, d1, what) => { const r = q.context.dataset.rows; assert(iso(r[0][0]) === d0 && iso(r[r.length - 1][0]) === d1, `${what}: table must start and end on the stem dates`, q); };

// ---------- independent solvers: return { value, dec } (numeric) or { text } (exact option expected) ----------
const SOLVE = {
  'index-5d'(q, M) {
    const m = must(new RegExp(`percentage change in the (.+) over the 5 trading days to ${DT}\\?$`), q.stem);
    const k = keyByName(M, m[1]), s = S(M, k), e = s.idx(iso(m[2]));
    const dates = checkDateTable(q, M, { 1: k });
    assert(dates.length === 7 && consecutive(M, k, dates) && dates[6] === s.dates[e], 'index-5d table window', q);
    const a = s.vals[e - 5], b = s.vals[e];
    stepHas(q, 1, [fixed(a, decOf(k)), fixed(b, decOf(k)), dmy(s.dates[e - 5])], 'index-5d');
    return { value: (b - a) / a * 100, dec: 2 };
  },
  'best-worst'(q, M) {
    const m = must(new RegExp(`had the (highest|lowest) percentage return between ${DT} and ${DT}\\?$`), q.stem);
    const d0 = iso(m[2]), d1 = iso(m[3]);
    const rows = q.context.dataset.rows;
    const keys = rows.map(r => keyByName(M, r[0]));
    rows.forEach((r, i) => { assert(r[2] === fixed(S(M, keys[i]).at(d0), decOf(keys[i])) && r[3] === fixed(S(M, keys[i]).at(d1), decOf(keys[i])), 'best-worst table values', q); });
    const ret = keys.map(k => S(M, k).at(d1) / S(M, k).at(d0) - 1);
    keys.forEach((k, i) => stepHas(q, i, [rows[i][0], fx2(M, k, d0), fx2(M, k, d1)], 'best-worst'));
    const sorted = ret.slice().sort((a, b) => (m[1] === 'highest' ? b - a : a - b));
    assert(Math.abs(sorted[0] - sorted[1]) * 100 >= 0.05, 'best-worst winner not clear', q);
    return { text: rows[ret.indexOf(sorted[0])][0] };
  },
  portfolio(q, M) {
    const m = must(/puts (\d+)% of a portfolio in (?:the )?(.+) and (\d+)% in (?:the )?(.+), with no rebalancing/, q.stem);
    const d0 = iso(must(new RegExp(`At the close on ${DT},`), q.stem)[1]), d1 = iso(must(new RegExp(`up to ${DT}\\?$`), q.stem)[1]);
    const w1 = +m[1], w2 = +m[3], k1 = keyByName(M, m[2]), k2 = keyByName(M, m[4]);
    assert(w1 + w2 === 100, 'portfolio weights sum', q);
    const r1 = S(M, k1).at(d1) / S(M, k1).at(d0) - 1, r2 = S(M, k2).at(d1) / S(M, k2).at(d0) - 1;
    stepHas(q, 0, [fx2(M, k1, d0), fx2(M, k1, d1)], 'portfolio asset 1');
    stepHas(q, 1, [fx2(M, k2, d0), fx2(M, k2, d1)], 'portfolio asset 2');
    return { value: (w1 * r1 + w2 * r2), dec: 2 };
  },
  'range-pct'(q, M) {
    const m = must(/lowest close of (?:the )?(.+), as a percentage of the lowest close\?$/, q.stem);
    const k = keyByName(M, m[1]);
    const dates = checkDateTable(q, M, { 1: k });
    assert(dates.length === 10 && consecutive(M, k, dates), 'range window not 10 consecutive closes', q);
    const v = dates.map(d => S(M, k).at(d));
    const hi = Math.max(...v), lo = Math.min(...v);
    stepHas(q, 0, [fixed(hi, decOf(k)), fixed(lo, decOf(k))], 'range-pct');
    return { value: (hi - lo) / lo * 100, dec: 2 };
  },
  'commodity-eur'(q, M) {
    const m = must(new RegExp(`price of (.+) in EUR per (barrel|troy ounce) on ${DT}\\?$`), q.stem);
    const k = keyByName(M, m[1]), d = iso(m[3]);
    checkDateTable(q, M, { 1: k, 2: 'EURUSD' });
    assert(q.options.every(o => o.startsWith('EUR ')), 'commodity-eur option prefix', q);
    stepHas(q, 0, [dmy(d), `= ${fx2(M, k, d)} USD`, `EUR/USD = ${fx2(M, 'EURUSD', d)}`], 'commodity-eur');
    return { value: S(M, k).at(d) / S(M, 'EURUSD').at(d), dec: 2 };
  },
  'fx-convert'(q, M) {
    const m = must(new RegExp(`reference rate for ${DT} shown in the table, how much is ([A-Z]{3}) ([\\d,]+) in ([A-Z]{3})\\?$`), q.stem);
    const d = iso(m[1]), from = m[2], amt = num(m[3]), to = m[4];
    assert((from === 'EUR') !== (to === 'EUR'), 'fx-convert one side must be EUR', q);
    const ccy = from === 'EUR' ? to : from, k = 'EUR' + ccy, rate = S(M, k).at(d);
    checkDateTable(q, M, { 1: k });
    assert(q.options.every(o => o.startsWith(to + ' ')), 'fx-convert option currency', q);
    stepHas(q, 0, [dmy(d), `1 EUR = ${fx2(M, k, d)} ${ccy}`], 'fx-convert');
    return { value: from === 'EUR' ? amt * rate : amt / rate, dec: 0 };
  },
  'points-pct'(q, M) {
    const m = must(new RegExp(`^On ${DT} the (.+) closed at ([\\d,.]+), (up|down) ([\\d,.]+) points on the day\\.`), q.stem);
    const d = iso(m[1]), k = keyByName(M, m[2]), s = S(M, k), e = s.idx(d);
    const close = s.vals[e], prev = s.vals[e - 1];
    assert(Math.abs(num(m[3]) - close) < 1e-9, 'points-pct close', q);
    const pts = (m[4] === 'up' ? 1 : -1) * num(m[5]);
    assert(Math.abs(close - prev - pts) < 1e-6, 'points-pct points do not match the previous close', q);
    // the trap quotes the result of the wrong base (today's close): it must be the real number
    const wrongBase = pts / close * 100, rightBase = pts / prev * 100;
    const tp = [...q.explanation.trap.matchAll(/([+-]?\d+\.(\d+))%/g)].map(x => ({ v: parseFloat(x[1]), tol: 0.5 * 10 ** -x[2].length + 1e-9 }));
    assert(tp.length ? Math.abs(tp[0].v - wrongBase) <= tp[0].tol : Math.abs(wrongBase - rightBase) < 5e-6, 'points-pct trap: wrong-base figure is not pts / close', q);
    if (tp.length >= 2) assert(Math.abs(tp[1].v - rightBase) <= tp[1].tol && tp[0].v !== tp[1].v, 'points-pct trap: comparison figures', q);
    stepHas(q, 0, [`= ${fixed(prev, decOf(k))}.`], 'points-pct previous close');
    return { value: (close - prev) / prev * 100, dec: 2 };
  },
  'vix-change'(q, M) {
    const m = must(new RegExp(`between the close on ${DT} and the close on ${DT}\\?$`), q.stem);
    const d0 = iso(m[1]), d1 = iso(m[2]);
    const dates = checkDateTable(q, M, { 1: 'VIX' });
    assert(dates[0] === d0 && dates[dates.length - 1] === d1 && consecutive(M, 'VIX', dates), 'vix table window', q);
    stepHas(q, 0, [fx2(M, 'VIX', d0), fx2(M, 'VIX', d1)], 'vix-change');
    return { value: (S(M, 'VIX').at(d1) / S(M, 'VIX').at(d0) - 1) * 100, dec: 1 };
  },
  'yield-bps'(q, M) {
    const m = must(new RegExp(`did the (.+) change between ${DT} and ${DT}\\?$`), q.stem);
    const k = keyByName(M, m[1]);
    checkDateTable(q, M, { 1: k });
    tableSpan(q, iso(m[2]), iso(m[3]), 'yield-bps');
    stepHas(q, 0, [`${fx2(M, k, iso(m[2]))}%`, `${fx2(M, k, iso(m[3]))}%`], 'yield-bps');
    return { value: (S(M, k).at(iso(m[3])) - S(M, k).at(iso(m[2]))) * 100, dec: 0 };
  },
  'estr-interest'(q, M) {
    const m = must(new RegExp(`deposits EUR (\\d+) million for (\\d+) days at a fixed rate equal to the .+ for ${DT} shown in the table \\(simple interest, ACT/360\\)`), q.stem);
    checkDateTable(q, M, { 1: 'ESTR' });
    stepHas(q, 0, [dmy(iso(m[3])), `${fx2(M, 'ESTR', iso(m[3]))}%`], 'estr-interest');
    assert(!q.options[q.answer].startsWith('EUR -') && S(M, 'ESTR').at(iso(m[3])) > 0, 'estr-interest with a non-positive rate', q);
    return { value: +m[1] * 1e6 * S(M, 'ESTR').at(iso(m[3])) / 100 * +m[2] / 360, dec: 0 };
  },
  'curve-us'(q, M) { return curve(q, M, 'US10Y', 'US2Y'); },
  'curve-ea'(q, M) { return curve(q, M, 'EA10Y', 'EA2Y'); },
  'bond-duration'(q, M) {
    const m = must(new RegExp(`modified duration of ([\\d.]+) \\(a hypothetical assumption, not market data\\)\\. If its yield moves by the same amount as the (.+) between ${DT} and ${DT}, what`), q.stem);
    const dur = +m[1], k = keyByName(M, m[2]);
    assert(/hypothetical|assumption/i.test(q.context.dataset.note), 'duration assumption not labelled in note', q);
    checkDateTable(q, M, { 1: k });
    tableSpan(q, iso(m[3]), iso(m[4]), 'bond-duration');
    stepHas(q, 0, [fx2(M, k, iso(m[3])), fx2(M, k, iso(m[4]))], 'bond-duration');
    const dy = S(M, k).at(iso(m[4])) - S(M, k).at(iso(m[3])); // in percentage points
    return { value: -dur * dy, dec: 2 };
  },
  'estr-dfr'(q, M) { return pair(q, M, 'ESTR', 'ECBDFR', 1); },
  'bill-ff'(q, M) { return pair(q, M, 'US3M', 'FEDFUNDS', 0); },
  'hy-spread'(q, M) {
    const m = must(new RegExp(`between ${DT} and ${DT}, and did credit spreads widen or tighten\\?$`), q.stem);
    checkDateTable(q, M, { 1: 'HYOAS' });
    tableSpan(q, iso(m[1]), iso(m[2]), 'hy-spread');
    stepHas(q, 0, [`${fx2(M, 'HYOAS', iso(m[1]))}%`, `${fx2(M, 'HYOAS', iso(m[2]))}%`], 'hy-spread');
    const bps = (S(M, 'HYOAS').at(iso(m[2])) - S(M, 'HYOAS').at(iso(m[1]))) * 100;
    return { value: bps, dec: 0, label: bps > 0 ? 'widened' : 'tightened', labelRe: /^([+-]?[\d.,]+) bps, (widened|tightened)$/ };
  },
  'cross-rate'(q, M) {
    const m = must(new RegExp(`rates for ${DT} in the table, what is the implied (GBP/USD|USD/JPY|USD/CHF) exchange rate`), q.stem);
    const d = iso(m[1]), u = S(M, 'EURUSD').at(d);
    const k = { 'GBP/USD': 'EURGBP', 'USD/JPY': 'EURJPY', 'USD/CHF': 'EURCHF' }[m[2]];
    checkDateTable(q, M, { 1: 'EURUSD', 2: k });
    stepHas(q, 0, [dmy(d), `1 EUR = ${fx2(M, 'EURUSD', d)} USD`, `1 EUR = ${fx2(M, k, d)} ${k.slice(3)}`], 'cross-rate');
    if (k === 'EURGBP') return { value: u / S(M, 'EURGBP').at(d), dec: 4 };
    return { value: S(M, k).at(d) / u, dec: k === 'EURJPY' ? 2 : 4 };
  },
  'fx-move'(q, M) {
    const m = must(new RegExp(`EUR/([A-Z]{3}) \\([A-Z]{3} per EUR\\) moved from ([\\d.,]+) on ${DT} to ([\\d.,]+) on ${DT}\\. Which statement is correct\\?$`), q.stem);
    const k = 'EUR' + m[1], a = S(M, k).at(iso(m[3])), b = S(M, k).at(iso(m[5]));
    assert(num(m[2]) === a && num(m[4]) === b, 'fx-move stem levels', q);
    checkDateTable(q, M, { 1: k });
    const pct = (b / a - 1) * 100;
    tableSpan(q, iso(m[3]), iso(m[5]), 'fx-move');
    stepHas(q, 1, [`${m[4]} / ${m[2]}`], 'fx-move');
    const STMT = /^The (euro|US dollar|pound|yen|Swiss franc) (strengthened|weakened) by ([\d.]+)% against the (euro|US dollar|pound|yen|Swiss franc)$/;
    const keyed = must(STMT, q.options[q.answer]);
    assert(keyed[1] === 'euro' && keyed[4] === CCY_NAME[m[1]], 'fx-move keyed option currency', q);
    assert(keyed[2] === (pct > 0 ? 'strengthened' : 'weakened'), 'fx-move direction', q);
    for (const [i, o] of q.options.entries()) {
      if (i === q.answer) continue;
      const om = o.match(STMT);
      if (!om) { fail('fx-move option format', q); continue; }
      if (om[1] === 'euro' && om[2] === keyed[2] && Math.abs(num(o) - Math.abs(pct)) <= 0.005 + 1e-7) fail('fx-move ambiguous option', q);
      // a statement about the other currency must be false: it can only claim the same direction as the euro
      if (om[1] !== 'euro' && om[2] !== keyed[2]) fail('fx-move: a true statement about the other currency is offered as a distractor', q);
    }
    return { value: Math.abs(pct), dec: 2, only: 'keyed' };
  },
};
function curve(q, M, k10, k2) {
  const m = must(new RegExp(`yield spread on ${DT}, and was the curve inverted\\?$`), q.stem);
  const d = iso(m[1]);
  checkDateTable(q, M, { 1: k2, 2: k10 });
  stepHas(q, 0, [dmy(d), `10Y = ${fx2(M, k10, d)}%`, `2Y = ${fx2(M, k2, d)}%`], 'curve');
  const bps = (S(M, k10).at(d) - S(M, k2).at(d)) * 100;
  return { value: bps, dec: 0, label: bps < 0 ? 'inverted' : 'not inverted', labelRe: /^([+-]?[\d.,]+) bps, (inverted|not inverted)$/ };
}
function pair(q, M, k1, k2, dec) {
  const m = must(new RegExp(`on ${DT}, in basis points\\?$`), q.stem);
  const d = iso(m[1]);
  checkDateTable(q, M, { 1: k1, 2: k2 });
  stepHas(q, 0, [dmy(d), `= ${fx2(M, k1, d)}%`, `= ${fx2(M, k2, d)}%`], 'pair spread');
  return { value: (S(M, k1).at(d) - S(M, k2).at(d)) * 100, dec };
}

// ---------- arithmetic written in the explanations ----------
// Every "<expression> = <number>" in steps/shortcut/trap is re-evaluated with the numbers as printed, so the
// explanation can never show arithmetic that does not add up (e.g. intermediate values rounded too coarsely).
const ARITH_CH = /[\d.,%()+\-−×/ ]/;
function lhsBefore(txt, at) {
  let i = at;
  while (i > 0 && ARITH_CH.test(txt[i - 1]) && !(txt[i - 1] === ',' && txt[i] === ' ')) i--;
  return txt.slice(i, at);
}
function evalExpr(src) {
  const toks = src.match(/\d[\d,]*(?:\.\d+)?|[+\-−×/()]/g) || [];
  let pos = 0, binops = 0;
  const peek = () => toks[pos], next = () => toks[pos++];
  function prim() {
    const t = next();
    if (t === undefined) throw new Error('eof');
    if (t === '(') { const v = sum(); if (next() !== ')') throw new Error(')'); return v; }
    if (t === '+') return prim();
    if (t === '-' || t === '−') return -prim();
    if (/^\d/.test(t)) return parseFloat(t.replace(/,/g, ''));
    throw new Error('token ' + t);
  }
  function prod() { let v = prim(); while (peek() === '×' || peek() === '/') { const o = next(); binops++; const w = prim(); v = o === '×' ? v * w : v / w; } return v; }
  function sum() { let v = prod(); while (peek() === '+' || peek() === '-' || peek() === '−') { const o = next(); binops++; const w = prod(); v = o === '+' ? v + w : v - w; } return v; }
  const v = sum();
  if (pos !== toks.length) throw new Error('trailing');
  return { v, binops };
}
function checkArithmetic(q) {
  const e = q.explanation;
  for (const txt of [...e.steps, e.shortcut, e.trap]) {
    for (let at = txt.indexOf('='); at >= 0; at = txt.indexOf('=', at + 1)) {
      const lhs = lhsBefore(txt, at);
      const rm = txt.slice(at + 1).match(/^\s*([+\-−]?\d[\d,]*(?:\.\d+)?)(%?)/);
      if (!rm || !/\d/.test(lhs)) continue;
      let r;
      try { r = evalExpr(lhs); } catch { continue; }
      if (!r.binops) continue;
      const c = parseFloat(rm[1].replace(/,/g, '').replace('−', '-'));
      const dec = (rm[1].split('.')[1] || '').length, tol = 0.5 * 10 ** -dec + 1e-9;
      // "a / b − 1 = x%" is a ratio written as a percentage
      const v = rm[2] && !lhs.includes('%') && !/×\s*100\b/.test(lhs) ? r.v * 100 : r.v;
      if (!(Math.abs(v - c) <= tol)) fail(`explanation arithmetic "${lhs.trim()} = ${rm[1]}${rm[2]}" (exact ${v})`, q);
    }
  }
}
// Every data-like number in the steps (2+ decimals or a thousands separator) must come from the table, the stem,
// the options, or be the result of arithmetic written earlier in the explanation ("= x", "differenza x").
function checkStepNumbers(q) {
  const NUM = /[+\-−]?\d[\d,]*(?:\.\d+)?/g;
  const val = t => Math.abs(parseFloat(t.replace(/,/g, '').replace('−', '-')));
  const known = [];
  const addAll = x => { for (const m of String(x).matchAll(NUM)) known.push(val(m[0])); };
  q.context.dataset.rows.forEach(r => r.forEach(addAll));
  addAll(q.stem); q.options.forEach(addAll);
  for (const m of q.stem.matchAll(/(\d+(?:\.\d+)?)%/g)) known.push(parseFloat(m[1]) / 100);
  const e = q.explanation, texts = [...e.steps, e.shortcut, e.trap];
  for (const t of texts) for (const m of t.matchAll(/(?:=|≈|differenza|cioè|risultato) \(?([+\-−]?\d[\d,]*(?:\.\d+)?)/gi)) known.push(val(m[1]));
  for (const t of e.steps) {
    for (const m of t.matchAll(NUM)) {
      const tok = m[0];
      if (!/\.\d\d|\d,\d{3}/.test(tok)) continue;
      const dec = (tok.split('.')[1] || '').length, v = val(tok), tol = 0.5 * 10 ** -dec + 1e-9;
      if (!known.some(k => Math.abs(k - v) <= tol)) { fail(`step number ${tok} not found in table/stem/earlier arithmetic: ${t.slice(0, 140)}`, q); return; }
    }
  }
}
// Italian text quality: en-GB numbers everywhere (no "0,01"), elided articles before 8 and 11 ("dell'8", "l'11").
function checkItalian(q) {
  const e = q.explanation;
  for (const txt of [...e.steps, e.shortcut, e.trap, e.rule]) {
    if (/\d,\d{1,2}(?!\d)/.test(txt)) fail('Italian decimal comma in explanation: ' + txt.slice(0, 120), q);
    if (/\b(?:il|del|al|dal) (?:8|11) [A-Z][a-z]{2} \d{4}/.test(txt)) fail('missing elision before 8/11: ' + txt.slice(0, 120), q);
  }
  for (const txt of q.explanation.steps) if (/[\u2212×/] [+-]\d/.test(txt)) fail('signed operand without brackets: ' + txt.slice(0, 120), q);
  for (const o of q.options) if (/(^|[^\d.,])[+-]0(?:\.0+)?(?![\d.,])/.test(o)) fail('signed zero in option ' + o, q);
}

// ---------- generic validity ----------
const decimalsOf = o => { const m = String(o).match(/\d\.(\d+)/); return m ? m[1].length : 0; };
function walkStrings(x, out = []) {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) x.forEach(y => walkStrings(y, out));
  else if (x && typeof x === 'object') Object.values(x).forEach(y => walkStrings(y, out));
  return out;
}
function validate(q, fam, seed) {
  checked++;
  assert(q.id === `mkt-${fam.id}-${seed}`, 'id', q);
  assert(q.skill === fam.skill && ['numerical', 'mental', 'markets'].includes(q.skill), 'skill', q);
  assert(q.type === 'mcq' && q.generated === true && q.realData === true, 'type/generated/realData', q);
  assert([1, 2, 3].includes(q.level), 'level', q);
  assert(Number.isFinite(q.timeTarget) && q.timeTarget > 0, 'timeTarget', q);
  assert(typeof q.stem === 'string' && q.stem.length > 20, 'stem', q);
  assert(Array.isArray(q.options) && q.options.length >= 4 && q.options.length <= 5, 'options count', q);
  assert(q.options.every(o => typeof o === 'string' && o.trim()), 'option strings', q);
  assert(new Set(q.options).size === q.options.length, 'duplicate options', q);
  assert(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length, 'answer index', q);
  const e = q.explanation || {};
  assert(Array.isArray(e.steps) && e.steps.length >= 2 && e.steps.length <= 6 && e.steps.every(s => typeof s === 'string' && s), 'explanation.steps', q);
  for (const k of ['shortcut', 'trap', 'rule']) assert(typeof e[k] === 'string' && e[k].length > 10, 'explanation.' + k, q);
  assert(Array.isArray(q.tags) && q.tags.includes('real-data') && q.tags.includes(fam.id), 'tags', q);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(q.asOf || ''), 'asOf', q);
  const c = q.context;
  assert(c && c.kind === 'dataset' && c.dataset, 'context', q);
  const ds = c.dataset;
  assert(typeof ds.title === 'string' && ds.title && ['table', 'line', 'bar'].includes(ds.kind), 'dataset title/kind', q);
  assert(Array.isArray(ds.columns) && Array.isArray(ds.rows) && ds.rows.length > 0 && ds.rows.every(r => Array.isArray(r) && r.length === ds.columns.length), 'dataset shape', q);
  assert(/^Sources?: .+, data to .+\. Real market data\./.test(ds.note || '') && ds.note.includes(`data to ${dmy(q.asOf)}.`), 'dataset note', q);
  for (const s of walkStrings(q)) {
    if (/undefined|NaN|Infinity|\[object/.test(s)) { fail('bad token in string: ' + s.slice(0, 120), q); break; }
    if (s.includes(EMDASH)) { fail('em dash', q); break; }
  }
}

function checkItem(q, fam, M, seed) {
  validate(q, fam, seed);
  checkArithmetic(q);
  checkStepNumbers(q);
  checkItalian(q);
  let sol;
  try { sol = SOLVE[fam.id](q, M); } catch (err) { fail(`solver error: ${err.message}`, q); return; }
  const keyed = q.options[q.answer];
  const stepsText = q.explanation.steps.join(' ');
  if (sol.text !== undefined) {
    assert(keyed === sol.text, `keyed "${keyed}" != expected "${sol.text}"`, q);
    assert(stepsText.includes(sol.text), 'steps do not mention the answer', q);
    return;
  }
  if (!Number.isFinite(sol.value)) { fail('solver produced non-finite value', q); return; }
  const tol = 0.5 * 10 ** -sol.dec + 1e-7;
  if (sol.labelRe) {
    const km = keyed.match(sol.labelRe);
    if (!km) { fail('keyed option format', q); return; }
    assert(Math.abs(num(km[1]) - sol.value) <= tol, `keyed ${keyed} vs expected ${sol.value}`, q);
    assert(km[2] === sol.label, `label ${km[2]} vs expected ${sol.label}`, q);
    for (const [i, o] of q.options.entries()) {
      const om = o.match(sol.labelRe);
      if (i !== q.answer && om && om[2] === sol.label && Math.abs(num(om[1]) - sol.value) <= tol) fail('ambiguous option', q);
    }
  } else if (sol.only !== 'keyed') {
    const vals = q.options.map(num);
    assert(Math.abs(vals[q.answer] - sol.value) <= tol, `keyed ${keyed} vs expected ${sol.value.toFixed(sol.dec + 3)}`, q);
    vals.forEach((v, i) => { if (i !== q.answer && Math.abs(v - sol.value) <= tol) fail('ambiguous option ' + q.options[i], q); });
    const dec = q.options.map(decimalsOf);
    assert(dec.every(x => x === dec[0]) && dec[0] === sol.dec, 'inconsistent decimals in options', q);
    const shape = o => o.replace(/[+-]?[\d,]+(\.\d+)?/g, '#');
    assert(q.options.every(o => shape(o) === shape(keyed)), 'inconsistent option format', q);
  } else {
    assert(Math.abs(num(keyed) - sol.value) <= tol, `keyed ${keyed} vs expected ${sol.value}`, q);
  }
  const core = (keyed.match(/\d[\d,]*(?:\.\d+)?/) || [''])[0];
  assert(core && stepsText.includes(core), `steps do not contain keyed number ${core}`, q);
}

function runAll(M, label, { strict }) {
  const avail = new Set(marketFamiliesAvailable(M).map(f => f.id));
  console.log(`[${label}] available families: ${avail.size}/${MARKET_FAMILIES.length}`);
  if (strict) assert(avail.size === MARKET_FAMILIES.length, `${label}: not all families available`);
  const stats = [];
  for (const fam of MARKET_FAMILIES) {
    if (!avail.has(fam.id)) { stats.push(`${fam.id}: unavailable`); assert(generateMarket(1, M, { family: fam.id }) === null, `${fam.id} unavailable but generated`); continue; }
    let nulls = 0, n = 0;
    const asOf = new Set(), sigs = new Set(), modes = new Set(), answers = new Array(5).fill(0);
    for (let seed = 0; seed < SEEDS; seed++) {
      const q = generateMarket(seed, M, { family: fam.id });
      if (!q) { nulls++; continue; }
      n++; asOf.add(q.asOf); sigs.add(q.stem + JSON.stringify(q.context.dataset.rows)); answers[q.answer]++;
      if (fam.id === 'best-worst') modes.add(/highest/.test(q.stem) ? 'best' : 'worst');
      if (fam.id === 'fx-convert') modes.add(/how much is EUR/.test(q.stem) ? 'from-eur' : 'to-eur');
      checkItem(q, fam, M, seed);
    }
    stats.push(`${fam.id}: ${n} items, ${nulls} null, ${asOf.size} end dates, ${sigs.size} distinct questions, answer slots ${answers.join('/')}`);
    if (strict) {
      assert(nulls === 0, `${label} ${fam.id}: ${nulls} null items`);
      assert(asOf.size >= 12 && sigs.size >= 30, `${label} ${fam.id}: too little variation (${asOf.size} dates, ${sigs.size} questions)`); // windows end in the last ~15 sessions
      assert(answers.filter(x => x > 0).length >= 4, `${label} ${fam.id}: answer position not shuffled`);
      if (['best-worst', 'fx-convert'].includes(fam.id)) assert(modes.size === 2, `${label} ${fam.id}: only one question mode generated`);
    } else {
      assert(nulls <= SEEDS * 0.05, `${label} ${fam.id}: too many nulls (${nulls})`);
    }
  }
  console.log(stats.map(s => '  ' + s).join('\n'));
  // skill filter and mixed generation
  for (const skill of ['numerical', 'mental', 'markets']) {
    for (let seed = 1; seed <= 300; seed++) {
      const q = generateMarket(seed, M, { skill });
      if (!q) { if (MARKET_FAMILIES.some(f => f.skill === skill && avail.has(f.id))) fail(`${label}: null for skill ${skill}`); break; }
      assert(q.skill === skill, `${label}: skill filter ${skill} returned ${q.skill}`, q);
      const fam = MARKET_FAMILIES.find(f => q.id.startsWith(`mkt-${f.id}-`) && q.id === `mkt-${f.id}-${seed}`);
      if (fam) checkItem(q, fam, M, seed); else fail('unknown family in id', q);
    }
  }
  const seen = new Set();
  for (let seed = 1; seed <= 1500; seed++) { const q = generateMarket(seed, M); if (q) seen.add(q.tags[1]); }
  assert(seen.size === avail.size, `${label}: mixed generation covered ${seen.size}/${avail.size} families`);
  const a = JSON.stringify(generateMarket(42, M)), b = JSON.stringify(generateMarket(42, M));
  assert(a === b, `${label}: not deterministic for the same seed`);
}

// ---------- 1. fixture ----------
assert(MARKET_FAMILIES.length >= 12, 'at least 12 families');
assert(new Set(MARKET_FAMILIES.map(f => f.id)).size === MARKET_FAMILIES.length, 'family ids unique');
for (const f of MARKET_FAMILIES) {
  assert(f.id && f.name && ['numerical', 'mental', 'markets'].includes(f.skill) && Array.isArray(f.needs), `family meta ${f.id}`);
  assert(SOLVE[f.id], `no independent solver for ${f.id}`);
  assert(!JSON.stringify(f).includes(EMDASH), `em dash in family ${f.id}`);
}
runAll(FIXTURE, 'fixture', { strict: true });

// ---------- 2. real data, if the pipeline has produced it ----------
if (fs.existsSync(REAL_PATH)) {
  let REAL = null;
  try { REAL = JSON.parse(fs.readFileSync(REAL_PATH, 'utf8')); } catch (err) { fail('data/news/markets.json is not valid JSON: ' + err.message); }
  if (REAL) runAll(REAL, 'real data/news/markets.json', { strict: false });
} else console.log('[real] data/news/markets.json not found, skipped');

// ---------- 3. graceful degradation ----------
const clone = x => JSON.parse(JSON.stringify(x));
const subset = keys => ({ updated: FIXTURE.updated, series: Object.fromEntries(keys.filter(k => FIXTURE.series[k]).map(k => [k, clone(FIXTURE.series[k])])), failed: [] });
for (const bad of [undefined, null, {}, [], 'junk', 42, { series: null }, { series: {} }, { series: 'x' }, { series: { SP500: null } }, { series: { SP500: { points: 'x' } } }]) {
  let q, av;
  try { q = generateMarket(1, bad); av = marketFamiliesAvailable(bad); } catch (err) { fail('throws on malformed input: ' + err.message); continue; }
  assert(q === null, `expected null for ${JSON.stringify(bad)}`);
  assert(Array.isArray(av) && av.length === 0, `expected no families for ${JSON.stringify(bad)}`);
}
assert(generateMarket(1, FIXTURE, null) !== null, 'opts=null should work');
assert(generateMarket(1, FIXTURE, { family: 'no-such-family' }) === null, 'unknown family should give null');
assert(generateMarket(1, FIXTURE, { skill: 'verbal' }) === null, 'unknown skill should give null');
// too short
{
  const M = subset(['SP500']); M.series.SP500.points = M.series.SP500.points.slice(-3);
  assert(marketFamiliesAvailable(M).length === 0 && generateMarket(5, M) === null && generateMarket(5, M, { family: 'index-5d' }) === null, 'too-short series should give null');
}
// only FRED series: ECB/Yahoo-based families must be unavailable, the others must still work
{
  const fred = Object.keys(FIXTURE.series).filter(k => FIXTURE.series[k].source === 'FRED');
  const M = subset(fred);
  const ids = new Set(marketFamiliesAvailable(M).map(f => f.id));
  for (const id of ['curve-ea', 'estr-dfr', 'estr-interest', 'fx-convert', 'fx-move', 'cross-rate', 'commodity-eur']) {
    assert(!ids.has(id), `${id} should be unavailable without ECB data`);
    assert(generateMarket(3, M, { family: id }) === null, `${id} should be null without ECB data`);
  }
  for (const id of ['index-5d', 'best-worst', 'portfolio', 'curve-us', 'bill-ff', 'hy-spread', 'vix-change', 'bond-duration']) assert(ids.has(id), `${id} should be available with FRED only`);
  for (let seed = 1; seed <= 400; seed++) {
    const q = generateMarket(seed, M);
    const fam = q && MARKET_FAMILIES.find(f => q.id === `mkt-${f.id}-${seed}`);
    if (!fam) { fail('FRED-only generation failed'); break; }
    checkItem(q, fam, M, seed);
  }
}
// missing EURUSD: conversions via other ECB rates still work, cross-rate and commodity-eur do not
{
  const M = subset(Object.keys(FIXTURE.series).filter(k => k !== 'EURUSD'));
  assert(generateMarket(7, M, { family: 'cross-rate' }) === null && generateMarket(7, M, { family: 'commodity-eur' }) === null, 'EURUSD missing should disable cross-rate and commodity-eur');
  for (let seed = 1; seed <= 200; seed++) { const q = generateMarket(seed, M, { family: 'fx-convert' }); if (!q) { fail('fx-convert without EURUSD'); break; } checkItem(q, MARKET_FAMILIES.find(f => f.id === 'fx-convert'), M, seed); }
}
// equity pool smaller than 4 assets: best-worst unavailable
{
  const M = subset(['SP500', 'NASDAQ', 'DJIA']);
  assert(generateMarket(2, M, { family: 'best-worst' }) === null, 'best-worst needs 4 assets');
  assert(generateMarket(2, M, { family: 'portfolio' }) !== null, 'portfolio works with 2+ assets');
}
// garbage points mixed with valid ones
{
  const M = subset(['VIX', 'HYOAS']);
  M.series.VIX.points = [['2026-01-01', '.'], ['bad-date', 5], null, ['2026-01-02', NaN], ['2026-01-05', null], ['2026-01-06', -3], ...M.series.VIX.points];
  M.series.HYOAS.points.splice(5, 0, ['2026-05-05', 'x'], ['2026-05-06']);
  const fv = MARKET_FAMILIES.find(f => f.id === 'vix-change'), fh = MARKET_FAMILIES.find(f => f.id === 'hy-spread');
  const clean = subset(['VIX', 'HYOAS']);
  for (let seed = 1; seed <= 300; seed++) {
    const a = generateMarket(seed, M, { family: 'vix-change' }), b = generateMarket(seed, M, { family: 'hy-spread' });
    if (!a || !b) { fail('garbage points broke generation'); break; }
    checkItem(a, fv, clean, seed); checkItem(b, fh, clean, seed);
  }
}
// inverted curve branch and negative spreads
{
  const M = subset(['US10Y', 'US2Y']);
  M.series.US2Y.points = M.series.US10Y.points.map(([d, v], i) => [d, Math.round((v + 0.3 + 0.1 * Math.sin(i)) * 100) / 100]);
  const fam = MARKET_FAMILIES.find(f => f.id === 'curve-us');
  let inverted = 0;
  for (let seed = 1; seed <= 500; seed++) { const q = generateMarket(seed, M, { family: 'curve-us' }); if (!q) { fail('inverted curve null'); break; } checkItem(q, fam, M, seed); if (q.options[q.answer].endsWith(', inverted')) inverted++; }
  assert(inverted === 500, `inverted branch: ${inverted}/500`);
}
// series without names fall back to built-in names and stay valid
{
  const M = subset(['SP500', 'VIX']); delete M.series.SP500.name; delete M.series.VIX.name;
  const q = generateMarket(9, M, { family: 'index-5d' });
  assert(q && q.stem.includes('S&P 500'), 'fallback name for SP500');
}

// ---------- 4. adversarial data ----------
const famById = id => MARKET_FAMILIES.find(f => f.id === id);
function sweep(M, label, ids, seeds, { maxNullShare = 1, mustNull = false } = {}) {
  const avail = new Set(marketFamiliesAvailable(M).map(f => f.id));
  for (const id of ids) {
    let nulls = 0;
    for (let seed = 0; seed < seeds; seed++) {
      let q;
      try { q = generateMarket(seed, M, { family: id }); } catch (err) { fail(`${label} ${id}: throws ${err.message}`); break; }
      if (!q) { nulls++; continue; }
      if (mustNull) { fail(`${label} ${id}: expected null`, q); break; }
      if (!avail.has(id)) { fail(`${label} ${id}: generated while unavailable`, q); break; }
      checkItem(q, famById(id), M, seed);
    }
    if (!mustNull && avail.has(id) && nulls > seeds * maxNullShare) fail(`${label} ${id}: ${nulls}/${seeds} null`);
  }
}
const mapPoints = (M, k, fn) => { M.series[k].points = M.series[k].points.map(([d, v], i) => [d, fn(v, i)]); };
// 4a. negative and near-zero rates (euro area 2014-2022 style): signs, brackets, spreads and labels must stay right
{
  const SHIFT = { US10Y: -3.6, US2Y: -3.7, US3M: -3.6, FEDFUNDS: -3.75, EA10Y: -2.85, EA2Y: -2.5, ESTR: -2.5, ECBDFR: -2.5 };
  const M = subset([...Object.keys(SHIFT), 'HYOAS']);
  for (const [k, dv] of Object.entries(SHIFT)) mapPoints(M, k, v => Math.round((v + dv) * 1e4) / 1e4);
  assert(S(M, 'ESTR').vals.every(v => v < 0) && S(M, 'EA2Y').vals.some(v => v < 0) && S(M, 'US2Y').vals.some(v => Math.abs(v) < 0.1), 'negative-rate fixture shape');
  sweep(M, 'negative rates', ['yield-bps', 'curve-us', 'curve-ea', 'bond-duration', 'estr-dfr', 'bill-ff', 'hy-spread'], 600, { maxNullShare: 0.05 });
  sweep(M, 'negative rates', ['estr-interest'], 200, { mustNull: true }); // no "interest earned" on a negative rate
}
// 4b. flat data: every series constant. Change-based families must give null, never a "0.00%" question.
{
  const M = clone(FIXTURE);
  for (const k of Object.keys(M.series)) { const last = M.series[k].points.at(-1)[1]; mapPoints(M, k, () => last); }
  const changeFams = ['index-5d', 'best-worst', 'portfolio', 'range-pct', 'points-pct', 'vix-change', 'yield-bps', 'bond-duration', 'hy-spread', 'fx-move'];
  sweep(M, 'flat data', changeFams, 100, { mustNull: true });
  sweep(M, 'flat data', ['commodity-eur', 'fx-convert', 'cross-rate', 'estr-interest', 'curve-us', 'curve-ea', 'estr-dfr', 'bill-ff'], 200, { maxNullShare: 0 });
  for (let seed = 0; seed < 300; seed++) {
    const q = generateMarket(seed, M);
    const fam = q && MARKET_FAMILIES.find(f => q.id === `mkt-${f.id}-${seed}`);
    if (!fam) { fail('flat data: mixed generation returned null or an unknown family'); break; }
    assert(!changeFams.includes(fam.id), 'flat data: change question generated', q);
    checkItem(q, fam, M, seed);
  }
}
// 4b'. zero spreads (flat curve, €STR exactly at the DFR, bill exactly at fed funds): no "0 bps" questions
{
  const M = subset(['US10Y', 'US2Y', 'EA10Y', 'EA2Y', 'ESTR', 'ECBDFR', 'US3M', 'FEDFUNDS']);
  const copy = (to, from) => { const m = new Map(M.series[from].points); M.series[to].points = M.series[to].points.filter(([d]) => m.has(d)).map(([d]) => [d, m.get(d)]); };
  copy('US2Y', 'US10Y'); copy('EA2Y', 'EA10Y'); copy('ESTR', 'ECBDFR'); copy('FEDFUNDS', 'US3M');
  sweep(M, 'zero spreads', ['curve-us', 'curve-ea', 'estr-dfr', 'bill-ff'], 100, { mustNull: true });
}
// 4c. flat tail (last 5 observations unchanged, e.g. a holiday week) next to real moves: no zero-change question slips through
{
  const M = clone(FIXTURE);
  for (const k of Object.keys(M.series)) { const pts = M.series[k].points, n = pts.length, v0 = pts[n - 5][1]; mapPoints(M, k, (v, i) => (i >= n - 5 ? v0 : v)); }
  sweep(M, 'flat tail', MARKET_FAMILIES.map(f => f.id), 400, { maxNullShare: 0.05 });
}
// 4d. length boundaries: exactly minPoints works (single-series families), minPoints - 1 is unavailable
{
  const single = ['index-5d', 'range-pct', 'fx-convert', 'points-pct', 'vix-change', 'yield-bps', 'estr-interest', 'bond-duration', 'hy-spread', 'fx-move'];
  for (const f of MARKET_FAMILIES) {
    for (const n of [f.minPoints - 1, f.minPoints]) {
      const M = clone(FIXTURE);
      for (const k of Object.keys(M.series)) M.series[k].points = M.series[k].points.slice(-n);
      const has = marketFamiliesAvailable(M).some(x => x.id === f.id);
      if (n < f.minPoints) { assert(!has, `${f.id}: available with ${n} < minPoints observations`); sweep(M, `n=${n}`, [f.id], 20, { mustNull: true }); }
      else { if (single.includes(f.id)) assert(has, `${f.id}: unavailable with exactly minPoints observations`); sweep(M, `n=${n}`, [f.id], 150, { maxNullShare: single.includes(f.id) ? 0.05 : 1 }); }
    }
  }
}
// 4e. every single series missing in turn: dependants switch off cleanly, everything else stays valid
for (const gone of Object.keys(FIXTURE.series)) {
  const M = subset(Object.keys(FIXTURE.series).filter(k => k !== gone));
  const ids = new Set(marketFamiliesAvailable(M).map(f => f.id));
  for (const f of MARKET_FAMILIES) {
    if (f.needs.includes(gone)) assert(!ids.has(f.id), `${f.id} available without ${gone}`);
    if (f.anyOf && !f.needs.includes(gone) && ids.has(f.id)) {
      for (let seed = 0; seed < 60; seed++) { const q = generateMarket(seed, M, { family: f.id }); if (q) assert(!JSON.stringify(q.context.dataset).includes(FIXTURE.series[gone].name), `${f.id} shows missing ${gone}`, q); }
    }
  }
  sweep(M, `without ${gone}`, [...ids], 60, { maxNullShare: 0.05 });
}

console.log(`markets: checked ${checked} generated items, ${fails} failures`);
process.exit(fails ? 1 : 0);
