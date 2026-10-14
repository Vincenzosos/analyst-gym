// Dev tool: checks translated parts against the Italian source before they are applied.
// For every translated object it compares structure (list lengths) and the numbers each text field contains,
// and flags any Italian left in the English text.
//   node scripts/check-translation.mjs <source.json> <part.json> [<part.json> ...]
import { readFileSync } from 'node:fs';

const [source, ...parts] = process.argv.slice(2);
const S = JSON.parse(readFileSync(source, 'utf8'));
const KEYS = ['lessons', 'items', 'questions', 'concepts'];
const IT = /\b(della|delle|degli|dello|nella|nelle|sono|perché|quindi|anche|questo|questa|quando|oppure|ovvero|cioè|perciò|dunque|invece|sempre|ancora|ogni|tutti|tutte|molto|più|meno|come si|non è|che (il|la|le|si|non|è))\b|[àèìòù]/i;

// Numbers: each numeric token of the Italian text must appear in the English text under one of its readings
// (the Italian source sometimes already uses English formatting, e.g. "1,250.5").
const TOKEN = /\d[\d.,]*\d|\d/g;
const readings = tok => {
  const out = new Set([Number(tok.replace(/,/g, '')), Number(tok.replace(/\./g, '').replace(',', '.')), Number(tok.replace(',', '.'))]);
  for (const part of tok.split(/[.,]/)) out.add(Number(part));
  return [...out].filter(Number.isFinite);
};
const enValues = text => { const out = new Set(); for (const m of String(text).matchAll(TOKEN)) { const t = m[0]; out.add(Number(t.replace(/,/g, ''))); out.add(Number(t)); for (const part of t.split(/[.,]/)) out.add(Number(part)); } return out; };
function missingNumbers(itText, enText) {
  const have = enValues(enText);
  const miss = [];
  for (const m of String(itText).matchAll(TOKEN)) if (!readings(m[0]).some(v => have.has(v))) miss.push(m[0]);
  return miss;
}
const strings = (x, acc = []) => { if (typeof x === 'string') acc.push(x); else if (Array.isArray(x)) x.forEach(y => strings(y, acc)); else if (x && typeof x === 'object') Object.values(x).forEach(y => strings(y, acc)); return acc; };

let problems = 0, checked = 0;
const report = (id, msg) => { problems++; if (problems <= 60) console.log(`  ${id}: ${msg}`); };
for (const pf of parts) {
  const P = JSON.parse(readFileSync(pf, 'utf8'));
  for (const key of KEYS) {
    if (!Array.isArray(P[key])) continue;
    const byId = new Map((S[key] || []).map(o => [o.id, o]));
    for (const t of P[key]) {
      const o = byId.get(t.id);
      if (!o) { report(t.id, 'id not in source'); continue; }
      checked++;
      for (const f of Object.keys(t)) {
        if (f === 'id') continue;
        const src = f === 'questions' ? (o.questions || []).map(q => ({ qid: q.qid, explanation: q.explanation })) : o[f];
        if (src === undefined) { report(t.id, `unknown field ${f}`); continue; }
        // structure
        const shape = x => Array.isArray(x) ? `[${x.map(shape).join(',')}]` : x && typeof x === 'object' ? `{${Object.keys(x).sort().map(k => `${k}:${shape(x[k])}`).join(',')}}` : typeof x;
        if (shape(src) !== shape(t[f])) report(t.id, `structure differs in ${f}`);
        // numbers (ignore list numbering like "1." that may be added or removed)
        const miss = missingNumbers(strings(src).join(' \n '), strings(t[f]).join(' \n '));
        if (miss.length) report(t.id, `numbers missing in ${f}: ${[...new Set(miss)].slice(0, 6).join(', ')}`);
        // Italian left over
        const left = strings(t[f]).filter(s => IT.test(s));
        if (left.length) report(t.id, `Italian left in ${f}: "${left[0].slice(0, 80)}"`);
        if (strings(t[f]).some(s => s.includes('—'))) report(t.id, `em dash in ${f}`);
      }
    }
  }
}
console.log(`${source.split('/').pop()}: ${checked} objects checked, ${problems} problems`);
process.exit(problems ? 1 : 0);
