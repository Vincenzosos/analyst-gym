// Dev tool: merges the reviewed theme cards (and their wrap pills) from data/staging into data/news/concepts.json.
// node scripts/merge-staging.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const read = f => JSON.parse(readFileSync(root + f, 'utf8'));
const out = (f, obj) => { writeFileSync(root + f, JSON.stringify(obj, null, 1) + '\n'); console.log('wrote', f); };

const conceptFiles = ['news-concepts-macro.json', 'news-concepts-corp.json', 'news-concepts-world.json'].filter(f => existsSync(root + 'data/staging/' + f));
if (conceptFiles.length) {
  const concepts = conceptFiles.flatMap(f => read('data/staging/' + f).concepts);
  // short "why it matters" pills used by the weekly wrap
  if (existsSync(root + 'data/staging/news-pills.json')) {
    const pills = read('data/staging/news-pills.json').pills || {};
    for (const c of concepts) if (pills[c.id]) c.pill = pills[c.id];
  }
  out('data/news/concepts.json', { concepts });
}

// The general-culture bank and lessons are now maintained directly in data/ (English versions).
