// Mock test templates, modelled on the assessments the candidate is facing.
export const MOCKS = [
  {
    id: 'diag', title: 'Test diagnostico', tag: 'Inizia da qui', minutes: 45, passMark: 0.6, mode: 'diag',
    desc: '40 domande miste su tutte le aree: misura il punto di partenza e crea il piano.',
    sections: [
      { skill: 'numerical', n: 6 }, { skill: 'mental', n: 6 }, { skill: 'verbal', n: 6 }, { skill: 'logical', n: 5 },
      { skill: 'inductive', n: 5 }, { skill: 'sjt', n: 4 }, { skill: 'fin-acc', n: 2 }, { skill: 'fin-val', n: 2 },
      { skill: 'fin-ma', n: 2 }, { skill: 'fin-lbo', n: 1 }, { skill: 'markets', n: 1 },
    ], timeLimit: 45 * 60, single: true,
  },
  {
    id: 'shl-num', title: 'Numerical reasoning (SHL / Kenexa)', tag: 'Test online', minutes: 25, passMark: 0.7,
    desc: '18 domande su tabelle e grafici in 25 minuti. Calcolatrice ammessa (tasto K).',
    sections: [{ skill: 'numerical', n: 18 }], timeLimit: 25 * 60, single: true,
  },
  {
    id: 'shl-verb', title: 'Verbal reasoning (SHL / Kenexa)', tag: 'Test online', minutes: 19, passMark: 0.7,
    desc: '24 affermazioni True / False / Cannot say in 19 minuti.',
    sections: [{ skill: 'verbal', n: 24 }], timeLimit: 19 * 60, single: true,
  },
  {
    id: 'inductive', title: 'Inductive / abstract reasoning', tag: 'Test online', minutes: 20, passMark: 0.7,
    desc: '12 sequenze di figure + 6 serie numeriche in 20 minuti.',
    sections: [{ skill: 'inductive', n: 12 }, { skill: 'series', n: 6 }], timeLimit: 20 * 60, single: true,
  },
  {
    id: 'capp', title: 'Cappfinity immersive (stile HSBC)', tag: 'Banca', minutes: 35, passMark: 0.7,
    desc: 'Numerical, verbal e situational judgement in sequenza, come nell’Online Immersive Assessment.',
    sections: [{ skill: 'numerical', n: 8, name: 'Numerical' }, { skill: 'verbal', n: 8, name: 'Verbal' }, { skill: 'sjt', n: 8, name: 'Situational judgement' }],
    timeLimit: 35 * 60, single: true,
  },
  {
    id: 'bofa', title: 'Online assessment (stile Bank of America)', tag: 'Banca', minutes: 16, passMark: 0.7,
    desc: 'Sezione 1: 8 scenari SJT in 9 minuti. Sezione 2: business case numerico, 5 domande in 7 minuti.',
    sections: [{ skill: 'sjt', n: 8, limit: 9 * 60, name: 'Situational judgement' }, { skill: 'numerical', n: 5, limit: 7 * 60, name: 'Numerical case' }],
  },
  {
    id: 'tech', title: 'Technical interview (IB analyst)', tag: 'Colloquio', minutes: 25, passMark: 0.75,
    desc: '20 domande tecniche: accounting, valuation, M&A, LBO, mercati. Ritmo da primo round.',
    sections: [{ skill: 'fin-acc', n: 4 }, { skill: 'fin-val', n: 6 }, { skill: 'fin-ma', n: 4 }, { skill: 'fin-lbo', n: 3 }, { skill: 'markets', n: 3 }],
    timeLimit: 25 * 60, single: true,
  },
  {
    id: 'video', title: 'Video interview (HireVue / Cappfinity)', tag: 'Colloquio', minutes: 15, video: true,
    desc: '5 domande: 30 secondi per pensare, fino a 2 minuti per rispondere. Registrazione solo locale, poi autovalutazione.',
  },
];
export const MOCK = Object.fromEntries(MOCKS.map(m => [m.id, m]));
