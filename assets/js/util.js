// Small shared helpers: DOM, random, formatting, markdown.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// ---------- random ----------
export function rng(seed) {
  // mulberry32
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const newSeed = () => Math.floor(Math.random() * 2 ** 31);
export const randInt = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
export const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
export function shuffle(r, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export function sample(r, arr, n) { return shuffle(r, arr).slice(0, n); }

// ---------- numbers ----------
export function round(x, d = 2) { const f = 10 ** d; return Math.round((x + Number.EPSILON) * f) / f; }
export function fmt(x, d = 1) {
  if (typeof x !== 'number' || !isFinite(x)) return String(x);
  const r = round(x, d);
  return r.toLocaleString('en-GB', { minimumFractionDigits: Number.isInteger(r) ? 0 : Math.min(d, (String(r).split('.')[1] || '').length), maximumFractionDigits: d });
}
export const fmtPct = (x, d = 1) => `${fmt(x, d)}%`;
export function fmtTime(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
export const today = () => new Date().toISOString().slice(0, 10);
export const DAY = 86400000;

// ---------- options helper for generated MCQs ----------
// Build `n` distinct options from the correct value and candidate distractors.
export function buildOptions(r, correct, distractors, n, format, fallbackSpread) {
  const seen = new Set();
  const out = [];
  const key = v => format(v);
  const push = v => { if (v === null || v === undefined || !isFinite(v)) return; const k = key(v); if (seen.has(k)) return; seen.add(k); out.push(v); };
  push(correct);
  for (const d of distractors) { if (out.length >= n) break; push(d); }
  let k = 1;
  while (out.length < n && k < 60) {
    const spread = fallbackSpread || Math.max(Math.abs(correct) * 0.07, 1);
    push(correct + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * spread);
    k++;
  }
  const shuffled = shuffle(r, out);
  return { options: shuffled.map(format), answer: shuffled.findIndex(v => key(v) === key(correct)) };
}

// ---------- markdown (small subset) ----------
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|\s)_([^_\n]+)_/g, '$1<em>$2</em>');
}
export function md(src) {
  const lines = String(src || '').replace(/\r/g, '').split('\n');
  let html = '', i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^#{1,4}\s/.test(line)) {
      const lvl = Math.min(4, line.match(/^#+/)[0].length + 2);
      html += `<h${lvl}>${inline(line.replace(/^#+\s*/, ''))}</h${lvl}>`; i++; continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i]); i++; }
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const real = rows.filter(r => !/^[\s|:\-]+$/.test(r));
      if (real.length) {
        html += '<div class="tbl-wrap"><table class="md-table"><thead><tr>' + cells(real[0]).map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>';
        for (const r of real.slice(1)) html += '<tr>' + cells(r).map(c => `<td>${inline(c)}</td>`).join('') + '</tr>';
        html += '</tbody></table></div>';
      }
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      html += '<ul>';
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) { html += `<li>${inline(lines[i].replace(/^\s*[-*•]\s+/, ''))}</li>`; i++; }
      html += '</ul>'; continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      html += '<ol>';
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { html += `<li>${inline(lines[i].replace(/^\s*\d+[.)]\s+/, ''))}</li>`; i++; }
      html += '</ol>'; continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^#{1,4}\s|^\s*[-*•]\s+|^\s*\d+[.)]\s+|^\s*\|/.test(lines[i])) { para.push(lines[i]); i++; }
    html += `<p>${inline(para.join(' '))}</p>`;
  }
  return html;
}
