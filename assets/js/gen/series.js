// Number and letter series generator (inductive reasoning).
import { rng, randInt, pick, buildOptions, fmt } from '../util.js';

const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const letter = i => L[((i % 26) + 26) % 26];

const NUM = {
  arithmetic(r) {
    const a = randInt(r, 2, 40), d = pick(r, [3, 4, 6, 7, 8, 9, 11, 12, -4, -6, -7]);
    const s = Array.from({ length: 6 }, (_, i) => a + i * d);
    return { seq: s.slice(0, 5), ans: s[5], wrong: [s[5] + d, s[4] + 2 * d, s[5] - 1], rule: `Si aggiunge sempre ${d > 0 ? '+' : ''}${d}.`, diffs: true, level: 1 };
  },
  geometric(r) {
    const a = pick(r, [1, 2, 3, 4, 5]), q = pick(r, [2, 3, -2]);
    const s = Array.from({ length: 6 }, (_, i) => a * q ** i);
    return { seq: s.slice(0, 5), ans: s[5], wrong: [s[4] + (s[4] - s[3]), s[5] * q, -s[5]], rule: `Ogni termine è il precedente × ${q}.`, level: 1 };
  },
  growingDiff(r) {
    const a = randInt(r, 1, 20), d0 = randInt(r, 1, 5), k = pick(r, [1, 2, 3]);
    const s = [a]; for (let i = 0; i < 5; i++) s.push(s[i] + d0 + i * k);
    return { seq: s.slice(0, 5), ans: s[5], wrong: [s[4] + (s[4] - s[3]), s[5] + k, s[5] - k], rule: `Le differenze crescono di ${k}: ${s.slice(1).map((v, i) => v - s[i]).join(', ')}.`, diffs: true, level: 2 };
  },
  alternating(r) {
    const a = randInt(r, 2, 15), b = randInt(r, 20, 50), da = pick(r, [2, 3, 5]), db = pick(r, [-2, -3, 4]);
    const s = []; for (let i = 0; i < 7; i++) s.push(i % 2 === 0 ? a + (i / 2) * da : b + ((i - 1) / 2) * db);
    return { seq: s.slice(0, 6), ans: s[6], wrong: [s[5] + db, s[4] + da + 1, s[6] + da], rule: `Due serie intrecciate: posizioni dispari ${a}, ${a + da}, ${a + 2 * da}... (+${da}); posizioni pari ${b}, ${b + db}, ... (${db > 0 ? '+' : ''}${db}).`, level: 2 };
  },
  squares(r) {
    const off = randInt(r, 0, 4), c = pick(r, [0, 1, -1, 2, 3]);
    const s = Array.from({ length: 6 }, (_, i) => (i + 1 + off) ** 2 + c);
    return { seq: s.slice(0, 5), ans: s[5], wrong: [s[4] + (s[4] - s[3]), s[5] + 1, (6 + off) ** 2 + c], rule: `Quadrati ${c ? (c > 0 ? '+' + c : c) : ''}: ${Array.from({ length: 6 }, (_, i) => `${i + 1 + off}²${c ? (c > 0 ? '+' + c : c) : ''}`).join(', ')}.`, level: 2 };
  },
  fibonacci(r) {
    const a = randInt(r, 1, 6), b = randInt(r, 2, 9);
    const s = [a, b]; for (let i = 2; i < 7; i++) s.push(s[i - 1] + s[i - 2]);
    return { seq: s.slice(0, 6), ans: s[6], wrong: [s[5] + (s[5] - s[4]), s[6] + 1, s[5] * 2], rule: `Ogni termine è la somma dei due precedenti (${s[4]} + ${s[5]} = ${s[6]}).`, level: 2 };
  },
  mulAdd(r) {
    const a = randInt(r, 1, 6), m = pick(r, [2, 3]), c = pick(r, [1, -1, 2, 3]);
    const s = [a]; for (let i = 0; i < 5; i++) s.push(s[i] * m + c);
    return { seq: s.slice(0, 5), ans: s[5], wrong: [s[4] * m, s[4] + (s[4] - s[3]), s[5] + c], rule: `× ${m} poi ${c > 0 ? '+' : '−'} ${Math.abs(c)} (es. ${s[3]} × ${m} ${c > 0 ? '+' : '−'} ${Math.abs(c)} = ${s[4]}).`, level: 3 };
  },
};

const LET = {
  shift(r) {
    const a = randInt(r, 0, 25), k = pick(r, [2, 3, 4, 5]);
    const s = Array.from({ length: 6 }, (_, i) => letter(a + i * k));
    return { seq: s.slice(0, 5), ans: s[5], wrong: [letter(a + 5 * k + 1), letter(a + 5 * k - 1), letter(a + 6 * k)], rule: `Ogni lettera avanza di ${k} posizioni nell'alfabeto (giro dopo la Z).`, level: 1 };
  },
  growing(r) {
    const a = randInt(r, 0, 10);
    const s = [a]; for (let i = 1; i < 6; i++) s.push(s[i - 1] + i);
    return { seq: s.slice(0, 5).map(letter), ans: letter(s[5]), wrong: [letter(s[5] + 1), letter(s[4] + 4), letter(s[5] - 1)], rule: `Salti crescenti: +1, +2, +3, +4, +5.`, level: 2 };
  },
  pairs(r) {
    const a = randInt(r, 0, 20), k = pick(r, [1, 2, 3]);
    const s = Array.from({ length: 5 }, (_, i) => letter(a + i * k) + letter(a + i * k + 1));
    const ans = letter(a + 5 * k) + letter(a + 5 * k + 1);
    return { seq: s, ans, wrong: [letter(a + 5 * k) + letter(a + 5 * k + 2), letter(a + 5 * k + 1) + letter(a + 5 * k + 2), letter(a + 4 * k + 1) + letter(a + 4 * k + 2)], rule: `Coppie di lettere consecutive; la prima lettera avanza di ${k} a ogni passo.`, level: 2 };
  },
};

export function generateSeries(seed) {
  const r = rng(seed);
  const isNum = r() < 0.75;
  const fam = isNum ? NUM : LET;
  const key = pick(r, Object.keys(fam));
  const g = fam[key](r);
  const format = v => (typeof v === 'number' ? fmt(v, 0) : String(v));
  const o = buildOptions(r, g.ans, g.wrong, isNum ? 5 : 4, format, isNum ? Math.max(2, Math.abs(Number(g.ans)) * 0.08) : undefined);
  if (!isNum) { // letters: ensure 4 distinct options without numeric fallback
    const opts = [g.ans, ...g.wrong.filter(w => w !== g.ans)];
    const uniq = [...new Set(opts)].slice(0, 4);
    while (uniq.length < 4) uniq.push(letter(L.indexOf(String(g.ans)[0]) + uniq.length + 7) + (String(g.ans).length > 1 ? letter(L.indexOf(String(g.ans)[0]) + uniq.length + 8) : ''));
    const sh = uniq.map(x => [r(), x]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    o.options = sh; o.answer = sh.indexOf(g.ans);
  }
  const steps = [`Serie: ${g.seq.map(format).join(', ')}, ?`];
  if (g.diffs && isNum) steps.push(`Differenze: ${g.seq.slice(1).map((v, i) => v - g.seq[i]).join(', ')}.`);
  steps.push(`Regola: ${g.rule}`, `Termine successivo: ${format(g.ans)}.`);
  return {
    id: `gen-ser-${key}-${seed}`, skill: 'logical', type: 'mcq', generated: true, level: g.level,
    stem: `What comes next in the series?  ${g.seq.map(format).join(',  ')},  ?`,
    options: o.options, answer: o.answer, timeTarget: g.level === 1 ? 30 : g.level === 2 ? 45 : 60,
    explanation: {
      steps,
      shortcut: isNum ? `Scrivi subito le differenze tra termini consecutivi; se non sono regolari prova i rapporti, poi le posizioni alterne.` : `Converti le lettere in numeri (A=1 ... Z=26) e applica il metodo delle serie numeriche.`,
      trap: `Fermarsi alla prima regola che funziona su due termini: verifica sempre su TUTTA la serie.`,
      rule: `Ordine di prova: differenze → differenze delle differenze → rapporti → serie alternate → combinazioni (× poi +).`,
    },
    tags: [isNum ? 'number-series' : 'letter-series', key],
  };
}
