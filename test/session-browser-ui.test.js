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

const { createSessionMonthsQueryKey, default: pokerReducer } = await import('../src/store/pokerSlice.js');

const session = (id, fingerprint) => ({
  id,
  type: 'Cash',
  tableId: id,
  startTime: 1_770_000_000_000,
  dateStr: '2026-02-01',
  totalProfit: 0,
  handCount: 12,
  rebuys: 0,
  fingerprint,
});

test('przeglądarka sesji pokazuje filtry statusu i początkowo zwiniętą listę miesięcy', async (context) => {
  const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
  context.after(() => vite.close());
  const base = pokerReducer(undefined, { type: '@@init' });
  const current = session('current', 'fingerprint-current');
  const stale = session('stale', 'fingerprint-stale');
  const missing = session('missing', 'fingerprint-missing');
  const queryKey = createSessionMonthsQueryKey({ gameType: 'cash' });
  const store = configureStore({
    reducer: { poker: pokerReducer },
    preloadedState: { poker: {
      ...base,
      dataset: { ...base.dataset, datasetRevision: 'revision-2' },
      sessionMonthIndexes: {
        [queryKey]: {
          months: [{ key: '2026-02', year: 2026, month: 2, sessionCount: 3, handCount: 36, cashSessionCount: 3, tournamentSessionCount: 0 }],
          availableRanks: [], status: 'succeeded', error: null, allStatus: 'idle', allError: null, datasetRevision: 'revision-2',
        },
      },
      sessionMonthPages: {
        [queryKey]: { '2026-02': { items: [current, stale, missing], status: 'succeeded', error: null, datasetRevision: 'revision-2' } },
      },
      sessionSummariesById: Object.fromEntries([current, stale, missing].map((item) => [item.id, item])),
      sessionAiAnalyses: {
        [current.id]: [{ reportId: 'current-report', fingerprint: current.fingerprint, datasetRevision: 'revision-2' }],
        [stale.id]: [{ reportId: 'old-report', fingerprint: stale.fingerprint, datasetRevision: 'revision-1' }],
      },
    } },
  });
  const { SessionBrowserView } = await vite.ssrLoadModule('/src/components/SessionBrowserView.jsx');
  const html = renderToStaticMarkup(createElement(Provider, { store }, createElement(SessionBrowserView, {
    gameType: 'cash', onHandClick: () => {},
  })));

  assert.match(html, /Status analizy/);
  assert.match(html, /Z aktualnym raportem/);
  assert.match(html, /Bez aktualnego raportu/);
  assert.match(html, /aria-label="Luty 2026, 3 sesji, 36 rozdań"/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /role="region"/);
  assert.doesNotMatch(html, /aria-label="Aktualna analiza sesji/);
});
