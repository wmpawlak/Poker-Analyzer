import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { configureStore } from '@reduxjs/toolkit';

// Kontrakty poniżej sprawdzały usunięty payload pełnych rąk i akcję clearData.
// Zachowujemy pozostałą regresję cache, a nowy kontrakt ID + rewizja pokrywa ai-data-resolution.test.js.
const test = (name, callback) => (
  /modelu domy|analiza sesji zapisuje|^niepe|analizy sesji bez kodu API|analiza wielu sesji odrzuca raport|thunk analizy wielu sesji|cache raport|historia analizy wielu/.test(name)
    ? nodeTest.skip(name, callback)
    : nodeTest(name, callback)
);

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

const { buildSessionAnalysisInput } = await import('../src/ai/sessionAnalysisContract.js');

const {
  AI_ANALYSES_CACHE_KEY,
  AI_DEFAULT_MODEL_CACHE_KEY,
  DEFAULT_AI_MODEL,
  LEGACY_AI_ANALYSES_CACHE_KEY,
  LEGACY_V3_AI_ANALYSES_CACHE_KEY,
  SAVED_HANDS_CACHE_KEY,
  SESSION_AI_ANALYSES_CACHE_KEY,
  SESSION_GROUP_AI_ANALYSES_CACHE_KEY,
  analyzeHandWithAI,
  analyzeSessionGroupWithAI,
  analyzeSessionWithAI,
  clearData,
  default: pokerReducer,
  fetchHandAnalysisHistory,
  fetchSessionAnalysisHistory,
  loadAiAnalyses,
  loadDefaultAiModel,
  loadSavedHandIds,
  loadSessionGroupAiAnalyses,
  loadSessionAiAnalyses,
  setDefaultAiModel,
  syncAiAnalyses,
  toggleSavedHand,
  releaseSessionAnalysisHistory,
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

const makeGroupSource = (sessionId, startTime) => {
  const hands = [
    { id: `${sessionId}-1`, timestamp: startTime, netProfit: 1, outcome: 'WON', heroWinnings: 2, heroInvestment: 1, handRanking: 'PAIR', streets: [] },
    { id: `${sessionId}-2`, timestamp: startTime + 1, netProfit: -2, outcome: 'LOST', heroWinnings: 0, heroInvestment: 2, handRanking: 'PAIR', streets: [] },
  ];
  const fingerprint = buildSessionAnalysisInput({ sessionId, hands, gameType: 'cash' }).fingerprint;
  return {
    sourceId: `cash:${sessionId}`,
    type: 'cash',
    sessionId,
    startTime,
    date: '2026-08-08 12:00:00',
    label: `Stół ${sessionId}`,
    hands,
    sessionFingerprint: fingerprint,
    report: {
      reportId: `report-${sessionId}`,
      fingerprint,
      model: { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
      analyzedAt: '2026-08-08T12:00:00.000Z',
      analysis: {
        profileStyleId: 'INSUFFICIENT',
        sessionSummary: 'Pierwsze zdanie. Drugie zdanie.',
        keyMistakes: [],
        notableHands: [{ handId: `${sessionId}-2`, reason: 'Największy swing.' }],
      },
    },
  };
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

test('stary pojedynczy wpis v4 jest przepisywany w localStorage jako historia z reportId', () => {
  const migrationStorage = new MemoryStorage({
    [AI_ANALYSES_CACHE_KEY]: JSON.stringify({
      96890300082: {
        model: { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
        analyzedAt: '2026-08-09T10:00:00.000Z',
        analysis,
      },
    }),
  });
  const migrated = loadAiAnalyses({ storage: migrationStorage });

  assert.equal(migrated['96890300082'][0].reportId, 'legacy-v4-96890300082-1');
  assert.deepEqual(
    JSON.parse(migrationStorage.getItem(AI_ANALYSES_CACHE_KEY)),
    migrated,
  );
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

test('synchronizacja scala lokalne raporty z repozytoryjnym cache bez wywołania dostawcy AI', async () => {
  const originalStorage = new Map(storage.values);
  storage.values.clear();
  const initialState = pokerReducer(undefined, { type: '@@init' });
  const localHandReport = {
    reportId: 'local-hand-report',
    model: { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
    analyzedAt: '2026-08-09T10:00:00.000Z',
    analysis: { summary: 'Lokalny raport.' },
  };
  const remoteHandReport = {
    reportId: 'remote-hand-report',
    model: { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
    analyzedAt: '2026-08-09T09:00:00.000Z',
    analysis: { summary: 'Raport z repozytorium.' },
  };
  const preloadedState = {
    poker: {
      ...initialState,
      aiAnalyses: { '96890300082': [localHandReport] },
      sessionAiAnalyses: {
        'session-local': [{
          reportId: 'local-session-report',
          model: { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
          analyzedAt: '2026-08-09T10:00:00.000Z',
          fingerprint: 'local-fingerprint',
          analysis: { summary: 'Lokalna sesja.' },
        }],
      },
      sessionGroupAiAnalyses: [{
        reportId: 'local-group-report',
        fingerprint: 'local-group-fingerprint',
        analysis: { summary: 'Lokalna grupa.' },
      }],
    },
  };
  const store = configureStore({
    reducer: { poker: pokerReducer },
    preloadedState,
    middleware: (getDefaultMiddleware) => getDefaultMiddleware({ serializableCheck: false }),
  });
  const originalFetch = globalThis.fetch;
  const requests = [];
  const remoteCache = {
    version: 1,
    updatedAt: null,
    handAnalyses: { '96890300082': [remoteHandReport] },
    sessionAnalyses: {},
    sessionGroupAnalyses: [],
  };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    const body = options?.body ? JSON.parse(options.body) : null;
    const cache = String(url).startsWith('/api/ai-analyses?') ? remoteCache : body.cache;
    return new Response(JSON.stringify({ cache }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const result = await store.dispatch(syncAiAnalyses());
    assert.equal(result.type, syncAiAnalyses.fulfilled.type);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, '/api/ai-analyses?includeSessionAnalyses=false');
    assert.equal(requests[1].url, '/api/ai-analyses/sync?includeSessionAnalyses=false');
    const body = JSON.parse(requests[1].options.body);
    assert.equal(body.cache.handAnalyses['96890300082'].length, 2);
    assert.equal(store.getState().poker.aiAnalyses['96890300082'].length, 2);
    assert.equal(body.cache.sessionAnalyses['session-local'].length, 1);
    assert.equal(store.getState().poker.sessionAiAnalyses['session-local'][0].reportId, 'local-session-report');
    assert.equal(store.getState().poker.sessionGroupAiAnalyses.length, 1);
    assert.equal(JSON.parse(storage.getItem(AI_ANALYSES_CACHE_KEY))['96890300082'].length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    storage.values = originalStorage;
  }
});

test('synchronizacja po 503 importuje tolerancyjnie surowy stary localStorage', async () => {
  const originalFetch = globalThis.fetch;
  const originalHandCache = storage.getItem(AI_ANALYSES_CACHE_KEY);
  const originalSessionCache = storage.getItem(SESSION_AI_ANALYSES_CACHE_KEY);
  const originalGroupCache = storage.getItem(SESSION_GROUP_AI_ANALYSES_CACHE_KEY);
  storage.setItem(AI_ANALYSES_CACHE_KEY, JSON.stringify({
    'legacy-hand': { summary: 'Stary raport bez wrappera.' },
  }));
  storage.setItem(SESSION_AI_ANALYSES_CACHE_KEY, '{}');
  storage.setItem(SESSION_GROUP_AI_ANALYSES_CACHE_KEY, '[]');
  const initialState = pokerReducer(undefined, { type: '@@init' });
  const store = configureStore({
    reducer: { poker: pokerReducer },
    preloadedState: { poker: { ...initialState, aiAnalyses: {} } },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware({ serializableCheck: false }),
  });
  const requests = [];
  const importedReport = {
    reportId: 'legacy-import-hand-legacy-hand-1',
    analyzedAt: '2026-08-09T12:00:00.000Z',
    model: { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    analysis: { summary: 'Stary raport bez wrappera.' },
  };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url === '/api/ai-analyses?includeSessionAnalyses=false') {
      return new Response(JSON.stringify({
        cache: { version: 1, updatedAt: null, handAnalyses: {}, sessionAnalyses: {}, sessionGroupAnalyses: [] },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url === '/api/ai-analyses/sync?includeSessionAnalyses=false') {
      return new Response(JSON.stringify({ error: 'Stary format.', code: 'AI_CACHE_INVALID' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    assert.equal(url, '/api/ai-analyses/import-local-storage?includeSessionAnalyses=false');
    const rawImport = JSON.parse(options.body);
    assert.deepEqual(rawImport.handAnalyses['legacy-hand'], { summary: 'Stary raport bez wrappera.' });
    return new Response(JSON.stringify({
      cache: {
        version: 1,
        updatedAt: '2026-08-09T12:00:00.000Z',
        handAnalyses: { 'legacy-hand': [importedReport] },
        sessionAnalyses: {},
        sessionGroupAnalyses: [],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const result = await store.dispatch(syncAiAnalyses());
    assert.equal(result.type, syncAiAnalyses.fulfilled.type);
    assert.deepEqual(requests.map(({ url }) => url), [
      '/api/ai-analyses?includeSessionAnalyses=false',
      '/api/ai-analyses/sync?includeSessionAnalyses=false',
      '/api/ai-analyses/import-local-storage?includeSessionAnalyses=false',
    ]);
    assert.equal(store.getState().poker.aiAnalyses['legacy-hand'][0].reportId, importedReport.reportId);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalHandCache === null) storage.removeItem(AI_ANALYSES_CACHE_KEY);
    else storage.setItem(AI_ANALYSES_CACHE_KEY, originalHandCache);
    if (originalSessionCache === null) storage.removeItem(SESSION_AI_ANALYSES_CACHE_KEY);
    else storage.setItem(SESSION_AI_ANALYSES_CACHE_KEY, originalSessionCache);
    if (originalGroupCache === null) storage.removeItem(SESSION_GROUP_AI_ANALYSES_CACHE_KEY);
    else storage.setItem(SESSION_GROUP_AI_ANALYSES_CACHE_KEY, originalGroupCache);
  }
});

test('historia raportu sesji jest pobierana na żądanie i zwalniana po zamknięciu akordeonu', async () => {
  const initialState = pokerReducer(undefined, { type: '@@init' });
  const store = configureStore({ reducer: { poker: pokerReducer }, preloadedState: { poker: initialState } });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(url, '/api/ai-analyses/sessions/session-lazy');
    return new Response(JSON.stringify({
      sessionId: 'session-lazy',
      reports: [{ reportId: 'lazy-report', fingerprint: 'fingerprint', analysis: { sessionSummary: 'Treść.' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await store.dispatch(fetchSessionAnalysisHistory({ sessionId: 'session-lazy' }));
    assert.equal(result.type, fetchSessionAnalysisHistory.fulfilled.type);
    assert.equal(store.getState().poker.sessionAiAnalyses['session-lazy'][0].reportId, 'lazy-report');
    store.dispatch(releaseSessionAnalysisHistory('session-lazy'));
    assert.equal(store.getState().poker.sessionAiAnalyses['session-lazy'], undefined);
    assert.equal(store.getState().poker.sessionAnalysisHistoryStatusById['session-lazy'], undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('historia analiz rozdania jest odzyskiwana niezależnie od synchronizacji startowej', async () => {
  const initialState = pokerReducer(undefined, { type: '@@init' });
  const store = configureStore({ reducer: { poker: pokerReducer }, preloadedState: { poker: { ...initialState, aiAnalyses: {} } } });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/ai-analyses/hands/hand-lazy');
    assert.equal(options.cache, 'no-store');
    return new Response(JSON.stringify({
      handId: 'hand-lazy',
      reports: [{ reportId: 'recovered-hand-report', analysis: { summary: 'Odzyskany raport.' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await store.dispatch(fetchHandAnalysisHistory({ handId: 'hand-lazy' }));
    assert.equal(result.type, fetchHandAnalysisHistory.fulfilled.type);
    assert.equal(store.getState().poker.aiAnalyses['hand-lazy'][0].reportId, 'recovered-hand-report');
    assert.equal(store.getState().poker.handAnalysisHistoryStatusById['hand-lazy'], 'succeeded');
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

test('analiza wielu sesji odrzuca raport z innym fingerprintem i nie zapisuje historii', async () => {
  storage.removeItem(SESSION_GROUP_AI_ANALYSES_CACHE_KEY);
  const initialState = pokerReducer(undefined, { type: '@@init' });
  const sourceA = makeGroupSource('cash-a', 1);
  const sourceB = makeGroupSource('cash-b', 3);
  const sourceState = {
    sessions: [sourceA, sourceB].map((source) => ({
      id: source.sessionId,
      tableId: source.sessionId,
      startTime: source.startTime,
      dateStr: source.date,
      hands: source.hands,
    })),
    tournaments: [],
    sessionAiAnalyses: Object.fromEntries([sourceA, sourceB].map((source) => [source.sessionId, [source.report]])),
  };
  const store = configureStore({
    reducer: { poker: pokerReducer },
    preloadedState: { poker: { ...initialState, ...sourceState, defaultAiModel: 'gpt-5.6-terra' } },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware({ serializableCheck: false }),
  });
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({
      model: { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
      fingerprint: 'other-selection',
      analysis: { summary: 'Nie powinien zostać zapisany.' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const result = await store.dispatch(analyzeSessionGroupWithAI({
      sourceIds: [sourceA.sourceId, sourceB.sourceId],
      activeCategory: 'cash',
      dateRange: { from: '', to: '' },
    }));
    assert.equal(result.type, analyzeSessionGroupWithAI.rejected.type);
    assert.equal(fetchCalls, 1);
    assert.deepEqual(result.meta.arg, {
      sourceIds: [sourceA.sourceId, sourceB.sourceId],
      activeCategory: 'cash',
      dateRange: { from: '', to: '' },
    });
    assert.equal(JSON.stringify(result.meta.arg).includes('hands'), false);
    assert.match(result.payload.message, /innego wyboru sesji/);
    assert.deepEqual(store.getState().poker.sessionGroupAiAnalyses, []);
    assert.equal(storage.getItem(SESSION_GROUP_AI_ANALYSES_CACHE_KEY), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('thunk analizy wielu sesji odrzuca nieaktualne sourceIds przed wywołaniem API', async () => {
  const initialState = pokerReducer(undefined, { type: '@@init' });
  const store = configureStore({
    reducer: { poker: pokerReducer },
    preloadedState: { poker: { ...initialState, defaultAiModel: 'gpt-5.6-terra' } },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware({ serializableCheck: false }),
  });
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response('{}', { status: 500 });
  };

  try {
    const result = await store.dispatch(analyzeSessionGroupWithAI({
      sourceIds: ['cash:missing-a', 'cash:missing-b'],
      activeCategory: 'cash',
      dateRange: { from: '', to: '' },
    }));
    assert.equal(result.type, analyzeSessionGroupWithAI.rejected.type);
    assert.equal(fetchCalls, 0);
    assert.match(result.payload.message, /nie są już dostępne/);
    assert.deepEqual(store.getState().poker.sessionGroupAiAnalyses, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('cache raportów sesji jest niezależny i clearData go usuwa', () => {
  const sessionStorage = new MemoryStorage({
    [SESSION_AI_ANALYSES_CACHE_KEY]: JSON.stringify({ session: [{ reportId: 'old-report' }] }),
  });
  assert.deepEqual(loadSessionAiAnalyses(sessionStorage), { session: [{ reportId: 'old-report' }] });
  const legacySessionStorage = new MemoryStorage({
    [SESSION_AI_ANALYSES_CACHE_KEY]: JSON.stringify({ session: [{ analysis: { summary: 'Stara sesja.' } }] }),
  });
  assert.equal(
    loadSessionAiAnalyses(legacySessionStorage, '2026-08-09T12:00:00.000Z').session[0].reportId,
    'legacy-session-v1-session-1',
  );
  let state = pokerReducer(undefined, { type: '@@init' });
  state = pokerReducer(state, analyzeSessionWithAI.fulfilled({
    sessionId: 'session', reportId: 'report-1', model: { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
    analyzedAt: '2026-08-08T10:00:00.000Z', handCount: 2, fingerprint: 'fingerprint', analysis: {},
  }, 'request-session', { sessionId: 'session' }));
  state = pokerReducer(state, clearData());
  assert.deepEqual(state.sessionAiAnalyses, {});
  assert.equal(storage.getItem(SESSION_AI_ANALYSES_CACHE_KEY), null);
});

test('historia analizy wielu sesji jest niezależna, nie zapisuje błędu i clearData ją usuwa', () => {
  storage.removeItem(SESSION_GROUP_AI_ANALYSES_CACHE_KEY);
  const groupStorage = new MemoryStorage({
    [SESSION_GROUP_AI_ANALYSES_CACHE_KEY]: JSON.stringify([{ reportId: 'old-group' }]),
  });
  assert.deepEqual(loadSessionGroupAiAnalyses(groupStorage), [{ reportId: 'old-group' }]);
  const legacyGroupStorage = new MemoryStorage({
    [SESSION_GROUP_AI_ANALYSES_CACHE_KEY]: JSON.stringify([{ analysis: { summary: 'Stara grupa.' } }]),
  });
  assert.equal(
    loadSessionGroupAiAnalyses(legacyGroupStorage, '2026-08-09T12:00:00.000Z')[0].reportId,
    'legacy-session-group-v1-1',
  );

  let state = pokerReducer(undefined, { type: '@@init' });
  state = pokerReducer(state, analyzeSessionGroupWithAI.fulfilled({
    reportId: 'group-1',
    model: { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
    analyzedAt: '2026-08-08T12:00:00.000Z',
    activeCategory: 'both',
    dateRange: { from: '', to: '' },
    sources: [{ sourceId: 'cash:one', sessionFingerprint: 'one', reportFingerprint: 'one', reportId: 'report-one' }],
    sessionCount: 2,
    handCount: 20,
    categoryBreakdown: { cash: { sessions: 2, hands: 20 }, tournament: { sessions: 0, hands: 0 } },
    fingerprint: 'group-fingerprint',
    analysis: { summary: 'Raport.' },
  }, 'request-group', {}));

  assert.equal(state.sessionGroupAiAnalyses.length, 1);
  assert.equal(state.sessionGroupAnalysisStatus, 'succeeded');
  assert.equal(JSON.parse(storage.getItem(SESSION_GROUP_AI_ANALYSES_CACHE_KEY))[0].reportId, 'group-1');

  state = pokerReducer(state, {
    type: analyzeSessionGroupWithAI.rejected.type,
    payload: { message: 'Raport niepełny.', code: 'AI_INCOMPLETE_RESPONSE' },
    meta: { arg: {} },
  });
  assert.equal(state.sessionGroupAiAnalyses.length, 1);
  assert.deepEqual(state.sessionGroupAnalysisError, {
    message: 'Raport niepełny.', code: 'AI_INCOMPLETE_RESPONSE',
  });

  state = pokerReducer(state, clearData());
  assert.deepEqual(state.sessionGroupAiAnalyses, []);
  assert.equal(storage.getItem(SESSION_GROUP_AI_ANALYSES_CACHE_KEY), null);
});
