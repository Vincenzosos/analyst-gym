# Analyst Gym: content schema (read fully before writing content)

The site is a personal training gym for graduate-programme online tests (SHL, Kenexa, Cappfinity, HireVue style) and banking or finance interviews. The target user is a finance graduate preparing for analyst roles.

## Language rules
- **Question text** (`stem`, `options`, passage `text`, dataset titles and labels) is in **ENGLISH**, as in the real tests.
- **Lessons and explanations** (`explanation.*`, lesson `sections`, `examples`, `cheatsheet`, SJT option explanations, behavioural guidance) are in **ITALIAN**. Use plain, direct Italian. Keep English technical terms where bankers use them, e.g. "EBITDA", "enterprise value", "accretion/dilution".
- Never use em dashes (—). Use commas, colons or full stops.
- Never name real people. Real companies may appear only in neutral, factual, non-sensitive ways. Prefer fictional company names such as "Northbridge Industrials" or "Alvona Foods".

## Explanation object (for every question)
```json
"explanation": {
  "steps": ["Passo 1 ...", "Passo 2 ...", "..."],
  "shortcut": "Il modo più veloce per arrivarci in sede di test",
  "trap": "L'errore tipico che porta alla risposta sbagliata più scelta",
  "rule": "La regola generale da riutilizzare (1 riga)"
}
```
- `steps`: 2–6 numbered-in-spirit steps, showing the actual arithmetic or logic with the numbers.
- Every field is required. Each field is 1–3 sentences, concise.

## Question item (banks)
```json
{
  "id": "num-012-b",
  "skill": "numerical|verbal|logical|sjt|fin-acc|fin-val|fin-ma|fin-lbo|markets|commercial",
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
{ "id": "les-num-01", "skill": "numerical", "order": 1, "title": "Italian title", "minutes": 12,
  "summary": "1 riga: cosa saprai fare alla fine",
  "sections": [{ "h": "Titolo sezione", "body": "Markdown semplice in italiano: paragrafi brevi, elenchi puntati, **grassetto**, tabelle markdown, formule in testo semplice (es. Crescita % = (Nuovo − Vecchio) / Vecchio × 100)" }],
  "examples": [{ "q": "Esempio (stem in inglese come nel test)", "steps": ["passo", "passo"], "answer": "risposta" }],
  "cheatsheet": ["regola o formula breve", "..."] }
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
