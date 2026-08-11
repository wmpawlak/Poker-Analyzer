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

test('widok analizy wielu sesji używa podsumowań API oraz aktualnych raportów', async (context) => {
  const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
  context.after(() => vite.close());
  const base = pokerReducer(undefined, { type: '@@init' });
  const cash = { id: 'cash-a', type: 'Cash', tableId: 'table-a', startTime: 1_770_000_000_000, dateStr: '2026-02-01', handCount: 42, fingerprint: 'cash-fingerprint' };
  const tournament = { id: 'tournament-b', type: 'Tournament', tourneyId: 'T-1', tourneyName: 'Turniej B', startTime: 1_770_000_060_000, dateStr: '2026-02-01', handCount: 51, fingerprint: 'tournament-fingerprint' };
  const queryKey = createSessionMonthsQueryKey({ gameType: 'both' });
  const store = configureStore({
    reducer: { poker: pokerReducer },
    preloadedState: {
      poker: {
        ...base,
        dataset: { ...base.dataset, datasetRevision: 'revision-1' },
        sessionMonthIndexes: { [queryKey]: { months: [{ key: '2026-02', year: 2026, month: 2, sessionCount: 2, handCount: 93, cashSessionCount: 1, tournamentSessionCount: 1 }], status: 'succeeded', error: null, allStatus: 'idle', allError: null, datasetRevision: 'revision-1' } },
        sessionMonthPages: { [queryKey]: { '2026-02': { items: [cash, tournament], status: 'succeeded', error: null, datasetRevision: 'revision-1' } } },
        sessionSummariesById: { [cash.id]: cash, [tournament.id]: tournament },
        sessionAiAnalyses: {
          [cash.id]: [{ reportId: 'cash-report', fingerprint: cash.fingerprint, datasetRevision: 'revision-1' }],
          [tournament.id]: [{ reportId: 'tournament-report', fingerprint: tournament.fingerprint, datasetRevision: 'revision-1' }],
        },
        sessionGroupAiAnalyses: [{
          reportId: 'group-report', datasetRevision: 'revision-1', sessionIds: [cash.id, tournament.id], sessionCount: 2,
          model: { name: 'GPT-5.6 Terra' }, analyzedAt: '2026-02-01T12:00:00.000Z',
          sources: [
            { sourceId: 'cash:cash-a', type: 'cash', sessionId: cash.id, sessionFingerprint: cash.fingerprint, metadata: { label: 'Stół table-a', handCount: 42 } },
            { sourceId: 'tournament:tournament-b', type: 'tournament', sessionId: tournament.id, sessionFingerprint: tournament.fingerprint, metadata: { label: 'Turniej B', handCount: 51 } },
          ],
          analysis: {
            summary: 'Wspólne podsumowanie.', summarySourceRefs: [{ sourceId: 'cash:cash-a', reportId: 'cash-report', handIds: ['hand-1'] }],
            strengths: [{ title: 'Mocna strona', description: 'Dobra selekcja rąk.', sourceRefs: [{ sourceId: 'cash:cash-a', reportId: 'cash-report', handIds: [] }] }],
            repeatedMistakes: [{ title: 'Błąd', description: 'Za szerokie calle.', correction: 'Zawęź calling range.', sourceRefs: [{ sourceId: 'cash:cash-a', reportId: 'cash-report', handIds: [] }, { sourceId: 'tournament:tournament-b', reportId: 'tournament-report', handIds: [] }] }],
            trainingPriorities: [{ title: 'Priorytet', description: 'Ćwicz sizing.', sourceRefs: [{ sourceId: 'cash:cash-a', reportId: 'cash-report', handIds: [] }] }],
            categoryInsights: [{ category: 'tournament', summary: 'Dostosuj presję ICM.', sourceRefs: [{ sourceId: 'tournament:tournament-b', reportId: 'tournament-report', handIds: [] }], tendencies: [{ title: 'Tendencja', description: 'Za mało stealów.', sourceRefs: [{ sourceId: 'tournament:tournament-b', reportId: 'tournament-report', handIds: [] }] }], recommendations: [{ title: 'Rekomendacja', description: 'Ćwicz shovy.', sourceRefs: [{ sourceId: 'tournament:tournament-b', reportId: 'tournament-report', handIds: [] }] }] }],
          },
        }],
      },
    },
  });
  const { SessionGroupAnalysisView } = await vite.ssrLoadModule('/src/components/SessionGroupAnalysisView.jsx');
  const html = renderToStaticMarkup(createElement(Provider, { store }, createElement(SessionGroupAnalysisView, {
    gameType: 'both', selectedSourceIds: [cash.id, tournament.id], selectedReportId: 'group-report',
    onSelectedSourceIdsChange: () => {}, onSelectedReportIdChange: () => {}, onOpenSession: () => {},
  })));

  assert.match(html, /data-testid="session-group-analysis-session-list"/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /role="region"/);
  assert.match(html, /Stół table-a/);
  assert.match(html, /Turniej B/);
  assert.match(html, /data-testid="session-group-compact-preview"/);
  assert.match(html, /Wspólne podsumowanie/);
  assert.match(html, /Priorytet/);
  assert.match(html, /Mocne strony/);
  assert.match(html, /Powtarzalne błędy i korekty/);
  assert.match(html, /Trzy priorytety treningowe/);
  assert.match(html, /Wnioski Cash \/ Turnieje/);
  assert.match(html, /Tendencje/);
  assert.match(html, /Rekomendacje/);
  assert.match(html, /Źródła raportu/);
  assert.match(html, /aria-label="Otwórz rozdanie #hand-1"/);
  assert.doesNotMatch(html, /rawText/);
});

test('uproszczony raport historyczny pozostaje czytelny bez nieistniejących źródeł', async (context) => {
  const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
  context.after(() => vite.close());
  const base = pokerReducer(undefined, { type: '@@init' });
  const store = configureStore({
    reducer: { poker: pokerReducer },
    preloadedState: { poker: {
      ...base,
      dataset: { ...base.dataset, datasetRevision: 'revision-now' },
      currentPages: {
        cash: { items: [], status: 'succeeded', error: null, datasetRevision: 'revision-now' },
        tournament: { items: [], status: 'succeeded', error: null, datasetRevision: 'revision-now' },
      },
      sessionGroupAiAnalyses: [{
        reportId: 'legacy-group', datasetRevision: 'revision-before', model: { name: 'Historyczny model' }, analyzedAt: '2026-01-01T00:00:00.000Z',
        analysis: { sessionSummary: 'Zachowane podsumowanie historyczne.' },
      }],
    } },
  });
  const { SessionGroupAnalysisView } = await vite.ssrLoadModule('/src/components/SessionGroupAnalysisView.jsx');
  const html = renderToStaticMarkup(createElement(Provider, { store }, createElement(SessionGroupAnalysisView, {
    selectedReportId: 'legacy-group', onSelectedSourceIdsChange: () => {}, onSelectedReportIdChange: () => {},
  })));

  assert.match(html, /Zachowane podsumowanie historyczne/);
  assert.match(html, /Ten historyczny raport nie zawiera listy źródeł/);
  assert.doesNotMatch(html, /Część źródeł raportu jest nieaktualna/);
});
