# Analyst Gym

Personal training site for graduate-programme online assessments (numerical, verbal, logical, abstract, situational judgement) and finance interviews (accounting, valuation, M&A, LBO, markets, behavioural and video).

- Static site: no server, no tracking, no AI calls. Progress is stored in the browser (`localStorage`); use *Dati → Esporta backup* to move it between devices.
- Numerical, mental-math, series and abstract questions are generated fresh each time (`assets/js/gen/`). The other questions and lessons live in `data/`.
- Tests: `npm test` (generator checks and content-schema checks).

Not affiliated with any employer or assessment provider. Practice material only.
