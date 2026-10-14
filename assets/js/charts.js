// SVG / HTML renderers for test datasets and progress charts. No dependencies.
import { esc, fmt } from './util.js';

const PALETTE = ['#5B4BF5', '#0E9F9A', '#F59E0B', '#E11D48', '#0284C7', '#9333EA', '#475569'];
const AX = '#C9CCDD', GRID = 'rgba(20,22,48,.07)', TXT = '#3D4160', MUTED = '#62677F';

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
const num = v => (typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, '')));
// Drawing width close to the rendered width, so SVG text stays near its nominal size on phones and desktops.
const narrow = () => typeof window !== 'undefined' && window.innerWidth < 700;
const dsW = () => (narrow() ? 420 : 640);
const fs = n => (narrow() ? Math.round(n * 15) / 10 : n); // 420 units shown at ~290px: text x1.5 keeps it readable

export function datasetHTML(ds) {
  const title = `<div class="ds-title">${esc(ds.title || '')}${ds.unit ? ` <span class="ds-unit">(${esc(ds.unit)})</span>` : ''}</div>`;
  const note = ds.note ? `<div class="ds-note">${esc(ds.note)}</div>` : '';
  let body = '';
  const kind = ds.kind || 'table';
  if (kind === 'bar') body = barSVG(ds);
  else if (kind === 'line') body = lineSVG(ds);
  else if (kind === 'pie') body = pieSVG(ds);
  else body = tableHTML(ds);
  return `<figure class="dataset">${title}${body}${note}</figure>`;
}

export function tableHTML(ds) {
  const cols = ds.columns || [];
  const rows = ds.rows || [];
  return `<div class="tbl-wrap"><table class="data-table"><thead><tr>${cols.map((c, i) => `<th class="${i ? 'num' : ''}">${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td class="${i ? 'num' : ''}">${typeof c === 'number' ? fmt(c, 2) : esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function legend(names) {
  return `<div class="legend">${names.map((n, i) => `<span><i style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(n)}</span>`).join('')}</div>`;
}

export function barSVG(ds) {
  const cats = ds.columns.slice(1);
  const series = ds.rows.map(r => ({ name: r[0], vals: r.slice(1).map(num) }));
  const W = dsW(), H = narrow() ? 280 : 300, L = 54, R = 12, T = 16, B = 40;
  const max = niceMax(Math.max(...series.flatMap(s => s.vals)));
  const pw = W - L - R, ph = H - T - B;
  const gw = pw / cats.length, bw = Math.min(34, (gw * 0.8) / series.length);
  let g = '';
  for (let i = 0; i <= 5; i++) {
    const v = (max / 5) * i, y = T + ph - (v / max) * ph;
    g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="${GRID}"/><text x="${L - 6}" y="${y + 4}" fill="${MUTED}" font-size="${fs(11)}" text-anchor="end">${fmt(v, 2)}</text>`;
  }
  cats.forEach((c, ci) => {
    const x0 = L + ci * gw + (gw - bw * series.length) / 2;
    series.forEach((s, si) => {
      const v = s.vals[ci]; const bh = (v / max) * ph; const x = x0 + si * bw; const y = T + ph - bh;
      g += `<rect x="${x}" y="${y}" width="${bw - 3}" height="${Math.max(0, bh)}" rx="2" fill="${PALETTE[si % PALETTE.length]}"/>`;
      g += `<text x="${x + (bw - 3) / 2}" y="${y - 4}" fill="${TXT}" font-size="${fs(10)}" text-anchor="middle">${fmt(v, 2)}</text>`;
    });
    g += `<text x="${L + ci * gw + gw / 2}" y="${H - B + 18}" fill="${TXT}" font-size="${fs(12)}" text-anchor="middle">${esc(c)}</text>`;
  });
  g += `<line x1="${L}" x2="${W - R}" y1="${T + ph}" y2="${T + ph}" stroke="${AX}"/>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>${series.length > 1 ? legend(series.map(s => s.name)) : ''}`;
}

export function lineSVG(ds) {
  const cats = ds.columns.slice(1);
  const series = ds.rows.map(r => ({ name: r[0], vals: r.slice(1).map(num) }));
  const W = dsW(), H = narrow() ? 280 : 300, L = 54, R = 16, T = 16, B = 40;
  const all = series.flatMap(s => s.vals);
  const max = niceMax(Math.max(...all));
  const pw = W - L - R, ph = H - T - B;
  const x = i => L + (cats.length === 1 ? pw / 2 : (i / (cats.length - 1)) * pw);
  const y = v => T + ph - (v / max) * ph;
  let g = '';
  for (let i = 0; i <= 5; i++) {
    const v = (max / 5) * i;
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${GRID}"/><text x="${L - 6}" y="${y(v) + 4}" fill="${MUTED}" font-size="${fs(11)}" text-anchor="end">${fmt(v, 2)}</text>`;
  }
  cats.forEach((c, i) => { g += `<text x="${x(i)}" y="${H - B + 18}" fill="${TXT}" font-size="${fs(12)}" text-anchor="middle">${esc(c)}</text>`; });
  series.forEach((s, si) => {
    const col = PALETTE[si % PALETTE.length];
    g += `<polyline fill="none" stroke="${col}" stroke-width="2.5" points="${s.vals.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>`;
    s.vals.forEach((v, i) => { g += `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="${col}"/><text x="${x(i)}" y="${y(v) - 8}" fill="${TXT}" font-size="${fs(10)}" text-anchor="middle">${fmt(v, 2)}</text>`; });
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>${series.length > 1 ? legend(series.map(s => s.name)) : ''}`;
}

export function pieSVG(ds) {
  const items = ds.rows.map(r => ({ name: r[0], v: num(r[1]) }));
  const tot = items.reduce((s, i) => s + i.v, 0) || 1;
  const W = dsW(), H = narrow() ? 300 + items.length * 26 : 280, cx = narrow() ? 210 : 150, cy = 140, rr = 115;
  let a0 = -Math.PI / 2, g = '';
  items.forEach((it, i) => {
    const a1 = a0 + (it.v / tot) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a) => `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`;
    g += items.length === 1 ? `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="${PALETTE[0]}"/>` : `<path d="M${cx},${cy} L${p(a0)} A${rr},${rr} 0 ${large} 1 ${p(a1)} Z" fill="${PALETTE[i % PALETTE.length]}" stroke="#ffffff" stroke-width="2"/>`;
    a0 = a1;
  });
  items.forEach((it, i) => {
    const yy = 40 + i * 28;
    const lx = narrow() ? 40 : 320, ly = narrow() ? 290 + i * 26 : yy;
    g += `<rect x="${lx}" y="${ly - 12}" width="14" height="14" rx="3" fill="${PALETTE[i % PALETTE.length]}"/><text x="${lx + 22}" y="${ly}" fill="${TXT}" font-size="${fs(13)}">${esc(it.name)}: ${fmt(it.v, 2)}${ds.columns[1] && /%/.test(ds.unit || '') ? '' : ''}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
}

// progress line: points [{d, v}] with v in 0..1
export function progressSVG(seriesList, { height = 200, target = null } = {}) {
  const W = typeof window !== 'undefined' ? Math.max(340, Math.min(1080, window.innerWidth - 90)) : 640, H = height, L = 36, R = 10, T = 10, B = 24;
  const pw = W - L - R, ph = H - T - B;
  const dates = [...new Set(seriesList.flatMap(s => s.points.map(p => p.d)))].sort();
  if (!dates.length) return `<div class="empty">Nessun dato ancora</div>`;
  const x = d => L + (dates.length === 1 ? pw / 2 : (dates.indexOf(d) / (dates.length - 1)) * pw);
  const y = v => T + ph - v * ph;
  let g = '';
  for (const v of [0, 0.25, 0.5, 0.75, 1]) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${GRID}"/><text x="${L - 6}" y="${y(v) + 4}" fill="${MUTED}" font-size="10" text-anchor="end">${Math.round(v * 100)}</text>`;
  if (target !== null) g += `<line x1="${L}" x2="${W - R}" y1="${y(target)}" y2="${y(target)}" stroke="#D97706" stroke-opacity=".7" stroke-dasharray="4 4"/>`;
  seriesList.forEach((s, si) => {
    const col = s.color || PALETTE[si % PALETTE.length];
    const pts = s.points.filter(p => p.v !== null && p.v !== undefined);
    if (pts.length > 1) g += `<polyline fill="none" stroke="${col}" stroke-width="2" points="${pts.map(p => `${x(p.d)},${y(p.v)}`).join(' ')}"/>`;
    pts.forEach(p => { g += `<circle cx="${x(p.d)}" cy="${y(p.v)}" r="3" fill="${col}"><title>${p.d}: ${Math.round(p.v * 100)}%</title></circle>`; });
  });
  const first = dates[0], last = dates[dates.length - 1];
  g += `<text x="${L}" y="${H - 6}" fill="${MUTED}" font-size="10">${first}</text><text x="${W - R}" y="${H - 6}" fill="${MUTED}" font-size="10" text-anchor="end">${last}</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
}

let ringId = 0;
export function ringSVG(value, { size = 92, label = '', sub = '' } = {}) {
  const sw = Math.max(4, Math.round(size / 14));
  const r = size / 2 - sw, c = 2 * Math.PI * r, v = Math.max(0, Math.min(1, value));
  const id = `rg${++ringId}`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="ring"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0EA5E9"/><stop offset="1" stop-color="#6D5DFC"/></linearGradient></defs><circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="#E6E7F2" stroke-width="${sw}" fill="none"/>${v > 0.004 ? `<circle class="ring-arc" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="url(#${id})" stroke-width="${sw}" fill="none" stroke-linecap="round" stroke-dasharray="${c * v} ${c}" style="--c:${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/>` : ''}<text x="50%" y="${sub ? '50%' : '54%'}" text-anchor="middle" dominant-baseline="middle" fill="#15172E" font-size="${size / 3.7}" font-weight="600" class="ring-n">${esc(label)}</text>${sub ? `<text x="50%" y="72%" text-anchor="middle" fill="${MUTED}" font-size="${size / 9}" class="ring-s">${esc(sub)}</text>` : ''}</svg>`;
}
