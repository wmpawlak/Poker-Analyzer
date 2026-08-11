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
  PLAYER_AI_ANALYSES_CACHE_KEY,
  analyzePlayerWithAI,
  fetchPlayerAnalysisPreview,
  loadPlayerAiAnalyses,
  selectSession,
  setPlayerAnalysisReportSelection,
  setSessionAnalysisReportSelection,
  default: pokerReducer,
} = await import('../src/store/pokerSlice.js');

const preview = {
  datasetRevision: 'revision-player',
  criteria: { gameType: 'cash', dateFrom: '2026-08-01', dateTo: '2026-08-02' },
  actualDateRange: { from: '2026-08-01', to: '2026-08-02' },
  handCount: 30,
  sessionCount: 2,
  cashHandCount: 30,
  tournamentHandCount: 0,
  metrics: {
    shared: { hands: 30 },
    cash: { hands: 30, totalProfit: 1, winrate: { value: 3, unit: 'BB/100' } },
  },
  profileStyleId: 'MIXED',
  profileStyle: { id: 'MIXED', label: 'Mieszany' },
  reliabilityId: 'PRELIMINARY',
  reliability: { id: 'PRELIMINARY', label: 'Wstępny profil' },
  metricCatalog: {
    'shared.hands': { id: 'shared.hands', label: 'Liczba rąk', value: 30 },
  },
  sessionEvidence: {
    coverage: { sessionsInPeriod: 2, availableReports: 1, usedReports: 1 },
  },
  canAnalyze: true,
  warning: 'Wstępny profil.',
};

const analysisResponse = {
  ...preview,
  model: { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
  fingerprint: 'fnv1a-player',
  sessionEvidence: {
    ...preview.sessionEvidence,
    reports: [{
      sourceId: 'cash:session-1:session-report-1',
      type: 'cash',
      sessionId: 'session-1',
      reportId: 'session-report-1',
      summary: 'Raport sesji.',
      leaks: [],
    }],
  },
  analysis: {
    profileStyleId: 'MIXED',
    reliabilityId: 'PRELIMINARY',
    summary: 'Raport gracza.',
  },
};

const createStore = ({ datasetRevision = 'revision-player' } = {}) => {
  const base = pokerReducer(undefined, { type: '@@init' });
  return configureStore({
    reducer: { poker: pokerReducer },
    preloadedState: {
      poker: {
        ...base,
        dataset: { ...base.dataset, datasetRevision, status: 'succeeded' },
        defaultAiModel: 'gpt-5.6-terra',
        playerAiAnalyses: [],
      },
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware({ serializableCheck: false }),
  });
};

test('stary localStorage gracza jest migrowany do historii z reportId', () => {
  const legacyStorage = new MemoryStorage({
    [PLAYER_AI_ANALYSES_CACHE_KEY]: JSON.stringify([{ analysis: { summary: 'Stary raport.' } }]),
  });
  const reports = loadPlayerAiAnalyses(legacyStorage);

  assert.equal(reports.length, 1);
  assert.equal(reports[0].reportId, 'legacy-player-v1-1');
  assert.equal(JSON.parse(legacyStorage.getItem(PLAYER_AI_ANALYSES_CACHE_KEY))[0].reportId, 'legacy-player-v1-1');
});

test('dokładny raport sesji jest kontrolowany przez Redux, a ręczny wybór wraca do najnowszego', () => {
  const store = createStore();

  store.dispatch(selectSession('session-1'));
  store.dispatch(setSessionAnalysisReportSelection({ sessionId: 'session-1', reportId: 'historical-report' }));
  assert.equal(
    store.getState().poker.selectedSessionAnalysisReportIdBySessionId['session-1'],
    'historical-report',
  );

  store.dispatch(selectSession('session-1'));
  assert.equal(
    store.getState().poker.selectedSessionAnalysisReportIdBySessionId['session-1'],
    undefined,
  );
});

test('preview trafia do stanu dla dokładnych kryteriów profilu', async () => {
  const store = createStore();
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify(preview), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const result = await store.dispatch(fetchPlayerAnalysisPreview({
      gameType: 'cash',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-02',
    }));

    assert.equal(result.type, fetchPlayerAnalysisPreview.fulfilled.type);
    assert.match(requestedUrl, /^\/api\/player-analysis\/preview\?/);
    assert.match(requestedUrl, /gameType=cash/);
    assert.equal(store.getState().poker.playerAnalysisPreview.status, 'succeeded');
    assert.equal(store.getState().poker.playerAnalysisPreview.data.handCount, 30);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('pierwszy preview jest przyjmowany przed poznaniem rewizji datasetu', async () => {
  const store = createStore({ datasetRevision: null });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(preview), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  try {
    await store.dispatch(fetchPlayerAnalysisPreview({ gameType: 'cash' }));

    const state = store.getState().poker;
    assert.equal(state.playerAnalysisPreview.status, 'succeeded');
    assert.equal(state.playerAnalysisPreview.data.datasetRevision, 'revision-player');
    assert.equal(state.dataset.datasetRevision, 'revision-player');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('każda analiza wykonuje jedno żądanie, dopisuje historię i wybiera nowy raport', async () => {
  storage.removeItem(PLAYER_AI_ANALYSES_CACHE_KEY);
  const store = createStore();
  const originalFetch = globalThis.fetch;
  const requestBodies = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/ai/analyze-player');
    requestBodies.push(JSON.parse(options.body));
    return new Response(JSON.stringify(analysisResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const params = { gameType: 'cash', dateFrom: '2026-08-01', dateTo: '2026-08-02' };
    const first = await store.dispatch(analyzePlayerWithAI(params));
    const second = await store.dispatch(analyzePlayerWithAI(params));
    const state = store.getState().poker;

    assert.equal(first.type, analyzePlayerWithAI.fulfilled.type);
    assert.equal(second.type, analyzePlayerWithAI.fulfilled.type);
    assert.equal(requestBodies.length, 2);
    assert.deepEqual(requestBodies[0], {
      modelId: 'gpt-5.6-terra',
      gameType: 'cash',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-02',
      datasetRevision: 'revision-player',
    });
    assert.equal(Object.hasOwn(requestBodies[0], 'metrics'), false);
    assert.equal(state.playerAiAnalyses.length, 2);
    assert.notEqual(state.playerAiAnalyses[0].reportId, state.playerAiAnalyses[1].reportId);
    assert.equal(state.selectedPlayerAnalysisReportId, state.playerAiAnalyses[1].reportId);
    assert.equal(state.playerAiAnalyses[1].snapshot.metrics.shared.hands, 30);
    assert.equal(state.playerAiAnalyses[1].sourceCoverage.usedReports, 1);
    assert.equal(JSON.parse(storage.getItem(PLAYER_AI_ANALYSES_CACHE_KEY)).length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('błąd nie usuwa historii, a kontrolowany wybór raportu pozostaje w Redux', async () => {
  const store = createStore();
  store.dispatch({
    type: analyzePlayerWithAI.fulfilled.type,
    payload: { reportId: 'existing', analyzedAt: '2026-08-01', analysis: {} },
  });
  store.dispatch(setPlayerAnalysisReportSelection('existing'));
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      error: 'Model zwrócił niepełny raport.',
      code: 'AI_INVALID_PLAYER_RESPONSE',
    }), { status: 422, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await store.dispatch(analyzePlayerWithAI({ gameType: 'cash' }));
    const state = store.getState().poker;

    assert.equal(result.type, analyzePlayerWithAI.rejected.type);
    assert.equal(calls, 1);
    assert.equal(state.playerAiAnalyses.length, 1);
    assert.equal(state.selectedPlayerAnalysisReportId, 'existing');
    assert.deepEqual(state.playerAnalysisError, {
      message: 'Model zwrócił niepełny raport.',
      code: 'AI_INVALID_PLAYER_RESPONSE',
      status: 422,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
