import { randomUUID } from 'node:crypto';
import { analyzeTrainingAnswerKeysWithModel, analyzeEquitySupplementsWithModel } from '../ai/analysisService.js';
import {
  TRAINING_ANSWER_KEY_BATCH_LIMIT,
  TRAINING_ANSWER_KEY_CONTRACT_VERSION,
  buildTrainingAnswerKeyBatchInput,
  createRejectedAnswerKey,
  validateTrainingAnswerKeyBatch,
} from './answerKeyContract.js';
import { isTrainingAuditExcluded } from './trainingAudit.js';
import { selectDiverseRecentSpots } from './spotSelection.js';
import {
  buildEquitySupplementBatchInput,
  calculateEquitySupplement,
  isEquitySupplementEligibleSpot,
  validateEquitySupplementBatch,
  EQUITY_RANGE_CONTRACT_VERSION,
} from './equitySupplementContract.js';
import {
  DEFAULT_TRAINING_REFRESH_SAMPLE_SIZE,
  isTrainingRefreshSampleSize,
} from '../../src/training/trainingTypes.js';

const TERMINAL_STATUSES = new Set(['completed', 'stopped', 'failed', 'superseded']);
const RESUMABLE_STATUSES = new Set(['running', 'stop_requested', 'stopped', 'failed']);
export const MAX_TRAINING_REFRESH_SPOTS = 800;
export const MAX_TRAINING_REFRESH_REQUESTS = 40;
export const REFRESH_JOB_KINDS = Object.freeze({ ANSWER_KEYS: 'answer_keys', MISSING_KEYS: 'missing_keys', EQUITY_SUPPLEMENT: 'equity_supplement' });
export { DEFAULT_TRAINING_REFRESH_SAMPLE_SIZE } from '../../src/training/trainingTypes.js';

export const isTrainingRefreshJobResumable = (job) => RESUMABLE_STATUSES.has(job?.status)
  && Number(job.cursor || 0) < (Array.isArray(job.candidateSpotVersionIds)
    ? job.candidateSpotVersionIds.length
    : 0);

export class TrainingRefreshError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TrainingRefreshError';
    this.code = code;
    Object.assign(this, details);
  }
}

const fail = (code, message, details) => {
  throw new TrainingRefreshError(code, message, details);
};

export const normalizeTrainingRefreshSampleSize = (value = DEFAULT_TRAINING_REFRESH_SAMPLE_SIZE) => {
  const normalized = value === '' || value === null || value === undefined
    ? DEFAULT_TRAINING_REFRESH_SAMPLE_SIZE
    : Number(value);
  if (!Number.isInteger(normalized) || !isTrainingRefreshSampleSize(normalized)) {
    fail(
      'TRAINING_REFRESH_SAMPLE_SIZE_INVALID',
      'Wielkość próbki musi wynosić 100, 200, 300, 400, 500, 600, 700 albo 800 spotów.',
    );
  }
  return normalized;
};

export const normalizeTrainingRefreshScope = (value = REFRESH_JOB_KINDS.ANSWER_KEYS) => {
  const scope = asString(value) || REFRESH_JOB_KINDS.ANSWER_KEYS;
  if (![REFRESH_JOB_KINDS.ANSWER_KEYS, REFRESH_JOB_KINDS.MISSING_KEYS, REFRESH_JOB_KINDS.EQUITY_SUPPLEMENT].includes(scope)) {
    fail('TRAINING_REFRESH_SCOPE_INVALID', 'Nieznany zakres odświeżania treningu.');
  }
  return scope;
};

const asString = (value) => String(value ?? '').trim();
const clone = (value) => JSON.parse(JSON.stringify(value));
const asIso = (clock) => clock().toISOString();

const isLocallyValid = (spot) => {
  if (spot?.localValid === false) return false;
  if (spot?.localValid === true) return true;
  try {
    buildTrainingAnswerKeyBatchInput([spot]);
    return true;
  } catch {
    return false;
  }
};

const collectCandidates = (collection, sampleSize, scope = REFRESH_JOB_KINDS.ANSWER_KEYS) => {
  const candidates = [];
  const locallyRejectedSpotVersionIds = [];
  (Array.isArray(collection?.spots) ? collection.spots : []).forEach((spot) => {
    const key = spot.currentAnswerKey || collection.answerKeys?.find((candidate) => candidate.id === spot.currentAnswerKeyId);
    const currentSupplement = collection.equitySupplements?.find((supplement) => (
      supplement.spotVersionId === spot.versionId && supplement.answerKeyId === spot.currentAnswerKeyId && !supplement.staleAt
    )) || spot.currentSupplement;
    if (scope === REFRESH_JOB_KINDS.EQUITY_SUPPLEMENT) {
      if (!isEquitySupplementEligibleSpot(spot, key) || currentSupplement) return;
    } else if (spot?.sourceStatus !== 'current'
      || spot.exerciseType === 'equity_pot_odds'
      || spot?.aiFirstSentAt
      || isTrainingAuditExcluded(collection?.auditState, {
        handId: spot?.handId,
        fingerprint: spot?.sourceFingerprint,
      })
      || spot.readiness !== 'pending_key') return;
    if (scope !== REFRESH_JOB_KINDS.EQUITY_SUPPLEMENT && !isLocallyValid(spot)) {
      locallyRejectedSpotVersionIds.push(spot.versionId);
      return;
    }
    candidates.push(spot);
  });
  return {
    candidates: selectDiverseRecentSpots(candidates, { limit: sampleSize }),
    locallyRejectedSpotVersionIds,
  };
};

export const estimateTrainingRefresh = (collection, {
  batchSize = TRAINING_ANSWER_KEY_BATCH_LIMIT,
  sampleSize = DEFAULT_TRAINING_REFRESH_SAMPLE_SIZE,
  scope = REFRESH_JOB_KINDS.ANSWER_KEYS,
} = {}) => {
  if (batchSize !== TRAINING_ANSWER_KEY_BATCH_LIMIT) {
    fail('TRAINING_REFRESH_BATCH_SIZE_INVALID', `Partia musi zawierać od 1 do ${TRAINING_ANSWER_KEY_BATCH_LIMIT} spotów.`);
  }
  const normalizedSampleSize = normalizeTrainingRefreshSampleSize(sampleSize);
  const { candidates, locallyRejectedSpotVersionIds } = collectCandidates(
    collection,
    normalizedSampleSize,
    scope,
  );
  const groups = {};
  candidates.forEach((spot) => {
    const key = `${spot.exerciseType}:${spot.gameType}`;
    groups[key] = (groups[key] || 0) + 1;
  });
  return {
    candidateCount: candidates.length,
    estimatedRequests: Math.ceil(candidates.length / batchSize),
    batchSize,
    sampleSize: normalizedSampleSize,
    groups,
    candidateSpotVersionIds: candidates.map(({ versionId }) => versionId),
    locallyRejectedSpotVersionIds,
    locallyRejectedCount: locallyRejectedSpotVersionIds.length,
  };
};

const safeError = (error, spotVersionIds) => ({
  code: asString(error?.code) || 'TRAINING_AI_BATCH_FAILED',
  message: asString(error?.message) || 'Nie udało się przygotować partii kluczy AI.',
  spotVersionIds: [...spotVersionIds],
});

const findJob = (collection, jobId) => collection.refreshJobs?.find(({ id }) => id === jobId);

export const createTrainingRefreshService = ({
  repository,
  analyzeBatch = analyzeTrainingAnswerKeysWithModel,
  analyzeSupplement = analyzeEquitySupplementsWithModel,
  environment = process.env,
  fetchImpl = globalThis.fetch,
  logger,
  clock = () => new Date(),
  instanceId = `training-refresh-instance-${randomUUID()}`,
  idFactory = (prefix) => `${prefix}-${randomUUID()}`,
  batchSize = TRAINING_ANSWER_KEY_BATCH_LIMIT,
} = {}) => {
  if (!repository?.getSnapshot || !repository?.transact || !repository?.saveRefreshJob || !repository?.saveAnswerKeyBatch) {
    fail('TRAINING_REFRESH_REPOSITORY_REQUIRED', 'Usługa odświeżania wymaga repozytorium treningowego.');
  }
  if (typeof analyzeBatch !== 'function') {
    fail('TRAINING_REFRESH_ANALYZER_REQUIRED', 'Usługa odświeżania wymaga funkcji analizy AI.');
  }
  if (typeof analyzeSupplement !== 'function') {
    fail('TRAINING_SUPPLEMENT_ANALYZER_REQUIRED', 'Usługa suplementów equity wymaga funkcji analizy AI.');
  }
  estimateTrainingRefresh({ spots: [] }, { batchSize });

  const activeRuns = new Map();
  const stopRequested = new Set();
  let recoveryInProgress = true;
  let recoveryPromise = Promise.resolve();

  const eventSnapshot = (job, eventType, {
    spotCount = 0,
    details = {},
  } = {}) => ({
    eventType,
    jobId: job?.id || job?.jobId || null,
    instanceId,
    status: job?.status || null,
    cursor: Number.isInteger(job?.cursor) ? job.cursor : null,
    batchSize: Number.isInteger(job?.batchSize) ? job.batchSize : null,
    spotCount: Number(spotCount) || 0,
    attemptedRequests: Number.isInteger(job?.attemptedRequests) ? job.attemptedRequests : null,
    successfulRequests: Number.isInteger(job?.successfulRequests) ? job.successfulRequests : null,
    inFlightSpotCount: Array.isArray(job?.inFlight?.spotVersionIds)
      ? job.inFlight.spotVersionIds.length
      : 0,
    details: Object.fromEntries(Object.entries(details || {}).filter(([, value]) => (
      ['string', 'number', 'boolean'].includes(typeof value) || value === null
    ))),
    createdAt: asIso(clock),
  });

  const emitEvent = async (eventType, job, options = {}) => {
    const event = eventSnapshot(job, eventType, options);
    try {
      if (typeof repository.appendRefreshJobEvent === 'function') {
        await repository.appendRefreshJobEvent(event);
      }
    } catch (error) {
      logger?.error?.({
        code: asString(error?.code) || 'TRAINING_REFRESH_EVENT_PERSIST_FAILED',
        message: asString(error?.message) || 'Nie udało się zapisać zdarzenia odświeżania.',
        jobId: event.jobId,
        instanceId,
      });
    }
    logger?.info?.({ event: `training_refresh.${eventType}`, ...event });
    return event;
  };

  const getStoredJob = async (jobId) => {
    const job = repository.getRefreshJob
      ? await repository.getRefreshJob(jobId)
      : findJob(await repository.getSnapshot(), jobId);
    if (!job) {
      await emitEvent('job_not_found', { jobId: asString(jobId) }, {
        details: { code: 'TRAINING_REFRESH_JOB_NOT_FOUND' },
      });
      fail('TRAINING_REFRESH_JOB_NOT_FOUND', `Nie znaleziono zadania ${jobId}.`);
    }
    return { job };
  };

  const saveJob = async (job) => (await repository.saveRefreshJob(job)).result;

  const saveNewJob = async (job) => {
    if (repository.getRefreshJobs && repository.saveRefreshJob) {
      const resumable = (await repository.getRefreshJobs()).find(isTrainingRefreshJobResumable);
      if (resumable) {
        fail(
          'TRAINING_REFRESH_RESUME_REQUIRED',
          'Najpierw wznowić i dokończyć poprzednie zadanie AI, zanim uruchomisz nowe.',
          { resumableJob: clone(resumable) },
        );
      }
      return (await repository.saveRefreshJob(job)).result;
    }
    const saved = await repository.transact((collection) => {
      const resumable = collection.refreshJobs.find(isTrainingRefreshJobResumable);
      if (resumable) {
        fail(
          'TRAINING_REFRESH_RESUME_REQUIRED',
          'Najpierw wznowić i dokończyć poprzednie zadanie AI, zanim uruchomisz nowe.',
          { resumableJob: clone(resumable) },
        );
      }
      collection.refreshJobs.push(job);
      return job;
    });
    return saved.result;
  };

  const decorateKeys = (keys, job, model, keyPrefix = 'training-key') => keys.map((key) => ({
    ...key,
    id: idFactory(keyPrefix),
    refreshJobId: job.id,
    model: model || { id: job.modelId, name: job.modelId },
  }));

  const markUnexpectedFailure = async (jobId, error) => {
    try {
      const { job } = await getStoredJob(jobId);
      if (TERMINAL_STATUSES.has(job.status)) return;
      const failedJob = await saveJob({
        ...job,
        status: 'failed',
        inFlight: null,
        errors: [...(job.errors || []), safeError(error, job.inFlight?.spotVersionIds || [])],
        finishedAt: asIso(clock),
      });
      await emitEvent('failed', failedJob, {
        spotCount: job.inFlight?.spotVersionIds?.length || 0,
        details: { code: safeError(error, []).code },
      });
    } catch (persistError) {
      logger?.error?.({
        code: asString(persistError?.code) || 'TRAINING_REFRESH_PERSIST_FAILED',
        jobId,
      });
    }
  };

  const runEquityBatch = async ({ job, candidateIds, batchSpotVersionIds, spots }) => {
    const current = await repository.getSnapshot();
    const keysById = new Map((current.answerKeys || []).map((key) => [key.id, key]));
    const spotsById = new Map(spots.map((spot) => [spot.versionId, spot]));
    const batchSpots = batchSpotVersionIds.map((id) => spotsById.get(id)).filter((spot) => {
      const key = keysById.get(spot?.currentAnswerKeyId);
      return spot && isEquitySupplementEligibleSpot(spot, key)
        && !(current.equitySupplements || []).some((supplement) => supplement.spotVersionId === spot.versionId
          && supplement.answerKeyId === spot.currentAnswerKeyId && !supplement.staleAt);
    });
    if (batchSpots.length === 0) {
      const skipped = await saveJob({
        ...job,
        cursor: job.cursor + candidateIds.length,
        skippedSpotCount: job.skippedSpotCount + candidateIds.length,
      });
      return { job: skipped, done: false };
    }
    const input = buildEquitySupplementBatchInput(batchSpots, batchSpots.map((spot) => keysById.get(spot.currentAnswerKeyId)));
    const startedAt = asIso(clock);
    const prepared = await saveJob({
      ...job,
      attemptedRequests: job.attemptedRequests + 1,
      inFlight: { spotVersionIds: input.supplements.map(({ spotVersionId }) => spotVersionId), startedAt },
    });
    await emitEvent('batch_sent', prepared, { spotCount: input.supplements.length });
    let analysis;
    try {
      analysis = await analyzeSupplement({ modelId: job.modelId, input: { ...input, spots: batchSpots, answerKeys: batchSpots.map((spot) => keysById.get(spot.currentAnswerKeyId)) }, environment, fetchImpl, logger });
    } catch (error) {
      const batchError = safeError(error, input.supplements.map(({ spotVersionId }) => spotVersionId));
      return saveJob({ ...prepared, status: 'failed', cursor: prepared.cursor + candidateIds.length, processedSpotCount: prepared.processedSpotCount + candidateIds.length, skippedSpotCount: prepared.skippedSpotCount + candidateIds.length - batchSpots.length, inFlight: null, errors: [...prepared.errors, batchError], finishedAt: asIso(clock) });
    }
    const validated = analysis?.validated || validateEquitySupplementBatch(analysis?.response ?? analysis, input);
    const supplements = validated.valid.map(({ spotVersionId, opponentRange }) => {
      const spot = batchSpots.find((candidate) => candidate.versionId === spotVersionId);
      const key = keysById.get(spot.currentAnswerKeyId);
      return {
        id: `equity-supplement:${spotVersionId}:${key.id}`,
        spotVersionId,
        answerKeyId: key.id,
        opponentRange,
        rangeContractVersion: EQUITY_RANGE_CONTRACT_VERSION,
        calculatorVersion: input.calculatorVersion,
        equityResult: calculateEquitySupplement({ heroCards: spot.question.heroCards, board: spot.question.board }, opponentRange),
        model: analysis?.model || { id: job.modelId, name: job.modelId },
        createdAt: asIso(clock),
      };
    });
    if (supplements.length && repository.saveEquitySupplementBatch) await repository.saveEquitySupplementBatch(supplements);
    const latest = (await getStoredJob(job.id)).job;
    const nextCursor = latest.cursor + candidateIds.length;
    const next = {
      ...latest,
      cursor: nextCursor,
      processedSpotCount: latest.processedSpotCount + candidateIds.length,
      skippedSpotCount: latest.skippedSpotCount + candidateIds.length - batchSpots.length,
      inFlight: null,
      successfulRequests: latest.successfulRequests + 1,
      savedKeyCount: latest.savedKeyCount + supplements.length,
      savedSupplementCount: (latest.savedSupplementCount || 0) + supplements.length,
      readyKeyCount: latest.readyKeyCount + supplements.length,
      reviewKeyCount: latest.reviewKeyCount + validated.rejected.length,
      invalidKeyCount: latest.invalidKeyCount + validated.rejected.length,
      unknownResultCount: latest.unknownResultCount + validated.rejected.length,
      status: nextCursor >= latest.candidateSpotVersionIds.length ? 'completed' : 'running',
    };
    if (next.status === 'completed') next.finishedAt = asIso(clock);
    const saved = await saveJob(next);
    await emitEvent('batch_committed', saved, { spotCount: batchSpotVersionIds.length });
    return { job: saved, done: true };
  };

  const run = async (jobId) => {
    while (true) {
      const { job: storedJob } = await getStoredJob(jobId);
      let job = clone(storedJob);
      if (storedJob.status !== 'running' && storedJob.status !== 'stop_requested') return job;
      if (stopRequested.has(jobId) || storedJob.status === 'stop_requested') {
        stopRequested.delete(jobId);
        const stoppedJob = await saveJob({ ...job, status: 'stopped', stopRequested: false, stoppedAt: asIso(clock) });
        await emitEvent('stopped', stoppedJob, { details: { reason: 'stop_requested' } });
        return stoppedJob;
      }
      if (job.cursor >= job.candidateSpotVersionIds.length) {
        const completedJob = await saveJob({ ...job, status: 'completed', finishedAt: asIso(clock) });
        await emitEvent('completed', completedJob);
        return completedJob;
      }

      const candidateIds = job.candidateSpotVersionIds.slice(job.cursor, job.cursor + job.batchSize);
      const batchSpotVersionIds = job.inFlight?.spotVersionIds?.length
        ? [...job.inFlight.spotVersionIds]
        : candidateIds;
      const spots = repository.getSpotsByVersionIds
        ? await repository.getSpotsByVersionIds(batchSpotVersionIds)
        : (await repository.getSnapshot()).spots;
      const spotsById = new Map(spots.map((spot) => [spot.versionId, spot]));
      const batchSpots = batchSpotVersionIds
        .map((id) => spotsById.get(id))
        .filter((spot) => spot?.sourceStatus === 'current'
          && (job.jobKind === REFRESH_JOB_KINDS.EQUITY_SUPPLEMENT || isLocallyValid(spot)));
      if (batchSpots.length === 0) {
        job.cursor += candidateIds.length;
        job.skippedSpotCount += candidateIds.length;
        await saveJob(job);
        continue;
      }

      if (job.jobKind === REFRESH_JOB_KINDS.EQUITY_SUPPLEMENT) {
        const result = await runEquityBatch({ job, candidateIds, batchSpotVersionIds, spots });
        job = result.job;
        if (job.status !== 'running') return job;
        continue;
      }
      const input = buildTrainingAnswerKeyBatchInput(batchSpots);
      const startedAt = asIso(clock);
      job = await saveJob({
        ...job,
        attemptedRequests: job.attemptedRequests + 1,
        inFlight: { spotVersionIds: input.spots.map(({ spotVersionId }) => spotVersionId), startedAt },
      });
      await emitEvent('batch_sent', job, { spotCount: input.spots.length });

      let analysis;
      try {
        analysis = await analyzeBatch({
          modelId: job.modelId,
          input,
          environment,
          fetchImpl,
          logger,
        });
      } catch (error) {
        const batchError = safeError(error, input.spots.map(({ spotVersionId }) => spotVersionId));
        const rejectedKeys = decorateKeys(input.spots.map(({ spotVersionId, heroHand, decisionCardFacts }) => createRejectedAnswerKey({
          spotVersionId,
          heroHand,
          decisionCardFacts,
          errors: [`${batchError.code}: ${batchError.message}`],
        })), job, { id: job.modelId, name: job.modelId }, 'training-rejected-key');
        job.status = 'failed';
        job.cursor += candidateIds.length;
        job.processedSpotCount += candidateIds.length;
        job.skippedSpotCount += candidateIds.length - batchSpots.length;
        job.inFlight = null;
        job.reviewKeyCount += rejectedKeys.length;
        job.invalidKeyCount += rejectedKeys.length;
        job.savedKeyCount += rejectedKeys.length;
        job.errors = [...job.errors, batchError];
        job.finishedAt = asIso(clock);
        const saved = (await repository.saveAnswerKeyBatch(rejectedKeys, job)).result.job;
        await emitEvent('provider_error', saved, {
          spotCount: input.spots.length,
          details: { code: batchError.code },
        });
        return saved;
      }

      const response = analysis?.response ?? analysis;
      const validated = validateTrainingAnswerKeyBatch(response, input);
      const acceptedKeys = decorateKeys(validated.validKeys, job, analysis?.model);
      const rejectedKeys = decorateKeys(validated.rejected.map((rejection) => createRejectedAnswerKey({
        ...rejection,
        decisionCardFacts: input.spots.find(({ spotVersionId }) => spotVersionId === rejection.spotVersionId)?.decisionCardFacts,
      })), job, analysis?.model, 'training-rejected-key');
      const keys = [...acceptedKeys, ...rejectedKeys];
      const latest = (await getStoredJob(jobId)).job;
      const shouldStop = stopRequested.has(jobId) || latest.status === 'stop_requested';
      const nextCursor = latest.cursor + candidateIds.length;
      job = {
        ...latest,
        cursor: nextCursor,
        processedSpotCount: latest.processedSpotCount + candidateIds.length,
        skippedSpotCount: latest.skippedSpotCount + candidateIds.length - batchSpots.length,
        inFlight: null,
        successfulRequests: latest.successfulRequests + 1,
        savedKeyCount: latest.savedKeyCount + keys.length,
        readyKeyCount: latest.readyKeyCount + acceptedKeys.filter(({ status }) => status === 'ready').length,
        reviewKeyCount: latest.reviewKeyCount + acceptedKeys.filter(({ status }) => status === 'review').length + rejectedKeys.length,
        invalidKeyCount: latest.invalidKeyCount + rejectedKeys.length,
        unknownResultCount: latest.unknownResultCount + validated.unknownResults.length,
        stopRequested: false,
        status: shouldStop
          ? 'stopped'
          : (nextCursor >= latest.candidateSpotVersionIds.length ? 'completed' : 'running'),
      };
      if (shouldStop) job.stoppedAt = asIso(clock);
      if (job.status === 'completed') job.finishedAt = asIso(clock);
      const saved = await repository.saveAnswerKeyBatch(keys, job);
      stopRequested.delete(jobId);
      job = saved.result.job;
      await emitEvent('batch_committed', job, { spotCount: batchSpotVersionIds.length });
      if (job.status === 'completed') await emitEvent('completed', job);
      if (job.status !== 'running') return job;
    }
  };

  const launch = (jobId) => {
    const promise = Promise.resolve()
      .then(() => run(jobId))
      .catch(async (error) => {
        await markUnexpectedFailure(jobId, error);
        throw error;
      })
      .finally(() => activeRuns.delete(jobId));
    // The caller gets the persisted job immediately; failures remain available in job status.
    promise.catch(() => {});
    activeRuns.set(jobId, promise);
    return promise;
  };

  const getStoredJobs = async () => {
    const jobs = repository.getRefreshJobs
      ? await repository.getRefreshJobs()
      : (await repository.getSnapshot())?.refreshJobs;
    return Array.isArray(jobs) ? jobs : [];
  };

  const recoverPendingRefreshes = async () => {
    try {
      const jobs = await getStoredJobs();
      const stoppedOnRestart = jobs.filter(({ status }) => status === 'stop_requested');
      for (const job of stoppedOnRestart) {
        const stoppedJob = await saveJob({
          ...job,
          status: 'stopped',
          stopRequested: false,
          stoppedAt: job.stoppedAt || asIso(clock),
        });
        await emitEvent('stopped', stoppedJob, { details: { reason: 'server_restart' } });
      }

      const currentContractJobs = jobs.filter(({ contractVersion }) => (
        contractVersion === TRAINING_ANSWER_KEY_CONTRACT_VERSION
      ));
      const running = currentContractJobs
        .filter(({ status }) => status === 'running')
        .sort((left, right) => (
          (Date.parse(left.updatedAt || left.createdAt || '') || 0)
          - (Date.parse(right.updatedAt || right.createdAt || '') || 0)
        ));
      const resumable = running.find(isTrainingRefreshJobResumable) || running[0];
      if (resumable) {
        const recoveredAt = asIso(clock);
        const recoveredJob = await saveJob({
          ...resumable,
          recoveryCount: (Number(resumable.recoveryCount) || 0) + 1,
          lastRecoveredAt: recoveredAt,
        });
        await emitEvent('recovered', recoveredJob, {
          spotCount: recoveredJob.inFlight?.spotVersionIds?.length || 0,
          details: { reason: 'server_restart' },
        });
        launch(recoveredJob.id);
      }
    } catch (error) {
      logger?.error?.({
        code: asString(error?.code) || 'TRAINING_REFRESH_RECOVERY_FAILED',
        message: asString(error?.message) || 'Nie udało się odzyskać zadań odświeżania.',
      });
    } finally {
      recoveryInProgress = false;
    }
  };

  recoveryPromise = recoverPendingRefreshes();
  recoveryPromise.catch(() => {});

  return {
    hasActiveRun: () => recoveryInProgress || activeRuns.size > 0,
    estimate: async (options = {}) => {
      const sampleSize = normalizeTrainingRefreshSampleSize(options.sampleSize);
      const scope = normalizeTrainingRefreshScope(options.scope);
      if (!repository.getRefreshEstimateData) {
        return estimateTrainingRefresh(await repository.getSnapshot(), { ...options, batchSize, scope });
      }
       const data = await repository.getRefreshEstimateData(sampleSize, scope);
      const estimate = estimateTrainingRefresh(
        { spots: data.spots, auditState: { excludedHands: [] } },
        { ...options, batchSize, sampleSize, scope },
      );
      return {
        ...estimate,
        locallyRejectedSpotVersionIds: data.locallyRejectedSpotVersionIds,
        locallyRejectedCount: data.locallyRejectedSpotVersionIds.length,
      };
    },
    startRefresh: async ({ modelId, confirmed = false, sampleSize, scope = REFRESH_JOB_KINDS.ANSWER_KEYS } = {}) => {
      await recoveryPromise;
      scope = normalizeTrainingRefreshScope(scope);
      if (scope === REFRESH_JOB_KINDS.EQUITY_SUPPLEMENT && typeof repository.saveEquitySupplementBatch !== 'function') {
        fail('TRAINING_SUPPLEMENT_REPOSITORY_REQUIRED', 'Repozytorium nie obsługuje zapisu suplementów equity.');
      }
      const normalizedModelId = asString(modelId);
      if (!normalizedModelId) fail('TRAINING_REFRESH_MODEL_REQUIRED', 'Wybierz model do przygotowania kluczy.');
      const jobs = repository.getRefreshJobs
        ? await repository.getRefreshJobs()
        : (await repository.getSnapshot()).refreshJobs;
      const resumable = jobs.find(isTrainingRefreshJobResumable);
      if (resumable) {
        fail(
          'TRAINING_REFRESH_RESUME_REQUIRED',
          'Najpierw wznowić i dokończyć poprzednie zadanie AI, zanim uruchomisz nowe.',
          { resumableJob: clone(resumable) },
        );
      }
      const estimate = await (repository.getRefreshEstimateData
        ? (async () => {
           const data = await repository.getRefreshEstimateData(sampleSize, scope);
          const value = estimateTrainingRefresh(
            { spots: data.spots, auditState: { excludedHands: [] } },
           { batchSize, sampleSize, scope },
          );
          return {
            ...value,
            locallyRejectedSpotVersionIds: data.locallyRejectedSpotVersionIds,
            locallyRejectedCount: data.locallyRejectedSpotVersionIds.length,
          };
        })()
        : estimateTrainingRefresh(await repository.getSnapshot(), { batchSize, sampleSize, scope }));
      if (estimate.candidateCount > MAX_TRAINING_REFRESH_SPOTS
        || estimate.estimatedRequests > MAX_TRAINING_REFRESH_REQUESTS) {
        fail('TRAINING_REFRESH_LIMIT_EXCEEDED', 'Zadanie AI przekracza bezpieczny limit 800 spotów lub 40 żądań.');
      }
      if (!confirmed) {
        fail(
          'TRAINING_REFRESH_CONFIRMATION_REQUIRED',
          `Odświeżenie może wykonać ${estimate.estimatedRequests} płatnych żądań i wymaga potwierdzenia.`,
          { estimate },
        );
      }
      const createdAt = asIso(clock);
      const job = {
        id: idFactory('training-refresh'),
        status: estimate.candidateCount === 0 ? 'completed' : 'running',
        modelId: normalizedModelId,
        contractVersion: TRAINING_ANSWER_KEY_CONTRACT_VERSION,
        jobKind: scope === REFRESH_JOB_KINDS.EQUITY_SUPPLEMENT
          ? REFRESH_JOB_KINDS.EQUITY_SUPPLEMENT
          : scope === REFRESH_JOB_KINDS.MISSING_KEYS ? REFRESH_JOB_KINDS.MISSING_KEYS : REFRESH_JOB_KINDS.ANSWER_KEYS,
        batchSize,
        sampleSize: estimate.sampleSize,
        candidateSpotVersionIds: estimate.candidateSpotVersionIds,
        candidateCount: estimate.candidateCount,
        estimatedRequests: estimate.estimatedRequests,
        cursor: 0,
        attemptedRequests: 0,
        successfulRequests: 0,
        processedSpotCount: 0,
        skippedSpotCount: 0,
        savedKeyCount: 0,
        savedSupplementCount: 0,
        readyKeyCount: 0,
        reviewKeyCount: 0,
        invalidKeyCount: 0,
        unknownResultCount: 0,
        recoveryCount: 0,
        lastRecoveredAt: null,
        stopRequested: false,
        inFlight: null,
        errors: [],
        createdAt,
        startedAt: estimate.candidateCount > 0 ? createdAt : null,
        stoppedAt: null,
        finishedAt: estimate.candidateCount === 0 ? createdAt : null,
      };
      const saved = await saveNewJob(job);
      await emitEvent('created', saved, { spotCount: saved.candidateCount });
      if (saved.status === 'completed') await emitEvent('completed', saved);
      if (saved.status === 'running') launch(saved.id);
      return saved;
    },
    stopRefresh: async (jobId) => {
      await recoveryPromise;
      const { job } = await getStoredJob(jobId);
      if (TERMINAL_STATUSES.has(job.status)) return clone(job);
      const isRunningHere = activeRuns.has(jobId);
      if (isRunningHere) stopRequested.add(jobId);
      const saved = await saveJob({
        ...job,
        status: isRunningHere ? 'stop_requested' : 'stopped',
        stopRequested: isRunningHere,
        stoppedAt: isRunningHere ? job.stoppedAt : asIso(clock),
      });
      if (!isRunningHere) await emitEvent('stopped', saved, { details: { reason: 'manual' } });
      return saved;
    },
    resumeRefresh: async (jobId) => {
      await recoveryPromise;
      const { job } = await getStoredJob(jobId);
      if (job.contractVersion !== TRAINING_ANSWER_KEY_CONTRACT_VERSION) {
        fail('TRAINING_REFRESH_CONTRACT_SUPERSEDED', 'Zadanie używa starego kontraktu i nie można go wznowić.');
      }
      if (activeRuns.has(jobId)) return clone(job);
      if (!['stopped', 'failed', 'running', 'stop_requested'].includes(job.status)) {
        fail('TRAINING_REFRESH_NOT_RESUMABLE', `Zadania w stanie ${job.status} nie można wznowić.`);
      }
      if (job.cursor >= job.candidateSpotVersionIds.length) {
        fail('TRAINING_REFRESH_NO_REMAINING_BATCHES', 'Zadanie nie ma nieprzetworzonych partii do wznowienia.');
      }
      const errors = [...(job.errors || [])];
      if (job.inFlight?.spotVersionIds?.length) {
        errors.push({
          code: 'TRAINING_REFRESH_INTERRUPTED_BATCH',
          message: 'Partia przerwana przed zapisaniem wyniku AI wymaga ponowienia.',
          spotVersionIds: [...job.inFlight.spotVersionIds],
        });
      }
      const saved = await saveJob({
        ...job,
        status: 'running',
        stopRequested: false,
        inFlight: null,
        errors,
        finishedAt: null,
        stoppedAt: null,
        resumedAt: asIso(clock),
      });
      launch(saved.id);
      return saved;
    },
    getJob: async (jobId) => {
      await recoveryPromise;
      return clone((await getStoredJob(jobId)).job);
    },
    waitForIdle: async (jobId) => {
      await recoveryPromise;
      const active = activeRuns.get(jobId);
      if (active) await active;
      return clone((await getStoredJob(jobId)).job);
    },
  };
};
