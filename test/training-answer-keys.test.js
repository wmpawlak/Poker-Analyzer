import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { analyzeTrainingAnswerKeysWithModel } from '../server/ai/analysisService.js';
import {
  CARD_FACTS_VALIDATION_VERSION,
  TRAINING_ANSWER_KEY_BATCH_LIMIT,
  buildTrainingAnswerKeyBatchInput,
  buildTrainingAnswerKeyPrompt,
  trainingAnswerKeyResponseSchema,
  validateTrainingAnswerKeyBatch,
} from '../server/training/answerKeyContract.js';
import { computeDecisionCardFacts } from '../server/training/decisionCardFacts.js';
import {
  createEmptyTrainingCollection,
  createTrainingRepository,
  writeTrainingCollection,
} from '../server/training/trainingRepository.js';
import {
  createTrainingRefreshService,
  estimateTrainingRefresh,
} from '../server/training/refreshService.js';

const makeSpot = (index, overrides = {}) => ({
  id: `decision-${index}:preflop_selection`,
  versionId: `decision-${index}:preflop_selection@fingerprint-${index}`,
  handId: `hand-${index}`,
  sourceFingerprint: `fingerprint-${index}`,
  exerciseType: 'preflop_selection',
  gameType: 'cash',
  street: 'PRE_FLOP',
  playedAt: new Date(Date.UTC(2026, 7, 1, 0, index)).toISOString(),
  sourceStatus: 'current',
  readiness: 'pending_key',
  active: false,
  answerOptions: [
    { id: 'fold', action: 'fold' },
    { id: 'call', action: 'call' },
    { id: 'raise', action: 'raise' },
  ],
  question: {
    street: 'PRE_FLOP',
    heroCards: ['Ah', 'Kd'],
    board: [],
    heroPosition: 'BTN/SB',
    blinds: { smallBlind: 0.5, bigBlind: 1, ante: 0 },
    pot: 1.5,
    toCall: 0.5,
    potOdds: 0.25,
    effectiveStack: 100,
    effectiveStackBb: 100,
    effectiveStackBehind: 99,
    effectiveStackBehindBb: 99,
    effectiveStackByOpponent: [{ playerId: 'Villain', amount: 100, amountBb: 100, behind: 99, behindBb: 99 }],
    players: [
      { playerId: 'Hero', seat: 1, position: 'BTN/SB', startingStack: 100, stack: 99.5, invested: 0.5, folded: false, allIn: false },
      { playerId: 'Villain', seat: 2, position: 'BB', startingStack: 100, stack: 99, invested: 1, folded: false, allIn: false },
    ],
    priorActions: [
      { street: 'PRE_FLOP', actor: 'Hero', type: 'small_blind', amount: 0.5, forced: true },
      { street: 'PRE_FLOP', actor: 'Villain', type: 'big_blind', amount: 1, forced: true },
    ],
    legalActions: ['fold', 'call', 'raise'],
    context: { opponentsInHand: 1, preflopRaiseCount: 0, facingRaiseLevel: 0, isFacingReraise: false, isFacingReshove: false },
  },
  historicalAnswer: { type: 'raise', amount: 2.5 },
  ...overrides,
});

const makeAiKey = (spot, overrides = {}) => ({
  spotVersionId: spot.spotVersionId || spot.versionId,
  heroHand: spot.heroHand || { notation: 'AKo', class: 'offsuit' },
  decisionCardFacts: spot.decisionCardFacts || computeDecisionCardFacts({
    heroCards: spot.question?.heroCards,
    board: spot.question?.board,
  }),
  factsValidationVersion: CARD_FACTS_VALIDATION_VERSION,
  preferredAnswer: 'raise',
  acceptableAlternatives: ['call'],
  confidence: 'high',
  rationale: 'Przewaga zakresu i pozycja przemawiają za podbiciem.',
  blockersEquity: 'Dwa wysokie blockery i dobra realizacja equity.',
  opponentRange: 'Szeroki zakres obrony big blinda.',
  suggestedSizing: { action: 'raise', potRatio: 0, raiseToBb: 3 },
  ...overrides,
});

const makeDirectory = () => fs.mkdtemp(path.join(os.tmpdir(), 'poker-training-ai-'));

const createRepositoryWithSpots = async (count) => {
  const directory = await makeDirectory();
  const collection = createEmptyTrainingCollection();
  collection.spots = Array.from({ length: count }, (_, index) => makeSpot(index + 1));
  collection.selectionState.selectedSpotVersionIds = collection.spots.map(({ versionId }) => versionId);
  await writeTrainingCollection(collection, directory);
  return { directory, repository: createTrainingRepository({ dataDirectory: directory }) };
};

const sequentialIds = () => {
  let index = 0;
  return (prefix) => `${prefix}-${++index}`;
};

test('lokalne fakty rozróżniają gotowy kolor, draw, backdoor draw, trzy karty i river', () => {
  const made = computeDecisionCardFacts({ heroCards: ['Ah', 'Kh'], board: ['2h', '7h', 'Tc', 'Qh', '3h'] });
  const draw = computeDecisionCardFacts({ heroCards: ['Ah', 'Kh'], board: ['2h', '7h', 'Tc'] });
  const backdoor = computeDecisionCardFacts({ heroCards: ['Ah', 'Kc'], board: ['2h', '7h', 'Tc'] });
  const threeCards = computeDecisionCardFacts({ heroCards: ['Ac', 'Kd'], board: ['2h', '7h', 'Th', 'Qc'] });
  const river = computeDecisionCardFacts({ heroCards: ['Th', 'As'], board: ['2s', '8c', '9s', '6c', '4s'] });

  assert.equal(made.flushStatus, 'made');
  assert.equal(draw.flushStatus, 'draw');
  assert.equal(backdoor.flushStatus, 'backdoor_draw');
  assert.equal(threeCards.flushStatus, 'none');
  assert.deepEqual(river, {
    madeHand: 'HIGH_CARD',
    flushStatus: 'none',
    cardsToCome: 0,
    suitCounts: {
      hero: { c: 0, d: 0, h: 1, s: 1 },
      board: { c: 2, d: 0, h: 0, s: 3 },
    },
  });
});

test('walidator wymaga lokalnych faktów i odrzuca niemożliwy opis Hero, ale nie zakres rywala', () => {
  const spot = makeSpot(1, {
    street: 'RIVER',
    question: {
      ...makeSpot(1).question,
      street: 'RIVER',
      heroCards: ['Th', 'As'],
      board: ['2s', '8c', '9s', '6c', '4s'],
      legalActions: ['check', 'raise'],
    },
    answerOptions: [
      { id: 'check', action: 'check' },
      { id: 'value_raise', action: 'raise' },
    ],
  });
  const input = buildTrainingAnswerKeyBatchInput([spot]);
  const valid = validateTrainingAnswerKeyBatch({ keys: [makeAiKey(input.spots[0], {
    preferredAnswer: 'check',
    acceptableAlternatives: ['value_raise'],
    suggestedSizing: { action: 'check', potRatio: 0, raiseToBb: 0 },
    opponentRange: 'Rywal może mieć kolor.',
  })] }, input);
  assert.equal(valid.validKeys.length, 1);

  const impossibleHeroDescription = validateTrainingAnswerKeyBatch({ keys: [makeAiKey(input.spots[0], {
    preferredAnswer: 'value_raise',
    acceptableAlternatives: ['check'],
    rationale: 'Hero ma kolor i powinien zagrać value raise.',
    suggestedSizing: { action: 'raise', potRatio: 0, raiseToBb: 3 },
  })] }, input);
  assert.equal(impossibleHeroDescription.validKeys.length, 0);

  const missingFacts = validateTrainingAnswerKeyBatch({ keys: [makeAiKey(input.spots[0], {
    decisionCardFacts: undefined,
    factsValidationVersion: undefined,
  })] }, input);
  assert.equal(missingFacts.validKeys.length, 0);
});

test('payload AI powstaje z białej listy i nie ujawnia wyniku ani historycznej decyzji Hero', () => {
  const spot = makeSpot(1, {
    outcome: 'WON-SECRET',
    futureBoard: ['Qs-SECRET'],
    opponentCards: ['Ac-SECRET', 'Ad-SECRET'],
    rawText: 'RAW-SECRET',
    question: {
      ...makeSpot(1).question,
      outcome: 'QUESTION-OUTCOME-SECRET',
      futureActions: ['FUTURE-ACTION-SECRET'],
      historicalAction: { type: 'fold', secret: 'ACTUAL-ACTION-SECRET' },
      showdown: 'SHOWDOWN-SECRET',
      players: makeSpot(1).question.players.map((player) => ({ ...player, cards: ['PLAYER-CARDS-SECRET'] })),
    },
  });
  const input = buildTrainingAnswerKeyBatchInput([spot]);
  const prompt = buildTrainingAnswerKeyPrompt(input);

  for (const secret of [
    'WON-SECRET', 'Qs-SECRET', 'Ac-SECRET', 'RAW-SECRET', 'QUESTION-OUTCOME-SECRET',
    'FUTURE-ACTION-SECRET', 'ACTUAL-ACTION-SECRET', 'SHOWDOWN-SECRET', 'PLAYER-CARDS-SECRET',
  ]) assert.equal(prompt.includes(secret), false, secret);
  assert.equal(Object.hasOwn(input.spots[0], 'historicalAnswer'), false);
  assert.deepEqual(input.spots[0].question.board, []);

  assert.throws(
    () => buildTrainingAnswerKeyBatchInput(Array.from({ length: TRAINING_ANSWER_KEY_BATCH_LIMIT + 1 }, (_, index) => makeSpot(index))),
    (error) => error.code === 'TRAINING_AI_BATCH_TOO_LARGE',
  );
});

test('walidator wiąże identyfikatory, legalne odpowiedzi, pewność i lokalny sizing', () => {
  const preflop = makeSpot(1);
  const cbet = makeSpot(2, {
    exerciseType: 'cbet_barrels',
    street: 'FLOP',
    question: {
      ...makeSpot(2).question,
      street: 'FLOP',
      board: ['2c', '7d', 'Ts'],
      legalActions: ['check', 'bet'],
    },
    answerOptions: [
      { id: 'check', action: 'check' },
      { id: 'small_bet', action: 'bet', maximumPotRatio: 0.4 },
      { id: 'large_bet', action: 'bet', minimumPotRatioExclusive: 0.4 },
    ],
  });
  const input = buildTrainingAnswerKeyBatchInput([preflop, cbet]);
  const result = validateTrainingAnswerKeyBatch({
    keys: [
      makeAiKey(input.spots[0]),
      makeAiKey(input.spots[1], {
        preferredAnswer: 'small_bet', acceptableAlternatives: ['check'], confidence: 'medium',
        suggestedSizing: { action: 'bet', potRatio: 0.65, raiseToBb: 0 },
      }),
      makeAiKey({ spotVersionId: 'unknown' }),
    ],
  }, input);

  assert.equal(result.validKeys.length, 1);
  assert.equal(result.validKeys[0].status, 'ready');
  assert.equal(result.validKeys[0].localFactsValid, true);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].errors.join(' '), /próg małego beta/);
  assert.deepEqual(result.unknownResults, ['unknown']);
});

test('adapter wybranego modelu wysyła jedną bezpieczną partię ze ścisłym schematem', async () => {
  const input = buildTrainingAnswerKeyBatchInput([makeSpot(1)]);
  const report = { keys: [makeAiKey(input.spots[0])] };
  const calls = [];
  const result = await analyzeTrainingAnswerKeysWithModel({
    modelId: 'gpt-5.6-terra',
    input,
    environment: { OPENAI_API_KEY: 'test-key' },
    fetchImpl: async (...args) => {
      calls.push(args);
      return new Response(JSON.stringify({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(report) }] }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  assert.deepEqual(result.response, report);
  assert.equal(result.model.id, 'gpt-5.6-terra');
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0][1].body);
  assert.equal(body.text.format.name, 'poker_training_answer_keys');
  assert.deepEqual(body.text.format.schema, trainingAnswerKeyResponseSchema);
  assert.equal(body.max_output_tokens, 32_000);
  assert.match(body.input, /"potOdds":0.25/);
  assert.doesNotMatch(body.input, /historicalAnswer|historicalAction/);
});

test('próbka odświeżania ma dozwolone rozmiary, domyślnie wynosi 100 i ogranicza liczbę żądań', async () => {
  const { directory, repository } = await createRepositoryWithSpots(805);
  try {
    const service = createTrainingRefreshService({ repository, analyzeBatch: async () => ({ keys: [] }) });
    const expectedCounts = [100, 200, 300, 400, 500, 600, 700, 800];
    for (const sampleSize of expectedCounts) {
      const estimate = await service.estimate({ sampleSize });
      assert.equal(estimate.sampleSize, sampleSize);
      assert.equal(estimate.candidateCount, sampleSize);
      assert.equal(estimate.estimatedRequests, sampleSize / 20);
    }
    assert.equal((await service.estimate()).sampleSize, 100);
    const { directory: secondDirectory, repository: secondRepository } = await createRepositoryWithSpots(125);
    try {
      const calls = [];
      const secondService = createTrainingRefreshService({
        repository: secondRepository,
        idFactory: sequentialIds(),
        analyzeBatch: async ({ input }) => {
          calls.push(input.spots.map(({ spotVersionId }) => spotVersionId));
          return { keys: input.spots.map(makeAiKey) };
        },
      });
      const first = await secondService.startRefresh({ modelId: 'mock-model', confirmed: true, sampleSize: 100 });
      const firstCompleted = await secondService.waitForIdle(first.id);
      assert.equal(firstCompleted.candidateCount, 100);
      assert.equal(firstCompleted.attemptedRequests, 5);
      const second = await secondService.startRefresh({ modelId: 'mock-model', confirmed: true, sampleSize: 100 });
      const secondCompleted = await secondService.waitForIdle(second.id);
      assert.equal(secondCompleted.candidateCount, 25);
      assert.equal(secondCompleted.attemptedRequests, 2);
      assert.deepEqual(calls.map((batch) => batch.length), [20, 20, 20, 20, 20, 20, 5]);
      assert.equal(new Set(calls.flat()).size, 125);
    } finally {
      await fs.rm(secondDirectory, { recursive: true, force: true });
    }
    for (const sampleSize of [0, 50, 150, 900, 'all']) {
      await assert.rejects(
        () => service.estimate({ sampleSize }),
        (error) => error.code === 'TRAINING_REFRESH_SAMPLE_SIZE_INVALID',
      );
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('odświeżanie wymaga potwierdzenia i zapisuje partie 20/20/5 od razu', async () => {
  const { directory, repository } = await createRepositoryWithSpots(45);
  try {
    const calls = [];
    const service = createTrainingRefreshService({
      repository,
      idFactory: sequentialIds(),
      analyzeBatch: async ({ modelId, input }) => {
        calls.push({ modelId, size: input.spots.length });
        return { model: { id: modelId, name: 'Wybrany model' }, response: { keys: input.spots.map(makeAiKey) } };
      },
    });
    const estimate = await service.estimate();
    assert.equal(estimate.candidateCount, 45);
    assert.equal(estimate.estimatedRequests, 3);
    await assert.rejects(
      () => service.startRefresh({ modelId: 'gpt-5.6-terra' }),
      (error) => error.code === 'TRAINING_REFRESH_CONFIRMATION_REQUIRED' && error.estimate.estimatedRequests === 3,
    );
    assert.equal(calls.length, 0);

    const started = await service.startRefresh({ modelId: 'gpt-5.6-terra', confirmed: true });
    const completed = await service.waitForIdle(started.id);
    assert.equal(completed.status, 'completed');
    assert.deepEqual(calls.map(({ size }) => size), [20, 20, 5]);
    assert.equal(calls.every(({ modelId }) => modelId === 'gpt-5.6-terra'), true);
    assert.equal(completed.attemptedRequests, 3);
    assert.equal(completed.savedKeyCount, 45);
    assert.equal(completed.readyKeyCount, 45);
    const snapshot = await repository.getSnapshot();
    assert.equal(snapshot.answerKeys.length, 45);
    assert.equal(snapshot.refreshJobs.length, 1);
    assert.equal(snapshot.spots.every(({ readiness }) => readiness === 'ready'), true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('spots are marked before the provider call and remain marked after provider failure', async () => {
  const { directory, repository } = await createRepositoryWithSpots(25);
  try {
    let release;
    let enteredResolve;
    const entered = new Promise((resolve) => { enteredResolve = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    const service = createTrainingRefreshService({
      repository,
      idFactory: sequentialIds(),
      analyzeBatch: async () => {
        enteredResolve();
        await gate;
        const error = new Error('One provider failure.');
        error.code = 'AI_UPSTREAM_HTTP_ERROR';
        throw error;
      },
    });
    const started = await service.startRefresh({ modelId: 'mock-model', confirmed: true });
    await entered;
    const beforeProvider = await repository.getSnapshot();
    assert.equal(beforeProvider.spots.filter(({ aiFirstSentAt }) => aiFirstSentAt).length, 20);
    assert.equal(beforeProvider.spots.filter(({ aiFirstSentJobId }) => aiFirstSentJobId === started.id).length, 20);
    release();
    const failed = await service.waitForIdle(started.id);
    assert.equal(failed.status, 'failed');
    assert.equal((await repository.getSnapshot()).spots.filter(({ aiFirstSentAt }) => aiFirstSentAt).length, 20);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('migration marks answer keys, cursor-processed spots and interrupted batches', async () => {
  const { directory, repository: initialRepository } = await createRepositoryWithSpots(4);
  try {
    const initial = await initialRepository.getSnapshot();
    const [withKey, processed, interrupted, untouched] = initial.spots;
    await writeTrainingCollection({
      ...initial,
      answerKeys: [{ ...makeAiKey(withKey), id: 'legacy-key', createdAt: '2026-08-01T00:00:00.000Z' }],
      refreshJobs: [{
        id: 'legacy-job',
        status: 'running',
        contractVersion: 1,
        candidateSpotVersionIds: [processed.versionId, interrupted.versionId],
        candidateCount: 2,
        cursor: 1,
        inFlight: {
          spotVersionIds: [interrupted.versionId],
          startedAt: '2026-08-02T00:00:00.000Z',
        },
        createdAt: '2026-08-02T00:00:00.000Z',
        errors: [],
      }],
    }, directory);
    // Recreate a pre-migration startup: the helper already initialized SQLite
    // in order to provide stable spot IDs for this legacy JSON fixture.
    await Promise.all([
      fs.rm(path.join(directory, 'poker-training-v2.sqlite'), { force: true }),
      fs.rm(path.join(directory, 'poker-training-v2.sqlite-wal'), { force: true }),
      fs.rm(path.join(directory, 'poker-training-v2.sqlite-shm'), { force: true }),
    ]);
    const migratedRepository = createTrainingRepository({ dataDirectory: directory });
    const migrated = await migratedRepository.getSnapshot();
    assert.equal(migrated.spots.find(({ versionId }) => versionId === withKey.versionId).aiFirstSentAt, '2026-08-01T00:00:00.000Z');
    assert.equal(migrated.spots.find(({ versionId }) => versionId === processed.versionId).aiFirstSentAt, '2026-08-02T00:00:00.000Z');
    assert.equal(migrated.spots.find(({ versionId }) => versionId === interrupted.versionId).aiFirstSentAt, '2026-08-02T00:00:00.000Z');
    assert.equal(migrated.spots.find(({ versionId }) => versionId === untouched.versionId).aiFirstSentAt, null);
    const estimate = await createTrainingRefreshService({
      repository: migratedRepository,
      analyzeBatch: async () => ({ keys: [] }),
    }).estimate();
    assert.deepEqual(estimate.candidateSpotVersionIds, [untouched.versionId]);
    const reopened = await createTrainingRepository({ dataDirectory: directory }).getSnapshot();
    assert.equal(reopened.spots.find(({ versionId }) => versionId === processed.versionId).aiFirstSentAt, '2026-08-02T00:00:00.000Z');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('częściowo błędna odpowiedź zapisuje poprawny klucz i kieruje resztę do ponownej analizy bez retry', async () => {
  const { directory, repository } = await createRepositoryWithSpots(3);
  try {
    let calls = 0;
    const service = createTrainingRefreshService({
      repository,
      idFactory: sequentialIds(),
      analyzeBatch: async ({ input }) => {
        calls += 1;
        return {
          keys: [
            makeAiKey(input.spots[0]),
            makeAiKey(input.spots[1], { preferredAnswer: 'illegal' }),
            makeAiKey({ spotVersionId: 'foreign-version' }),
          ],
        };
      },
    });
    const started = await service.startRefresh({ modelId: 'mock-model', confirmed: true });
    const completed = await service.waitForIdle(started.id);
    assert.equal(calls, 1);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.readyKeyCount, 1);
    assert.equal(completed.reviewKeyCount, 2);
    assert.equal(completed.invalidKeyCount, 2);
    assert.equal(completed.unknownResultCount, 1);
    const snapshot = await repository.getSnapshot();
    assert.equal(snapshot.answerKeys.length, 3);
    assert.equal(snapshot.answerKeys.filter(({ localFactsValid }) => localFactsValid).length, 1);
    assert.equal(snapshot.spots.filter(({ readiness }) => readiness === 'review').length, 2);
    assert.equal(estimateTrainingRefresh(snapshot).candidateCount, 0);
    assert.equal(estimateTrainingRefresh(snapshot, { includeReview: true }).candidateCount, 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('stop czeka na bieżącą partię, a wznowienie zaczyna od następnej', async () => {
  const { directory, repository } = await createRepositoryWithSpots(25);
  try {
    let calls = 0;
    let releaseFirst;
    let enteredFirst;
    const entered = new Promise((resolve) => { enteredFirst = resolve; });
    const gate = new Promise((resolve) => { releaseFirst = resolve; });
    const service = createTrainingRefreshService({
      repository,
      idFactory: sequentialIds(),
      analyzeBatch: async ({ input }) => {
        calls += 1;
        if (calls === 1) {
          enteredFirst();
          await gate;
        }
        return { keys: input.spots.map(makeAiKey) };
      },
    });
    const started = await service.startRefresh({ modelId: 'mock-model', confirmed: true });
    await entered;
    const requested = await service.stopRefresh(started.id);
    assert.equal(requested.status, 'stop_requested');
    releaseFirst();
    const stopped = await service.waitForIdle(started.id);
    assert.equal(stopped.status, 'stopped');
    assert.equal(stopped.cursor, 20);
    assert.equal(calls, 1);

    await service.resumeRefresh(started.id);
    const completed = await service.waitForIdle(started.id);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.cursor, 25);
    assert.equal(calls, 2);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('nowe zadanie jest blokowane, dopóki poprzednie zadanie ma partie do wznowienia', async () => {
  const { directory, repository } = await createRepositoryWithSpots(25);
  try {
    let release;
    let enteredResolve;
    const entered = new Promise((resolve) => { enteredResolve = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    const service = createTrainingRefreshService({
      repository,
      idFactory: sequentialIds(),
      analyzeBatch: async ({ input }) => {
        enteredResolve();
        await gate;
        return { keys: input.spots.map(makeAiKey) };
      },
    });
    const started = await service.startRefresh({ modelId: 'mock-model', confirmed: true });
    await entered;

    await assert.rejects(
      () => service.startRefresh({ modelId: 'another-model', confirmed: true }),
      (error) => error.code === 'TRAINING_REFRESH_RESUME_REQUIRED'
        && error.resumableJob.id === started.id,
    );
    assert.equal((await repository.getSnapshot()).refreshJobs.length, 1);

    release();
    assert.equal((await service.waitForIdle(started.id)).status, 'completed');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('błąd dostawcy nie jest ponawiany automatycznie, a ręczne wznowienie omija zużytą partię', async () => {
  const { directory, repository } = await createRepositoryWithSpots(25);
  try {
    const sizes = [];
    const service = createTrainingRefreshService({
      repository,
      idFactory: sequentialIds(),
      analyzeBatch: async ({ input }) => {
        sizes.push(input.spots.length);
        if (sizes.length === 1) {
          const error = new Error('Jednorazowy błąd dostawcy.');
          error.code = 'AI_UPSTREAM_HTTP_ERROR';
          throw error;
        }
        return { keys: input.spots.map(makeAiKey) };
      },
    });
    const started = await service.startRefresh({ modelId: 'mock-model', confirmed: true });
    const failed = await service.waitForIdle(started.id);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.cursor, 20);
    assert.deepEqual(sizes, [20]);
    assert.equal(failed.errors[0].code, 'AI_UPSTREAM_HTTP_ERROR');

    await service.resumeRefresh(started.id);
    const completed = await service.waitForIdle(started.id);
    assert.equal(completed.status, 'completed');
    assert.deepEqual(sizes, [20, 5]);
    const snapshot = await repository.getSnapshot();
    assert.equal(snapshot.answerKeys.length, 25);
    assert.equal(snapshot.answerKeys.filter(({ localFactsValid }) => !localFactsValid).length, 20);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('kolejka AI ogranicza się do 800 wybranych, poprawnych lokalnie spotów i 40 żądań', async () => {
  const { directory, repository } = await createRepositoryWithSpots(805);
  try {
    const snapshot = await repository.getSnapshot();
    const unselected = snapshot.spots.at(-1).versionId;
    await repository.transact((collection) => {
      collection.selectionState.selectedSpotVersionIds = collection.spots
        .slice(0, 802).map(({ versionId }) => versionId);
      collection.spots[1].question.board = ['invalid-board'];
      return null;
    });
    const estimate = await createTrainingRefreshService({ repository, analyzeBatch: async () => ({ keys: [] }) }).estimate({ sampleSize: 800 });
    assert.equal(estimate.candidateCount, 800);
    assert.equal(estimate.estimatedRequests, 40);
    assert.equal(estimate.candidateSpotVersionIds.includes(unselected), true);
    assert.equal(estimate.candidateSpotVersionIds.includes(snapshot.spots[1].versionId), false);
    assert.equal(estimate.locallyRejectedCount, 1);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('audytowane spoty nie trafiajÄ… do estymaty ani do pĹ‚atnej kolejki AI', async () => {
  const directory = await makeDirectory();
  let analyzeCalls = 0;
  try {
    const collection = createEmptyTrainingCollection();
    const spot = makeSpot(900, {
      handId: 'audited-hand',
      sourceFingerprint: 'audited-fingerprint',
      versionId: 'decision-900:preflop_selection@audited-fingerprint',
    });
    collection.spots = [spot];
    collection.selectionState.selectedSpotVersionIds = [spot.versionId];
    collection.auditState = {
      version: 1,
      selectionFrozen: true,
      excludedHands: [{
        handId: spot.handId,
        fingerprint: spot.sourceFingerprint,
        reason: 'local_card_audit',
        excludedAt: '2026-08-12T00:00:00.000Z',
      }],
    };
    await writeTrainingCollection(collection, directory);
    const repository = createTrainingRepository({ dataDirectory: directory, auditExclusions: [] });
    const service = createTrainingRefreshService({
      repository,
      analyzeBatch: async () => {
        analyzeCalls += 1;
        return { keys: [] };
      },
      idFactory: (prefix) => `${prefix}-audit`,
    });

    const estimate = await service.estimate();
    assert.equal(estimate.candidateCount, 0);
    const job = await service.startRefresh({ modelId: 'mock-model', confirmed: true });
    assert.equal(job.status, 'completed');
    assert.equal(job.candidateCount, 0);
    assert.equal(analyzeCalls, 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
