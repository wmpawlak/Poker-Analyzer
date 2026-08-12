import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  createEmptyTrainingCollection,
  createTrainingRepository,
  writeTrainingCollection,
} from '../server/training/trainingRepository.js';
import { createTrainingService } from '../server/training/trainingService.js';
import {
  CARD_FACTS_VALIDATION_VERSION,
  computeDecisionCardFacts,
} from '../server/training/decisionCardFacts.js';

const makeCbetSpot = (stage) => ({
  id: `hand-1:cbet:1:${stage}`,
  versionId: `hand-1:cbet:1:${stage}@fingerprint`,
  handId: 'hand-1',
  exerciseType: 'cbet_barrels',
  gameType: 'cash',
  street: stage === 'flop' ? 'FLOP' : 'TURN',
  stage,
  episodeId: 'hand-1:cbet:1',
  sequenceIndex: stage === 'flop' ? 1 : 2,
  sequenceLength: 2,
  usesHistoricalLine: stage === 'turn',
  continuationNotice: stage === 'turn' ? 'Turn jest kontynuacją historycznej linii.' : null,
  answerOptions: [
    { id: 'check', action: 'check' },
    { id: 'small_bet', action: 'bet' },
    { id: 'large_bet', action: 'bet' },
  ],
  question: {
    heroCards: ['Ah', 'Kd'], board: stage === 'flop' ? ['2c', '7d', 'Ts'] : ['2c', '7d', 'Ts', 'Qh'],
    heroPosition: 'BTN', effectiveStackBb: 80, players: [], priorActions: [],
  },
  historicalAnswer: { type: 'bet', amount: stage === 'flop' ? 3 : 8 },
  sourceStatus: 'current',
  readiness: 'ready',
  active: true,
  currentAnswerKeyId: `key-${stage}`,
});

const computeFactsForStage = (stage) => computeDecisionCardFacts({
  heroCards: ['Ah', 'Kd'],
  board: stage === 'flop' ? ['2c', '7d', 'Ts'] : stage === 'turn' ? ['2c', '7d', 'Ts', 'Qh'] : [],
});

const makeKey = (stage) => ({
  id: `key-${stage}`,
  spotVersionId: `hand-1:cbet:1:${stage}@fingerprint`,
  status: 'ready', confidence: 'high', localFactsValid: true,
  decisionCardFacts: computeFactsForStage(stage),
  factsValidationVersion: CARD_FACTS_VALIDATION_VERSION,
  preferredAnswer: 'small_bet', acceptableAlternatives: ['check'],
});

const makePreflopSpot = (name) => ({
  id: `hand-${name}:preflop:1`,
  versionId: `hand-${name}:preflop:1@fingerprint`,
  handId: `hand-${name}`,
  exerciseType: 'preflop_selection',
  gameType: 'cash',
  street: 'PREFLOP',
  answerOptions: [
    { id: 'fold', action: 'fold' },
    { id: 'call', action: 'call' },
    { id: 'raise', action: 'raise' },
  ],
  question: {
    heroCards: ['Ah', 'Kd'], board: [], heroPosition: 'BTN',
    effectiveStackBb: 80, players: [], priorActions: [],
  },
  historicalAnswer: { type: 'raise', amount: 2.5 },
  sourceStatus: 'current',
  readiness: 'ready',
  active: true,
  currentAnswerKeyId: `key-${name}`,
});

const makePreflopKey = (name) => ({
  id: `key-${name}`,
  spotVersionId: `hand-${name}:preflop:1@fingerprint`,
  status: 'ready', confidence: 'high', localFactsValid: true,
  decisionCardFacts: computeFactsForStage('preflop'),
  factsValidationVersion: CARD_FACTS_VALIDATION_VERSION,
  preferredAnswer: 'raise', acceptableAlternatives: ['call'],
});

const makeAttempt = (name, grade, answeredAt) => ({
  id: `attempt-${name}`,
  sessionId: 'completed-session',
  spotVersionId: `hand-${name}:preflop:1@fingerprint`,
  answer: grade === 'correct' ? 'raise' : grade === 'acceptable' ? 'call' : 'fold',
  grade,
  answerKeyId: `key-${name}`,
  answeredAt,
  createdAt: answeredAt,
  updatedAt: answeredAt,
});

const selectFixtureSpots = (collection) => {
  collection.selectionState.selectedAt = '2026-01-01T00:00:00.000Z';
  collection.selectionState.selectedSpotVersionIds = collection.spots.map(({ versionId }) => versionId);
};

test('sesja c-bet zadaje turn bezpośrednio po flopie jako historyczną kontynuację', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'poker-training-sequence-'));
  try {
    const collection = createEmptyTrainingCollection();
    collection.spots = [makeCbetSpot('turn'), makeCbetSpot('flop')];
    collection.answerKeys = [makeKey('turn'), makeKey('flop')];
    selectFixtureSpots(collection);
    await writeTrainingCollection(collection, directory);
    const repository = createTrainingRepository({ dataDirectory: directory });
    let id = 0;
    const service = createTrainingService({
      repository,
      random: () => 0,
      idFactory: (prefix) => `${prefix}-${++id}`,
    });
    const created = await service.createOrResumeSession({
      exerciseType: 'cbet_barrels', gameType: 'cash', size: 'all',
    });
    const flop = await service.getNextQuestion(created.session.id);
    assert.equal(flop.question.stage, 'flop');
    await service.submitAnswer(created.session.id, {
      spotVersionId: flop.question.spotVersionId,
      answer: 'small_bet',
    });
    const turn = await service.getNextQuestion(created.session.id);
    assert.equal(turn.question.stage, 'turn');
    assert.equal(turn.question.episodeId, flop.question.episodeId);
    assert.equal(turn.question.usesHistoricalLine, true);
    assert.match(turn.question.continuationNotice, /historycznej linii/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('dobór najpierw wybiera niewidziane spoty', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'poker-training-unseen-'));
  try {
    const names = ['a', 'b', 'c'];
    const collection = createEmptyTrainingCollection();
    collection.spots = names.map(makePreflopSpot);
    collection.answerKeys = names.map(makePreflopKey);
    collection.attempts = [makeAttempt('a', 'incorrect', '2026-01-01T10:00:00.000Z')];
    selectFixtureSpots(collection);
    await writeTrainingCollection(collection, directory);
    const service = createTrainingService({
      repository: createTrainingRepository({ dataDirectory: directory }),
      random: () => 0,
      idFactory: (prefix) => `${prefix}-unseen`,
    });
    const created = await service.createOrResumeSession({
      exerciseType: 'preflop_selection', gameType: 'cash', size: 10,
    });
    const next = await service.getNextQuestion(created.session.id);
    assert.equal(next.question.spotVersionId, makePreflopSpot('b').versionId);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('po obejrzeniu całej puli stosuje wagi 4×/2×/1× bez natychmiastowej powtórki', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'poker-training-weights-'));
  try {
    const names = ['incorrect', 'acceptable', 'correct', 'latest'];
    const collection = createEmptyTrainingCollection();
    collection.spots = names.map(makePreflopSpot);
    collection.answerKeys = names.map(makePreflopKey);
    collection.attempts = [
      makeAttempt('incorrect', 'incorrect', '2026-01-01T10:00:00.000Z'),
      makeAttempt('acceptable', 'acceptable', '2026-01-01T11:00:00.000Z'),
      makeAttempt('correct', 'correct', '2026-01-01T12:00:00.000Z'),
      makeAttempt('latest', 'incorrect', '2026-01-01T13:00:00.000Z'),
    ];
    selectFixtureSpots(collection);
    await writeTrainingCollection(collection, directory);
    const repository = createTrainingRepository({ dataDirectory: directory });
    let id = 0;
    const pickAt = async (randomValue) => {
      const service = createTrainingService({
        repository,
        random: () => randomValue,
        idFactory: (prefix) => `${prefix}-weighted-${++id}`,
      });
      const created = await service.createOrResumeSession({
        exerciseType: 'preflop_selection', gameType: 'cash', size: 10,
      });
      return (await service.getNextQuestion(created.session.id)).question.spotVersionId;
    };
    assert.equal(await pickAt(0), makePreflopSpot('incorrect').versionId);
    assert.equal(await pickAt(0.7), makePreflopSpot('acceptable').versionId);
    assert.equal(await pickAt(0.99), makePreflopSpot('correct').versionId);
    assert.notEqual(await pickAt(0.99), makePreflopSpot('latest').versionId);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
