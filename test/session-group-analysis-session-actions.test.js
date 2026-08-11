import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { Provider } from 'react-redux';
import { renderToStaticMarkup } from 'react-dom/server';
import { configureStore } from '@reduxjs/toolkit';
import { createServer } from 'vite';

class MemoryStorage {
  getItem() { return null; }
  setItem() {}
  removeItem() {}
}
globalThis.localStorage = new MemoryStorage();

const pokerModule = await import('../src/store/pokerSlice.js');
const pokerReducer = pokerModule.default;
const { analyzeSessionWithAI, createSessionMonthsQueryKey } = pokerModule;

const summary = (id, fingerprint) => ({ id, type: 'Cash', tableId: id, startTime: 1_770_000_000_000, dateStr: '2026-02-01', handCount: 12, fingerprint });

test('lista sesji pokazuje akcje zbiorcze i początkowo zwinięty miesiąc', async (context) => {
  const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
  context.after(() => vite.close());
  const base = pokerReducer(undefined, { type: '@@init' });
  const current = summary('current', 'fingerprint-current');
  const missing = summary('missing', 'fingerprint-missing');
  const loading = summary('loading', 'fingerprint-loading');
  const failed = summary('failed', 'fingerprint-failed');
  const sessions = [current, missing, loading, failed];
  const queryKey = createSessionMonthsQueryKey({ gameType: 'both' });
  const store = configureStore({
    reducer: { poker: pokerReducer },
    preloadedState: { poker: {
      ...base,
      dataset: { ...base.dataset, datasetRevision: 'revision-1' },
      sessionMonthIndexes: { [queryKey]: { months: [{ key: '2026-02', year: 2026, month: 2, sessionCount: 4, handCount: 48, cashSessionCount: 4, tournamentSessionCount: 0 }], status: 'succeeded', error: null, allStatus: 'idle', allError: null, datasetRevision: 'revision-1' } },
      sessionMonthPages: { [queryKey]: { '2026-02': { items: sessions, status: 'succeeded', error: null, datasetRevision: 'revision-1' } } },
      sessionSummariesById: Object.fromEntries(sessions.map((session) => [session.id, session])),
      sessionAiAnalyses: { [current.id]: [{ reportId: 'current-report', fingerprint: current.fingerprint, datasetRevision: 'revision-1' }] },
      sessionAnalysisStatusById: { [loading.id]: 'loading', [failed.id]: 'failed' },
      sessionAnalysisErrorById: { [failed.id]: { message: 'Niepełna odpowiedź.', code: 'AI_INCOMPLETE_RESPONSE' } },
    } },
  });
  const { SessionGroupAnalysisView } = await vite.ssrLoadModule('/src/components/SessionGroupAnalysisView.jsx');
  const html = renderToStaticMarkup(createElement(Provider, { store }, createElement(SessionGroupAnalysisView, {
    gameType: 'both', selectedSourceIds: [], onSelectedSourceIdsChange: () => {}, onSelectedReportIdChange: () => {},
  })));
  assert.match(html, /aria-label="Luty 2026, 4 sesji, 48 rozdań"/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /role="region"/);
  assert.doesNotMatch(html, /aria-label="Zaznacz sesję:/);
  assert.match(html, /aria-label="Zaznacz widoczne sesje"/);
  assert.match(html, /aria-label="Uruchom analizę wybranych sesji"/);
  assert.doesNotMatch(html, /type="checkbox"/);
});

test('analizy dwóch sesji wysyłają wyłącznie ID oraz rewizję i mogą działać równolegle', async () => {
  const base = pokerReducer(undefined, { type: '@@init' });
  const store = configureStore({
    reducer: { poker: pokerReducer },
    preloadedState: { poker: { ...base, dataset: { ...base.dataset, datasetRevision: 'revision-1' } } },
  });
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    calls.push(request);
    return new Response(JSON.stringify({
      model: { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' }, sessionId: request.sessionId,
      fingerprint: `fingerprint-${request.sessionId}`, datasetRevision: 'revision-1', analysis: {},
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const results = await Promise.all([
      store.dispatch(analyzeSessionWithAI({ sessionId: 'first' })),
      store.dispatch(analyzeSessionWithAI({ sessionId: 'second' })),
    ]);
    assert.equal(results.every((result) => result.type === analyzeSessionWithAI.fulfilled.type), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(calls.map((request) => request.sessionId).sort(), ['first', 'second']);
  assert.equal(calls.every((request) => request.datasetRevision === 'revision-1' && !Object.hasOwn(request, 'hands')), true);
  assert.equal(store.getState().poker.sessionAiAnalyses.first.length, 1);
  assert.equal(store.getState().poker.sessionAiAnalyses.second.length, 1);
});
