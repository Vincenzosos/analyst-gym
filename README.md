# Analyst Gym

Personal training site for graduate-programme online assessments (numerical, verbal, logical, abstract, situational judgement), finance technicals (accounting, valuation, M&A, LBO, markets), general culture and current affairs, and interviews (behavioural, video, commercial awareness).

## Sections
- **Oggi**: weekly mission (a fixed quota measured from your own activity), recommended session, this week's themes, levels per area. *Progressi* holds the path, charts and the diagnostic baseline.
- **Allenati**: every area with its lessons, drills (learn or timed) and the mistake notebook (spaced repetition: 1, 3, 7, 14 days).
- **Simulazioni**: timed mocks in the style of SHL, Cappfinity and BofA, plus a diagnostic.
- **Colloqui**: question bank with structure and answer skeletons, STAR story bank, video room.
- **News**: daily headlines grouped by theme, real market data, theme cards (mechanism, what to watch, how to use it in an interview), news drills and commercial-awareness notes.

## How it works
- Static site: no server, no accounts, no tracking, no AI calls. Progress is stored in the browser (`localStorage`); use *⚙ Dati → Esporta backup* to move it between devices.
- `scripts/fetch-news.mjs` runs daily in GitHub Actions (`.github/workflows/deploy.yml`): it stores headlines (title, source, date, link only) from public RSS feeds and market series from FRED, the ECB and other public endpoints in `data/news/`, then redeploys the site.
- Numerical, mental-math, series, abstract and real-market-data questions are generated fresh each time (`assets/js/gen/`). Other questions, lessons and theme cards live in `data/`.
- Tests: `npm test` (generators, market-data generator, content schema). Browser end-to-end checks: `npm run e2e`.

Not affiliated with any employer, bank or assessment provider. Practice material only. Headlines belong to their publishers and link to the original articles.
