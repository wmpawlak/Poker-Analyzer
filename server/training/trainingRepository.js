import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { normalizeRawHandText, parseSingleRawHand } from '../../src/parser/pokerParser.js';
import { classifyTrainingSpots, EXERCISE_TYPES } from './exerciseClassifier.js';
import {
  TRAINING_ANSWER_KEY_CONTRACT_VERSION,
  validateHeroCardDescription,
} from './answerKeyContract.js';
import {
  CARD_FACTS_VALIDATION_VERSION,
  computeDecisionCardFacts,
  sameDecisionCardFacts,
} from './decisionCardFacts.js';
import { extractTrainingSpots } from './spotExtractor.js';
import {
  DEFAULT_SELECTION_LIMIT,
  getTrainingSpotAiEligibilityError,
  isTrainingSpotAiEligible,
  selectDiverseRecentSpots,
  TRAINING_SELECTION_STRATEGY,
} from './spotSelection.js';
import { classifyHeroHand } from './heroHandClassifier.js';
import {
  createEmptyTrainingAuditState,
  DEFAULT_TRAINING_AUDIT_EXCLUSIONS,
  isTrainingAuditExcluded,
  mergeTrainingAuditExclusions,
  normalizeTrainingAuditState,
} from './trainingAudit.js';

export const TRAINING_COLLECTION_VERSION = 1;
export const TRAINING_COLLECTION_FILENAME = 'poker-training-v1.json';
export const DEFAULT_ACTIVE_POOL_LIMIT = 100;
export const MAX_TRAINING_COLLECTION_BYTES = 256 * 1024 * 1024;
const MAX_LEGACY_REFRESH_CANDIDATES = 800;
const MAX_RENAME_ATTEMPTS = 10;
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1_000;


export class TrainingRepositoryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TrainingRepositoryError';
    this.code = code;
    Object.assign(this, details);
  }
}

const fail = (code, message) => {
  throw new TrainingRepositoryError(code, message);
};

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const asString = (value) => String(value ?? '').trim();
const clone = (value) => JSON.parse(JSON.stringify(value));
const roundResultAmount = (value) => Number((Number(value) || 0).toFixed(2));

const assertNoRawHistory = (value) => {
  const visit = (candidate) => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!isObject(candidate)) return;
    Object.entries(candidate).forEach(([key, nested]) => {
      if (key.replaceAll('_', '').toLowerCase() === 'rawtext') {
        fail('TRAINING_RAW_HISTORY_FORBIDDEN', 'Kolekcja treningowa nie może zawierać rawText.');
      }
      visit(nested);
    });
  };
  visit(value);
};

const normalizeUniqueRecords = (records, label, getId) => {
  if (!Array.isArray(records)) fail('TRAINING_COLLECTION_INVALID', `${label} musi być tablicą.`);
  const seen = new Set();
  return records.map((record) => {
    if (!isObject(record)) fail('TRAINING_COLLECTION_INVALID', `${label} zawiera nieprawidłowy rekord.`);
    const id = asString(getId(record));
    if (!id) fail('TRAINING_COLLECTION_INVALID', `${label} zawiera rekord bez identyfikatora.`);
    if (seen.has(id)) fail('TRAINING_COLLECTION_INVALID', `${label} zawiera duplikat ${id}.`);
    seen.add(id);
    return clone(record);
  });
};

export const createEmptyTrainingCollection = () => ({
  version: TRAINING_COLLECTION_VERSION,
  revision: 0,
  updatedAt: null,
  spots: [],
  answerKeys: [],
  refreshJobs: [],
  sessions: [],
  attempts: [],
  selectionState: {
    strategy: TRAINING_SELECTION_STRATEGY,
    strategyVersion: TRAINING_SELECTION_STRATEGY,
    selectedAt: null,
    limit: DEFAULT_SELECTION_LIMIT,
    selectedSpotVersionIds: [],
    poolStats: {},
    replenishmentDisabled: false,
  },
  auditState: createEmptyTrainingAuditState(),
  scanState: {
    lastScannedAt: null,
    datasetRevision: null,
    sources: {},
    sourceHistory: [],
    lastResult: null,
  },
});

export const normalizeTrainingCollection = (value) => {
  if (!isObject(value) || value.version !== TRAINING_COLLECTION_VERSION) {
    fail('TRAINING_COLLECTION_VERSION_UNSUPPORTED', 'Kolekcja treningowa ma nieobsługiwaną wersję.');
  }
  if (!Number.isInteger(value.revision) || value.revision < 0) {
    fail('TRAINING_COLLECTION_INVALID', 'Kolekcja treningowa ma nieprawidłową rewizję.');
  }
  if (value.updatedAt !== null && typeof value.updatedAt !== 'string') {
    fail('TRAINING_COLLECTION_INVALID', 'Kolekcja treningowa ma nieprawidłową datę aktualizacji.');
  }
  if (!isObject(value.scanState) || !isObject(value.scanState.sources)
    || !Array.isArray(value.scanState.sourceHistory)) {
    fail('TRAINING_COLLECTION_INVALID', 'Kolekcja treningowa ma nieprawidłowy stan skanowania.');
  }

  const selection = isObject(value.selectionState) ? value.selectionState : {};
  const selectionIds = Array.isArray(selection.selectedSpotVersionIds)
    ? [...new Set(selection.selectedSpotVersionIds.map(asString).filter(Boolean))]
    : [];
  if (selection.limit !== undefined && (!Number.isInteger(selection.limit) || selection.limit < 1)) {
    fail('TRAINING_COLLECTION_INVALID', 'Kolekcja treningowa ma nieprawidłowy limit selekcji.');
  }
  const normalized = {
    version: TRAINING_COLLECTION_VERSION,
    revision: value.revision,
    updatedAt: value.updatedAt,
    spots: normalizeUniqueRecords(value.spots, 'spots', (spot) => spot.versionId)
      .map((spot) => ({
        ...spot,
        aiFirstSentAt: typeof spot.aiFirstSentAt === 'string' ? spot.aiFirstSentAt : null,
        aiFirstSentJobId: typeof spot.aiFirstSentJobId === 'string' ? spot.aiFirstSentJobId : null,
        ...(isObject(spot.question) ? {
          decisionCardFacts: computeDecisionCardFacts({
            heroCards: spot.question.heroCards,
            board: spot.question.board,
          }),
        } : {}),
      })),
    answerKeys: normalizeUniqueRecords(value.answerKeys, 'answerKeys', (key) => key.id)
      .map((key) => ({
        ...key,
        contractVersion: Number.isInteger(key.contractVersion)
          ? key.contractVersion
          : TRAINING_ANSWER_KEY_CONTRACT_VERSION,
      })),
    refreshJobs: normalizeUniqueRecords(value.refreshJobs || [], 'refreshJobs', (job) => job.id),
    sessions: normalizeUniqueRecords(value.sessions, 'sessions', (session) => session.id),
    attempts: normalizeUniqueRecords(value.attempts, 'attempts', (attempt) => attempt.id),
    selectionState: {
      strategy: TRAINING_SELECTION_STRATEGY,
      strategyVersion: TRAINING_SELECTION_STRATEGY,
      selectedAt: typeof selection.selectedAt === 'string' ? selection.selectedAt : null,
      limit: selection.limit || DEFAULT_SELECTION_LIMIT,
      selectedSpotVersionIds: selectionIds,
      poolStats: isObject(selection.poolStats) ? clone(selection.poolStats) : {},
      replenishmentDisabled: selection.replenishmentDisabled === true,
    },
    auditState: normalizeTrainingAuditState(value.auditState),
    scanState: {
      lastScannedAt: value.scanState.lastScannedAt || null,
      datasetRevision: value.scanState.datasetRevision || null,
      sources: clone(value.scanState.sources),
      sourceHistory: clone(value.scanState.sourceHistory),
      lastResult: value.scanState.lastResult ? clone(value.scanState.lastResult) : null,
    },
  };
  assertNoRawHistory(normalized);
  return normalized;
};

const getCollectionPath = (dataDirectory) => {
  if (!dataDirectory) fail('TRAINING_DATA_DIRECTORY_REQUIRED', 'Repozytorium treningowe wymaga katalogu data.');
  const directory = path.resolve(dataDirectory);
  const filePath = path.resolve(directory, TRAINING_COLLECTION_FILENAME);
  if (!filePath.startsWith(`${directory}${path.sep}`)) {
    fail('TRAINING_PATH_INVALID', 'Plik kolekcji znajduje się poza katalogiem data.');
  }
  return filePath;
};

export const readTrainingCollection = async (dataDirectory) => {
  const filePath = getCollectionPath(dataDirectory);
  let text;
  try {
    const stats = await fs.stat(filePath);
    if (stats.size > MAX_TRAINING_COLLECTION_BYTES) {
      fail('TRAINING_COLLECTION_TOO_LARGE', 'Kolekcja treningowa przekracza limit rozmiaru.');
    }
    text = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return createEmptyTrainingCollection();
    if (error instanceof TrainingRepositoryError) throw error;
    throw new TrainingRepositoryError('TRAINING_COLLECTION_READ_FAILED', 'Nie udało się odczytać kolekcji treningowej.');
  }
  try {
    return normalizeTrainingCollection(JSON.parse(text));
  } catch (error) {
    if (error instanceof TrainingRepositoryError) throw error;
    throw new TrainingRepositoryError('TRAINING_COLLECTION_INVALID', 'Kolekcja treningowa nie zawiera poprawnego JSON.');
  }
};

export const cleanupTrainingTemporaryFiles = async (dataDirectory, {
  now = Date.now(),
  maxAgeMs = TEMP_FILE_MAX_AGE_MS,
} = {}) => {
  const directory = path.resolve(dataDirectory);
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw new TrainingRepositoryError('TRAINING_COLLECTION_WRITE_FAILED', 'Nie udało się przygotować zapisu kolekcji treningowej.');
  }
  const names = entries
    .filter((entry) => entry.isFile()
      && entry.name.startsWith(`.${TRAINING_COLLECTION_FILENAME}.`)
      && entry.name.endsWith('.tmp'))
    .map((entry) => entry.name);
  let removed = 0;
  await Promise.all(names.map(async (name) => {
    const temporaryPath = path.join(directory, name);
    try {
      const stats = await fs.stat(temporaryPath);
      if (now - stats.mtimeMs <= maxAgeMs) return;
      await fs.rm(temporaryPath, { force: true });
      removed += 1;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }));
  return removed;
};

export const renameTrainingCollectionWithRetry = async (temporaryPath, filePath, {
  renameImpl = fs.rename,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  maxAttempts = MAX_RENAME_ATTEMPTS,
} = {}) => {
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await renameImpl(temporaryPath, filePath);
      return;
    } catch (error) {
      lastError = error;
      if (!RETRYABLE_RENAME_CODES.has(error?.code) || attempt === maxAttempts - 1) break;
      await sleep(Math.min(1_000, 25 * (2 ** attempt)));
    }
  }
  throw new TrainingRepositoryError(
    'TRAINING_COLLECTION_WRITE_FAILED',
    'Nie udało się zapisać kolekcji ćwiczeń. Spróbuj ponownie.',
    { cause: lastError },
  );
};

export const writeTrainingCollection = async (collection, dataDirectory, options = {}) => {
  const normalized = normalizeTrainingCollection(collection);
  // Pełny katalog zawiera dziesiątki tysięcy migawek. Wcięcia zwiększają realny
  // plik o ponad 60%, nie dodając wartości repozytorium odczytywanemu maszynowo.
  const serialized = `${JSON.stringify(normalized)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > MAX_TRAINING_COLLECTION_BYTES) {
    fail('TRAINING_COLLECTION_TOO_LARGE', 'Kolekcja treningowa przekracza limit rozmiaru.');
  }
  const filePath = getCollectionPath(dataDirectory);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(temporaryPath, serialized, 'utf8');
    await renameTrainingCollectionWithRetry(temporaryPath, filePath, options);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
  return normalized;
};

const createFingerprint = (source) => {
  const existing = asString(source?.contentHash || source?.fingerprint);
  if (existing) return existing;
  const rawText = normalizeRawHandText(source?.rawText ?? source?.hand?.rawText);
  if (!rawText) fail('TRAINING_SOURCE_INVALID', 'Rozdanie nie ma fingerprintu ani treści źródłowej.');
  return createHash('sha256').update(rawText).digest('hex');
};

const toIsoDate = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const getHistoricalResult = (rawText) => {
  const parsed = parseSingleRawHand(rawText)?.hand;
  const hasReliableOutcome = /^\*\*\* SUMMARY \*\*\*[\s\S]*^Seat \d+: Hero .*\b(?:won|lost|folded|mucked)\b/im.test(rawText);
  if (!parsed || !hasReliableOutcome || !['WON', 'LOST', 'FOLDED'].includes(parsed.outcome)) return null;
  return {
    outcome: parsed.outcome,
    heroWinnings: roundResultAmount(parsed.heroWinnings),
    heroInvestment: roundResultAmount(parsed.heroInvestment),
    netProfit: roundResultAmount(parsed.netProfit),
    sawShowdown: Boolean(parsed.sawShowdown),
    handRanking: asString(parsed.handRanking) || null,
  };
};

const normalizeSource = (source) => {
  const hand = source?.hand || source || {};
  const handId = asString(source?.handId || hand.id);
  if (!handId) fail('TRAINING_SOURCE_INVALID', 'Rozdanie nie ma handId.');
  const rawText = normalizeRawHandText(source?.rawText ?? hand.rawText);
  if (!rawText) fail('TRAINING_SOURCE_INVALID', `Rozdanie #${handId} nie ma treści źródłowej.`);
  const gameType = asString(source?.gameType || hand.gameType).toLowerCase() === 'tournament'
    || source?.isTournament || hand.isTournament
    ? 'tournament'
    : 'cash';
  const playedAt = toIsoDate(source?.playedAt ?? hand.playedAt ?? hand.timestamp ?? hand.dateStr);
  return {
    handId,
    rawText,
    gameType,
    playedAt,
    fingerprint: createFingerprint({ ...source, rawText }),
    isRebuy: Boolean(source?.isRebuy || hand.isRebuy),
    historicalResult: getHistoricalResult(rawText),
  };
};

const makeVersionId = (spotId, fingerprint) => `${spotId}@${fingerprint}`;

const markHandVersionsInactive = (collection, handId, sourceStatus, now) => {
  const archivedVersionIds = new Set();
  collection.spots.forEach((spot) => {
    if (spot.handId !== handId || spot.sourceStatus !== 'current') return;
    spot.sourceStatus = sourceStatus;
    spot.active = false;
    spot.archivedAt = now;
    spot.archiveReason = sourceStatus === 'removed' ? 'source_removed' : 'source_changed';
    archivedVersionIds.add(spot.versionId);
  });
  collection.answerKeys.forEach((key) => {
    if (!archivedVersionIds.has(key.spotVersionId)) return;
    key.archivedAt = now;
    key.archiveReason = sourceStatus === 'removed' ? 'source_removed' : 'source_changed';
  });
};

const restoreExistingVersions = (collection, source, now) => {
  const versions = collection.spots.filter((spot) => (
    spot.handId === source.handId && spot.sourceFingerprint === source.fingerprint
  ));
  versions.forEach((spot) => {
    spot.sourceStatus = 'current';
    spot.archivedAt = null;
    spot.archiveReason = null;
    spot.lastSeenAt = now;
    spot.historicalResult = clone(source.historicalResult);
  });
  const restoredIds = new Set(versions.map(({ versionId }) => versionId));
  collection.answerKeys.forEach((key) => {
    if (!restoredIds.has(key.spotVersionId)) return;
    key.archivedAt = null;
    key.archiveReason = null;
  });
  return versions;
};

const isAnswerKeyEligible = (key, spot) => key?.status === 'ready'
  && key?.confidence === 'high'
  && key?.localFactsValid === true
  && key?.factsValidationVersion === CARD_FACTS_VALIDATION_VERSION
  && sameDecisionCardFacts(key?.decisionCardFacts, spot?.decisionCardFacts);

const latestKeysBySpotVersion = (answerKeys) => {
  const keys = new Map();
  answerKeys.forEach((key, index) => {
    const current = keys.get(key.spotVersionId);
    const currentTime = Date.parse(current?.createdAt || '') || 0;
    const candidateTime = Date.parse(key.createdAt || '') || 0;
    if (!current || candidateTime > currentTime || (candidateTime === currentTime && index > current.index)) {
      keys.set(key.spotVersionId, { ...key, index });
    }
  });
  return keys;
};

const poolKey = (spot) => `${spot.exerciseType}:${spot.gameType}`;

const createPoolStats = (spots) => ({
  matching: spots.length,
  selected: 0,
  locallyRejected: spots.filter((spot) => getTrainingSpotAiEligibilityError(spot)).length,
});

const selectCollectionSpots = (collection, now, {
  rebuildSelection = false,
  selectionLimit,
  reintroducedHandIds = new Set(),
} = {}) => {
  const previous = collection.selectionState || {};
  const replenishmentDisabled = previous.replenishmentDisabled === true
    || collection.auditState?.selectionFrozen === true;
  const priorIds = new Set(previous.selectedSpotVersionIds || []);
  const spotsByVersionId = new Map(collection.spots.map((spot) => [spot.versionId, spot]));
  const selectedIds = [];
  const pools = new Map();
  const poolStats = {};
  collection.spots.forEach((spot) => {
    if (spot.sourceStatus !== 'current') return;
    const key = poolKey(spot);
    const pool = pools.get(key) || [];
    pool.push(spot);
    pools.set(key, pool);
  });
  for (const spots of pools.values()) {
    const key = poolKey(spots[0]);
    poolStats[key] = createPoolStats(spots);
    const poolIds = new Set(spots.map(({ versionId }) => versionId));
    let existing = (replenishmentDisabled || !rebuildSelection) ? previous.selectedSpotVersionIds
      .map((id) => spotsByVersionId.get(id))
      .filter((spot) => poolIds.has(spot?.versionId) && isTrainingSpotAiEligible(spot))
      : [];
    const completeEpisodes = new Map();
    existing.filter((spot) => spot.exerciseType === EXERCISE_TYPES.CBET_BARRELS).forEach((spot) => {
      const episode = completeEpisodes.get(spot.episodeId) || [];
      episode.push(spot);
      completeEpisodes.set(spot.episodeId, episode);
    });
    existing = existing.filter((spot) => {
      if (spot.exerciseType !== EXERCISE_TYPES.CBET_BARRELS) return true;
      const episode = completeEpisodes.get(spot.episodeId) || [];
      const stages = new Set(episode.map(({ stage }) => stage));
      return episode.length === (Number(spot.sequenceLength) || 1)
        && (episode.length === 1 || (stages.has('flop') && stages.has('turn')));
    });
    const existingHands = new Set(existing.map((spot) => (
      spot.exerciseType === EXERCISE_TYPES.CBET_BARRELS ? `episode:${spot.episodeId}` : `hand:${spot.handId}`
    )));
    const vacancies = Math.max(0, selectionLimit - existing.length);
    const candidates = spots.filter((spot) => {
      if (existing.some(({ versionId }) => versionId === spot.versionId)) return false;
      const unit = spot.exerciseType === EXERCISE_TYPES.CBET_BARRELS
        ? `episode:${spot.episodeId}` : `hand:${spot.handId}`;
      return !existingHands.has(unit);
    });
    const eligibleAdditions = replenishmentDisabled
      ? candidates.filter((spot) => reintroducedHandIds.has(spot.handId))
      : candidates;
    const additions = vacancies > 0
      ? selectDiverseRecentSpots(eligibleAdditions, { limit: vacancies })
      : [];
    selectedIds.push(...existing.map(({ versionId }) => versionId), ...additions.map(({ versionId }) => versionId));
    poolStats[key].selected = existing.length + additions.length;
  }
  const ids = [...new Set(selectedIds)];
  const hasChanged = rebuildSelection || previous.selectedAt === null
    || ids.length !== priorIds.size || ids.some((id) => !priorIds.has(id));
  collection.selectionState = {
    strategy: TRAINING_SELECTION_STRATEGY,
    strategyVersion: TRAINING_SELECTION_STRATEGY,
    selectedAt: hasChanged ? now : previous.selectedAt,
    limit: selectionLimit,
    selectedSpotVersionIds: ids,
    poolStats,
    replenishmentDisabled,
  };
  return new Set(ids);
};

const resumableJob = (job) => ['running', 'stop_requested', 'stopped', 'failed'].includes(job?.status)
  && Number(job.cursor || 0) < (job.candidateSpotVersionIds?.length || 0);

const appendAuditJobError = (now) => ({
  code: 'TRAINING_REFRESH_AUDIT_EXCLUDED',
  message: 'Zadanie AI zawieraĹ‚o spoty z wykluczonych rozdaĹ„ i zostaĹ‚o zakoĹ„czone bez nowych zapytaĹ„.',
  spotVersionIds: [],
  at: now,
});

const isExcludedSpotVersionId = (auditState, versionId) => {
  const value = asString(versionId);
  const separator = value.lastIndexOf('@');
  if (separator < 1) return false;
  const spotId = value.slice(0, separator);
  const fingerprint = value.slice(separator + 1);
  const handId = spotId.split(':')[0];
  return isTrainingAuditExcluded(auditState, { handId, fingerprint });
};

const recalculateSessionScore = (collection, session) => {
  const score = { correct: 0, acceptable: 0, incorrect: 0 };
  collection.attempts
    .filter((attempt) => attempt.sessionId === session.id)
    .forEach((attempt) => {
      if (Object.hasOwn(score, attempt.grade)) score[attempt.grade] += 1;
    });
  session.score = score;
};

const migrateTrainingAudit = (collection, now, requestedExclusions) => {
  const merged = mergeTrainingAuditExclusions(collection.auditState, requestedExclusions, {
    spots: collection.spots,
    sources: collection.scanState.sources,
    now,
  });
  collection.auditState = merged.state;
  const excludedPairs = collection.auditState.excludedHands;
  const excludedSpotIds = new Set(collection.spots
    .filter((spot) => isTrainingAuditExcluded(collection.auditState, {
      handId: spot.handId,
      fingerprint: spot.sourceFingerprint,
    }))
    .map(({ versionId }) => versionId));
  let changed = merged.changed;
  if (excludedSpotIds.size === 0) {
    return changed;
  }

  const retainedSpotIds = new Set(
    collection.spots.filter(({ versionId }) => !excludedSpotIds.has(versionId)).map(({ versionId }) => versionId),
  );
  const beforeCounts = {
    spots: collection.spots.length,
    answerKeys: collection.answerKeys.length,
    attempts: collection.attempts.length,
  };
  collection.spots = collection.spots.filter(({ versionId }) => !excludedSpotIds.has(versionId));
  collection.answerKeys = collection.answerKeys.filter((key) => retainedSpotIds.has(key.spotVersionId));
  collection.attempts = collection.attempts.filter((attempt) => (
    retainedSpotIds.has(attempt.spotVersionId)
      && !isExcludedSpotVersionId(collection.auditState, attempt.spotVersionId)
  ));

  const removedBySession = new Map();
  collection.sessions.forEach((session) => {
    const oldAvailable = Array.isArray(session.availableSpotVersionIds)
      ? session.availableSpotVersionIds : [];
    const oldAnswered = Array.isArray(session.answeredSpotVersionIds)
      ? session.answeredSpotVersionIds : [];
    const normalizeIds = (ids) => [...new Set(ids.map(asString).filter((id) => retainedSpotIds.has(id)))];
    session.availableSpotVersionIds = normalizeIds(oldAvailable);
    session.answeredSpotVersionIds = normalizeIds(oldAnswered);
    const currentId = asString(session.currentSpotVersionId);
    const lastId = asString(session.lastSpotVersionId);
    if (currentId && !retainedSpotIds.has(currentId)) session.currentSpotVersionId = null;
    if (lastId && !retainedSpotIds.has(lastId)) session.lastSpotVersionId = null;
    if (currentId && excludedSpotIds.has(currentId)) session.currentAnswerKeyId = null;
    recalculateSessionScore(collection, session);
    const removed = oldAvailable.filter((id) => excludedSpotIds.has(id)).length
      + oldAnswered.filter((id) => excludedSpotIds.has(id)).length
      + (excludedSpotIds.has(currentId) ? 1 : 0)
      + (excludedSpotIds.has(lastId) ? 1 : 0);
    if (removed > 0) removedBySession.set(session.id, removed);

    if (session.status !== 'active') return;
    const targetSize = Number(session.targetSize);
    const totalQuestions = session.availableSpotVersionIds.length + session.answeredSpotVersionIds.length;
    if (Number.isFinite(targetSize) && targetSize > 0) {
      session.targetSize = Math.min(targetSize, totalQuestions);
    }
    const answeredCount = session.answeredSpotVersionIds.length;
    const hasUsableCandidate = collection.spots.some((spot) => (
      session.availableSpotVersionIds.includes(spot.versionId)
      && !session.answeredSpotVersionIds.includes(spot.versionId)
      && spot.sourceStatus === 'current'
      && spot.active === true
    ));
    if (!hasUsableCandidate || (session.targetSize > 0 && answeredCount >= session.targetSize)) {
      session.status = 'completed';
      session.completedAt = session.completedAt || now;
      session.currentSpotVersionId = null;
    }
    session.updatedAt = now;
  });

  collection.refreshJobs.forEach((job) => {
    const candidateIds = Array.isArray(job.candidateSpotVersionIds) ? job.candidateSpotVersionIds : [];
    const filteredIds = candidateIds.filter((id) => (
      !excludedSpotIds.has(id) && !isExcludedSpotVersionId(collection.auditState, id)
    ));
    if (filteredIds.length === candidateIds.length) return;
    job.candidateSpotVersionIds = filteredIds;
    job.candidateCount = filteredIds.length;
    job.cursor = Math.min(Number(job.cursor || 0), filteredIds.length);
    job.inFlight = null;
    if (!['completed', 'failed', 'superseded'].includes(job.status)) {
      job.status = 'superseded';
      job.stopRequested = false;
      job.finishedAt = job.finishedAt || now;
      job.errors = [...(job.errors || []), appendAuditJobError(now)];
    }
  });

  Object.entries(collection.scanState.sources).forEach(([handId, source]) => {
    if (!isTrainingAuditExcluded(collection.auditState, { handId, fingerprint: source.fingerprint })) return;
    source.status = 'excluded';
    source.spotVersionIds = [];
    source.excludedAt = source.excludedAt || now;
  });
  collection.scanState.sourceHistory = collection.scanState.sourceHistory.filter((entry) => (
    !isTrainingAuditExcluded(collection.auditState, entry)
  ));
  const selected = collection.selectionState.selectedSpotVersionIds || [];
  collection.selectionState.selectedSpotVersionIds = selected.filter((id) => retainedSpotIds.has(id));
  collection.selectionState.replenishmentDisabled = true;
  collection.auditState.selectionFrozen = true;

  changed = changed
    || beforeCounts.spots !== collection.spots.length
    || beforeCounts.answerKeys !== collection.answerKeys.length
    || beforeCounts.attempts !== collection.attempts.length
    || removedBySession.size > 0
    || excludedPairs.length > 0;
  return changed;
};

const recomputeActivePools = (collection) => {
  const latestKeys = latestKeysBySpotVersion(collection.answerKeys);
  const selectedIds = new Set(collection.selectionState?.selectedSpotVersionIds || []);
  collection.spots.forEach((spot) => {
    const key = latestKeys.get(spot.versionId);
    spot.currentAnswerKeyId = key?.contractVersion === TRAINING_ANSWER_KEY_CONTRACT_VERSION ? key.id : null;
    spot.active = false;
    if (spot.sourceStatus === 'current' && key?.contractVersion === TRAINING_ANSWER_KEY_CONTRACT_VERSION
      && isAnswerKeyEligible(key, spot)) {
      spot.readiness = 'ready';
      spot.archiveReason = null;
    } else if (spot.sourceStatus === 'current' && key?.contractVersion === TRAINING_ANSWER_KEY_CONTRACT_VERSION) {
      spot.readiness = 'review';
    } else if (spot.sourceStatus === 'current') {
      spot.readiness = 'pending_key';
    }
  });

  collection.spots.filter((spot) => spot.sourceStatus === 'current'
    && selectedIds.has(spot.versionId) && spot.readiness === 'ready')
    .forEach((spot) => { spot.active = true; });
};

const migrateAnswerKeyContract = (collection, now) => {
  const legacyKeyIds = new Set();
  const legacySpotIds = new Set();
  let changed = false;
  const spotsById = new Map(collection.spots.map((spot) => [spot.versionId, spot]));
  collection.answerKeys.forEach((key) => {
    if (key.contractVersion >= TRAINING_ANSWER_KEY_CONTRACT_VERSION) return;
    const spot = spotsById.get(key.spotVersionId);
    if (key.contractVersion === 2 && spot) {
      const expectedHeroHand = classifyHeroHand(spot.question?.heroCards);
      const preferredIsLegal = spot.answerOptions?.some(({ id }) => id === key.preferredAnswer);
      const descriptionError = validateHeroCardDescription(key, spot.decisionCardFacts);
      const locallyValid = expectedHeroHand
        && key.heroHand?.notation === expectedHeroHand.notation
        && key.heroHand?.class === expectedHeroHand.class
        && preferredIsLegal
        && key.localFactsValid !== false
        && !descriptionError;
      if (locallyValid) {
        key.contractVersion = TRAINING_ANSWER_KEY_CONTRACT_VERSION;
        key.heroHand = { ...expectedHeroHand };
        key.decisionCardFacts = clone(spot.decisionCardFacts);
        key.factsValidationVersion = CARD_FACTS_VALIDATION_VERSION;
        key.localFactsValid = true;
        changed = true;
        return;
      }
    }
    legacyKeyIds.add(key.id);
    legacySpotIds.add(key.spotVersionId);
    if (key.status !== 'superseded' || key.historicalOnly !== true) {
      key.status = 'superseded';
      key.historicalOnly = true;
      key.invalidated = true;
      key.invalidatedAt = key.invalidatedAt || now;
       key.invalidationReason = 'answer_key_contract_v3';
      changed = true;
    }
  });

  collection.refreshJobs.forEach((job) => {
    if (job.contractVersion >= TRAINING_ANSWER_KEY_CONTRACT_VERSION
      || ['completed', 'failed', 'superseded'].includes(job.status)) return;
    job.status = 'superseded';
    job.stopRequested = false;
    job.inFlight = null;
    job.finishedAt = job.finishedAt || now;
    job.errors = [...(job.errors || []), {
      code: 'TRAINING_REFRESH_CONTRACT_SUPERSEDED',
       message: 'Zadanie utworzone dla starego kontraktu kluczy zostało zastąpione. Uruchom nową analizę v3.',
      spotVersionIds: [],
    }];
    changed = true;
  });

  collection.sessions.forEach((session) => {
    if (session.status !== 'active') return;
    const referencedSpotIds = [
      session.currentSpotVersionId,
      ...(session.availableSpotVersionIds || []),
    ].filter(Boolean);
    const usesLegacyKey = session.contractVersion === 1
      || session.answerKeyContractVersion === 1
      || legacyKeyIds.has(session.currentAnswerKeyId)
      || referencedSpotIds.some((spotVersionId) => {
      if (legacySpotIds.has(spotVersionId)) return true;
      const spot = spotsById.get(spotVersionId);
      return legacyKeyIds.has(spot?.currentAnswerKeyId);
      });
    if (!usesLegacyKey) return;
    session.status = 'abandoned';
    session.abandonedAt = session.abandonedAt || now;
     session.abandonReason = 'answer_key_contract_v3';
    session.currentSpotVersionId = null;
    changed = true;
  });

  if (changed) recomputeActivePools(collection);
  return changed;
};

const normalizeEvidenceTime = (value, fallback) => (
  typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : fallback
);

const migrateAiFirstSentMarkers = (collection, now) => {
  const spotsByVersionId = new Map(collection.spots.map((spot) => [spot.versionId, spot]));
  const evidenceByVersionId = new Map();
  const addEvidence = (spotVersionId, at, jobId) => {
    const id = asString(spotVersionId);
    if (!id || !spotsByVersionId.has(id)) return;
    const evidence = {
      at: normalizeEvidenceTime(at, now),
      jobId: asString(jobId) || null,
    };
    const current = evidenceByVersionId.get(id);
    if (!current || (Date.parse(evidence.at) || 0) < (Date.parse(current.at) || 0)) {
      evidenceByVersionId.set(id, evidence);
    }
  };

  collection.answerKeys.forEach((key) => {
    addEvidence(key.spotVersionId, key.createdAt, key.refreshJobId);
  });
  collection.refreshJobs.forEach((job) => {
    const candidateIds = Array.isArray(job.candidateSpotVersionIds)
      ? job.candidateSpotVersionIds : [];
    const cursor = Math.max(0, Math.min(candidateIds.length, Math.trunc(Number(job.cursor) || 0)));
    candidateIds.slice(0, cursor).forEach((spotVersionId) => {
      addEvidence(spotVersionId, job.startedAt || job.createdAt, job.id);
    });
    (job.inFlight?.spotVersionIds || []).forEach((spotVersionId) => {
      addEvidence(spotVersionId, job.inFlight.startedAt || job.startedAt || job.createdAt, job.id);
    });
  });

  let changed = false;
  evidenceByVersionId.forEach((evidence, spotVersionId) => {
    const spot = spotsByVersionId.get(spotVersionId);
    if (spot.aiFirstSentAt) return;
    spot.aiFirstSentAt = evidence.at;
    if (evidence.jobId) spot.aiFirstSentJobId = evidence.jobId;
    changed = true;
  });
  return changed;
};

const createStoredSpot = (candidate, source, now) => ({
  ...clone(candidate),
  versionId: makeVersionId(candidate.id, source.fingerprint),
  sourceFingerprint: source.fingerprint,
  playedAt: source.playedAt,
  gameType: source.gameType,
  historicalResult: clone(source.historicalResult),
  createdAt: now,
  lastSeenAt: now,
  sourceStatus: 'current',
  readiness: 'pending_key',
  currentAnswerKeyId: null,
  aiFirstSentAt: null,
  aiFirstSentJobId: null,
  active: false,
  archivedAt: null,
  archiveReason: null,
});

const scanCollection = (collection, sources, {
  datasetRevision, now, selectionLimit, rebuildSelection = false,
}) => {
  if (rebuildSelection && collection.refreshJobs.some(resumableJob)) {
    fail('TRAINING_SELECTION_REBUILD_BLOCKED', 'Nie można przebudować zestawu podczas zadania AI możliwego do wznowienia.');
  }
  const normalizedSources = sources.map(normalizeSource);
  const uniqueSources = new Map();
  normalizedSources.forEach((source) => {
    if (uniqueSources.has(source.handId)) {
      fail('TRAINING_SOURCE_DUPLICATE', `Skan zawiera duplikat rozdania #${source.handId}.`);
    }
    uniqueSources.set(source.handId, source);
  });

  const counts = {
    total: uniqueSources.size,
    new: 0,
    changed: 0,
    restored: 0,
    unchanged: 0,
    removed: 0,
    accepted: 0,
    rejected: 0,
    spotsAdded: 0,
  };
  const previousSources = collection.scanState.sources;
  const reintroducedHandIds = new Set();

  Object.entries(previousSources).forEach(([handId, previous]) => {
    if (uniqueSources.has(handId) || previous.status === 'removed' || previous.status === 'excluded') return;
    markHandVersionsInactive(collection, handId, 'removed', now);
    previousSources[handId] = { ...previous, status: 'removed', removedAt: now, lastSeenAt: previous.lastSeenAt || null };
    collection.scanState.sourceHistory.push({ handId, fingerprint: previous.fingerprint, status: 'removed', at: now });
    counts.removed += 1;
  });
  for (const source of uniqueSources.values()) {
    const previous = previousSources[source.handId];
    if (isTrainingAuditExcluded(collection.auditState, source)) {
      previousSources[source.handId] = {
        ...previous,
        fingerprint: source.fingerprint,
        gameType: source.gameType,
        playedAt: source.playedAt,
        status: 'excluded',
        rejection: null,
        spotVersionIds: [],
        scannedAt: now,
        lastSeenAt: now,
        excludedAt: previous?.excludedAt || now,
      };
      counts.unchanged += 1;
      continue;
    }
    if (previous?.status === 'excluded' && previous.fingerprint !== source.fingerprint) {
      reintroducedHandIds.add(source.handId);
    }
    const unchanged = previous && previous.status !== 'removed' && previous.fingerprint === source.fingerprint;
    const existingSourceSpots = collection.spots.filter((spot) => (
      spot.handId === source.handId && spot.sourceFingerprint === source.fingerprint
    ));
    if (unchanged) {
      existingSourceSpots.forEach((spot) => {
        spot.sourceStatus = 'current';
        spot.archivedAt = null;
        spot.archiveReason = null;
        spot.lastSeenAt = now;
        spot.historicalResult = clone(source.historicalResult);
      });
      const extraction = extractTrainingSpots(source);
      if (extraction.status === 'rejected') {
        previousSources[source.handId] = {
          ...previous,
          status: 'rejected',
          rejection: clone(extraction.rejection),
          spotVersionIds: [],
          scannedAt: now,
          lastSeenAt: now,
        };
        counts.unchanged += 1;
        counts.rejected += 1;
        continue;
      }
      const candidates = Object.values(classifyTrainingSpots(extraction.spots)).flat();
      const existingVersionIds = new Set(existingSourceSpots.map(({ versionId }) => versionId));
      const storedSpots = candidates
        .filter((candidate) => !existingVersionIds.has(makeVersionId(candidate.id, source.fingerprint)))
        .map((candidate) => createStoredSpot(candidate, source, now));
      collection.spots.push(...storedSpots);
      previousSources[source.handId] = {
        ...previous,
        fingerprint: source.fingerprint,
        gameType: source.gameType,
        playedAt: source.playedAt,
        status: 'current',
        rejection: null,
        spotVersionIds: candidates.map((candidate) => makeVersionId(candidate.id, source.fingerprint)),
        scannedAt: now,
        lastSeenAt: now,
      };
      counts.unchanged += 1;
      if (storedSpots.length > 0) {
        counts.accepted += 1;
        counts.spotsAdded += storedSpots.length;
      }
      continue;
    }

    if (previous && previous.status !== 'removed' && !unchanged) {
      markHandVersionsInactive(collection, source.handId, 'changed', now);
      collection.scanState.sourceHistory.push({
        handId: source.handId,
        fingerprint: previous.fingerprint,
        status: 'changed',
        replacedBy: source.fingerprint,
        at: now,
      });
      counts.changed += 1;
    } else if (previous?.status === 'removed') {
      counts.restored += 1;
    } else if (!unchanged) {
      counts.new += 1;
    }

    if (!rebuildSelection) restoreExistingVersions(collection, source, now);

    const extraction = extractTrainingSpots(source);
    if (extraction.status === 'rejected') {
      previousSources[source.handId] = {
        fingerprint: source.fingerprint,
        gameType: source.gameType,
        playedAt: source.playedAt,
        status: 'rejected',
        rejection: clone(extraction.rejection),
        spotVersionIds: [],
        scannedAt: now,
        lastSeenAt: now,
      };
      counts.rejected += 1;
      continue;
    }

    const pools = classifyTrainingSpots(extraction.spots);
    const candidates = Object.values(pools).flat();
    const existingVersionIds = new Set(collection.spots
      .filter((spot) => spot.handId === source.handId && spot.sourceFingerprint === source.fingerprint)
      .map(({ versionId }) => versionId));
    const storedSpots = candidates
      .filter((candidate) => !existingVersionIds.has(makeVersionId(candidate.id, source.fingerprint)))
      .map((candidate) => createStoredSpot(candidate, source, now));
    collection.spots.push(...storedSpots);
    previousSources[source.handId] = {
      fingerprint: source.fingerprint,
      gameType: source.gameType,
      playedAt: source.playedAt,
      status: 'current',
      rejection: null,
      spotVersionIds: candidates.map((candidate) => makeVersionId(candidate.id, source.fingerprint)),
      scannedAt: now,
      lastSeenAt: now,
    };
    counts.accepted += 1;
    counts.spotsAdded += storedSpots.length;
  }

  selectCollectionSpots(collection, now, {
    rebuildSelection,
    selectionLimit,
    reintroducedHandIds,
  });
  recomputeActivePools(collection);
  collection.scanState.lastScannedAt = now;
  collection.scanState.datasetRevision = datasetRevision || null;
  collection.scanState.lastResult = clone(counts);
  return counts;
};

const saveKeys = (collection, keys, now) => {
  if (!Array.isArray(keys)) fail('TRAINING_KEYS_INVALID', 'Klucze odpowiedzi muszą być tablicą.');
  const spotsByVersion = new Map(collection.spots.map((spot) => [spot.versionId, spot]));
  const existingById = new Map(collection.answerKeys.map((key) => [key.id, key]));
  let added = 0;
  keys.forEach((candidate) => {
    if (!isObject(candidate)) fail('TRAINING_KEYS_INVALID', 'Klucz odpowiedzi ma nieprawidłowy format.');
    const spotVersionId = asString(candidate.spotVersionId);
    if (!spotsByVersion.has(spotVersionId)) {
      fail('TRAINING_SPOT_NOT_FOUND', `Nie znaleziono wersji spotu ${spotVersionId}.`);
    }
    const id = asString(candidate.id) || randomUUID();
    const existing = existingById.get(id);
    const normalized = {
      ...clone(candidate),
      id,
      spotVersionId,
      contractVersion: Number.isInteger(candidate.contractVersion)
        ? candidate.contractVersion
        : TRAINING_ANSWER_KEY_CONTRACT_VERSION,
      createdAt: candidate.createdAt || existing?.createdAt || now,
    };
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(normalized)) {
        fail('TRAINING_KEY_CONFLICT', `Klucz ${id} już istnieje z inną treścią.`);
      }
      return;
    }
    collection.answerKeys.push(normalized);
    existingById.set(id, normalized);
    const spot = spotsByVersion.get(spotVersionId);
    if (!spot.aiFirstSentAt) {
      spot.aiFirstSentAt = normalized.createdAt;
      if (normalized.refreshJobId) spot.aiFirstSentJobId = normalized.refreshJobId;
    }
    added += 1;
  });
  recomputeActivePools(collection);
  return { added, total: collection.answerKeys.length };
};

const upsertById = (records, candidate, label, now) => {
  if (!isObject(candidate) || !asString(candidate.id)) {
    fail('TRAINING_HISTORY_INVALID', `${label} wymaga identyfikatora.`);
  }
  const value = { ...clone(candidate), updatedAt: now };
  const index = records.findIndex(({ id }) => id === value.id);
  if (index < 0) records.push({ ...value, createdAt: value.createdAt || now });
  else records[index] = { ...records[index], ...value, createdAt: records[index].createdAt || now };
  return clone(index < 0 ? records.at(-1) : records[index]);
};

const markRefreshJobSpotsAsAiSent = (collection, job, now) => {
  const spotsByVersionId = new Map(collection.spots.map((spot) => [spot.versionId, spot]));
  (job.inFlight?.spotVersionIds || []).forEach((spotVersionId) => {
    const spot = spotsByVersionId.get(spotVersionId);
    if (!spot?.aiFirstSentAt) {
      spot.aiFirstSentAt = now;
      spot.aiFirstSentJobId = job.id;
    }
  });
};

export const createTrainingRepository = ({
  dataDirectory,
  activePoolLimit = DEFAULT_ACTIVE_POOL_LIMIT,
  clock = () => new Date(),
  auditExclusions = DEFAULT_TRAINING_AUDIT_EXCLUSIONS,
} = {}) => {
  getCollectionPath(dataDirectory);
  if (!Number.isInteger(activePoolLimit) || activePoolLimit < 1) {
    fail('TRAINING_ACTIVE_LIMIT_INVALID', 'Limit aktywnej puli musi być dodatnią liczbą całkowitą.');
  }
  let state = null;
  let operation = Promise.resolve();
  const now = () => clock().toISOString();
  const withLock = (task) => {
    const next = operation.then(task, task);
    operation = next.catch(() => {});
    return next;
  };
  const load = async () => {
    if (!state) {
      await cleanupTrainingTemporaryFiles(dataDirectory, { now: Date.now() });
      state = await readTrainingCollection(dataDirectory);
      const migrated = clone(state);
      const timestamp = now();
      let changed = migrateAiFirstSentMarkers(migrated, timestamp);
      changed = migrateTrainingAudit(migrated, timestamp, auditExclusions) || changed;
      changed = migrateAnswerKeyContract(migrated, timestamp) || changed;
      const previousPoolState = JSON.stringify(migrated.spots.map((spot) => ({
        versionId: spot.versionId,
        active: spot.active,
        readiness: spot.readiness,
        currentAnswerKeyId: spot.currentAnswerKeyId,
      })));
      recomputeActivePools(migrated);
      changed = changed || previousPoolState !== JSON.stringify(migrated.spots.map((spot) => ({
        versionId: spot.versionId,
        active: spot.active,
        readiness: spot.readiness,
        currentAnswerKeyId: spot.currentAnswerKeyId,
      })));
      // Collections written before diverse_recent_v1 have no selected IDs and
      // may contain a legacy refresh job with an unlimited candidate list.
      // Such a job cannot be resumed safely under the current paid-work cap.
      if (state.spots.length > 0 && state.selectionState.selectedAt === null) {
        const timestamp = now();
        migrated.refreshJobs.forEach((job) => {
          if (Number(job.candidateCount || 0) <= MAX_LEGACY_REFRESH_CANDIDATES) return;
          if (!resumableJob(job) && job.status === 'superseded'
            && !(job.errors || []).some(({ code }) => code === 'TRAINING_REFRESH_SELECTION_SUPERSEDED')) {
            job.errors = [...(job.errors || []), {
              code: 'TRAINING_REFRESH_SELECTION_SUPERSEDED',
              message: 'Zadanie utworzone przed limitem selekcji nie może zostać wznowione po migracji.',
              spotVersionIds: [],
            }];
            return;
          }
          if (!resumableJob(job)) return;
          job.status = 'superseded';
          job.stopRequested = false;
          job.inFlight = null;
          job.finishedAt = timestamp;
          job.errors = [...(job.errors || []), {
            code: 'TRAINING_REFRESH_SELECTION_SUPERSEDED',
            message: 'Zadanie utworzone przed limitem selekcji zostało bezpiecznie zakończone. Uruchom nową analizę wybranego zestawu.',
            spotVersionIds: [],
          }];
        });
        selectCollectionSpots(migrated, timestamp, {
          selectionLimit: activePoolLimit,
        });
        recomputeActivePools(migrated);
        changed = true;
      }
      if (changed) {
        migrated.revision = state.revision + 1;
        migrated.updatedAt = now();
        state = await writeTrainingCollection(migrated, dataDirectory);
      }
    }
    return state;
  };
  const commit = (mutator) => withLock(async () => {
    const current = await load();
    const next = clone(current);
    const timestamp = now();
    const result = await mutator(next, timestamp);
    next.revision = current.revision + 1;
    next.updatedAt = timestamp;
    state = await writeTrainingCollection(next, dataDirectory);
    return { collection: clone(state), result: clone(result) };
  });

  return {
    getSnapshot: () => withLock(async () => clone(await load())),
    transact: (mutator) => {
      if (typeof mutator !== 'function') {
        fail('TRAINING_TRANSACTION_INVALID', 'Transakcja treningowa wymaga funkcji modyfikującej.');
      }
      return commit(mutator);
    },
    scanCanonicalHands: (sources, options = {}) => commit((collection, timestamp) => (
      scanCollection(collection, Array.isArray(sources) ? sources : [], {
        datasetRevision: options.datasetRevision,
        now: timestamp,
        selectionLimit: activePoolLimit,
        rebuildSelection: Boolean(options.rebuildSelection),
      })
    )),
    saveAnswerKeys: (keys) => commit((collection, timestamp) => (
      saveKeys(collection, keys, timestamp)
    )),
    saveRefreshJob: (job) => commit((collection, timestamp) => (
      (markRefreshJobSpotsAsAiSent(collection, job, timestamp),
      upsertById(collection.refreshJobs, job, 'Zadanie odświeżania', timestamp)
    ))),
    saveAnswerKeyBatch: (keys, job) => commit((collection, timestamp) => ({
      keys: saveKeys(collection, keys, timestamp),
      job: upsertById(collection.refreshJobs, job, 'Zadanie odświeżania', timestamp),
    })),
    saveSession: (session) => commit((collection, timestamp) => (
      upsertById(collection.sessions, session, 'Sesja', timestamp)
    )),
    saveAttempt: (attempt) => commit((collection, timestamp) => (
      upsertById(collection.attempts, attempt, 'Próba', timestamp)
    )),
    getActiveSpots: (filters = {}) => withLock(async () => {
      const collection = await load();
      return clone(collection.spots.filter((spot) => spot.active
        && (!filters.exerciseType || spot.exerciseType === filters.exerciseType)
        && (!filters.gameType || spot.gameType === filters.gameType)));
    }),
  };
};
