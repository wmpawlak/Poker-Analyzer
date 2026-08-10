import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createApiApp } from '../server/app.js';
import { createDataImportService } from '../server/dataImportService.js';
import { MAX_WALLET_POINTS, downsampleWalletTimeline } from '../server/dataQueries.js';
import { makeHand } from './helpers/pokerHands.js';

const startApi = async (t, dataDirectory, options = {}) => {
  const server = createApiApp({ dataDirectory, logger: { error: () => {} }, ...options }).listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}`;
};

const createTemporaryDataDirectory = async (t) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'poker-analyzer-api-'));
  t.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  return dataDirectory;
};

const makeIndexedHand = ({
  id,
  timestamp,
  handRanking = 'PAIR',
  netProfit = 0,
  isTournament = false,
  sessionId = 'cash:test-table',
  gameVariant = 'NLH',
  heroCards = ['Ah', 'Kd'],
} = {}) => ({
  id: String(id),
  timestamp,
  dateStr: '2026/08/01',
  timeStr: '12:00:00',
  gameType: 'NLH',
  gameVariant,
  isTournament,
  sessionId,
  tableId: isTournament ? '' : 'test-table',
  tourneyId: isTournament ? 'tournament-1' : '',
  tourneyName: isTournament ? 'Test tournament' : '',
  heroCards,
  boardCards: [],
  handRanking,
  handRankingSource: 'SUMMARY',
  position: 'BTN',
  outcome: netProfit >= 0 ? 'WON' : 'LOST',
  netProfit,
  heroWinnings: Math.max(netProfit, 0),
  heroInvestment: Math.max(-netProfit, 0),
  heroSawFlop: false,
  sawShowdown: false,
  heroReachedRiverOrShowdown: false,
});

const createSnapshot = (hands, datasetRevision = 'test-revision') => {
  const cashHands = hands.filter((hand) => !hand.isTournament);
  const tournamentHands = hands.filter((hand) => hand.isTournament);
  const cashSession = {
    id: 'cash:test-table',
    type: 'Cash',
    tableId: 'test-table',
    startTime: 1,
    lastTimestamp: Math.max(...cashHands.map((hand) => hand.timestamp), 1),
    dateStr: '2026/08/01',
    totalProfit: cashHands.reduce((total, hand) => total + hand.netProfit, 0),
    fingerprint: 'cash-fingerprint',
    hands: cashHands,
    chartData: [],
  };
  const tournamentSession = {
    id: 'tournament:test',
    type: 'Tournament',
    tourneyId: 'tournament-1',
    tourneyName: 'Test tournament',
    startTime: 1,
    lastTimestamp: Math.max(...tournamentHands.map((hand) => hand.timestamp), 1),
    dateStr: '2026/08/01',
    totalProfit: tournamentHands.reduce((total, hand) => total + hand.netProfit, 0),
    fingerprint: 'tournament-fingerprint',
    hands: tournamentHands,
    chartData: [],
  };
  const cashSessions = cashHands.length ? [cashSession] : [];
  const tournamentSessions = tournamentHands.length ? [tournamentSession] : [];
  return {
    datasetRevision,
    hands,
    sessions: { cash: cashSessions, tournament: tournamentSessions },
    sessionsById: new Map([...cashSessions, ...tournamentSessions].map((session) => [session.id, session])),
  };
};

const createSnapshotApiOptions = (snapshot) => ({
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

test('API stronicuje ręce sesji bez rawText, a szczegół pobiera dopiero na żądanie', async (t) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'poker-analyzer-api-'));
  t.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const importer = createDataImportService({ dataDirectory });
  await importer.importText({
    filename: 'hands.txt',
    content: [
      makeHand({ id: '7201', date: '2026/08/01 12:00:01' }),
      makeHand({ id: '7202', date: '2026/08/01 12:00:02' }),
      makeHand({ id: '7203', date: '2026/08/01 12:00:03' }),
    ].join('\n\n'),
  });
  const baseUrl = await startApi(t, dataDirectory);
  const sessions = await fetch(`${baseUrl}/api/sessions?gameType=cash`).then((response) => response.json());
  assert.equal(sessions.sessions.length, 1);
  const firstPage = await fetch(`${baseUrl}/api/sessions/${sessions.sessions[0].id}/hands?limit=1`)
    .then((response) => response.json());
  const secondPage = await fetch(`${baseUrl}/api/sessions/${sessions.sessions[0].id}/hands?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`)
    .then((response) => response.json());
  assert.equal(firstPage.hands.length, 1);
  assert.equal(secondPage.hands.length, 1);
  assert.notEqual(firstPage.hands[0].id, secondPage.hands[0].id);
  assert.equal(JSON.stringify(firstPage).includes('rawText'), false);

  const hand = await fetch(`${baseUrl}/api/hands/${firstPage.hands[0].id}`).then((response) => response.json());
  assert.equal(typeof hand.hand.rawText, 'string');
  assert.equal(hand.datasetRevision, firstPage.datasetRevision);
});

test('downsampling walletu ogranicza serię do 1200 punktów i zachowuje końce', () => {
  const timeline = Array.from({ length: 2_401 }, (_, index) => ({
    handIndex: index + 1,
    profit: index === 1_200 ? -100 : index,
  }));
  const sampled = downsampleWalletTimeline(timeline);
  assert.ok(sampled.length <= MAX_WALLET_POINTS);
  assert.deepEqual(sampled[0], timeline[0]);
  assert.deepEqual(sampled.at(-1), timeline.at(-1));
  assert.equal(sampled.some((point) => point.handIndex === 1_201), true);
});

test('API filters ranks before pagination and binds cursors to filters and sorting', async (t) => {
  const hands = Array.from({ length: 101 }, (_, index) => makeIndexedHand({
    id: index + 1,
    timestamp: index + 1,
    handRanking: index === 0 ? 'FOUR_OF_A_KIND' : 'PAIR',
    netProfit: index === 100 ? 100 : -index,
  }));
  const snapshot = createSnapshot(hands);
  const baseUrl = await startApi(t, await createTemporaryDataDirectory(t), createSnapshotApiOptions(snapshot));

  const sessions = await fetch(`${baseUrl}/api/sessions?gameType=cash`).then((response) => response.json());
  assert.deepEqual(sessions.availableRanks, [
    { id: 'PAIR', count: 100 },
    { id: 'FOUR_OF_A_KIND', count: 1 },
  ]);
  assert.equal(sessions.sessions[0].matchingHandCount, 101);

  const filteredSessions = await fetch(`${baseUrl}/api/sessions?gameType=cash&handRanking=FOUR_OF_A_KIND`)
    .then((response) => response.json());
  assert.equal(filteredSessions.sessions.length, 1);
  assert.equal(filteredSessions.sessions[0].matchingHandCount, 1);

  const unfilteredPage = await fetch(`${baseUrl}/api/sessions/cash%3Atest-table/hands?limit=100`)
    .then((response) => response.json());
  assert.equal(unfilteredPage.hands.some((hand) => hand.handRanking === 'FOUR_OF_A_KIND'), false);

  const filteredPage = await fetch(`${baseUrl}/api/sessions/cash%3Atest-table/hands?handRanking=FOUR_OF_A_KIND&limit=1`)
    .then((response) => response.json());
  assert.deepEqual(filteredPage.hands.map((hand) => hand.id), ['1']);
  assert.equal(filteredPage.total, 1);

  const sortedPage = await fetch(`${baseUrl}/api/sessions/cash%3Atest-table/hands?sortBy=profit&sortOrder=desc&limit=1`)
    .then((response) => response.json());
  assert.deepEqual(sortedPage.hands.map((hand) => hand.id), ['101']);

  const pairPage = await fetch(`${baseUrl}/api/sessions/cash%3Atest-table/hands?handRanking=PAIR&limit=1`)
    .then((response) => response.json());
  const invalidCursorResponse = await fetch(`${baseUrl}/api/sessions/cash%3Atest-table/hands?handRanking=FOUR_OF_A_KIND&limit=1&cursor=${encodeURIComponent(pairPage.nextCursor)}`);
  assert.equal(invalidCursorResponse.status, 400);
  assert.equal((await invalidCursorResponse.json()).code, 'DATA_INVALID_QUERY');
});

test('hand collections deduplicate IDs, omit deleted hands, and return summaries', async (t) => {
  const snapshot = createSnapshot([
    makeIndexedHand({ id: 'cash-a', timestamp: 1, netProfit: 1 }),
    makeIndexedHand({ id: 'cash-b', timestamp: 2, handRanking: 'FULL_HOUSE', netProfit: 2 }),
    makeIndexedHand({ id: 'tournament-a', timestamp: 3, isTournament: true, netProfit: 3 }),
  ]);
  const baseUrl = await startApi(t, await createTemporaryDataDirectory(t), createSnapshotApiOptions(snapshot));
  const query = {
    datasetRevision: snapshot.datasetRevision,
    gameType: 'cash',
    mode: 'analyzed',
    analyzedHandIds: ['cash-a', 'cash-a', 'cash-b', 'missing', 'tournament-a'],
    savedHandIds: ['cash-b', 'cash-b', 'missing', 'tournament-a'],
    limit: 1,
  };
  const firstResponse = await fetch(`${baseUrl}/api/hand-collections/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
  });
  assert.equal(firstResponse.status, 200);
  const firstPage = await firstResponse.json();
  assert.deepEqual(firstPage.hands.map((hand) => hand.id), ['cash-b']);
  assert.deepEqual(firstPage.collectionCounts, { analyzed: 2, saved: 1 });
  assert.equal(JSON.stringify(firstPage).includes('rawText'), false);

  const savedPage = await fetch(`${baseUrl}/api/hand-collections/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...query, mode: 'saved', handRanking: 'FULL_HOUSE' }),
  }).then((response) => response.json());
  assert.deepEqual(savedPage.hands.map((hand) => hand.id), ['cash-b']);
  assert.equal(savedPage.total, 1);

  const changedIdsResponse = await fetch(`${baseUrl}/api/hand-collections/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...query,
      analyzedHandIds: ['cash-a'],
      cursor: firstPage.nextCursor,
    }),
  });
  assert.equal(changedIdsResponse.status, 400);

  const outdatedRevisionResponse = await fetch(`${baseUrl}/api/hand-collections/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...query, datasetRevision: 'old-revision' }),
  });
  assert.equal(outdatedRevisionResponse.status, 409);
  assert.equal((await outdatedRevisionResponse.json()).code, 'DATASET_REVISION_MISMATCH');
});

test('API kart startowych agreguje tylko NLH i NLH BombPot oraz raportuje pominięte ręce', async (t) => {
  const snapshot = createSnapshot([
    makeIndexedHand({ id: 'nlh', timestamp: 1, heroCards: ['Ah', 'Kd'] }),
    makeIndexedHand({ id: 'bomb-pot', timestamp: 2, gameVariant: 'NLH BombPot', heroCards: ['Qs', 'Js'] }),
    makeIndexedHand({ id: 'plo', timestamp: 3, gameVariant: 'PLO 4', heroCards: ['Ah', 'Kd', 'Qc', 'Js'] }),
    makeIndexedHand({ id: 'invalid', timestamp: 4, heroCards: ['Ah', 'Ah'] }),
  ]);
  const baseUrl = await startApi(t, await createTemporaryDataDirectory(t), createSnapshotApiOptions(snapshot));

  const response = await fetch(`${baseUrl}/api/cards?gameType=cash`);
  assert.equal(response.status, 200);
  const cards = await response.json();
  assert.equal(cards.hands.length, 169);
  assert.equal(cards.candidateHandCount, 4);
  assert.equal(cards.indexedHandCount, 2);
  assert.equal(cards.excludedHandCount, 2);
  assert.deepEqual(cards.excludedByReason, { unsupportedVariant: 1, invalidHeroCards: 1 });
  assert.equal(cards.populatedClassCount, 2);
  assert.equal(cards.hands.reduce((count, hand) => count + hand.count, 0), 2);

  const riverOnly = await fetch(`${baseUrl}/api/cards?gameType=cash&riverOrShowdownOnly=true`).then((result) => result.json());
  assert.equal(riverOnly.indexedHandCount, 2);
  assert.equal(riverOnly.hands.reduce((count, hand) => count + hand.count, 0), 0);
});

test('API podglądu grupy sesji zwraca metryki bez wywołania modelu ani rawText', async (t) => {
  const snapshot = createSnapshot([
    makeIndexedHand({ id: 'cash-preview', timestamp: 1, sessionId: 'cash:test-table' }),
    makeIndexedHand({ id: 'tournament-preview', timestamp: 2, isTournament: true, sessionId: 'tournament:test' }),
  ]);
  let providerCalls = 0;
  const baseUrl = await startApi(t, await createTemporaryDataDirectory(t), {
    ...createSnapshotApiOptions(snapshot),
    fetchImpl: async () => {
      providerCalls += 1;
      throw new Error('Podgląd nie może wywołać dostawcy AI.');
    },
  });

  const response = await fetch(`${baseUrl}/api/session-groups/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionIds: ['cash:test-table', 'tournament:test'],
      datasetRevision: snapshot.datasetRevision,
    }),
  });
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.equal(preview.datasetRevision, snapshot.datasetRevision);
  assert.equal(preview.activeCategory, 'both');
  assert.equal(preview.sessionCount, 2);
  assert.equal(preview.handCount, 2);
  assert.deepEqual(preview.categoryBreakdown, {
    cash: { sessionCount: 1, handCount: 1 },
    tournament: { sessionCount: 1, handCount: 1 },
  });
  assert.equal(preview.metrics.shared.hands, 2);
  assert.equal(preview.sources.length, 2);
  assert.equal(JSON.stringify(preview).includes('rawText'), false);
  assert.equal(providerCalls, 0);
});
