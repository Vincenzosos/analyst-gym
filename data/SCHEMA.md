# Analyst Gym: content schema (read fully before writing content)

The site is a personal training gym for graduate-programme online tests (SHL, Kenexa, Cappfinity, HireVue style) and banking or finance interviews. The target user is a finance graduate preparing for analyst roles.

## Language rules
- All text is in **British English**, as used by London investment banks: question stems, options, passages, datasets, explanations, lessons, theme cards and interview guidance. Keep finance terms standard (EBITDA, enterprise value, accretion/dilution, bps).
- Numbers use English formatting: decimal point and comma thousands (1,250.5).
- Never use em dashes (—). Use commas, colons or full stops.
## Explanation object (for every question)
```json
"explanation": {
  "steps": ["Step 1 ...", "Step 2 ...", "..."],
  "shortcut": "The fastest way to get there under test conditions",
  "trap": "The typical mistake behind the most chosen wrong answer",
  "rule": "The general rule to reuse (one line)"
}
```
- `steps`: 2–6 numbered-in-spirit steps, showing the actual arithmetic or logic with the numbers.
- Every field is required. Each field is 1–3 sentences, concise.

## Question item (banks)
```json
{
  "id": "num-012-b",
  "skill": "numerical|verbal|logical|sjt|fin-acc|fin-val|fin-ma|fin-lbo|markets|commercial|culture",
  "level": 1,
  "type": "mcq|tfc|numeric",
  "ref": "optional id of a passage/dataset in the same file",
  "stem": "English question",
  "options": ["...", "...", "...", "..."],
  "answer": 2,
  "tolerance": 0.5,
  "unit": "%",
  "timeTarget": 60,
  "explanation": { "steps": [], "shortcut": "", "trap": "", "rule": "" },
  "tags": ["percent-change", "base-year"]
}
```
- `level`: 1 = base, 2 = test standard, 3 = hard.
- `options`: for `mcq` (4 or 5 options); omitted for `numeric`.
- `answer`:
  - `mcq`: the 0-based index of the correct option;
  - `tfc`: one of `"T"`, `"F"`, `"C"` (True / False / Cannot say);
  - `numeric`: a number.
- `tolerance` and `unit`: for `numeric` only. `tolerance` is an absolute tolerance.
- `timeTarget`: seconds a well-prepared candidate should need at real-test pace.
- Distractors must be **plausible**: built from the typical mistakes (wrong base, wrong period, forgetting a conversion, sign error), not random numbers.

## Passages (verbal) and datasets (numerical)
```json
"passages": [{ "id": "p01", "title": "English title", "text": "English passage 180-260 words" }]
"datasets": [{ "id": "d01", "title": "English title", "kind": "table|bar|line|pie",
               "unit": "EUR m", "columns": ["Region","2023","2024","2025"],
               "rows": [["North", 120, 132, 150], ["South", 80, 76, 90]],
               "note": "optional footnote, e.g. 1 EUR = 1.08 USD" }]
```
- A chart dataset uses the same `columns`/`rows` structure. The site renders it as a bar or line chart (series = rows, categories = columns[1:]), or as a pie (first numeric column).

## SJT item
```json
{
  "id": "sjt-07", "skill": "sjt", "level": 2,
  "type": "sjt",
  "stem": "English scenario 70-130 words, analyst at a bank / finance firm",
  "options": ["A ...", "B ...", "C ...", "D ..."],
  "ratings": [4, 2, 1, 3],
  "best": 0, "worst": 2,
  "competencies": ["ownership", "integrity", "teamwork", "client-focus", "communication", "prioritisation", "resilience"],
  "explanation": {
    "steps": ["Perché A è la migliore ...", "Perché C è la peggiore ...", "Su B e D ..."],
    "shortcut": "Il criterio che risolve lo scenario in 10 secondi",
    "trap": "La risposta che sembra giusta ma non lo è e perché",
    "rule": "Principio da riusare (es. trasparenza prima della velocità)"
  },
  "timeTarget": 75
}
```
- `ratings`: 1 = counterproductive, 2 = ineffective, 3 = fairly effective, 4 = most effective. Keep them consistent with `best` and `worst`.

## Behavioural / interview question
```json
{ "id": "beh-031", "category": "motivation|competency|strengths|technical-explain|curveball|banking-specific",
  "q": "English interview question",
  "tests": "Cosa vuole capire l'intervistatore (IT)",
  "structure": ["Apri con ...", "Situazione ...", "Azione ...", "Risultato ...", "Chiudi con ..."],
  "good": ["elemento che rende forte la risposta", "..."],
  "pitfalls": ["errore tipico", "..."],
  "skeleton": "Scheletro di risposta generico in inglese, 60-110 parole, con [placeholder] dove il candidato inserisce la sua esperienza",
  "time": 90 }
```

## Lesson
```json
{ "id": "les-num-01", "skill": "numerical", "order": 1, "title": "Lesson title", "minutes": 12,
  "summary": "One line: what you will be able to do at the end",
  "sections": [{ "h": "Section title", "body": "Simple markdown: short paragraphs, bullet lists, **bold**, markdown tables, plain-text formulas (e.g. Growth % = (New − Old) / Old × 100)" }],
  "examples": [{ "q": "Worked example (stem as in the test)", "steps": ["step", "step"], "answer": "answer" }],
  "cheatsheet": ["short rule or formula", "..."] }
```
- Lessons teach a **method** the candidate can apply under time pressure, not encyclopaedic theory.
- Each lesson has 4–8 sections, 2–4 worked examples and 4–10 cheatsheet lines.
- Never use em dashes.

## File format
Each pack is one JSON file in `data/staging/<pack>.json` with **top-level keys** as specified in your task:
- `{"lessons": [...]}`;
- `{"passages": [...], "items": [...]}`;
- `{"datasets": [...], "items": [...]}`;
- `{"items": [...]}`;
- `{"questions": [...]}`.

It must be valid JSON: double quotes, no trailing commas, no comments. Validate it with `python3 -c "import json;json.load(open(PATH))"` after writing.


## News theme cards (`data/news/concepts.json`)
```json
{ "concepts": [{
  "id": "central-bank-cut", "theme": "Politica monetaria", "title": "Taglio dei tassi", "skill": "markets|commercial|culture", "priority": 1,
  "match": ["RegExp sources applied case-insensitively to English headlines"], "exclude": ["optional RegExp sources"],
  "explainer": "markdown, 100-180 words", "interview": "guidance, then an 'EN: ' template sentence", "watch": ["2-4 bullets"], "pill": { "why": "one sentence", "watch": "one sentence", "en": "interview talking point" },
  "questions": [{ "qid": "central-bank-cut-q1", "level": 1, "type": "mcq", "stem": "English", "options": ["4"], "answer": 0, "timeTarget": 60, "explanation": { "steps": [], "shortcut": "", "trap": "", "rule": "" }, "tags": [] }]
}]}
```
- Questions are shown next to a real headline matched by the regexes, so they must test the general mechanism of the theme and stay correct whatever the specific headline says.
- A headline gets at most 2 themes, highest `priority` first.

## General culture (`data/banks/bank-culture.json`)
Same item format as the other banks, `skill: "culture"`. Facts must be durable (no current office holders, no figures that change every year) or explicitly date-stamped.

## News data (`data/news/headlines.json`, `data/news/markets.json`)
Generated daily by `scripts/fetch-news.mjs`. Headlines: titles, source, date and link only. Markets: `series[KEY] = { name, kind, unit, source, asOf, points: [[date, value], ...] }`.
