// Numerical-reasoning generator (SHL / Kenexa style): random business dataset + one question.
import { rng, randInt, pick, sample, buildOptions, fmt, round } from '../util.js';

const REGIONS = ['North', 'South', 'East', 'West', 'Central', 'Nordics', 'Iberia', 'DACH'];
const YEARS = ['2022', '2023', '2024', '2025'];
const P = (x, d = 1) => `${fmt(x, d)}%`;

function regional(r) {
  const regs = sample(r, REGIONS, 4);
  const yrs = YEARS.slice(1);
  const rows = regs.map(name => {
    let v = randInt(r, 6, 40) * 10;
    return [name, ...yrs.map((_, i) => { if (i) v = Math.max(20, round(v * (1 + randInt(r, -12, 30) / 100), 0)); return v; })];
  });
  return { title: 'Revenue by region', kind: pick(r, ['table', 'bar', 'bar', 'table']), unit: 'EUR m', columns: ['Region', ...yrs], rows };
}

function regionalQ(r, ds) {
  const yrs = ds.columns.slice(1);
  const rows = ds.rows;
  let t = pick(r, ['change', 'share', 'largestGrowth', 'average', 'projection', 'ratio', 'combined']);
  const row = pick(r, rows);
  const yi = randInt(r, 0, yrs.length - 2), yj = yrs.length - 1;
  const col = c => rows.map(x => x[c + 1]);
  if (t === 'change') {
    const a = row[yi + 1], b = row[yj + 1];
    const ans = round((b - a) / a * 100, 1);
    return {
      stem: `What was the percentage change in ${row[0]}'s revenue between ${yrs[yi]} and ${yrs[yj]}?`,
      ...buildOptions(r, ans, [round((b - a) / b * 100, 1), (yi + 1 < yj ? round((b - row[yi + 2]) / row[yi + 2] * 100, 1) : round((row[yj] - a) / a * 100, 1)), -ans, round(ans / 2, 1)], 5, v => P(v), 1.7),
      explanation: {
        steps: [`${row[0]}: ${yrs[yi]} = ${a}, ${yrs[yj]} = ${b}.`, `Difference: ${b} − ${a} = ${b - a}.`, `${b - a} / ${a} × 100 = ${P(ans)}.`],
        shortcut: `Ratio ${b}/${a} = ${fmt(b / a, 3)}: the part after the 1 is the change.`,
        trap: `Using the final year (${b}) as the base, or reading the wrong year from the table.`,
        rule: `% change = (Final − Initial) / Initial × 100.`,
      }, timeTarget: 60, level: 1, tags: ['percent-change'],
    };
  }
  if (t === 'share') {
    const c = randInt(r, 0, yrs.length - 1);
    const tot = col(c).reduce((s, v) => s + v, 0);
    const ans = round(row[c + 1] / tot * 100, 1);
    const others = tot - row[c + 1];
    return {
      stem: `In ${yrs[c]}, what share of total revenue came from ${row[0]}?`,
      ...buildOptions(r, ans, [round(row[c + 1] / others * 100, 1), round(100 / rows.length, 1), round(ans + 4, 1), round(row[c + 1] / (tot + row[c + 1]) * 100, 1)], 5, v => P(v), 1.3),
      explanation: {
        steps: [`Total ${yrs[c]}: ${col(c).join(' + ')} = ${tot}.`, `${row[0]}: ${row[c + 1]}.`, `${row[c + 1]} / ${tot} × 100 = ${P(ans)}.`],
        shortcut: `Estimate: ${row[c + 1]} out of roughly ${Math.round(tot / 10) * 10} → about ${fmt(row[c + 1] / tot * 100, 0)}%, then pick the closest option.`,
        trap: `Dividing by the sum of the OTHER regions (${others}) instead of the total.`,
        rule: `Share = part / total; the total includes the part itself.`,
      }, timeTarget: 70, level: 1, tags: ['share-of-total'],
    };
  }
  if (t === 'largestGrowth') {
    // a tie would make two options correct: ask a different question instead
    const gs = rows.map(x => Math.round((x[yj + 1] - x[yi + 1]) / x[yi + 1] * 1e6));
    if (gs.filter(v => v === Math.max(...gs)).length > 1) t = 'average';
  }
  if (t === 'largestGrowth') {
    const g = rows.map(x => ({ n: x[0], g: (x[yj + 1] - x[yi + 1]) / x[yi + 1] }));
    const absG = rows.map(x => ({ n: x[0], d: x[yj + 1] - x[yi + 1] }));
    const best = g.reduce((a, b) => (b.g > a.g ? b : a));
    const bestAbs = absG.reduce((a, b) => (b.d > a.d ? b : a));
    const names = rows.map(x => x[0]);
    const ans = names.indexOf(best.n);
    return {
      stem: `Which region recorded the largest percentage increase in revenue between ${yrs[yi]} and ${yrs[yj]}?`,
      options: names, answer: ans,
      explanation: {
        steps: g.map(x => `${x.n}: ${P(x.g * 100)}.`).concat([`The highest % growth is ${best.n}.`]),
        shortcut: `Compare the final/initial ratios without working each one out precisely: rule out straight away any region that falls or grows only slightly.`,
        trap: bestAbs.n !== best.n ? `Choosing ${bestAbs.n}, which has the largest ABSOLUTE increase (+${bestAbs.d}) but not the largest percentage increase.` : `Confusing absolute and percentage increase: here they coincide, but that is not always the case.`,
        rule: `"Percentage increase" = a ratio, not a difference.`,
      }, timeTarget: 90, level: 2, tags: ['compare-growth'],
    };
  }
  if (t === 'average') {
    const c = randInt(r, 0, yrs.length - 1);
    const vals = col(c);
    const ans = round(vals.reduce((s, v) => s + v, 0) / vals.length, 1);
    return {
      stem: `What was the average revenue per region in ${yrs[c]}?`,
      ...buildOptions(r, ans, [round(vals.reduce((s, v) => s + v, 0) / (vals.length - 1), 1), round((Math.max(...vals) + Math.min(...vals)) / 2, 1), round(ans * 1.1, 1)], 5, v => `EUR ${fmt(v, 1)}m`, Math.max(2, ans * 0.04)),
      explanation: {
        steps: [`Sum ${yrs[c]}: ${vals.join(' + ')} = ${vals.reduce((s, v) => s + v, 0)}.`, `Divided by ${vals.length} regions = ${fmt(ans, 1)}.`],
        shortcut: `Round the values to the nearest ten, add them up, then divide: the right option will be the closest one.`,
        trap: `Dividing by the wrong number of items, or averaging only the maximum and the minimum.`,
        rule: `Average = sum / number of items.`,
      }, timeTarget: 60, level: 1, tags: ['average'],
    };
  }
  if (t === 'projection') {
    const a = row[yrs.length - 1], b = row[yrs.length];
    const g = (b - a) / a;
    const ans = round(b * (1 + g), 1);
    return {
      stem: `If ${row[0]}'s revenue grows in the next year at the same percentage rate as between ${yrs[yrs.length - 2]} and ${yrs[yrs.length - 1]}, what will it be (to the nearest EUR 0.1m)?`,
      ...buildOptions(r, ans, [round(b + (b - a), 1), round(a * (1 + g), 1), round(b * (1 + g * 2), 1), round(b * (1 - g), 1)], 5, v => `EUR ${fmt(v, 1)}m`, Math.max(1, ans * 0.03)),
      explanation: {
        steps: [`Growth ${yrs[yrs.length - 2]}→${yrs[yrs.length - 1]}: (${b} − ${a}) / ${a} = ${P(g * 100, 2)}.`, `Next year: ${b} × (1 ${g >= 0 ? '+' : '−'} ${fmt(Math.abs(g), 4)}) = ${fmt(ans, 1)}.`],
        shortcut: `Multiply the latest value by the ratio ${b}/${a} = ${fmt(b / a, 4)}.`,
        trap: `Adding the same ABSOLUTE change (${b - a}) instead of the same percentage.`,
        rule: `Same % growth → Value × (Value / Previous value).`,
      }, timeTarget: 90, level: 2, tags: ['projection'],
    };
  }
  if (t === 'ratio') {
    const [x, y] = sample(r, rows, 2);
    const c = randInt(r, 0, yrs.length - 1);
    const ans = round(x[c + 1] / y[c + 1], 2);
    return {
      stem: `In ${yrs[c]}, what was the ratio of ${x[0]}'s revenue to ${y[0]}'s revenue?`,
      ...buildOptions(r, ans, [round(y[c + 1] / x[c + 1], 2), round(ans + 0.1, 2), round(ans - 0.15, 2)], 5, v => `${fmt(v, 2)} : 1`, 0.07),
      explanation: {
        steps: [`${x[0]} = ${x[c + 1]}, ${y[0]} = ${y[c + 1]}.`, `${x[c + 1]} / ${y[c + 1]} = ${fmt(ans, 2)}, i.e. ${fmt(ans, 2)} : 1.`],
        shortcut: `The first item named goes in the numerator: "ratio of A to B" = A / B.`,
        trap: `Inverting the ratio (${fmt(y[c + 1] / x[c + 1], 2)} : 1).`,
        rule: `Ratio of A to B = A / B.`,
      }, timeTarget: 50, level: 1, tags: ['ratio'],
    };
  }
  // combined
  const [x, y] = sample(r, rows, 2);
  const a = x[yi + 1] + y[yi + 1], b = x[yj + 1] + y[yj + 1];
  const ans = round((b - a) / a * 100, 1);
  const avgOfGrowth = round(((x[yj + 1] - x[yi + 1]) / x[yi + 1] + (y[yj + 1] - y[yi + 1]) / y[yi + 1]) / 2 * 100, 1);
  return {
    stem: `By what percentage did the combined revenue of ${x[0]} and ${y[0]} change between ${yrs[yi]} and ${yrs[yj]}?`,
    ...buildOptions(r, ans, [avgOfGrowth, round((b - a) / b * 100, 1), round(ans + 3, 1)], 5, v => P(v), 1.6),
    explanation: {
      steps: [`${yrs[yi]}: ${x[yi + 1]} + ${y[yi + 1]} = ${a}.`, `${yrs[yj]}: ${x[yj + 1]} + ${y[yj + 1]} = ${b}.`, `(${b} − ${a}) / ${a} × 100 = ${P(ans)}.`],
      shortcut: `Add up first, then work out ONE single % change.`,
      trap: `Averaging the two growth rates (${P(avgOfGrowth)}): the bases differ, so a simple average is wrong.`,
      rule: `Growth of a combined total = (final sum − initial sum) / initial sum.`,
    }, timeTarget: 90, level: 3, tags: ['combined-growth'],
  };
}

function fxSet(r) {
  const countries = sample(r, [['UK', 'GBP', [0.84, 0.86, 0.88]], ['US', 'USD', [1.08, 1.1, 1.2]], ['Switzerland', 'CHF', [0.94, 0.96]], ['Sweden', 'SEK', [11.2, 11.5]], ['Japan', 'JPY', [160, 162]], ['Poland', 'PLN', [4.3, 4.4]]], 4);
  const eurPrices = countries.map(() => randInt(r, 70, 160));
  const rates = countries.map(c => pick(r, c[2]));
  const rows = countries.map((c, i) => [c[0], c[1], round(eurPrices[i] * rates[i], c[1] === 'JPY' ? 0 : 2), rates[i]]);
  return { title: 'Retail price of the same product', kind: 'table', unit: 'local currency', columns: ['Country', 'Currency', 'Price (local)', 'Units per 1 EUR'], rows, note: 'Exchange rates: units of local currency per 1 EUR.' };
}
function fxQ(r, ds) {
  const rows = ds.rows;
  const eur = rows.map(x => x[2] / x[3]);
  const t = pick(r, ['convert', 'diff', 'pctMore']);
  if (t === 'convert') {
    const i = randInt(r, 0, rows.length - 1);
    const ans = round(eur[i], 2);
    return {
      stem: `What is the price in ${rows[i][0]} expressed in EUR?`,
      ...buildOptions(r, ans, [round(rows[i][2] * rows[i][3], 2), rows[i][2], round(ans * 1.05, 2)], 5, v => `EUR ${fmt(v, 2)}`, Math.max(1, ans * 0.04)),
      explanation: {
        steps: [`The exchange rate is ${rows[i][3]} ${rows[i][1]} per 1 EUR.`, `To go from local currency to EUR, divide: ${rows[i][2]} / ${rows[i][3]} = ${fmt(ans, 2)} EUR.`],
        shortcut: `If more than one local unit buys 1 EUR (rate > 1), the EUR price must be smaller than the local figure.`,
        trap: `Multiplying by the exchange rate instead of dividing.`,
        rule: `Local units per 1 EUR → EUR = local / rate.`,
      }, timeTarget: 60, level: 1, tags: ['fx'],
    };
  }
  const iMax = eur.indexOf(Math.max(...eur)), iMin = eur.indexOf(Math.min(...eur));
  if (t === 'diff') {
    const ans = round(eur[iMax] - eur[iMin], 2);
    return {
      stem: `In EUR, what is the difference between the most expensive and the cheapest country?`,
      ...buildOptions(r, ans, [round(Math.max(...rows.map(x => x[2])) / rows[0][3] - eur[iMin], 2), round(ans * 1.1, 2), round(eur[iMax] - eur[(iMin + 1) % rows.length], 2)], 5, v => `EUR ${fmt(v, 2)}`, Math.max(1, ans * 0.06)),
      explanation: {
        steps: rows.map((x, i) => `${x[0]}: ${x[2]} / ${x[3]} = ${fmt(eur[i], 2)} EUR.`).concat([`Most expensive ${rows[iMax][0]}, cheapest ${rows[iMin][0]}: ${fmt(eur[iMax], 2)} − ${fmt(eur[iMin], 2)} = ${fmt(ans, 2)} EUR.`]),
        shortcut: `Convert everything into the same currency before comparing: local-currency figures are not comparable.`,
        trap: `Picking the most expensive country from the local-currency price (e.g. JPY or SEK show large numbers).`,
        rule: `Comparisons across currencies: convert first, then compare.`,
      }, timeTarget: 120, level: 3, tags: ['fx', 'compare'],
    };
  }
  const ans = round((eur[iMax] / eur[iMin] - 1) * 100, 1);
  return {
    stem: `By what percentage is the product more expensive in ${rows[iMax][0]} than in ${rows[iMin][0]}, in EUR terms?`,
    ...buildOptions(r, ans, [round((1 - eur[iMin] / eur[iMax]) * 100, 1), round(ans + 5, 1), round(ans / 2, 1)], 5, v => P(v), 2),
    explanation: {
      steps: [`${rows[iMax][0]}: ${fmt(eur[iMax], 2)} EUR; ${rows[iMin][0]}: ${fmt(eur[iMin], 2)} EUR.`, `(${fmt(eur[iMax], 2)} / ${fmt(eur[iMin], 2)} − 1) × 100 = ${P(ans)}.`],
      shortcut: `"More expensive than X" → the base is X (the cheapest).`,
      trap: `Using the most expensive country as the base (${P(round((1 - eur[iMin] / eur[iMax]) * 100, 1))}).`,
      rule: `"A is ...% more expensive than B" = (A / B − 1) × 100.`,
    }, timeTarget: 120, level: 3, tags: ['fx', 'percent-more'],
  };
}

function unitsSet(r) {
  const prods = sample(r, ['Alpha', 'Beta', 'Gamma', 'Delta', 'Sigma', 'Omega'], 4);
  const rows = prods.map(p => { const price = randInt(r, 12, 90); const cost = round(price * randInt(r, 45, 80) / 100, 0); return [p, randInt(r, 4, 30) * 100, price, cost]; });
  return { title: 'Product line economics (last quarter)', kind: 'table', unit: 'units, EUR', columns: ['Product', 'Units sold', 'Price per unit (EUR)', 'Cost per unit (EUR)'], rows };
}
function unitsQ(r, ds) {
  const rows = ds.rows;
  const t = pick(r, ['margin', 'revenueShare', 'profitTotal']);
  const row = pick(r, rows);
  if (t === 'margin') {
    const ans = round((row[2] - row[3]) / row[2] * 100, 1);
    return {
      stem: `What is the gross margin of product ${row[0]}?`,
      ...buildOptions(r, ans, [round((row[2] - row[3]) / row[3] * 100, 1), round(row[3] / row[2] * 100, 1), round(ans + 5, 1)], 5, v => P(v), 2),
      explanation: {
        steps: [`Unit margin: ${row[2]} − ${row[3]} = ${row[2] - row[3]} EUR.`, `Margin as % of price: ${row[2] - row[3]} / ${row[2]} × 100 = ${P(ans)}.`],
        shortcut: `Margin is measured on PRICE (revenue); mark-up is measured on cost.`,
        trap: `Dividing by cost (${P(round((row[2] - row[3]) / row[3] * 100, 1))} is the mark-up, not the margin).`,
        rule: `Gross margin % = (Price − Cost) / Price.`,
      }, timeTarget: 50, level: 1, tags: ['margin'],
    };
  }
  if (t === 'revenueShare') {
    const rev = rows.map(x => x[1] * x[2]);
    const tot = rev.reduce((s, v) => s + v, 0);
    const i = rows.indexOf(row);
    const ans = round(rev[i] / tot * 100, 1);
    const unitShare = round(row[1] / rows.reduce((s, x) => s + x[1], 0) * 100, 1);
    return {
      stem: `What percentage of total revenue did product ${row[0]} generate?`,
      ...buildOptions(r, ans, [unitShare, round(ans + 3, 1), round(100 / rows.length, 1)], 5, v => P(v), 1.5),
      explanation: {
        steps: rows.map((x, j) => `${x[0]}: ${x[1]} × ${x[2]} = ${fmt(rev[j], 0)}.`).concat([`Total: ${fmt(tot, 0)}.`, `${fmt(rev[i], 0)} / ${fmt(tot, 0)} × 100 = ${P(ans)}.`]),
        shortcut: `Revenue = units × price for each row, then take the share; do not stop at units.`,
        trap: `Using the share of UNITS sold (${P(unitShare)}) instead of the share of revenue.`,
        rule: `Revenue share = (units × price) / total revenue.`,
      }, timeTarget: 110, level: 2, tags: ['revenue', 'share-of-total'],
    };
  }
  const prof = rows.map(x => x[1] * (x[2] - x[3]));
  const ans = prof.reduce((s, v) => s + v, 0);
  const revTot = rows.reduce((s, x) => s + x[1] * x[2], 0);
  return {
    stem: `What was the total gross profit across all four products (in EUR)?`,
    ...buildOptions(r, ans, [revTot, round(ans * 1.08, 0), rows.reduce((s, x) => s + (x[2] - x[3]), 0) * 100], 5, v => `EUR ${fmt(v, 0)}`, Math.max(100, ans * 0.05)),
    explanation: {
      steps: rows.map((x, j) => `${x[0]}: ${x[1]} × (${x[2]} − ${x[3]}) = ${fmt(prof[j], 0)}.`).concat([`Sum: ${fmt(ans, 0)} EUR.`]),
      shortcut: `Row by row: units × unit margin; then add up.`,
      trap: `Giving total revenue (${fmt(revTot, 0)}) and forgetting to subtract the costs.`,
      rule: `Gross profit = Σ units × (price − cost).`,
    }, timeTarget: 120, level: 2, tags: ['profit'],
  };
}

function budgetSet(r) {
  const depts = sample(r, ['Sales', 'Marketing', 'IT', 'Operations', 'HR', 'Finance', 'R&D'], 5);
  const rows = depts.map(d => { const b = randInt(r, 8, 60) * 10; return [d, b, round(b * (1 + randInt(r, -15, 20) / 100), 0)]; });
  return { title: 'Departmental spending vs budget', kind: pick(r, ['table', 'bar']), unit: 'EUR k', columns: ['Department', 'Budget', 'Actual'], rows };
}
function budgetQ(r, ds) {
  const rows = ds.rows;
  const t = pick(r, ['variance', 'totalOver', 'count']);
  if (t === 'variance') {
    const row = pick(r, rows);
    const ans = round((row[2] - row[1]) / row[1] * 100, 1);
    return {
      stem: `By what percentage did ${row[0]}'s actual spending differ from its budget? (positive = overspend)`,
      ...buildOptions(r, ans, [round((row[2] - row[1]) / row[2] * 100, 1), -ans, round(ans + 2.5, 1)], 5, v => P(v), 1.5),
      explanation: {
        steps: [`Variance: ${row[2]} − ${row[1]} = ${row[2] - row[1]}.`, `Relative to BUDGET: ${row[2] - row[1]} / ${row[1]} × 100 = ${P(ans)}.`],
        shortcut: `The base for a variance is the budget (the benchmark).`,
        trap: `Dividing by actual spending instead of by the budget.`,
        rule: `Variance % = (Actual − Budget) / Budget.`,
      }, timeTarget: 50, level: 1, tags: ['variance'],
    };
  }
  if (t === 'totalOver') {
    const totB = rows.reduce((s, x) => s + x[1], 0), totA = rows.reduce((s, x) => s + x[2], 0);
    const ans = round((totA - totB) / totB * 100, 1);
    return {
      stem: `Across all departments, by what percentage was total actual spending above (+) or below (−) total budget?`,
      ...buildOptions(r, ans, [round((totA - totB) / totA * 100, 1), round(rows.reduce((s, x) => s + (x[2] - x[1]) / x[1], 0) / rows.length * 100, 1), round(ans - 2, 1)], 5, v => P(v), 1.2),
      explanation: {
        steps: [`Total budget: ${rows.map(x => x[1]).join(' + ')} = ${totB}.`, `Total actual: ${rows.map(x => x[2]).join(' + ')} = ${totA}.`, `(${totA} − ${totB}) / ${totB} × 100 = ${P(ans)}.`],
        shortcut: `Add up the two columns and do ONE division.`,
        trap: `Averaging the departments' % variances: that gives large and small departments the same weight.`,
        rule: `Aggregate variance = (Σ actual − Σ budget) / Σ budget.`,
      }, timeTarget: 100, level: 2, tags: ['variance', 'aggregate'],
    };
  }
  const k = pick(r, [5, 10]);
  const ans = rows.filter(x => (x[2] - x[1]) / x[1] * 100 > k).length;
  return {
    stem: `How many departments overspent their budget by more than ${k}%?`,
    // every option is a possible count (0..number of departments)
    ...buildOptions(r, ans, [rows.filter(x => x[2] > x[1]).length, ans + 1, ans - 1, ans + 2, ans - 2, ...Array.from({ length: rows.length + 1 }, (_, i) => i)].filter(v => v >= 0 && v <= rows.length), Math.min(5, rows.length + 1), v => fmt(v, 0), 1),
    explanation: {
      steps: rows.map(x => `${x[0]}: (${x[2]} − ${x[1]}) / ${x[1]} = ${P((x[2] - x[1]) / x[1] * 100)}${(x[2] - x[1]) / x[1] * 100 > k ? ' ✓' : ''}.`).concat([`Above ${k}%: ${ans}.`]),
      shortcut: `Quick threshold: overspend > ${k}% means Actual > Budget × ${fmt(1 + k / 100, 2)}; compare row by row.`,
      trap: `Counting every department that overspent, including those below the threshold.`,
      rule: `Turn the % threshold into a multiplier and compare.`,
    }, timeTarget: 90, level: 2, tags: ['threshold'],
  };
}

const FAMILIES = [[regional, regionalQ, 4], [fxSet, fxQ, 2], [unitsSet, unitsQ, 2], [budgetSet, budgetQ, 2]];

export function generateNumerical(seed) {
  const r = rng(seed);
  const total = FAMILIES.reduce((s, f) => s + f[2], 0);
  let x = r() * total, fam = FAMILIES[0];
  for (const f of FAMILIES) { if ((x -= f[2]) <= 0) { fam = f; break; } }
  const ds = fam[0](r);
  const q = fam[1](r, ds);
  return { id: `gen-num-${seed}`, skill: 'numerical', type: 'mcq', generated: true, level: q.level, context: { kind: 'dataset', dataset: ds }, stem: q.stem, options: q.options, answer: q.answer, timeTarget: q.timeTarget, explanation: q.explanation, tags: q.tags };
}
