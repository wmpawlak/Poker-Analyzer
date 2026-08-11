import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createApiApp } from '../server/app.js';
import {
  createSessionMonthsResponse,
  createSessionsResponse,
} from '../server/dataQueries.js';

const timestamp = (value) => new Date(`${value}T12:00:00Z`).getTime();

const makeHand = ({ id, date, rank = 'PAIR', isTournament = false, isRebuy = false }) => ({
  id,
  timestamp: timestamp(date),
  dateStr: date.replaceAll('-', '/'),
  handRanking: rank,
  isTournament,
  isRebuy,
  rawText: `heavy-${id}`,
});

const makeSession = ({ id, date, type = 'Cash', hands = [] }) => ({
  id,
  type,
  tableId: type === 'Cash' ? id : '',
  tourneyId: type === 'Tournament' ? id : '',
  tourneyName: type === 'Tournament' ? `Turniej ${id}` : '',
  startTime: timestamp(date),
  lastTimestamp: timestamp(date),
  dateStr: date.replaceAll('-', '/'),
  totalProfit: 1,
  startStack: null,
  fingerprint: `fingerprint-${id}`,
  hands,
  chartData: [{ heavy: true }],
  rawText: `heavy-${id}`,
});

const createSnapshot = () => {
  const cash = [
    makeSession({
      id: 'cash-july',
      date: '2026-07-31',
      hands: [
        makeHand({ id: 'july-pair', date: '2026-07-31' }),
        makeHand({ id: 'july-rebuy', date: '2026-07-31', isRebuy: true }),
      ],
    }),
    makeSession({
      id: 'cash-august',
      date: '2026-08-01',
      hands: [
        makeHand({ id: 'august-pair', date: '2026-08-01' }),
        makeHand({ id: 'august-straight', date: '2026-08-01', rank: 'STRAIGHT' }),
      ],
    }),
  ];
  const tournament = [
    makeSession({
      id: 'tournament-august',
      date: '2026-08-15',
      type: 'Tournament',
      hands: [makeHand({ id: 'august-flush', date: '2026-08-15', rank: 'FLUSH', isTournament: true })],
    }),
    makeSession({
      id: 'tournament-september',
      date: '2026-09-01',
      type: 'Tournament',
      hands: [makeHand({ id: 'september-high', date: '2026-09-01', rank: 'HIGH_CARD', isTournament: true })],
    }),
  ];
  const sessions = [...cash, ...tournament];
  return {
    datasetRevision: 'months-revision',
    hands: sessions.flatMap((session) => session.hands),
    sessions: { cash, tournament },
    sessionsById: new Map(sessions.map((session) => [session.id, session])),
  };
};

const startApi = async (t, snapshot) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'poker-months-api-'));
  t.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const app = createApiApp({
    dataDirectory,
    logger: { error: () => {} },
    dataIndex: {
      getSnapshot: async () => snapshot,
      getStatus: () => ({ datasetRevision: snapshot.datasetRevision }),
      start: async () => snapshot,
      readHand: async () => null,
    },
    dataImports: {
      scanInbox: async () => null,
      getStatus: () => ({ phase: 'ready' }),
    },
  });
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}`;
};

test('indeks miesięcy agreguje Cash i turnieje, filtr układu oraz pomija rebuy', () => {
  const response = createSessionMonthsResponse(createSnapshot(), { gameType: 'both' });
  assert.deepEqual(response.months.map((month) => month.key), ['2026-09', '2026-08', '2026-07']);
  assert.deepEqual(response.months[1], {
    key: '2026-08',
    year: 2026,
    month: 8,
    sessionCount: 2,
    handCount: 3,
    matchingHandCount: 3,
    cashSessionCount: 1,
    tournamentSessionCount: 1,
  });
  assert.equal(response.months[2].handCount, 1);
  assert.deepEqual(response.availableRanks, [
    { id: 'HIGH_CARD', count: 1 },
    { id: 'PAIR', count: 2 },
    { id: 'STRAIGHT', count: 1 },
    { id: 'FLUSH', count: 1 },
  ]);

  const filtered = createSessionMonthsResponse(createSnapshot(), { gameType: 'both', handRanking: 'PAIR' });
  assert.deepEqual(filtered.months.map((month) => [month.key, month.handCount, month.matchingHandCount]), [
    ['2026-08', 2, 1],
    ['2026-07', 1, 1],
  ]);
  assert.deepEqual(filtered.availableRanks, response.availableRanks);
});

test('zakres dat przecina miesiąc, a pusty zakres i dataset zwracają pusty indeks', () => {
  const snapshot = createSnapshot();
  const partial = createSessionMonthsResponse(snapshot, {
    gameType: 'both',
    dateFrom: '2026-08-10',
    dateTo: '2026-08-20',
  });
  assert.deepEqual(partial.months.map((month) => month.key), ['2026-08']);
  assert.equal(partial.months[0].sessionCount, 1);
  assert.equal(partial.months[0].tournamentSessionCount, 1);
  assert.equal(createSessionMonthsResponse(snapshot, {
    gameType: 'cash', dateFrom: '2025-01-01', dateTo: '2025-01-31',
  }).months.length, 0);
  assert.deepEqual(createSessionMonthsResponse({
    ...snapshot,
    hands: [],
    sessions: { cash: [], tournament: [] },
    sessionsById: new Map(),
  }, {}).months, []);
});

test('API miesiąca przecina filtry i zachowuje stary kontrakt bez month', async (t) => {
  const snapshot = createSnapshot();
  const baseUrl = await startApi(t, snapshot);
  const legacyExpected = createSessionsResponse(snapshot, { gameType: 'both' });
  const legacy = await fetch(`${baseUrl}/api/sessions?gameType=both`).then((response) => response.json());
  assert.deepEqual(legacy, legacyExpected);

  const august = await fetch(`${baseUrl}/api/sessions?gameType=both&month=2026-08&dateFrom=2026-08-10`)
    .then((response) => response.json());
  assert.deepEqual(august.sessions.map((session) => session.id), ['tournament-august']);
  assert.equal(JSON.stringify(august).includes('rawText'), false);
  assert.equal(JSON.stringify(august).includes('chartData'), false);

  const empty = await fetch(`${baseUrl}/api/sessions?gameType=cash&month=2026-09`).then((response) => response.json());
  assert.deepEqual(empty.sessions, []);

  const invalid = await fetch(`${baseUrl}/api/sessions?month=2026-13`);
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, 'DATA_INVALID_QUERY');
});

test('API indeksu zwraca lekki kontrakt, a zbiorcze ID zachowuje kolejność i raportuje braki', async (t) => {
  const snapshot = createSnapshot();
  const baseUrl = await startApi(t, snapshot);
  const indexResponse = await fetch(`${baseUrl}/api/session-months?gameType=both&dateFrom=2026-08-01`);
  assert.equal(indexResponse.status, 200);
  const index = await indexResponse.json();
  assert.equal(index.datasetRevision, snapshot.datasetRevision);
  assert.equal(index.dateFrom, '2026-08-01');
  assert.equal(JSON.stringify(index).includes('rawText'), false);
  assert.equal(JSON.stringify(index).includes('hands'), false);

  const resolvedResponse = await fetch(`${baseUrl}/api/session-summaries/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      datasetRevision: snapshot.datasetRevision,
      sessionIds: ['tournament-august', 'missing', 'cash-july'],
    }),
  });
  assert.equal(resolvedResponse.status, 200);
  const resolved = await resolvedResponse.json();
  assert.deepEqual(resolved.sessions.map((session) => session.id), ['tournament-august', 'cash-july']);
  assert.deepEqual(resolved.missingSessionIds, ['missing']);
  assert.equal(JSON.stringify(resolved).includes('rawText'), false);
  assert.equal(JSON.stringify(resolved).includes('chartData'), false);
  assert.equal(JSON.stringify(resolved).includes('hands'), false);

  const mismatch = await fetch(`${baseUrl}/api/session-summaries/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datasetRevision: 'old', sessionIds: ['cash-july'] }),
  });
  assert.equal(mismatch.status, 409);
  assert.equal((await mismatch.json()).code, 'DATASET_REVISION_MISMATCH');
});
