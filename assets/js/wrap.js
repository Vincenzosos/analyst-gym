// Weekly wrap: a 2-minute summary built only from data (real market moves over 5 sessions, this week's
// headlines by theme). Sentences describe what the numbers show and the usual mechanism, never an
// invented cause: the "why" of a specific move is left to the linked headlines.
import { fmt } from './util.js';
import { news, weekThemes, seriesStats, fmtLevel, fmtChange, shortName, dateShort } from './news.js';

const EQ_US = ['SP500', 'NASDAQ'];
const EQ_EU = ['STOXX50', 'DAX', 'FTSEMIB', 'FTSE100'];
const st = k => seriesStats(k, 5);
const avg = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const pct = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v), 1)}%`;
const bps = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(Math.round(v)), 0)} bps`;
const abs1 = v => `${fmt(Math.abs(v), 1)}%`;

export function wrapAvailable() {
  const N = news();
  return !!(N.markets || N.headlines.length);
}

export function buildWrap() {
  const N = news();
  const S = k => st(k);
  const eqUS = EQ_US.map(S).filter(Boolean), eqEU = EQ_EU.map(S).filter(Boolean);
  const eqAll = [...eqUS, ...eqEU];
  const eqAvg = avg(eqAll.map(x => x.chg)), usAvg = avg(eqUS.map(x => x.chg)), euAvg = avg(eqEU.map(x => x.chg));
  const vix = S('VIX'), hy = S('HYOAS'), us10 = S('US10Y'), us2 = S('US2Y'), ea10 = S('EA10Y'), ea2 = S('EA2Y');
  const estr = S('ESTR'), dfr = S('ECBDFR'), ff = S('FEDFUNDS'), eurusd = S('EURUSD'), eurgbp = S('EURGBP'), brent = S('BRENT'), gold = S('GOLD');
  const themes = weekThemes(7);
  const pills = [];

  // ---- mood ----
  let mood = { key: 'mixed', label: 'A mixed week', en: 'Markets were mixed this week' };
  if (eqAvg !== null) {
    const stress = (hy && hy.chg >= 15) || (vix && vix.last >= 25);
    if (eqAvg <= -1 || stress) mood = { key: 'off', label: 'A risk-off week', en: 'It was a risk-off week' };
    else if (eqAvg >= 1 && !(hy && hy.chg > 5)) mood = { key: 'on', label: 'A risk-on week', en: 'Risk appetite was strong this week' };
  }
  const movers = [...eqAll, ...[eurusd, brent, gold].filter(Boolean)].sort((a, b) => b.chg - a.chg);
  const best = movers[0], worst = movers[movers.length - 1];
  const top = themes[0];

  // ---- 1. cover ----
  pills.push({
    kind: 'cover', tone: 'cover', kicker: 'The week in one line', title: mood.label,
    lines: [
      best && worst && best !== worst ? `Strongest move: ${shortName(best)} ${pct(best.chg)}. Weakest: ${shortName(worst)} ${pct(worst.chg)}.` : null,
      eqAvg !== null ? `Stock markets ${pct(eqAvg)} on average over the last 5 sessions${usAvg !== null && euAvg !== null && Math.abs(usAvg - euAvg) >= 1.5 ? `, with ${usAvg > euAvg ? 'the US ahead of Europe' : 'Europe ahead of the US'} (${pct(usAvg)} vs ${pct(euAvg)})` : ''}.` : null,
      top ? `Most covered theme in the news: ${top.c.title} (${top.items.length} headlines).` : null,
    ].filter(Boolean),
    stats: [best && { k: shortName(best), v: pct(best.chg), up: best.chg >= 0 }, worst && worst !== best && { k: shortName(worst), v: pct(worst.chg), up: worst.chg >= 0 }, top && { k: 'Theme no. 1', v: top.c.title, text: true }].filter(Boolean),
  });

  // ---- 2. equities ----
  if (eqAll.length) {
    const rows = [...eqAll].sort((a, b) => b.chg - a.chg);
    const lead = rows[0], lag = rows[rows.length - 1];
    pills.push({
      kind: 'bars', tone: 'indigo', kicker: 'Equities', title: eqAvg >= 0.5 ? 'Stocks up' : eqAvg <= -0.5 ? 'Stocks down' : 'Stocks little changed',
      bars: rows.map(x => ({ k: shortName(x), v: x.chg, label: pct(x.chg), level: fmtLevel(x.s, x.last) })),
      lines: [
        rows.length > 1 ? `Best: ${shortName(lead)} (${pct(lead.chg)}). Worst: ${shortName(lag)} (${pct(lag.chg)}).` : null,
        eqAvg >= 0.5 ? 'Broad gains usually reflect expectations of stronger earnings or lower rates: the themes that follow tell you which.'
          : eqAvg <= -0.5 ? 'Broad losses usually reflect worries about growth, higher rates or geopolitical tension: the themes that follow tell you which.'
          : 'Small moves: the market is waiting for a catalyst (macro data, central banks, earnings).',
      ].filter(Boolean),
      rule: 'Read a % move against the starting level: +2% on 50,000 points is 1,000 points.',
    });
  }

  // ---- 3. rates ----
  if (us10 || ea10) {
    const lines = [];
    if (us10) {
      const c = us10.chg;
      lines.push(Math.abs(c) < 8 ? `US 10-year Treasury broadly unchanged at ${fmtLevel(us10.s, us10.last)} (${bps(c)}).`
        : c > 0 ? `US 10-year Treasury up ${fmt(Math.round(c), 0)} bps to ${fmtLevel(us10.s, us10.last)}: long-term money gets dearer, which usually weighs on growth stocks, real estate and LBOs.`
        : `US 10-year Treasury down ${fmt(Math.round(-c), 0)} bps to ${fmtLevel(us10.s, us10.last)}: easier financial conditions, usually supportive for growth stocks and refinancing.`);
    }
    if (us10 && us2) {
      const sp = (us10.last - us2.last) * 100;
      lines.push(sp < 0 ? `US curve inverted: the 10-year yields ${fmt(Math.round(-sp), 0)} bps less than the 2-year, historically a sign that markets expect a slowdown.`
        : `US curve positive: the 10-year yields ${fmt(Math.round(sp), 0)} bps more than the 2-year.`);
    }
    if (ea10) lines.push(`Euro area: 10-year AAA government bonds at ${fmtLevel(ea10.s, ea10.last)} (${bps(ea10.chg)})${dfr ? `; ECB deposit rate at ${fmtLevel(dfr.s, dfr.last)}` : ''}${ff ? `; Fed funds at ${fmtLevel(ff.s, ff.last)}` : ''}.`);
    pills.push({
      kind: 'tiles', tone: 'teal', kicker: 'Rates and central banks', title: us10 && Math.abs(us10.chg) >= 8 ? (us10.chg > 0 ? 'Yields rising' : 'Yields falling') : 'Rates steady',
      tiles: [us10, us2, ea10, ea2, estr, dfr, ff].filter(Boolean).map(x => ({ k: shortName(x), v: fmtLevel(x.s, x.last), d: fmtChange(x), up: x.chg >= 0 })),
      lines, rule: 'Bond prices and yields move in opposite directions; 1 bp = 0.01%.',
    });
  }

  // ---- 4. FX and commodities ----
  if (eurusd || brent || gold) {
    const lines = [];
    if (eurusd) lines.push(Math.abs(eurusd.chg) < 0.5 ? `EUR/USD steady at ${fmtLevel(eurusd.s, eurusd.last)} (${pct(eurusd.chg)}).`
      : eurusd.chg > 0 ? `Euro stronger against the dollar (${pct(eurusd.chg)}, at ${fmtLevel(eurusd.s, eurusd.last)}): this usually makes European exports less competitive and lowers the euro cost of dollar-priced commodities.`
      : `Euro weaker against the dollar (${pct(eurusd.chg)}, at ${fmtLevel(eurusd.s, eurusd.last)}): this usually helps European exporters and makes dollar-priced commodities dearer in euros.`);
    if (brent) lines.push(Math.abs(brent.chg) < 3 ? `Oil little changed: Brent at $${fmtLevel(brent.s, brent.last)} (${pct(brent.chg)}).`
      : brent.chg > 0 ? `Oil ${brent.chg >= 7 ? 'sharply ' : ''}higher (Brent ${pct(brent.chg)} to $${fmtLevel(brent.s, brent.last)}): this usually lifts inflation expectations, hurts airlines and chemicals and helps energy producers.`
      : `Oil ${brent.chg <= -7 ? 'sharply ' : ''}lower (Brent ${pct(brent.chg)} to $${fmtLevel(brent.s, brent.last)}): this usually eases inflation and helps energy-hungry sectors.`);
    if (gold) lines.push(gold.chg >= 1.5 && eqAvg !== null && eqAvg < 0 ? `Gold up (${pct(gold.chg)}) while stocks fall: the classic safe-haven move.`
      : `Gold at $${fmtLevel(gold.s, gold.last)} an ounce (${pct(gold.chg)}).`);
    pills.push({
      kind: 'tiles', tone: 'amber', kicker: 'FX and commodities', title: brent && Math.abs(brent.chg) >= 7 ? (brent.chg > 0 ? 'Oil in the spotlight' : 'Oil sliding') : eurusd && Math.abs(eurusd.chg) >= 1 ? 'The euro moves' : 'FX and commodities',
      tiles: [eurusd, eurgbp, brent, gold].filter(Boolean).map(x => ({ k: shortName(x), v: fmtLevel(x.s, x.last), d: fmtChange(x), up: x.chg >= 0 })),
      lines, rule: 'EUR/USD = dollars per euro: if it rises, the euro has strengthened.',
    });
  }

  // ---- 5. risk ----
  if (vix || hy) {
    const lines = [];
    if (vix) { const l = vix.last; lines.push(`VIX at ${fmt(l, 1)} (${pct(vix.chg)}): ${l < 15 ? 'a calm market' : l < 20 ? 'normal volatility' : l < 30 ? 'above-average stress' : 'high stress'}.`); }
    if (hy) lines.push(Math.abs(hy.chg) < 8 ? `US high-yield spread steady at ${fmtLevel(hy.s, hy.last)} (${bps(hy.chg)}).`
      : hy.chg > 0 ? `High-yield spread widening (${bps(hy.chg)}, at ${fmtLevel(hy.s, hy.last)}): investors demand more to lend to riskier companies; usually a headwind for LBOs and refinancing.`
      : `High-yield spread tightening (${bps(hy.chg)}, at ${fmtLevel(hy.s, hy.last)}): credit is easy, usually a good window for bond issues and LBOs.`);
    pills.push({
      kind: 'tiles', tone: 'rose', kicker: 'Risk', title: mood.key === 'off' ? 'More fear' : mood.key === 'on' ? 'Risk in favour' : 'Risk under control',
      tiles: [vix, hy].filter(Boolean).map(x => ({ k: shortName(x), v: fmtLevel(x.s, x.last), d: fmtChange(x), up: x.chg < 0 })),
      lines, rule: 'A high VIX and wide spreads often go together: they are the fear gauge for stocks and credit.',
    });
  }

  // ---- 6-8. themes ----
  themes.slice(0, 3).forEach(({ c, items }, i) => {
    const seenSrc = new Set();
    const heads = items.filter(x => { if (seenSrc.has(x.source)) return false; seenSrc.add(x.source); return true; }).slice(0, 3);
    const p = c.pill || {};
    pills.push({
      kind: 'theme', tone: 'theme', theme: c.theme, concept: c.id, kicker: `Theme ${i + 1} · ${c.theme}`, title: c.title, count: items.length,
      why: p.why || (c.watch && c.watch[0]) || '', watch: p.watch || '',
      heads: heads.map(x => ({ title: x.title, url: x.url, source: x.source, date: dateShort(x.t) })),
    });
  });

  // ---- 9. interview script ----
  const enParts = [];
  if (eqAll.length) {
    const lead = [...eqAll].sort((a, b) => b.chg - a.chg)[0], lag = [...eqAll].sort((a, b) => a.chg - b.chg)[0];
    enParts.push(`${mood.en}: ${lag && lag.chg < 0 ? `the ${shortName(lag)} fell ${abs1(lag.chg)}` : 'equities rose'}${lead && lead !== lag ? `, while the ${shortName(lead)} ${lead.chg >= 0 ? 'gained' : 'lost'} ${abs1(lead.chg)}` : ''}.`);
  }
  if (us10) enParts.push(`The US 10-year yield ${Math.abs(us10.chg) < 3 ? 'was little changed' : us10.chg > 0 ? `rose ${fmt(Math.round(us10.chg), 0)} bps` : `fell ${fmt(Math.round(-us10.chg), 0)} bps`} at ${fmt(us10.last, 2)}%.`);
  if (brent && Math.abs(brent.chg) >= 3) enParts.push(`Brent ${brent.chg > 0 ? 'jumped' : 'dropped'} ${abs1(brent.chg)} to about $${fmt(brent.last, 0)} a barrel, which matters for inflation expectations.`);
  if (top) {
    const hd = top.items[0];
    const p = top.c.pill || {};
    if (hd) enParts.push(`One story I am following: "${hd.title}".`);
    if (p.en) enParts.push(p.en);
  }
  if (enParts.length) pills.push({ kind: 'script', tone: 'violet', kicker: 'For your interview', title: 'Your 30-second market update', script: enParts.join(' '), note: 'Fill in the [placeholders] and say it out loud: it is your answer to "What’s happening in the markets?". Then record it on video.' });

  // ---- 10. numbers to remember ----
  const keys = ['SP500', 'STOXX50', 'FTSEMIB', 'EURUSD', 'US10Y', 'EA10Y', 'ECBDFR', 'FEDFUNDS', 'BRENT', 'GOLD', 'VIX'];
  const nums = keys.map(S).filter(Boolean);
  if (nums.length) pills.push({ kind: 'numbers', tone: 'green', kicker: 'Remember', title: 'The numbers to know by heart', tiles: nums.map(x => ({ k: shortName(x), v: fmtLevel(x.s, x.last), d: fmtChange(x), up: x.chg >= 0 })), note: 'Interviewers ask "Where is the 10-year?" or "Where is EUR/USD?": you should know without looking.' });

  const last = nums.length ? nums.map(x => x.date).sort().pop() : null;
  return { pills, mood, asOf: last, updated: N.updated };
}
