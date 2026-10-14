// Abstract / inductive reasoning generator: sequences of panels with 2 changing features.
import { rng, randInt, pick, shuffle } from '../util.js';

// Panel features
// pos: dot on the 8 border cells of a 3x3 grid (0..7 clockwise from top-left)
// rot: arrow direction 0..7 (x45 deg, clockwise from up)
// count: number of small squares 1..7
// fill: 0 outline / 1 filled (big centre shape)
// shape: 0 circle / 1 square / 2 triangle (big centre shape)
const CELLS = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]];
const SHAPES = ['circle', 'square', 'triangle'];
const DIRS = ['up', 'up-right', 'right', 'down-right', 'down', 'down-left', 'left', 'up-left'];

function panelSVG(p, size = 96) {
  // layout: 3x3 grid (dot on the border ring, arrow in the centre) + a bottom strip (shape, small squares)
  const W = size, G = size, c = G / 3, S = 24, H = G + S;
  let g = `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="7" fill="#ffffff" stroke="#D5D8E6"/>`;
  for (let i = 1; i < 3; i++) g += `<line x1="${i * c}" y1="4" x2="${i * c}" y2="${G - 4}" stroke="#ECEEF5"/><line x1="4" y1="${i * c}" x2="${W - 4}" y2="${i * c}" stroke="#ECEEF5"/>`;
  g += `<line x1="4" y1="${G}" x2="${W - 4}" y2="${G}" stroke="#E3E5EF"/>`;
  if (p.pos !== null) { const [x, y] = CELLS[p.pos]; g += `<circle cx="${x * c + c / 2}" cy="${y * c + c / 2}" r="${c * 0.2}" fill="#0E9F9A"/>`; }
  if (p.rot !== null) {
    const cx = G / 2, cy = G / 2;
    g += `<g transform="rotate(${p.rot * 45} ${cx} ${cy})"><line x1="${cx}" y1="${cy + c * 0.34}" x2="${cx}" y2="${cy - c * 0.18}" stroke="#D97706" stroke-width="3" stroke-linecap="round"/><polygon points="${cx},${cy - c * 0.42} ${cx - 6},${cy - c * 0.16} ${cx + 6},${cy - c * 0.16}" fill="#D97706"/></g>`;
  }
  // bottom strip: shape (left) and small squares (right)
  const sy = G + S / 2, R = 8, fill = p.fill ? '#15172E' : 'none', sx = 16;
  if (p.shape === 0) g += `<circle cx="${sx}" cy="${sy}" r="${R}" fill="${fill}" stroke="#15172E" stroke-width="2"/>`;
  else if (p.shape === 1) g += `<rect x="${sx - R}" y="${sy - R}" width="${2 * R}" height="${2 * R}" fill="${fill}" stroke="#15172E" stroke-width="2"/>`;
  else g += `<polygon points="${sx},${sy - R} ${sx + R},${sy + R} ${sx - R},${sy + R}" fill="${fill}" stroke="#15172E" stroke-width="2" stroke-linejoin="round"/>`;
  // small squares: up to 2 rows of 6, right-aligned, always clear of the shape on the left
  if (p.count !== null) for (let i = 0; i < p.count; i++) {
    const col = i % 6, row = Math.floor(i / 6), rows = Math.ceil(p.count / 6);
    const y = rows === 1 ? sy - 3 : sy - 7 + row * 8;
    g += `<rect x="${W - 14 - col * 9}" y="${y}" width="6" height="6" rx="1" fill="#5B4BF5"/>`;
  }
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${g}</svg>`;
}

const FEATURES = {
  pos: { steps: [1, 2, 3, -1, -2], mod: 8, say: k => `the teal dot moves ${Math.abs(k)} ${Math.abs(k) === 1 ? 'cell' : 'cells'} ${k > 0 ? 'clockwise' : 'anticlockwise'} around the border` },
  rot: { steps: [1, 2, -1, 3, -2], mod: 8, say: k => `the arrow in the centre rotates ${Math.abs(k) * 45}° ${k > 0 ? 'clockwise' : 'anticlockwise'}` },
  count: { steps: [1, -1, 2], mod: null, say: k => `the small blue squares at the bottom right ${k > 0 ? 'increase' : 'decrease'} by ${Math.abs(k)} at each step` },
  fill: { steps: [1], mod: 2, say: () => `the shape at the bottom left alternates between filled and empty` },
  shape: { steps: [1], mod: 3, say: () => `the shape at the bottom left cycles circle → square → triangle` },
};

function applyRule(start, f, k, i) {
  const F = FEATURES[f];
  if (F.mod) return (((start + k * i) % F.mod) + F.mod) % F.mod;
  return start + k * i;
}

export function generateShapes(seed) {
  const r = rng(seed);
  const nRules = r() < 0.45 ? 1 : 2;
  const feats = shuffle(r, ['pos', 'rot', 'count', 'fill', 'shape']).slice(0, nRules + (r() < 0.3 ? 1 : 0));
  const active = feats.slice(0, nRules);
  const base = { pos: randInt(r, 0, 7), rot: randInt(r, 0, 7), count: randInt(r, 1, 2), fill: randInt(r, 0, 1), shape: randInt(r, 0, 2) };
  const rules = {};
  for (const f of active) {
    let k = pick(r, FEATURES[f].steps);
    if (f === 'count') { k = pick(r, [1, 2]); base.count = randInt(r, 1, 2); if (pick(r, [true, false])) { k = -1; base.count = 6; } }
    rules[f] = k;
  }
  // features shown but static
  const shown = { pos: true, rot: r() < 0.7 || 'rot' in rules, count: 'count' in rules || r() < 0.4, fill: true, shape: true };
  const panel = i => ({
    pos: shown.pos ? ('pos' in rules ? applyRule(base.pos, 'pos', rules.pos, i) : base.pos) : null,
    rot: shown.rot ? ('rot' in rules ? applyRule(base.rot, 'rot', rules.rot, i) : base.rot) : null,
    count: shown.count ? ('count' in rules ? applyRule(base.count, 'count', rules.count, i) : base.count) : null,
    fill: 'fill' in rules ? applyRule(base.fill, 'fill', 1, i) : base.fill,
    shape: 'shape' in rules ? applyRule(base.shape, 'shape', 1, i) : base.shape,
  });
  const seq = [0, 1, 2, 3].map(panel);
  const correct = panel(4);
  // distractors: break exactly one rule each, or apply a rule one step too far / wrong direction
  const variants = [];
  const tweak = (f, delta) => {
    const p = { ...correct };
    if (p[f] === null) return null;
    const F = FEATURES[f];
    p[f] = F.mod ? (((p[f] + delta) % F.mod) + F.mod) % F.mod : Math.max(0, p[f] + delta);
    if (f === 'count' && p[f] === 0) p[f] = correct.count + 2;
    return p;
  };
  for (const f of Object.keys(rules)) { variants.push(tweak(f, rules[f])); variants.push(tweak(f, -rules[f] || 1)); }
  for (const f of ['pos', 'rot', 'fill', 'shape', 'count']) variants.push(tweak(f, 1));
  const key = p => JSON.stringify(p);
  const uniq = []; const seen = new Set([key(correct)]);
  for (const v of variants) { if (v && !seen.has(key(v))) { seen.add(key(v)); uniq.push(v); } if (uniq.length >= 3) break; }
  const opts = shuffle(r, [correct, ...uniq]);
  const answer = opts.findIndex(p => key(p) === key(correct));
  const ruleText = Object.entries(rules).map(([f, k]) => FEATURES[f].say(k));
  const descr = p => [p.pos !== null ? `dot in position ${p.pos + 1}` : '', p.rot !== null ? `arrow pointing ${DIRS[p.rot]}` : '', p.count !== null ? `${p.count} ${p.count === 1 ? 'small square' : 'small squares'}` : '', `${p.fill ? 'filled' : 'empty'} ${SHAPES[p.shape]}`].filter(Boolean).join(', ');
  return {
    id: `gen-abs-${seed}`, skill: 'inductive', type: 'mcq', generated: true, level: nRules === 1 ? 1 : 2,
    context: { kind: 'html', html: `<div class="panels">${seq.map(p => panelSVG(p)).join('')}<div class="panel-q">?</div></div>` },
    stem: 'Which panel comes next in the sequence?',
    options: opts.map(p => panelSVG(p, 84)), optionsHTML: true, answer,
    timeTarget: nRules === 1 ? 40 : 60,
    explanation: {
      steps: [`${ruleText.length === 1 ? 'Rule' : 'Rules'}: ${ruleText.join('; ')}. Every other element stays the same.`, ...seq.map((p, i) => `Panel ${i + 1}: ${descr(p)}.`), `So panel 5: ${descr(correct)}.`],
      shortcut: `Isolate ONE element at a time (dot, arrow, small squares, shape) and ask: does it move, rotate, change in number or alternate? Eliminate the options that break the first rule you find.`,
      trap: `Each wrong option follows every rule except one: check every element, not just the most obvious one.`,
      rule: `Checklist: position → rotation → number → fill → shape → alternation.`,
    },
    tags: ['abstract', ...Object.keys(rules)],
  };
}
