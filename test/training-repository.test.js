import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  TRAINING_COLLECTION_FILENAME,
  createEmptyTrainingCollection,
  createTrainingRepository,
  readTrainingCollection,
  writeTrainingCollection,
} from '../server/training/trainingRepository.js';
import { CARD_FACTS_VALIDATION_VERSION } from '../server/training/decisionCardFacts.js';

const makeDirectory = () => fs.mkdtemp(path.join(os.tmpdir(), 'poker-training-repository-'));

const makeHand = ({
  id,
  playedAt = '2026-08-01T10:00:00.000Z',
  gameType = 'cash',
  cards = 'Ah Kd',
} = {}) => ({
  handId: String(id),
  gameType,
  playedAt,
  rawText: `CoinPoker Hand #${id}: NLH (0.50/1) 2026/08/01 12:00:00 UTC
Table 'training-repository' 2-max Seat #1 is the button
Seat 1: Hero (100 in chips)
Seat 2: Villain (100 in chips)
Hero: posts small blind 0.50
Villain: posts big blind 1
*** HOLE CARDS ***
Dealt to Hero [${cards}]
Hero: folds
*** SUMMARY ***
Seat 1: Hero folded before Flop`,
});

const eligibleKey = (spot, id = `key-${spot.versionId}`) => ({
  id,
  spotVersionId: spot.versionId,
  status: 'ready',
  confidence: 'high',
  localFactsValid: true,
  decisionCardFacts: spot.decisionCardFacts,
  factsValidationVersion: CARD_FACTS_VALIDATION_VERSION,
  preferredAnswer: 'fold',
});

test('odczytuje pustą wersjonowaną kolekcję i zapisuje ją atomowo bez rawText', async () => {
  const directory = await makeDirectory();
  try {
    const empty = await readTrainingCollection(directory);
    assert.deepEqual(empty, createEmptyTrainingCollection());

    await writeTrainingCollection(empty, directory);
    const stored = JSON.parse(await fs.readFile(path.join(directory, TRAINING_COLLECTION_FILENAME), 'utf8'));
    assert.equal(stored.version, 1);
    assert.deepEqual(stored.spots, []);
    assert.equal((await fs.readdir(directory)).some((name) => name.endsWith('.tmp')), false);

    await assert.rejects(
      () => writeTrainingCollection({
        ...empty,
        sessions: [{ id: 'unsafe', rawText: 'CoinPoker Hand #1' }],
      }, directory),
      /rawText/,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('skan jest idempotentny i nie przelicza niezmienionego fingerprintu', async () => {
  const directory = await makeDirectory();
  try {
    const repository = createTrainingRepository({ dataDirectory: directory });
    const hand = makeHand({ id: 83001 });
    const first = await repository.scanCanonicalHands([hand], { datasetRevision: 'revision-1' });
    const second = await repository.scanCanonicalHands([hand], { datasetRevision: 'revision-1' });

    assert.equal(first.result.new, 1);
    assert.equal(first.result.spotsAdded, 1);
    assert.equal(second.result.unchanged, 1);
    assert.equal(second.result.spotsAdded, 0);
    assert.equal(second.collection.spots.length, 1);
    assert.equal(second.collection.scanState.datasetRevision, 'revision-1');
    assert.equal(second.collection.scanState.sources['83001'].spotVersionIds.length, 1);
    assert.deepEqual(second.collection.spots[0].historicalResult, {
      outcome: 'FOLDED', heroWinnings: 0, heroInvestment: 0.5, netProfit: -0.5,
      sawShowdown: false, handRanking: 'HIGH_CARD',
    });
    assert.equal(JSON.stringify(second.collection.spots[0].historicalResult).includes('rawText'), false);

    const spot = second.collection.spots[0];
    const saved = await repository.saveAnswerKeys([eligibleKey(spot, 'idempotent-key')]);
    const repeated = await repository.saveAnswerKeys([eligibleKey(spot, 'idempotent-key')]);
    assert.equal(saved.result.added, 1);
    assert.equal(repeated.result.added, 0);
    assert.equal(repeated.collection.answerKeys.length, 1);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('scan restores a previously omitted spot without deleting retained keys', async () => {
  const directory = await makeDirectory();
  try {
    const repository = createTrainingRepository({ dataDirectory: directory });
    const hands = [makeHand({ id: 83010 }), makeHand({ id: 83011 })];
    const first = await repository.scanCanonicalHands(hands);
    const kept = first.collection.spots[0];
    const omitted = first.collection.spots[1];
    await repository.saveAnswerKeys([eligibleKey(kept, 'kept-key')]);
    const beforeRepair = await repository.getSnapshot();
    await writeTrainingCollection({
      ...beforeRepair,
      spots: beforeRepair.spots.filter(({ versionId }) => versionId !== omitted.versionId),
    }, directory);

    const repairedRepository = createTrainingRepository({ dataDirectory: directory });
    const repaired = await repairedRepository.scanCanonicalHands(hands);
    assert.equal(repaired.result.spotsAdded, 1);
    assert.equal(repaired.collection.spots.length, 2);
    assert.equal(repaired.collection.spots.some(({ versionId }) => versionId === omitted.versionId), true);
    assert.deepEqual(repaired.collection.answerKeys.map(({ id }) => id), ['kept-key']);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('zmiana i usunięcie rozdania wyłącza spot, lecz zachowuje klucz i historyczną próbę', async () => {
  const directory = await makeDirectory();
  try {
    const repository = createTrainingRepository({ dataDirectory: directory });
    const original = makeHand({ id: 83002, cards: 'Ah Kd' });
    const changed = makeHand({ id: 83002, cards: 'Qh Qd' });
    const scanned = await repository.scanCanonicalHands([original]);
    const originalSpot = scanned.collection.spots[0];
    await repository.saveAnswerKeys([eligibleKey(originalSpot, 'key-original')]);
    await repository.saveSession({ id: 'session-1', exerciseType: 'preflop_selection' });
    await repository.saveAttempt({
      id: 'attempt-1',
      sessionId: 'session-1',
      spotVersionId: originalSpot.versionId,
      answer: 'fold',
    });
    assert.equal((await repository.getActiveSpots()).length, 1);

    const changedScan = await repository.scanCanonicalHands([changed]);
    assert.equal(changedScan.result.changed, 1);
    assert.equal(changedScan.collection.spots.length, 2);
    const archivedOriginal = changedScan.collection.spots.find(
      ({ versionId }) => versionId === originalSpot.versionId,
    );
    assert.equal(archivedOriginal.sourceStatus, 'changed');
    assert.equal(archivedOriginal.active, false);
    assert.equal(changedScan.collection.answerKeys[0].archiveReason, 'source_changed');
    assert.equal(changedScan.collection.attempts[0].id, 'attempt-1');

    const removedScan = await repository.scanCanonicalHands([]);
    assert.equal(removedScan.result.removed, 1);
    assert.equal((await repository.getActiveSpots()).length, 0);
    assert.equal(removedScan.collection.attempts.length, 1);
    assert.equal(removedScan.collection.answerKeys.length, 1);

    const restoredScan = await repository.scanCanonicalHands([original]);
    assert.equal(restoredScan.result.restored, 1);
    assert.equal(restoredScan.result.spotsAdded, 0);
    assert.equal((await repository.getActiveSpots()).length, 1);
    const restoredKey = restoredScan.collection.answerKeys.find(({ id }) => id === 'key-original');
    assert.equal(restoredKey.archiveReason, null);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('pierwszy skan zapisuje najwyżej 100 wybranych spotów osobno dla Cash i turniejów', async () => {
  const directory = await makeDirectory();
  try {
    const repository = createTrainingRepository({ dataDirectory: directory });
    const hands = [];
    for (const gameType of ['cash', 'tournament']) {
      for (let index = 0; index < 101; index += 1) {
        hands.push(makeHand({
          id: `${gameType === 'cash' ? 84 : 85}${String(index).padStart(3, '0')}`,
          gameType,
          playedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
        }));
      }
    }
    const scan = await repository.scanCanonicalHands(hands);
    assert.equal(scan.collection.spots.length, 202);
    await repository.saveAnswerKeys(scan.collection.spots.map((spot) => eligibleKey(spot)));

    const cash = await repository.getActiveSpots({
      exerciseType: 'preflop_selection',
      gameType: 'cash',
    });
    const tournament = await repository.getActiveSpots({
      exerciseType: 'preflop_selection',
      gameType: 'tournament',
    });
    assert.equal(cash.length, 100);
    assert.equal(tournament.length, 100);
    assert.equal(cash.some(({ handId }) => handId === '84000'), false);
    assert.equal(cash.some(({ handId }) => handId === '84100'), true);

    const snapshot = await repository.getSnapshot();
    assert.equal(snapshot.spots.some(({ handId }) => handId === '84000'), true);
    assert.equal(snapshot.answerKeys.length, 202);
    assert.equal(snapshot.selectionState.strategy, 'diverse_recent_v1');
    assert.equal(snapshot.selectionState.selectedSpotVersionIds.length, 200);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('zwykły skan utrzymuje wybór, uzupełnia wakat, a przebudowa może wymienić zestaw', async () => {
  const directory = await makeDirectory();
  try {
    const repository = createTrainingRepository({ dataDirectory: directory, activePoolLimit: 2 });
    const hand1 = makeHand({ id: 86001, playedAt: '2026-08-01T10:00:00.000Z' });
    const hand2 = makeHand({ id: 86002, playedAt: '2026-08-02T10:00:00.000Z' });
    const hand3 = makeHand({ id: 86003, playedAt: '2026-08-03T10:00:00.000Z' });
    const first = await repository.scanCanonicalHands([hand1, hand2]);
    const initialIds = first.collection.selectionState.selectedSpotVersionIds;

    const stable = await repository.scanCanonicalHands([hand1, hand2, hand3]);
    assert.deepEqual(
      new Set(stable.collection.selectionState.selectedSpotVersionIds),
      new Set(initialIds),
    );
    assert.equal(stable.collection.spots.some(({ handId }) => handId === '86003'), true);

    const filled = await repository.scanCanonicalHands([hand2, hand3]);
    assert.equal(filled.collection.selectionState.selectedSpotVersionIds.length, 2);
    assert.equal(filled.collection.spots.some(({ handId }) => handId === '86001'), true);
    assert.equal(filled.collection.spots.some(({ handId }) => handId === '86003'), true);

    const rebuilt = await repository.scanCanonicalHands([hand1, hand2, hand3], { rebuildSelection: true });
    assert.equal(rebuilt.collection.selectionState.selectedSpotVersionIds.length, 2);
    assert.equal(rebuilt.collection.spots.some(({ handId }) => handId === '86001'), true);
    assert.deepEqual(new Set(rebuilt.collection.spots.map(({ handId }) => handId)), new Set(['86001', '86002', '86003']));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('przebudowa nie usuwa migawek zadania AI możliwego do wznowienia', async () => {
  const directory = await makeDirectory();
  try {
    const repository = createTrainingRepository({ dataDirectory: directory });
    const scanned = await repository.scanCanonicalHands([makeHand({ id: 86004 })]);
    const spotId = scanned.collection.spots[0].versionId;
    await repository.saveRefreshJob({
      id: 'resumable-job', status: 'stopped', cursor: 0, candidateSpotVersionIds: [spotId],
    });
    await assert.rejects(
      () => repository.scanCanonicalHands([makeHand({ id: 86004 })], { rebuildSelection: true }),
      (error) => error.code === 'TRAINING_SELECTION_REBUILD_BLOCKED',
    );
    assert.equal((await repository.getSnapshot()).spots[0].versionId, spotId);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('migracja starej kolekcji wybiera pulę i bezpiecznie kończy nieograniczone zadanie AI', async () => {
  const directory = await makeDirectory();
  try {
    const collection = createEmptyTrainingCollection();
    collection.spots = Array.from({ length: 101 }, (_, index) => ({
      versionId: `legacy-${index}`, handId: `legacy-hand-${index}`,
      sourceStatus: 'current', exerciseType: 'preflop_selection', gameType: 'cash',
      street: 'PRE_FLOP', playedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      readiness: 'pending_key', active: false,
      answerOptions: [{ id: 'fold', action: 'fold' }, { id: 'raise', action: 'raise' }],
      question: {
        street: 'PRE_FLOP', heroCards: ['Ah', 'Kd'], board: [], heroPosition: 'BTN',
        blinds: { smallBlind: 0.5, bigBlind: 1, ante: 0 }, pot: 1.5, toCall: 0, potOdds: 0,
        effectiveStack: 100, effectiveStackBb: 100, effectiveStackBehind: 99, effectiveStackBehindBb: 99,
        effectiveStackByOpponent: [], players: [], priorActions: [], legalActions: ['fold', 'raise'],
        context: { opponentsInHand: 1, preflopRaiseCount: 0, facingRaiseLevel: 0, isFacingReraise: false, isFacingReshove: false },
      },
    }));
    collection.refreshJobs = [{
      id: 'legacy-refresh', status: 'stop_requested', cursor: 20, candidateCount: 26_742,
      candidateSpotVersionIds: collection.spots.map(({ versionId }) => versionId), errors: [],
    }];
    await writeTrainingCollection(collection, directory);
    const snapshot = await createTrainingRepository({ dataDirectory: directory }).getSnapshot();
    assert.equal(snapshot.selectionState.selectedSpotVersionIds.length, 100);
    assert.equal(snapshot.spots.length, 101);
    assert.equal(snapshot.refreshJobs[0].status, 'superseded');
    assert.equal(snapshot.refreshJobs[0].errors.at(-1).code, 'TRAINING_REFRESH_SELECTION_SUPERSEDED');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('tylko klucz gotowy, wysoko pewny i zgodny z faktami aktywuje spot', async () => {
  const directory = await makeDirectory();
  try {
    const repository = createTrainingRepository({ dataDirectory: directory });
    const scan = await repository.scanCanonicalHands([
      makeHand({ id: 83003 }),
      makeHand({ id: 83004 }),
      makeHand({ id: 83005 }),
    ]);
    const [ready, lowConfidence, invalidFacts] = scan.collection.spots;
    await repository.saveAnswerKeys([
      eligibleKey(ready, 'ready'),
      { ...eligibleKey(lowConfidence, 'low'), confidence: 'medium' },
      { ...eligibleKey(invalidFacts, 'invalid'), localFactsValid: false },
    ]);

    assert.deepEqual((await repository.getActiveSpots()).map(({ versionId }) => versionId), [ready.versionId]);
    const snapshot = await repository.getSnapshot();
    assert.equal(snapshot.spots.find(({ versionId }) => versionId === lowConfidence.versionId).readiness, 'review');
    assert.equal(snapshot.spots.find(({ versionId }) => versionId === invalidFacts.versionId).readiness, 'review');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('równoległe zapisy sesji i prób są serializowane bez utraty historii', async () => {
  const directory = await makeDirectory();
  try {
    const repository = createTrainingRepository({ dataDirectory: directory });
    await Promise.all(Array.from({ length: 20 }, (_, index) => (
      repository.saveSession({ id: `session-${index}`, completed: false })
    )));
    await Promise.all(Array.from({ length: 20 }, (_, index) => (
      repository.saveAttempt({ id: `attempt-${index}`, sessionId: `session-${index}` })
    )));

    const reopened = createTrainingRepository({ dataDirectory: directory });
    const snapshot = await reopened.getSnapshot();
    assert.equal(snapshot.sessions.length, 20);
    assert.equal(snapshot.attempts.length, 20);
    assert.equal(snapshot.revision, 40);
    assert.equal((await fs.readdir(directory)).some((name) => name.endsWith('.tmp')), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('audyt usuwa caĹ‚e rozdanie, naprawia prĂłby i nie uzupeĹ‚nia wakatu po ponownym skanie', async () => {
  const directory = await makeDirectory();
  try {
    const originalRepository = createTrainingRepository({ dataDirectory: directory, auditExclusions: [] });
    const auditedHand = makeHand({ id: 83020, cards: 'Ah Kd' });
    const retainedHand = makeHand({ id: 83021, cards: 'Qh Qd' });
    const initial = await originalRepository.scanCanonicalHands([auditedHand, retainedHand]);
    const auditedSpot = initial.collection.spots.find((spot) => spot.handId === '83020');
    const retainedSpot = initial.collection.spots.find((spot) => spot.handId === '83021');
    await originalRepository.saveAnswerKeys([
      eligibleKey(auditedSpot, 'audit-key'),
      eligibleKey(retainedSpot, 'retained-key'),
    ]);
    await originalRepository.saveSession({
      id: 'audit-session',
      status: 'active',
      targetSize: 2,
      availableSpotVersionIds: [auditedSpot.versionId, retainedSpot.versionId],
      answeredSpotVersionIds: [auditedSpot.versionId],
      currentSpotVersionId: auditedSpot.versionId,
      lastSpotVersionId: auditedSpot.versionId,
      score: { correct: 1, acceptable: 0, incorrect: 0 },
    });
    await originalRepository.saveAttempt({
      id: 'audit-attempt',
      sessionId: 'audit-session',
      spotVersionId: auditedSpot.versionId,
      grade: 'correct',
    });
    await originalRepository.saveRefreshJob({
      id: 'audit-job',
      status: 'running',
      candidateSpotVersionIds: [auditedSpot.versionId, retainedSpot.versionId],
      candidateCount: 2,
      cursor: 0,
      errors: [],
    });

    const migratedRepository = createTrainingRepository({
      dataDirectory: directory,
      auditExclusions: [{ handId: '83020', fingerprint: auditedSpot.sourceFingerprint }],
    });
    const migrated = await migratedRepository.getSnapshot();
    assert.equal(migrated.spots.some((spot) => spot.handId === '83020'), false);
    assert.equal(migrated.answerKeys.some((key) => key.spotVersionId === auditedSpot.versionId), false);
    assert.equal(migrated.attempts.length, 0);
    assert.deepEqual(migrated.sessions[0].availableSpotVersionIds, [retainedSpot.versionId]);
    assert.deepEqual(migrated.sessions[0].answeredSpotVersionIds, []);
    assert.equal(migrated.sessions[0].currentSpotVersionId, null);
    assert.equal(migrated.sessions[0].lastSpotVersionId, null);
    assert.deepEqual(migrated.sessions[0].score, { correct: 0, acceptable: 0, incorrect: 0 });
    assert.equal(migrated.sessions[0].status, 'active');
    assert.equal(migrated.refreshJobs[0].status, 'superseded');
    assert.deepEqual(migrated.refreshJobs[0].candidateSpotVersionIds, [retainedSpot.versionId]);
    assert.equal(migrated.selectionState.replenishmentDisabled, true);

    const rescanned = await migratedRepository.scanCanonicalHands([
      auditedHand,
      retainedHand,
      makeHand({ id: 83022, cards: 'Js Jd' }),
    ]);
    assert.equal(rescanned.collection.scanState.sources['83020'].status, 'excluded');
    assert.equal(rescanned.collection.spots.some((spot) => spot.handId === '83020'), false);
    assert.equal(rescanned.collection.spots.some((spot) => spot.handId === '83022'), true);
    assert.deepEqual(rescanned.collection.selectionState.selectedSpotVersionIds, [retainedSpot.versionId]);

    const changedSource = await migratedRepository.scanCanonicalHands([
      makeHand({ id: 83020, cards: '2c 2d' }),
      retainedHand,
    ]);
    const changedSpot = changedSource.collection.spots.find((spot) => spot.handId === '83020');
    assert.ok(changedSpot);
    assert.equal(changedSource.collection.scanState.sources['83020'].status, 'current');
    assert.equal(changedSource.collection.selectionState.selectedSpotVersionIds.includes(changedSpot.versionId), true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
