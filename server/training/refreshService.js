import { randomUUID } from 'node:crypto';
import { analyzeTrainingAnswerKeysWithModel } from '../ai/analysisService.js';
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
  DEFAULT_TRAINING_REFRESH_SAMPLE_SIZE,
  isTrainingRefreshSampleSize,
} from '../../src/training/trainingTypes.js';

const TERMINAL_STATUSES = new Set(['completed', 'stopped', 'failed', 'superseded']);
const RESUMABLE_STATUSES = new Set(['running', 'stop_requested', 'stopped', 'failed']);
export const MAX_TRAINING_REFRESH_SPOTS = 800;
export const MAX_TRAINING_REFRESH_REQUESTS = 40;
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

const asString = (value) => String(value ?? '').trim();
const clone = (value) => JSON.parse(JSON.stringify(value));
const asIso = (clock) => clock().toISOString();

const isLocallyValid = (spot) => {
  try {
    buildTrainingAnswerKeyBatchInput([spot]);
    return true;
  } catch {
    return false;
  }
};

const collectCandidates = (collection, sampleSize) => {
  const candidates = [];
  const locallyRejectedSpotVersionIds = [];
  (Array.isArray(collection?.spots) ? collection.spots : []).forEach((spot) => {
    if (spot?.sourceStatus !== 'current'
      || spot?.aiFirstSentAt
      || isTrainingAuditExcluded(collection?.auditState, {
        handId: spot?.handId,
        fingerprint: spot?.sourceFingerprint,
      })
      || spot.readiness !== 'pending_key') return;
    if (!isLocallyValid(spot)) {
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
} = {}) => {
  if (batchSize !== TRAINING_ANSWER_KEY_BATCH_LIMIT) {
    fail('TRAINING_REFRESH_BATCH_SIZE_INVALID', `Partia musi zawierać od 1 do ${TRAINING_ANSWER_KEY_BATCH_LIMIT} spotów.`);
  }
  const normalizedSampleSize = normalizeTrainingRefreshSampleSize(sampleSize);
  const { candidates, locallyRejectedSpotVersionIds } = collectCandidates(
    collection,
    normalizedSampleSize,
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
  environment = process.env,
  fetchImpl = globalThis.fetch,
  logger,
  clock = () => new Date(),
  idFactory = (prefix) => `${prefix}-${randomUUID()}`,
  batchSize = TRAINING_ANSWER_KEY_BATCH_LIMIT,
} = {}) => {
  if (!repository?.getSnapshot || !repository?.transact || !repository?.saveRefreshJob || !repository?.saveAnswerKeyBatch) {
    fail('TRAINING_REFRESH_REPOSITORY_REQUIRED', 'Usługa odświeżania wymaga repozytorium treningowego.');
  }
  if (typeof analyzeBatch !== 'function') {
    fail('TRAINING_REFRESH_ANALYZER_REQUIRED', 'Usługa odświeżania wymaga funkcji analizy AI.');
  }
  estimateTrainingRefresh({ spots: [] }, { batchSize });

  const activeRuns = new Map();
  const stopRequested = new Set();

  const getStoredJob = async (jobId) => {
    const snapshot = await repository.getSnapshot();
    const job = findJob(snapshot, jobId);
    if (!job) fail('TRAINING_REFRESH_JOB_NOT_FOUND', `Nie znaleziono zadania ${jobId}.`);
    return { snapshot, job };
  };

  const saveJob = async (job) => (await repository.saveRefreshJob(job)).result;

  const saveNewJob = async (job) => {
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
      await saveJob({
        ...job,
        status: 'failed',
        inFlight: null,
        errors: [...(job.errors || []), safeError(error, job.inFlight?.spotVersionIds || [])],
        finishedAt: asIso(clock),
      });
    } catch (persistError) {
      logger?.error?.({
        code: asString(persistError?.code) || 'TRAINING_REFRESH_PERSIST_FAILED',
        jobId,
      });
    }
  };

  const run = async (jobId) => {
    while (true) {
      const { snapshot, job: storedJob } = await getStoredJob(jobId);
      let job = clone(storedJob);
      if (storedJob.status !== 'running' && storedJob.status !== 'stop_requested') return job;
      if (stopRequested.has(jobId) || storedJob.status === 'stop_requested') {
        stopRequested.delete(jobId);
        return saveJob({ ...job, status: 'stopped', stopRequested: false, stoppedAt: asIso(clock) });
      }
      if (job.cursor >= job.candidateSpotVersionIds.length) {
        return saveJob({ ...job, status: 'completed', finishedAt: asIso(clock) });
      }

      const candidateIds = job.candidateSpotVersionIds.slice(job.cursor, job.cursor + job.batchSize);
      const spotsById = new Map(snapshot.spots.map((spot) => [spot.versionId, spot]));
      const batchSpots = candidateIds
        .map((id) => spotsById.get(id))
        .filter((spot) => spot?.sourceStatus === 'current' && isLocallyValid(spot));
      if (batchSpots.length === 0) {
        job.cursor += candidateIds.length;
        job.skippedSpotCount += candidateIds.length;
        await saveJob(job);
        continue;
      }

      const input = buildTrainingAnswerKeyBatchInput(batchSpots);
      const startedAt = asIso(clock);
      job = await saveJob({
        ...job,
        cursor: job.cursor + candidateIds.length,
        attemptedRequests: job.attemptedRequests + 1,
        processedSpotCount: job.processedSpotCount + candidateIds.length,
        skippedSpotCount: job.skippedSpotCount + candidateIds.length - batchSpots.length,
        inFlight: { spotVersionIds: input.spots.map(({ spotVersionId }) => spotVersionId), startedAt },
      });

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
        job.inFlight = null;
        job.reviewKeyCount += rejectedKeys.length;
        job.invalidKeyCount += rejectedKeys.length;
        job.savedKeyCount += rejectedKeys.length;
        job.errors = [...job.errors, batchError];
        job.finishedAt = asIso(clock);
        return (await repository.saveAnswerKeyBatch(rejectedKeys, job)).result.job;
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
      job = {
        ...latest,
        cursor: job.cursor,
        attemptedRequests: job.attemptedRequests,
        processedSpotCount: job.processedSpotCount,
        skippedSpotCount: job.skippedSpotCount,
        inFlight: null,
        successfulRequests: job.successfulRequests + 1,
        savedKeyCount: job.savedKeyCount + keys.length,
        readyKeyCount: job.readyKeyCount + acceptedKeys.filter(({ status }) => status === 'ready').length,
        reviewKeyCount: job.reviewKeyCount + acceptedKeys.filter(({ status }) => status === 'review').length + rejectedKeys.length,
        invalidKeyCount: job.invalidKeyCount + rejectedKeys.length,
        unknownResultCount: job.unknownResultCount + validated.unknownResults.length,
        stopRequested: false,
        status: shouldStop
          ? 'stopped'
          : (job.cursor >= job.candidateSpotVersionIds.length ? 'completed' : 'running'),
      };
      if (shouldStop) job.stoppedAt = asIso(clock);
      if (job.status === 'completed') job.finishedAt = asIso(clock);
      const saved = await repository.saveAnswerKeyBatch(keys, job);
      stopRequested.delete(jobId);
      job = saved.result.job;
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

  return {
    hasActiveRun: () => activeRuns.size > 0,
    estimate: async (options = {}) => estimateTrainingRefresh(
      await repository.getSnapshot(),
      { ...options, batchSize },
    ),
    startRefresh: async ({ modelId, confirmed = false, sampleSize } = {}) => {
      const normalizedModelId = asString(modelId);
      if (!normalizedModelId) fail('TRAINING_REFRESH_MODEL_REQUIRED', 'Wybierz model do przygotowania kluczy.');
      const snapshot = await repository.getSnapshot();
      const resumable = snapshot.refreshJobs.find(isTrainingRefreshJobResumable);
      if (resumable) {
        fail(
          'TRAINING_REFRESH_RESUME_REQUIRED',
          'Najpierw wznowić i dokończyć poprzednie zadanie AI, zanim uruchomisz nowe.',
          { resumableJob: clone(resumable) },
        );
      }
      const estimate = estimateTrainingRefresh(snapshot, { batchSize, sampleSize });
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
        readyKeyCount: 0,
        reviewKeyCount: 0,
        invalidKeyCount: 0,
        unknownResultCount: 0,
        stopRequested: false,
        inFlight: null,
        errors: [],
        createdAt,
        startedAt: estimate.candidateCount > 0 ? createdAt : null,
        stoppedAt: null,
        finishedAt: estimate.candidateCount === 0 ? createdAt : null,
      };
      const saved = await saveNewJob(job);
      if (saved.status === 'running') launch(saved.id);
      return saved;
    },
    stopRefresh: async (jobId) => {
      const { job } = await getStoredJob(jobId);
      if (TERMINAL_STATUSES.has(job.status)) return clone(job);
      const isRunningHere = activeRuns.has(jobId);
      if (isRunningHere) stopRequested.add(jobId);
      return saveJob({
        ...job,
        status: isRunningHere ? 'stop_requested' : 'stopped',
        stopRequested: isRunningHere,
        stoppedAt: isRunningHere ? job.stoppedAt : asIso(clock),
      });
    },
    resumeRefresh: async (jobId) => {
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
          message: 'Partia przerwana przez restart nie została ponowiona automatycznie.',
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
    getJob: async (jobId) => clone((await getStoredJob(jobId)).job),
    waitForIdle: async (jobId) => {
      const active = activeRuns.get(jobId);
      if (active) await active;
      return clone((await getStoredJob(jobId)).job);
    },
  };
};
