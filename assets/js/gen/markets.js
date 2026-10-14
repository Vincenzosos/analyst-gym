// Real-market-data generator: turns the series in data/news/markets.json into numerical, mental-math
// and markets MCQs, so practice uses this week's real numbers. ES module, no DOM.
//
// Input M (data/news/markets.json):
//   { updated, series: { KEY: { name, kind, unit, source, asOf, points: [[YYYY-MM-DD, value], ...] } }, failed: [KEY] }
// Every number in a question is read from M; when data are missing, short or malformed the API returns [] / null.
//
// Family metadata: `needs` = keys that must ALL be present; `anyOf` + `minAny` = a pool of interchangeable keys
// of which at least `minAny` must be present; `minPoints` = observations required (aligned across keys).
import { rng, randInt, pick, sample, shuffle, buildOptions, round, fmt } from '../util.js';

const EQUITY = ['SP500', 'NASDAQ', 'DJIA', 'STOXX50', 'DAX', 'FTSEMIB', 'FTSE100'];
const COMMOD = ['BRENT', 'WTI', 'GOLD'];
const FXK = ['EURUSD', 'EURGBP', 'EURJPY', 'EURCHF'];
const YIELDS = ['US10Y', 'US2Y', 'US3M', 'EA10Y', 'EA2Y'];

const FALLBACK = {
  SP500: ['S&P 500', 'index', 'pts', 'FRED'], NASDAQ: ['Nasdaq Composite', 'index', 'pts', 'FRED'], DJIA: ['Dow Jones Industrial Average', 'index', 'pts', 'FRED'],
  VIX: ['VIX volatility index', 'vol', 'pts', 'FRED'], US10Y: ['US 10-year Treasury yield', 'yield', '%', 'FRED'], US2Y: ['US 2-year Treasury yield', 'yield', '%', 'FRED'],
  US3M: ['US 3-month Treasury bill yield', 'yield', '%', 'FRED'], FEDFUNDS: ['Effective federal funds rate', 'rate', '%', 'FRED'],
  HYOAS: ['US high yield option-adjusted spread', 'spread', '%', 'FRED'], BRENT: ['Brent crude oil', 'commodity', 'USD/bbl', 'FRED'], WTI: ['WTI crude oil', 'commodity', 'USD/bbl', 'FRED'],
  EURUSD: ['EUR/USD', 'fx', 'USD per EUR', 'ECB'], EURGBP: ['EUR/GBP', 'fx', 'GBP per EUR', 'ECB'], EURJPY: ['EUR/JPY', 'fx', 'JPY per EUR', 'ECB'], EURCHF: ['EUR/CHF', 'fx', 'CHF per EUR', 'ECB'],
  EA10Y: ['Euro area 10-year AAA government yield', 'yield', '%', 'ECB'], EA2Y: ['Euro area 2-year AAA government yield', 'yield', '%', 'ECB'],
  ESTR: ['Euro short-term rate (€STR)', 'rate', '%', 'ECB'], ECBDFR: ['ECB deposit facility rate', 'rate', '%', 'ECB'],
  STOXX50: ['Euro Stoxx 50', 'index', 'pts', 'Yahoo'], DAX: ['DAX', 'index', 'pts', 'Yahoo'], FTSEMIB: ['FTSE MIB', 'index', 'pts', 'Yahoo'], FTSE100: ['FTSE 100', 'index', 'pts', 'Yahoo'],
  GOLD: ['Gold', 'commodity', 'USD/oz', 'Yahoo'],
};
// Display precision (decimals). Every computation uses the values exactly as displayed.
const DEC = { ESTR: 3, EURUSD: 4, EURGBP: 4, EURCHF: 4, EURJPY: 2 };
const decOf = (k, kind) => DEC[k] ?? (kind === 'fx' ? (k.endsWith('JPY') ? 2 : 4) : 2);
const LEVEL_KINDS = new Set(['index', 'fx', 'commodity', 'vol']);
const RECENT = 15; // window end dates are drawn from the last 15 observations (about three weeks): recent numbers

// ---------- formatting ----------
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const D = iso => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const NF = [];
const nf = d => (NF[d] ||= new Intl.NumberFormat('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }));
const F = (x, d = 2) => nf(d).format(round(x, d) + 0);
const SG = (x, d = 2) => { const v = round(x, d) + 0; return (v > 0 ? '+' : v < 0 ? '-' : '') + F(Math.abs(v), d); };
const PC = (x, d = 2) => `${SG(x, d)}%`;
const BP = (x, d = 0) => `${SG(x, d)} bps`;
const pc2 = v => PC(v, 2);
// A number used as the right-hand operand of \u2212 or \u00d7: negative values go in brackets ("2.10 \u2212 (-0.25)").
const FP = (x, d = 2) => (round(x, d) + 0 < 0 ? `(${F(x, d)})` : F(x, d));
const orList = parts => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}`);
const CCYN = { USD: 'US dollar', GBP: 'pound', JPY: 'yen', CHF: 'Swiss franc' };
const str = x => (typeof x === 'string' ? x.replace(/\u2014/g, '-').trim() : '');
const hdr = (name, unit) => (name.endsWith(')') ? `${name}, ${unit}` : `${name} (${unit})`);
const mid = name => name.replace(/^(Effective|The)\b/, w => w.toLowerCase());
const the = s => (s.kind === 'commodity' || s.kind === 'fx' ? s.name : `the ${s.name}`); // "the S&P 500" but "Brent crude oil"

// ---------- data preparation ----------
const PREP = new WeakMap();
function prep(M) {
  if (!M || typeof M !== 'object' || !M.series || typeof M.series !== 'object') return null;
  if (PREP.has(M)) return PREP.get(M);
  const P = {};
  for (const [k, s] of Object.entries(M.series)) {
    if (!s || typeof s !== 'object' || !Array.isArray(s.points)) continue;
    const fb = FALLBACK[k] || [k, '', '', ''];
    const kind = str(s.kind) || fb[1];
    const dec = decOf(k, kind);
    const byDate = new Map();
    for (const p of s.points) {
      if (!Array.isArray(p) || typeof p[0] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p[0])) continue;
      const v = typeof p[1] === 'number' ? p[1] : (typeof p[1] === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(p[1]) ? parseFloat(p[1]) : NaN);
      if (!Number.isFinite(v) || (LEVEL_KINDS.has(kind) && v <= 0)) continue;
      byDate.set(p[0], round(v, dec));
    }
    const dates = [...byDate.keys()].sort();
    if (!dates.length) continue;
    P[k] = { key: k, name: str(s.name) || fb[0], kind, unit: str(s.unit) || fb[2], source: str(s.source) || fb[3], dec, dates, vals: dates.map(d => byDate.get(d)) };
  }
  PREP.set(M, P);
  return P;
}
const len = (P, k) => (P[k] ? P[k].dates.length : 0);
function align(P, keys) {
  const maps = keys.map(k => new Map(P[k].dates.map((d, i) => [d, P[k].vals[i]])));
  const dates = P[keys[0]].dates.filter(d => maps.every(m => m.has(d)));
  return { dates, v: Object.fromEntries(keys.map((k, j) => [k, dates.map(d => maps[j].get(d))])) };
}
const alignedLen = (P, keys) => (keys.every(k => P[k]) ? (keys.length === 1 ? len(P, keys[0]) : align(P, keys).dates.length) : 0);
function endIdx(r, n, back) { const lo = Math.max(back, n - RECENT); return lo > n - 1 ? -1 : randInt(r, lo, n - 1); }

function srcLabel(s) {
  const src = s.source.toLowerCase();
  if (src.includes('fred')) return 'FRED (St. Louis Fed)';
  if (src.includes('ecb')) {
    if (s.kind === 'fx') return 'ECB euro reference rates';
    if (s.key === 'ESTR') return 'ECB euro short-term rate';
    if (s.key === 'ECBDFR') return 'ECB key interest rates';
    if (s.key.startsWith('EA')) return 'ECB euro area yield curve';
    return 'ECB Data Portal';
  }
  if (src.includes('treasury')) return 'US Treasury';
  if (src.includes('yahoo')) return 'Yahoo Finance';
  return s.source || 'public market data';
}
function dataset(P, keys, title, columns, rows, asOf, extra = '', unit = '') {
  const labels = [...new Set(keys.map(k => srcLabel(P[k])))];
  const ds = { title, kind: 'table', columns, rows, note: `Source${labels.length > 1 ? 's' : ''}: ${labels.join('; ')}, data to ${D(asOf)}. Real market data.${extra ? ' ' + extra : ''}` };
  if (unit) ds.unit = unit;
  return ds;
}
// Numeric MCQ options: distractors closer than 1.5 display units to the (rounded) answer are dropped,
// so no wrong option can be confused with the right one after rounding.
function numOptions(r, ans, distractors, n, format, spread, unit) {
  const ok = distractors.filter(x => typeof x === 'number' && Number.isFinite(x) && Math.abs(x - ans) >= 1.5 * unit - 1e-9);
  return buildOptions(r, ans, ok, n, format, Math.max(spread, 2 * unit));
}
const far = (x, y, unit) => Math.abs(x - y) >= 1.5 * unit - 1e-9;
function textOptions(r, correct, distractors, n) {
  const out = [correct];
  for (const d of distractors) { if (out.length >= n) break; if (d && !out.includes(d)) out.push(d); }
  if (out.length < 4) return null;
  const sh = shuffle(r, out);
  return { options: sh, answer: sh.indexOf(correct) };
}
const ccyOf = k => k.slice(3);
const perEur = (P, k, i) => F(P[k].vals[i], P[k].dec);

// ---------- families ----------
// Each generator returns { stem, options, answer, explanation, ds, asOf } or null.

function genIndex5d(r, P, pool) {
  for (let t = 0; t < 25; t++) {
    const k = pick(r, pool), s = P[k], v = s.vals, d = s.dates, dc = s.dec;
    const e = endIdx(r, v.length, 6); if (e < 0) return null;
    const a = v[e - 5], b = v[e];
    const ans = round((b - a) / a * 100, 2);
    if (Math.abs(ans) < 0.05) continue;
    const four = round((b - v[e - 4]) / v[e - 4] * 100, 2), six = round((b - v[e - 6]) / v[e - 6] * 100, 2);
    const wrongBase = round((b - a) / b * 100, 2), oneDay = round((b - v[e - 1]) / v[e - 1] * 100, 2);
    const o = numOptions(r, ans, [four, six, -ans, wrongBase, oneDay], 5, pc2, Math.max(0.2, Math.abs(ans) * 0.3), 0.01);
    const rows = []; for (let i = e - 6; i <= e; i++) rows.push([D(d[i]), F(v[i], dc)]);
    return {
      stem: `The table shows daily closing levels of the ${s.name}. What was the percentage change in the ${s.name} over the 5 trading days to ${D(d[e])}?`,
      ...o, asOf: d[e],
      ds: dataset(P, [k], `${s.name}: daily closes`, ['Date', 'Close'], rows, d[e], '', s.unit),
      explanation: {
        steps: [
          `5 trading days to ${D(d[e])} = 5 daily changes, so you start from the close on ${D(d[e - 5])} (5 rows above the last one).`,
          `Closes: ${F(a, dc)} on ${D(d[e - 5])} and ${F(b, dc)} on ${D(d[e])}; difference: ${F(b, dc)} − ${F(a, dc)} = ${SG(b - a, dc)} points.`,
          `${SG(b - a, dc)} / ${F(a, dc)} × 100 = ${PC(ans)}.`,
        ],
        shortcut: `Final/initial ratio: ${F(b, dc)} / ${F(a, dc)} = ${F(1 + ans / 100, 4)}, i.e. ${PC(ans)} after subtracting 1.`,
        trap: `Starting from the wrong row: from ${D(d[e - 4])} (4 trading days) you get ${PC(four)}, from ${D(d[e - 6])} (6 trading days) ${PC(six)}.`,
        rule: `% change over N trading days = (final close / close N trading days earlier − 1) × 100; N trading days = N + 1 closes.`,
      },
    };
  }
  return null;
}

function genBestWorst(r, P, pool) {
  if (pool.length < 4) return null;
  for (let t = 0; t < 30; t++) {
    const keys = sample(r, pool, 4);
    const names = keys.map(k => P[k].name);
    if (new Set(names).size < 4) continue;
    const A = align(P, keys);
    const L = pick(r, [5, 10, 15, 20]);
    const e = endIdx(r, A.dates.length, L); if (e < 0) continue;
    const s = e - L, best = r() < 0.5;
    const ret = keys.map(k => (A.v[k][e] / A.v[k][s] - 1) * 100);
    const pts = keys.map(k => A.v[k][e] - A.v[k][s]);
    const idx = [0, 1, 2, 3];
    const ord = idx.slice().sort((i, j) => (best ? ret[j] - ret[i] : ret[i] - ret[j]));
    if (Math.abs(ret[ord[0]] - ret[ord[1]]) < 0.1) continue;
    const win = ord[0];
    const ptsWin = idx.slice().sort((i, j) => (best ? pts[j] - pts[i] : pts[i] - pts[j]))[0];
    const options = shuffle(r, names);
    const ds0 = A.dates[s], ds1 = A.dates[e];
    const hi = idx.reduce((a, i) => (A.v[keys[i]][e] > A.v[keys[a]][e] ? i : a), 0), lo = idx.reduce((a, i) => (A.v[keys[i]][e] < A.v[keys[a]][e] ? i : a), 0);
    return {
      stem: `The table shows closing levels on two dates. Which asset had the ${best ? 'highest' : 'lowest'} percentage return between ${D(ds0)} and ${D(ds1)}?`,
      options, answer: options.indexOf(names[win]), asOf: ds1,
      ds: dataset(P, keys, 'Closing levels on two dates', ['Asset', 'Unit', D(ds0), D(ds1)], keys.map(k => [P[k].name, P[k].unit, F(A.v[k][s], P[k].dec), F(A.v[k][e], P[k].dec)]), ds1, 'Returns are price changes in each asset\'s own currency.'),
      explanation: {
        steps: idx.map(i => `${names[i]}: ${F(A.v[keys[i]][e], P[keys[i]].dec)} / ${F(A.v[keys[i]][s], P[keys[i]].dec)} − 1 = ${PC(ret[i])}.`)
          .concat([`The ${best ? 'highest' : 'lowest'} return belongs to ${names[win]} (${PC(ret[win])}).`]),
        shortcut: `Compare only the final/initial ratios and pick the ${best ? 'highest' : 'lowest'}: it is quicker than working out every percentage to two decimal places.`,
        trap: ptsWin !== win
          ? `Picking ${names[ptsWin]} because it has the ${best ? 'largest' : 'most negative'} change in points or price (${SG(pts[ptsWin], P[keys[ptsWin]].dec)}): with different levels, the % change is what counts, not the absolute one.`
          : `Looking at the change in points instead of in %: here the result is the same, but with very different levels (${names[hi]} versus ${names[lo]}) the answer often changes.`,
        rule: `Assets with different levels are always compared on % return, never on points or price.`,
      },
    };
  }
  return null;
}

const WEIGHTS = [[60, 40], [70, 30], [75, 25], [80, 20], [65, 35], [55, 45]];
function genPortfolio(r, P, pool) {
  if (pool.length < 2) return null;
  for (let t = 0; t < 30; t++) {
    const [k1, k2] = sample(r, pool, 2);
    const s1 = P[k1], s2 = P[k2];
    if (s1.name === s2.name) continue;
    const A = align(P, [k1, k2]);
    const L = pick(r, [5, 10, 20]);
    const e = endIdx(r, A.dates.length, L); if (e < 0) continue;
    const s = e - L;
    const [w1, w2] = pick(r, WEIGHTS);
    const a1 = A.v[k1][s], b1 = A.v[k1][e], a2 = A.v[k2][s], b2 = A.v[k2][e];
    const r1 = (b1 / a1 - 1) * 100, r2 = (b2 / a2 - 1) * 100;
    if (Math.abs(r1 - r2) < 0.4) continue;
    const ans = round(w1 / 100 * r1 + w2 / 100 * r2, 2);
    if (Math.abs(ans) < 0.03) continue;
    // Show the single-asset returns with enough decimals that redoing the shown arithmetic gives exactly the keyed answer.
    const p = [3, 4, 5, 6].find(q => {
      const x1 = round(r1, q), x2 = round(r2, q);
      return round(w1 / 100 * x1 + w2 / 100 * x2, 2) === ans && round(x2 + w1 / 100 * round(x1 - x2, q), 2) === ans;
    });
    if (!p) continue;
    const swapped = round(w2 / 100 * r1 + w1 / 100 * r2, 2), avg = round((r1 + r2) / 2, 2);
    const o = numOptions(r, ans, [swapped, avg, round(r1 + r2, 2), round(r1, 2)], 5, pc2, Math.max(0.15, Math.abs(ans) * 0.25), 0.01);
    const d0 = A.dates[s], d1 = A.dates[e];
    return {
      stem: `At the close on ${D(d0)}, an investor puts ${w1}% of a portfolio in ${the(s1)} and ${w2}% in ${the(s2)}, with no rebalancing and ignoring currency effects. Using the closing levels in the table, what is the portfolio return up to ${D(d1)}?`,
      ...o, asOf: d1,
      ds: dataset(P, [k1, k2], 'Closing levels', ['Asset', 'Unit', D(d0), D(d1)], [[s1.name, s1.unit, F(a1, s1.dec), F(b1, s1.dec)], [s2.name, s2.unit, F(a2, s2.dec), F(b2, s2.dec)]], d1),
      explanation: {
        steps: [
          `${s1.name}: ${F(b1, s1.dec)} / ${F(a1, s1.dec)} − 1 = ${PC(r1, p)}.`,
          `${s2.name}: ${F(b2, s2.dec)} / ${F(a2, s2.dec)} − 1 = ${PC(r2, p)}.`,
          `Portfolio: ${F(w1 / 100, 2)} × (${PC(r1, p)}) + ${F(w2 / 100, 2)} × (${PC(r2, p)}) = ${PC(ans)}: each asset is weighted by its share of the initial investment.`,
        ],
        shortcut: `Start from the second return and add the first weight times the difference: ${PC(r2, p)} + ${F(w1 / 100, 2)} × (${PC(round(r1, p) - round(r2, p), p)}) = ${PC(ans)}.`,
        trap: `Taking the simple average of the two returns (${PC(avg)}), which only works with 50/50 weights, or swapping the weights (${PC(swapped)}).`,
        rule: `Portfolio return = Σ initial weight × asset return (no rebalancing).`,
      },
    };
  }
  return null;
}

function genRange(r, P, pool) {
  for (let t = 0; t < 25; t++) {
    const k = pick(r, pool), s = P[k], v = s.vals, d = s.dates, dc = s.dec;
    const e = endIdx(r, v.length, 9); if (e < 0) return null;
    const w = v.slice(e - 9, e + 1), wd = d.slice(e - 9, e + 1);
    const hi = Math.max(...w), lo = Math.min(...w);
    const ans = round((hi - lo) / lo * 100, 2);
    if (ans < 0.1) continue;
    const first = w[0], last = w[9], mean = w.reduce((x, y) => x + y, 0) / 10;
    const wb = round((hi - lo) / hi * 100, 2), fl = round(Math.abs(last - first) / first * 100, 2);
    const o = numOptions(r, ans, [wb, fl, round((hi - lo) / first * 100, 2), round((hi - lo) / last * 100, 2), round((hi - lo) / mean * 100, 2)], 5, x => `${F(x, 2)}%`, Math.max(0.15, ans * 0.15), 0.01);
    return {
      stem: `Over the 10 trading days shown, what was the range between the highest and the lowest close of ${the(s)}, as a percentage of the lowest close?`,
      ...o, asOf: d[e],
      ds: dataset(P, [k], `${s.name}: daily closes`, ['Date', 'Close'], wd.map((x, i) => [D(x), F(w[i], dc)]), d[e], '', s.unit),
      explanation: {
        steps: [
          `Highest close: ${F(hi, dc)} (${D(wd[w.indexOf(hi)])}); lowest close: ${F(lo, dc)} (${D(wd[w.indexOf(lo)])}).`,
          `Range: ${F(hi, dc)} − ${F(lo, dc)} = ${F(hi - lo, dc)}.`,
          `As a % of the lowest close: ${F(hi - lo, dc)} / ${F(lo, dc)} × 100 = ${F(ans, 2)}%.`,
        ],
        shortcut: `Scan the column once, marking the highest and lowest closes, then do one division: ${F(hi, dc)} / ${F(lo, dc)} − 1 = ${F(ans, 2)}%.`,
        trap: wb === fl
          ? `Dividing by the highest close (${F(wb, 2)}%, which here matches the change between the first and last day): the base required is the lowest close.`
          : `Dividing by the highest close (${F(wb, 2)}%) or using the change between the first and last day (${F(fl, 2)}%), which ignores the peaks and troughs in between.`,
        rule: `Range % = (high − low) / low × 100: always read which base the question asks for.`,
      },
    };
  }
  return null;
}

function genCommodityEur(r, P, pool) {
  for (let t = 0; t < 20; t++) {
    const k = pick(r, pool), s = P[k];
    const A = align(P, [k, 'EURUSD']);
    const e = endIdx(r, A.dates.length, 2); if (e < 0) continue;
    const j = randInt(r, e - 2, e), jo = j === e ? e - 1 : j + 1;
    const p = A.v[k][j], fx = A.v.EURUSD[j], fxo = A.v.EURUSD[jo];
    const ans = round(p / fx, 2);
    const oz = /oz/i.test(s.unit);
    const o = numOptions(r, ans, [round(p * fx, 2), p, round(p / fxo, 2), round(p * (2 - fx), 2)], 5, x => `EUR ${F(x, 2)}`, Math.max(0.5, ans * 0.02), 0.01);
    const rows = []; for (let i = e - 2; i <= e; i++) rows.push([D(A.dates[i]), F(A.v[k][i], s.dec), F(A.v.EURUSD[i], 4)]);
    return {
      stem: `Using the data in the table, what was the price of ${s.name} in EUR per ${oz ? 'troy ounce' : 'barrel'} on ${D(A.dates[j])}?`,
      ...o, asOf: A.dates[e],
      ds: dataset(P, [k, 'EURUSD'], `${s.name} and EUR/USD`, ['Date', hdr(s.name, s.unit || 'USD'), 'EUR/USD (USD per EUR)'], rows, A.dates[e]),
      explanation: {
        steps: [
          `Row for ${D(A.dates[j])}: ${s.name} = ${F(p, 2)} USD, EUR/USD = ${F(fx, 4)} (USD per 1 EUR).`,
          `To go from USD to EUR, divide by the exchange rate: ${F(p, 2)} / ${F(fx, 4)} = ${F(ans, 2)}.`,
          `Price: EUR ${F(ans, 2)} per ${oz ? 'troy ounce' : 'barrel'}.`,
        ],
        shortcut: `At ${F(fx, 4)} USD per 1 EUR, one euro buys ${fx >= 1 ? 'more' : 'less'} than one dollar, so the price in EUR must be ${fx >= 1 ? 'lower' : 'higher'} than ${F(p, 2)}.`,
        trap: `${orList([`Multiplying by the exchange rate (EUR ${F(p * fx, 2)})`, ...(far(round(p / fxo, 2), ans, 0.01) ? [`using another day's rate (EUR ${F(p / fxo, 2)})`] : [])])}: convert the price at the same day's rate, by dividing.`,
        rule: `Rate quoted as "USD per EUR": from USD to EUR divide, from EUR to USD multiply.`,
      },
    };
  }
  return null;
}

function genFxConvert(r, P, pool) {
  const k = pick(r, pool), s = P[k], ccy = ccyOf(k), dc = s.dec;
  const e = endIdx(r, s.vals.length, 2); if (e < 0) return null;
  const j = randInt(r, e - 2, e), jo = j === e ? e - 1 : j + 1;
  const rate = s.vals[j], rateO = s.vals[jo];
  const toEur = r() < 0.5;
  const amt = ccy === 'JPY'
    ? (toEur ? pick(r, [500000, 1000000, 2500000, 4000000, 7500000]) : pick(r, [2000, 5000, 10000, 25000, 40000]))
    : pick(r, [5000, 8000, 10000, 15000, 25000, 40000, 50000, 75000, 120000, 250000]);
  const from = toEur ? ccy : 'EUR', to = toEur ? 'EUR' : ccy;
  const ans = round(toEur ? amt / rate : amt * rate, 0);
  const inv = round(toEur ? amt * rate : amt / rate, 0);
  const wrongDay = round(toEur ? amt / rateO : amt * rateO, 0);
  const naive = toEur && ccy !== 'JPY' ? round(amt * (2 - rate), 0) : null;
  const rr = round(rate, ccy === 'JPY' ? 0 : 2); // rate rounded too early ("172.56 is about 173")
  const rounded = round(toEur ? amt / rr : amt * rr, 0);
  const o = numOptions(r, ans, [inv, wrongDay, naive, rounded], 4, x => `${to} ${F(x, 0)}`, Math.max(1, ans * 0.03), 1);
  const bigger = toEur ? rate < 1 : rate > 1;
  const rows = []; for (let i = e - 2; i <= e; i++) rows.push([D(s.dates[i]), F(s.vals[i], dc)]);
  return {
    stem: `Using the ECB reference rate for ${D(s.dates[j])} shown in the table, how much is ${from} ${F(amt, 0)} in ${to}?`,
    ...o, asOf: s.dates[e],
    ds: dataset(P, [k], `ECB euro reference rate: ${ccy}`, ['Date', `EUR/${ccy} (${ccy} per EUR)`], rows, s.dates[e]),
    explanation: {
      steps: [
        `ECB rate on ${D(s.dates[j])}: 1 EUR = ${F(rate, dc)} ${ccy}.`,
        toEur ? `From ${ccy} to EUR you divide: ${F(amt, 0)} / ${F(rate, dc)} = ${F(ans, 0)} EUR.` : `From EUR to ${ccy} you multiply: ${F(amt, 0)} × ${F(rate, dc)} = ${F(ans, 0)} ${ccy}.`,
      ],
      shortcut: `Sense check: at ${F(rate, dc)} ${ccy} per 1 EUR, the amount in ${to} must be ${bigger ? 'larger' : 'smaller'} than ${F(amt, 0)}.`,
      trap: `${orList([
        `${toEur ? 'Multiplying instead of dividing' : 'Dividing instead of multiplying'} (${to} ${F(inv, 0)})`,
        ...(far(wrongDay, ans, 1) ? [`taking the rate from the wrong row (${to} ${F(wrongDay, 0)})`] : []),
        ...(far(rounded, ans, 1) ? [`rounding the rate to ${F(rr, ccy === 'JPY' ? 0 : 2)} before calculating (${to} ${F(rounded, 0)})`] : []),
      ])}: the rate tells you how many ${ccy} 1 EUR is worth, so to convert ${toEur ? 'into EUR you divide' : `into ${ccy} you multiply`}.`,
      rule: `Quote "${ccy} per EUR": from EUR to ${ccy} multiply, from ${ccy} to EUR divide.`,
    },
  };
}

function genPointsPct(r, P, pool) {
  for (let t = 0; t < 25; t++) {
    const k = pick(r, pool), s = P[k], v = s.vals, d = s.dates, dc = s.dec;
    const e = endIdx(r, v.length, 1); if (e < 0) return null;
    const prev = v[e - 1], close = v[e], pts = round(close - prev, dc);
    const ans = round(pts / prev * 100, 2);
    if (Math.abs(ans) < 0.1) continue; // tiny moves make the ×10 / ÷10 distractors meaningless
    const wbx = pts / close * 100, ansx = pts / prev * 100, wb = round(wbx, 2);
    // decimals needed to show that dividing by today's close gives a (slightly) different number
    const wd = [3, 4, 5].find(q => PC(wbx, q) !== PC(ansx, q));
    const o = numOptions(r, ans, [wb, -ans, round(ans * 10, 2), round(ans / 10, 2)], 4, pc2, Math.max(0.1, Math.abs(ans) * 0.3), 0.01);
    return {
      stem: `On ${D(d[e])} the ${s.name} closed at ${F(close, dc)}, ${pts > 0 ? 'up' : 'down'} ${F(Math.abs(pts), dc)} points on the day. What was its percentage change on the day?`,
      ...o, asOf: d[e],
      ds: dataset(P, [k], `${s.name}: daily close`, ['Index', 'Date', 'Close', 'Change on the day (pts)'], [[s.name, D(d[e]), F(close, dc), SG(pts, dc)]], d[e]),
      explanation: {
        steps: [
          `Previous close = close − change: ${F(close, dc)} − (${SG(pts, dc)}) = ${F(prev, dc)}.`,
          `% change: ${SG(pts, dc)} / ${F(prev, dc)} × 100 = ${PC(ans)}.`,
        ],
        shortcut: `Estimate: 1% of about ${F(prev, 0)} is about ${F(prev / 100, 1)} points, so ${F(Math.abs(pts), dc)} points is about ${F(Math.abs(ans), 2)}%.`,
        trap: PC(wb) === PC(ans)
          ? `Dividing by the day's close (${F(close, dc)}) instead of the previous close (${F(prev, dc)}): here it makes little difference (${wd ? `${PC(wbx, wd)} versus ${PC(ansx, wd)}` : 'the gap is beyond the fifth decimal place'}), but on large moves the error matters. Watch the × 100 and the decimal point too.`
          : `Dividing by the day's close (${F(close, dc)}, giving ${PC(wb)}) instead of the previous close (${F(prev, dc)}), or forgetting the × 100.`,
        rule: `Daily % change = points / previous close × 100.`,
      },
    };
  }
  return null;
}

function genVix(r, P) {
  const s = P.VIX, v = s.vals, d = s.dates, dc = s.dec;
  for (let t = 0; t < 25; t++) {
    const L = pick(r, [1, 2, 3, 5]);
    const e = endIdx(r, v.length, L); if (e < 0) return null;
    const i0 = e - L, a = v[i0], b = v[e];
    const ans = round((b / a - 1) * 100, 1);
    if (Math.abs(ans) < 1) continue; // sub-1% VIX moves make the distractors collapse onto each other
    const wrongRow = L > 1 ? round((b / v[i0 + 1] - 1) * 100, 1) : null; // starting from the second row
    const o = numOptions(r, ans, [round(b - a, 1), round((b - a) / b * 100, 1), -ans, wrongRow], 4, x => PC(x, 1), Math.max(1, Math.abs(ans) * 0.3), 0.1);
    const rows = []; for (let i = i0; i <= e; i++) rows.push([D(d[i]), F(v[i], dc)]);
    return {
      stem: `By what percentage did the ${s.name} change between the close on ${D(d[i0])} and the close on ${D(d[e])}?`,
      ...o, asOf: d[e],
      ds: dataset(P, ['VIX'], `${s.name}: daily closes`, ['Date', 'Close'], rows, d[e], '', s.unit),
      explanation: {
        steps: [
          `${s.name}: ${F(a, dc)} on ${D(d[i0])}, ${F(b, dc)} on ${D(d[e])}.`,
          `Difference: ${F(b, dc)} − ${F(a, dc)} = ${SG(b - a, dc)} volatility points.`,
          `As a %: ${SG(b - a, dc)} / ${F(a, dc)} × 100 = ${PC(ans, 1)}.`,
        ],
        shortcut: `Ratio ${F(b, dc)} / ${F(a, dc)} = ${F(1 + ans / 100, 3)}, so ${PC(ans, 1)}.`,
        trap: `Reporting the difference in points (${SG(b - a, dc)}) as if it were a percentage: the VIX is a level, and its % change is calculated on the starting value.${wrongRow !== null && far(wrongRow, ans, 0.1) ? ` Or starting from the second row of the table (${PC(wrongRow, 1)}) instead of the date given.` : ''}`,
        rule: `VIX % change = (final / initial − 1) × 100; the simple difference is in volatility points.`,
      },
    };
  }
  return null;
}

function genYieldBps(r, P, pool) {
  for (let t = 0; t < 25; t++) {
    const k = pick(r, pool), s = P[k], v = s.vals, d = s.dates;
    const L = pick(r, [5, 10, 21]);
    const e = endIdx(r, v.length, L); if (e < 0) return null;
    const i0 = e - L, im = i0 + Math.floor(L / 2), a = v[i0], b = v[e];
    const bps = round((b - a) * 100, 0);
    if (Math.abs(bps) < 3) continue;
    const rel = Math.abs(a) > 0.2 ? round((b / a - 1) * 100, 0) : null;
    const o = numOptions(r, bps, [-bps, bps * 10, rel, round((v[im] - a) * 100, 0), round(bps / 10, 0)], 4, x => BP(x, 0), Math.max(3, Math.round(Math.abs(bps) * 0.3)), 1);
    return {
      stem: `By how many basis points did the ${s.name} change between ${D(d[i0])} and ${D(d[e])}?`,
      ...o, asOf: d[e],
      ds: dataset(P, [k], s.name, ['Date', 'Yield (%)'], [i0, im, e].map(i => [D(d[i]), F(v[i], 2)]), d[e]),
      explanation: {
        steps: [
          `${D(d[i0])}: ${F(a, 2)}%; ${D(d[e])}: ${F(b, 2)}%.`,
          `Difference: ${F(b, 2)} − ${FP(a, 2)} = ${SG(b - a, 2)} percentage points.`,
          `1 percentage point = 100 bps, so ${SG(b - a, 2)} × 100 = ${BP(bps)}.`,
        ],
        shortcut: `Move the decimal point of the difference two places to the right: ${SG(b - a, 2)}% = ${BP(bps)}.`,
        trap: `Calculating the relative change (${rel === null ? 'final yield / initial yield − 1' : PC(rel, 0)}) instead of the difference, misplacing the decimal point (${BP(bps * 10)}) or using the middle row.`,
        rule: `1 bp = 0.01 percentage points; change in bps = (final yield − initial yield) × 100.`,
      },
    };
  }
  return null;
}

function genCurve(region) {
  const [k10, k2] = region === 'US' ? ['US10Y', 'US2Y'] : ['EA10Y', 'EA2Y'];
  const label = region === 'US' ? 'US Treasury' : 'euro area AAA government';
  return (r, P) => {
    const A = align(P, [k10, k2]);
    for (let t = 0; t < 25; t++) {
      const e = endIdx(r, A.dates.length, 2); if (e < 0) return null;
      const j = randInt(r, e - 2, e), jo = j === e ? e - 1 : j + 1;
      const y10 = A.v[k10][j], y2 = A.v[k2][j];
      const bps = round((y10 - y2) * 100, 0);
      if (bps === 0) continue;
      const other = round((A.v[k10][jo] - A.v[k2][jo]) * 100, 0);
      const lab = x => (x < 0 ? 'inverted' : 'not inverted');
      const opt = (x, l) => `${BP(x)}, ${l}`;
      const o = textOptions(r, opt(bps, lab(bps)), [opt(-bps, lab(-bps)), opt(bps, lab(-bps)), far(other, bps, 1) ? opt(other, lab(other)) : null, opt(-bps, lab(bps)), opt(bps * 10, lab(bps))], 4);
      if (!o) continue;
      const rows = []; for (let i = e - 2; i <= e; i++) rows.push([D(A.dates[i]), F(A.v[k2][i], 2), F(A.v[k10][i], 2)]);
      return {
        stem: `Using the table, what was the ${label} 10-year minus 2-year yield spread on ${D(A.dates[j])}, and was the curve inverted?`,
        ...o, asOf: A.dates[e],
        ds: dataset(P, [k10, k2], `${region === 'US' ? 'US Treasury' : 'Euro area AAA government'} yields`, ['Date', '2-year yield (%)', '10-year yield (%)'], rows, A.dates[e]),
        explanation: {
          steps: [
            `${D(A.dates[j])}: 10Y = ${F(y10, 2)}%, 2Y = ${F(y2, 2)}%.`,
            `Spread = ${F(y10, 2)} − ${FP(y2, 2)} = ${SG(y10 - y2, 2)} percentage points = ${BP(bps)}.`,
            bps < 0 ? `Negative spread: the 2-year yields more than the 10-year, so the curve is inverted.` : `Positive spread: the 10-year yields more than the 2-year, so the curve is not inverted (it slopes upwards).`,
          ],
          shortcut: `First check which yield is higher (that sets the sign and whether the curve is inverted), then move the decimal point of the difference two places to the right to get bps.`,
          trap: `Calculating 2Y − 10Y (${BP(-bps)}): the order is always long minus short, and the sign tells you whether the curve is inverted.`,
          rule: `10Y-2Y spread in bps = (y10 − y2) × 100; negative = inverted curve, usually associated with expectations of rate cuts.`,
        },
      };
    }
    return null;
  };
}

function genDuration(r, P, pool) {
  for (let t = 0; t < 25; t++) {
    const k = pick(r, pool), s = P[k], v = s.vals, d = s.dates;
    const ten = k.includes('10Y') ? 10 : 2;
    const dur = ten === 10 ? pick(r, [7.5, 8, 8.5, 8.8, 9]) : pick(r, [1.8, 1.9, 1.95]);
    const L = pick(r, [5, 10, 21]);
    const e = endIdx(r, v.length, L); if (e < 0) return null;
    const i0 = e - L, a = v[i0], b = v[e];
    const bps = round((b - a) * 100, 0);
    if (Math.abs(bps) < 2) continue;
    const ans = round(-dur * bps / 100, 2);
    if (Math.abs(ans) < 0.02) continue;
    const o = numOptions(r, ans, [-ans, round(ans * 10, 2), round(ans / 10, 2), round(-bps / dur / 100, 2)], 5, pc2, Math.max(0.05, Math.abs(ans) * 0.3), 0.01);
    return {
      stem: `Assume a ${ten}-year government bond with a modified duration of ${fmt(dur, 2)} (a hypothetical assumption, not market data). If its yield moves by the same amount as the ${s.name} between ${D(d[i0])} and ${D(d[e])}, what is the approximate percentage change in the bond's price?`,
      ...o, asOf: d[e],
      ds: dataset(P, [k], s.name, ['Date', 'Yield (%)'], [[D(d[i0]), F(a, 2)], [D(d[e]), F(b, 2)]], d[e], 'The modified duration is a stated assumption for the exercise, not market data.'),
      explanation: {
        steps: [
          `Change in yield: ${F(b, 2)} − ${FP(a, 2)} = ${SG(b - a, 2)} pp = ${BP(bps)} = ${SG(bps / 10000, 4)} as a decimal.`,
          `ΔP/P ≈ −modified duration × Δy = −${fmt(dur, 2)} × (${SG(bps / 10000, 4)}) = ${bps > 0 ? '-' : '+'}${fmt(Math.abs(dur * bps / 10000), 6)}, i.e. ${PC(ans)}.`,
          `The yield ${bps > 0 ? 'rose, so the price falls' : 'fell, so the price rises'}: ${PC(ans)}.`,
        ],
        shortcut: `Each bp is worth about duration × 0.01% of price: ${fmt(dur, 2)} × ${F(Math.abs(bps), 0)} bps / 100 ≈ ${F(Math.abs(ans), 2)}%, with the opposite sign to the change in yield.`,
        trap: `Forgetting the minus sign (${PC(-ans)}): yields up, prices down. Also watch the bps conversion, which shifts the decimal point (${PC(ans * 10)}).`,
        rule: `ΔP/P ≈ −D_mod × Δy; with Δy in bps: ΔP% ≈ −D_mod × bps / 100.`,
      },
    };
  }
  return null;
}

function genPairSpread(k1, k2, dec, kind) {
  return (r, P) => {
    const A = align(P, [k1, k2]), s1 = P[k1], s2 = P[k2];
    for (let t = 0; t < 25; t++) {
      const e = endIdx(r, A.dates.length, 2); if (e < 0) return null;
      const j = randInt(r, e - 2, e), jo = j === e ? e - 1 : j + 1;
      const x = A.v[k1][j], y = A.v[k2][j];
      const bps = round((x - y) * 100, dec);
      if (bps === 0) continue;
      const rel = Math.abs(y) > 0.2 ? round((x / y - 1) * 100, dec) : null;
      const o = numOptions(r, bps, [-bps, round(bps * 10, dec), round((A.v[k1][jo] - A.v[k2][jo]) * 100, dec), rel, round(bps / 10, dec)], 4, z => BP(z, dec), Math.max(1, Math.abs(bps) * 0.3), 10 ** -dec);
      const rows = []; for (let i = e - 2; i <= e; i++) rows.push([D(A.dates[i]), F(A.v[k1][i], s1.dec), F(A.v[k2][i], s2.dec)]);
      const pdec = Math.max(s1.dec, s2.dec), diff = SG(x - y, pdec);
      const view = kind === 'estr'
        ? (bps < 0 ? `The ${mid(s1.name)} is below the deposit facility rate: typical when there is excess liquidity in the system.` : `The ${mid(s1.name)} is above the deposit facility rate: a sign of less abundant liquidity.`)
        : (bps < 0 ? `The T-bill yields less than the effective fed funds rate: a typical sign of expected cuts over the next 3 months (demand for T-bills also plays a part).` : `The T-bill yields more than the effective fed funds rate: the market is not pricing cuts over the next 3 months (a wide spread can reflect expected hikes or heavy T-bill supply).`);
      return {
        stem: `Using the table, what was the ${mid(s1.name)} minus the ${mid(s2.name)} on ${D(A.dates[j])}, in basis points?`,
        ...o, asOf: A.dates[e],
        ds: dataset(P, [k1, k2], kind === 'estr' ? 'Euro money-market rates' : 'US money-market rates', ['Date', ...[s1, s2].map(z => ([s1, s2].some(w => w.name.endsWith(')')) ? `${z.name}, %` : `${z.name} (%)`))], rows, A.dates[e]),
        explanation: {
          steps: [
            `${D(A.dates[j])}: ${s1.name} = ${F(x, s1.dec)}%, ${s2.name} = ${F(y, s2.dec)}%.`,
            `Difference: ${F(x, s1.dec)} − ${FP(y, s2.dec)} = ${diff} percentage points.`,
            `In bps: ${diff} × 100 = ${BP(bps, dec)}.`,
            view,
          ],
          shortcut: `1 percentage point = 100 bps: move the decimal point two places to the right (${diff}% = ${BP(bps, dec)}).`,
          trap: `Reversing the order of the subtraction (${BP(-bps, dec)}) or stopping at percentage points without multiplying by 100.`,
          rule: kind === 'estr'
            ? `Spread in bps = (rate A − rate B) × 100; €STR − DFR shows where overnight money trades relative to the floor set by the ECB.`
            : `Spread in bps = (rate A − rate B) × 100; 3M T-bill − fed funds reflects expectations for Fed rates over the next 3 months.`,
        },
      };
    }
    return null;
  };
}

function genHy(r, P) {
  const s = P.HYOAS, v = s.vals, d = s.dates;
  for (let t = 0; t < 25; t++) {
    const L = pick(r, [5, 10, 21]);
    const e = endIdx(r, v.length, L); if (e < 0) return null;
    const i0 = e - L, im = i0 + Math.floor(L / 2), a = v[i0], b = v[e];
    const bps = round((b - a) * 100, 0);
    if (Math.abs(bps) < 2) continue;
    const lab = x => (x > 0 ? 'widened' : 'tightened');
    const opt = (x, l) => `${BP(x)}, ${l}`;
    const rel = Math.abs(a) > 0.2 ? round((b / a - 1) * 100, 0) : null;
    const o = textOptions(r, opt(bps, lab(bps)), [opt(-bps, lab(-bps)), opt(bps, lab(-bps)), rel !== null && rel !== 0 && far(rel, bps, 1) ? opt(rel, lab(bps)) : null, opt(bps * 10, lab(bps)), opt(-bps, lab(bps))], 4);
    if (!o) continue;
    return {
      stem: `By how many basis points did the ${s.name} change between ${D(d[i0])} and ${D(d[e])}, and did credit spreads widen or tighten?`,
      ...o, asOf: d[e],
      ds: dataset(P, ['HYOAS'], s.name, ['Date', 'Spread (%)'], [i0, im, e].map(i => [D(d[i]), F(v[i], 2)]), d[e]),
      explanation: {
        steps: [
          `The spread is expressed in percentage points: ${F(a, 2)}% on ${D(d[i0])}, ${F(b, 2)}% on ${D(d[e])}.`,
          `Difference: ${F(b, 2)} − ${FP(a, 2)} = ${SG(b - a, 2)} percentage points; in bps: ${SG(b - a, 2)} × 100 = ${BP(bps)}.`,
          bps > 0 ? `The spread rose, so it widened (widening): the market is demanding a higher premium for credit risk.` : `The spread fell, so it tightened (tightening): the market is demanding a lower premium for credit risk.`,
        ],
        shortcut: `Move the decimal point of the difference two places to the right (${SG(b - a, 2)}% = ${BP(bps)}); the sign tells you straight away whether it is widening (+) or tightening (−).`,
        trap: `Reading a higher spread as an improvement: spread up = credit looks riskier to the market (risk-off). Or reporting the relative change (${rel === null ? 'final / initial − 1' : PC(rel, 0)}) as bps.`,
        rule: `Spread change in bps = (final − initial) × 100; positive = widening, negative = tightening.`,
      },
    };
  }
  return null;
}

const CROSS = {
  EURGBP: { pair: 'GBP/USD', meaning: 'USD per 1 GBP', d: 4, invertible: true },
  EURJPY: { pair: 'USD/JPY', meaning: 'JPY per 1 USD', d: 2, invertible: false },
  EURCHF: { pair: 'USD/CHF', meaning: 'CHF per 1 USD', d: 4, invertible: true },
};
function genCross(r, P, pool) {
  for (let t = 0; t < 20; t++) {
    const k = pick(r, pool), c = CROSS[k], ccy = ccyOf(k), s = P[k];
    const A = align(P, ['EURUSD', k]);
    const e = endIdx(r, A.dates.length, 2); if (e < 0) continue;
    const j = randInt(r, e - 2, e), jo = j === e ? e - 1 : j + 1;
    const u = A.v.EURUSD[j], x = A.v[k][j];
    const gbp = k === 'EURGBP';
    const calc = (uu, xx) => (gbp ? uu / xx : xx / uu);
    const ans = round(calc(u, x), c.d);
    const mul = round(u * x, c.d), wrongRow = round(calc(A.v.EURUSD[jo], A.v[k][jo]), c.d);
    const inv = c.invertible ? round(1 / calc(u, x), c.d) : null;
    const unconv = gbp ? u : x;
    const o = numOptions(r, ans, [mul, inv, wrongRow, unconv], 5, z => F(z, c.d), Math.max(10 ** -c.d * 5, ans * 0.02), 10 ** -c.d);
    const rows = []; for (let i = e - 2; i <= e; i++) rows.push([D(A.dates[i]), F(A.v.EURUSD[i], 4), F(A.v[k][i], s.dec)]);
    const formula = gbp ? `(USD per EUR) / (GBP per EUR) = ${F(u, 4)} / ${F(x, s.dec)}` : `(${ccy} per EUR) / (USD per EUR) = ${F(x, s.dec)} / ${F(u, 4)}`;
    return {
      stem: `Using the ECB reference rates for ${D(A.dates[j])} in the table, what is the implied ${c.pair} exchange rate (${c.meaning})?`,
      ...o, asOf: A.dates[e],
      ds: dataset(P, ['EURUSD', k], 'ECB euro reference rates', ['Date', 'EUR/USD (USD per EUR)', `EUR/${ccy} (${ccy} per EUR)`], rows, A.dates[e]),
      explanation: {
        steps: [
          `${D(A.dates[j])}: 1 EUR = ${F(u, 4)} USD and 1 EUR = ${F(x, s.dec)} ${ccy}.`,
          gbp ? `So ${F(x, s.dec)} GBP = ${F(u, 4)} USD, i.e. 1 GBP = ${F(u, 4)} / ${F(x, s.dec)} USD.` : `So ${F(u, 4)} USD = ${F(x, s.dec)} ${ccy}, i.e. 1 USD = ${F(x, s.dec)} / ${F(u, 4)} ${ccy}.`,
          `${c.pair} = ${formula} = ${F(ans, c.d)}.`,
        ],
        shortcut: `Write the units as fractions: ${gbp ? '(USD/EUR) ÷ (GBP/EUR) = USD/GBP' : `(${ccy}/EUR) ÷ (USD/EUR) = ${ccy}/USD`}; the EUR cancels out.`,
        trap: `Multiplying the two rates (${F(mul, c.d)}): the units do not cancel and the result makes no economic sense.${inv !== null ? ` The inverted ratio (${F(inv, c.d)}) is another typical mistake.` : ''}`,
        rule: `Cross rate from two quotes against the EUR: divide so that the EUR cancels out, and check the final unit (${c.meaning}).`,
      },
    };
  }
  return null;
}

function genFxMove(r, P, pool) {
  for (let t = 0; t < 25; t++) {
    const k = pick(r, pool), s = P[k], v = s.vals, d = s.dates, dc = s.dec, ccy = ccyOf(k);
    const L = pick(r, [5, 10, 21]);
    const e = endIdx(r, v.length, L); if (e < 0) return null;
    const i0 = e - L, im = i0 + Math.floor(L / 2), a = v[i0], b = v[e];
    const pct = round((b / a - 1) * 100, 2);
    if (Math.abs(pct) < 0.05) continue;
    const up = pct > 0, mag = Math.abs(pct);
    const cn = CCYN[ccy] || ccy;
    const st = (who, dir, m) => `The ${who} ${dir} by ${F(m, 2)}% against the ${who === 'euro' ? cn : 'euro'}`;
    const DIR = x => (x ? 'strengthened' : 'weakened');
    const wb = Math.abs(round((b - a) / b * 100, 2));
    const figs = Math.abs(round((b - a) * (ccy === 'JPY' ? 1 : 100), 2));
    const o = textOptions(r, st('euro', DIR(up), mag), [st('euro', DIR(!up), mag), st(cn, DIR(up), mag), far(figs, mag, 0.01) ? st('euro', DIR(up), figs) : null, far(wb, mag, 0.01) ? st('euro', DIR(up), wb) : null, st('euro', DIR(up), mag * 2)], 4);
    if (!o) continue;
    return {
      stem: `The ECB reference rate for EUR/${ccy} (${ccy} per EUR) moved from ${F(a, dc)} on ${D(d[i0])} to ${F(b, dc)} on ${D(d[e])}. Which statement is correct?`,
      ...o, asOf: d[e],
      ds: dataset(P, [k], `ECB euro reference rate: ${ccy}`, ['Date', `EUR/${ccy} (${ccy} per EUR)`], [i0, im, e].map(i => [D(d[i]), F(v[i], dc)]), d[e]),
      explanation: {
        steps: [
          `The quote is in ${ccy} per 1 EUR: ${up ? 'when it rises, more' : 'when it falls, fewer'} ${ccy} are needed to buy one euro, so the euro has ${up ? 'appreciated' : 'depreciated'}.`,
          `Change: ${F(b, dc)} / ${F(a, dc)} − 1 = ${PC(pct)}.`,
          `Answer: the euro is ${up ? 'up' : 'down'} ${F(mag, 2)}% against ${ccy}, so the euro has ${up ? 'strengthened' : 'weakened'} and, conversely, ${ccy} has ${up ? 'weakened' : 'strengthened'}.`,
        ],
        shortcut: `In EUR/${ccy} the euro is the base currency: number up = stronger euro, number down = weaker euro.`,
        trap: `Reading the ${up ? 'rise' : 'fall'} in the number as a ${up ? 'strengthening' : 'weakening'} of ${ccy}, or mistaking the difference between the quotes (${SG(b - a, dc)} ${ccy}) for a percentage change (${F(figs, 2)}%).`,
        rule: `In a quote "base/quote = k", k rising means a stronger base currency; % change = (final / initial − 1) × 100.`,
      },
    };
  }
  return null;
}

function genEstrInterest(r, P) {
  const s = P.ESTR, v = s.vals, d = s.dates;
  for (let t = 0; t < 20; t++) {
    const e = endIdx(r, v.length, 2); if (e < 0) return null;
    const j = randInt(r, e - 2, e), jo = j === e ? e - 1 : j + 1;
    const rate = v[j];
    if (rate < 0.05) continue; // zero or negative rates: "interest earned" would be meaningless
    const N = pick(r, [5, 10, 20, 25, 50, 100]), days = pick(r, [7, 14, 30, 31, 60, 90, 91]);
    const notional = N * 1e6;
    const ans = round(notional * rate / 100 * days / 360, 0);
    const d365 = round(notional * rate / 100 * days / 365, 0);
    const annual = round(notional * rate / 100, 0);
    const o = numOptions(r, ans, [d365, round(notional * v[jo] / 100 * days / 360, 0), ans * 10, annual], 4, z => `EUR ${F(z, 0)}`, Math.max(10, Math.abs(ans) * 0.05), 1);
    const rows = []; for (let i = e - 2; i <= e; i++) rows.push([D(d[i]), F(v[i], s.dec)]);
    return {
      stem: `A treasury desk deposits EUR ${N} million for ${days} days at a fixed rate equal to the ${mid(s.name)} for ${D(d[j])} shown in the table (simple interest, ACT/360). How much interest does it earn?`,
      ...o, asOf: d[e],
      ds: dataset(P, ['ESTR'], s.name, ['Date', 'Rate (%)'], rows, d[e]),
      explanation: {
        steps: [
          `Rate on ${D(d[j])}: ${F(rate, 3)}% = ${F(rate / 100, 5)} as a decimal.`,
          `Interest = notional × rate × days / 360 = ${F(notional, 0)} × ${F(rate / 100, 5)} × ${days} / 360.`,
          `Result: EUR ${F(ans, 0)}.`,
        ],
        shortcut: `First the annual interest (EUR ${N}m × ${F(rate, 3)}% = EUR ${F(annual, 0)}), then the fraction ${days}/360.`,
        trap: `Using 365 days (EUR ${F(d365, 0)}): €STR, like Euribor, uses the ACT/360 convention. Or forgetting the fraction of the year (EUR ${F(annual, 0)}).`,
        rule: `Simple interest in the euro money market = notional × rate × actual days / 360.`,
      },
    };
  }
  return null;
}

// ---------- registry ----------
const FAM = [
  { id: 'index-5d', skill: 'numerical', name: 'Indices: % change over 5 trading days', needs: [], anyOf: EQUITY, minAny: 1, minPoints: 12, level: 1, timeTarget: 60, gen: genIndex5d },
  { id: 'best-worst', skill: 'numerical', name: 'Best and worst performers', needs: [], anyOf: [...EQUITY, ...COMMOD], minAny: 4, minPoints: 30, level: 2, timeTarget: 90, gen: genBestWorst },
  { id: 'portfolio', skill: 'numerical', name: 'Weighted portfolio return', needs: [], anyOf: [...EQUITY, 'GOLD'], minAny: 2, minPoints: 30, level: 2, timeTarget: 90, gen: genPortfolio },
  { id: 'range-pct', skill: 'numerical', name: 'High-low range in %', needs: [], anyOf: [...EQUITY, ...COMMOD], minAny: 1, minPoints: 20, level: 2, timeTarget: 75, gen: genRange },
  { id: 'commodity-eur', skill: 'numerical', name: 'Commodities priced in euros', needs: ['EURUSD'], anyOf: COMMOD, minAny: 1, minPoints: 10, level: 1, timeTarget: 45, gen: genCommodityEur },
  { id: 'fx-convert', skill: 'mental', name: 'Conversions at the ECB reference rate', needs: [], anyOf: FXK, minAny: 1, minPoints: 10, level: 1, timeTarget: 30, gen: genFxConvert },
  { id: 'points-pct', skill: 'mental', name: 'From index points to % change', needs: [], anyOf: EQUITY, minAny: 1, minPoints: 5, level: 2, timeTarget: 30, gen: genPointsPct },
  { id: 'vix-change', skill: 'mental', name: 'VIX: % change', needs: ['VIX'], minPoints: 12, level: 1, timeTarget: 30, gen: genVix },
  { id: 'yield-bps', skill: 'mental', name: 'Yields: change in basis points', needs: [], anyOf: YIELDS, minAny: 1, minPoints: 30, level: 1, timeTarget: 25, gen: genYieldBps },
  { id: 'estr-interest', skill: 'mental', name: 'Interest at €STR (ACT/360)', needs: ['ESTR'], minPoints: 5, level: 2, timeTarget: 45, gen: genEstrInterest },
  { id: 'curve-us', skill: 'markets', name: 'US curve: 10Y-2Y spread', needs: ['US10Y', 'US2Y'], minPoints: 10, level: 2, timeTarget: 45, gen: genCurve('US') },
  { id: 'curve-ea', skill: 'markets', name: 'Euro curve: 10Y-2Y spread', needs: ['EA10Y', 'EA2Y'], minPoints: 10, level: 2, timeTarget: 45, gen: genCurve('EA') },
  { id: 'bond-duration', skill: 'markets', name: 'Duration and bond price', needs: [], anyOf: ['US10Y', 'EA10Y', 'US2Y', 'EA2Y'], minAny: 1, minPoints: 30, level: 3, timeTarget: 75, gen: genDuration },
  { id: 'estr-dfr', skill: 'markets', name: '€STR versus the ECB deposit facility rate', needs: ['ESTR', 'ECBDFR'], minPoints: 10, level: 2, timeTarget: 40, gen: genPairSpread('ESTR', 'ECBDFR', 1, 'estr') },
  { id: 'bill-ff', skill: 'markets', name: '3M T-bill versus fed funds', needs: ['US3M', 'FEDFUNDS'], minPoints: 10, level: 2, timeTarget: 40, gen: genPairSpread('US3M', 'FEDFUNDS', 0, 'bill') },
  { id: 'hy-spread', skill: 'markets', name: 'High yield spread: widening or tightening', needs: ['HYOAS'], minPoints: 30, level: 2, timeTarget: 40, gen: genHy },
  { id: 'cross-rate', skill: 'markets', name: 'Cross rates from ECB reference rates', needs: ['EURUSD'], anyOf: ['EURGBP', 'EURJPY', 'EURCHF'], minAny: 1, minPoints: 10, level: 3, timeTarget: 60, gen: genCross },
  { id: 'fx-move', skill: 'markets', name: 'FX: which currency strengthened', needs: [], anyOf: FXK, minAny: 1, minPoints: 30, level: 2, timeTarget: 50, gen: genFxMove },
];

export const MARKET_FAMILIES = FAM.map(({ gen, ...meta }) => Object.freeze({ ...meta, needs: [...meta.needs], ...(meta.anyOf ? { anyOf: [...meta.anyOf] } : {}) }));

const AVAIL = new WeakMap();
function poolFor(P, f) {
  if (!f.needs.every(k => len(P, k) >= f.minPoints)) return null;
  if (f.needs.length > 1 && alignedLen(P, f.needs) < f.minPoints) return null;
  if (!f.anyOf) return [];
  const pool = f.anyOf.filter(k => len(P, k) >= f.minPoints && (!f.needs.length || alignedLen(P, [...f.needs, k]) >= f.minPoints));
  return pool.length >= (f.minAny || 1) ? pool : null;
}
function pools(M, P) {
  if (AVAIL.has(M)) return AVAIL.get(M);
  const m = new Map();
  for (const f of FAM) { const p = poolFor(P, f); if (p) m.set(f.id, p); }
  AVAIL.set(M, m);
  return m;
}

// Families whose required series exist with enough points.
export function marketFamiliesAvailable(M) {
  const P = prep(M);
  if (!P) return [];
  const m = pools(M, P);
  return MARKET_FAMILIES.filter(f => m.has(f.id));
}

// One real-data MCQ, or null when the data cannot support the requested skill/family.
export function generateMarket(seed, M, opts = {}) {
  const { skill = null, family = null } = opts || {};
  const P = prep(M);
  if (!P) return null;
  const m = pools(M, P);
  const fams = FAM.filter(f => m.has(f.id) && (!skill || f.skill === skill) && (!family || f.id === family));
  if (!fams.length) return null;
  const r = rng(seed);
  for (const f of shuffle(r, fams)) {
    let q = null;
    try { q = f.gen(r, P, m.get(f.id)); } catch (err) { q = null; }
    if (!q) continue;
    return {
      id: `mkt-${f.id}-${seed}`, skill: f.skill, type: 'mcq', generated: true, realData: true, level: f.level,
      context: { kind: 'dataset', dataset: q.ds }, stem: q.stem, options: q.options, answer: q.answer,
      timeTarget: f.timeTarget, explanation: q.explanation, tags: ['real-data', f.id], asOf: q.asOf,
    };
  }
  return null;
}
