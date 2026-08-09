import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionAnalysisInput } from '../src/ai/sessionAnalysisContract.js';
import {
  buildSessionGroupCandidates,
  buildSessionGroupSourceAvailability,
  isSessionGroupReportCurrent,
} from '../src/utils/sessionGroupCandidates.js';

const timestamp = (day) => new Date(2026, 7, day, 12, 0, 0).getTime();

const makeHand = (id, handTimestamp, extra = {}) => ({
  id,
  timestamp: handTimestamp,
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
  ...extra,
});

const makeSession = ({ id, day, tournament = false }) => ({
  id,
  startTime: timestamp(day),
  dateStr: `2026-08-${String(day).padStart(2, '0')} 12:00:00`,
  tableId: tournament ? undefined : `table-${id}`,
  tourneyId: tournament ? `T-${id}` : undefined,
  tourneyName: tournament ? `Tournament ${id}` : undefined,
  hands: [
    makeHand(`${id}-1`, timestamp(day)),
    makeHand(`${id}-rebuy`, timestamp(day) + 1, { isRebuy: true, netProfit: 500 }),
  ],
});

const currentReportFor = (session, type) => ({
  reportId: `report-${session.id}`,
  fingerprint: buildSessionAnalysisInput({
    sessionId: session.id,
    gameType: type,
    hands: session.hands,
  }).fingerprint,
  model: { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
  analyzedAt: '2026-08-08T12:00:00.000Z',
  analysis: {
    profileStyleId: 'INSUFFICIENT',
    sessionSummary: 'Pierwsze zdanie. Drugie zdanie.',
    keyMistakes: [],
    notableHands: [{ handId: `${session.id}-1`, reason: 'Największy swing.' }],
  },
});

test('kandydaci analizy wielu sesji używają wyłącznie aktualnych raportów, kategorii i dat startu', () => {
  const cash = makeSession({ id: 'cash-a', day: 1 });
  const tournament = makeSession({ id: 'tournament-b', day: 2, tournament: true });
  const outdated = makeSession({ id: 'cash-old', day: 3 });
  const malformed = makeSession({ id: 'cash-malformed', day: 2 });
  const sessionAiAnalyses = {
    [cash.id]: [currentReportFor(cash, 'cash')],
    [tournament.id]: [currentReportFor(tournament, 'tournament')],
    [outdated.id]: [{ reportId: 'stale', fingerprint: 'old-fingerprint', analysis: {} }],
    [malformed.id]: [{
      ...currentReportFor(malformed, 'cash'),
      analysis: {},
    }],
  };

  const both = buildSessionGroupCandidates({
    sessions: [cash, outdated, malformed],
    tournaments: [tournament],
    sessionAiAnalyses,
    gameType: 'both',
    dateFrom: '2026-08-01',
    dateTo: '2026-08-02',
  });

  assert.equal(both.dateRange.valid, true);
  assert.deepEqual(both.candidates.map((candidate) => candidate.sourceId), [
    'tournament:tournament-b',
    'cash:cash-a',
  ]);
  assert.equal(both.candidates[1].handCount, 1);
  assert.equal(both.candidates[1].reportId, 'report-cash-a');
  assert.equal(both.candidates.some((candidate) => candidate.sourceId === 'cash:cash-malformed'), false);

  const cashOnly = buildSessionGroupCandidates({
    sessions: [cash],
    tournaments: [tournament],
    sessionAiAnalyses,
    gameType: 'cash',
  });
  assert.deepEqual(cashOnly.candidates.map((candidate) => candidate.sourceId), ['cash:cash-a']);

  const historicalReport = {
    sources: both.candidates.map((candidate) => ({
      sourceId: candidate.sourceId,
      sessionFingerprint: candidate.sessionFingerprint,
      reportFingerprint: candidate.reportFingerprint,
      reportId: candidate.reportId,
    })),
  };
  assert.equal(isSessionGroupReportCurrent(historicalReport, both.candidates), true);
  assert.equal(isSessionGroupReportCurrent({
    ...historicalReport,
    sources: [{ ...historicalReport.sources[0], reportFingerprint: 'changed' }, historicalReport.sources[1]],
  }, both.candidates), false);

  const availability = buildSessionGroupSourceAvailability({
    sessions: [outdated],
    tournaments: [tournament],
  });
  assert.equal(availability.get('cash:cash-old')?.sessionId, 'cash-old');
  assert.equal(availability.get('tournament:tournament-b')?.hands.length, 1);
});
