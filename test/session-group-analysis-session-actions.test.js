import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { Provider } from 'react-redux';
import { renderToStaticMarkup } from 'react-dom/server';
import { configureStore } from '@reduxjs/toolkit';
import { createServer } from 'vite';
import { buildSessionAnalysisInput } from '../src/ai/sessionAnalysisContract.js';

class MemoryStorage {
  getItem() { return null; }
  setItem() {}
  removeItem() {}
}
globalThis.localStorage = new MemoryStorage();

let pokerReducer;
let analyzeSessionWithAI;
const loadPokerStore = async () => {
  if (pokerReducer) return;
  const pokerModule = await import('../src/store/pokerSlice.js');
  pokerReducer = pokerModule.default;
  analyzeSessionWithAI = pokerModule.analyzeSessionWithAI;
};

const makeHand = (id, timestamp) => ({
  id,
  timestamp,
  position: 'BTN',
  smallBlind: 0.05,
  bigBlind: 0.1,
  heroStartingStack: 10,
  heroCards: ['As', 'Kd'],
  boardCards: [],
  outcome: 'WON',
  heroInvestment: 1,
  heroWinnings: 2,
  netProfit: 1,
  handRanking: 'PAIR',
  streets: [],
});

const makeSession = (id, timestamp) => ({
  id,
  tableId: `table-${id}`,
  startTime: timestamp,
  dateStr: '2026-08-08 12:00:00',
  hands: [makeHand(`${id}-1`, timestamp), makeHand(`${id}-2`, timestamp + 1)],
});

const makeReport = (session, fingerprint) => ({
  reportId: `report-${session.id}`,
  fingerprint,
  model: { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
  analyzedAt: '2026-08-08T12:00:00.000Z',
  analysis: {
    profileStyleId: 'INSUFFICIENT',
    sessionSummary: 'Pierwsze zdanie. Drugie zdanie.',
    keyMistakes: [],
    notableHands: [{ handId: `${session.id}-1`, reason: 'NajwiÄ™kszy swing.' }],
  },
});

test('lista sesji pokazuje aktualny, brakujÄ…cy, nieaktualny, loading i bĹ‚Ä…d w odpowiednich wierszach', async (context) => {
  await loadPokerStore();
  const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
  context.after(() => vite.close());
  const current = makeSession('current', 1000);
  const missing = makeSession('missing', 2000);
  const stale = makeSession('stale', 3000);
  const loading = makeSession('loading', 4000);
  const failed = makeSession('failed', 5000);
  const currentFingerprint = buildSessionAnalysisInput({ sessionId: current.id, hands: current.hands, gameType: 'cash' }).fingerprint;
  const staleFingerprint = buildSessionAnalysisInput({ sessionId: stale.id, hands: stale.hands, gameType: 'cash' }).fingerprint;
  const baseState = pokerReducer(undefined, { type: '@@init' });
  const store = configureStore({
    reducer: { poker: pokerReducer },
    preloadedState: {
      poker: {
        ...baseState,
        sessions: [current, missing, stale, loading, failed],
        sessionAiAnalyses: {
          [current.id]: [makeReport(current, currentFingerprint)],
          [stale.id]: [makeReport(stale, `${staleFingerprint}-old`)],
        },
        sessionAnalysisStatusById: { [loading.id]: 'loading', [failed.id]: 'failed' },
        sessionAnalysisErrorById: {
          [failed.id]: { message: 'NiepeĹ‚na odpowiedĹş.', code: 'AI_INCOMPLETE_RESPONSE' },
        },
        aiModelsStatus: 'succeeded',
        aiModels: [{ id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', configured: true }],
      },
    },
  });
  const { SessionGroupAnalysisView } = await vite.ssrLoadModule('/src/components/SessionGroupAnalysisView.jsx');
  const html = renderToStaticMarkup(createElement(Provider, { store }, createElement(SessionGroupAnalysisView, {
    gameType: 'both',
    selectedSourceIds: [],
    onSelectedSourceIdsChange: () => {},
    onSelectedReportIdChange: () => {},
  })));

  assert.match(html, /Raport aktualny/);
  assert.match(html, /role="checkbox"/);
  assert.doesNotMatch(html, /type="checkbox"/);
  assert.match(html, /Brak raportu/);
  assert.match(html, /Analiza nieaktualna/);
  assert.match(html, /Analizowanie/);
  assert.match(html, /NiepeĹ‚na odpowiedĹş/);
  assert.match(html, /Analizuj ponownie/);
  assert.match(html, /nowe/);
  assert.doesNotMatch(html, /checked=""/);
});

test('dwie rĂłĹĽne analizy sesji startujÄ… rĂłwnolegle wyĹ‚Ä…cznie przez zamockowany fetch', async () => {
  await loadPokerStore();
  const first = makeSession('first', 1000);
  const second = makeSession('second', 2000);
  const baseState = pokerReducer(undefined, { type: '@@init' });
  const store = configureStore({
    reducer: { poker: pokerReducer },
    preloadedState: {
      poker: {
        ...baseState,
        aiModels: [{ id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', configured: true }],
        aiModelsStatus: 'succeeded',
      },
    },
  });
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    calls.push(request);
    return {
      ok: true,
      json: async () => ({
        model: { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
        sessionId: request.session.sessionId,
        fingerprint: request.session.fingerprint,
        analysis: {},
      }),
    };
  };
  try {
    await Promise.all([
      store.dispatch(analyzeSessionWithAI({ sessionId: first.id, hands: first.hands, gameType: 'cash' })),
      store.dispatch(analyzeSessionWithAI({ sessionId: second.id, hands: second.hands, gameType: 'cash' })),
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const state = store.getState().poker;
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((request) => request.session.sessionId).sort(), ['first', 'second']);
  assert.equal(state.sessionAnalysisStatusById.first, 'succeeded');
  assert.equal(state.sessionAnalysisStatusById.second, 'succeeded');
  assert.equal(state.sessionAiAnalyses.first.length, 1);
  assert.equal(state.sessionAiAnalyses.second.length, 1);
});
