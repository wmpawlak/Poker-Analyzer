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
const { buildSessionAnalysisInput } = await import('../src/ai/sessionAnalysisContract.js');

const makeHand = (id, timestamp, netProfit, tournament = false) => ({
  id,
  timestamp,
  isTournament: tournament,
  position: 'BTN',
  smallBlind: 0.05,
  bigBlind: 0.1,
  heroStartingStack: 10,
  heroCards: ['As', 'Kd'],
  boardCards: [],
  outcome: netProfit >= 0 ? 'WON' : 'LOST',
  heroInvestment: 1,
  heroWinnings: Math.max(0, netProfit + 1),
  netProfit,
  handRanking: 'PAIR',
  streets: [],
});

const makeSession = ({ id, tournament = false, timestamp }) => {
  const hands = [makeHand(`${id}-1`, timestamp, 1, tournament), makeHand(`${id}-2`, timestamp + 1, -2, tournament)];
  const fingerprint = buildSessionAnalysisInput({ sessionId: id, hands, gameType: tournament ? 'tournament' : 'cash' }).fingerprint;
  return {
    session: tournament
      ? { id, tourneyId: `T-${id}`, tourneyName: `Turniej ${id}`, startTime: timestamp, dateStr: '2026-08-08 12:00:00', hands }
      : { id, tableId: `table-${id}`, startTime: timestamp, dateStr: '2026-08-08 12:00:00', hands },
    report: {
      reportId: `report-${id}`,
      fingerprint,
      model: { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
      analyzedAt: '2026-08-08T12:00:00.000Z',
      analysis: {
        profileStyleId: 'INSUFFICIENT',
        sessionSummary: 'Pierwsze zdanie. Drugie zdanie.',
        keyMistakes: [],
        notableHands: [{ handId: `${id}-2`, reason: 'Swing.' }],
      },
    },
  };
};

test('widok analizy wielu sesji pokazuje kandydatów obu typów, blokadę i historię źródłową', async (context) => {
  const vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false },
  });
  context.after(() => vite.close());

  const cash = makeSession({ id: 'cash-a', timestamp: new Date(2026, 7, 8, 12).getTime() });
  const tournament = makeSession({ id: 'tourney-b', tournament: true, timestamp: new Date(2026, 7, 8, 13).getTime() });
  const baseState = pokerReducer(undefined, { type: '@@init' });
  const groupReport = {
    reportId: 'group-report',
    model: { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
    analyzedAt: '2026-08-08T13:00:00.000Z',
    sessionCount: 2,
    fingerprint: 'history-fingerprint',
    sources: [
      { sourceId: 'cash:cash-a', type: 'cash', sessionId: 'cash-a', sessionFingerprint: cash.report.fingerprint, reportFingerprint: cash.report.fingerprint, reportId: cash.report.reportId, metadata: { label: 'Stół table-cash-a' } },
      { sourceId: 'tournament:tourney-b', type: 'tournament', sessionId: 'tourney-b', sessionFingerprint: tournament.report.fingerprint, reportFingerprint: tournament.report.fingerprint, reportId: tournament.report.reportId, metadata: { label: 'Turniej tourney-b' } },
    ],
    analysis: {
      profileStyleId: 'INSUFFICIENT',
      reliabilityId: 'INSUFFICIENT',
      summary: 'Wspólne podsumowanie.',
      summarySourceRefs: [{ sourceId: 'cash:cash-a', reportId: cash.report.reportId, handIds: [] }],
      strengths: [{ title: 'Dyscyplina', description: 'Opis.', sourceRefs: [{ sourceId: 'cash:cash-a', reportId: cash.report.reportId, handIds: ['cash-a-2'] }] }],
      repeatedMistakes: [],
      trainingPriorities: [
        { title: 'Priorytet 1', description: 'Opis.', sourceRefs: [{ sourceId: 'cash:cash-a', reportId: cash.report.reportId, handIds: [] }] },
        { title: 'Priorytet 2', description: 'Opis.', sourceRefs: [{ sourceId: 'cash:cash-a', reportId: cash.report.reportId, handIds: [] }] },
        { title: 'Priorytet 3', description: 'Opis.', sourceRefs: [{ sourceId: 'cash:cash-a', reportId: cash.report.reportId, handIds: [] }] },
      ],
      categoryInsights: [],
    },
  };
  const store = configureStore({
    reducer: { poker: pokerReducer },
    preloadedState: {
      poker: {
        ...baseState,
        sessions: [cash.session],
        tournaments: [tournament.session],
        sessionAiAnalyses: {
          [cash.session.id]: [cash.report],
          [tournament.session.id]: [tournament.report],
        },
        aiModelsStatus: 'succeeded',
        aiModels: [{ id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', configured: true }],
        sessionGroupAiAnalyses: [groupReport],
      },
    },
  });
  const { SessionGroupAnalysisView } = await vite.ssrLoadModule('/src/components/SessionGroupAnalysisView.jsx');
  const html = renderToStaticMarkup(createElement(Provider, { store }, createElement(SessionGroupAnalysisView, {
    gameTypeFilter: 'both', onBack: () => {}, onHandClick: () => {}, onOpenSession: () => {},
  })));

  const selectedHtml = renderToStaticMarkup(createElement(Provider, { store }, createElement(SessionGroupAnalysisView, {
    gameType: 'both',
    selectedSourceIds: ['cash:cash-a', 'tournament:tourney-b'],
    onSelectedSourceIdsChange: () => {},
    onSelectedReportIdChange: () => {},
    onBack: () => {},
    onHandClick: () => {},
    onOpenSession: () => {},
  })));

  assert.match(html, /data-testid="session-group-analysis-view"/);
  assert.match(selectedHtml, /data-testid="session-group-analysis-workspace"/);
  assert.match(selectedHtml, /data-testid="session-group-analysis-selector"/);
  assert.match(selectedHtml, /data-testid="session-group-analysis-session-list"/);
  assert.match(selectedHtml, /data-testid="session-group-analysis-action"/);
  assert.match(selectedHtml, /data-testid="session-group-analysis-preview"/);
  assert.match(selectedHtml, /data-testid="session-group-compact-preview"/);
  assert.match(selectedHtml, /Pokaż pełny profil lokalny/);
  assert.doesNotMatch(selectedHtml, /data-testid="session-group-full-profile"/);
  assert.doesNotMatch(selectedHtml, /data-testid="session-summary"/);
  assert.match(html, /Analiza wielu sesji/);
  assert.match(html, /Stół table-cash-a/);
  assert.match(html, /Turniej tourney-b/);
  assert.match(html, /data-testid="session-group-date-from"/);
  assert.match(html, /data-testid="session-group-date-to"/);
  assert.match(html, /Zaznacz widoczne/);
  assert.match(html, /Wybierz co najmniej dwie różne sesje/);
  assert.match(html, /Historia raportów \(1\)/);
  assert.match(html, /Trzy priorytety treningowe/);
  assert.match(html, /Wiarygodność lokalnego profilu: INSUFFICIENT/);
});
