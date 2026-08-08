import test from 'node:test';
import assert from 'node:assert/strict';
import { configureStore } from '@reduxjs/toolkit';

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

const storage = new MemoryStorage();
globalThis.localStorage = storage;

const {
  AI_ANALYSES_CACHE_KEY,
  AI_DEFAULT_MODEL_CACHE_KEY,
  DEFAULT_AI_MODEL,
  LEGACY_AI_ANALYSES_CACHE_KEY,
  LEGACY_V3_AI_ANALYSES_CACHE_KEY,
  SAVED_HANDS_CACHE_KEY,
  SESSION_AI_ANALYSES_CACHE_KEY,
  analyzeHandWithAI,
  analyzeSessionWithAI,
  clearData,
  default: pokerReducer,
  loadAiAnalyses,
  loadDefaultAiModel,
  loadSavedHandIds,
  loadSessionAiAnalyses,
  setDefaultAiModel,
  toggleSavedHand,
} = await import('../src/store/pokerSlice.js');

const analysis = {
  heroResult: {
    handId: '96890300082',
    outcome: 'WON',
    heroWinnings: 24.67,
    netProfit: 12.34,
    handRanking: 'FULL_HOUSE',
  },
  preflop: '',
  flop: '',
  turn: '',
  river: '',
  summary: 'Raport',
};

test('domyślnym modelem jest Terra, a prawidłowy wybór jest zapamiętywany', () => {
  const modelStorage = new MemoryStorage();
  assert.equal(loadDefaultAiModel(modelStorage), DEFAULT_AI_MODEL);
  modelStorage.setItem(AI_DEFAULT_MODEL_CACHE_KEY, 'gpt-5.6-sol');
  assert.equal(loadDefaultAiModel(modelStorage), 'gpt-5.6-sol');
  modelStorage.setItem(AI_DEFAULT_MODEL_CACHE_KEY, 'nieznany-model');
  assert.equal(loadDefaultAiModel(modelStorage), DEFAULT_AI_MODEL);

  let state = pokerReducer(undefined, { type: '@@init' });
  state = pokerReducer(state, setDefaultAiModel('gpt-5.6-sol'));
  assert.equal(state.defaultAiModel, 'gpt-5.6-sol');
  assert.equal(storage.getItem(AI_DEFAULT_MODEL_CACHE_KEY), 'gpt-5.6-sol');
});

test('cache v2 jest migrowany do historii v4 jako raport Gemini', () => {
  const legacyAnalysis = { ...analysis, summary: 'Stary raport' };
  const migrationStorage = new MemoryStorage({
    [LEGACY_AI_ANALYSES_CACHE_KEY]: JSON.stringify({
      96890300082: legacyAnalysis,
    }),
    poker_gemini_key: 'old-browser-key',
  });
  const migrated = loadAiAnalyses({
    storage: migrationStorage,
    analyzedAt: '2026-07-29T12:00:00.000Z',
  });

  assert.deepEqual(migrated, {
    96890300082: [{
      reportId: 'legacy-v2-96890300082-1',
      model: { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
      analyzedAt: '2026-07-29T12:00:00.000Z',
      analysis: legacyAnalysis,
    }],
  });
  assert.equal(migrationStorage.getItem(LEGACY_AI_ANALYSES_CACHE_KEY), null);
  assert.equal(migrationStorage.getItem('poker_gemini_key'), null);
  assert.deepEqual(
    JSON.parse(migrationStorage.getItem(AI_ANALYSES_CACHE_KEY)),
    migrated,
  );
});

test('pojedynczy raport v3 jest zachowywany jako pierwszy wpis historii v4', () => {
  const v3Report = {
    model: { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
    analyzedAt: '2026-07-29T12:00:00.000Z',
    analysis,
  };
  const migrationStorage = new MemoryStorage({
    [LEGACY_V3_AI_ANALYSES_CACHE_KEY]: JSON.stringify({
      96890300082: v3Report,
    }),
  });
  const migrated = loadAiAnalyses({ storage: migrationStorage });

  assert.equal(migrated['96890300082'].length, 1);
  assert.equal(migrated['96890300082'][0].reportId, 'legacy-v3-96890300082-1');
  assert.deepEqual(migrated['96890300082'][0].analysis, analysis);
  assert.equal(migrationStorage.getItem(LEGACY_V3_AI_ANALYSES_CACHE_KEY), null);
});

test('nowa analiza jest dopisywana do historii niezależnie od modelu', () => {
  let state = pokerReducer(undefined, { type: '@@init' });
  state = pokerReducer(
    state,
    analyzeHandWithAI.fulfilled({
      handId: '96890300082',
      reportId: 'report-gemini',
      model: { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
      analyzedAt: '2026-07-29T12:00:00.000Z',
      analysis: { ...analysis, summary: 'Gemini' },
    }, 'request-1', { handId: '96890300082' }),
  );
  state = pokerReducer(
    state,
    analyzeHandWithAI.fulfilled({
      handId: '96890300082',
      reportId: 'report-sol',
      model: { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
      analyzedAt: '2026-07-29T12:05:00.000Z',
      analysis: { ...analysis, summary: 'Sol' },
    }, 'request-2', { handId: '96890300082' }),
  );

  assert.deepEqual(Object.keys(state.aiAnalyses), ['96890300082']);
  assert.equal(state.aiAnalyses['96890300082'].length, 2);
  assert.equal(state.aiAnalyses['96890300082'][0].model.id, 'gemini-2.5-flash');
  assert.equal(state.aiAnalyses['96890300082'][1].model.id, 'gpt-5.6-sol');
  assert.equal(state.aiAnalyses['96890300082'][1].analysis.summary, 'Sol');
});

test('zapisana ręka jest przełączana i utrwalana wyłącznie po ID', () => {
  const savedStorage = new MemoryStorage({
    [SAVED_HANDS_CACHE_KEY]: JSON.stringify(['123', 456, '123']),
  });
  assert.deepEqual(loadSavedHandIds(savedStorage), ['123', '456']);

  let state = pokerReducer(undefined, { type: '@@init' });
  state = pokerReducer(state, toggleSavedHand('96890300082'));
  assert.equal(state.savedHandIds.includes('96890300082'), true);
  assert.equal(
    JSON.parse(storage.getItem(SAVED_HANDS_CACHE_KEY)).includes('96890300082'),
    true,
  );
  state = pokerReducer(state, toggleSavedHand('96890300082'));
  assert.equal(state.savedHandIds.includes('96890300082'), false);
});

test('thunk używa aktualnego modelu domyślnego i zapisuje model z odpowiedzi', async () => {
  const initialState = pokerReducer(undefined, { type: '@@init' });
  const store = configureStore({
    reducer: { poker: pokerReducer },
    preloadedState: {
      poker: {
        ...initialState,
        defaultAiModel: 'gpt-5.6-sol',
        rawHands: [{
          id: '96890300082',
          rawText: 'raw hand',
          outcome: 'WON',
          heroWinnings: 24.67,
          netProfit: 12.34,
          handRanking: 'FULL_HOUSE',
        }],
      },
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware({
      serializableCheck: false,
    }),
  });
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      model: { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
      analysis,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const result = await store.dispatch(analyzeHandWithAI({ handId: '96890300082' }));
    assert.equal(result.type, analyzeHandWithAI.fulfilled.type);
    assert.equal(requestBody.modelId, 'gpt-5.6-sol');
    const history = store.getState().poker.aiAnalyses['96890300082'];
    assert.equal(history.length, 1);
    assert.equal(history[0].model.id, 'gpt-5.6-sol');
    assert.match(history[0].reportId, /\S+/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('analiza sesji zapisuje historię pod ID z odpowiedzi, mimo zmiany zaznaczenia', async () => {
  const initialState = pokerReducer(undefined, { type: '@@init' });
  const hands = [
    { id: '1', timestamp: 1, netProfit: 1, outcome: 'WON', heroWinnings: 2, heroInvestment: 1, handRanking: 'PAIR', streets: [] },
    { id: '2', timestamp: 2, netProfit: -4, outcome: 'LOST', heroWinnings: 0, heroInvestment: 4, handRanking: 'PAIR', streets: [] },
  ];
  const store = configureStore({
    reducer: { poker: pokerReducer },
    preloadedState: { poker: { ...initialState, selectedSessionId: 'other-session', defaultAiModel: 'gpt-5.6-sol' } },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware({ serializableCheck: false }),
  });
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      model: { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
      sessionId: 'session-a',
      fingerprint: requestBody.session.fingerprint,
      analysis: {
        profileStyleId: 'INSUFFICIENT',
        sessionSummary: 'Próba jest krótka. Wnioski są ostrożne.',
        keyMistakes: [],
        notableHands: [{ handId: '2', reason: 'Największy swing.' }],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await store.dispatch(analyzeSessionWithAI({ sessionId: 'session-a', hands, gameType: 'cash' }));
    assert.equal(result.type, analyzeSessionWithAI.fulfilled.type);
    assert.equal(requestBody.modelId, 'gpt-5.6-sol');
    const history = store.getState().poker.sessionAiAnalyses['session-a'];
    assert.equal(history.length, 1);
    assert.equal(store.getState().poker.sessionAiAnalyses['other-session'], undefined);
    assert.equal(history[0].fingerprint, requestBody.session.fingerprint);
    assert.equal(JSON.parse(storage.getItem(SESSION_AI_ANALYSES_CACHE_KEY))['session-a'].length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('niepełna analiza sesji przekazuje kod błędu i nie zapisuje raportu ani cache', async () => {
  storage.removeItem(SESSION_AI_ANALYSES_CACHE_KEY);
  const initialState = pokerReducer(undefined, { type: '@@init' });
  const hands = [
    { id: '1', timestamp: 1, netProfit: 1, outcome: 'WON', heroWinnings: 2, heroInvestment: 1, handRanking: 'PAIR', streets: [] },
    { id: '2', timestamp: 2, netProfit: -4, outcome: 'LOST', heroWinnings: 0, heroInvestment: 4, handRanking: 'PAIR', streets: [] },
  ];
  const store = configureStore({
    reducer: { poker: pokerReducer },
    preloadedState: { poker: { ...initialState, defaultAiModel: 'gpt-5.6-terra' } },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware({ serializableCheck: false }),
  });
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({
      error: 'OpenAI wykorzystał cały budżet odpowiedzi; raport nie został zapisany.',
      code: 'AI_INCOMPLETE_RESPONSE',
    }), { status: 422, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const result = await store.dispatch(analyzeSessionWithAI({ sessionId: 'session-incomplete', hands, gameType: 'cash' }));
    assert.equal(result.type, analyzeSessionWithAI.rejected.type);
    assert.equal(fetchCalls, 1);
    assert.deepEqual(result.payload, {
      message: 'OpenAI wykorzystał cały budżet odpowiedzi; raport nie został zapisany.',
      code: 'AI_INCOMPLETE_RESPONSE',
    });
    const state = store.getState().poker;
    assert.equal(state.sessionAnalysisStatusById['session-incomplete'], 'failed');
    assert.deepEqual(state.sessionAnalysisErrorById['session-incomplete'], {
      message: 'OpenAI wykorzystał cały budżet odpowiedzi; raport nie został zapisany.',
      code: 'AI_INCOMPLETE_RESPONSE',
    });
    assert.equal(state.sessionAiAnalyses['session-incomplete'], undefined);
    assert.equal(storage.getItem(SESSION_AI_ANALYSES_CACHE_KEY), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('błąd analizy sesji bez kodu API zachowuje komunikat dla starszego serwera', async () => {
  const initialState = pokerReducer(undefined, { type: '@@init' });
  const hands = [
    { id: '1', timestamp: 1, netProfit: 1, outcome: 'WON', heroWinnings: 2, heroInvestment: 1, handRanking: 'PAIR', streets: [] },
  ];
  const store = configureStore({
    reducer: { poker: pokerReducer },
    preloadedState: { poker: initialState },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware({ serializableCheck: false }),
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: 'Serwer odrzucił dane sesji.',
  }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  try {
    const result = await store.dispatch(analyzeSessionWithAI({ sessionId: 'session-legacy-error', hands, gameType: 'cash' }));
    assert.equal(result.type, analyzeSessionWithAI.rejected.type);
    assert.equal(result.payload.message, 'Serwer odrzucił dane sesji.');
    assert.equal(result.payload.code, undefined);
    assert.deepEqual(store.getState().poker.sessionAnalysisErrorById['session-legacy-error'], {
      message: 'Serwer odrzucił dane sesji.',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('cache raportów sesji jest niezależny i clearData go usuwa', () => {
  const sessionStorage = new MemoryStorage({
    [SESSION_AI_ANALYSES_CACHE_KEY]: JSON.stringify({ session: [{ reportId: 'old-report' }] }),
  });
  assert.deepEqual(loadSessionAiAnalyses(sessionStorage), { session: [{ reportId: 'old-report' }] });
  let state = pokerReducer(undefined, { type: '@@init' });
  state = pokerReducer(state, analyzeSessionWithAI.fulfilled({
    sessionId: 'session', reportId: 'report-1', model: { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
    analyzedAt: '2026-08-08T10:00:00.000Z', handCount: 2, fingerprint: 'fingerprint', analysis: {},
  }, 'request-session', { sessionId: 'session' }));
  state = pokerReducer(state, clearData());
  assert.deepEqual(state.sessionAiAnalyses, {});
  assert.equal(storage.getItem(SESSION_AI_ANALYSES_CACHE_KEY), null);
});
