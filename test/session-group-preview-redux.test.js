import test from 'node:test';
import assert from 'node:assert/strict';
import { configureStore } from '@reduxjs/toolkit';
import pokerReducer, { fetchSessionGroupPreview } from '../src/store/pokerSlice.js';

class MemoryStorage {
  getItem() { return null; }
  setItem() {}
  removeItem() {}
}
globalThis.localStorage = new MemoryStorage();

const preview = {
  datasetRevision: 'revision-1',
  activeCategory: 'cash',
  dateRange: { from: '2026-08-01', to: '2026-08-01' },
  sources: [{ sourceId: 'cash:a', type: 'cash', sessionId: 'cash:a', metadata: { handCount: 2 } }],
  sessionCount: 1,
  handCount: 2,
  categoryBreakdown: { cash: { sessionCount: 1, handCount: 2 }, tournament: { sessionCount: 0, handCount: 0 } },
  metrics: { shared: { hands: 2 } },
};

test('podgląd grupy wysyła tylko ID i rewizję, a odpowiedź trafia do stanu', async () => {
  const base = pokerReducer(undefined, { type: '@@init' });
  const store = configureStore({
    reducer: { poker: pokerReducer },
    preloadedState: { poker: { ...base, dataset: { ...base.dataset, datasetRevision: 'revision-1' } } },
  });
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return new Response(JSON.stringify(preview), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await store.dispatch(fetchSessionGroupPreview({ sessionIds: ['cash:a'] }));
    assert.equal(result.type, fetchSessionGroupPreview.fulfilled.type);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(request, {
    url: '/api/session-groups/preview',
    body: { sessionIds: ['cash:a'], datasetRevision: 'revision-1' },
  });
  assert.equal(store.getState().poker.sessionGroupPreview.data.handCount, 2);
});

test('anulowany podgląd nie pozostawia błędu w stanie', async () => {
  const base = pokerReducer(undefined, { type: '@@init' });
  const store = configureStore({
    reducer: { poker: pokerReducer },
    preloadedState: { poker: { ...base, dataset: { ...base.dataset, datasetRevision: 'revision-1' } } },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
  try {
    const request = store.dispatch(fetchSessionGroupPreview({ sessionIds: ['cash:a'] }));
    request.abort();
    const result = await request;
    assert.equal(result.meta.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(store.getState().poker.sessionGroupPreview.status, 'idle');
  assert.equal(store.getState().poker.sessionGroupPreview.error, null);
});
