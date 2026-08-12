import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { classifyHeroHand } from '../server/training/heroHandClassifier.js';
import {
  CARD_FACTS_VALIDATION_VERSION,
  TRAINING_ANSWER_KEY_CONTRACT_VERSION,
  buildTrainingAnswerKeyBatchInput,
  validateTrainingAnswerKeyBatch,
} from '../server/training/answerKeyContract.js';
import { computeDecisionCardFacts } from '../server/training/decisionCardFacts.js';
import {
  cleanupTrainingTemporaryFiles,
  createEmptyTrainingCollection,
  createTrainingRepository,
  writeTrainingCollection,
} from '../server/training/trainingRepository.js';
import { createTrainingService } from '../server/training/trainingService.js';

const makeDirectory = () => fs.mkdtemp(path.join(os.tmpdir(), 'poker-training-hardening-'));

const makeSpot = (index = 1, overrides = {}) => ({
  id: `spot-${index}:preflop_selection`,
  versionId: `spot-${index}:preflop_selection@fingerprint-${index}`,
  handId: `hand-${index}`,
  exerciseType: 'preflop_selection',
  gameType: 'cash',
  street: 'PRE_FLOP',
  sourceStatus: 'current',
  readiness: 'ready',
  active: true,
  answerOptions: [
    { id: 'fold', action: 'fold' },
    { id: 'call', action: 'call' },
    { id: 'raise', action: 'raise' },
  ],
  question: {
    street: 'PRE_FLOP',
    heroCards: ['3h', 'Ad'],
    board: [],
    heroPosition: 'BTN',
    blinds: { smallBlind: 0.5, bigBlind: 1, ante: 0 },
    pot: 1.5,
    toCall: 1,
    potOdds: 0.4,
    effectiveStack: 100,
    effectiveStackBb: 100,
    players: [],
    priorActions: [],
    legalActions: ['fold', 'call', 'raise'],
    context: {},
  },
  ...overrides,
});

const makeKey = (spot, overrides = {}) => ({
  spotVersionId: spot.versionId,
  heroHand: { notation: 'A3o', class: 'offsuit' },
  decisionCardFacts: spot.decisionCardFacts || computeDecisionCardFacts({
    heroCards: spot.question.heroCards,
    board: spot.question.board,
  }),
  factsValidationVersion: CARD_FACTS_VALIDATION_VERSION,
  preferredAnswer: 'raise',
  acceptableAlternatives: ['call'],
  confidence: 'high',
  rationale: 'Autorytatywna klasyfikacja ręki wspiera tę decyzję.',
  blockersEquity: 'Blockery i equity są wystarczające.',
  opponentRange: 'Zakres rywala może zawierać A3s jako część obrony.',
  suggestedSizing: { action: 'raise', potRatio: 0, raiseToBb: 3 },
  ...overrides,
});

test('klasyfikacja ręki normalizuje kolejność, suited, offsuit i pary', () => {
  assert.deepEqual(classifyHeroHand(['3h', 'Ad']), { notation: 'A3o', class: 'offsuit' });
  assert.deepEqual(classifyHeroHand(['Ts', 'Ah']), { notation: 'ATo', class: 'offsuit' });
  assert.deepEqual(classifyHeroHand(['2s', 'As']), { notation: 'A2s', class: 'suited' });
  assert.deepEqual(classifyHeroHand(['Qd', 'Qc']), { notation: 'QQ', class: 'pair' });
  assert.deepEqual(classifyHeroHand(['Kd', 'As']), { notation: 'AKo', class: 'offsuit' });
});

test('kontrakt v3 wymaga zgodnych faktów kart i heroHand, ale nie odrzuca suited ręki w zakresie rywala', () => {
  const spot = makeSpot();
  const input = buildTrainingAnswerKeyBatchInput([spot]);
  assert.deepEqual(input.spots[0].heroHand, { notation: 'A3o', class: 'offsuit' });

  const valid = validateTrainingAnswerKeyBatch({ keys: [makeKey(spot)] }, input);
  assert.equal(valid.validKeys.length, 1);

  const wrongFields = validateTrainingAnswerKeyBatch({ keys: [makeKey(spot, {
    heroHand: { notation: 'A3s', class: 'suited' },
  })] }, input);
  assert.equal(wrongFields.validKeys.length, 0);
  assert.match(wrongFields.rejected[0].errors.join(' '), /rozpoznanie ręki/i);

  const wrongExplanation = validateTrainingAnswerKeyBatch({ keys: [makeKey(spot, {
    rationale: 'A3s jest tutaj ręką suited Hero.',
  })] }, input);
  assert.equal(wrongExplanation.validKeys.length, 0);

  const opponentRangeMention = validateTrainingAnswerKeyBatch({ keys: [makeKey(spot, {
    opponentRange: 'Zakres rywala zawiera A3s, ale nie opisuje to ręki Hero.',
  })] }, input);
  assert.equal(opponentRangeMention.validKeys.length, 1);
});

test('migracja kontraktu v1 unieważnia klucze, zadanie i aktywną sesję bez usuwania prób', async () => {
  const directory = await makeDirectory();
  try {
    const collection = createEmptyTrainingCollection();
    const spot = makeSpot();
    spot.currentAnswerKeyId = 'old-key';
    collection.spots = [spot];
    collection.selectionState.selectedAt = '2026-08-01T00:00:00.000Z';
    collection.selectionState.selectedSpotVersionIds = [spot.versionId];
    collection.answerKeys = [{
      id: 'old-key', spotVersionId: spot.versionId, contractVersion: 1,
      status: 'ready', confidence: 'high', localFactsValid: true, preferredAnswer: 'raise',
    }];
    collection.refreshJobs = [{
      id: 'old-job', contractVersion: 1, status: 'running', cursor: 0,
      candidateSpotVersionIds: [spot.versionId], candidateCount: 1, errors: [],
    }];
    collection.sessions = [{
      id: 'old-session', status: 'active', availableSpotVersionIds: [spot.versionId],
      answeredSpotVersionIds: [], currentSpotVersionId: spot.versionId,
    }];
    collection.attempts = [{ id: 'old-attempt', sessionId: 'old-session', spotVersionId: spot.versionId, answerKeyId: 'old-key', grade: 'correct' }];
    await writeTrainingCollection(collection, directory);

    const snapshot = await createTrainingRepository({ dataDirectory: directory }).getSnapshot();
    assert.equal(snapshot.answerKeys[0].status, 'superseded');
    assert.equal(snapshot.answerKeys[0].historicalOnly, true);
    assert.equal(snapshot.spots[0].readiness, 'pending_key');
    assert.equal(snapshot.spots[0].active, false);
    assert.equal(snapshot.refreshJobs[0].status, 'superseded');
    assert.equal(snapshot.sessions[0].status, 'abandoned');
    assert.equal(snapshot.sessions[0].currentSpotVersionId, null);
    assert.equal(snapshot.attempts.length, 1);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('zapis ponawia przejściowe EPERM, sprząta tmp i zachowuje poprzedni plik po trwałej awarii', async () => {
  const directory = await makeDirectory();
  try {
    const collection = createEmptyTrainingCollection();
    await writeTrainingCollection(collection, directory);
    const filePath = path.join(directory, 'poker-training-v1.json');
    const original = await fs.readFile(filePath, 'utf8');
    let attempts = 0;
    await writeTrainingCollection({ ...collection, revision: 1 }, directory, {
      renameImpl: async (from, to) => {
        attempts += 1;
        if (attempts < 4) {
          const error = new Error('plik chwilowo zablokowany');
          error.code = 'EPERM';
          throw error;
        }
        return fs.rename(from, to);
      },
      sleep: async () => {},
    });
    assert.equal(attempts, 4);
    assert.equal((await fs.readdir(directory)).some((name) => name.endsWith('.tmp')), false);

    await assert.rejects(
      () => writeTrainingCollection({ ...collection, revision: 2 }, directory, {
        renameImpl: async () => {
          const error = new Error('blokada');
          error.code = 'EBUSY';
          throw error;
        },
        sleep: async () => {},
      }),
      (error) => error.code === 'TRAINING_COLLECTION_WRITE_FAILED',
    );
    assert.equal(await fs.readFile(filePath, 'utf8'), JSON.stringify({ ...collection, revision: 1 }) + '\n');
    assert.equal((await fs.readdir(directory)).some((name) => name.endsWith('.tmp')), false);
    assert.equal(original.includes('"revision":0'), true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('porzucenie sesji zachowuje historię, a reset ma dwa zakresy i blokadę aktywnego AI', async () => {
  const directory = await makeDirectory();
  try {
    const collection = createEmptyTrainingCollection();
    const spot = makeSpot();
    spot.currentAnswerKeyId = 'key-1';
    collection.spots = [spot];
    collection.answerKeys = [{
      id: 'key-1', spotVersionId: spot.versionId, contractVersion: TRAINING_ANSWER_KEY_CONTRACT_VERSION,
      status: 'ready', confidence: 'high', localFactsValid: true,
      decisionCardFacts: computeDecisionCardFacts({ heroCards: spot.question.heroCards, board: spot.question.board }),
      factsValidationVersion: CARD_FACTS_VALIDATION_VERSION,
      preferredAnswer: 'raise', acceptableAlternatives: ['call'],
    }];
    collection.selectionState.selectedAt = '2026-08-01T00:00:00.000Z';
    collection.selectionState.selectedSpotVersionIds = [spot.versionId];
    await writeTrainingCollection(collection, directory);
    const repository = createTrainingRepository({ dataDirectory: directory });
    let ids = 0;
    const service = createTrainingService({ repository, random: () => 0, idFactory: (prefix) => `${prefix}-${++ids}` });
    const created = await service.createOrResumeSession({ exerciseType: 'preflop_selection', gameType: 'cash', size: 10 });
    await service.getNextQuestion(created.session.id);
    const abandoned = await service.abandonSession(created.session.id);
    assert.equal(abandoned.session.status, 'abandoned');
    assert.equal((await repository.getSnapshot()).attempts.length, 0);
    await assert.rejects(() => service.getNextQuestion(created.session.id), (error) => error.code === 'TRAINING_SESSION_ABANDONED');

    await repository.saveAttempt({ id: 'attempt-1', sessionId: created.session.id, spotVersionId: spot.versionId, grade: 'correct' });
    const cleaned = await service.reset({ scope: 'answer_keys', confirmed: true });
    assert.equal(cleaned.removed.answerKeys, 1);
    assert.equal(cleaned.status.counts.spots, 1);
    assert.equal(cleaned.status.counts.attempts, 1);
    assert.equal((await repository.getSnapshot()).sessions[0].status, 'abandoned');

    const full = await service.reset({ scope: 'all', confirmed: true });
    assert.deepEqual(full.status.counts, { spots: 0, answerKeys: 0, refreshJobs: 0, sessions: 0, attempts: 0 });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('reset jest blokowany, gdy refreshService zgłasza faktycznie działające zadanie', async () => {
  const directory = await makeDirectory();
  try {
    const repository = createTrainingRepository({ dataDirectory: directory });
    const service = createTrainingService({ repository, isRefreshRunning: () => true });
    await assert.rejects(
      () => service.reset({ scope: 'all', confirmed: true }),
      (error) => error.code === 'TRAINING_RESET_BLOCKED',
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('start repozytorium usuwa tylko stare tmp kolekcji treningowej', async () => {
  const directory = await makeDirectory();
  try {
    const oldName = '.poker-training-v1.json.old.tmp';
    const freshName = '.poker-training-v1.json.fresh.tmp';
    const unrelated = '.other-file.old.tmp';
    await Promise.all([oldName, freshName, unrelated].map((name) => fs.writeFile(path.join(directory, name), 'tmp')));
    const oldDate = new Date('2026-08-12T10:00:00.000Z');
    const currentDate = new Date('2026-08-12T12:00:00.000Z');
    await fs.utimes(path.join(directory, oldName), oldDate, oldDate);
    await fs.utimes(path.join(directory, freshName), currentDate, currentDate);
    await cleanupTrainingTemporaryFiles(directory, { now: Date.parse('2026-08-12T12:00:00.000Z') });
    assert.equal(await fs.access(path.join(directory, oldName)).then(() => true, () => false), false);
    assert.equal(await fs.access(path.join(directory, freshName)).then(() => true, () => false), true);
    assert.equal(await fs.access(path.join(directory, unrelated)).then(() => true, () => false), true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
