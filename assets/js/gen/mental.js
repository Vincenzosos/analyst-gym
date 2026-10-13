// Mental-math generator: fresh MCQs with Italian step-by-step explanations.
import { rng, randInt, pick, buildOptions, fmt, round } from '../util.js';

const P = (x, d = 1) => `${fmt(x, d)}%`;
const N = (x, d = 2) => fmt(x, d);

const TYPES = {
  pctOf(r) {
    const p = pick(r, [5, 10, 12.5, 15, 20, 25, 30, 35, 40, 45, 60, 75, 120, 135]);
    const base = pick(r, [40, 80, 120, 160, 240, 320, 360, 480, 560, 640, 720, 840, 960, 1200, 1440]);
    const ans = base * p / 100;
    const o = buildOptions(r, ans, [base * p / 1000, base / p, ans * 1.1, base * (100 - p) / 100, ans + 10], 4, v => N(v));
    return {
      stem: `What is ${fmt(p)}% of ${fmt(base, 0)}?`, ...o, timeTarget: 20, level: 1, tags: ['percent-of'],
      explanation: {
        steps: [`${fmt(p)}% significa ${fmt(p)}/100.`, `Spezza: 10% di ${fmt(base, 0)} = ${N(base / 10)}; 1% = ${N(base / 100)}.`, `${fmt(p)}% = ${N(base / 100)} × ${fmt(p)} = ${N(ans)}.`],
        shortcut: `Parti dal 10% (sposta la virgola) e combina: es. 35% = 3×10% + 5%; 12,5% = 1/8.`,
        trap: `Dividere per la percentuale invece di moltiplicare, o calcolare il complemento (${100 - p}%).`,
        rule: `X% di Y = Y × X / 100; costruiscilo da 10%, 5% e 1%.`,
      },
    };
  },
  pctChange(r) {
    const old = pick(r, [40, 50, 60, 80, 120, 150, 160, 200, 240, 250, 320, 400, 480, 500, 640, 800]);
    const p = pick(r, [-40, -30, -25, -20, -15, -12.5, -10, -5, 5, 10, 12.5, 15, 20, 25, 30, 35, 40, 50, 60, 75]);
    const nw = round(old * (1 + p / 100), 2);
    const wrongBase = (nw - old) / nw * 100;
    const o = buildOptions(r, p, [round(wrongBase, 1), -p, p * 2, round((nw / old) * 100, 1)], 4, v => P(v));
    return {
      stem: `A metric moves from ${N(old)} to ${N(nw)}. What is the percentage change?`, ...o, timeTarget: 30, level: 1, tags: ['percent-change'],
      explanation: {
        steps: [`Differenza: ${N(nw)} − ${N(old)} = ${N(nw - old)}.`, `Dividi per il valore INIZIALE: ${N(nw - old)} / ${N(old)} = ${fmt((nw - old) / old, 4)}.`, `× 100 = ${P(p)}.`],
        shortcut: `Rapporto nuovo/vecchio: ${N(nw)}/${N(old)} = ${fmt(nw / old, 3)}, quindi ${p >= 0 ? '+' : ''}${P(p)}.`,
        trap: `Dividere per il valore finale (${P(round(wrongBase, 1))}): la base è sempre il valore di partenza.`,
        rule: `Variazione % = (Nuovo − Vecchio) / Vecchio × 100.`,
      },
    };
  },
  reversePct(r) {
    const orig = pick(r, [40, 60, 80, 120, 150, 160, 200, 240, 250, 300, 400, 480, 500, 640]);
    const p = pick(r, [10, 20, 25, 50, -10, -20, -25, 12.5, 60]);
    const now = round(orig * (1 + p / 100), 2);
    const naive = round(now * (1 - p / 100), 2);
    const o = buildOptions(r, orig, [naive, now, round(now - p, 2), round(now / (p / 100), 2)], 4, v => N(v));
    return {
      stem: `After a ${p >= 0 ? 'rise' : 'fall'} of ${fmt(Math.abs(p))}%, a price is ${N(now)}. What was the original price?`, ...o, timeTarget: 30, level: 2, tags: ['reverse-percent'],
      explanation: {
        steps: [`Il prezzo attuale è il ${fmt(100 + p)}% dell'originale, cioè originale × ${fmt(1 + p / 100, 3)}.`, `Originale = ${N(now)} / ${fmt(1 + p / 100, 3)} = ${N(orig)}.`],
        shortcut: `Dividi per (1 ${p >= 0 ? '+' : '−'} ${fmt(Math.abs(p) / 100, 3)}); non togliere la percentuale dal valore nuovo.`,
        trap: `Fare ${N(now)} ${p >= 0 ? '−' : '+'} ${fmt(Math.abs(p))}% di ${N(now)} = ${N(naive)}: la percentuale si applicava al valore originale, non a quello nuovo.`,
        rule: `Valore originale = Valore finale / (1 + variazione).`,
      },
    };
  },
  fractionPct(r) {
    const [a, b] = pick(r, [[1, 8], [3, 8], [5, 8], [7, 8], [1, 6], [5, 6], [1, 3], [2, 3], [1, 12], [3, 16], [2, 5], [4, 9], [7, 20], [9, 40], [1, 40]]);
    const ans = round((a / b) * 100, 2);
    const o = buildOptions(r, ans, [round((b / a) * 10, 2), round(ans / 10, 2), round(ans + 2.5, 2), round(100 - ans, 2)], 4, v => P(v, 2));
    return {
      stem: `Express ${a}/${b} as a percentage.`, ...o, timeTarget: 20, level: 1, tags: ['fractions'],
      explanation: {
        steps: [`${a}/${b} = ${a} ÷ ${b} = ${fmt(a / b, 4)}.`, `× 100 = ${P(ans, 2)}.`],
        shortcut: `Memorizza: 1/8 = 12,5%, 1/6 ≈ 16,7%, 1/3 ≈ 33,3%, 1/12 ≈ 8,3%, 1/40 = 2,5%; poi moltiplica per il numeratore.`,
        trap: `Invertire la frazione (${b}/${a}) o dimenticare il × 100.`,
        rule: `Frazione → % : dividi e moltiplica per 100; usa le frazioni base come mattoni.`,
      },
    };
  },
  multiply(r) {
    const a = randInt(r, 12, 89), b = randInt(r, 11, 49);
    const ans = a * b;
    const o = buildOptions(r, ans, [ans + 10, ans - 10, ans + a, ans - b, a * (b + 1)], 4, v => fmt(v, 0));
    const t = Math.floor(b / 10) * 10, u = b % 10;
    return {
      stem: `${a} × ${b} = ?`, ...o, timeTarget: 25, level: 1, tags: ['multiplication'],
      explanation: {
        steps: [`Spezza ${b} in ${t} + ${u}.`, `${a} × ${t} = ${a * t}; ${a} × ${u} = ${a * u}.`, `Somma: ${a * t} + ${a * u} = ${ans}.`],
        shortcut: `Arrotonda e correggi: ${a} × ${b} = ${a} × ${t + (u ? 10 : 0)} − ${a} × ${u ? 10 - u : 0} = ${a * (t + (u ? 10 : 0))} − ${a * (u ? 10 - u : 0)}.`,
        trap: `Errori di riporto: controlla l'ultima cifra (${a % 10} × ${b % 10} finisce con ${(a * b) % 10}).`,
        rule: `Distribuisci su decine e unità; verifica con l'ultima cifra.`,
      },
    };
  },
  divide(r) {
    const b = pick(r, [4, 6, 8, 12, 15, 16, 24, 25, 32, 40, 48]);
    const ans = pick(r, [12.5, 15, 18, 22.5, 24, 35, 37.5, 45, 62.5, 75, 120, 135]);
    const a = round(ans * b, 2);
    const o = buildOptions(r, ans, [ans * 10, ans / 10, ans + b / 4, round(a / (b + 1), 2)], 4, v => N(v));
    return {
      stem: `${N(a)} ÷ ${b} = ?`, ...o, timeTarget: 25, level: 1, tags: ['division'],
      explanation: {
        steps: [`Scomponi il divisore ${b} in fattori semplici e dividi a passi.`, `${N(a)} ÷ ${b} = ${N(ans)} (verifica: ${N(ans)} × ${b} = ${N(a)}).`],
        shortcut: `Stima prima l'ordine di grandezza: ${N(a)} / ${b} è circa ${fmt(Math.round(a / b), 0)}.`,
        trap: `Sbagliare la posizione della virgola (risposta 10 volte più grande o piccola).`,
        rule: `Dividi per fattori (÷ 24 = ÷ 4 poi ÷ 6) e verifica moltiplicando.`,
      },
    };
  },
  cagr(r) {
    const years = pick(r, [2, 3, 4, 5]);
    const g = pick(r, [5, 8, 10, 12, 15, 20]);
    const start = pick(r, [100, 200, 250, 400, 500]);
    const end = round(start * (1 + g / 100) ** years, 0);
    const simple = round(((end / start - 1) / years) * 100, 1);
    const o = buildOptions(r, g, [simple, round(simple * 1.25, 1), round(g / 2, 1), round(((end - start) / end) * 100 / years, 1)], 4, v => P(v));
    return {
      stem: `Revenue grows from ${fmt(start, 0)} to ${fmt(end, 0)} over ${years} years. Which annual growth rate (CAGR) is closest?`, ...o, timeTarget: 45, level: 3, tags: ['cagr'],
      explanation: {
        steps: [`Moltiplicatore totale: ${fmt(end, 0)} / ${fmt(start, 0)} = ${fmt(end / start, 3)}.`, `CAGR = ${fmt(end / start, 3)}^(1/${years}) − 1 = ${P(g)}.`, `Verifica: ${fmt(start, 0)} × ${fmt(1 + g / 100, 2)}^${years} ≈ ${fmt(end, 0)}.`],
        shortcut: `Prova le opzioni al contrario: (1 + g)^${years} deve dare ${fmt(end / start, 2)}. La crescita semplice (${P(simple)}) sovrastima sempre la CAGR.`,
        trap: `Dividere la crescita totale per gli anni (${P(simple)}): ignora l'interesse composto.`,
        rule: `CAGR = (Finale / Iniziale)^(1/anni) − 1; testa le opzioni elevando a potenza.`,
      },
    };
  },
  rule72(r) {
    const g = pick(r, [3, 4, 6, 8, 9, 12, 18, 24]);
    const ans = round(72 / g, 1);
    const o = buildOptions(r, ans, [round(100 / g, 1), round(50 / g, 1), round(ans * 2, 1), round(ans / 2, 1)], 4, v => fmt(v, 1));
    return {
      stem: `At ${g}% per year, roughly how many years does it take for an investment to double?`, ...o, timeTarget: 15, level: 1, tags: ['rule-of-72'],
      explanation: {
        steps: [`Regola del 72: anni per raddoppiare ≈ 72 / tasso%.`, `72 / ${g} = ${fmt(ans, 1)} anni.`],
        shortcut: `72 è divisibile per 2, 3, 4, 6, 8, 9, 12, 18, 24: il calcolo è immediato.`,
        trap: `Usare 100 / tasso (interesse semplice, ${fmt(100 / g, 1)} anni).`,
        rule: `Raddoppio ≈ 72 / g; triplicare ≈ 114 / g.`,
      },
    };
  },
  compound(r) {
    const base = pick(r, [100, 200, 500, 1000]);
    const g = pick(r, [5, 10, 20]);
    const y = pick(r, [2, 3]);
    const ans = round(base * (1 + g / 100) ** y, 2);
    const simple = base * (1 + g * y / 100);
    const o = buildOptions(r, ans, [simple, round(ans + base * 0.01 * g, 2), round(base * (1 + g / 100) ** (y + 1), 2)], 4, v => N(v));
    return {
      stem: `${fmt(base, 0)} grows by ${g}% a year, compounded, for ${y} years. What is the final value?`, ...o, timeTarget: 30, level: 2, tags: ['compounding'],
      explanation: {
        steps: Array.from({ length: y }, (_, i) => `Anno ${i + 1}: ${N(base * (1 + g / 100) ** i)} × ${fmt(1 + g / 100, 2)} = ${N(base * (1 + g / 100) ** (i + 1))}.`),
        shortcut: `${fmt(1 + g / 100, 2)}^${y} = ${fmt((1 + g / 100) ** y, 4)}; moltiplica una volta sola.`,
        trap: `Interesse semplice: ${N(simple)} (manca l'interesse sugli interessi).`,
        rule: `Valore finale = Iniziale × (1 + g)^n.`,
      },
    };
  },
  ppVsPct(r) {
    const a = pick(r, [8, 10, 12, 15, 20, 25, 30, 40]);
    const d = pick(r, [2, 3, 4, 5, 6, -2, -3, -5]);
    const b = a + d;
    const askPct = r() < 0.5;
    const pct = round((d / a) * 100, 1);
    const ans = askPct ? pct : d;
    const o = buildOptions(r, ans, askPct ? [d, round((d / b) * 100, 1), -pct] : [pct, -d, round(d / 100, 2)], 4, v => fmt(v, 1));
    return {
      stem: `An operating margin moves from ${a}% to ${b}%. By how much did it change, in ${askPct ? 'percent (relative change)' : 'percentage points'}?`, ...o, timeTarget: 25, level: 2, tags: ['percentage-points'],
      explanation: {
        steps: [`Punti percentuali = differenza semplice: ${b} − ${a} = ${d} pp.`, `Variazione % relativa = ${d} / ${a} × 100 = ${P(pct)}.`, `La domanda chiede ${askPct ? 'la variazione %' : 'i punti percentuali'}: ${fmt(ans, 1)}.`],
        shortcut: `Leggi l'unità richiesta prima di calcolare: pp = sottrazione, % = divisione per il valore iniziale.`,
        trap: `Confondere punti percentuali e percentuale (${d} contro ${P(pct)}).`,
        rule: `Da a% a b%: (b − a) pp; ((b − a)/a) × 100 in %.`,
      },
    };
  },
  fx(r) {
    const rate = pick(r, [1.08, 1.1, 1.2, 1.25, 0.85, 0.9, 1.5]);
    const eur = pick(r, [200, 400, 500, 800, 1000, 1200, 2000]);
    const usd = round(eur * rate, 2);
    const askEur = r() < 0.6;
    const ans = askEur ? eur : usd;
    const o = buildOptions(r, ans, askEur ? [round(usd * rate, 2), round(usd - (rate - 1) * 100, 2), usd] : [round(eur / rate, 2), eur, round(eur * (rate + 0.1), 2)], 4, v => N(v));
    return {
      stem: askEur ? `1 EUR = ${rate} USD. How many EUR is ${N(usd)} USD?` : `1 EUR = ${rate} USD. How many USD is ${N(eur)} EUR?`, ...o, timeTarget: 30, level: 1, tags: ['fx'],
      explanation: {
        steps: askEur ? [`Da USD a EUR si DIVIDE per il cambio: ${N(usd)} / ${rate} = ${N(eur)}.`] : [`Da EUR a USD si MOLTIPLICA per il cambio: ${N(eur)} × ${rate} = ${N(usd)}.`],
        shortcut: `Controlla il verso: se 1 EUR vale più di 1 USD, gli EUR devono essere MENO degli USD.`,
        trap: `Moltiplicare quando bisogna dividere (o viceversa).`,
        rule: `Cambio "1 A = k B": da A a B × k, da B a A ÷ k.`,
      },
    };
  },
  bps(r) {
    const a = pick(r, [2.15, 3.25, 3.4, 4.05, 4.5, 5.2]);
    const d = pick(r, [15, 25, 35, 40, 60, 75, -25, -50]);
    const b = round(a + d / 100, 2);
    const o = buildOptions(r, d, [d / 10, d * 10, round((d / 100) / a * 100, 1)], 4, v => `${fmt(v, 1)} bps`);
    return {
      stem: `A bond yield moves from ${a.toFixed(2)}% to ${b.toFixed(2)}%. What is the change in basis points?`, ...o, timeTarget: 15, level: 1, tags: ['basis-points'],
      explanation: {
        steps: [`Differenza: ${b.toFixed(2)} − ${a.toFixed(2)} = ${(d / 100).toFixed(2)} punti percentuali.`, `1 pp = 100 bps, quindi ${(d / 100).toFixed(2)} × 100 = ${d} bps.`],
        shortcut: `Togli la virgola alla differenza: 0,35% = 35 bps.`,
        trap: `Calcolare la variazione relativa (in %) invece della differenza assoluta.`,
        rule: `1 bp = 0,01%; 100 bps = 1 punto percentuale.`,
      },
    };
  },
  multiple(r) {
    const ebitda = pick(r, [80, 120, 150, 200, 250, 400]);
    const m = pick(r, [6, 7.5, 8, 9, 10, 12, 12.5, 14]);
    const ev = round(ebitda * m, 2);
    const net = pick(r, [0, 100, 200, 300]);
    const askEquity = r() < 0.4;
    const ans = askEquity ? ev - net : m;
    const o = askEquity ? buildOptions(r, ev - net, [ev + net, ev, ev - 2 * net || ev * 0.9], 4, v => fmt(v, 1)) : buildOptions(r, m, [round(ebitda / ev * 100, 1), m + 1, round((ev - net) / ebitda, 1)], 4, v => `${fmt(v, 1)}x`);
    return {
      stem: askEquity ? `A company has EBITDA of ${ebitda} and trades at ${m}x EV/EBITDA. Net debt is ${net}. What is its equity value?` : `Enterprise value is ${fmt(ev, 1)} and EBITDA is ${ebitda}. What is the EV/EBITDA multiple?`, ...o, timeTarget: 30, level: 2, tags: ['multiples'],
      explanation: {
        steps: askEquity ? [`EV = ${ebitda} × ${m} = ${fmt(ev, 1)}.`, `Equity value = EV − debito netto = ${fmt(ev, 1)} − ${net} = ${fmt(ev - net, 1)}.`] : [`EV/EBITDA = ${fmt(ev, 1)} / ${ebitda} = ${fmt(m, 1)}x.`],
        shortcut: askEquity ? `EV è "per tutti i finanziatori"; per arrivare all'equity togli il debito netto.` : `Dividi e arrotonda: i multipli si leggono con una cifra decimale.`,
        trap: askEquity ? `Sommare il debito netto invece di sottrarlo.` : `Invertire il rapporto (EBITDA / EV).`,
        rule: `Equity value = EV − debito netto (− minoranze, + investimenti non consolidati).`,
      },
    };
  },
};

export const MENTAL_TYPES = Object.keys(TYPES);

export function generateMental(seed, type) {
  const r = rng(seed);
  const t = type || pick(r, MENTAL_TYPES);
  const q = TYPES[t](r);
  return { id: `gen-men-${t}-${seed}`, skill: 'mental', type: 'mcq', generated: true, level: q.level, stem: q.stem, options: q.options, answer: q.answer, timeTarget: q.timeTarget, explanation: q.explanation, tags: q.tags };
}
