import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { configureStore } from '@reduxjs/toolkit';
import { buildTourneySessions } from '../src/parser/pokerParser.js';

const makeHand = ({
  id,
  tourneyId,
  tourneyName = 'Test turniej',
  date,
  timestamp,
  heroStartingStack = 100,
  netProfit = 0,
}) => ({
  id,
  isTournament: true,
  tourneyId,
  tourneyName,
  dateStr: `${date} 12:00:00 UTC`,
  timestamp,
  heroStartingStack,
  netProfit,
});

test('scala ten sam numer turnieju przez zmianę daty, zachowując chronologię, rebuy i metryki sesji', () => {
  const older = makeHand({
    id: 'older',
    tourneyId: '86617',
    date: '2026/08/08',
    timestamp: 1_000,
    heroStartingStack: 100,
    netProfit: 20,
  });
  const newer = makeHand({
    id: 'newer',
    tourneyId: '86617',
    date: '2026/08/09',
    timestamp: 2_000,
    heroStartingStack: 250,
    netProfit: -10,
  });

  const [session] = buildTourneySessions([newer, older]);

  assert.equal(session.id, 'tourney_86617');
  assert.deepEqual(session.mergedFromSessionIds, [
    'tourney_86617_2026/08/08',
    'tourney_86617_2026/08/09',
  ]);
  assert.deepEqual(session.hands.filter((hand) => !hand.isRebuy).map((hand) => hand.id), ['older', 'newer']);
  assert.deepEqual(session.hands.map((hand) => hand.sessionHandIndex), [1, 2, 3]);
  assert.equal(session.hands.filter((hand) => hand.isRebuy).length, 1);
  assert.equal(session.rebuys, 1);
  assert.equal(session.startTime, 1_000);
  assert.equal(session.lastTimestamp, 2_000);
  assert.equal(session.totalProfit, 10);
  assert.deepEqual(session.chartData.map((point) => point.handIndex), [1, 2, 3]);
});

test('jednakowa nazwa z różnymi numerami pozostaje rozdzielona, a turniej jednodniowy zachowuje ID', () => {
  const sessions = buildTourneySessions([
    makeHand({ id: 'one', tourneyId: '100', date: '2026/08/08', timestamp: 1_000 }),
    makeHand({ id: 'two', tourneyId: '200', date: '2026/08/08', timestamp: 2_000 }),
  ]);

  assert.equal(sessions.length, 2);
  assert.deepEqual(sessions.map((session) => session.id).sort(), [
    'tourney_100_2026/08/08',
    'tourney_200_2026/08/08',
  ]);
  assert.deepEqual(sessions.map((session) => session.mergedFromSessionIds), [[], []]);
});

test('rozdania bez numeru turnieju nie są łączone', () => {
  const sessions = buildTourneySessions([
    makeHand({ id: 'unknown-a', tourneyId: '', date: '2026/08/08', timestamp: 1_000 }),
    makeHand({ id: 'unknown-b', tourneyId: '', date: '2026/08/08', timestamp: 1_001 }),
  ]);

  assert.equal(sessions.length, 2);
  assert.notEqual(sessions[0].id, sessions[1].id);
});

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

test('przeliczenie usuwa raporty dziennych fragmentów i zależne raporty grupowe, ale zachowuje pozostałe', async () => {
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;
  const {
    AI_ANALYSES_CACHE_KEY,
    SESSION_AI_ANALYSES_CACHE_KEY,
    SESSION_GROUP_AI_ANALYSES_CACHE_KEY,
    selectTourney,
    syncLocalSources,
    default: pokerReducer,
  } = await import('../src/store/pokerSlice.js');

  const fixture = await readFile(new URL('./fixtures/stats-tournament.txt', import.meta.url), 'utf8');
  const mergedHistory = fixture.replace('2026/08/02 12:01:00', '2026/08/03 12:01:00');
  const singleDayHistory = fixture
    .replaceAll('91001', '92001')
    .replaceAll('91002', '92002')
    .replaceAll("'9100'", "'9200'");
  const oldSessionIds = [
    'tourney_9100_2026/08/02',
    'tourney_9100_2026/08/03',
  ];
  const singleDaySessionId = 'tourney_9200_2026/08/02';
  const handAnalysis = { '91001': [{ reportId: 'hand-report' }] };
  const sessionAnalyses = {
    [oldSessionIds[0]]: [{ reportId: 'fragment-a' }],
    [oldSessionIds[1]]: [{ reportId: 'fragment-b' }],
    [singleDaySessionId]: [{ reportId: 'single-day-report' }],
    'cash-table-day': [{ reportId: 'cash-report' }],
  };
  const groupAnalyses = [
    {
      reportId: 'group-to-remove',
      sources: [{ sourceId: `tournament:${oldSessionIds[0]}`, sessionId: oldSessionIds[0] }],
    },
    {
      reportId: 'group-to-keep',
      sources: [{ sourceId: `tournament:${singleDaySessionId}`, sessionId: singleDaySessionId }],
    },
  ];
  storage.setItem(AI_ANALYSES_CACHE_KEY, JSON.stringify(handAnalysis));
  storage.setItem(SESSION_AI_ANALYSES_CACHE_KEY, JSON.stringify(sessionAnalyses));
  storage.setItem(SESSION_GROUP_AI_ANALYSES_CACHE_KEY, JSON.stringify(groupAnalyses));

  const baseState = pokerReducer(undefined, { type: '@@init' });
  const store = configureStore({
    reducer: { poker: pokerReducer },
    preloadedState: {
      poker: {
        ...baseState,
        selectedTourneyId: oldSessionIds[1],
        aiAnalyses: handAnalysis,
        sessionAiAnalyses: sessionAnalyses,
        sessionGroupAiAnalyses: groupAnalyses,
        sessionAnalysisStatusById: { [oldSessionIds[1]]: 'succeeded' },
        sessionAnalysisErrorById: { [oldSessionIds[0]]: { message: 'old' } },
      },
    },
  });

  store.dispatch(selectTourney(oldSessionIds[1]));
  store.dispatch(syncLocalSources.fulfilled([{
    id: 'local:merge-test.txt',
    filename: 'merge-test.txt',
    content: `${mergedHistory}\n\n${singleDayHistory}`,
    type: 'Tournament',
    origin: 'local',
    enabled: true,
    size: 1,
    modifiedAt: '2026-08-09T00:00:00.000Z',
    dateAdded: '2026-08-09T00:00:00.000Z',
  }], 'sync-test'));

  const state = store.getState().poker;
  assert.equal(state.selectedTourneyId, 'tourney_9100');
  assert.deepEqual(state.sessionAiAnalyses, {
    [singleDaySessionId]: [{ reportId: 'single-day-report' }],
    'cash-table-day': [{ reportId: 'cash-report' }],
  });
  assert.deepEqual(state.sessionGroupAiAnalyses, [groupAnalyses[1]]);
  assert.equal(state.sessionAnalysisStatusById[oldSessionIds[1]], undefined);
  assert.equal(state.sessionAnalysisErrorById[oldSessionIds[0]], undefined);
  assert.deepEqual(state.aiAnalyses, handAnalysis);
  assert.deepEqual(JSON.parse(storage.getItem(SESSION_AI_ANALYSES_CACHE_KEY)), state.sessionAiAnalyses);
  assert.deepEqual(JSON.parse(storage.getItem(SESSION_GROUP_AI_ANALYSES_CACHE_KEY)), [groupAnalyses[1]]);
  assert.deepEqual(JSON.parse(storage.getItem(AI_ANALYSES_CACHE_KEY)), handAnalysis);
});
