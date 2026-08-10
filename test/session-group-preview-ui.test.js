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

const { default: pokerReducer } = await import('../src/store/pokerSlice.js');

test('podgląd grupy renderuje metryki przed analizą AI', async (context) => {
  const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
  context.after(() => vite.close());
  const base = pokerReducer(undefined, { type: '@@init' });
  const cash = { id: 'cash:a', type: 'Cash', tableId: 'A', startTime: 1_770_000_000_000, dateStr: '2026-02-01', handCount: 42, fingerprint: 'cash' };
  const tournament = { id: 'tournament:b', type: 'Tournament', tourneyName: 'B', startTime: 1_770_000_060_000, dateStr: '2026-02-01', handCount: 51, fingerprint: 'tournament' };
  const store = configureStore({
    reducer: { poker: pokerReducer },
    preloadedState: { poker: {
      ...base,
      dataset: { ...base.dataset, datasetRevision: 'revision-1' },
      currentPages: {
        ...base.currentPages,
        cash: { ...base.currentPages.cash, items: [cash], status: 'succeeded', datasetRevision: 'revision-1' },
        tournament: { ...base.currentPages.tournament, items: [tournament], status: 'succeeded', datasetRevision: 'revision-1' },
      },
      sessionGroupPreview: {
        status: 'succeeded', error: null, datasetRevision: 'revision-1', queryKey: 'preview',
        data: {
          datasetRevision: 'revision-1', activeCategory: 'both', sessionCount: 2, handCount: 93,
          dateRange: { from: '2026-02-01', to: '2026-02-01' },
          sources: [{ sessionId: cash.id }, { sessionId: tournament.id }],
          categoryBreakdown: {
            cash: { sessionCount: 1, handCount: 42 },
            tournament: { sessionCount: 1, handCount: 51 },
          },
          metrics: {
            shared: {
              vpip: { value: 21.5 }, pfr: { value: 17.2 }, af: { value: 2.1 }, wtsd: { value: 28.4 },
            },
          },
        },
      },
    } },
  });
  const { SessionGroupAnalysisView } = await vite.ssrLoadModule('/src/components/SessionGroupAnalysisView.jsx');
  const html = renderToStaticMarkup(createElement(Provider, { store }, createElement(SessionGroupAnalysisView, {
    gameType: 'both', selectedSourceIds: [cash.id, tournament.id], onSelectedSourceIdsChange: () => {}, onSelectedReportIdChange: () => {},
  })));

  assert.match(html, /data-testid="session-group-metrics-preview"/);
  assert.match(html, /Metryki wybranych sesji/);
  assert.match(html, /93 r/);
  assert.match(html, /Cash: 1 sesje/);
  assert.match(html, /Turnieje: 1 sesje/);
});
