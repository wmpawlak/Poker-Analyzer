import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAYER_ANALYSIS_MAX_SESSION_REPORTS,
  buildPlayerAnalysisData,
  selectPlayerSessionEvidence,
} from '../src/ai/playerAnalysisData.js';
import { buildSessionAnalysisInput } from '../src/ai/sessionAnalysisContract.js';
import { getProfileDateRange } from '../src/utils/profileReport.js';

const localTimestamp = (day, hour = 12) => new Date(2026, 7, day, hour).getTime();

const makeAnalysisHand = ({
  id,
  day = 1,
  hour = 12,
  sessionId = `session-${day}`,
  isTournament = false,
  netProfit = 1,
  bigBlind = 0.1,
  isRebuy = false,
} = {}) => ({
  id: String(id),
  timestamp: localTimestamp(day, hour),
  sessionId,
  isTournament,
  isRebuy,
  netProfit,
  bigBlind,
  heroVPIP: Number(id) % 2 === 0,
  heroPFR: Number(id) % 3 === 0,
  heroSawFlop: false,
  sawShowdown: false,
});

const makeSession = ({ id, day, type = 'Cash', endDay = day }) => ({
  id,
  type,
  hands: [
    makeAnalysisHand({ id: `${id}-1`, day, hour: 1, sessionId: id, isTournament: type !== 'Cash' }),
    makeAnalysisHand({ id: `${id}-2`, day: endDay, hour: 23, sessionId: id, isTournament: type !== 'Cash' }),
  ],
});

const makeCurrentReport = (session, {
  reportId = `report-${session.id}`,
  analyzedAt = '2026-08-10T12:00:00.000Z',
  fingerprint,
  analysis,
} = {}) => {
  const type = session.type === 'Cash' ? 'cash' : 'tournament';
  const input = buildSessionAnalysisInput({ sessionId: session.id, hands: session.hands, gameType: type });
  return {
    reportId,
    analyzedAt,
    model: { id: 'test-model', name: 'Model testowy' },
    fingerprint: fingerprint ?? input.fingerprint,
    analysis: analysis ?? {
      profileStyleId: input.profileStyleId,
      sessionSummary: 'Sesja ma niewielką próbę. Wnioski pozostają ostrożne.',
      keyMistakes: [],
      notableHands: [{ handId: input.largestSwingHandId, reason: 'Największy swing.' }],
    },
  };
};

test('builder filtruje typ i włączne granice dat oraz podaje faktyczny zakres i sesje', () => {
  const hands = [
    makeAnalysisHand({ id: 1, day: 1, hour: 0, sessionId: 'cash-1' }),
    makeAnalysisHand({ id: 2, day: 1, hour: 23, sessionId: 'cash-1' }),
    makeAnalysisHand({ id: 3, day: 2, sessionId: 'cash-2' }),
    makeAnalysisHand({ id: 4, day: 1, sessionId: 'tournament-1', isTournament: true }),
    makeAnalysisHand({ id: 5, day: 1, sessionId: 'cash-1', isRebuy: true }),
  ];

  const result = buildPlayerAnalysisData({
    hands,
    gameType: 'cash',
    dateFrom: '2026-08-01',
    dateTo: '2026-08-01',
    datasetRevision: 'revision-1',
  });

  assert.equal(result.isValid, true);
  assert.equal(result.handCount, 2);
  assert.equal(result.cashHandCount, 2);
  assert.equal(result.tournamentHandCount, 0);
  assert.equal(result.sessionCount, 1);
  assert.deepEqual(
    { from: result.actualDateRange.from, to: result.actualDateRange.to },
    { from: '2026-08-01', to: '2026-08-01' },
  );
  assert.equal(result.datasetRevision, 'revision-1');
});

test('tryb Wszystko rozdziela wynik i jednostki Cash/Turnieje od wspólnych zachowań', () => {
  const result = buildPlayerAnalysisData({
    hands: [
      makeAnalysisHand({ id: 1, day: 1, netProfit: 1, bigBlind: 0.1 }),
      makeAnalysisHand({ id: 2, day: 2, isTournament: true, netProfit: 100 }),
    ],
    gameType: 'both',
  });

  assert.equal(result.metrics.shared.hands, 2);
  assert.equal(Object.hasOwn(result.metrics.shared, 'totalProfit'), false);
  assert.equal(Object.hasOwn(result.metrics.shared, 'winrate'), false);
  assert.equal(result.metrics.cash.totalProfit, 1);
  assert.equal(result.metrics.cash.winrate.unit, 'BB/100');
  assert.equal(result.metrics.tournament.totalProfit, 100);
  assert.equal(result.metrics.tournament.winrate.unit, 'żetony/100');
  assert.equal(Object.hasOwn(result.metricCatalog, 'shared.totalProfit'), false);
  assert.equal(result.metricCatalog['cash.totalProfit'].value, 1);
  assert.equal(result.metricCatalog['tournament.winrate'].unit, 'żetony/100');
  assert.equal(result.metricCatalog['shared.preflop.vpip'].unit, '%');
});

test('tryb Turnieje nie przepuszcza rąk ani metryk ekonomicznych Cash', () => {
  const result = buildPlayerAnalysisData({
    hands: [
      makeAnalysisHand({ id: 1, day: 1, sessionId: 'cash' }),
      makeAnalysisHand({
        id: 2,
        day: 1,
        sessionId: 'tournament',
        isTournament: true,
        netProfit: 250,
      }),
    ],
    gameType: 'tournament',
  });

  assert.equal(result.handCount, 1);
  assert.equal(result.cashHandCount, 0);
  assert.equal(result.tournamentHandCount, 1);
  assert.equal(result.sessionCount, 1);
  assert.equal(Object.hasOwn(result.metrics, 'cash'), false);
  assert.equal(result.metrics.tournament.totalProfit, 250);
  assert.equal(Object.hasOwn(result.metricCatalog, 'cash.totalProfit'), false);
});

test('wiarygodność buildera ma progi 29/30/99/100 rąk', () => {
  const reliabilityFor = (count) => buildPlayerAnalysisData({
    hands: Array.from({ length: count }, (_, index) => makeAnalysisHand({
      id: index + 1,
      sessionId: 'sample-session',
    })),
    gameType: 'cash',
  }).reliabilityId;

  assert.equal(reliabilityFor(29), 'INSUFFICIENT');
  assert.equal(reliabilityFor(30), 'PRELIMINARY');
  assert.equal(reliabilityFor(99), 'PRELIMINARY');
  assert.equal(reliabilityFor(100), 'STATISTICAL');
});

test('brak rąk jest poprawnym pustym zbiorem, a odwrócony zakres jest błędem', () => {
  const empty = buildPlayerAnalysisData({ hands: [], gameType: 'both' });
  assert.equal(empty.isValid, true);
  assert.equal(empty.handCount, 0);
  assert.equal(empty.profileStyleId, 'INSUFFICIENT');
  assert.deepEqual(empty.actualDateRange, {
    from: '', to: '', fromTimestamp: null, toTimestamp: null,
  });

  const invalid = buildPlayerAnalysisData({
    hands: [makeAnalysisHand({ id: 1 })],
    dateFrom: '2026-08-02',
    dateTo: '2026-08-01',
  });
  assert.equal(invalid.isValid, false);
  assert.match(invalid.error, /późniejsza/);
  assert.equal(invalid.metrics, null);
});

test('dowody pomijają raporty stare, niepoprawne i sesje tylko częściowo w okresie', () => {
  const valid = makeSession({ id: 'valid', day: 2 });
  const stale = makeSession({ id: 'stale', day: 3 });
  const invalid = makeSession({ id: 'invalid', day: 4 });
  const partial = makeSession({ id: 'partial', day: 1, endDay: 2 });
  const validReport = makeCurrentReport(valid, {
    analysis: {
      ...makeCurrentReport(valid).analysis,
      keyMistakes: [{
        title: 'Za szeroki call',
        description: 'Call pojawia się za często.',
        correction: 'Zawęź zakres.',
        handIds: valid.hands.map((hand) => hand.id),
      }],
    },
  });
  const evidence = selectPlayerSessionEvidence({
    sessions: [valid, stale, invalid, partial],
    sessionAnalyses: {
      valid: [validReport],
      stale: [makeCurrentReport(stale, { fingerprint: 'stary-fingerprint' })],
      invalid: [makeCurrentReport(invalid, {
        analysis: { profileStyleId: 'NIEISTNIEJĄCY', sessionSummary: 'Błędny raport.' },
      })],
      partial: [makeCurrentReport(partial)],
    },
    gameType: 'cash',
    dateRange: getProfileDateRange('2026-08-02', '2026-08-04'),
  });

  assert.deepEqual(evidence.coverage, {
    sessionsInPeriod: 3,
    availableReports: 1,
    usedReports: 1,
    byGameType: {
      cash: { sessionsInPeriod: 3, availableReports: 1, usedReports: 1 },
      tournament: { sessionsInPeriod: 0, availableReports: 0, usedReports: 0 },
    },
  });
  assert.equal(evidence.reports[0].reportId, validReport.reportId);
  assert.deepEqual(evidence.reports[0].leaks, [{
    title: 'Za szeroki call',
    description: 'Call pojawia się za często.',
    correction: 'Zawęź zakres.',
  }]);
  assert.equal(JSON.stringify(evidence).includes('hands'), false);
  assert.equal(JSON.stringify(evidence).includes('handIds'), false);
});

test('brak raportów nie blokuje buildera', () => {
  const session = makeSession({ id: 'without-report', day: 2 });
  const result = buildPlayerAnalysisData({
    hands: session.hands,
    sessions: [session],
    sessionAnalyses: {},
    gameType: 'cash',
    dateFrom: '2026-08-02',
    dateTo: '2026-08-02',
  });

  assert.equal(result.isValid, true);
  assert.equal(result.handCount, 2);
  assert.deepEqual(result.sessionEvidence.coverage, {
    sessionsInPeriod: 1,
    availableReports: 0,
    usedReports: 0,
    byGameType: {
      cash: { sessionsInPeriod: 1, availableReports: 0, usedReports: 0 },
      tournament: { sessionsInPeriod: 0, availableReports: 0, usedReports: 0 },
    },
  });
});

test('maksymalnie 20 raportów jest wybieranych deterministycznie i równomiernie w czasie', () => {
  const sessions = Array.from({ length: 25 }, (_, index) => makeSession({
    id: `session-${String(index + 1).padStart(2, '0')}`,
    day: index + 1,
  }));
  const sessionAnalyses = Object.fromEntries(sessions.map((session) => [
    session.id,
    [makeCurrentReport(session)],
  ]));
  const input = {
    sessions,
    sessionAnalyses,
    gameType: 'cash',
    dateRange: getProfileDateRange('', ''),
  };
  const first = selectPlayerSessionEvidence(input);
  const second = selectPlayerSessionEvidence(input);
  const selectedDays = first.reports.map((report) => new Date(report.startTime).getDate());
  const gaps = selectedDays.slice(1).map((day, index) => day - selectedDays[index]);

  assert.equal(first.coverage.sessionsInPeriod, 25);
  assert.equal(first.coverage.availableReports, 25);
  assert.equal(first.coverage.usedReports, PLAYER_ANALYSIS_MAX_SESSION_REPORTS);
  assert.equal(first.reports.length, PLAYER_ANALYSIS_MAX_SESSION_REPORTS);
  assert.equal(selectedDays[0], 1);
  assert.equal(selectedDays.at(-1), 25);
  assert.ok(Math.max(...gaps) <= 2);
  assert.deepEqual(first.reports.map((report) => report.reportId), second.reports.map((report) => report.reportId));
});

test('wszystkie historyczne raporty zgodne z bieżącą sesją pozostają dostępnymi dowodami', () => {
  const session = makeSession({ id: 'history', day: 5 });
  const older = makeCurrentReport(session, {
    reportId: 'older',
    analyzedAt: '2026-08-01T12:00:00.000Z',
  });
  const newer = makeCurrentReport(session, {
    reportId: 'newer',
    analyzedAt: '2026-08-02T12:00:00.000Z',
  });
  const evidence = selectPlayerSessionEvidence({
    sessions: [session],
    sessionAnalyses: { history: [newer, older] },
    gameType: 'cash',
    dateRange: getProfileDateRange('', ''),
  });

  assert.equal(evidence.coverage.availableReports, 2);
  assert.equal(evidence.coverage.usedReports, 2);
  assert.deepEqual(evidence.reports.map((report) => report.reportId), ['older', 'newer']);
  assert.equal(new Set(evidence.reports.map((report) => report.sourceId)).size, 2);
});
