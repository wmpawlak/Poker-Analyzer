import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createApiApp } from '../server/app.js';
import { createDataImportService } from '../server/dataImportService.js';
import { TRAINING_ANSWER_KEY_CONTRACT_VERSION } from '../server/training/answerKeyContract.js';
import { CARD_FACTS_VALIDATION_VERSION } from '../server/training/decisionCardFacts.js';
import { createTrainingRepository } from '../server/training/trainingRepository.js';
import { createEmptyAiAnalysesCache, writeAiAnalysesCache } from '../server/aiAnalysesCache.js';
import { EXERCISE_TYPES, TRAINING_GRADES } from '../src/training/trainingTypes.js';

const makeTrainingHand = (id, minute = 0) => `CoinPoker Hand #${id}: NLH (0.50/1) 2026/08/01 12:${String(minute).padStart(2, '0')}:00 UTC
Table 'training-api' 2-max Seat #1 is the button
Seat 1: Hero (100 in chips)
Seat 2: Villain (100 in chips)
Hero: posts small blind 0.50
Villain: posts big blind 1
*** HOLE CARDS ***
Dealt to Hero [Ah Kd]
Hero: folds
*** SUMMARY ***
Seat 1: Hero folded before Flop`;

const postJson = (url, body) => fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const uploadText = async (baseUrl, filename, content) => {
  const formData = new FormData();
  formData.append('file', new Blob([content], { type: 'text/plain' }), filename);
  const response = await fetch(`${baseUrl}/api/imports`, { method: 'POST', body: formData });
  assert.equal(response.status, 202);
  return response.json();
};

const makeAiKey = (spot) => {
  const preferred = spot.answerOptions[0];
  const alternative = spot.answerOptions[1];
  return {
    spotVersionId: spot.spotVersionId,
    heroHand: spot.heroHand || { notation: 'AKo', class: 'offsuit' },
    decisionCardFacts: spot.decisionCardFacts,
    factsValidationVersion: CARD_FACTS_VALIDATION_VERSION,
    preferredAnswer: preferred.id,
    acceptableAlternatives: alternative ? [alternative.id] : [],
    confidence: 'high',
    rationale: 'Lokalna struktura zakresów przemawia za tą odpowiedzią.',
    blockersEquity: 'Karty Hero mają użyteczne blockery i wystarczające equity.',
    opponentRange: 'Zakres rywala pozostaje szeroki i pozycyjnie zależny.',
    suggestedSizing: {
      action: preferred.action,
      potRatio: preferred.action === 'bet' ? 0.33 : 0,
      raiseToBb: preferred.action === 'raise' ? 3 : 0,
    },
  };
};

const startTrainingApi = async (t, {
  handCount = 3,
  analyzeBatch,
} = {}) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'poker-training-api-'));
  t.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  await createDataImportService({ dataDirectory }).importText({
    filename: 'training.txt',
    content: Array.from({ length: handCount }, (_, index) => makeTrainingHand(91000 + index, index)).join('\n\n'),
  });
  const repository = createTrainingRepository({ dataDirectory });
  let id = 0;
  const server = createApiApp({
    dataDirectory,
    environment: { OPENAI_API_KEY: 'configured-test-key' },
    logger: { error: () => {}, info: () => {} },
    trainingRepository: repository,
    trainingAnalyzeBatch: analyzeBatch,
    trainingRandom: () => 0,
    trainingIdFactory: (prefix) => `${prefix}-${++id}`,
  }).listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const dataset = await fetch(`${baseUrl}/api/dataset`).then((response) => response.json());
  return { baseUrl, dataDirectory, dataset, repository };
};

const waitForJob = async (baseUrl, jobId, expectedStatuses) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/training/refresh/${encodeURIComponent(jobId)}`);
    const body = await response.json();
    if (expectedStatuses.includes(body.job?.status)) return body.job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Zadanie ${jobId} nie osiągnęło stanu ${expectedStatuses.join('/')}.`);
};

const waitForImport = async (baseUrl, importId) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/imports/${encodeURIComponent(importId)}`);
    const body = await response.json();
    if (body.phase === 'ready') return body;
    if (body.phase === 'failed') throw new Error(body.error?.message || `Import ${importId} zakończył się błędem.`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Import ${importId} nie zakończył się w limicie czasu.`);
};

const collectKeys = (value, target = new Set()) => {
  if (Array.isArray(value)) value.forEach((item) => collectKeys(item, target));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, child]) => {
    target.add(key);
    collectKeys(child, target);
  });
  return target;
};

test('API skanuje dataset, wymaga potwierdzenia kosztu i przygotowuje bezpieczną pulę', async (t) => {
  let providerCalls = 0;
  const { baseUrl, dataset, repository } = await startTrainingApi(t, {
    analyzeBatch: async ({ input }) => {
      providerCalls += 1;
      return { model: { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' }, response: { keys: input.spots.map(makeAiKey) } };
    },
  });

  const initial = await fetch(`${baseUrl}/api/training/status`).then((response) => response.json());
  assert.equal(initial.queue.pending, 0);
  assert.equal(initial.models.find(({ id }) => id === 'gpt-5.6-terra').configured, true);
  const largerSample = await fetch(`${baseUrl}/api/training/status?sampleSize=200`).then((response) => response.json());
  assert.equal(largerSample.refreshEstimate.sampleSize, 200);
  const invalidSample = await fetch(`${baseUrl}/api/training/status?sampleSize=150`);
  assert.equal(invalidSample.status, 400);
  assert.equal((await invalidSample.json()).code, 'TRAINING_REFRESH_SAMPLE_SIZE_INVALID');
  const malformed = await fetch(`${baseUrl}/api/training/sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).code, 'TRAINING_INVALID_REQUEST');

  const staleScan = await postJson(`${baseUrl}/api/training/refresh/scan`, { datasetRevision: 'stale' });
  assert.equal(staleScan.status, 409);
  assert.equal((await staleScan.json()).code, 'DATASET_REVISION_MISMATCH');

  const invalidScan = await postJson(`${baseUrl}/api/training/refresh/scan`, {
    datasetRevision: dataset.datasetRevision, sampleSize: 150,
  });
  assert.equal(invalidScan.status, 400);
  assert.equal((await invalidScan.json()).code, 'TRAINING_REFRESH_SAMPLE_SIZE_INVALID');

  const scanResponse = await postJson(`${baseUrl}/api/training/refresh/scan`, {
    datasetRevision: dataset.datasetRevision,
    sampleSize: 100,
  });
  assert.equal(scanResponse.status, 200);
  const scan = await scanResponse.json();
  assert.equal(scan.scan.new, 3);
  assert.equal(scan.scan.spotsAdded, 3);
  assert.equal(scan.status.refreshEstimate.estimatedRequests, 1);
  assert.equal(scan.status.refreshEstimate.sampleSize, 100);

  const repeatedScan = await postJson(`${baseUrl}/api/training/refresh/scan`, {
    datasetRevision: dataset.datasetRevision,
  }).then((response) => response.json());
  assert.equal(repeatedScan.scan.unchanged, 3);
  assert.equal(repeatedScan.scan.spotsAdded, 0);

  const unconfirmed = await postJson(`${baseUrl}/api/training/refresh/start`, {
    modelId: 'gpt-5.6-terra', confirmed: false,
  });
  assert.equal(unconfirmed.status, 409);
  assert.equal((await unconfirmed.json()).code, 'TRAINING_REFRESH_CONFIRMATION_REQUIRED');
  assert.equal(providerCalls, 0);

  const startedResponse = await postJson(`${baseUrl}/api/training/refresh/start`, {
    modelId: 'gpt-5.6-terra', confirmed: true, sampleSize: 100,
  });
  assert.equal(startedResponse.status, 202);
  const started = await startedResponse.json();
  assert.equal(started.job.sampleSize, 100);
  const completed = await waitForJob(baseUrl, started.job.id, ['completed']);
  assert.equal(completed.readyKeyCount, 3);
  assert.equal(providerCalls, 1);

  const ready = await fetch(`${baseUrl}/api/training/status`).then((response) => response.json());
  assert.equal(ready.pools.preflop_selection.cash.active, 3);
  assert.equal(ready.queue.pending, 0);
  assert.equal(ready.lastUsedModel, 'gpt-5.6-terra');
  assert.equal((await repository.getSnapshot()).answerKeys.length, 3);
});

test('kolejny skan ocenia wyłącznie nowe rozdania i zachowuje metadane starych kluczy', async (t) => {
  const providerCalls = [];
  const { baseUrl, dataset, repository } = await startTrainingApi(t, {
    handCount: 2,
    analyzeBatch: async ({ input, modelId }) => {
      providerCalls.push({
        modelId,
        spotVersionIds: input.spots.map(({ spotVersionId }) => spotVersionId),
      });
      return {
        model: { id: modelId, name: modelId },
        response: { keys: input.spots.map(makeAiKey) },
      };
    },
  });

  await postJson(`${baseUrl}/api/training/refresh/scan`, {
    datasetRevision: dataset.datasetRevision,
  });
  const firstRefresh = await postJson(`${baseUrl}/api/training/refresh/start`, {
    modelId: 'gpt-5.6-terra', confirmed: true,
  }).then((response) => response.json());
  await waitForJob(baseUrl, firstRefresh.job.id, ['completed']);

  const before = await repository.getSnapshot();
  assert.equal(before.answerKeys.length, 2);
  assert.equal(providerCalls.length, 1);
  const oldKeys = new Map(before.answerKeys.map((key) => [key.id, structuredClone(key)]));
  oldKeys.forEach((key) => {
    delete key.archivedAt;
    delete key.archiveReason;
  });
  before.answerKeys.forEach((key) => {
    assert.equal(key.model.id, 'gpt-5.6-terra');
    assert.equal(key.contractVersion, TRAINING_ANSWER_KEY_CONTRACT_VERSION);
    assert.equal(typeof key.createdAt, 'string');
  });

  const upload = await uploadText(baseUrl, 'training-new-hand.txt', makeTrainingHand(92000, 30));
  await waitForImport(baseUrl, upload.importId);
  const updatedDataset = await fetch(`${baseUrl}/api/dataset`).then((response) => response.json());
  assert.notEqual(updatedDataset.datasetRevision, dataset.datasetRevision);
  const secondScan = await postJson(`${baseUrl}/api/training/refresh/scan`, {
    datasetRevision: updatedDataset.datasetRevision,
  }).then((response) => response.json());
  assert.equal(secondScan.scan.new, 1);
  assert.equal(secondScan.scan.unchanged, 2);
  assert.equal(secondScan.scan.spotsAdded, 1);
  assert.equal(secondScan.status.refreshEstimate.candidateCount, 1);
  assert.equal(secondScan.status.refreshEstimate.estimatedRequests, 1);

  const secondRefresh = await postJson(`${baseUrl}/api/training/refresh/start`, {
    modelId: 'gpt-5.6-sol', confirmed: true,
  }).then((response) => response.json());
  await waitForJob(baseUrl, secondRefresh.job.id, ['completed']);

  assert.equal(providerCalls.length, 2);
  assert.equal(providerCalls[0].spotVersionIds.length, 2);
  assert.equal(providerCalls[1].spotVersionIds.length, 1);
  assert.equal(providerCalls[1].modelId, 'gpt-5.6-sol');
  assert.equal(providerCalls[0].spotVersionIds.includes(providerCalls[1].spotVersionIds[0]), false);

  const after = await repository.getSnapshot();
  assert.equal(after.answerKeys.length, 3);
  oldKeys.forEach((key, id) => {
    const actual = { ...after.answerKeys.find((candidate) => candidate.id === id) };
    delete actual.archivedAt;
    delete actual.archiveReason;
    assert.deepEqual(actual, key);
  });
  const newKey = after.answerKeys.find((key) => !oldKeys.has(key.id));
  assert.equal(newKey.model.id, 'gpt-5.6-sol');
  assert.equal(newKey.contractVersion, TRAINING_ANSWER_KEY_CONTRACT_VERSION);
  assert.equal(typeof newKey.createdAt, 'string');
});

test('sesja wznawia pytanie, zapisuje odpowiedź atomowo i dopiero potem ujawnia feedback', async (t) => {
  const { baseUrl, dataDirectory, dataset, repository } = await startTrainingApi(t, {
    analyzeBatch: async ({ input }) => ({ keys: input.spots.map(makeAiKey) }),
  });
  await postJson(`${baseUrl}/api/training/refresh/scan`, { datasetRevision: dataset.datasetRevision });
  const refresh = await postJson(`${baseUrl}/api/training/refresh/start`, {
    modelId: 'gpt-5.6-terra', confirmed: true,
  }).then((response) => response.json());
  await waitForJob(baseUrl, refresh.job.id, ['completed']);

  const createdResponse = await postJson(`${baseUrl}/api/training/sessions`, {
    exerciseType: EXERCISE_TYPES.PREFLOP_SELECTION,
    gameType: 'both',
    size: 10,
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.session.targetSize, 3);
  const sessionId = created.session.id;

  const first = await fetch(`${baseUrl}/api/training/sessions/${sessionId}/next`).then((response) => response.json());
  const repeated = await fetch(`${baseUrl}/api/training/sessions/${sessionId}/next`).then((response) => response.json());
  assert.equal(repeated.question.spotVersionId, first.question.spotVersionId);
  const questionKeys = collectKeys(first.question);
  for (const forbidden of ['historicalAnswer', 'historicalAction', 'answerKey', 'outcome', 'showdown', 'rawText']) {
    assert.equal(questionKeys.has(forbidden), false, forbidden);
  }

  const resumed = await postJson(`${baseUrl}/api/training/sessions`, {
    exerciseType: EXERCISE_TYPES.PREFLOP_SELECTION,
    gameType: 'both',
    size: 10,
    resume: true,
  });
  assert.equal(resumed.status, 200);
  assert.equal((await resumed.json()).session.id, sessionId);
  const resumedById = await postJson(`${baseUrl}/api/training/sessions`, {
    resumeSessionId: sessionId,
  });
  assert.equal(resumedById.status, 200);
  assert.equal((await resumedById.json()).session.id, sessionId);

  const mismatch = await postJson(`${baseUrl}/api/training/sessions/${sessionId}/answers`, {
    spotVersionId: 'forged-version', answer: first.question.answerOptions[0].id,
  });
  assert.equal(mismatch.status, 409);
  assert.equal(collectKeys(await mismatch.json()).has('answerKey'), false);
  assert.equal((await repository.getSnapshot()).attempts.length, 0);

  const firstPayload = {
    spotVersionId: first.question.spotVersionId,
    answer: first.question.answerOptions[0].id,
  };
  const handId = first.question.spotVersionId.split(':')[0];
  await writeAiAnalysesCache({
    ...createEmptyAiAnalysesCache(),
    handAnalyses: {
      [handId]: [{
        reportId: 'training-hand-summary', analyzedAt: '2026-08-02T12:00:00.000Z',
        analysis: { summary: 'Analiza ręki: Hero wygrał pulę, ale wcześniejszy call był zbyt luźny.' },
      }],
    },
  }, dataDirectory);
  const concurrent = await Promise.all([
    postJson(`${baseUrl}/api/training/sessions/${sessionId}/answers`, firstPayload),
    postJson(`${baseUrl}/api/training/sessions/${sessionId}/answers`, firstPayload),
  ]);
  assert.deepEqual(concurrent.map(({ status }) => status).sort(), [200, 409]);
  const firstFeedback = await concurrent.find(({ status }) => status === 200).json();
  assert.equal(firstFeedback.feedback.grade, TRAINING_GRADES.CORRECT);
  assert.equal(firstFeedback.feedback.answerKey.preferredAnswer, firstPayload.answer);
  assert.equal(firstFeedback.feedback.historicalAction.type, 'fold');
  assert.equal(firstFeedback.feedback.replayerHandId, undefined);
  assert.equal(firstFeedback.feedback.historicalResult.outcome, 'FOLDED');
  assert.equal(firstFeedback.feedback.historicalSummary, 'Analiza ręki: Hero wygrał pulę, ale wcześniejszy call był zbyt luźny.');
  assert.equal((await repository.getSnapshot()).attempts.length, 1);
  const firstReviews = await fetch(`${baseUrl}/api/training/sessions/${sessionId}/reviews`).then((response) => response.json());
  assert.equal(firstReviews.reviews.length, 1);
  assert.equal(firstReviews.reviews[0].spotVersionId, first.question.spotVersionId);
  assert.equal(firstReviews.reviews[0].answer, firstPayload.answer);
  assert.equal(firstReviews.reviews[0].question.spotVersionId, first.question.spotVersionId);
  assert.equal(firstReviews.reviews[0].feedback.grade, firstFeedback.feedback.grade);

  const second = await fetch(`${baseUrl}/api/training/sessions/${sessionId}/next`).then((response) => response.json());
  const secondFeedback = await postJson(`${baseUrl}/api/training/sessions/${sessionId}/answers`, {
    spotVersionId: second.question.spotVersionId,
    answer: second.question.answerOptions[1].id,
  }).then((response) => response.json());
  assert.equal(secondFeedback.feedback.grade, TRAINING_GRADES.ACCEPTABLE);

  const third = await fetch(`${baseUrl}/api/training/sessions/${sessionId}/next`).then((response) => response.json());
  const thirdFeedback = await postJson(`${baseUrl}/api/training/sessions/${sessionId}/answers`, {
    spotVersionId: third.question.spotVersionId,
    answer: third.question.answerOptions[2].id,
  }).then((response) => response.json());
  assert.equal(thirdFeedback.feedback.grade, TRAINING_GRADES.INCORRECT);
  assert.equal(thirdFeedback.session.status, 'completed');
  assert.deepEqual(thirdFeedback.session.score, { correct: 1, acceptable: 1, incorrect: 1 });

  const finished = await fetch(`${baseUrl}/api/training/sessions/${sessionId}/next`).then((response) => response.json());
  assert.equal(finished.question, null);
  const history = await fetch(`${baseUrl}/api/training/history`).then((response) => response.json());
  assert.equal(history.totalAttempts, 3);
  assert.deepEqual(new Set(history.attempts.map(({ grade }) => grade)), new Set(Object.values(TRAINING_GRADES)));
  assert.equal(collectKeys(history).has('outcome'), false);
  const stats = await fetch(`${baseUrl}/api/training/stats`).then((response) => response.json());
  assert.deepEqual(stats.total, {
    total: 3, correct: 1, acceptable: 1, incorrect: 1,
    preferredRate: 0.3333, acceptedRate: 0.6667,
  });
  assert.equal(stats.byExerciseType.preflop_selection.total, 3);
  assert.equal(stats.byPosition['BTN/SB'].total, 3);
});

test('endpointy stop/wznów kończą bieżącą partię i nie wracają do jej spotów', async (t) => {
  let calls = 0;
  const sizes = [];
  let release;
  let enteredResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const { baseUrl, dataset } = await startTrainingApi(t, {
    handCount: 21,
    analyzeBatch: async ({ input }) => {
      calls += 1;
      sizes.push(input.spots.length);
      if (calls === 1) {
        enteredResolve();
        await gate;
      }
      return { keys: input.spots.map(makeAiKey) };
    },
  });
  await postJson(`${baseUrl}/api/training/refresh/scan`, { datasetRevision: dataset.datasetRevision });
  const started = await postJson(`${baseUrl}/api/training/refresh/start`, {
    modelId: 'gpt-5.6-terra', confirmed: true,
  }).then((response) => response.json());
  await entered;
  const stop = await postJson(`${baseUrl}/api/training/refresh/${started.job.id}/stop`, {});
  assert.equal(stop.status, 202);
  assert.equal((await stop.json()).job.status, 'stop_requested');
  release();
  const stopped = await waitForJob(baseUrl, started.job.id, ['stopped']);
  assert.equal(stopped.processedSpotCount, 20);
  assert.deepEqual(sizes, [20]);

  const resumed = await postJson(`${baseUrl}/api/training/refresh/${started.job.id}/resume`, {});
  assert.equal(resumed.status, 202);
  const completed = await waitForJob(baseUrl, started.job.id, ['completed']);
  assert.equal(completed.readyKeyCount, 21);
  assert.deepEqual(sizes, [20, 1]);
});

test('API przekazuje flagę przebudowy i zwraca stan selekcji oraz statystyki pul', async (t) => {
  const { baseUrl, dataset } = await startTrainingApi(t, { handCount: 2 });
  const scanned = await postJson(`${baseUrl}/api/training/refresh/scan`, {
    datasetRevision: dataset.datasetRevision, rebuildSelection: true,
  });
  assert.equal(scanned.status, 200);
  const body = await scanned.json();
  assert.equal(body.status.selectionState.strategy, 'diverse_recent_v1');
  assert.equal(body.status.selectionState.limit, 100);
  const pool = body.status.pools.preflop_selection.cash;
  assert.equal(pool.matching, 2);
  assert.equal(pool.selected, 2);
  assert.equal(pool.pending, 2);
  assert.equal(typeof pool.locallyRejected, 'number');
});

test('API blokuje przebudowę podczas możliwego do wznowienia zadania AI', async (t) => {
  const { baseUrl, dataset, repository } = await startTrainingApi(t, { handCount: 1 });
  await postJson(`${baseUrl}/api/training/refresh/scan`, { datasetRevision: dataset.datasetRevision });
  const spotVersionId = (await repository.getSnapshot()).spots[0].versionId;
  await repository.saveRefreshJob({
    id: 'paused-refresh', status: 'stopped', cursor: 0, candidateSpotVersionIds: [spotVersionId],
  });
  const response = await postJson(`${baseUrl}/api/training/refresh/scan`, {
    datasetRevision: dataset.datasetRevision, rebuildSelection: true,
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'TRAINING_SELECTION_REBUILD_BLOCKED');
});

test('API nie tworzy nowej kolejki przed wznowieniem poprzedniej', async (t) => {
  const { baseUrl, dataset, repository } = await startTrainingApi(t, { handCount: 1 });
  await postJson(`${baseUrl}/api/training/refresh/scan`, { datasetRevision: dataset.datasetRevision });
  const spotVersionId = (await repository.getSnapshot()).spots[0].versionId;
  await repository.saveRefreshJob({
    id: 'paused-refresh', status: 'stopped', cursor: 0, candidateSpotVersionIds: [spotVersionId],
  });

  const response = await postJson(`${baseUrl}/api/training/refresh/start`, {
    modelId: 'gpt-5.6-terra', confirmed: true,
  });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, 'TRAINING_REFRESH_RESUME_REQUIRED');
  assert.equal(body.resumableJob.id, 'paused-refresh');
  assert.equal((await repository.getSnapshot()).refreshJobs.length, 1);
});

test('API przerywa sesję i udostępnia oba zakresy resetu bez naruszania datasetu rozdań', async (t) => {
  const { baseUrl, dataset, repository } = await startTrainingApi(t, {
    handCount: 2,
    analyzeBatch: async ({ input }) => ({ keys: input.spots.map(makeAiKey) }),
  });
  await postJson(`${baseUrl}/api/training/refresh/scan`, { datasetRevision: dataset.datasetRevision });
  const refresh = await postJson(`${baseUrl}/api/training/refresh/start`, {
    modelId: 'gpt-5.6-terra', confirmed: true,
  }).then((response) => response.json());
  await waitForJob(baseUrl, refresh.job.id, ['completed']);

  const created = await postJson(`${baseUrl}/api/training/sessions`, {
    exerciseType: EXERCISE_TYPES.PREFLOP_SELECTION, gameType: 'cash', size: 10,
  }).then((response) => response.json());
  const sessionId = created.session.id;
  await fetch(`${baseUrl}/api/training/sessions/${sessionId}/next`).then((response) => response.json());
  const abandoned = await postJson(`${baseUrl}/api/training/sessions/${sessionId}/abandon`, {});
  assert.equal(abandoned.status, 200);
  assert.equal((await abandoned.json()).session.status, 'abandoned');

  const next = await fetch(`${baseUrl}/api/training/sessions/${sessionId}/next`);
  assert.equal(next.status, 409);
  assert.equal((await next.json()).code, 'TRAINING_SESSION_ABANDONED');
  const resumed = await postJson(`${baseUrl}/api/training/sessions`, { resumeSessionId: sessionId });
  assert.equal(resumed.status, 409);
  assert.equal((await resumed.json()).code, 'TRAINING_SESSION_ABANDONED');

  const missingConfirmation = await postJson(`${baseUrl}/api/training/reset`, { scope: 'answer_keys' });
  assert.equal(missingConfirmation.status, 409);
  assert.equal((await missingConfirmation.json()).code, 'TRAINING_RESET_CONFIRMATION_REQUIRED');
  const answerKeysReset = await postJson(`${baseUrl}/api/training/reset`, { scope: 'answer_keys', confirmed: true });
  assert.equal(answerKeysReset.status, 200);
  const afterKeysReset = await answerKeysReset.json();
  assert.equal(afterKeysReset.status.counts.spots, 2);
  assert.equal(afterKeysReset.status.counts.answerKeys, 0);
  assert.equal((await repository.getSnapshot()).sessions[0].status, 'abandoned');

  const fullReset = await postJson(`${baseUrl}/api/training/reset`, { scope: 'all', confirmed: true });
  assert.equal(fullReset.status, 200);
  assert.deepEqual((await fullReset.json()).status.counts, {
    spots: 0, answerKeys: 0, refreshJobs: 0, sessions: 0, attempts: 0,
  });
  const datasetAfterReset = await fetch(`${baseUrl}/api/dataset`).then((response) => response.json());
  assert.equal(datasetAfterReset.handCount, dataset.handCount);
});
