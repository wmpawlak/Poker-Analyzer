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
  analyzeHandWithAI,
  default: pokerReducer,
  loadAiAnalyses,
  loadDefaultAiModel,
  loadSavedHandIds,
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
