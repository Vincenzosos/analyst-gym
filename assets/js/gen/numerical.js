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
  const t = pick(r, ['change', 'share', 'largestGrowth', 'average', 'projection', 'ratio', 'combined']);
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
        steps: [`${row[0]}: ${yrs[yi]} = ${a}, ${yrs[yj]} = ${b}.`, `Differenza: ${b} − ${a} = ${b - a}.`, `${b - a} / ${a} × 100 = ${P(ans)}.`],
        shortcut: `Rapporto ${b}/${a} = ${fmt(b / a, 3)}: la parte dopo l'1 è la variazione.`,
        trap: `Usare come base l'anno finale (${b}) o prendere l'anno sbagliato nella tabella.`,
        rule: `Variazione % = (Finale − Iniziale) / Iniziale × 100.`,
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
        steps: [`Totale ${yrs[c]}: ${col(c).join(' + ')} = ${tot}.`, `${row[0]}: ${row[c + 1]}.`, `${row[c + 1]} / ${tot} × 100 = ${P(ans)}.`],
        shortcut: `Stima: ${row[c + 1]} su circa ${Math.round(tot / 10) * 10} → circa ${fmt(row[c + 1] / tot * 100, 0)}%, poi scegli l'opzione più vicina.`,
        trap: `Dividere per la somma delle ALTRE regioni (${others}) invece che per il totale.`,
        rule: `Quota = parte / totale; il totale include la parte stessa.`,
      }, timeTarget: 70, level: 1, tags: ['share-of-total'],
    };
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
        steps: g.map(x => `${x.n}: ${P(x.g * 100)}.`).concat([`La crescita % più alta è ${best.n}.`]),
        shortcut: `Confronta i rapporti finale/iniziale senza calcolarli tutti con precisione: elimina subito chi cala o cresce poco.`,
        trap: bestAbs.n !== best.n ? `Scegliere ${bestAbs.n}, che ha l'aumento ASSOLUTO maggiore (+${bestAbs.d}) ma non quello percentuale.` : `Confondere aumento assoluto e percentuale: qui coincidono, ma non è sempre così.`,
        rule: `"Percentage increase" = rapporto, non differenza.`,
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
        steps: [`Somma ${yrs[c]}: ${vals.join(' + ')} = ${vals.reduce((s, v) => s + v, 0)}.`, `Diviso ${vals.length} regioni = ${fmt(ans, 1)}.`],
        shortcut: `Arrotonda i valori a decine, somma, poi dividi: l'opzione giusta sarà la più vicina.`,
        trap: `Dividere per il numero sbagliato di elementi, o fare la media tra massimo e minimo.`,
        rule: `Media = somma / numero di elementi.`,
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
        steps: [`Crescita ${yrs[yrs.length - 2]}→${yrs[yrs.length - 1]}: (${b} − ${a}) / ${a} = ${P(g * 100, 2)}.`, `Prossimo anno: ${b} × (1 ${g >= 0 ? '+' : '−'} ${fmt(Math.abs(g), 4)}) = ${fmt(ans, 1)}.`],
        shortcut: `Moltiplica l'ultimo valore per il rapporto ${b}/${a} = ${fmt(b / a, 4)}.`,
        trap: `Aggiungere la stessa variazione ASSOLUTA (${b - a}) invece della stessa percentuale.`,
        rule: `Stessa crescita % → Valore × (Valore / Valore precedente).`,
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
        steps: [`${x[0]} = ${x[c + 1]}, ${y[0]} = ${y[c + 1]}.`, `${x[c + 1]} / ${y[c + 1]} = ${fmt(ans, 2)}, cioè ${fmt(ans, 2)} : 1.`],
        shortcut: `Il primo nominato va al numeratore: "ratio of A to B" = A / B.`,
        trap: `Invertire il rapporto (${fmt(y[c + 1] / x[c + 1], 2)} : 1).`,
        rule: `Rapporto A a B = A / B.`,
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
      shortcut: `Somma prima, poi calcola UNA sola variazione %.`,
      trap: `Fare la media delle due crescite (${P(avgOfGrowth)}): le basi sono diverse, quindi la media semplice è sbagliata.`,
      rule: `Crescita di un aggregato = (somma finale − somma iniziale) / somma iniziale.`,
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
        steps: [`Il cambio è ${rows[i][3]} ${rows[i][1]} per 1 EUR.`, `Da valuta locale a EUR si divide: ${rows[i][2]} / ${rows[i][3]} = ${fmt(ans, 2)} EUR.`],
        shortcut: `Se servono più unità locali per 1 EUR (cambio > 1), il prezzo in EUR deve essere più piccolo del numero locale.`,
        trap: `Moltiplicare per il cambio invece di dividere.`,
        rule: `Unità locali per 1 EUR → EUR = locale / cambio.`,
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
        steps: rows.map((x, i) => `${x[0]}: ${x[2]} / ${x[3]} = ${fmt(eur[i], 2)} EUR.`).concat([`Più caro ${rows[iMax][0]}, più economico ${rows[iMin][0]}: ${fmt(eur[iMax], 2)} − ${fmt(eur[iMin], 2)} = ${fmt(ans, 2)} EUR.`]),
        shortcut: `Converti tutto nella stessa valuta prima di confrontare: i numeri locali non sono confrontabili.`,
        trap: `Scegliere il più caro guardando il prezzo in valuta locale (es. JPY o SEK hanno numeri grandi).`,
        rule: `Confronti tra valute: prima converti, poi confronta.`,
      }, timeTarget: 120, level: 3, tags: ['fx', 'compare'],
    };
  }
  const ans = round((eur[iMax] / eur[iMin] - 1) * 100, 1);
  return {
    stem: `By what percentage is the product more expensive in ${rows[iMax][0]} than in ${rows[iMin][0]}, in EUR terms?`,
    ...buildOptions(r, ans, [round((1 - eur[iMin] / eur[iMax]) * 100, 1), round(ans + 5, 1), round(ans / 2, 1)], 5, v => P(v), 2),
    explanation: {
      steps: [`${rows[iMax][0]}: ${fmt(eur[iMax], 2)} EUR; ${rows[iMin][0]}: ${fmt(eur[iMin], 2)} EUR.`, `(${fmt(eur[iMax], 2)} / ${fmt(eur[iMin], 2)} − 1) × 100 = ${P(ans)}.`],
      shortcut: `"Più caro di X" → la base è X (il più economico).`,
      trap: `Usare come base il paese più caro (${P(round((1 - eur[iMin] / eur[iMax]) * 100, 1))}).`,
      rule: `"A è più caro di B del ...%" = (A / B − 1) × 100.`,
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
        steps: [`Margine unitario: ${row[2]} − ${row[3]} = ${row[2] - row[3]} EUR.`, `Margine % sul prezzo: ${row[2] - row[3]} / ${row[2]} × 100 = ${P(ans)}.`],
        shortcut: `Il margine si calcola sul PREZZO (ricavo), il mark-up sul costo.`,
        trap: `Dividere per il costo (${P(round((row[2] - row[3]) / row[3] * 100, 1))} è il mark-up, non il margine).`,
        rule: `Margine lordo % = (Prezzo − Costo) / Prezzo.`,
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
        steps: rows.map((x, j) => `${x[0]}: ${x[1]} × ${x[2]} = ${fmt(rev[j], 0)}.`).concat([`Totale: ${fmt(tot, 0)}.`, `${fmt(rev[i], 0)} / ${fmt(tot, 0)} × 100 = ${P(ans)}.`]),
        shortcut: `Ricavo = unità × prezzo per ogni riga, poi quota; non fermarti alle unità.`,
        trap: `Usare la quota sulle UNITÀ vendute (${P(unitShare)}) invece che sui ricavi.`,
        rule: `Quota di ricavi = (unità × prezzo) / ricavi totali.`,
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
      steps: rows.map((x, j) => `${x[0]}: ${x[1]} × (${x[2]} − ${x[3]}) = ${fmt(prof[j], 0)}.`).concat([`Somma: ${fmt(ans, 0)} EUR.`]),
      shortcut: `Per riga: unità × margine unitario; poi somma.`,
      trap: `Riportare il ricavo totale (${fmt(revTot, 0)}) dimenticando di togliere i costi.`,
      rule: `Profitto lordo = Σ unità × (prezzo − costo).`,
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
        steps: [`Scostamento: ${row[2]} − ${row[1]} = ${row[2] - row[1]}.`, `Rispetto al BUDGET: ${row[2] - row[1]} / ${row[1]} × 100 = ${P(ans)}.`],
        shortcut: `La base di uno scostamento è il budget (il riferimento).`,
        trap: `Dividere per l'effettivo invece che per il budget.`,
        rule: `Scostamento % = (Effettivo − Budget) / Budget.`,
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
        steps: [`Budget totale: ${rows.map(x => x[1]).join(' + ')} = ${totB}.`, `Effettivo totale: ${rows.map(x => x[2]).join(' + ')} = ${totA}.`, `(${totA} − ${totB}) / ${totB} × 100 = ${P(ans)}.`],
        shortcut: `Somma le due colonne e fai UNA divisione.`,
        trap: `Fare la media degli scostamenti % dei reparti: pesa allo stesso modo reparti grandi e piccoli.`,
        rule: `Scostamento aggregato = (Σ effettivo − Σ budget) / Σ budget.`,
      }, timeTarget: 100, level: 2, tags: ['variance', 'aggregate'],
    };
  }
  const k = pick(r, [5, 10]);
  const ans = rows.filter(x => (x[2] - x[1]) / x[1] * 100 > k).length;
  return {
    stem: `How many departments overspent their budget by more than ${k}%?`,
    ...buildOptions(r, ans, [rows.filter(x => x[2] > x[1]).length, ans + 1, ans + 2, ans - 1, ans + 3, ans - 2].filter(v => v >= 0 && v <= rows.length), 5, v => fmt(v, 0), 1),
    explanation: {
      steps: rows.map(x => `${x[0]}: (${x[2]} − ${x[1]}) / ${x[1]} = ${P((x[2] - x[1]) / x[1] * 100)}${(x[2] - x[1]) / x[1] * 100 > k ? ' ✓' : ''}.`).concat([`Sopra il ${k}%: ${ans}.`]),
      shortcut: `Soglia rapida: overspend > ${k}% significa Effettivo > Budget × ${fmt(1 + k / 100, 2)}; confronta riga per riga.`,
      trap: `Contare tutti i reparti in overspend, anche quelli sotto la soglia.`,
      rule: `Trasforma la soglia % in un moltiplicatore e confronta.`,
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
