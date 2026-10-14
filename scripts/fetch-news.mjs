#!/usr/bin/env node
// Analyst Gym: news headlines + market data fetcher.
//
// Zero dependencies, Node 20+ (global fetch). Run from anywhere:
//   node scripts/fetch-news.mjs                  refresh both files
//   node scripts/fetch-news.mjs --news-only      headlines only
//   node scripts/fetch-news.mjs --markets-only   market series only
//   node scripts/fetch-news.mjs --out=DIR        write to DIR instead of data/news
//   node scripts/fetch-news.mjs --simulate-fail=bbc-business,SP500
//                                                testing aid: treat these feed ids / series keys as failed
//
// Writes data/news/headlines.json (titles + links only, never descriptions) and
// data/news/markets.json (daily series). Results are MERGED with the existing files,
// so a source that fails today keeps its previous items/points.
// Exit code: 0 if anything was refreshed or previous files exist; 1 only if everything
// failed and there is nothing to fall back on.

import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- config

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = process.argv.slice(2);
const argVal = name => {
  const a = ARGS.find(x => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
const OUT_DIR = path.resolve(argVal('out') || path.join(ROOT, 'data', 'news'));
const HEADLINES_FILE = path.join(OUT_DIR, 'headlines.json');
const MARKETS_FILE = path.join(OUT_DIR, 'markets.json');
const DO_NEWS = !ARGS.includes('--markets-only');
const DO_MARKETS = !ARGS.includes('--news-only');
const SIMULATE_FAIL = new Set((argVal('simulate-fail') || '').split(',').map(s => s.trim()).filter(Boolean));

const UA = 'AnalystGymNews/1.0 (personal study project; headlines only)';
const TIMEOUT_MS = 20_000;
const TREASURY_TIMEOUT_MS = 45_000; // see fromTreasury
const RETRIES = 1;
const CONCURRENCY = 6;
const MAX_BYTES = 8 * 1024 * 1024;

const WINDOW_DAYS = 21;    // headline rolling window
const MAX_ITEMS = 500;     // headline cap (shared fairly across sources)
const START_DAYS = 200;    // market data look-back (calendar days)
const KEEP_POINTS = 130;   // observations kept per series
const DAY_MS = 86_400_000;

// Headline feeds. Order matters: when two feeds carry the same story, the first one wins.
// Verified 2026-10-13. Dropped: WSJ Markets and WSJ US Business (feeds frozen since Jan 2025),
// Yahoo Finance rssindex (HTTP 404).
const FEEDS = [
  { id: 'ft-markets', name: 'FT Markets', url: 'https://www.ft.com/markets?format=rss', region: 'uk' },
  { id: 'ft-companies', name: 'FT Companies', url: 'https://www.ft.com/companies?format=rss', region: 'uk' },
  {
    id: 'bbc-business', name: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', region: 'uk',
    excludeUrl: /\/(videos|sounds|iplayer|programmes)\//i, // text articles only
  },
  { id: 'guardian-business', name: 'Guardian Business', url: 'https://www.theguardian.com/uk/business/rss', region: 'uk' },
  { id: 'economist-finance', name: 'The Economist: Finance and economics', url: 'https://www.economist.com/finance-and-economics/rss.xml', region: 'global' },
  { id: 'cnbc-finance', name: 'CNBC Finance', url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html', region: 'us' },
  { id: 'cnbc-economy', name: 'CNBC Economy', url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html', region: 'us' },
  { id: 'cnbc-earnings', name: 'CNBC Earnings', url: 'https://www.cnbc.com/id/15839135/device/rss/rss.html', region: 'us' },
  { id: 'marketwatch', name: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', region: 'us' },
  {
    id: 'ecb', name: 'European Central Bank', url: 'https://www.ecb.europa.eu/rss/press.html', region: 'eu',
    // keep press releases, policy decisions, accounts, blog; drop individual speeches and interviews
    excludeUrl: /\/press\/(key|inter)\//i,
  },
  {
    id: 'fed', name: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_all.xml', region: 'us',
    // drop routine bank-application approvals and enforcement notices
    excludeTitle: /approval of (an )?application|enforcement action/i,
  },
  {
    id: 'boe', name: 'Bank of England', url: 'https://www.bankofengland.co.uk/rss/news', region: 'uk',
    // drop committee housekeeping and operational notices
    excludeTitle: /FXJSC|sub-? ?committee|securities lending committee|court of directors|taskforce|green notice|statistical notice|market notice|RTGS|banknotes?|office space/i,
  },
  {
    id: 'gnews-deals', name: 'Google News: deals', region: 'global', googleNews: true,
    url: 'https://news.google.com/rss/search?q=(acquisition%20OR%20merger%20OR%20takeover%20OR%20buyout%20OR%20IPO)%20when:7d&hl=en-GB&gl=GB&ceid=GB:en',
  },
  // World affairs, science and technology: general culture beyond markets.
  { id: 'economist-international', name: 'The Economist: International', url: 'https://www.economist.com/international/rss.xml', region: 'global' },
  { id: 'economist-europe', name: 'The Economist: Europe', url: 'https://www.economist.com/europe/rss.xml', region: 'eu' },
  {
    id: 'bbc-world', name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', region: 'global',
    excludeUrl: /\/(videos|sounds|iplayer|programmes)\//i,
  },
  { id: 'guardian-world', name: 'Guardian World', url: 'https://www.theguardian.com/world/rss', region: 'global' },
  { id: 'npr-world', name: 'NPR World', url: 'https://feeds.npr.org/1004/rss.xml', region: 'us' },
  {
    id: 'bbc-science', name: 'BBC Science', url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', region: 'global',
    excludeUrl: /\/(videos|sounds|iplayer|programmes)\//i,
  },
  {
    id: 'bbc-tech', name: 'BBC Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', region: 'global',
    excludeUrl: /\/(videos|sounds|iplayer|programmes)\//i,
  },
];

// Market series. Every provider listed is tried; the one with the most recent data wins
// (ties go to the first one listed). Results are merged with previous points.
const fred = id => ({ type: 'fred', id });
const ecb = (flow, key) => ({ type: 'ecb', flow, key });
const yahoo = symbol => ({ type: 'yahoo', symbol });
const treasury = column => ({ type: 'treasury', column });

const SERIES = [
  { key: 'SP500', name: 'S&P 500', kind: 'index', unit: 'pts', providers: [fred('SP500')] },
  { key: 'NASDAQ', name: 'Nasdaq Composite', kind: 'index', unit: 'pts', providers: [fred('NASDAQCOM')] },
  { key: 'DJIA', name: 'Dow Jones Industrial Average', kind: 'index', unit: 'pts', providers: [fred('DJIA')] },
  { key: 'VIX', name: 'VIX volatility index', kind: 'vol', unit: 'pts', providers: [fred('VIXCLS')] },
  { key: 'STOXX50', name: 'Euro Stoxx 50', kind: 'index', unit: 'pts', providers: [yahoo('^STOXX50E')] },
  { key: 'DAX', name: 'DAX', kind: 'index', unit: 'pts', providers: [yahoo('^GDAXI')] },
  { key: 'FTSEMIB', name: 'FTSE MIB', kind: 'index', unit: 'pts', providers: [yahoo('FTSEMIB.MI')] },
  { key: 'FTSE100', name: 'FTSE 100', kind: 'index', unit: 'pts', providers: [yahoo('^FTSE')] },
  { key: 'US3M', name: 'US 3-month Treasury yield', kind: 'yield', unit: '%', providers: [fred('DGS3MO'), treasury('3 Mo')] },
  { key: 'US2Y', name: 'US 2-year Treasury yield', kind: 'yield', unit: '%', providers: [fred('DGS2'), treasury('2 Yr')] },
  { key: 'US10Y', name: 'US 10-year Treasury yield', kind: 'yield', unit: '%', providers: [fred('DGS10'), treasury('10 Yr')] },
  { key: 'EA2Y', name: 'Euro area 2-year AAA government yield', kind: 'yield', unit: '%', providers: [ecb('YC', 'B.U2.EUR.4F.G_N_A.SV_C_YM.SR_2Y')] },
  { key: 'EA10Y', name: 'Euro area 10-year AAA government yield', kind: 'yield', unit: '%', providers: [ecb('YC', 'B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y')] },
  { key: 'FEDFUNDS', name: 'Effective federal funds rate', kind: 'rate', unit: '%', providers: [fred('DFF')] },
  { key: 'ECBDFR', name: 'ECB deposit facility rate', kind: 'rate', unit: '%', providers: [ecb('FM', 'D.U2.EUR.4F.KR.DFR.LEV')] },
  { key: 'ESTR', name: 'Euro short-term rate (\u20acSTR)', kind: 'rate', unit: '%', providers: [ecb('EST', 'B.EU000A2X2A25.WT')] },
  { key: 'HYOAS', name: 'US high yield option-adjusted spread', kind: 'spread', unit: '%', providers: [fred('BAMLH0A0HYM2')] },
  { key: 'EURUSD', name: 'EUR/USD', kind: 'fx', unit: 'USD per EUR', providers: [ecb('EXR', 'D.USD.EUR.SP00.A')] },
  { key: 'EURGBP', name: 'EUR/GBP', kind: 'fx', unit: 'GBP per EUR', providers: [ecb('EXR', 'D.GBP.EUR.SP00.A')] },
  { key: 'EURJPY', name: 'EUR/JPY', kind: 'fx', unit: 'JPY per EUR', providers: [ecb('EXR', 'D.JPY.EUR.SP00.A')] },
  { key: 'EURCHF', name: 'EUR/CHF', kind: 'fx', unit: 'CHF per EUR', providers: [ecb('EXR', 'D.CHF.EUR.SP00.A')] },
  { key: 'BRENT', name: 'Brent crude oil', kind: 'commodity', unit: 'USD/bbl', providers: [fred('DCOILBRENTEU')] },
  { key: 'WTI', name: 'WTI crude oil', kind: 'commodity', unit: 'USD/bbl', providers: [fred('DCOILWTICO')] },
  { key: 'GOLD', name: 'Gold (front-month future)', kind: 'commodity', unit: 'USD/oz', providers: [yahoo('GC=F')] },
];

const SOURCE_LABEL = { fred: 'FRED', ecb: 'ECB', treasury: 'US Treasury', yahoo: 'Yahoo' };

// ---------------------------------------------------------------- helpers

const NOW = new Date();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isoDay = d => d.toISOString().slice(0, 10);
const START_DATE = isoDay(new Date(NOW.getTime() - START_DAYS * DAY_MS));
const sha12 = s => createHash('sha1').update(s).digest('hex').slice(0, 12);

function errText(e) {
  if (!e) return 'unknown error';
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return 'timeout';
  const cause = e.cause && (e.cause.code || e.cause.message);
  return String(cause ? `${e.message} (${cause})` : e.message || e).slice(0, 160);
}

const inflight = new Map();
// GET with timeout, 1 retry and a descriptive User-Agent. Identical URLs share one request.
function fetchText(url, accept, timeoutMs = TIMEOUT_MS) {
  if (!inflight.has(url)) inflight.set(url, fetchTextOnce(url, accept, timeoutMs));
  return inflight.get(url);
}
async function fetchTextOnce(url, accept = '*/*', timeoutMs = TIMEOUT_MS) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt) await sleep(1500);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-GB,en;q=0.9' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        if (res.status === 404 || res.status === 410) break; // retrying will not help
        continue;
      }
      const text = await res.text();
      if (text.length > MAX_BYTES) throw new Error('response too large');
      return text;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(errText(lastErr));
}

async function pool(tasks, n) {
  const out = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const k = next++;
      try { out[k] = { ok: true, value: await tasks[k]() }; } catch (e) { out[k] = { ok: false, error: errText(e) }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
  return out;
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
}

// Pretty JSON with one line per object of primitives (items, sources) and one line per
// array of primitives/tuples (points): readable and diff-friendly.
function stringify(v, ind = '') {
  const flat = x => x === null || typeof x !== 'object' || (Array.isArray(x) && x.every(y => y === null || typeof y !== 'object'));
  if (Array.isArray(v)) {
    if (v.every(flat)) return JSON.stringify(v);
    if (!v.length) return '[]';
    const ni = ind + '  ';
    return `[\n${v.map(x => ni + stringify(x, ni)).join(',\n')}\n${ind}]`;
  }
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.every(k => v[k] === null || typeof v[k] !== 'object')) return JSON.stringify(v);
    const ni = ind + '  ';
    return `{\n${keys.map(k => `${ni}${JSON.stringify(k)}: ${stringify(v[k], ni)}`).join(',\n')}\n${ind}}`;
  }
  return JSON.stringify(v);
}

async function writeJsonAtomic(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const text = stringify(data) + '\n';
  JSON.parse(text); // never write something that does not parse back
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, file);
  return text.length;
}

// ---------------------------------------------------------------- text cleaning

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  ndash: '\u2013', mdash: '\u2014', minus: '-', hyphen: '-', lsquo: '\u2018', rsquo: '\u2019', sbquo: '\u201a',
  ldquo: '\u201c', rdquo: '\u201d', bdquo: '\u201e', laquo: '\u00ab', raquo: '\u00bb', lsaquo: '\u2039', rsaquo: '\u203a',
  hellip: '\u2026', middot: '\u00b7', bull: '\u2022', prime: '\u2032', deg: '\u00b0', times: '\u00d7', divide: '\u00f7',
  euro: '\u20ac', pound: '\u00a3', yen: '\u00a5', cent: '\u00a2', dollar: '$', percnt: '%', copy: '\u00a9', reg: '\u00ae',
  trade: '\u2122', sect: '\u00a7', para: '\u00b6', frac12: '\u00bd', frac14: '\u00bc', frac34: '\u00be', plusmn: '\u00b1',
  agrave: '\u00e0', aacute: '\u00e1', acirc: '\u00e2', atilde: '\u00e3', auml: '\u00e4', aring: '\u00e5', aelig: '\u00e6', ccedil: '\u00e7',
  egrave: '\u00e8', eacute: '\u00e9', ecirc: '\u00ea', euml: '\u00eb', igrave: '\u00ec', iacute: '\u00ed', icirc: '\u00ee', iuml: '\u00ef',
  ntilde: '\u00f1', ograve: '\u00f2', oacute: '\u00f3', ocirc: '\u00f4', otilde: '\u00f5', ouml: '\u00f6', oslash: '\u00f8', ugrave: '\u00f9',
  uacute: '\u00fa', ucirc: '\u00fb', uuml: '\u00fc', yacute: '\u00fd', yuml: '\u00ff', szlig: '\u00df', oelig: '\u0153', scaron: '\u0161', zcaron: '\u017e',
  Agrave: '\u00c0', Aacute: '\u00c1', Acirc: '\u00c2', Auml: '\u00c4', Aring: '\u00c5', Ccedil: '\u00c7', Egrave: '\u00c8', Eacute: '\u00c9',
  Ecirc: '\u00ca', Iacute: '\u00cd', Ntilde: '\u00d1', Oacute: '\u00d3', Ouml: '\u00d6', Oslash: '\u00d8', Uacute: '\u00da', Uuml: '\u00dc',
  Scaron: '\u0160', Zcaron: '\u017d', OElig: '\u0152',
};

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '';
      return String.fromCodePoint(cp);
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, e) ? NAMED_ENTITIES[e] : m;
  });
}

// Raw XML element content -> plain text: CDATA unwrapped, entities decoded, tags removed.
function xmlToText(raw) {
  if (!raw) return '';
  let s = '';
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let last = 0, m;
  while ((m = re.exec(raw))) {
    s += decodeEntities(raw.slice(last, m.index)) + m[1];
    last = re.lastIndex;
  }
  s += decodeEntities(raw.slice(last));
  // s is now HTML-ish text
  s = s.replace(/<(br|p|div|li)\b[^>]*>/gi, ' ').replace(/<[^>]*>/g, '');
  s = decodeEntities(s);
  if (/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/i.test(s)) s = decodeEntities(s); // double-encoded feeds
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b\ufeff]/g, '')
    .replace(/\s*\u2014\s*/g, ' - ') // site rule: no em dashes, even in third-party titles
    .replace(/\s+/g, ' ')
    .trim();
}

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function tagRaw(block, name) {
  const m = block.match(new RegExp(`<${escRe(name)}(?:\\s[^>]*)?(?<!/)>([\\s\\S]*?)</${escRe(name)}\\s*>`, 'i'));
  return m ? m[1] : '';
}
function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? '');
  return out;
}

function normTitleKey(t) {
  return t.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const TRACKING_PARAM = /^(utm_|at_|ns_|syn-|xtor$|mod$|fbclid$|gclid$|cmp$|ito$|rss$)/i;
// Canonical https URL (tracking params, fragment and duplicate slashes removed), or null.
function normUrl(u) {
  let x;
  try { x = new URL(String(u).trim()); } catch { return null; }
  if (x.protocol !== 'http:' && x.protocol !== 'https:') return null;
  x.protocol = 'https:';
  x.hash = '';
  x.username = '';
  x.password = '';
  x.pathname = x.pathname.replace(/\/{2,}/g, '/');
  for (const k of [...x.searchParams.keys()]) if (TRACKING_PARAM.test(k)) x.searchParams.delete(k);
  return x.toString();
}
const urlKey = u => u.replace(/\/+(\?|$)/, '$1').toLowerCase();

function parseDate(s) {
  if (!s) return null;
  let t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(t)) t = t.replace(' ', 'T') + 'Z'; // no zone: assume UTC
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

// ---------------------------------------------------------------- feed parsing

// Regex-based RSS 2.0 / RSS 1.0 / Atom parser. Returns [{ title, link, date, publisher }].
function parseFeed(xml) {
  if (!/<(rss|feed|rdf:RDF)\b/i.test(xml)) throw new Error('not an RSS/Atom document');
  const items = xml.match(/<item\b[^>]*>[\s\S]*?<\/item\s*>/gi);
  const atom = !items;
  const blocks = items || xml.match(/<entry\b[^>]*>[\s\S]*?<\/entry\s*>/gi) || [];
  const out = [];
  for (const b of blocks) {
    const title = xmlToText(tagRaw(b, 'title'));
    let link = '';
    // <link>url</link> (RSS) or <link href="..."/> (Atom, sometimes RSS)
    const linkText = xmlToText(tagRaw(b, 'link'));
    if (!atom && /^https?:\/\//i.test(linkText)) link = linkText;
    if (!link) {
      const links = [...b.matchAll(/<link\b[^>]*>/gi)].map(m => attrs(m[0])).filter(a => a.href);
      const alt = links.find(a => !a.rel || a.rel === 'alternate') || links[0];
      if (alt) link = alt.href;
    }
    if (!link) {
      const guidTag = b.match(/<guid\b[^>]*>/i);
      const guid = xmlToText(tagRaw(b, 'guid'));
      if (/^https?:\/\//i.test(guid) && !(guidTag && /isPermaLink\s*=\s*["']false/i.test(guidTag[0]))) link = guid;
    }
    if (!link && /^https?:\/\//i.test(linkText)) link = linkText;
    const dateRaw = xmlToText(tagRaw(b, 'pubDate')) || xmlToText(tagRaw(b, 'published')) ||
      xmlToText(tagRaw(b, 'updated')) || xmlToText(tagRaw(b, 'dc:date'));
    const publisher = xmlToText(tagRaw(b, 'source'));
    out.push({ title, link, date: parseDate(dateRaw), publisher });
  }
  return out;
}

// ---------------------------------------------------------------- headlines

async function runNews() {
  const prev = await readJson(HEADLINES_FILE);
  const prevItems = (Array.isArray(prev?.items) ? prev.items : []).filter(it => it && typeof it === 'object' && !Array.isArray(it));
  const prevById = new Map(prevItems.filter(it => typeof it.id === 'string').map(it => [it.id, it]));
  const cutoff = NOW.getTime() - WINDOW_DAYS * DAY_MS;
  const nowMs = NOW.getTime();

  const results = await pool(FEEDS.map(f => async () => {
    if (SIMULATE_FAIL.has(f.id)) throw new Error('simulated failure');
    const xml = await fetchText(f.url, 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5');
    const parsed = parseFeed(xml);
    if (!parsed.length) throw new Error('feed has no items');
    return parsed;
  }), CONCURRENCY);

  const sources = [];
  const fresh = [];
  FEEDS.forEach((f, i) => {
    const r = results[i];
    if (!r.ok) {
      sources.push({ id: f.id, name: f.name, url: f.url, ok: false, n: 0, error: r.error });
      return;
    }
    let n = 0;
    for (const p of r.value) {
      let title = p.title;
      let source = f.name;
      if (f.googleNews) {
        let pub = p.publisher;
        const dash = title.lastIndexOf(' - ');
        if (pub && title.endsWith(` - ${pub}`)) title = title.slice(0, -(pub.length + 3));
        else if (dash > 0) { pub = pub || title.slice(dash + 3); title = title.slice(0, dash); }
        source = (pub || 'Google News').trim();
        title = title.trim();
      }
      const url = normUrl(p.link);
      if (!url || title.length < 8) continue;
      if (f.excludeTitle && f.excludeTitle.test(title)) continue;
      if (f.excludeUrl && f.excludeUrl.test(url)) continue;
      const id = sha12(urlKey(url));
      let ms = p.date ?? (prevById.get(id) ? Date.parse(prevById.get(id).date) : nowMs);
      if (!Number.isFinite(ms)) ms = nowMs;
      if (ms > nowMs + 3_600_000) ms = nowMs; // clamp future-dated items
      if (ms < cutoff) continue;
      n++; // items inside the window
      fresh.push({ id, title, url, source, sourceId: f.id, date: new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z'), region: f.region });
    }
    sources.push({ id: f.id, name: f.name, url: f.url, ok: true, n, error: null });
  });

  const okCount = sources.filter(s => s.ok).length;
  if (!okCount) return { refreshed: false, sources, prevExists: !!prev };

  // merge: fresh first (feed order), then previous items still inside the window
  const feedById = new Map(FEEDS.map(f => [f.id, f]));
  const kept = prevItems.filter(it => {
    if (typeof it.title !== 'string' || typeof it.url !== 'string' || it.title.trim().length < 8) return false;
    const f = feedById.get(it.sourceId);
    if (!f || !(Date.parse(it.date) >= cutoff)) return false;
    return !(f.excludeTitle && f.excludeTitle.test(it.title)) && !(f.excludeUrl && f.excludeUrl.test(it.url));
  });
  const seenUrl = new Set();
  const seenTitle = new Set();
  const merged = [];
  let keptCount = 0;
  for (const [it, isFresh] of [...fresh.map(x => [x, true]), ...kept.map(x => [x, false])]) {
    const url = normUrl(it.url);
    if (!url) continue;
    const uk = urlKey(url);
    const tk = normTitleKey(it.title);
    if (seenUrl.has(uk) || (tk && seenTitle.has(tk))) continue;
    seenUrl.add(uk);
    if (tk) seenTitle.add(tk);
    if (!isFresh) keptCount++;
    merged.push({
      id: sha12(uk), title: it.title, url,
      source: feedById.get(it.sourceId).googleNews ? String(it.source || 'Google News') : feedById.get(it.sourceId).name,
      sourceId: it.sourceId,
      date: new Date(Date.parse(it.date)).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      region: feedById.get(it.sourceId).region,
    });
  }

  const byDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  // fair cap: round-robin across sources so slow feeds (central banks) are not crowded out
  const buckets = FEEDS.map(f => merged.filter(it => it.sourceId === f.id).sort(byDesc));
  const selected = [];
  for (let round = 0; selected.length < MAX_ITEMS; round++) {
    let added = false;
    for (const b of buckets) {
      if (round < b.length && selected.length < MAX_ITEMS) { selected.push(b[round]); added = true; }
    }
    if (!added) break;
  }
  selected.sort(byDesc);

  const data = { updated: NOW.toISOString().replace(/\.\d{3}Z$/, 'Z'), sources, items: selected };
  const bytes = await writeJsonAtomic(HEADLINES_FILE, data);
  return { refreshed: true, sources, prevExists: !!prev, total: selected.length, keptCount, merged: merged.length, bytes, items: selected };
}

// ---------------------------------------------------------------- market data

// RFC 4180 CSV parser (quoted fields, embedded commas/quotes/newlines).
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  const s = text.replace(/^\ufeff/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.length > 1 || row[0] !== '') rows.push(row); }
  return rows;
}

function cleanPoints(pairs) {
  const maxDay = isoDay(new Date(NOW.getTime() + DAY_MS));
  const byDate = new Map();
  for (const pair of pairs) {
    if (!Array.isArray(pair)) continue;
    const [d, v] = pair;
    if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d) || d > maxDay) continue;
    const ms = Date.parse(d + 'T00:00:00Z');
    if (!Number.isFinite(ms) || isoDay(new Date(ms)) !== d) continue; // rejects 2026-02-30 etc.
    const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
    if (!Number.isFinite(n)) continue;
    byDate.set(d, Math.round(n * 1e4) / 1e4);
  }
  return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

async function fromFred(p) {
  const csv = await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(p.id)}&cosd=${START_DATE}`, 'text/csv');
  const rows = parseCsv(csv);
  if (!rows.length || !/date/i.test(rows[0][0])) throw new Error('unexpected FRED CSV');
  return rows.slice(1).map(r => [r[0], r[1] === '.' ? '' : r[1]]);
}

async function fromEcb(p) {
  const csv = await fetchText(`https://data-api.ecb.europa.eu/service/data/${p.flow}/${p.key}?format=csvdata&startPeriod=${START_DATE}`, 'text/csv');
  const rows = parseCsv(csv);
  const h = rows[0] || [];
  const iT = h.indexOf('TIME_PERIOD'), iV = h.indexOf('OBS_VALUE');
  if (iT < 0 || iV < 0) throw new Error('unexpected ECB CSV');
  return rows.slice(1).map(r => [r[iT], r[iV]]);
}

async function fromTreasury(p) {
  const years = [];
  for (let y = Number(START_DATE.slice(0, 4)); y <= NOW.getUTCFullYear(); y++) years.push(y);
  const out = [];
  for (const y of years) {
    // home.treasury.gov answers scripted clients in about 18-20 s, so it gets a longer timeout
    const csv = await fetchText(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${y}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${y}&page&_format=csv`, 'text/csv', TREASURY_TIMEOUT_MS);
    const rows = parseCsv(csv);
    const h = rows[0] || [];
    const iD = h.indexOf('Date'), iV = h.indexOf(p.column);
    if (iD < 0 || iV < 0) throw new Error('unexpected Treasury CSV');
    for (const r of rows.slice(1)) {
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(r[iD] || '');
      if (m) out.push([`${m[3]}-${m[1]}-${m[2]}`, r[iV]]);
    }
  }
  return out.filter(([d]) => d >= START_DATE);
}

async function fromYahoo(p) {
  const sym = encodeURIComponent(p.symbol);
  let json, lastErr;
  for (const host of ['query1', 'query2']) {
    try {
      json = JSON.parse(await fetchText(`https://${host}.finance.yahoo.com/v8/finance/chart/${sym}?range=6mo&interval=1d`, 'application/json'));
      break;
    } catch (e) { lastErr = e; }
  }
  if (!json) throw lastErr;
  const r = json?.chart?.result?.[0];
  if (!r || json?.chart?.error) throw new Error('Yahoo: no chart result');
  const ts = r.timestamp || [];
  const close = r.indicators?.quote?.[0]?.close || [];
  const off = Number(r.meta?.gmtoffset) || 0;
  // Yahoo closes are float32 noise (6167.009765625): round to 2 decimals
  return ts.map((t, i) => [isoDay(new Date((t + off) * 1000)), Number.isFinite(close[i]) ? Math.round(close[i] * 100) / 100 : '']);
}

const PROVIDERS = { fred: fromFred, ecb: fromEcb, treasury: fromTreasury, yahoo: fromYahoo };
const providerLabel = p => `${SOURCE_LABEL[p.type]}:${p.id || p.symbol || p.column || `${p.flow}/${p.key}`}`;

async function runMarkets() {
  const prev = await readJson(MARKETS_FILE);
  const prevSeries = prev && typeof prev.series === 'object' && prev.series ? prev.series : {};

  // flatten (series, provider) attempts so they share the request pool
  const attempts = [];
  for (const s of SERIES) for (const p of s.providers) attempts.push({ s, p });
  const results = await pool(attempts.map(({ s, p }) => async () => {
    if (SIMULATE_FAIL.has(s.key)) throw new Error('simulated failure');
    const pts = cleanPoints(await PROVIDERS[p.type](p));
    if (!pts.length) throw new Error('no valid observations');
    return pts;
  }), CONCURRENCY);

  const series = {};
  const failed = [];
  const report = [];
  for (const s of SERIES) {
    // best provider = most recent last date, then most points, then listed order
    let best = null;
    const errors = [];
    attempts.forEach((a, i) => {
      if (a.s !== s) return;
      const r = results[i];
      if (!r.ok) { errors.push(`${providerLabel(a.p)} ${r.error}`); return; }
      const pts = r.value;
      const last = pts[pts.length - 1][0];
      if (!best || last > best.last || (last === best.last && pts.length > best.pts.length)) best = { p: a.p, pts, last };
    });
    const old = prevSeries[s.key];
    const oldPts = old && Array.isArray(old.points) ? cleanPoints(old.points) : [];
    if (!best && !oldPts.length) {
      failed.push(s.key);
      report.push({ key: s.key, status: 'failed', note: errors.join('; ') });
      continue;
    }
    // merge: previous points, overwritten by fresh values for the same date
    const map = new Map(oldPts);
    if (best) for (const [d, v] of best.pts) map.set(d, v);
    const points = cleanPoints([...map.entries()]).slice(-KEEP_POINTS);
    const source = best ? SOURCE_LABEL[best.p.type]
      : (Object.values(SOURCE_LABEL).includes(old.source) ? old.source : SOURCE_LABEL[s.providers[0].type]);
    series[s.key] = { name: s.name, kind: s.kind, unit: s.unit, source, asOf: points[points.length - 1][0], points };
    report.push({
      key: s.key, status: best ? 'ok' : 'stale', note: best ? '' : `kept previous; ${errors.join('; ')}`,
      n: points.length, asOf: points[points.length - 1][0], last: points[points.length - 1][1], source,
    });
  }

  const refreshed = report.some(r => r.status === 'ok');
  if (!refreshed) return { refreshed: false, report, failed, prevExists: !!prev };
  const data = { updated: NOW.toISOString().replace(/\.\d{3}Z$/, 'Z'), series, failed };
  const bytes = await writeJsonAtomic(MARKETS_FILE, data);
  return { refreshed: true, report, failed, prevExists: !!prev, bytes };
}

// ---------------------------------------------------------------- main

async function main() {
  const t0 = Date.now();
  const [news, markets] = await Promise.all([
    DO_NEWS ? runNews().catch(e => ({ refreshed: false, crash: errText(e), sources: [] })) : null,
    DO_MARKETS ? runMarkets().catch(e => ({ refreshed: false, crash: errText(e), report: [], failed: [] })) : null,
  ]);

  const lines = [];
  if (news) {
    const ok = news.sources.filter(s => s.ok);
    const ko = news.sources.filter(s => !s.ok);
    lines.push(`[news] sources ok ${ok.length}/${news.sources.length}: ${ok.map(s => `${s.id}(${s.n})`).join(' ')}`);
    if (ko.length) lines.push(`[news] sources failed: ${ko.map(s => `${s.id} (${s.error})`).join('; ')}`);
    if (news.crash) lines.push(`[news] ERROR: ${news.crash}`);
    if (news.refreshed) {
      const newest = news.items[0]?.date || '-', oldest = news.items[news.items.length - 1]?.date || '-';
      lines.push(`[news] wrote ${path.relative(process.cwd(), HEADLINES_FILE)}: ${news.total} items (${news.keptCount} carried over, ${news.merged} unique before cap), newest ${newest}, oldest ${oldest}, ${(news.bytes / 1024).toFixed(1)} KB`);
    } else lines.push(`[news] nothing refreshed, ${news.prevExists ? 'kept previous file' : 'no previous file'}`);
  }
  if (markets) {
    const ok = markets.report.filter(r => r.status === 'ok');
    const stale = markets.report.filter(r => r.status === 'stale');
    lines.push(`[markets] series ok ${ok.length}/${SERIES.length}: ${ok.map(r => `${r.key}=${r.last}@${r.asOf}`).join(' ')}`);
    if (stale.length) lines.push(`[markets] stale (kept previous): ${stale.map(r => `${r.key} (${r.note})`).join('; ')}`);
    if (markets.failed.length) lines.push(`[markets] failed: ${markets.report.filter(r => r.status === 'failed').map(r => `${r.key} (${r.note})`).join('; ')}`);
    const short = markets.report.filter(r => r.n !== undefined && r.n < 60);
    if (short.length) lines.push(`[markets] warning, fewer than 60 points: ${short.map(r => `${r.key}(${r.n})`).join(' ')}`);
    if (markets.crash) lines.push(`[markets] ERROR: ${markets.crash}`);
    if (markets.refreshed) lines.push(`[markets] wrote ${path.relative(process.cwd(), MARKETS_FILE)}: ${markets.report.filter(r => r.status !== 'failed').length} series, ${(markets.bytes / 1024).toFixed(1)} KB`);
    else lines.push(`[markets] nothing refreshed, ${markets.prevExists ? 'kept previous file' : 'no previous file'}`);
  }
  lines.push(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(lines.join('\n'));

  const exists = f => access(f).then(() => true, () => false);
  const anyRefreshed = (news && news.refreshed) || (markets && markets.refreshed);
  const anyPrevious = (DO_NEWS && await exists(HEADLINES_FILE)) || (DO_MARKETS && await exists(MARKETS_FILE));
  process.exitCode = anyRefreshed || anyPrevious ? 0 : 1;
}

main().catch(e => {
  console.error(`fatal: ${errText(e)}`);
  process.exitCode = 1;
});
