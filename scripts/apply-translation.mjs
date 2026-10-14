// Dev tool: overlays translated text fields onto a content file, by id. Ids, answers, options, numbers
// and regexes always come from the target file, so a translation can never change a key or a matcher.
//   node scripts/apply-translation.mjs <target.json> <part.json> [<part.json> ...]
import { readFileSync, writeFileSync } from 'node:fs';

const [target, ...parts] = process.argv.slice(2);
if (!target || !parts.length) { console.error('usage: apply-translation.mjs <target.json> <part.json>...'); process.exit(2); }
const T = JSON.parse(readFileSync(target, 'utf8'));
const FIELDS = {
  lessons: ['title', 'summary', 'sections', 'examples', 'cheatsheet'],
  items: ['explanation'],
  questions: ['tests', 'structure', 'good', 'pitfalls', 'explanation'],
  concepts: ['theme', 'title', 'explainer', 'interview', 'watch'],
};
let applied = 0; const missing = [], warnings = [];
for (const pf of parts) {
  const P = JSON.parse(readFileSync(pf, 'utf8'));
  for (const key of Object.keys(FIELDS)) {
    if (!Array.isArray(P[key])) continue;
    const byId = new Map((T[key] || []).map(o => [o.id, o]));
    for (const src of P[key]) {
      const dst = byId.get(src.id);
      if (!dst) { missing.push(`${key}:${src.id}`); continue; }
      for (const f of FIELDS[key]) {
        if (src[f] === undefined) continue;
        if (Array.isArray(dst[f]) && Array.isArray(src[f]) && dst[f].length !== src[f].length) warnings.push(`${src.id}.${f}: length ${dst[f].length} -> ${src[f].length}`);
        dst[f] = src[f];
      }
      if (key === 'concepts' && Array.isArray(src.questions)) {
        const qs = new Map((dst.questions || []).map(q => [q.qid, q]));
        for (const q of src.questions) { const d = qs.get(q.qid); if (!d) { missing.push(`question:${q.qid}`); continue; } if (q.explanation) d.explanation = q.explanation; }
      }
      applied++;
    }
  }
}
writeFileSync(target, JSON.stringify(T, null, 1) + '\n');
console.log(JSON.stringify({ target, applied, missing, warnings }));
process.exit(missing.length ? 1 : 0);
