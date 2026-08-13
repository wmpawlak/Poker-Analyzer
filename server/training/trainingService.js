import { randomUUID } from 'node:crypto';
import {
  EXERCISE_TYPES,
  TRAINING_GAME_TYPES,
  TRAINING_GRADES,
  isExerciseType,
  isTrainingGameType,
  isTrainingSessionSize,
} from '../../src/training/trainingTypes.js';
import {
  estimateTrainingRefresh,
  isTrainingRefreshJobResumable,
} from './refreshService.js';
import {
  CARD_FACTS_VALIDATION_VERSION,
  TRAINING_ANSWER_KEY_CONTRACT_VERSION,
} from './answerKeyContract.js';
import { sameDecisionCardFacts } from './decisionCardFacts.js';
import { orderTrainingSessionSpots } from './spotSelection.js';

const ELIGIBLE_KEY = (key, spot) => key?.status === 'ready'
  && key?.confidence === 'high'
  && key?.localFactsValid === true
  && key?.contractVersion === TRAINING_ANSWER_KEY_CONTRACT_VERSION
  && key?.factsValidationVersion === CARD_FACTS_VALIDATION_VERSION
  && sameDecisionCardFacts(key?.decisionCardFacts, spot?.decisionCardFacts);

export class TrainingServiceError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'TrainingServiceError';
    this.code = code;
    this.status = status;
  }
}

const fail = (code, message, status) => {
  throw new TrainingServiceError(code, message, status);
};

const asString = (value) => String(value ?? '').trim();
const clone = (value) => JSON.parse(JSON.stringify(value));
const byNewest = (left, right) => (
  (Date.parse(right.answeredAt || right.createdAt || '') || 0)
  - (Date.parse(left.answeredAt || left.createdAt || '') || 0)
);

const getCurrentKey = (collection, spot) => {
  const key = collection.answerKeys.find(({ id }) => id === spot?.currentAnswerKeyId);
  return ELIGIBLE_KEY(key, spot) ? key : null;
};

const isUsableSessionSpot = (collection, spot) => Boolean(
  spot?.sourceStatus === 'current' && spot?.readiness === 'ready' && getCurrentKey(collection, spot),
);

const normalizeSize = (value) => {
  const normalized = value === 'all' ? 'all' : Number(value ?? 20);
  if (!isTrainingSessionSize(normalized)) {
    fail('TRAINING_SESSION_SIZE_INVALID', 'Rozmiar sesji musi wynosić 10, 20, 50, 100 albo all.');
  }
  return normalized;
};

const toPublicSession = (session) => ({
  id: session.id,
  exerciseType: session.exerciseType,
  gameType: session.gameType,
  requestedSize: session.requestedSize,
  targetSize: session.targetSize,
  status: session.status,
  answeredCount: session.answeredCount ?? session.answeredSpotVersionIds?.length ?? 0,
  currentSpotVersionId: session.currentSpotVersionId || null,
  score: clone(session.score || { correct: 0, acceptable: 0, incorrect: 0 }),
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  completedAt: session.completedAt || null,
  abandonedAt: session.abandonedAt || null,
});

const toPublicQuestion = (spot) => ({
  spotVersionId: spot.versionId,
  exerciseType: spot.exerciseType,
  gameType: spot.gameType,
  street: spot.street,
  stage: spot.stage || null,
  scenario: spot.scenario || null,
  episodeId: spot.episodeId || null,
  sequenceIndex: spot.sequenceIndex || null,
  sequenceLength: spot.sequenceLength || null,
  usesHistoricalLine: Boolean(spot.usesHistoricalLine),
  continuationNotice: spot.continuationNotice || null,
  decisionCardFacts: clone(spot.decisionCardFacts || null),
  question: clone(spot.question),
  answerOptions: clone(spot.answerOptions),
});

const toPublicAnswerKey = (key) => ({
  id: key.id,
  spotVersionId: key.spotVersionId,
  preferredAnswer: key.preferredAnswer,
  decisionCardFacts: clone(key.decisionCardFacts || null),
  factsValidationVersion: key.factsValidationVersion || null,
  acceptableAlternatives: clone(key.acceptableAlternatives || []),
  confidence: key.confidence,
  rationale: key.rationale,
  blockersEquity: key.blockersEquity,
  opponentRange: key.opponentRange,
  suggestedSizing: key.suggestedSizing ? clone(key.suggestedSizing) : null,
  contractVersion: key.contractVersion,
  model: key.model ? clone(key.model) : null,
  createdAt: key.createdAt,
});

const getHistoricalAnswerId = (spot) => {
  const historicalAction = spot?.historicalAnswer || {};
  if (spot?.exerciseType === EXERCISE_TYPES.CBET_BARRELS
    && spot.answerOptions?.some(({ id }) => id === historicalAction.sizing)) {
    return historicalAction.sizing;
  }
  const matches = (spot?.answerOptions || []).filter(({ id, action }) => (
    id === historicalAction.type || action === historicalAction.type
  ));
  return matches.length === 1 ? matches[0].id : null;
};

const getHistoricalDecision = (spot, key) => {
  const answer = getHistoricalAnswerId(spot);
  if (!answer) return null;
  const grade = answer === key.preferredAnswer
    ? TRAINING_GRADES.CORRECT
    : key.acceptableAlternatives?.includes(answer)
      ? TRAINING_GRADES.ACCEPTABLE
      : TRAINING_GRADES.INCORRECT;
  const comment = grade === TRAINING_GRADES.CORRECT
    ? 'Faktyczna decyzja odpowiadała zalecanej linii.'
    : grade === TRAINING_GRADES.ACCEPTABLE
      ? 'Faktyczna decyzja była jedną z dopuszczalnych linii.'
      : 'Faktyczna decyzja odbiegała od zalecanej linii.';
  return { grade, answer, comment };
};

const buildAnswerFeedback = async ({ attempt, spot, key, getHandAnalysisSummary }) => {
  let historicalSummary = null;
  try {
    historicalSummary = asString(await getHandAnalysisSummary(spot.handId)) || null;
  } catch {
    // Brak cache analizy nie moĹĽe blokowaÄ‡ podglÄ…du zapisanej odpowiedzi.
  }
  return {
    grade: attempt.grade,
    answerKey: toPublicAnswerKey(key),
    historicalAction: clone(spot.historicalAnswer),
    historicalResult: spot.historicalResult ? clone(spot.historicalResult) : null,
    historicalDecision: getHistoricalDecision(spot, key),
    historicalSummary,
  };
};

const toPublicRefreshJob = (job) => job ? ({
  id: job.id,
  status: job.status,
  modelId: job.modelId,
  contractVersion: job.contractVersion,
  batchSize: job.batchSize,
  sampleSize: job.sampleSize || null,
  candidateCount: job.candidateCount,
  estimatedRequests: job.estimatedRequests,
  attemptedRequests: job.attemptedRequests,
  successfulRequests: job.successfulRequests,
  processedSpotCount: job.processedSpotCount,
  savedKeyCount: job.savedKeyCount,
  readyKeyCount: job.readyKeyCount,
  reviewKeyCount: job.reviewKeyCount,
  invalidKeyCount: job.invalidKeyCount,
  progress: job.candidateCount > 0 ? Math.min(1, job.cursor / job.candidateCount) : 1,
  errors: clone(job.errors || []),
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  stoppedAt: job.stoppedAt || null,
  finishedAt: job.finishedAt || null,
}) : null;

const validateFilters = (filters = {}, { allowBoth = true } = {}) => {
  const exerciseType = asString(filters.exerciseType);
  const gameType = asString(filters.gameType);
  if (exerciseType && !isExerciseType(exerciseType)) {
    fail('TRAINING_EXERCISE_TYPE_INVALID', 'Nieznany typ ćwiczenia.');
  }
  if (gameType && !isTrainingGameType(gameType, { allowBoth })) {
    fail('TRAINING_GAME_TYPE_INVALID', 'Nieznany format gry.');
  }
  return { exerciseType: exerciseType || null, gameType: gameType || null };
};

const sessionMatches = (session, filters) => (
  (!filters.exerciseType || session.exerciseType === filters.exerciseType)
  && (!filters.gameType || filters.gameType === 'both' || session.gameType === 'both' || session.gameType === filters.gameType)
);

const spotMatches = (spot, filters) => (
  (!filters.exerciseType || spot.exerciseType === filters.exerciseType)
  && (!filters.gameType || filters.gameType === 'both' || spot.gameType === filters.gameType)
);

const keepCompleteCbetEpisodes = (spots, exerciseType) => {
  if (exerciseType !== EXERCISE_TYPES.CBET_BARRELS) return spots;
  const stagesByEpisode = new Map();
  spots.forEach((spot) => {
    const stages = stagesByEpisode.get(spot.episodeId) || new Set();
    stages.add(spot.stage);
    stagesByEpisode.set(spot.episodeId, stages);
  });
  return spots.filter((spot) => spot.sequenceLength <= 1
    || (stagesByEpisode.get(spot.episodeId)?.has('flop')
      && stagesByEpisode.get(spot.episodeId)?.has('turn')));
};

const pickWeightedSpot = (spots, attempts, random) => {
  const spotVersionIds = new Set(spots.map(({ versionId }) => versionId));
  const latestAttempt = [...attempts].sort(byNewest)[0];
  const repeatSafeSpots = spots.length > 1 && spotVersionIds.has(latestAttempt?.spotVersionId)
    ? spots.filter(({ versionId }) => versionId !== latestAttempt.spotVersionId)
    : spots;
  const attemptsBySpot = new Map();
  [...attempts].sort(byNewest).forEach((attempt) => {
    if (!attemptsBySpot.has(attempt.spotVersionId)) attemptsBySpot.set(attempt.spotVersionId, attempt);
  });
  const unseen = repeatSafeSpots.filter((spot) => !attemptsBySpot.has(spot.versionId));
  const pool = unseen.length > 0 ? unseen.map((spot) => ({ spot, weight: 1 })) : repeatSafeSpots.map((spot) => {
    const grade = attemptsBySpot.get(spot.versionId)?.grade;
    return { spot, weight: grade === TRAINING_GRADES.INCORRECT ? 4 : grade === TRAINING_GRADES.ACCEPTABLE ? 2 : 1 };
  });
  const total = pool.reduce((sum, item) => sum + item.weight, 0);
  let target = Math.min(0.999999999, Math.max(0, Number(random()) || 0)) * total;
  for (const item of pool) {
    target -= item.weight;
    if (target < 0) return item.spot;
  }
  return pool.at(-1)?.spot || null;
};

const latestJob = (jobs) => [...(jobs || [])]
  .sort((left, right) => (Date.parse(right.createdAt || '') || 0) - (Date.parse(left.createdAt || '') || 0))[0];

const emptyPoolSummary = () => ({
  matching: 0, selected: 0, current: 0, active: 0, ready: 0, pending: 0, review: 0, locallyRejected: 0,
});

const buildStatus = (collection, sampleSize) => {
  const pools = Object.fromEntries(Object.values(EXERCISE_TYPES).map((exerciseType) => [
    exerciseType,
    { cash: emptyPoolSummary(), tournament: emptyPoolSummary() },
  ]));
  const selectedIds = new Set(collection.selectionState?.selectedSpotVersionIds || []);
  Object.entries(collection.selectionState?.poolStats || {}).forEach(([key, stats]) => {
    const [exerciseType, gameType] = key.split(':');
    const pool = pools[exerciseType]?.[gameType];
    if (!pool) return;
    pool.matching = Number(stats.matching) || 0;
    pool.locallyRejected = Number(stats.locallyRejected) || 0;
  });
  collection.spots.forEach((spot) => {
    const pool = pools[spot.exerciseType]?.[spot.gameType];
    if (!pool || spot.sourceStatus !== 'current') return;
    pool.current += 1;
    if (!pool.matching) pool.matching += 1;
    if (selectedIds.has(spot.versionId)) pool.selected += 1;
    if (spot.active) pool.active += 1;
    if (selectedIds.has(spot.versionId) && spot.readiness === 'ready') pool.ready += 1;
    if (selectedIds.has(spot.versionId) && spot.readiness === 'pending_key') pool.pending += 1;
    if (selectedIds.has(spot.versionId) && spot.readiness === 'review') pool.review += 1;
  });
  const estimate = estimateTrainingRefresh(collection, { sampleSize });
  const refresh = latestJob(collection.refreshJobs);
  const resumableRefresh = latestJob(
    collection.refreshJobs.filter(isTrainingRefreshJobResumable),
  );
  return {
    version: collection.version,
    revision: collection.revision,
    updatedAt: collection.updatedAt,
    scanState: {
      lastScannedAt: collection.scanState.lastScannedAt,
      datasetRevision: collection.scanState.datasetRevision,
      lastResult: collection.scanState.lastResult ? clone(collection.scanState.lastResult) : null,
      sourceCount: Object.keys(collection.scanState.sources || {}).length,
      sourceHistoryCount: collection.scanState.sourceHistory?.length || 0,
    },
    selectionState: {
      strategy: collection.selectionState?.strategy || null,
      strategyVersion: collection.selectionState?.strategyVersion || null,
      selectedAt: collection.selectionState?.selectedAt || null,
      limit: collection.selectionState?.limit || 100,
      selectedSpotCount: selectedIds.size,
    },
    pools,
    queue: {
      pending: estimate.candidateCount,
      reanalysis: collection.spots.filter((spot) => (
        spot.sourceStatus === 'current' && spot.readiness === 'review'
      )).length,
      rejectedHands: Object.values(collection.scanState.sources || {}).filter(({ status }) => status === 'rejected').length,
      locallyRejected: Object.values(pools).reduce((sum, formats) => (
        sum + formats.cash.locallyRejected + formats.tournament.locallyRejected
      ), 0),
    },
    refreshEstimate: {
      candidateCount: estimate.candidateCount,
      estimatedRequests: estimate.estimatedRequests,
      batchSize: estimate.batchSize,
      sampleSize: estimate.sampleSize,
      groups: estimate.groups,
      locallyRejectedCount: estimate.locallyRejectedCount,
    },
    refreshJob: toPublicRefreshJob(refresh),
    resumableRefreshJob: toPublicRefreshJob(resumableRefresh),
    lastUsedModel: refresh?.modelId || null,
    sessionCount: collection.sessions.length,
    activeSessionCount: collection.sessions.filter(({ status }) => status === 'active').length,
    attemptCount: collection.attempts.length,
    counts: {
      spots: collection.spots.length,
      answerKeys: collection.answerKeys.length,
      refreshJobs: collection.refreshJobs.length,
      sessions: collection.sessions.length,
      attempts: collection.attempts.length,
    },
    spotCount: collection.spots.length,
    answerKeyCount: collection.answerKeys.length,
    refreshJobCount: collection.refreshJobs.length,
  };
};

const buildStatusFromDatabase = (data, sampleSize) => {
  const pools = Object.fromEntries(Object.values(EXERCISE_TYPES).map((exerciseType) => [
    exerciseType,
    { cash: emptyPoolSummary(), tournament: emptyPoolSummary() },
  ]));
  data.poolRows.forEach((row) => {
    const pool = pools[row.exercise_type]?.[row.game_type];
    if (!pool) return;
    pool.matching = Number(row.current_count) || 0;
    pool.current = Number(row.current_count) || 0;
    pool.active = Number(row.active_count) || 0;
    pool.selected = Number(row.selected_count) || 0;
    pool.ready = Number(row.ready_count) || 0;
    pool.pending = Number(row.pending_count) || 0;
    pool.review = Number(row.review_count) || 0;
    pool.locallyRejected = Number(row.locally_rejected_count) || 0;
  });
  const estimate = estimateTrainingRefresh(
    { spots: data.estimateData.spots, auditState: { excludedHands: [] } },
    { sampleSize },
  );
  estimate.locallyRejectedSpotVersionIds = data.estimateData.locallyRejectedSpotVersionIds;
  estimate.locallyRejectedCount = data.estimateData.locallyRejectedSpotVersionIds.length;
  const refresh = latestJob(data.refreshJobs);
  const resumableRefresh = latestJob(data.refreshJobs.filter(isTrainingRefreshJobResumable));
  const metadata = data.metadata;
  return {
    version: metadata.collection_version,
    revision: metadata.revision,
    updatedAt: metadata.updated_at,
    scanState: {
      lastScannedAt: metadata.scan_last_scanned_at,
      datasetRevision: metadata.scan_dataset_revision,
      lastResult: metadata.scan_last_result_json ? JSON.parse(metadata.scan_last_result_json) : null,
      sourceCount: data.sourceCount,
      sourceHistoryCount: data.sourceHistoryCount,
    },
    selectionState: {
      strategy: metadata.selection_strategy || null,
      strategyVersion: metadata.selection_strategy_version || null,
      selectedAt: metadata.selected_at || null,
      limit: metadata.selection_limit || 100,
      selectedSpotCount: data.selectedCount,
    },
    pools,
    queue: {
      pending: estimate.candidateCount,
      reanalysis: data.reanalysisCount,
      rejectedHands: data.rejectedSourceCount,
      locallyRejected: data.poolRows.reduce((sum, row) => sum + (Number(row.locally_rejected_count) || 0), 0),
    },
    refreshEstimate: {
      candidateCount: estimate.candidateCount,
      estimatedRequests: estimate.estimatedRequests,
      batchSize: estimate.batchSize,
      sampleSize: estimate.sampleSize,
      groups: estimate.groups,
      locallyRejectedCount: estimate.locallyRejectedCount,
    },
    refreshJob: toPublicRefreshJob(refresh),
    resumableRefreshJob: toPublicRefreshJob(resumableRefresh),
    lastUsedModel: refresh?.modelId || null,
    sessionCount: data.sessionCount,
    activeSessionCount: data.activeSessionCount,
    attemptCount: data.counts.attempts,
    counts: data.counts,
    spotCount: data.counts.spots,
    answerKeyCount: data.counts.answerKeys,
    refreshJobCount: data.counts.refreshJobs,
  };
};

const createAccumulator = () => ({ total: 0, correct: 0, acceptable: 0, incorrect: 0 });
const addGrade = (accumulator, grade) => {
  accumulator.total += 1;
  if (grade in accumulator) accumulator[grade] += 1;
};
const finishAccumulator = (value) => ({
  ...value,
  preferredRate: value.total ? Number((value.correct / value.total).toFixed(4)) : 0,
  acceptedRate: value.total ? Number(((value.correct + value.acceptable) / value.total).toFixed(4)) : 0,
});
const addGrouped = (groups, name, grade) => {
  const key = asString(name) || 'unknown';
  const accumulator = groups.get(key) || createAccumulator();
  addGrade(accumulator, grade);
  groups.set(key, accumulator);
};
const finishGroups = (groups) => Object.fromEntries(
  [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => [key, finishAccumulator(value)]),
);
const getStackBucket = (value) => {
  const stack = Number(value);
  if (!Number.isFinite(stack)) return 'unknown';
  if (stack <= 20) return '0-20bb';
  if (stack <= 40) return '21-40bb';
  if (stack <= 100) return '41-100bb';
  return '100bb+';
};

export const createTrainingService = ({
  repository,
  random = Math.random,
  idFactory = (prefix) => `${prefix}-${randomUUID()}`,
  isRefreshRunning = () => false,
  getHandAnalysisSummary = async () => null,
} = {}) => {
  if (!repository?.getSnapshot || !repository?.transact) {
    fail('TRAINING_REPOSITORY_REQUIRED', 'Serwis treningowy wymaga repozytorium.');
  }
  if (typeof getHandAnalysisSummary !== 'function') {
    fail('TRAINING_HAND_ANALYSIS_SUMMARY_INVALID', 'Podsumowanie analizy rozdania musi być funkcją.');
  }

  return {
    getStatus: async ({ sampleSize } = {}) => {
      if (repository.getTrainingStatusData) {
        return buildStatusFromDatabase(
          await repository.getTrainingStatusData(sampleSize),
          sampleSize,
        );
      }
      return buildStatus(await repository.getSnapshot(), sampleSize);
    },

    createOrResumeSession: async (input = {}) => {
      const requestedId = asString(input.resumeSessionId);
      if (requestedId) {
        const context = repository.getTrainingSessionContext
          ? await repository.getTrainingSessionContext(requestedId)
          : null;
        if (context) {
          if (context.session.status === 'abandoned') {
            fail('TRAINING_SESSION_ABANDONED', 'Ta sesja została przerwana i nie można jej wznowić.', 409);
          }
          return { resumed: true, session: toPublicSession(context.session) };
        }
        const resumed = await repository.transact((collection) => {
          const session = collection.sessions.find(({ id }) => id === requestedId);
          if (!session) fail('TRAINING_SESSION_NOT_FOUND', 'Nie znaleziono sesji do wznowienia.', 404);
          if (session.status === 'abandoned') {
            fail('TRAINING_SESSION_ABANDONED', 'Ta sesja została przerwana i nie można jej wznowić.', 409);
          }
          return { resumed: true, session: toPublicSession(session) };
        });
        return resumed.result;
      }
      const filters = validateFilters({
        exerciseType: input.exerciseType,
        gameType: input.gameType || TRAINING_GAME_TYPES.BOTH,
      });
      if (!filters.exerciseType) fail('TRAINING_EXERCISE_TYPE_REQUIRED', 'Wybierz typ ćwiczenia.');
      const requestedSize = normalizeSize(input.size);
      if (input.resume === true && repository.getActiveTrainingSessions) {
        const resumed = (await repository.getActiveTrainingSessions(filters))[0];
        if (resumed) return { resumed: true, session: toPublicSession(resumed) };
      }
      const spots = keepCompleteCbetEpisodes(
        repository.getActiveSpots
          ? await repository.getActiveSpots(filters)
          : (await repository.getSnapshot()).spots.filter((spot) => spot.active && spotMatches(spot, filters)),
        filters.exerciseType,
      );
      if (spots.length === 0) fail('TRAINING_NO_ACTIVE_SPOTS', 'Brak gotowych spotów dla wybranych filtrów.', 409);
      const attempts = repository.getTrainingAttemptsForSpots
        ? await repository.getTrainingAttemptsForSpots(spots.map(({ versionId }) => versionId))
        : (await repository.getSnapshot()).attempts;
      const orderedSpots = orderTrainingSessionSpots(spots, attempts, {
        limit: requestedSize === 'all' ? Number.POSITIVE_INFINITY : requestedSize,
        random,
      });
      if (orderedSpots.length === 0) {
        fail('TRAINING_NO_COMPLETE_SPOTS', 'Brak kompletnego spotu lub epizodu w wybranym limicie.', 409);
      }
      const timestamp = new Date().toISOString();
      const targetSize = orderedSpots.length;
      const session = {
        id: idFactory('training-session'),
        exerciseType: filters.exerciseType,
        gameType: filters.gameType || TRAINING_GAME_TYPES.BOTH,
        requestedSize,
        targetSize,
        status: 'active',
        availableSpotVersionIds: orderedSpots.map(({ versionId }) => versionId),
        answeredSpotVersionIds: [],
        currentSpotVersionId: null,
        lastSpotVersionId: null,
        score: { correct: 0, acceptable: 0, incorrect: 0 },
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: null,
      };
      if (repository.saveTrainingSession) await repository.saveTrainingSession(session);
      else await repository.saveSession(session);
      return { resumed: false, session: toPublicSession(session) };
    },

    getSession: async (sessionId) => {
      if (repository.getTrainingSessionContext) {
        const context = await repository.getTrainingSessionContext(asString(sessionId));
        if (!context) fail('TRAINING_SESSION_NOT_FOUND', 'Nie znaleziono sesji.', 404);
        return toPublicSession(context.session);
      }
      const collection = await repository.getSnapshot();
      const session = collection.sessions.find(({ id }) => id === asString(sessionId));
      if (!session) fail('TRAINING_SESSION_NOT_FOUND', 'Nie znaleziono sesji.', 404);
      return toPublicSession(session);
    },

    abandonSession: async (sessionId) => {
      if (repository.getTrainingSessionContext) {
        const context = await repository.getTrainingSessionContext(asString(sessionId));
        if (!context) fail('TRAINING_SESSION_NOT_FOUND', 'Nie znaleziono sesji.', 404);
        const { session } = context;
        if (session.status === 'abandoned') {
          fail('TRAINING_SESSION_ABANDONED', 'Ta sesja została już przerwana.', 409);
        }
        if (session.status !== 'active') {
          fail('TRAINING_SESSION_COMPLETED', 'Zakończonej sesji nie można przerwać.', 409);
        }
        const timestamp = new Date().toISOString();
        session.status = 'abandoned';
        session.abandonedAt = timestamp;
        session.abandonReason = 'user_requested';
        session.currentSpotVersionId = null;
        session.updatedAt = timestamp;
        await repository.saveTrainingSession(session);
        return { session: toPublicSession(session) };
      }
      const result = await repository.transact((collection, timestamp) => {
        const session = collection.sessions.find(({ id }) => id === asString(sessionId));
        if (!session) fail('TRAINING_SESSION_NOT_FOUND', 'Nie znaleziono sesji.', 404);
        if (session.status === 'abandoned') {
          fail('TRAINING_SESSION_ABANDONED', 'Ta sesja została już przerwana.', 409);
        }
        if (session.status !== 'active') {
          fail('TRAINING_SESSION_COMPLETED', 'Zakończonej sesji nie można przerwać.', 409);
        }
        session.status = 'abandoned';
        session.abandonedAt = timestamp;
        session.abandonReason = 'user_requested';
        session.currentSpotVersionId = null;
        session.updatedAt = timestamp;
        return { session: toPublicSession(session) };
      });
      return result.result;
    },

    getNextQuestion: async (sessionId) => {
      if (repository.getTrainingQuestionContext) {
        const context = await repository.getTrainingQuestionContext(asString(sessionId));
        if (!context) fail('TRAINING_SESSION_NOT_FOUND', 'Nie znaleziono sesji.', 404);
        if (context.session.status === 'abandoned') {
          fail('TRAINING_SESSION_ABANDONED', 'Ta sesja zostaĹ‚a przerwana i nie moĹĽna pobraÄ‡ kolejnego pytania.', 409);
        }
        if (!context.spot || context.session.status === 'completed') {
          return { session: toPublicSession(context.session), question: null };
        }
        return {
          session: toPublicSession(context.session),
          question: toPublicQuestion(context.spot),
        };
      }
      if (repository.getTrainingSessionContext) {
        const context = await repository.getTrainingSessionContext(asString(sessionId));
        if (!context) fail('TRAINING_SESSION_NOT_FOUND', 'Nie znaleziono sesji.', 404);
        const collection = context;
        const { session } = collection;
        if (session.status === 'abandoned') {
          fail('TRAINING_SESSION_ABANDONED', 'Ta sesja została przerwana i nie można pobrać kolejnego pytania.', 409);
        }
        if (session.status === 'completed') return { session: toPublicSession(session), question: null };
        let spot = collection.spots.find(({ versionId }) => versionId === session.currentSpotVersionId);
        const timestamp = new Date().toISOString();
        if (spot && isUsableSessionSpot(collection, spot)) {
          session.updatedAt = timestamp;
          await repository.saveTrainingSession(session);
          return { session: toPublicSession(session), question: toPublicQuestion(spot) };
        }
        session.currentSpotVersionId = null;
        const answered = new Set(session.answeredSpotVersionIds || []);
        const available = new Set(session.availableSpotVersionIds || []);
        const candidates = collection.spots.filter((candidate) => available.has(candidate.versionId)
          && !answered.has(candidate.versionId)
          && isUsableSessionSpot(collection, candidate));
        if (answered.size >= session.targetSize || candidates.length === 0) {
          session.status = 'completed';
          session.completedAt = timestamp;
          session.updatedAt = timestamp;
          await repository.saveTrainingSession(session);
          return { session: toPublicSession(session), question: null };
        }
        const previousSpot = collection.spots.find(({ versionId }) => versionId === session.lastSpotVersionId);
        const continuation = previousSpot?.exerciseType === EXERCISE_TYPES.CBET_BARRELS
          && previousSpot.stage === 'flop'
          ? candidates.find((candidate) => candidate.stage === 'turn'
            && candidate.episodeId === previousSpot.episodeId)
          : null;
        const selectable = session.exerciseType === EXERCISE_TYPES.CBET_BARRELS
          ? candidates.filter(({ stage }) => stage !== 'turn')
          : candidates;
        const attempts = repository.getTrainingAttemptsForSpots
          ? await repository.getTrainingAttemptsForSpots(session.availableSpotVersionIds)
          : collection.attempts;
        spot = continuation || pickWeightedSpot(selectable, attempts, random);
        if (!spot) {
          session.status = 'completed';
          session.completedAt = timestamp;
          session.updatedAt = timestamp;
          await repository.saveTrainingSession(session);
          return { session: toPublicSession(session), question: null };
        }
        session.currentSpotVersionId = spot.versionId;
        session.updatedAt = timestamp;
        await repository.saveTrainingSession(session);
        return { session: toPublicSession(session), question: toPublicQuestion(spot) };
      }
      const result = await repository.transact((collection, timestamp) => {
        const session = collection.sessions.find(({ id }) => id === asString(sessionId));
        if (!session) fail('TRAINING_SESSION_NOT_FOUND', 'Nie znaleziono sesji.', 404);
        if (session.status === 'abandoned') {
          fail('TRAINING_SESSION_ABANDONED', 'Ta sesja została przerwana i nie można pobrać kolejnego pytania.', 409);
        }
        if (session.status === 'completed') return { session: toPublicSession(session), question: null };
        let spot = collection.spots.find(({ versionId }) => versionId === session.currentSpotVersionId);
        if (spot && isUsableSessionSpot(collection, spot)) {
          session.updatedAt = timestamp;
          return { session: toPublicSession(session), question: toPublicQuestion(spot) };
        }
        session.currentSpotVersionId = null;
        const answered = new Set(session.answeredSpotVersionIds || []);
        const available = new Set(session.availableSpotVersionIds || []);
        const candidates = collection.spots.filter((candidate) => available.has(candidate.versionId)
          && !answered.has(candidate.versionId)
          && isUsableSessionSpot(collection, candidate));
        if (answered.size >= session.targetSize || candidates.length === 0) {
          session.status = 'completed';
          session.completedAt = timestamp;
          session.updatedAt = timestamp;
          return { session: toPublicSession(session), question: null };
        }
        const previousSpot = collection.spots.find(({ versionId }) => versionId === session.lastSpotVersionId);
        const continuation = previousSpot?.exerciseType === EXERCISE_TYPES.CBET_BARRELS
          && previousSpot.stage === 'flop'
          ? candidates.find((candidate) => candidate.stage === 'turn'
            && candidate.episodeId === previousSpot.episodeId)
          : null;
        const selectable = session.exerciseType === EXERCISE_TYPES.CBET_BARRELS
          ? candidates.filter(({ stage }) => stage !== 'turn')
          : candidates;
        spot = continuation || pickWeightedSpot(selectable, collection.attempts, random);
        if (!spot) {
          session.status = 'completed';
          session.completedAt = timestamp;
          session.updatedAt = timestamp;
          return { session: toPublicSession(session), question: null };
        }
        session.currentSpotVersionId = spot.versionId;
        session.updatedAt = timestamp;
        return { session: toPublicSession(session), question: toPublicQuestion(spot) };
      });
      return result.result;
    },

    submitAnswer: async (sessionId, payload = {}) => {
      if (repository.getTrainingAnswerContext && repository.saveTrainingAttemptAndAdvance) {
        const spotVersionId = asString(payload.spotVersionId);
        const context = await repository.getTrainingAnswerContext(asString(sessionId), spotVersionId);
        if (!context) fail('TRAINING_SESSION_NOT_FOUND', 'Nie znaleziono sesji.', 404);
        const { session } = context;
        if (session.status === 'abandoned') {
          fail('TRAINING_SESSION_ABANDONED', 'Ta sesja zostaĹ‚a przerwana i nie moĹĽna zapisaÄ‡ odpowiedzi.', 409);
        }
        if (session.status !== 'active') fail('TRAINING_SESSION_COMPLETED', 'Ta sesja jest juĹĽ zakoĹ„czona.', 409);
        if (!spotVersionId || session.currentSpotVersionId !== spotVersionId) {
          fail('TRAINING_QUESTION_MISMATCH', 'OdpowiedĹş nie dotyczy aktualnego pytania.', 409);
        }
        if (context.relation?.status === 'answered') {
          fail('TRAINING_ANSWER_ALREADY_SAVED', 'OdpowiedĹş na to pytanie zostaĹ‚a juĹĽ zapisana.', 409);
        }
        if (context.relation?.status !== 'current') {
          fail('TRAINING_QUESTION_MISMATCH', 'OdpowiedĹş nie dotyczy aktualnego pytania.', 409);
        }
        const spot = context.spot;
        const key = context.key;
        if (!spot || !key || !ELIGIBLE_KEY(key, spot) || !isUsableSessionSpot({ answerKeys: [key] }, spot)) {
          fail('TRAINING_SPOT_UNAVAILABLE', 'Spot nie jest juĹĽ dostÄ™pny w aktualnym datasecie.', 409);
        }
        const answer = asString(payload.answer);
        if (!spot.answerOptions.some(({ id }) => id === answer)) {
          fail('TRAINING_ANSWER_INVALID', 'Wybrana odpowiedĹş nie jest legalna dla tego spotu.');
        }
        const grade = answer === key.preferredAnswer
          ? TRAINING_GRADES.CORRECT
          : key.acceptableAlternatives?.includes(answer)
            ? TRAINING_GRADES.ACCEPTABLE
            : TRAINING_GRADES.INCORRECT;
        const timestamp = new Date().toISOString();
        const attempt = {
          id: idFactory('training-attempt'), sessionId: session.id, spotVersionId, answer, grade,
          answerKeyId: key.id, answeredAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
        };
        const score = { correct: 0, acceptable: 0, incorrect: 0, ...(session.score || {}) };
        score[grade] += 1;
        const answeredCount = (session.answeredCount || 0) + 1;
        const sessionPatch = {
          ...session,
          answeredCount,
          currentSpotVersionId: null,
          lastSpotVersionId: spotVersionId,
          score,
          status: answeredCount >= session.targetSize ? 'completed' : 'active',
          completedAt: answeredCount >= session.targetSize ? timestamp : null,
          updatedAt: timestamp,
        };
        const feedback = await buildAnswerFeedback({ attempt, spot, key, getHandAnalysisSummary });
        const saved = await repository.saveTrainingAttemptAndAdvance(attempt, sessionPatch);
        if (saved?.duplicate) {
          fail('TRAINING_ANSWER_ALREADY_SAVED', 'OdpowiedĹş na to pytanie zostaĹ‚a juĹĽ zapisana.', 409);
        }
        if (saved?.mismatch) {
          fail('TRAINING_QUESTION_MISMATCH', 'OdpowiedĹş nie dotyczy aktualnego pytania.', 409);
        }
        return {
          attempt: clone(saved?.attempt || attempt),
          session: toPublicSession(saved?.session || sessionPatch),
          feedback,
        };
      }
      if (repository.getTrainingSessionContext) {
        const context = await repository.getTrainingSessionContext(asString(sessionId));
        if (!context) fail('TRAINING_SESSION_NOT_FOUND', 'Nie znaleziono sesji.', 404);
        const { session } = context;
        if (session.status === 'abandoned') {
          fail('TRAINING_SESSION_ABANDONED', 'Ta sesja została przerwana i nie można zapisać odpowiedzi.', 409);
        }
        if (session.status !== 'active') fail('TRAINING_SESSION_COMPLETED', 'Ta sesja jest już zakończona.', 409);
        const spotVersionId = asString(payload.spotVersionId);
        if (!spotVersionId || session.currentSpotVersionId !== spotVersionId) {
          fail('TRAINING_QUESTION_MISMATCH', 'Odpowiedź nie dotyczy aktualnego pytania.', 409);
        }
        if ((session.answeredSpotVersionIds || []).includes(spotVersionId)
          || context.attempts.some((attempt) => attempt.spotVersionId === spotVersionId)) {
          fail('TRAINING_ANSWER_ALREADY_SAVED', 'Odpowiedź na to pytanie została już zapisana.', 409);
        }
        const spot = context.spots.find(({ versionId }) => versionId === spotVersionId);
        if (!spot || !isUsableSessionSpot(context, spot)) {
          fail('TRAINING_SPOT_UNAVAILABLE', 'Spot nie jest już dostępny w aktualnym datasecie.', 409);
        }
        const answer = asString(payload.answer);
        if (!spot.answerOptions.some(({ id }) => id === answer)) {
          fail('TRAINING_ANSWER_INVALID', 'Wybrana odpowiedź nie jest legalna dla tego spotu.');
        }
        const key = getCurrentKey(context, spot);
        const grade = answer === key.preferredAnswer
          ? TRAINING_GRADES.CORRECT
          : key.acceptableAlternatives?.includes(answer)
            ? TRAINING_GRADES.ACCEPTABLE
            : TRAINING_GRADES.INCORRECT;
        const timestamp = new Date().toISOString();
        const attempt = {
          id: idFactory('training-attempt'), sessionId: session.id, spotVersionId, answer, grade,
          answerKeyId: key.id, answeredAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
        };
        session.answeredSpotVersionIds = [...(session.answeredSpotVersionIds || []), spotVersionId];
        session.currentSpotVersionId = null;
        session.lastSpotVersionId = spotVersionId;
        session.score = { correct: 0, acceptable: 0, incorrect: 0, ...(session.score || {}) };
        session.score[grade] += 1;
        session.updatedAt = timestamp;
        if (session.answeredSpotVersionIds.length >= session.targetSize) {
          session.status = 'completed';
          session.completedAt = timestamp;
        }
        const feedback = await buildAnswerFeedback({ attempt, spot, key, getHandAnalysisSummary });
        if (repository.saveTrainingAttemptAndSession) {
          const saved = await repository.saveTrainingAttemptAndSession(attempt, session);
          if (saved?.duplicate) {
            fail('TRAINING_ANSWER_ALREADY_SAVED', 'Odpowiedź na to pytanie została już zapisana.', 409);
          }
        } else {
          await repository.saveAttempt(attempt);
          await repository.saveSession(session);
        }
        return { attempt: clone(attempt), session: toPublicSession(session), feedback };
      }
      const result = await repository.transact(async (collection, timestamp) => {
        const session = collection.sessions.find(({ id }) => id === asString(sessionId));
        if (!session) fail('TRAINING_SESSION_NOT_FOUND', 'Nie znaleziono sesji.', 404);
        if (session.status === 'abandoned') {
          fail('TRAINING_SESSION_ABANDONED', 'Ta sesja została przerwana i nie można zapisać odpowiedzi.', 409);
        }
        if (session.status !== 'active') fail('TRAINING_SESSION_COMPLETED', 'Ta sesja jest już zakończona.', 409);
        const spotVersionId = asString(payload.spotVersionId);
        if (!spotVersionId || session.currentSpotVersionId !== spotVersionId) {
          fail('TRAINING_QUESTION_MISMATCH', 'Odpowiedź nie dotyczy aktualnego pytania.', 409);
        }
        if ((session.answeredSpotVersionIds || []).includes(spotVersionId)
          || collection.attempts.some((attempt) => attempt.sessionId === session.id && attempt.spotVersionId === spotVersionId)) {
          fail('TRAINING_ANSWER_ALREADY_SAVED', 'Odpowiedź na to pytanie została już zapisana.', 409);
        }
        const spot = collection.spots.find(({ versionId }) => versionId === spotVersionId);
        if (!spot || !isUsableSessionSpot(collection, spot)) {
          fail('TRAINING_SPOT_UNAVAILABLE', 'Spot nie jest już dostępny w aktualnym datasecie.', 409);
        }
        const answer = asString(payload.answer);
        if (!spot.answerOptions.some(({ id }) => id === answer)) {
          fail('TRAINING_ANSWER_INVALID', 'Wybrana odpowiedź nie jest legalna dla tego spotu.');
        }
        const key = getCurrentKey(collection, spot);
        const grade = answer === key.preferredAnswer
          ? TRAINING_GRADES.CORRECT
          : key.acceptableAlternatives?.includes(answer)
            ? TRAINING_GRADES.ACCEPTABLE
            : TRAINING_GRADES.INCORRECT;
        const attempt = {
          id: idFactory('training-attempt'),
          sessionId: session.id,
          spotVersionId,
          answer,
          grade,
          answerKeyId: key.id,
          answeredAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        collection.attempts.push(attempt);
        session.answeredSpotVersionIds = [...(session.answeredSpotVersionIds || []), spotVersionId];
        session.currentSpotVersionId = null;
        session.lastSpotVersionId = spotVersionId;
        session.score = { correct: 0, acceptable: 0, incorrect: 0, ...(session.score || {}) };
        session.score[grade] += 1;
        session.updatedAt = timestamp;
        if (session.answeredSpotVersionIds.length >= session.targetSize) {
          session.status = 'completed';
          session.completedAt = timestamp;
        }
        const feedback = await buildAnswerFeedback({
          attempt,
          spot,
          key,
          getHandAnalysisSummary,
        });
        return {
          attempt: clone(attempt),
          session: toPublicSession(session),
          feedback,
        };
      });
      return result.result;
    },

    getSessionReviews: async (sessionId) => {
      if (repository.getTrainingSessionContext) {
        const collection = await repository.getTrainingSessionContext(asString(sessionId));
        if (!collection) fail('TRAINING_SESSION_NOT_FOUND', 'Nie znaleziono sesji.', 404);
        const spots = new Map(collection.spots.map((spot) => [spot.versionId, spot]));
        const keys = new Map(collection.answerKeys.map((key) => [key.id, key]));
        const reviews = await Promise.all(collection.attempts
          .sort((left, right) => (
            (Date.parse(left.answeredAt || left.createdAt || '') || 0)
            - (Date.parse(right.answeredAt || right.createdAt || '') || 0)
          ))
          .map(async (attempt) => {
            const spot = spots.get(attempt.spotVersionId);
            const key = keys.get(attempt.answerKeyId);
            if (!spot || !key || spot.sourceStatus !== 'current') return null;
            return {
              spotVersionId: attempt.spotVersionId,
              answer: attempt.answer,
              question: toPublicQuestion(spot),
              feedback: await buildAnswerFeedback({ attempt, spot, key, getHandAnalysisSummary }),
            };
          }));
        return { reviews: reviews.filter(Boolean) };
      }
      const collection = await repository.getSnapshot();
      const session = collection.sessions.find(({ id }) => id === asString(sessionId));
      if (!session) fail('TRAINING_SESSION_NOT_FOUND', 'Nie znaleziono sesji.', 404);
      const spots = new Map(collection.spots.map((spot) => [spot.versionId, spot]));
      const keys = new Map(collection.answerKeys.map((key) => [key.id, key]));
      const reviews = await Promise.all(collection.attempts
        .filter((attempt) => attempt.sessionId === session.id)
        .sort((left, right) => (
          (Date.parse(left.answeredAt || left.createdAt || '') || 0)
          - (Date.parse(right.answeredAt || right.createdAt || '') || 0)
        ))
        .map(async (attempt) => {
          const spot = spots.get(attempt.spotVersionId);
          const key = keys.get(attempt.answerKeyId);
          if (!spot || !key || spot.sourceStatus !== 'current') return null;
          return {
            spotVersionId: attempt.spotVersionId,
            answer: attempt.answer,
            question: toPublicQuestion(spot),
            feedback: await buildAnswerFeedback({
              attempt,
              spot,
              key,
              getHandAnalysisSummary,
            }),
          };
        }));
      return { reviews: reviews.filter(Boolean) };
    },

    getHistory: async (query = {}) => {
      const filters = validateFilters(query);
      const limit = Math.min(500, Math.max(1, Number.parseInt(query.limit || '100', 10) || 100));
      if (repository.getTrainingHistoryData) {
        const data = await repository.getTrainingHistoryData(filters, limit);
        const spots = new Map(data.spots.map((spot) => [spot.versionId, spot]));
        const keys = new Map(data.keys.map((key) => [key.id, key]));
        return {
          attempts: data.attempts.map((attempt) => {
            const spot = spots.get(attempt.spotVersionId);
            const key = keys.get(attempt.answerKeyId);
            return {
              ...clone(attempt),
              exerciseType: spot.exerciseType,
              gameType: spot.gameType,
              street: spot.street,
              heroPosition: spot.question?.heroPosition || 'UNKNOWN',
              preferredAnswer: key?.preferredAnswer || null,
              historicalAction: clone(spot.historicalAnswer),
            };
          }),
          sessions: data.sessions.filter((session) => sessionMatches(session, filters)).sort(byNewest).map(toPublicSession),
          totalAttempts: data.totalAttempts,
        };
      }
      const collection = await repository.getSnapshot();
      const spots = new Map(collection.spots.map((spot) => [spot.versionId, spot]));
      const keys = new Map(collection.answerKeys.map((key) => [key.id, key]));
      const sessions = new Map(collection.sessions.map((session) => [session.id, session]));
      const attempts = [...collection.attempts]
        .sort(byNewest)
        .filter((attempt) => {
          const spot = spots.get(attempt.spotVersionId);
          return spot && spotMatches(spot, filters);
        })
        .slice(0, limit)
        .map((attempt) => {
          const spot = spots.get(attempt.spotVersionId);
          const key = keys.get(attempt.answerKeyId);
          return {
            ...clone(attempt),
            exerciseType: spot.exerciseType,
            gameType: spot.gameType,
            street: spot.street,
            heroPosition: spot.question?.heroPosition || 'UNKNOWN',
            preferredAnswer: key?.preferredAnswer || null,
            historicalAction: clone(spot.historicalAnswer),
          };
        });
      return {
        attempts,
        sessions: [...sessions.values()].filter((session) => sessionMatches(session, filters)).sort(byNewest).map(toPublicSession),
        totalAttempts: collection.attempts.filter((attempt) => {
          const spot = spots.get(attempt.spotVersionId);
          return spot && spotMatches(spot, filters);
        }).length,
      };
    },

    reset: async ({ scope, confirmed = false } = {}) => {
      if (!confirmed) fail('TRAINING_RESET_CONFIRMATION_REQUIRED', 'Reset wymaga potwierdzenia.', 409);
      if (!['answer_keys', 'all'].includes(scope)) {
        fail('TRAINING_RESET_SCOPE_INVALID', 'Reset musi dotyczyć kluczy AI albo całej kolekcji.');
      }
      if (repository.resetTrainingData) {
        if (isRefreshRunning()) {
          fail('TRAINING_RESET_BLOCKED', 'Najpierw zatrzymaj działające zadanie AI.', 409);
        }
        const runningJobs = repository.getRefreshJobs
          ? await repository.getRefreshJobs()
          : [];
        if (runningJobs.some(({ status }) => status === 'running' || status === 'stop_requested')) {
          fail('TRAINING_RESET_BLOCKED', 'Najpierw zatrzymaj działające zadanie AI.', 409);
        }
        const removed = await repository.resetTrainingData(scope);
        return { ...removed, status: await (async () => {
          if (repository.getTrainingStatusData) {
            return buildStatusFromDatabase(await repository.getTrainingStatusData(100), 100);
          }
          return buildStatus(await repository.getSnapshot());
        })() };
      }
      const result = await repository.transact((collection, timestamp) => {
        if (isRefreshRunning() || collection.refreshJobs.some(({ status }) => (
          status === 'running' || status === 'stop_requested'
        ))) {
          fail('TRAINING_RESET_BLOCKED', 'Najpierw zatrzymaj działające zadanie AI.', 409);
        }
        const removed = {
          spots: collection.spots.length,
          answerKeys: collection.answerKeys.length,
          refreshJobs: collection.refreshJobs.length,
          sessions: collection.sessions.length,
          attempts: collection.attempts.length,
          abandonedSessions: 0,
        };
        if (scope === 'all') {
          collection.spots = [];
          collection.answerKeys = [];
          collection.refreshJobs = [];
          collection.sessions = [];
          collection.attempts = [];
          collection.selectionState = {
            ...collection.selectionState,
            selectedAt: null,
            selectedSpotVersionIds: [],
            poolStats: {},
          };
          collection.scanState = {
            lastScannedAt: null,
            datasetRevision: null,
            sources: {},
            sourceHistory: [],
            lastResult: null,
          };
        } else {
          collection.answerKeys = [];
          collection.refreshJobs = [];
          collection.spots.forEach((spot) => {
            spot.currentAnswerKeyId = null;
            spot.readiness = 'pending_key';
            spot.active = false;
          });
          collection.sessions.forEach((session) => {
            if (session.status !== 'active') return;
            session.status = 'abandoned';
            session.abandonedAt = timestamp;
            session.abandonReason = 'answer_keys_reset';
            session.currentSpotVersionId = null;
            session.updatedAt = timestamp;
            removed.abandonedSessions += 1;
          });
        }
        return { scope, removed };
      });
      return {
        ...result.result,
        status: buildStatus(await repository.getSnapshot()),
      };
    },

    getStats: async (query = {}) => {
      const filters = validateFilters(query);
      if (repository.getTrainingStatsRows) {
        const total = createAccumulator();
        const byExerciseType = new Map();
        const byGameType = new Map();
        const byPosition = new Map();
        const byStack = new Map();
        (await repository.getTrainingStatsRows(filters)).forEach((row) => {
          addGrade(total, row.grade);
          addGrouped(byExerciseType, row.exercise_type, row.grade);
          addGrouped(byGameType, row.game_type, row.grade);
          addGrouped(byPosition, row.hero_position, row.grade);
          addGrouped(byStack, getStackBucket(row.effective_stack_bb), row.grade);
        });
        return {
          total: finishAccumulator(total),
          byExerciseType: finishGroups(byExerciseType),
          byGameType: finishGroups(byGameType),
          byPosition: finishGroups(byPosition),
          byStack: finishGroups(byStack),
        };
      }
      const collection = await repository.getSnapshot();
      const spots = new Map(collection.spots.map((spot) => [spot.versionId, spot]));
      const total = createAccumulator();
      const byExerciseType = new Map();
      const byGameType = new Map();
      const byPosition = new Map();
      const byStack = new Map();
      collection.attempts.forEach((attempt) => {
        const spot = spots.get(attempt.spotVersionId);
        if (!spot || !spotMatches(spot, filters)) return;
        addGrade(total, attempt.grade);
        addGrouped(byExerciseType, spot.exerciseType, attempt.grade);
        addGrouped(byGameType, spot.gameType, attempt.grade);
        addGrouped(byPosition, spot.question?.heroPosition, attempt.grade);
        addGrouped(byStack, getStackBucket(spot.question?.effectiveStackBb), attempt.grade);
      });
      return {
        total: finishAccumulator(total),
        byExerciseType: finishGroups(byExerciseType),
        byGameType: finishGroups(byGameType),
        byPosition: finishGroups(byPosition),
        byStack: finishGroups(byStack),
      };
    },
  };
};

export {
  toPublicAnswerKey,
  toPublicQuestion,
  toPublicRefreshJob,
  toPublicSession,
};
