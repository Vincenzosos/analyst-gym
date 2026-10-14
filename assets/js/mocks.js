// Mock test templates, modelled on the assessments the candidate is facing.
export const MOCKS = [
  {
    id: 'diag', title: 'Diagnostic test', tag: 'Start here', minutes: 45, passMark: 0.6, mode: 'diag',
    desc: '40 mixed questions across every area: it measures your starting point and builds the plan.',
    sections: [
      { skill: 'numerical', n: 6 }, { skill: 'mental', n: 6 }, { skill: 'verbal', n: 6 }, { skill: 'logical', n: 5 },
      { skill: 'inductive', n: 5 }, { skill: 'sjt', n: 4 }, { skill: 'fin-acc', n: 2 }, { skill: 'fin-val', n: 2 },
      { skill: 'fin-ma', n: 2 }, { skill: 'fin-lbo', n: 1 }, { skill: 'markets', n: 1 },
    ], timeLimit: 45 * 60, single: true,
  },
  {
    id: 'shl-num', title: 'Numerical reasoning (SHL / Kenexa)', tag: 'Online test', minutes: 25, passMark: 0.7,
    desc: '18 questions on tables and charts in 25 minutes. Calculator allowed (key K).',
    sections: [{ skill: 'numerical', n: 18 }], timeLimit: 25 * 60, single: true,
  },
  {
    id: 'shl-verb', title: 'Verbal reasoning (SHL / Kenexa)', tag: 'Online test', minutes: 19, passMark: 0.7,
    desc: '24 True / False / Cannot say statements in 19 minutes.',
    sections: [{ skill: 'verbal', n: 24 }], timeLimit: 19 * 60, single: true,
  },
  {
    id: 'inductive', title: 'Inductive / abstract reasoning', tag: 'Online test', minutes: 20, passMark: 0.7,
    desc: '12 figure sequences plus 6 number series in 20 minutes.',
    sections: [{ skill: 'inductive', n: 12 }, { skill: 'series', n: 6 }], timeLimit: 20 * 60, single: true,
  },
  {
    id: 'capp', title: 'Cappfinity immersive (HSBC style)', tag: 'Bank', minutes: 35, passMark: 0.7,
    desc: 'Numerical, verbal and situational judgement back to back, as in the Online Immersive Assessment.',
    sections: [{ skill: 'numerical', n: 8, name: 'Numerical' }, { skill: 'verbal', n: 8, name: 'Verbal' }, { skill: 'sjt', n: 8, name: 'Situational judgement' }],
    timeLimit: 35 * 60, single: true,
  },
  {
    id: 'bofa', title: 'Online assessment (Bank of America style)', tag: 'Bank', minutes: 16, passMark: 0.7,
    desc: 'Section 1: 8 SJT scenarios in 9 minutes. Section 2: numerical business case, 5 questions in 7 minutes.',
    sections: [{ skill: 'sjt', n: 8, limit: 9 * 60, name: 'Situational judgement' }, { skill: 'numerical', n: 5, limit: 7 * 60, name: 'Numerical case' }],
  },
  {
    id: 'tech', title: 'Technical interview (IB analyst)', tag: 'Interview', minutes: 25, passMark: 0.75,
    desc: '20 technical questions: accounting, valuation, M&A, LBO, markets. First-round pace.',
    sections: [{ skill: 'fin-acc', n: 4 }, { skill: 'fin-val', n: 6 }, { skill: 'fin-ma', n: 4 }, { skill: 'fin-lbo', n: 3 }, { skill: 'markets', n: 3 }],
    timeLimit: 25 * 60, single: true,
  },
  {
    id: 'video', title: 'Video interview (HireVue / Cappfinity)', tag: 'Interview', minutes: 15, video: true,
    desc: '5 questions: 30 seconds to think, up to 2 minutes to answer. Recording stays on this device, then you rate yourself.',
  },
];
export const MOCK = Object.fromEntries(MOCKS.map(m => [m.id, m]));
