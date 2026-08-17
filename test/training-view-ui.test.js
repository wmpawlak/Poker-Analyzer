import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.localStorage = new MemoryStorage();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
test.after(() => vite.close());
const {
  TrainingFeedback,
  TrainingNavigation,
  TrainingQuestion,
  TrainingSetup,
  TrainingView,
} = await vite.ssrLoadModule('/src/views/TrainingView.jsx');

const status = {
  pools: {
    preflop_selection: { cash: { active: 40 }, tournament: { active: 15 } },
    preflop_vs_reraise: { cash: { active: 12 }, tournament: { active: 8 } },
    cbet_barrels: { cash: { active: 20 }, tournament: { active: 10 } },
    turn_river: { cash: { active: 30 }, tournament: { active: 5 } },
  },
  queue: { pending: 3, reanalysis: 2 },
};

const pendingEquityStatus = {
  ...status,
  pools: {
    ...status.pools,
    equity_pot_odds: {
      cash: { active: 0, modeCounts: { known_hand: 0, range: 0, pot_odds: 0 } },
      tournament: { active: 0, modeCounts: { known_hand: 0, range: 0, pot_odds: 0 } },
    },
  },
  equityActivation: {
    needsActivation: true,
    candidateCount: 2,
    activeCount: 0,
    pools: {
      cash: {
        candidateModeCounts: { known_hand: 1, range: 1, pot_odds: 0 },
        activeModeCounts: { known_hand: 0, range: 0, pot_odds: 0 },
      },
      tournament: {
        candidateModeCounts: { known_hand: 0, range: 0, pot_odds: 0 },
        activeModeCounts: { known_hand: 0, range: 0, pot_odds: 0 },
      },
    },
  },
};

const activeEquityStatus = {
  ...pendingEquityStatus,
  pools: {
    ...pendingEquityStatus.pools,
    equity_pot_odds: {
      cash: { active: 2, modeCounts: { known_hand: 1, range: 1, pot_odds: 0 } },
      tournament: { active: 0, modeCounts: { known_hand: 0, range: 0, pot_odds: 0 } },
    },
  },
  equityActivation: {
    ...pendingEquityStatus.equityActivation,
    needsActivation: false,
    activeCount: 2,
    pools: {
      cash: {
        ...pendingEquityStatus.equityActivation.pools.cash,
        activeCount: 2,
        activeModeCounts: { known_hand: 1, range: 1, pot_odds: 0 },
      },
      tournament: {
        ...pendingEquityStatus.equityActivation.pools.tournament,
        activeCount: 0,
      },
    },
  },
};

const question = {
  spotVersionId: 'spot-1',
  exerciseType: 'cbet_barrels',
  gameType: 'cash',
  street: 'TURN',
  stage: 'turn',
  episodeId: 'episode-1',
  sequenceIndex: 2,
  sequenceLength: 2,
  usesHistoricalLine: true,
  continuationNotice: 'Etap turn jest dalszym ciągiem historycznej linii rozdania.',
  question: {
    heroCards: ['Ah', 'Kd'],
    board: ['2c', '7d', 'Ts', 'Qh'],
    heroPosition: 'BTN',
    blinds: { smallBlind: 0.5, bigBlind: 1, ante: 0.1 },
    pot: 12,
    toCall: 0,
    potOdds: 0,
    effectiveStackBb: 75,
    context: { opponentsInHand: 1 },
    players: [
      { playerId: 'Hero', position: 'BTN', stack: 75, folded: false, allIn: false },
      { playerId: 'Villain', position: 'BB', stack: 80, folded: false, allIn: false },
    ],
    priorActions: [
      { street: 'FLOP', actor: 'Hero', type: 'bet', amount: 4, toAmount: 4, allIn: false, forced: false },
      { street: 'FLOP', actor: 'Villain', type: 'call', amount: 4, toAmount: 4, allIn: false, forced: false },
    ],
  },
  answerOptions: [
    { id: 'check', action: 'check' },
    { id: 'small_bet', action: 'bet' },
    { id: 'large_bet', action: 'bet' },
  ],
};

const feedback = {
  grade: 'acceptable',
  bigBlind: 1,
  answerKey: {
    preferredAnswer: 'small_bet',
    acceptableAlternatives: ['check'],
    rationale: 'Mały bet wykorzystuje przewagę zakresu bez nadmiernego pompowania puli.',
    blockersEquity: 'As blokuje część najmocniejszych kontynuacji i zachowuje equity.',
    opponentRange: 'Pary, drawy i część słabszych broadwayów.',
    suggestedSizing: { action: 'bet', potRatio: 0.33, raiseToBb: 0 },
  },
  historicalAction: { type: 'check', amount: 0, allIn: false },
  historicalResult: { outcome: 'LOST', heroWinnings: 0, heroInvestment: 12, netProfit: -12, sawShowdown: true, handRanking: 'PAIR' },
  historicalDecision: { grade: 'acceptable', answer: 'check', comment: 'Faktyczna decyzja była jedną z dopuszczalnych linii.' },
  replayerHandId: 'hand-1',
};

const stats = {
  total: { total: 3, correct: 1, acceptable: 1, incorrect: 1, preferredRate: 0.3333, acceptedRate: 0.6667 },
  byPosition: { BTN: { total: 3, correct: 1, acceptable: 1, incorrect: 1, acceptedRate: 0.6667 } },
  byStack: { '41-100bb': { total: 3, correct: 1, acceptable: 1, incorrect: 1, acceptedRate: 0.6667 } },
  byExerciseType: { cbet_barrels: { total: 3, correct: 1, acceptable: 1, incorrect: 1, acceptedRate: 0.6667 } },
};

test('konfiguracja pokazuje cztery tryby, formaty i rozmiary sesji', () => {
  const html = renderToStaticMarkup(createElement(TrainingSetup, {
    status,
    exerciseType: 'preflop_selection',
    gameType: 'both',
    sessionSize: 20,
    onExerciseTypeChange: () => {}, onGameTypeChange: () => {}, onSessionSizeChange: () => {}, onStart: () => {},
  }));
  assert.match(html, /Selekcja preflop/);
  assert.match(html, /Przeciw 3-betom i reshove’om/);
  assert.match(html, /C-bet i kolejne baryłki/);
  assert.match(html, /Decyzje turn\/river/);
  assert.match(html, /Cash \+ Turnieje/);
  assert.match(html, /Cała pula/);
  assert.match(html, /Dostępna pula: 55 spotów/);
  assert.match(html, /data-testid="start-training-session"/);
});

test('setup ćwiczeń aktywuje equity lokalnie i odblokowuje tylko dostępne poziomy', async () => {
  globalThis.localStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const calls = [];
  let statusRequestCount = 0;
  const api = {
    getTrainingStatus: async () => {
      statusRequestCount += 1;
      return statusRequestCount === 1 ? pendingEquityStatus : activeEquityStatus;
    },
    getTrainingHistory: async () => ({ attempts: [], sessions: [] }),
    getTrainingStats: async () => stats,
    activateEquityTraining: async () => {
      calls.push('activate');
      return { status: activeEquityStatus };
    },
  };
  const root = createRoot(document.getElementById('root'));
  await act(async () => {
    root.render(createElement(TrainingView, { api }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  try {
    const equityExercise = [...document.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Equity i pot odds'));
    await act(() => equityExercise.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.match(document.body.textContent, /Analizy equity są gotowe — aktywuj ćwiczenia/);
    assert.match(document.body.textContent, /lokalna i bezpłatna operacja/i);
    assert.ok(document.querySelector('[data-testid="activate-equity-training-from-setup"]'));
    assert.equal(document.querySelector('[data-testid="start-training-session"]'), null);

    await act(async () => {
      document.querySelector('[data-testid="activate-equity-training-from-setup"]')
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.deepEqual(calls, ['activate']);
    assert.equal(statusRequestCount, 2);
    assert.equal(document.querySelector('[data-testid="start-training-session"]')?.disabled, false);

    const potOdds = [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === 'Pot odds');
    assert.equal(potOdds.disabled, true);
    assert.match(potOdds.title, /Brak aktywnych spotów/);
    const mixed = [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === 'Mixed');
    assert.equal(mixed.disabled, false);
    await act(() => mixed.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.match(document.body.textContent, /Dostępna pula: 2 spotów/);
  } finally {
    await act(() => root.unmount());
  }
});

test('pytanie pokazuje wyłącznie stan przed decyzją i oznacza historyczny etap turn', () => {
  const bbQuestion = {
    ...question,
    question: {
      ...question.question,
      blinds: { smallBlind: 50, bigBlind: 100, ante: 10 },
      pot: 1200,
      toCall: 300,
      players: [
        { playerId: 'Hero', position: 'BTN', stack: 7500, folded: false, allIn: false },
        { playerId: 'Villain', position: 'BB', stack: 8000, folded: false, allIn: false },
      ],
      priorActions: [
        { street: 'FLOP', actor: 'Hero', type: 'bet', amount: 400, toAmount: 400, allIn: false, forced: false },
        { street: 'FLOP', actor: 'Villain', type: 'call', amount: 400, toAmount: 400, allIn: false, forced: false },
      ],
    },
  };
  const html = renderToStaticMarkup(createElement(TrainingQuestion, {
    question: bbQuestion,
    selectedAnswer: '',
    onSelectAnswer: () => {},
    onSubmit: () => {},
  }));
  assert.match(html, /dalszym ciągiem historycznej linii/);
  assert.match(html, /Karty Hero · BTN/);
  assert.match(html, /Efektywny stack/);
  assert.match(html, /Wcześniejsze akcje/);
  assert.match(html, /12 BB/);
  assert.match(html, /3 BB/);
  assert.match(html, /75 BB/);
  assert.match(html, /4 BB/);
  assert.doesNotMatch(html, /1.?200 BB|7.?500 BB|400 BB/);
  assert.match(html, /Mały bet \(do 40% puli\)/);
  assert.doesNotMatch(html, /Uzasadnienie trenera|Przewidywany zakres rywala|Linia historyczna/);
  assert.doesNotMatch(html, /wynik finansowy|showdown/i);
});

test('brak suplementu pokazuje neutralny komunikat, ale nie blokuje odpowiedzi action-only', () => {
  const headsUpCall = {
    ...question,
    exerciseType: 'preflop_selection',
    street: 'FLOP',
    question: {
      ...question.question,
      toCall: 3,
      potOdds: 0.25,
      legalActions: ['fold', 'call', 'raise'],
      context: { opponentsInHand: 1 },
    },
  };
  const html = renderToStaticMarkup(createElement(TrainingQuestion, {
    question: headsUpCall,
    selectedAnswer: '',
    onSelectAnswer: () => {},
    onSubmit: () => {},
  }));
  assert.match(html, /Analiza equity względem zakresu nie jest jeszcze dostępna/);
  assert.match(html, /Możesz normalnie rozwiązać to pytanie/);
  assert.match(html, /data-testid="equity-coverage-message"/);
  assert.match(html, /data-answer-id="check"/);
  assert.match(html, /data-testid="submit-training-answer"/);
});

test('multiway i spot bez calla pokazują komunikat o braku zastosowania osobnej oceny equity', () => {
  const multiway = {
    ...question,
    question: { ...question.question, toCall: 3, legalActions: ['fold', 'call'], context: { opponentsInHand: 2 } },
  };
  const noCall = {
    ...question,
    question: { ...question.question, toCall: 0, legalActions: ['check', 'bet'], context: { opponentsInHand: 1 } },
  };
  for (const candidate of [multiway, noCall]) {
    const html = renderToStaticMarkup(createElement(TrainingQuestion, {
      question: candidate,
      selectedAnswer: '',
      onSelectAnswer: () => {},
      onSubmit: () => {},
    }));
    assert.match(html, /Osobna ocena equity nie dotyczy tego typu pytania/);
    assert.match(html, /data-testid="submit-training-answer"/);
  }
});

test('gotowy suplement ukrywa komunikat o braku analizy bez zmiany układu odpowiedzi', () => {
  const questionWithSupplement = {
    ...question,
    exerciseType: 'preflop_selection',
    equitySupplementAvailable: true,
    question: {
      ...question.question,
      toCall: 3,
      legalActions: ['fold', 'call', 'raise'],
      context: { opponentsInHand: 1 },
    },
  };
  const html = renderToStaticMarkup(createElement(TrainingQuestion, {
    question: questionWithSupplement,
    selectedAnswer: '',
    onSelectAnswer: () => {},
    onSubmit: () => {},
  }));
  assert.doesNotMatch(html, /data-testid="equity-coverage-message"/);
  assert.match(html, /data-answer-id="check"/);
  assert.match(html, /data-testid="submit-training-answer"/);
});

test('spot z suplementem pokazuje zakres i osobny pierwszy krok equity', () => {
  const supplemented = {
    ...question,
    exerciseType: 'equity_pot_odds',
    equityMode: 'range',
    opponentRange: [
      { handClass: 'AKS', weight: 0.75 },
      { handClass: 'QQ', weight: 1 },
      { handClass: '99', weight: 1 },
      { handClass: 'AA', weight: 1 },
      { handClass: 'AQO', weight: 0.5 },
    ],
    equityAnswerOptions: [
      { id: 'equity_40', label: '40%' },
      { id: 'equity_50', label: '50%' },
    ],
    actionAnswerOptions: [{ id: 'fold', action: 'fold', label: 'Fold' }],
    answerOptions: [{ id: 'fold', action: 'fold', label: 'Fold' }],
    question: { ...question.question, equityMode: 'range' },
  };
  const html = renderToStaticMarkup(createElement(TrainingQuestion, {
    question: supplemented,
    selectedAnswer: '',
    selectedEquityBucket: 'equity_50',
    equityStep: 1,
    onSelectEquityBucket: () => {},
    onAdvanceEquity: () => {},
    onSelectAnswer: () => {},
    onSubmit: () => {},
  }));
  assert.match(html, /Założony zakres modelu/);
  assert.match(html, /Macierz zakresu/);
  assert.match(html, /data-testid="open-equity-range-matrix"/);
  assert.doesNotMatch(html, /data-testid="equity-range-matrix-modal"/);
  assert.match(html, /data-testid="equity-bucket-step"/);
  assert.match(html, /data-testid="advance-equity-answer"/);
  assert.doesNotMatch(html, /data-testid="submit-training-answer"/);
});

test('macierz zakresu zachowuje pokerowy układ rąk i otwiera się wyłącznie na żądanie', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById('root'));
  const rangeQuestion = {
    ...question,
    exerciseType: 'equity_pot_odds',
    equityMode: 'range',
    opponentRange: [
      { handClass: 'AKS', weight: 0.75 },
      { handClass: 'QQ', weight: 1 },
      { handClass: '99', weight: 1 },
      { handClass: 'AA', weight: 1 },
      { handClass: 'AQO', weight: 0.5 },
    ],
    equityAnswerOptions: [{ id: 'equity_50', label: '50%' }],
    actionAnswerOptions: [{ id: 'fold', action: 'fold', label: 'Fold' }],
    answerOptions: [{ id: 'fold', action: 'fold', label: 'Fold' }],
    question: { ...question.question, equityMode: 'range' },
  };
  await act(async () => {
    root.render(createElement(TrainingQuestion, {
      question: rangeQuestion,
      selectedAnswer: '',
      equityStep: 1,
      onSelectAnswer: () => {},
      onSubmit: () => {},
    }));
  });
  try {
    assert.equal(document.querySelector('[data-testid="equity-range-matrix-modal"]'), null);
    await act(() => document.querySelector('[data-testid="open-equity-range-matrix"]')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.ok(document.querySelector('[data-testid="equity-range-matrix-modal"]'));
    assert.match(document.querySelector('[data-testid="equity-range-matrix"]').className, /max-w-xl/);
    assert.equal(document.querySelectorAll('[data-testid="equity-range-matrix-cell"]').length, 169);

    const cell = (handClass) => document.querySelector(`[data-hand-class="${handClass}"]`);
    assert.equal(cell('AA').dataset.row, '0');
    assert.equal(cell('AA').dataset.column, '0');
    assert.equal(cell('AKs').dataset.row, '0');
    assert.equal(cell('AKs').dataset.column, '1');
    assert.equal(cell('AQo').dataset.row, '2');
    assert.equal(cell('AQo').dataset.column, '0');
    assert.equal(cell('QQ').dataset.rangeWeight, '100');
    assert.equal(cell('AKs').dataset.rangeWeight, '75');
    assert.equal(cell('AQo').dataset.rangeWeight, '50');

    await act(() => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(document.querySelector('[data-testid="equity-range-matrix-modal"]'), null);
  } finally {
    await act(() => root.unmount());
  }
});

test('feedback pokazuje ocenę, zakresy, sizing i ukryty wynik rozdania', () => {
  const html = renderToStaticMarkup(createElement(TrainingFeedback, {
    feedback,
    onContinue: () => {},
    onOpenReplayer: () => {},
  }));
  assert.match(html, /Dopuszczalna/);
  assert.match(html, /Uzasadnienie trenera/);
  assert.match(html, /Blockery i equity/);
  assert.match(html, /Przewidywany zakres rywala/);
  assert.match(html, /33% puli/);
  assert.match(html, /Co wydarzyło się w rozdaniu/);
  assert.match(html, /Pokaż wynik/);
  assert.doesNotMatch(html, /next-training-question/);
  assert.doesNotMatch(html, /Hero przegrał rozdanie/);
});

test('dolna nawigacja pokazuje strzałki tylko dla dostępnych przejść', () => {
  const html = renderToStaticMarkup(createElement(TrainingNavigation, {
    canGoPrevious: true,
    canGoNext: true,
    onPrevious: () => {},
    onNext: () => {},
  }));
  assert.match(html, /data-testid="previous-training-question"/);
  assert.match(html, /data-testid="next-training-question"/);
  assert.match(html, /Poprzednie/);
  assert.match(html, /Następne/);
});

test('wynik jest odsłaniany dopiero po kliknięciu, a brak danych nie otwiera Replayera', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById('root'));
  await act(async () => {
    root.render(createElement(TrainingFeedback, {
      feedback, onContinue: () => {},
    }));
  });
  try {
    assert.equal(document.querySelector('[data-testid="training-historical-result"]'), null);
    await act(() => document.querySelector('[data-testid="show-training-result"]')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.match(document.body.textContent, /Hero przegrał rozdanie/);
    assert.match(document.body.textContent, /Wynik netto:.*-12/);
    assert.match(document.body.textContent, /Dopuszczalna decyzja/);
    await act(async () => {
      root.render(createElement(TrainingFeedback, {
        feedback: { ...feedback, historicalResult: null, historicalDecision: null },
        onContinue: () => {},
      }));
    });
    assert.equal(document.querySelector('[data-testid="show-training-result"]'), null);
  } finally {
    await act(() => root.unmount());
  }
});

test('wynik preferuje krótkie podsumowanie istniejącej analizy rozdania', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById('root'));
  await act(async () => {
    root.render(createElement(TrainingFeedback, {
      feedback: { ...feedback, historicalSummary: 'Hero wygrał pulę na riverze, ale call przed flopem był zbyt luźny.' },
      onContinue: () => {},
    }));
  });
  try {
    await act(() => document.querySelector('[data-testid="show-training-result"]')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.match(document.body.textContent, /Podsumowanie analizy/);
    assert.match(document.body.textContent, /call przed flopem był zbyt luźny/);
  } finally {
    await act(() => root.unmount());
  }
});

test('feedback pokazuje historyczną akcję i wynik wyłącznie w BB', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById('root'));
  await act(async () => {
    root.render(createElement(TrainingFeedback, {
      feedback: {
        ...feedback,
        bigBlind: 100,
        historicalAction: { type: 'call', amount: 300, allIn: false },
        historicalResult: { ...feedback.historicalResult, netProfit: -1200 },
      },
    }));
  });
  try {
    assert.match(document.body.textContent, /Call 3 BB/);
    await act(() => document.querySelector('[data-testid="show-training-result"]')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.match(document.body.textContent, /Wynik netto: -12 BB/);
    assert.doesNotMatch(document.body.textContent, /1[,.]?200|300/);
  } finally {
    await act(() => root.unmount());
  }
});

test('ikona pot odds odsłania wyliczenie puli, calla i wymaganego equity', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById('root'));
  const questionWithCall = {
    ...question,
    question: {
      ...question.question,
      blinds: { smallBlind: 50, bigBlind: 100, ante: 0 },
      pot: 900,
      toCall: 300,
      potOdds: 0.25,
    },
  };
  await act(async () => {
    root.render(createElement(TrainingQuestion, {
      question: questionWithCall,
      selectedAnswer: '', onSelectAnswer: () => {}, onSubmit: () => {},
    }));
  });
  try {
    const info = document.querySelector('[data-testid="pot-odds-info"]');
    assert.ok(info);
    await act(() => info.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.match(document.body.textContent, /Pula przed Twoją decyzją/);
    assert.match(document.body.textContent, /Pula po callu/);
    assert.match(document.body.textContent, /3 BB \/ 12 BB = 25%/);
    assert.doesNotMatch(document.body.textContent, /900|300/);
    assert.match(document.body.textContent, /przed rake i wpływem dalszej gry/);
  } finally {
    await act(() => root.unmount());
  }
});

test('pełny widok pobiera klucz dopiero po zatwierdzeniu odpowiedzi i zapisuje sesję', async () => {
  globalThis.localStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const calls = [];
  const activeSession = {
    id: 'session-1', exerciseType: 'cbet_barrels', gameType: 'cash', requestedSize: 10,
    targetSize: 1, status: 'active', answeredCount: 0, currentSpotVersionId: null,
    score: { correct: 0, acceptable: 0, incorrect: 0 },
  };
  const completedSession = {
    ...activeSession, status: 'completed', answeredCount: 1,
    score: { correct: 0, acceptable: 1, incorrect: 0 },
  };
  const api = {
    getTrainingStatus: async () => status,
    getTrainingHistory: async () => ({ attempts: [], sessions: [] }),
    getTrainingStats: async () => stats,
    createTrainingSession: async (payload) => { calls.push(['create', payload]); return { resumed: false, session: activeSession }; },
    getNextTrainingQuestion: async (sessionId) => { calls.push(['next', sessionId]); return { session: activeSession, question }; },
    submitTrainingAnswer: async (sessionId, payload) => { calls.push(['answer', sessionId, payload]); return { session: completedSession, feedback }; },
    abandonTrainingSession: async (sessionId) => { calls.push(['abandon', sessionId]); return { session: { ...activeSession, status: 'abandoned', abandonedAt: '2026-08-12T12:00:00.000Z' } }; },
  };
  const root = createRoot(document.getElementById('root'));
  await act(async () => {
    root.render(createElement(TrainingView, { api }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  try {
    const start = document.querySelector('[data-testid="start-training-session"]');
    assert.ok(start);
    await act(async () => {
      start.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.ok(document.querySelector('[data-testid="training-question"]'));
    assert.ok(document.querySelector('[data-testid="abandon-training-session"]'));
    assert.equal(document.querySelector('[data-testid="training-feedback"]'), null);
    assert.doesNotMatch(document.body.textContent, /Uzasadnienie trenera/);

    const choice = document.querySelector('[data-answer-id="check"]');
    await act(() => choice.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    const submit = document.querySelector('[data-testid="submit-training-answer"]');
    await act(async () => {
      submit.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.ok(document.querySelector('[data-testid="training-feedback"]'));
    assert.match(document.body.textContent, /Uzasadnienie trenera/);
    assert.deepEqual(calls.at(-1), ['answer', 'session-1', { spotVersionId: 'spot-1', answer: 'check' }]);
    assert.equal(globalThis.localStorage.getItem('poker_active_training_session_v1'), 'session-1');
  } finally {
    await act(() => root.unmount());
  }
});

test('następne pytanie jest wygodnym przyciskiem i przewija widok na górę', async () => {
  globalThis.localStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const activeSession = {
    id: 'session-scroll', exerciseType: 'cbet_barrels', gameType: 'cash', requestedSize: 10,
    targetSize: 2, status: 'active', answeredCount: 0, currentSpotVersionId: null,
    score: { correct: 0, acceptable: 0, incorrect: 0 },
  };
  const afterAnswer = {
    ...activeSession, answeredCount: 1,
    score: { correct: 0, acceptable: 1, incorrect: 0 },
  };
  const nextQuestion = { ...question, spotVersionId: 'spot-2' };
  let nextCalls = 0;
  const api = {
    getTrainingStatus: async () => status,
    getTrainingHistory: async () => ({ attempts: [], sessions: [] }),
    getTrainingStats: async () => stats,
    createTrainingSession: async () => ({ resumed: false, session: activeSession }),
    getNextTrainingQuestion: async () => {
      nextCalls += 1;
      return nextCalls === 1
        ? { session: activeSession, question }
        : { session: afterAnswer, question: nextQuestion };
    },
    submitTrainingAnswer: async () => ({ session: afterAnswer, feedback }),
    abandonTrainingSession: async () => ({ session: { ...activeSession, status: 'abandoned' } }),
  };
  const scrollCalls = [];
  const previousScrollTo = dom.window.scrollTo;
  const previousAnimationFrame = globalThis.requestAnimationFrame;
  dom.window.scrollTo = (options) => scrollCalls.push(options);
  globalThis.requestAnimationFrame = (callback) => { callback(); return 1; };
  const root = createRoot(document.getElementById('root'));
  await act(async () => {
    root.render(createElement(TrainingView, { api }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  try {
    await act(async () => {
      document.querySelector('[data-testid="start-training-session"]')
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(() => document.querySelector('[data-answer-id="check"]')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    await act(async () => {
      document.querySelector('[data-testid="submit-training-answer"]')
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const nextButton = document.querySelector('[data-testid="next-training-question"]');
    assert.ok(nextButton);
    assert.match(nextButton.className, /w-full/);
    await act(async () => {
      nextButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(nextCalls, 2);
    assert.deepEqual(scrollCalls, [{ top: 0, behavior: 'smooth' }]);
    assert.equal(document.querySelector('[data-testid="training-feedback"]'), null);
    const previousButton = document.querySelector('[data-testid="previous-training-question"]');
    assert.ok(previousButton);
    await act(() => previousButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.equal(document.querySelector('[data-testid="training-question"]').dataset.spotVersionId, 'spot-1');
    assert.equal(document.querySelector('[data-testid="submit-training-answer"]'), null);
    assert.equal(document.querySelector('[data-testid="training-read-only-note"]'), null);
    assert.equal(document.querySelector('[data-testid="training-review-header"]'), null);
    assert.equal([...document.querySelectorAll('[data-answer-id]')].every((button) => button.disabled), true);
    assert.equal(document.querySelector('[data-testid="previous-training-question"]'), null);
    await act(() => document.querySelector('[data-testid="next-training-question"]')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.equal(document.querySelector('[data-testid="training-question"]').dataset.spotVersionId, 'spot-2');
  } finally {
    dom.window.scrollTo = previousScrollTo;
    globalThis.requestAnimationFrame = previousAnimationFrame;
    await act(() => root.unmount());
  }
});

test('przerwanie ćwiczenia wymaga potwierdzenia i czyści localStorage', async () => {
  globalThis.localStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const calls = [];
  const active = {
    id: 'session-1', exerciseType: 'cbet_barrels', gameType: 'cash', requestedSize: 10,
    targetSize: 1, status: 'active', answeredCount: 0, currentSpotVersionId: null,
    score: { correct: 0, acceptable: 0, incorrect: 0 },
  };
  const api = {
    getTrainingStatus: async () => status,
    getTrainingHistory: async () => ({ attempts: [], sessions: [] }),
    getTrainingStats: async () => stats,
    createTrainingSession: async () => ({ resumed: false, session: active }),
    getNextTrainingQuestion: async () => ({ session: active, question }),
    abandonTrainingSession: async (sessionId) => { calls.push(sessionId); return { session: { ...active, status: 'abandoned' } }; },
  };
  const previousConfirm = globalThis.confirm;
  globalThis.confirm = () => true;
  const root = createRoot(document.getElementById('root'));
  await act(async () => {
    root.render(createElement(TrainingView, { api }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    document.querySelector('[data-testid="start-training-session"]')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  try {
    globalThis.localStorage.setItem('poker_active_training_session_v1', active.id);
    await act(async () => {
      document.querySelector('[data-testid="abandon-training-session"]')
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.deepEqual(calls, ['session-1']);
    assert.equal(globalThis.localStorage.getItem('poker_active_training_session_v1'), null);
    assert.ok(document.querySelector('[data-testid="start-training-session"]'));
  } finally {
    globalThis.confirm = previousConfirm;
    await act(() => root.unmount());
  }
});
