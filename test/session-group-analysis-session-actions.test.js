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
const { analyzeSessionWithAI } = pokerModule;

const summary = (id, fingerprint) => ({ id, type: 'Cash', tableId: id, startTime: 1_770_000_000_000, dateStr: '2026-02-01', handCount: 12, fingerprint });

test('lista sesji pokazuje status raportu na podstawie lekkich podsumowań', async (context) => {
  const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
  context.after(() => vite.close());
  const base = pokerReducer(undefined, { type: '@@init' });
  const current = summary('current', 'fingerprint-current');
  const missing = summary('missing', 'fingerprint-missing');
  const loading = summary('loading', 'fingerprint-loading');
  const failed = summary('failed', 'fingerprint-failed');
  const store = configureStore({
    reducer: { poker: pokerReducer },
    preloadedState: { poker: {
      ...base,
      dataset: { ...base.dataset, datasetRevision: 'revision-1' },
      currentPages: {
        cash: { items: [current, missing, loading, failed], status: 'succeeded', error: null, datasetRevision: 'revision-1' },
        tournament: { items: [], status: 'succeeded', error: null, datasetRevision: 'revision-1' },
      },
      sessionAiAnalyses: { [current.id]: [{ reportId: 'current-report', fingerprint: current.fingerprint, datasetRevision: 'revision-1' }] },
      sessionAnalysisStatusById: { [loading.id]: 'loading', [failed.id]: 'failed' },
      sessionAnalysisErrorById: { [failed.id]: { message: 'Niepełna odpowiedź.', code: 'AI_INCOMPLETE_RESPONSE' } },
    } },
  });
  const { SessionGroupAnalysisView } = await vite.ssrLoadModule('/src/components/SessionGroupAnalysisView.jsx');
  const html = renderToStaticMarkup(createElement(Provider, { store }, createElement(SessionGroupAnalysisView, {
    gameType: 'both', selectedSourceIds: [], onSelectedSourceIdsChange: () => {}, onSelectedReportIdChange: () => {},
  })));
  assert.match(html, /raport aktualny/);
  assert.match(html, /brak aktualnego raportu/);
  assert.match(html, /Analizowanie/);
  assert.match(html, /Niepełna odpowiedź/);
  assert.match(html, /aria-label="Zaznacz sesję: Stół current"/);
  assert.match(html, /aria-label="Zaznacz widoczne sesje"/);
  assert.match(html, /aria-label="Uruchom analizę wybranych sesji"/);
  assert.match(html, /lucide-square/);
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
