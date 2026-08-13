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
import { extractTrainingSpots, TRAINING_EXTRACTOR_VERSION } from './spotExtractor.js';
import {
  DEFAULT_SELECTION_LIMIT,
  getTrainingSpotAiEligibilityError,
  isTrainingSpotAiEligible,
  selectDiverseRecentSpots,
  TRAINING_SELECTION_STRATEGY,
} from './spotSelection.js';
import { classifyHeroHand } from './heroHandClassifier.js';
import {
  createTrainingDatabase,
  getTrainingDatabasePath,
  TRAINING_DATABASE_FILENAME,
  TRAINING_MIGRATION_BACKUP_PATTERN,
} from './trainingDatabase.js';
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
      .map((spot) => {
        const localValidationFingerprint = getLocalValidationFingerprint(spot);
        const hasFreshLocalValidation = spot.localValidationFingerprint === localValidationFingerprint
          && typeof spot.localValid === 'boolean';
        const localValidationError = hasFreshLocalValidation
          ? (spot.localValidationError || null)
          : getTrainingSpotAiEligibilityError({
            ...spot,
            localValid: undefined,
            localValidationError: undefined,
          });
        return {
          ...spot,
          aiFirstSentAt: typeof spot.aiFirstSentAt === 'string' ? spot.aiFirstSentAt : null,
          aiFirstSentJobId: typeof spot.aiFirstSentJobId === 'string' ? spot.aiFirstSentJobId : null,
          localValidationVersion: TRAINING_EXTRACTOR_VERSION,
          localValid: localValidationError === null,
          localValidationError,
          localValidationFingerprint,
          ...(isObject(spot.question) ? {
            decisionCardFacts: computeDecisionCardFacts({
              heroCards: spot.question.heroCards,
              board: spot.question.board,
            }),
          } : {}),
        };
      }),
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

const getLocalValidationFingerprint = (spot) => createHash('sha256').update(JSON.stringify({
  versionId: spot?.versionId,
  exerciseType: spot?.exerciseType,
  gameType: spot?.gameType,
  street: spot?.street,
  stage: spot?.stage,
  scenario: spot?.scenario,
  usesHistoricalLine: spot?.usesHistoricalLine,
  continuationNotice: spot?.continuationNotice,
  actionByCategory: spot?.actionByCategory,
  question: spot?.question,
  answerOptions: spot?.answerOptions,
})).digest('hex');

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
    extractorVersion: TRAINING_EXTRACTOR_VERSION,
    isRebuy: Boolean(source?.isRebuy || hand.isRebuy),
    historicalResult: source?.historicalResult ?? hand.historicalResult ?? null,
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
  locallyRejected: spots.filter((spot) => spot.localValid === false
    || (spot.localValid !== true && getTrainingSpotAiEligibilityError(spot))).length,
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

const createStoredSpot = (candidate, source, now) => {
  const versionId = makeVersionId(candidate.id, source.fingerprint);
  const localValidationError = getTrainingSpotAiEligibilityError({
    ...candidate,
    versionId,
    sourceStatus: 'current',
  });
  return {
    ...clone(candidate),
    versionId,
    sourceFingerprint: source.fingerprint,
    playedAt: source.playedAt,
    gameType: source.gameType,
    historicalResult: clone(source.historicalResult),
    createdAt: now,
    lastSeenAt: now,
    sourceStatus: 'current',
    readiness: 'pending_key',
    localValidationVersion: TRAINING_EXTRACTOR_VERSION,
    localValid: localValidationError === null,
    localValidationError,
    localValidationFingerprint: getLocalValidationFingerprint({
      ...candidate,
      versionId,
      sourceStatus: 'current',
    }),
    currentAnswerKeyId: null,
    aiFirstSentAt: null,
    aiFirstSentJobId: null,
    active: false,
    archivedAt: null,
    archiveReason: null,
  };
};

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
        extractorVersion: source.extractorVersion,
        datasetRevision: datasetRevision || null,
        expectedSpotCount: previous?.expectedSpotCount || 0,
        observedSpotCount: previous?.observedSpotCount || 0,
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
        spot.historicalResult = clone(spot.historicalResult);
      });
      const canReuseExtraction = Number(previous.extractorVersion) === TRAINING_EXTRACTOR_VERSION
        && Number(previous.expectedSpotCount) === existingSourceSpots.length
        && Number(previous.observedSpotCount ?? existingSourceSpots.length) === existingSourceSpots.length
        && Array.isArray(previous.spotVersionIds)
        && previous.spotVersionIds.length === existingSourceSpots.length
        && previous.spotVersionIds.every((versionId) => existingSourceSpots.some((spot) => spot.versionId === versionId));
      if (canReuseExtraction) {
        previousSources[source.handId] = {
          ...previous,
          extractorVersion: source.extractorVersion,
          datasetRevision: datasetRevision || null,
          expectedSpotCount: existingSourceSpots.length,
          observedSpotCount: existingSourceSpots.length,
          spotVersionIds: existingSourceSpots.map(({ versionId }) => versionId),
          scannedAt: now,
          lastSeenAt: now,
        };
        counts.unchanged += 1;
        continue;
      }
      const sourceForExtraction = {
        ...source,
        historicalResult: source.historicalResult || getHistoricalResult(source.rawText),
      };
      const extraction = extractTrainingSpots(sourceForExtraction);
      if (extraction.status === 'rejected') {
        previousSources[source.handId] = {
          ...previous,
          status: 'rejected',
          extractorVersion: source.extractorVersion,
          datasetRevision: datasetRevision || null,
          expectedSpotCount: 0,
          observedSpotCount: 0,
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
        .map((candidate) => createStoredSpot(candidate, sourceForExtraction, now));
      collection.spots.push(...storedSpots);
      previousSources[source.handId] = {
        ...previous,
        fingerprint: source.fingerprint,
        gameType: source.gameType,
        playedAt: source.playedAt,
        status: 'current',
        extractorVersion: source.extractorVersion,
        datasetRevision: datasetRevision || null,
        expectedSpotCount: candidates.length,
        observedSpotCount: candidates.length,
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

    const sourceForExtraction = {
      ...source,
      historicalResult: source.historicalResult || getHistoricalResult(source.rawText),
    };
    const extraction = extractTrainingSpots(sourceForExtraction);
    if (extraction.status === 'rejected') {
      previousSources[source.handId] = {
        fingerprint: source.fingerprint,
        gameType: source.gameType,
        playedAt: source.playedAt,
        status: 'rejected',
        extractorVersion: source.extractorVersion,
        datasetRevision: datasetRevision || null,
        expectedSpotCount: 0,
        observedSpotCount: 0,
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
      .map((candidate) => createStoredSpot(candidate, sourceForExtraction, now));
    collection.spots.push(...storedSpots);
    previousSources[source.handId] = {
      fingerprint: source.fingerprint,
      gameType: source.gameType,
      playedAt: source.playedAt,
      status: 'current',
      extractorVersion: source.extractorVersion,
      datasetRevision: datasetRevision || null,
      expectedSpotCount: candidates.length,
      observedSpotCount: candidates.length,
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

export const createLegacyTrainingRepository = ({
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

const jsonText = (value, fallback = null) => {
  const candidate = value === undefined ? fallback : value;
  return JSON.stringify(candidate === undefined ? null : candidate);
};

const parseStoredJson = (value, fallback = null) => {
  if (typeof value !== 'string' || value.length === 0) return clone(fallback);
  try {
    return JSON.parse(value);
  } catch {
    return clone(fallback);
  }
};

const boolToSql = (value) => (value === true || value === 1 ? 1 : 0);
const sqlToBool = (value) => Number(value) === 1;
const nullableNumber = (value) => (
  value === null || value === undefined || value === ''
    ? null
    : (Number.isFinite(Number(value)) ? Number(value) : null)
);
const nullableString = (value) => (value === null || value === undefined ? null : String(value));
const storedSpotId = (spot) => asString(spot.id) || asString(spot.versionId).split('@')[0] || asString(spot.versionId);

const rowToTrainingSpot = (row) => {
  const payload = parseStoredJson(row.payload_json, {});
  return {
    ...payload,
    id: row.spot_id,
    versionId: row.version_id,
    handId: row.hand_id,
    sourceFingerprint: row.source_fingerprint,
    exerciseType: row.exercise_type,
    gameType: row.game_type,
    street: row.street,
    stage: row.stage,
    scenario: row.scenario,
    episodeId: row.episode_id,
    sequenceIndex: row.sequence_index,
    sequenceLength: row.sequence_length,
    usesHistoricalLine: sqlToBool(row.uses_historical_line),
    continuationNotice: row.continuation_notice,
    sourceStatus: row.source_status,
    readiness: row.readiness,
    active: sqlToBool(row.active),
    localValidationVersion: row.local_validation_version,
    localValid: sqlToBool(row.local_valid),
    localValidationError: row.local_validation_error,
    currentAnswerKeyId: row.current_answer_key_id,
    aiFirstSentAt: row.ai_first_sent_at,
    aiFirstSentJobId: row.ai_first_sent_job_id,
    question: parseStoredJson(row.question_json, payload.question || {}),
    answerOptions: parseStoredJson(row.answer_options_json, payload.answerOptions || []),
    decisionCardFacts: parseStoredJson(row.decision_card_facts_json, payload.decisionCardFacts || null),
    historicalAnswer: parseStoredJson(row.historical_answer_json, payload.historicalAnswer || null),
    historicalResult: parseStoredJson(row.historical_result_json, payload.historicalResult || null),
    playedAt: row.played_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
    archivedAt: row.archived_at,
    archiveReason: row.archive_reason,
  };
};

const rowToAnswerKey = (row) => {
  const payload = parseStoredJson(row.payload_json, {});
  const value = {
    ...payload,
    id: row.id,
    spotVersionId: row.spot_version_id,
    contractVersion: row.contract_version,
    status: row.status,
    confidence: row.confidence,
    localFactsValid: row.local_facts_valid === null ? null : sqlToBool(row.local_facts_valid),
    factsValidationVersion: row.facts_validation_version,
    preferredAnswer: row.preferred_answer,
    createdAt: row.created_at,
  };
  if (row.historical_only === 1 || Object.hasOwn(payload, 'historicalOnly')) value.historicalOnly = sqlToBool(row.historical_only);
  if (row.hero_hand_json !== null || Object.hasOwn(payload, 'heroHand')) {
    value.heroHand = parseStoredJson(row.hero_hand_json, payload.heroHand || null);
  }
  if (row.decision_card_facts_json !== null || Object.hasOwn(payload, 'decisionCardFacts')) {
    value.decisionCardFacts = parseStoredJson(row.decision_card_facts_json, payload.decisionCardFacts || null);
  }
  if (row.acceptable_alternatives_json !== '[]' || Object.hasOwn(payload, 'acceptableAlternatives')) {
    value.acceptableAlternatives = parseStoredJson(row.acceptable_alternatives_json, payload.acceptableAlternatives || []);
  }
  if (row.suggested_sizing_json !== null || Object.hasOwn(payload, 'suggestedSizing')) {
    value.suggestedSizing = parseStoredJson(row.suggested_sizing_json, payload.suggestedSizing || null);
  }
  if (row.model_json !== null || Object.hasOwn(payload, 'model')) {
    value.model = parseStoredJson(row.model_json, payload.model || null);
  }
  if (row.errors_json !== '[]' || Object.hasOwn(payload, 'errors')) {
    value.errors = parseStoredJson(row.errors_json, payload.errors || []);
  }
  if (row.rationale !== null || Object.hasOwn(payload, 'rationale')) value.rationale = row.rationale;
  if (row.blockers_equity !== null || Object.hasOwn(payload, 'blockersEquity')) value.blockersEquity = row.blockers_equity;
  if (row.opponent_range !== null || Object.hasOwn(payload, 'opponentRange')) value.opponentRange = row.opponent_range;
  if (row.refresh_job_id !== null || Object.hasOwn(payload, 'refreshJobId')) value.refreshJobId = row.refresh_job_id;
  if (row.updated_at !== null || Object.hasOwn(payload, 'updatedAt')) value.updatedAt = row.updated_at;
  if (row.archived_at !== null || Object.hasOwn(payload, 'archivedAt')) value.archivedAt = row.archived_at;
  if (row.archive_reason !== null || Object.hasOwn(payload, 'archiveReason')) value.archiveReason = row.archive_reason;
  return value;
};

const rowToRefreshJob = (row, candidateSpotVersionIds) => {
  const payload = parseStoredJson(row.payload_json, {});
  return {
    ...payload,
    id: row.id,
    status: row.status,
    modelId: row.model_id,
    contractVersion: row.contract_version,
    batchSize: row.batch_size,
    sampleSize: row.sample_size,
    candidateSpotVersionIds: [...candidateSpotVersionIds],
    candidateCount: row.candidate_count,
    estimatedRequests: row.estimated_requests,
    cursor: row.cursor,
    attemptedRequests: row.attempted_requests,
    successfulRequests: row.successful_requests,
    recoveryCount: Number(row.recovery_count ?? payload.recoveryCount ?? 0) || 0,
    lastRecoveredAt: row.last_recovered_at ?? payload.lastRecoveredAt ?? null,
    processedSpotCount: row.processed_spot_count,
    skippedSpotCount: row.skipped_spot_count,
    savedKeyCount: row.saved_key_count,
    readyKeyCount: row.ready_key_count,
    reviewKeyCount: row.review_key_count,
    invalidKeyCount: row.invalid_key_count,
    unknownResultCount: row.unknown_result_count,
    stopRequested: sqlToBool(row.stop_requested),
    inFlight: parseStoredJson(row.in_flight_json, payload.inFlight || null),
    errors: parseStoredJson(row.errors_json, payload.errors || []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    resumedAt: row.resumed_at,
    stoppedAt: row.stopped_at,
    finishedAt: row.finished_at,
  };
};

const rowToRefreshJobEvent = (row) => ({
  id: Number(row.id),
  jobId: row.job_id || null,
  eventType: row.event_type,
  instanceId: row.instance_id || null,
  status: row.status || null,
  cursor: nullableNumber(row.cursor),
  batchSize: nullableNumber(row.batch_size),
  spotCount: Number(row.spot_count) || 0,
  attemptedRequests: nullableNumber(row.attempted_requests),
  successfulRequests: nullableNumber(row.successful_requests),
  inFlightSpotCount: Number(row.in_flight_spot_count) || 0,
  details: parseStoredJson(row.details_json, {}),
  createdAt: row.created_at,
});

const rowToTrainingSession = (row, availableSpotVersionIds = [], answeredSpotVersionIds = [], answeredCount = null) => {
  const payload = parseStoredJson(row.metadata_json, {});
  const normalizedAnswered = [...answeredSpotVersionIds];
  return {
    ...payload,
    id: row.id,
    exerciseType: row.exercise_type,
    gameType: row.game_type,
    requestedSize: row.requested_size === 'all' ? 'all' : Number(row.requested_size),
    targetSize: row.target_size,
    status: row.status,
    availableSpotVersionIds: [...availableSpotVersionIds],
    answeredSpotVersionIds: normalizedAnswered,
    answeredCount: Number.isInteger(answeredCount) ? answeredCount : normalizedAnswered.length,
    currentPosition: row.current_position,
    currentSpotVersionId: row.current_spot_version_id,
    lastSpotVersionId: row.last_spot_version_id,
    score: {
      correct: row.score_correct,
      acceptable: row.score_acceptable,
      incorrect: row.score_incorrect,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    abandonedAt: row.abandoned_at,
  };
};

const rowToTrainingAttempt = (row) => ({
  id: row.id,
  sessionId: row.session_id,
  spotVersionId: row.spot_version_id,
  answerKeyId: row.answer_key_id,
  answer: row.answer,
  grade: row.grade,
  ...(row.feedback_json ? { feedback: parseStoredJson(row.feedback_json, null) } : {}),
  answeredAt: row.answered_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const rowToSource = (row, spotVersionIds) => ({
  fingerprint: row.fingerprint,
  gameType: row.game_type,
  playedAt: row.played_at,
  status: row.status,
  expectedSpotCount: row.expected_spot_count,
  observedSpotCount: row.observed_spot_count,
  extractorVersion: row.extractor_version,
  datasetRevision: row.dataset_revision,
  rejection: parseStoredJson(row.rejection_json, null),
  spotVersionIds: [...spotVersionIds],
  scannedAt: row.scanned_at,
  lastSeenAt: row.last_seen_at,
  ...(row.status === 'removed' ? { removedAt: row.updated_at } : {}),
  ...(row.status === 'excluded' ? { excludedAt: row.updated_at } : {}),
});

const rowToSourceHistory = (row) => ({
  handId: row.hand_id,
  fingerprint: row.fingerprint,
  status: row.status,
  ...(row.replaced_by_fingerprint ? { replacedBy: row.replaced_by_fingerprint } : {}),
  at: row.recorded_at,
  ...parseStoredJson(row.details_json, {}),
});

const getMetadataRow = (database) => database.prepare(
  'SELECT * FROM collection_metadata WHERE id = 1',
).get();

const getFullTrainingSnapshot = (database) => {
  const metadata = getMetadataRow(database);
  if (!metadata) return createEmptyTrainingCollection();
  const spotRows = database.prepare('SELECT * FROM spots ORDER BY rowid').all();
  const spots = spotRows.map(rowToTrainingSpot);
  const spotIdsBySource = new Map();
  spots.forEach((spot) => {
    const key = `${spot.handId}\u0000${spot.sourceFingerprint}`;
    const ids = spotIdsBySource.get(key) || [];
    ids.push(spot.versionId);
    spotIdsBySource.set(key, ids);
  });
  const sourceRows = database.prepare('SELECT * FROM sources ORDER BY rowid').all();
  const sources = Object.fromEntries(sourceRows.map((row) => [
    row.hand_id,
    rowToSource(row, spotIdsBySource.get(`${row.hand_id}\u0000${row.fingerprint}`) || []),
  ]));
  const answerKeys = database.prepare('SELECT * FROM answer_keys ORDER BY rowid').all().map(rowToAnswerKey);
  const jobSpotRows = database.prepare(
    'SELECT job_id, spot_version_id FROM refresh_job_spots ORDER BY job_id, position',
  ).all();
  const jobSpotIds = new Map();
  jobSpotRows.forEach((row) => {
    const ids = jobSpotIds.get(row.job_id) || [];
    ids.push(row.spot_version_id);
    jobSpotIds.set(row.job_id, ids);
  });
  const refreshJobs = database.prepare('SELECT * FROM refresh_jobs ORDER BY rowid').all()
    .map((row) => rowToRefreshJob(row, jobSpotIds.get(row.id) || []));
  const selectedSpotVersionIds = database.prepare(
    'SELECT spot_version_id FROM selected_spots WHERE active = 1 ORDER BY rowid',
  ).all().map(({ spot_version_id: spotVersionId }) => spotVersionId);
  const sessionSpotRows = database.prepare(
    'SELECT session_id, position, spot_version_id, status FROM session_spots ORDER BY session_id, position',
  ).all();
  const sessionSpots = new Map();
  sessionSpotRows.forEach((row) => {
    const value = sessionSpots.get(row.session_id) || { available: [], answered: [] };
    value.available.push(row.spot_version_id);
    if (row.status === 'answered') value.answered.push(row.spot_version_id);
    sessionSpots.set(row.session_id, value);
  });
  const attempts = database.prepare('SELECT * FROM attempts ORDER BY rowid').all().map(rowToTrainingAttempt);
  const answeredBySession = new Map();
  attempts.forEach((attempt) => {
    const ids = answeredBySession.get(attempt.sessionId) || [];
    if (!ids.includes(attempt.spotVersionId)) ids.push(attempt.spotVersionId);
    answeredBySession.set(attempt.sessionId, ids);
  });
  const sessions = database.prepare('SELECT * FROM sessions ORDER BY rowid').all().map((row) => {
    const relations = sessionSpots.get(row.id) || { available: [], answered: [] };
    const answered = [...new Set([
      ...relations.answered,
      ...(answeredBySession.get(row.id) || []),
    ])];
    return rowToTrainingSession(row, relations.available, answered);
  });
  const auditEntries = database.prepare('SELECT * FROM audit_exclusions ORDER BY rowid').all()
    .map((row) => ({
      handId: row.hand_id,
      fingerprint: row.fingerprint,
      reason: row.reason,
      excludedAt: row.excluded_at,
    }));
  const poolStats = parseStoredJson(metadata.selection_pool_stats_json, {});
  return {
    version: TRAINING_COLLECTION_VERSION,
    revision: metadata.revision,
    updatedAt: metadata.updated_at,
    spots,
    answerKeys,
    refreshJobs,
    sessions,
    attempts,
    selectionState: {
      strategy: metadata.selection_strategy,
      strategyVersion: metadata.selection_strategy_version,
      selectedAt: metadata.selected_at,
      limit: metadata.selection_limit,
      selectedSpotVersionIds,
      poolStats,
      replenishmentDisabled: sqlToBool(metadata.replenishment_disabled),
    },
    auditState: {
      version: 1,
      excludedHands: auditEntries,
      selectionFrozen: sqlToBool(metadata.selection_frozen),
    },
    scanState: {
      lastScannedAt: metadata.scan_last_scanned_at,
      datasetRevision: metadata.scan_dataset_revision,
      sources,
      sourceHistory: database.prepare('SELECT * FROM source_history ORDER BY rowid').all()
        .map(rowToSourceHistory),
      lastResult: parseStoredJson(metadata.scan_last_result_json, null),
    },
  };
};

const getScanStateData = (database) => {
  const metadata = getMetadataRow(database);
  if (!metadata) {
    return { datasetRevision: null, lastScannedAt: null, lastResult: null };
  }
  return {
    datasetRevision: metadata.scan_dataset_revision,
    lastScannedAt: metadata.scan_last_scanned_at,
    lastResult: parseStoredJson(metadata.scan_last_result_json, null),
  };
};

const getRefreshJobRows = (database, jobId = null) => {
  const params = jobId === null ? [] : [jobId];
  const rows = database.prepare(
    `SELECT * FROM refresh_jobs${jobId === null ? '' : ' WHERE id = ?'} ORDER BY rowid`,
  ).all(...params);
  const candidateRows = database.prepare(
    `SELECT job_id, spot_version_id FROM refresh_job_spots${jobId === null ? '' : ' WHERE job_id = ?'} ORDER BY job_id, position`,
  ).all(...params);
  const candidateIds = new Map();
  candidateRows.forEach((row) => {
    const ids = candidateIds.get(row.job_id) || [];
    ids.push(row.spot_version_id);
    candidateIds.set(row.job_id, ids);
  });
  return rows.map((row) => rowToRefreshJob(row, candidateIds.get(row.id) || []));
};

const getRefreshJobEventRows = (database, { jobId = null, limit = MAX_REFRESH_JOB_EVENTS } = {}) => {
  const normalizedLimit = Math.min(MAX_REFRESH_JOB_EVENTS, Math.max(1, Number.parseInt(limit, 10) || MAX_REFRESH_JOB_EVENTS));
  const normalizedJobId = asString(jobId);
  const rows = database.prepare(`
    SELECT * FROM refresh_job_events
    WHERE (? = '' OR job_id = ?)
    ORDER BY id DESC
    LIMIT ?
  `).all(normalizedJobId, normalizedJobId, normalizedLimit);
  return rows.reverse().map(rowToRefreshJobEvent);
};

const getSpotsByVersionIds = (database, versionIds) => {
  const ids = [...new Set((Array.isArray(versionIds) ? versionIds : []).map(asString).filter(Boolean))];
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const rows = database.prepare(
    `SELECT * FROM spots WHERE version_id IN (${placeholders})`,
  ).all(...ids);
  const byId = new Map(rows.map((row) => [row.version_id, rowToTrainingSpot(row)]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
};

const getRefreshEstimateData = (database, sampleSize) => {
  const normalizedSampleSize = Number.isInteger(sampleSize) ? sampleSize : DEFAULT_SELECTION_LIMIT;
  const eligibleRows = database.prepare(`
    SELECT s.*
    FROM spots s
    WHERE s.source_status = 'current'
      AND s.ai_first_sent_at IS NULL
      AND s.readiness = 'pending_key'
      AND s.local_valid = 1
      AND NOT EXISTS (
        SELECT 1 FROM audit_exclusions a
        WHERE a.hand_id = s.hand_id AND a.fingerprint = s.source_fingerprint
      )
    ORDER BY s.played_at DESC, s.rowid
    LIMIT ?
  `).all(normalizedSampleSize);
  const rejectedRows = database.prepare(`
    SELECT s.version_id
    FROM spots s
    WHERE s.source_status = 'current'
      AND s.ai_first_sent_at IS NULL
      AND s.readiness = 'pending_key'
      AND s.local_valid = 0
      AND NOT EXISTS (
        SELECT 1 FROM audit_exclusions a
        WHERE a.hand_id = s.hand_id AND a.fingerprint = s.source_fingerprint
      )
    ORDER BY s.rowid
  `).all();
  const spots = selectDiverseRecentSpots(
    eligibleRows.map(rowToTrainingSpot),
    { limit: normalizedSampleSize },
  );
  return {
    spots,
    locallyRejectedSpotVersionIds: rejectedRows.map(({ version_id: versionId }) => versionId),
  };
};

const getTrainingStatusData = (database, sampleSize) => {
  const metadata = getMetadataRow(database);
  const poolRows = database.prepare(`
    SELECT
      s.exercise_type,
      s.game_type,
      COUNT(*) AS current_count,
      SUM(CASE WHEN s.active = 1 THEN 1 ELSE 0 END) AS active_count,
      SUM(CASE WHEN s.local_valid = 0 THEN 1 ELSE 0 END) AS locally_rejected_count,
      SUM(CASE WHEN ss.spot_version_id IS NOT NULL THEN 1 ELSE 0 END) AS selected_count,
      SUM(CASE WHEN ss.spot_version_id IS NOT NULL AND s.readiness = 'ready' THEN 1 ELSE 0 END) AS ready_count,
      SUM(CASE WHEN ss.spot_version_id IS NOT NULL AND s.readiness = 'pending_key' THEN 1 ELSE 0 END) AS pending_count,
      SUM(CASE WHEN ss.spot_version_id IS NOT NULL AND s.readiness = 'review' THEN 1 ELSE 0 END) AS review_count
    FROM spots s
    LEFT JOIN selected_spots ss ON ss.spot_version_id = s.version_id AND ss.active = 1
    WHERE s.source_status = 'current'
    GROUP BY s.exercise_type, s.game_type
  `).all();
  const estimateData = getRefreshEstimateData(database, sampleSize);
  const selectedCount = database.prepare(
    'SELECT COUNT(*) AS count FROM selected_spots WHERE active = 1',
  ).get().count;
  const sourceCount = database.prepare('SELECT COUNT(*) AS count FROM sources').get().count;
  const rejectedSourceCount = database.prepare(
    "SELECT COUNT(*) AS count FROM sources WHERE status = 'rejected'",
  ).get().count;
  const sourceHistoryCount = database.prepare('SELECT COUNT(*) AS count FROM source_history').get().count;
  const reanalysisCount = database.prepare(
    "SELECT COUNT(*) AS count FROM spots WHERE source_status = 'current' AND readiness = 'review'",
  ).get().count;
  const sessionCount = database.prepare('SELECT COUNT(*) AS count FROM sessions').get().count;
  const activeSessionCount = database.prepare(
    "SELECT COUNT(*) AS count FROM sessions WHERE status = 'active'",
  ).get().count;
  const counts = {
    spots: database.prepare('SELECT COUNT(*) AS count FROM spots').get().count,
    answerKeys: database.prepare('SELECT COUNT(*) AS count FROM answer_keys').get().count,
    refreshJobs: database.prepare('SELECT COUNT(*) AS count FROM refresh_jobs').get().count,
    sessions: sessionCount,
    attempts: database.prepare('SELECT COUNT(*) AS count FROM attempts').get().count,
  };
  return {
    metadata,
    poolRows,
    selectedCount,
    sourceCount,
    rejectedSourceCount,
    sourceHistoryCount,
    reanalysisCount,
    sessionCount,
    activeSessionCount,
    counts,
    refreshJobs: getRefreshJobRows(database),
    estimateData,
  };
};

const getTrainingSessionContext = (database, sessionId) => {
  const row = database.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!row) return null;
  const relationRows = database.prepare(
    'SELECT spot_version_id, status FROM session_spots WHERE session_id = ? ORDER BY position',
  ).all(sessionId);
  const availableIds = relationRows.map(({ spot_version_id: spotVersionId }) => spotVersionId);
  const answeredIds = relationRows
    .filter(({ status }) => status === 'answered')
    .map(({ spot_version_id: spotVersionId }) => spotVersionId);
  const attempts = database.prepare(
    'SELECT * FROM attempts WHERE session_id = ? ORDER BY rowid',
  ).all(sessionId).map(rowToTrainingAttempt);
  const attemptedIds = attempts.map(({ spotVersionId }) => spotVersionId).filter(Boolean);
  const spots = getSpotsByVersionIds(database, [...new Set([
    ...availableIds,
    row.current_spot_version_id,
    row.last_spot_version_id,
    ...attemptedIds,
  ])]);
  const spotIds = spots.map(({ versionId }) => versionId);
  const placeholders = spotIds.map(() => '?').join(', ');
  const answerKeys = spotIds.length === 0 ? [] : database.prepare(
    `SELECT * FROM answer_keys WHERE spot_version_id IN (${placeholders}) ORDER BY rowid`,
  ).all(...spotIds).map(rowToAnswerKey);
  return {
    session: rowToTrainingSession(row, availableIds, [...new Set([...answeredIds, ...attemptedIds])]),
    spots,
    answerKeys,
    attempts,
  };
};

const getTrainingSessionSummary = (database, sessionId) => {
  const row = database.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!row) return null;
  const answeredCount = database.prepare(
    "SELECT COUNT(*) AS count FROM session_spots WHERE session_id = ? AND status = 'answered'",
  ).get(sessionId).count;
  return rowToTrainingSession(row, [], [], Number(answeredCount) || 0);
};

const getTrainingQuestionContext = (database, sessionId, timestamp = new Date().toISOString()) => {
  const initialSession = database.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!initialSession) return null;
  if (['completed', 'abandoned'].includes(initialSession.status)) {
    return {
      session: getTrainingSessionSummary(database, sessionId),
      spot: null,
      key: null,
    };
  }
  if (initialSession.current_spot_version_id) {
    const currentRelation = database.prepare(`
      SELECT position, spot_version_id, status
      FROM session_spots
      WHERE session_id = ? AND spot_version_id = ?
    `).get(sessionId, initialSession.current_spot_version_id);
    const currentSpot = currentRelation?.status === 'current'
      ? database.prepare(`
        SELECT * FROM spots
        WHERE version_id = ? AND source_status = 'current' AND readiness = 'ready'
          AND active = 1 AND current_answer_key_id IS NOT NULL
      `).get(currentRelation.spot_version_id)
      : null;
    const currentKey = currentSpot?.current_answer_key_id
      ? database.prepare('SELECT * FROM answer_keys WHERE id = ? AND spot_version_id = ?')
        .get(currentSpot.current_answer_key_id, currentSpot.version_id)
      : null;
    if (currentSpot && currentKey) {
      return {
        session: getTrainingSessionSummary(database, sessionId),
        spot: rowToTrainingSpot(currentSpot),
        key: rowToAnswerKey(currentKey),
      };
    }
  }
  database.exec('BEGIN IMMEDIATE;');
  try {
    let sessionRow = database.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!sessionRow) {
      database.exec('COMMIT;');
      return null;
    }
    let relation = sessionRow.current_spot_version_id
      ? database.prepare(`
        SELECT position, spot_version_id, status
        FROM session_spots
        WHERE session_id = ? AND spot_version_id = ?
      `).get(sessionId, sessionRow.current_spot_version_id)
      : null;
    let spotRow = null;
    let keyRow = null;
    const loadCandidate = (candidateRelation) => {
      if (!candidateRelation || !['current', 'pending'].includes(candidateRelation.status)) return false;
      const candidateSpot = database.prepare(`
        SELECT * FROM spots
        WHERE version_id = ?
          AND source_status = 'current'
          AND readiness = 'ready'
          AND active = 1
          AND current_answer_key_id IS NOT NULL
      `).get(candidateRelation.spot_version_id);
      if (!candidateSpot) return false;
      const candidateKey = database.prepare(
        'SELECT * FROM answer_keys WHERE id = ? AND spot_version_id = ?',
      ).get(candidateSpot.current_answer_key_id, candidateSpot.version_id);
      if (!candidateKey) return false;
      relation = candidateRelation;
      spotRow = candidateSpot;
      keyRow = candidateKey;
      return true;
    };

    if (!loadCandidate(relation)) {
      database.prepare(`
        UPDATE session_spots SET status = 'pending'
        WHERE session_id = ? AND status = 'current'
      `).run(sessionId);
      database.prepare(`
        UPDATE sessions SET current_position = NULL, current_spot_version_id = NULL, updated_at = ?
        WHERE id = ?
      `).run(timestamp, sessionId);
      relation = database.prepare(`
        SELECT position, spot_version_id, status
        FROM session_spots
        WHERE session_id = ? AND status = 'pending'
        ORDER BY position
        LIMIT 1
      `).get(sessionId);
      if (loadCandidate(relation)) {
        database.prepare(`
          UPDATE session_spots SET status = 'current'
          WHERE session_id = ? AND position = ?
        `).run(sessionId, relation.position);
        database.prepare(`
          UPDATE sessions SET current_position = ?, current_spot_version_id = ?, updated_at = ?
          WHERE id = ?
        `).run(relation.position, relation.spot_version_id, timestamp, sessionId);
      } else if (sessionRow.status === 'active') {
        database.prepare(`
          UPDATE sessions SET status = 'completed', completed_at = COALESCE(completed_at, ?), updated_at = ?
          WHERE id = ?
        `).run(timestamp, timestamp, sessionId);
      }
    }
    database.exec('COMMIT;');
    const session = getTrainingSessionSummary(database, sessionId);
    return {
      session,
      spot: spotRow ? rowToTrainingSpot(spotRow) : null,
      key: keyRow ? rowToAnswerKey(keyRow) : null,
    };
  } catch (error) {
    try { database.exec('ROLLBACK;'); } catch { /* preserve original error */ }
    throw error;
  }
};

const getTrainingAnswerContext = (database, sessionId, spotVersionId) => {
  const session = getTrainingSessionSummary(database, sessionId);
  if (!session) return null;
  const relation = database.prepare(`
    SELECT ss.status, s.*
    FROM session_spots ss
    JOIN spots s ON s.version_id = ss.spot_version_id
    WHERE ss.session_id = ? AND ss.spot_version_id = ?
  `).get(sessionId, spotVersionId);
  if (!relation) return { session, spot: null, key: null, relation: null };
  const key = relation.current_answer_key_id
    ? database.prepare('SELECT * FROM answer_keys WHERE id = ? AND spot_version_id = ?')
      .get(relation.current_answer_key_id, relation.version_id)
    : null;
  return {
    session,
    spot: rowToTrainingSpot(relation),
    key: key ? rowToAnswerKey(key) : null,
    relation: { status: relation.status },
  };
};

const saveTrainingSessionRow = (database, session, now) => {
  const available = [...new Set((session.availableSpotVersionIds || []).map(asString).filter(Boolean))];
  const answered = new Set((session.answeredSpotVersionIds || []).map(asString).filter(Boolean));
  const currentPosition = available.indexOf(session.currentSpotVersionId);
  database.prepare(`
    INSERT INTO sessions (
      id, exercise_type, game_type, requested_size, target_size, status, current_position,
      current_spot_version_id, last_spot_version_id, score_correct, score_acceptable,
      score_incorrect, metadata_json, created_at, updated_at, completed_at, abandoned_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      exercise_type = excluded.exercise_type,
      game_type = excluded.game_type,
      requested_size = excluded.requested_size,
      target_size = excluded.target_size,
      status = excluded.status,
      current_position = excluded.current_position,
      current_spot_version_id = excluded.current_spot_version_id,
      last_spot_version_id = excluded.last_spot_version_id,
      score_correct = excluded.score_correct,
      score_acceptable = excluded.score_acceptable,
      score_incorrect = excluded.score_incorrect,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at,
      completed_at = excluded.completed_at,
      abandoned_at = excluded.abandoned_at
  `).run(
    session.id,
    session.exerciseType || 'unknown',
    session.gameType || 'both',
    String(session.requestedSize ?? '20'),
    Number(session.targetSize) || 0,
    session.status || 'active',
    currentPosition >= 0 ? currentPosition : null,
    nullableString(session.currentSpotVersionId),
    nullableString(session.lastSpotVersionId),
    Number(session.score?.correct) || 0,
    Number(session.score?.acceptable) || 0,
    Number(session.score?.incorrect) || 0,
    jsonText(session),
    session.createdAt || now,
    session.updatedAt || now,
    nullableString(session.completedAt),
    nullableString(session.abandonedAt),
  );
  database.prepare('DELETE FROM session_spots WHERE session_id = ?').run(session.id);
  const insert = database.prepare(
    'INSERT INTO session_spots (session_id, position, spot_version_id, status, answered_at) VALUES (?, ?, ?, ?, ?)',
  );
  available.forEach((spotVersionId, position) => {
    const status = answered.has(spotVersionId)
      ? 'answered'
      : spotVersionId === session.currentSpotVersionId ? 'current' : 'pending';
    insert.run(session.id, position, spotVersionId, status, null);
  });
  return clone(session);
};

const saveTrainingAttemptRow = (database, attempt) => {
  const timestamp = attempt.answeredAt || attempt.createdAt || new Date().toISOString();
  database.prepare(`
    INSERT INTO attempts (
      id, session_id, spot_version_id, answer_key_id, answer, grade, feedback_json,
      answered_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      answer = excluded.answer,
      grade = excluded.grade,
      feedback_json = excluded.feedback_json,
      answered_at = excluded.answered_at,
      updated_at = excluded.updated_at
  `).run(
    attempt.id,
    nullableString(attempt.sessionId),
    nullableString(attempt.spotVersionId),
    nullableString(attempt.answerKeyId),
    nullableString(attempt.answer),
    nullableString(attempt.grade),
    attempt.feedback ? jsonText(attempt.feedback) : null,
    timestamp,
    attempt.createdAt || timestamp,
    nullableString(attempt.updatedAt),
  );
  return clone(attempt);
};

const saveTrainingAttemptAndAdvance = (database, attempt, sessionPatch, now) => {
  database.exec('BEGIN IMMEDIATE;');
  try {
    const sessionRow = database.prepare('SELECT * FROM sessions WHERE id = ?').get(attempt.sessionId);
    if (!sessionRow) {
      database.exec('COMMIT;');
      return { missing: true };
    }
    const duplicate = database.prepare(
      'SELECT 1 FROM attempts WHERE session_id = ? AND spot_version_id = ? LIMIT 1',
    ).get(attempt.sessionId, attempt.spotVersionId);
    if (duplicate) {
      database.exec('COMMIT;');
      return { duplicate: true, session: getTrainingSessionSummary(database, attempt.sessionId) };
    }
    if (sessionRow.status !== 'active' || sessionRow.current_spot_version_id !== attempt.spotVersionId) {
      database.exec('COMMIT;');
      return { mismatch: true, session: getTrainingSessionSummary(database, attempt.sessionId) };
    }
    const savedAttempt = saveTrainingAttemptRow(database, attempt);
    const score = sessionPatch.score || {};
    const metadata = parseStoredJson(sessionRow.metadata_json, {});
    const nextMetadata = {
      ...metadata,
      lastSpotVersionId: sessionPatch.lastSpotVersionId || attempt.spotVersionId,
      currentSpotVersionId: null,
      score: {
        correct: Number(score.correct) || 0,
        acceptable: Number(score.acceptable) || 0,
        incorrect: Number(score.incorrect) || 0,
      },
    };
    const relationUpdate = database.prepare(`
      UPDATE session_spots SET status = 'answered', answered_at = ?
      WHERE session_id = ? AND spot_version_id = ? AND status = 'current'
    `).run(attempt.answeredAt || now, attempt.sessionId, attempt.spotVersionId);
    if (Number(relationUpdate?.changes) !== 1) {
      throw new TrainingRepositoryError('TRAINING_SESSION_SPOT_NOT_CURRENT', 'Aktualny spot sesji zmieniĹ‚ siÄ™ przed zapisem odpowiedzi.');
    }
    database.prepare(`
      UPDATE sessions SET
        current_position = NULL,
        current_spot_version_id = NULL,
        last_spot_version_id = ?,
        score_correct = ?,
        score_acceptable = ?,
        score_incorrect = ?,
        status = ?,
        metadata_json = ?,
        updated_at = ?,
        completed_at = ?
      WHERE id = ?
    `).run(
      sessionPatch.lastSpotVersionId || attempt.spotVersionId,
      Number(score.correct) || 0,
      Number(score.acceptable) || 0,
      Number(score.incorrect) || 0,
      sessionPatch.status || 'active',
      jsonText(nextMetadata),
      sessionPatch.updatedAt || now,
      nullableString(sessionPatch.completedAt),
      attempt.sessionId,
    );
    bumpTrainingRevision(database, sessionPatch.updatedAt || now);
    database.exec('COMMIT;');
    return {
      attempt: savedAttempt,
      session: getTrainingSessionSummary(database, attempt.sessionId),
    };
  } catch (error) {
    try { database.exec('ROLLBACK;'); } catch { /* preserve original error */ }
    throw error;
  }
};

const bumpTrainingRevision = (database, timestamp) => {
  database.prepare(
    'UPDATE collection_metadata SET revision = revision + 1, updated_at = ? WHERE id = 1',
  ).run(timestamp);
};

const filterSql = (filters = {}, prefix = 's') => {
  const clauses = [];
  const params = [];
  if (filters.exerciseType) { clauses.push(`${prefix}.exercise_type = ?`); params.push(filters.exerciseType); }
  if (filters.gameType && filters.gameType !== 'both') { clauses.push(`${prefix}.game_type = ?`); params.push(filters.gameType); }
  return { clause: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params };
};

const getTrainingHistoryData = (database, filters, limit) => {
  const { clause, params } = filterSql(filters);
  const attemptRows = database.prepare(`
    SELECT a.*
    FROM attempts a
    JOIN spots s ON s.version_id = a.spot_version_id
    WHERE 1 = 1${clause}
    ORDER BY COALESCE(a.answered_at, a.created_at) DESC, a.rowid DESC
    LIMIT ?
  `).all(...params, limit);
  const totalAttempts = database.prepare(`
    SELECT COUNT(*) AS count
    FROM attempts a
    JOIN spots s ON s.version_id = a.spot_version_id
    WHERE 1 = 1${clause}
  `).get(...params).count;
  const attempts = attemptRows.map(rowToTrainingAttempt);
  const spotIds = [...new Set(attempts.map(({ spotVersionId }) => spotVersionId).filter(Boolean))];
  const spots = new Map(getSpotsByVersionIds(database, spotIds).map((spot) => [spot.versionId, spot]));
  const keyIds = [...new Set(attempts.map(({ answerKeyId }) => answerKeyId).filter(Boolean))];
  const keys = new Map();
  if (keyIds.length > 0) {
    const placeholders = keyIds.map(() => '?').join(', ');
    database.prepare(`SELECT * FROM answer_keys WHERE id IN (${placeholders})`).all(...keyIds)
      .map(rowToAnswerKey).forEach((key) => keys.set(key.id, key));
  }
  const sessionRows = database.prepare(`
    SELECT id FROM sessions
    WHERE 1 = 1${filters.exerciseType ? ' AND exercise_type = ?' : ''}
      ${filters.gameType && filters.gameType !== 'both' ? " AND (game_type = 'both' OR game_type = ?)" : ''}
    ORDER BY updated_at DESC, rowid DESC
  `).all(
    ...(filters.exerciseType ? [filters.exerciseType] : []),
    ...(filters.gameType && filters.gameType !== 'both' ? [filters.gameType] : []),
  );
  const sessions = sessionRows.map(({ id }) => getTrainingSessionContext(database, id)?.session).filter(Boolean);
  return { attempts, totalAttempts, spots: [...spots.values()], keys: [...keys.values()], sessions };
};

const getTrainingStatsRows = (database, filters) => {
  const { clause, params } = filterSql(filters);
  return database.prepare(`
    SELECT a.grade, s.exercise_type, s.game_type,
      json_extract(s.question_json, '$.heroPosition') AS hero_position,
      json_extract(s.question_json, '$.effectiveStackBb') AS effective_stack_bb
    FROM attempts a
    JOIN spots s ON s.version_id = a.spot_version_id
    WHERE 1 = 1${clause}
  `).all(...params);
};

const MAX_REFRESH_JOB_EVENTS = 2_000;

const normalizeRefreshJobEvent = (event = {}, now = new Date().toISOString()) => ({
  jobId: asString(event.jobId) || null,
  eventType: asString(event.eventType) || 'unknown',
  instanceId: asString(event.instanceId) || null,
  status: asString(event.status) || null,
  cursor: nullableNumber(event.cursor),
  batchSize: nullableNumber(event.batchSize),
  spotCount: Math.max(0, Number(event.spotCount) || 0),
  attemptedRequests: nullableNumber(event.attemptedRequests),
  successfulRequests: nullableNumber(event.successfulRequests),
  inFlightSpotCount: Math.max(0, Number(event.inFlightSpotCount) || 0),
  details: Object.fromEntries(Object.entries(
    event.details && typeof event.details === 'object' && !Array.isArray(event.details)
      ? event.details
      : {},
  ).filter(([, value]) => (
    typeof value === 'boolean'
      || (typeof value === 'number' && Number.isFinite(value))
      || (typeof value === 'string' && value.length > 0)
  )).map(([key, value]) => [
    String(key).slice(0, 80),
    typeof value === 'string' ? value.slice(0, 500) : value,
  ])),
  createdAt: asString(event.createdAt) || now,
});

const insertRefreshJobEventRow = (database, event, now) => {
  const normalized = normalizeRefreshJobEvent(event, now);
  database.prepare(`
    INSERT INTO refresh_job_events (
      job_id, event_type, instance_id, status, cursor, batch_size, spot_count,
      attempted_requests, successful_requests, in_flight_spot_count, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    normalized.jobId, normalized.eventType, normalized.instanceId, normalized.status,
    normalized.cursor, normalized.batchSize, normalized.spotCount, normalized.attemptedRequests,
    normalized.successfulRequests, normalized.inFlightSpotCount, jsonText(normalized.details), normalized.createdAt,
  );
  database.prepare(`
    DELETE FROM refresh_job_events
    WHERE id <= (SELECT COALESCE(MAX(id), 0) - ? FROM refresh_job_events)
  `).run(MAX_REFRESH_JOB_EVENTS);
  return normalized;
};

const resetTrainingData = (database, scope, eventContext = {}) => {
  const counts = databaseCounts(database);
  const sessionCount = counts.sessions;
  const removed = {
    spots: counts.spots,
    answerKeys: counts.answerKeys,
    refreshJobs: counts.refreshJobs,
    sessions: sessionCount,
    attempts: counts.attempts,
    abandonedSessions: 0,
  };
  const timestamp = new Date().toISOString();
  database.exec('BEGIN IMMEDIATE;');
  try {
    const jobsBeforeReset = database.prepare('SELECT id, status FROM refresh_jobs ORDER BY rowid').all();
    if (jobsBeforeReset.length === 0) {
      insertRefreshJobEventRow(database, {
        eventType: 'reset',
        instanceId: eventContext.instanceId,
        status: 'reset',
        details: { scope },
      }, timestamp);
    } else {
      jobsBeforeReset.forEach((job) => insertRefreshJobEventRow(database, {
        jobId: job.id,
        eventType: 'reset',
        instanceId: eventContext.instanceId,
        status: job.status,
        details: { scope },
      }, timestamp));
    }
    if (scope === 'all') {
      database.exec(`
        DELETE FROM attempts;
        DELETE FROM session_spots;
        DELETE FROM sessions;
        DELETE FROM answer_keys;
        DELETE FROM refresh_job_spots;
        DELETE FROM refresh_jobs;
        DELETE FROM selected_spots;
        DELETE FROM spots;
        DELETE FROM source_history;
        DELETE FROM sources;
      `);
      database.prepare(`
        UPDATE collection_metadata SET
          revision = revision + 1, updated_at = ?, selected_at = NULL,
          selection_pool_stats_json = '{}', scan_last_scanned_at = NULL,
          scan_dataset_revision = NULL, scan_last_result_json = NULL
        WHERE id = 1
      `).run(timestamp);
    } else {
      removed.abandonedSessions = database.prepare(
        "SELECT COUNT(*) AS count FROM sessions WHERE status = 'active'",
      ).get().count;
      database.exec('DELETE FROM answer_keys; DELETE FROM refresh_jobs;');
      database.prepare(`
        UPDATE spots SET current_answer_key_id = NULL, readiness = 'pending_key', active = 0, updated_at = ?
      `).run(timestamp);
      database.prepare(`
        UPDATE sessions SET status = 'abandoned', abandoned_at = ?, current_spot_version_id = NULL,
          updated_at = ? WHERE status = 'active'
      `).run(timestamp, timestamp);
      database.prepare('UPDATE collection_metadata SET revision = revision + 1, updated_at = ? WHERE id = 1').run(timestamp);
    }
    database.exec('COMMIT;');
    return { scope, removed };
  } catch (error) {
    try { database.exec('ROLLBACK;'); } catch { /* preserve original error */ }
    throw error;
  }
};

const upsertRefreshJobRow = (database, job, now) => {
  const spotIds = new Set(database.prepare(
    'SELECT version_id FROM spots WHERE version_id IN (SELECT spot_version_id FROM refresh_job_spots WHERE job_id = ?)',
  ).all(job.id).map(({ version_id: id }) => id));
  const candidateIds = (Array.isArray(job.candidateSpotVersionIds) ? job.candidateSpotVersionIds : [])
    .filter((id) => spotIds.has(id) || database.prepare('SELECT 1 FROM spots WHERE version_id = ?').get(id));
  database.prepare(`
    INSERT INTO refresh_jobs (
      id, status, model_id, contract_version, batch_size, sample_size, candidate_count,
      estimated_requests, cursor, attempted_requests, successful_requests, recovery_count, last_recovered_at,
      processed_spot_count,
      skipped_spot_count, saved_key_count, ready_key_count, review_key_count, invalid_key_count,
      unknown_result_count, stop_requested, in_flight_json, errors_json, payload_json,
      created_at, updated_at, started_at, resumed_at, stopped_at, finished_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status, model_id = excluded.model_id, contract_version = excluded.contract_version,
      batch_size = excluded.batch_size, sample_size = excluded.sample_size, candidate_count = excluded.candidate_count,
      estimated_requests = excluded.estimated_requests, cursor = excluded.cursor,
      attempted_requests = excluded.attempted_requests, successful_requests = excluded.successful_requests,
      recovery_count = excluded.recovery_count, last_recovered_at = excluded.last_recovered_at,
      processed_spot_count = excluded.processed_spot_count, skipped_spot_count = excluded.skipped_spot_count,
      saved_key_count = excluded.saved_key_count, ready_key_count = excluded.ready_key_count,
      review_key_count = excluded.review_key_count, invalid_key_count = excluded.invalid_key_count,
      unknown_result_count = excluded.unknown_result_count, stop_requested = excluded.stop_requested,
      in_flight_json = excluded.in_flight_json, errors_json = excluded.errors_json, payload_json = excluded.payload_json,
      updated_at = excluded.updated_at, started_at = excluded.started_at, resumed_at = excluded.resumed_at,
      stopped_at = excluded.stopped_at, finished_at = excluded.finished_at
  `).run(
    job.id, job.status || 'completed', nullableString(job.modelId), nullableNumber(job.contractVersion),
    nullableNumber(job.batchSize), nullableNumber(job.sampleSize), candidateIds.length,
    Number(job.estimatedRequests) || 0, Number(job.cursor) || 0, Number(job.attemptedRequests) || 0,
    Number(job.successfulRequests) || 0, Number(job.recoveryCount) || 0, nullableString(job.lastRecoveredAt),
    Number(job.processedSpotCount) || 0, Number(job.skippedSpotCount) || 0,
    Number(job.savedKeyCount) || 0, Number(job.readyKeyCount) || 0, Number(job.reviewKeyCount) || 0,
    Number(job.invalidKeyCount) || 0, Number(job.unknownResultCount) || 0, boolToSql(job.stopRequested),
    job.inFlight ? jsonText(job.inFlight) : null, jsonText(job.errors || []), jsonText(job),
    job.createdAt || now, job.updatedAt || now, nullableString(job.startedAt), nullableString(job.resumedAt),
    nullableString(job.stoppedAt), nullableString(job.finishedAt),
  );
  database.prepare('DELETE FROM refresh_job_spots WHERE job_id = ?').run(job.id);
  const relationInsert = database.prepare(
    'INSERT INTO refresh_job_spots (job_id, position, spot_version_id, created_at) VALUES (?, ?, ?, ?)',
  );
  candidateIds.forEach((spotVersionId, position) => relationInsert.run(job.id, position, spotVersionId, now));
  return clone(job);
};

const insertAnswerKeyRow = (database, key, now) => {
  const existing = database.prepare('SELECT * FROM answer_keys WHERE id = ?').get(key.id);
  if (existing) return rowToAnswerKey(existing);
  database.prepare(`
    INSERT INTO answer_keys (
      id, spot_version_id, refresh_job_id, contract_version, status, confidence, local_facts_valid,
      historical_only, facts_validation_version, preferred_answer, hero_hand_json,
      decision_card_facts_json, acceptable_alternatives_json, suggested_sizing_json, model_json,
      errors_json, payload_json, rationale, blockers_equity, opponent_range, created_at,
      updated_at, archived_at, archive_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    key.id, key.spotVersionId, nullableString(key.refreshJobId), nullableNumber(key.contractVersion),
    key.status || 'review', nullableString(key.confidence), key.localFactsValid == null ? null : boolToSql(key.localFactsValid),
    boolToSql(key.historicalOnly), nullableNumber(key.factsValidationVersion), nullableString(key.preferredAnswer),
    key.heroHand ? jsonText(key.heroHand) : null, key.decisionCardFacts ? jsonText(key.decisionCardFacts) : null,
    jsonText(key.acceptableAlternatives || []), key.suggestedSizing ? jsonText(key.suggestedSizing) : null,
    key.model ? jsonText(key.model) : null, jsonText(key.errors || []), jsonText(key), nullableString(key.rationale),
    nullableString(key.blockersEquity), nullableString(key.opponentRange), key.createdAt || now,
    nullableString(key.updatedAt), nullableString(key.archivedAt), nullableString(key.archiveReason),
  );
  return clone(key);
};

const recomputeStoredSpot = (database, spotVersionId) => {
  const spotRow = database.prepare('SELECT * FROM spots WHERE version_id = ?').get(spotVersionId);
  if (!spotRow) return;
  const spot = rowToTrainingSpot(spotRow);
  const keyRow = database.prepare(
    'SELECT * FROM answer_keys WHERE spot_version_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
  ).get(spotVersionId);
  const key = keyRow ? rowToAnswerKey(keyRow) : null;
  const eligible = key?.contractVersion === TRAINING_ANSWER_KEY_CONTRACT_VERSION
    && isAnswerKeyEligible(key, spot);
  const readiness = spot.sourceStatus !== 'current' ? spot.readiness
    : eligible ? 'ready' : key?.contractVersion === TRAINING_ANSWER_KEY_CONTRACT_VERSION ? 'review' : 'pending_key';
  const selected = Boolean(database.prepare(
    'SELECT 1 FROM selected_spots WHERE spot_version_id = ? AND active = 1',
  ).get(spotVersionId));
  database.prepare(`
    UPDATE spots SET current_answer_key_id = ?, readiness = ?, active = ?, updated_at = ?
    WHERE version_id = ?
  `).run(eligible ? key.id : null, readiness, eligible && selected ? 1 : 0, new Date().toISOString(), spotVersionId);
};

const clearTrainingRows = (database) => {
  database.exec(`
    DELETE FROM attempts;
    DELETE FROM session_spots;
    DELETE FROM sessions;
    DELETE FROM answer_keys;
    DELETE FROM refresh_job_spots;
    DELETE FROM refresh_jobs;
    DELETE FROM selected_spots;
    DELETE FROM spots;
    DELETE FROM source_history;
    DELETE FROM sources;
    DELETE FROM audit_exclusions;
  `);
};

const insertCollectionRows = (database, collection, now) => {
  assertNoRawHistory(collection);
  const sourceMap = new Map(Object.entries(collection.scanState?.sources || {}));
  collection.spots.forEach((spot) => {
    if (sourceMap.has(spot.handId)) return;
    sourceMap.set(spot.handId, {
      fingerprint: asString(spot.sourceFingerprint) || `missing:${spot.handId}`,
      gameType: spot.gameType,
      playedAt: spot.playedAt,
      status: spot.sourceStatus,
      spotVersionIds: [],
      scannedAt: now,
      lastSeenAt: now,
    });
  });
  const sourceInsert = database.prepare(`
    INSERT INTO sources (
      hand_id, fingerprint, game_type, played_at, status, expected_spot_count,
      observed_spot_count, extractor_version, dataset_revision, rejection_json,
      first_seen_at, last_seen_at, scanned_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const [handId, source] of sourceMap) {
    const ids = Array.isArray(source.spotVersionIds)
      ? source.spotVersionIds
      : collection.spots.filter((spot) => spot.handId === handId).map((spot) => spot.versionId);
    sourceInsert.run(
      handId,
      asString(source.fingerprint) || `missing:${handId}`,
      source.gameType === 'tournament' ? 'tournament' : 'cash',
      nullableString(source.playedAt),
      asString(source.status) || 'current',
      Number.isInteger(source.expectedSpotCount) ? source.expectedSpotCount : ids.length,
      Number.isInteger(source.observedSpotCount) ? source.observedSpotCount : ids.length,
      nullableString(source.extractorVersion),
      nullableString(source.datasetRevision),
      source.rejection === undefined ? null : jsonText(source.rejection),
      source.scannedAt || now,
      source.lastSeenAt || source.scannedAt || now,
      source.scannedAt || now,
      source.lastSeenAt || source.scannedAt || now,
    );
  }
  const historyInsert = database.prepare(`
    INSERT INTO source_history (
      hand_id, fingerprint, status, replaced_by_fingerprint, details_json, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  (collection.scanState.sourceHistory || []).forEach((entry) => {
    if (!sourceMap.has(entry.handId)) return;
    historyInsert.run(
      entry.handId,
      asString(entry.fingerprint),
      asString(entry.status) || 'unknown',
      nullableString(entry.replacedBy),
      jsonText(entry),
      entry.at || now,
    );
  });
  const spotInsert = database.prepare(`
    INSERT INTO spots (
      version_id, spot_id, hand_id, source_fingerprint, exercise_type, game_type, street,
      stage, scenario, episode_id, sequence_index, sequence_length, uses_historical_line,
      continuation_notice, source_status, readiness, active, current_answer_key_id,
      local_validation_version, local_valid, local_validation_error,
      ai_first_sent_at, ai_first_sent_job_id, question_json, answer_options_json,
      decision_card_facts_json, historical_answer_json, historical_result_json, payload_json,
      played_at, created_at, updated_at, last_seen_at, archived_at, archive_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  collection.spots.forEach((spot) => {
    const source = sourceMap.get(spot.handId);
    const sourceFingerprint = asString(spot.sourceFingerprint) || asString(source?.fingerprint) || `missing:${spot.handId}`;
    const localValidationError = spot.localValidationError === undefined
      ? getTrainingSpotAiEligibilityError({ ...spot, sourceStatus: spot.sourceStatus || 'current' })
      : spot.localValidationError;
    spotInsert.run(
      spot.versionId,
      storedSpotId(spot),
      spot.handId,
      sourceFingerprint,
      spot.exerciseType,
      spot.gameType === 'tournament' ? 'tournament' : 'cash',
      nullableString(spot.street),
      nullableString(spot.stage),
      nullableString(spot.scenario),
      nullableString(spot.episodeId),
      nullableNumber(spot.sequenceIndex),
      nullableNumber(spot.sequenceLength),
      boolToSql(spot.usesHistoricalLine),
      nullableString(spot.continuationNotice),
      spot.sourceStatus || 'current',
      spot.readiness || 'pending_key',
      boolToSql(spot.active),
      null,
      Number(spot.localValidationVersion) || TRAINING_EXTRACTOR_VERSION,
      spot.localValid === undefined ? boolToSql(localValidationError === null) : boolToSql(spot.localValid),
      nullableString(localValidationError),
      nullableString(spot.aiFirstSentAt),
      nullableString(spot.aiFirstSentJobId),
      jsonText(spot.question || {}),
      jsonText(spot.answerOptions || []),
      spot.decisionCardFacts ? jsonText(spot.decisionCardFacts) : null,
      spot.historicalAnswer ? jsonText(spot.historicalAnswer) : null,
      spot.historicalResult ? jsonText(spot.historicalResult) : null,
      jsonText(spot),
      nullableString(spot.playedAt),
      spot.createdAt || now,
      spot.updatedAt || now,
      nullableString(spot.lastSeenAt),
      nullableString(spot.archivedAt),
      nullableString(spot.archiveReason),
    );
  });
  const jobInsert = database.prepare(`
    INSERT INTO refresh_jobs (
      id, status, model_id, contract_version, batch_size, sample_size, candidate_count,
      estimated_requests, cursor, attempted_requests, successful_requests, processed_spot_count,
      skipped_spot_count, saved_key_count, ready_key_count, review_key_count, invalid_key_count,
      unknown_result_count, stop_requested, in_flight_json, errors_json, payload_json,
      created_at, updated_at, started_at, resumed_at, stopped_at, finished_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const jobSpotInsert = database.prepare(
    'INSERT INTO refresh_job_spots (job_id, position, spot_version_id, created_at) VALUES (?, ?, ?, ?)',
  );
  const spotIds = new Set(collection.spots.map((spot) => spot.versionId));
  collection.refreshJobs.forEach((job) => {
    const candidateIds = (Array.isArray(job.candidateSpotVersionIds) ? job.candidateSpotVersionIds : [])
      .filter((id) => spotIds.has(id));
    jobInsert.run(
      job.id,
      job.status || 'completed',
      nullableString(job.modelId),
      nullableNumber(job.contractVersion),
      nullableNumber(job.batchSize),
      nullableNumber(job.sampleSize),
      candidateIds.length,
      Number(job.estimatedRequests) || 0,
      Number(job.cursor) || 0,
      Number(job.attemptedRequests) || 0,
      Number(job.successfulRequests) || 0,
      Number(job.processedSpotCount) || 0,
      Number(job.skippedSpotCount) || 0,
      Number(job.savedKeyCount) || 0,
      Number(job.readyKeyCount) || 0,
      Number(job.reviewKeyCount) || 0,
      Number(job.invalidKeyCount) || 0,
      Number(job.unknownResultCount) || 0,
      boolToSql(job.stopRequested),
      job.inFlight ? jsonText(job.inFlight) : null,
      jsonText(job.errors || []),
      jsonText(job),
      job.createdAt || now,
      job.updatedAt || now,
      nullableString(job.startedAt),
      nullableString(job.resumedAt),
      nullableString(job.stoppedAt),
      nullableString(job.finishedAt),
    );
    candidateIds.forEach((spotVersionId, position) => jobSpotInsert.run(job.id, position, spotVersionId, now));
  });
  const keyInsert = database.prepare(`
    INSERT INTO answer_keys (
      id, spot_version_id, refresh_job_id, contract_version, status, confidence, local_facts_valid,
      historical_only, facts_validation_version, preferred_answer, hero_hand_json,
      decision_card_facts_json, acceptable_alternatives_json, suggested_sizing_json, model_json,
      errors_json, payload_json, rationale, blockers_equity, opponent_range, created_at,
      updated_at, archived_at, archive_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  collection.answerKeys.forEach((key) => {
    if (!spotIds.has(key.spotVersionId)) return;
    keyInsert.run(
      key.id,
      key.spotVersionId,
      nullableString(key.refreshJobId),
      nullableNumber(key.contractVersion),
      key.status || 'review',
      nullableString(key.confidence),
      key.localFactsValid === null || key.localFactsValid === undefined ? null : boolToSql(key.localFactsValid),
      boolToSql(key.historicalOnly),
      nullableNumber(key.factsValidationVersion),
      nullableString(key.preferredAnswer),
      key.heroHand ? jsonText(key.heroHand) : null,
      key.decisionCardFacts ? jsonText(key.decisionCardFacts) : null,
      jsonText(key.acceptableAlternatives || []),
      key.suggestedSizing ? jsonText(key.suggestedSizing) : null,
      key.model ? jsonText(key.model) : null,
      jsonText(key.errors || []),
      jsonText(key),
      nullableString(key.rationale),
      nullableString(key.blockersEquity),
      nullableString(key.opponentRange),
      key.createdAt || now,
      nullableString(key.updatedAt),
      nullableString(key.archivedAt),
      nullableString(key.archiveReason),
    );
  });
  const currentKeyUpdate = database.prepare(
    'UPDATE spots SET current_answer_key_id = ? WHERE version_id = ?',
  );
  collection.spots.forEach((spot) => {
    const key = collection.answerKeys.find((candidate) => candidate.id === spot.currentAnswerKeyId
      && candidate.spotVersionId === spot.versionId);
    if (key) currentKeyUpdate.run(key.id, spot.versionId);
  });
  const selectedInsert = database.prepare(`
    INSERT INTO selected_spots (exercise_type, game_type, position, spot_version_id, active, selected_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `);
  const selectedIds = new Set(collection.selectionState?.selectedSpotVersionIds || []);
  const positions = new Map();
  collection.spots.forEach((spot) => {
    if (!selectedIds.has(spot.versionId)) return;
    const key = poolKey(spot);
    const position = positions.get(key) || 0;
    if (position >= 100) return;
    selectedInsert.run(spot.exerciseType, spot.gameType, position, spot.versionId, collection.selectionState.selectedAt || now);
    positions.set(key, position + 1);
  });
  const sessionInsert = database.prepare(`
    INSERT INTO sessions (
      id, exercise_type, game_type, requested_size, target_size, status, current_position,
      current_spot_version_id, last_spot_version_id, score_correct, score_acceptable,
      score_incorrect, metadata_json, created_at, updated_at, completed_at, abandoned_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  collection.sessions.forEach((session) => {
    const available = [...new Set((session.availableSpotVersionIds || []).filter((id) => spotIds.has(id)))];
    const answered = new Set((session.answeredSpotVersionIds || []).filter((id) => available.includes(id)));
    const currentPosition = available.indexOf(session.currentSpotVersionId);
    const score = session.score || {};
    sessionInsert.run(
      session.id,
      session.exerciseType || 'unknown',
      session.gameType || 'both',
      String(session.requestedSize ?? '20'),
      Number(session.targetSize) || 0,
      session.status || 'active',
      currentPosition >= 0 ? currentPosition : null,
      nullableString(session.currentSpotVersionId),
      nullableString(session.lastSpotVersionId),
      Number(score.correct) || 0,
      Number(score.acceptable) || 0,
      Number(score.incorrect) || 0,
      jsonText(session),
      session.createdAt || now,
      session.updatedAt || now,
      nullableString(session.completedAt),
      nullableString(session.abandonedAt),
    );
    session.__sqlAvailable = available;
    session.__sqlAnswered = answered;
  });
  const attemptInsert = database.prepare(`
    INSERT INTO attempts (
      id, session_id, spot_version_id, answer_key_id, answer, grade, feedback_json,
      answered_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  collection.attempts.forEach((attempt) => {
    attemptInsert.run(
      attempt.id,
      collection.sessions.some(({ id }) => id === attempt.sessionId) ? attempt.sessionId : null,
      spotIds.has(attempt.spotVersionId) ? attempt.spotVersionId : null,
      collection.answerKeys.some(({ id }) => id === attempt.answerKeyId) ? attempt.answerKeyId : null,
      nullableString(attempt.answer),
      nullableString(attempt.grade),
      attempt.feedback ? jsonText(attempt.feedback) : null,
      attempt.answeredAt || attempt.createdAt || now,
      attempt.createdAt || now,
      nullableString(attempt.updatedAt),
    );
  });
  const sessionSpotInsert = database.prepare(`
    INSERT INTO session_spots (session_id, position, spot_version_id, status, answered_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  collection.sessions.forEach((session) => {
    const available = session.__sqlAvailable || [];
    const answered = session.__sqlAnswered || new Set();
    available.forEach((spotVersionId, position) => {
      const status = answered.has(spotVersionId)
        ? 'answered'
        : spotVersionId === session.currentSpotVersionId ? 'current' : 'pending';
      const attempt = collection.attempts.find((candidate) => (
        candidate.sessionId === session.id && candidate.spotVersionId === spotVersionId
      ));
      sessionSpotInsert.run(session.id, position, spotVersionId, status, attempt?.answeredAt || null);
    });
    delete session.__sqlAvailable;
    delete session.__sqlAnswered;
  });
  const auditInsert = database.prepare(
    'INSERT INTO audit_exclusions (hand_id, fingerprint, reason, excluded_at) VALUES (?, ?, ?, ?)',
  );
  (collection.auditState?.excludedHands || []).forEach((entry) => auditInsert.run(
    entry.handId,
    entry.fingerprint,
    entry.reason || 'local_card_audit',
    entry.excludedAt || now,
  ));
};

const updateCollectionMetadata = (database, collection, {
  now,
  migrationStatus = 'completed',
  migrationStartedAt = null,
  migrationCompletedAt = null,
  migrationBackupPath = null,
  migrationErrorJson = null,
} = {}) => {
  database.prepare(`
    UPDATE collection_metadata SET
      collection_version = ?, revision = ?, updated_at = ?,
      selection_strategy = ?, selection_strategy_version = ?, selection_limit = ?, selected_at = ?,
      replenishment_disabled = ?, selection_frozen = ?, selection_pool_stats_json = ?,
      scan_last_scanned_at = ?, scan_dataset_revision = ?, scan_last_result_json = ?,
      migration_status = ?, migration_started_at = ?, migration_completed_at = ?,
      migration_backup_path = ?, migration_error_json = ?
    WHERE id = 1
  `).run(
    2,
    Number(collection.revision) || 0,
    collection.updatedAt || now,
    collection.selectionState?.strategy || TRAINING_SELECTION_STRATEGY,
    collection.selectionState?.strategyVersion || TRAINING_SELECTION_STRATEGY,
    Math.min(100, Math.max(1, Number(collection.selectionState?.limit) || DEFAULT_SELECTION_LIMIT)),
    nullableString(collection.selectionState?.selectedAt),
    boolToSql(collection.selectionState?.replenishmentDisabled),
    boolToSql(collection.auditState?.selectionFrozen),
    jsonText(collection.selectionState?.poolStats || {}),
    nullableString(collection.scanState?.lastScannedAt),
    nullableString(collection.scanState?.datasetRevision),
    collection.scanState?.lastResult ? jsonText(collection.scanState.lastResult) : null,
    migrationStatus,
    migrationStartedAt,
    migrationCompletedAt,
    migrationBackupPath,
    migrationErrorJson,
  );
};

const databaseCounts = (database) => Object.fromEntries([
  ['spots', 'spots'],
  ['answerKeys', 'answer_keys'],
  ['refreshJobs', 'refresh_jobs'],
  ['sessions', 'sessions'],
  ['attempts', 'attempts'],
  ['selectedSpots', 'selected_spots'],
  ['sourceHistory', 'source_history'],
].map(([key, table]) => [key, database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));

const assertMigratedDatabase = (database, collection) => {
  const counts = databaseCounts(database);
  const selectedPoolPositions = new Map();
  const selectedSpotIds = new Set(collection.selectionState.selectedSpotVersionIds || []);
  let selectedSpots = 0;
  collection.spots.forEach((spot) => {
    if (!selectedSpotIds.has(spot.versionId)) return;
    const key = poolKey(spot);
    const position = selectedPoolPositions.get(key) || 0;
    if (position >= 100) return;
    selectedPoolPositions.set(key, position + 1);
    selectedSpots += 1;
  });
  const expected = {
    spots: collection.spots.length,
    answerKeys: collection.answerKeys.length,
    refreshJobs: collection.refreshJobs.length,
    sessions: collection.sessions.length,
    attempts: collection.attempts.length,
    selectedSpots,
    sourceHistory: collection.scanState.sourceHistory.length,
  };
  Object.entries(expected).forEach(([key, value]) => {
    if (counts[key] !== value) {
      fail('TRAINING_MIGRATION_COUNT_MISMATCH', `Migracja ${key} zachowała ${counts[key]} z ${value} rekordów.`);
    }
  });
  const foreignKeys = database.prepare('PRAGMA foreign_key_check').all();
  if (foreignKeys.length > 0) fail('TRAINING_MIGRATION_RELATION_MISMATCH', 'Migracja utworzyła niespójne relacje.');
  const integrity = String(database.prepare('PRAGMA integrity_check').get()?.integrity_check || '').toLowerCase();
  if (integrity !== 'ok') fail('TRAINING_MIGRATION_INTEGRITY_FAILED', `SQLite integrity_check: ${integrity || 'unknown'}.`);
};

const migrationBackupPath = (dataDirectory, clock) => {
  const stamp = clock().toISOString().replace(/[.:]/g, '-');
  return path.join(dataDirectory, TRAINING_MIGRATION_BACKUP_PATTERN.replace('*', stamp));
};

const exists = async (filePath) => fs.access(filePath).then(() => true, () => false);

const prepareLegacyCollectionForMigration = (collection, {
  now,
  auditExclusions,
  activePoolLimit,
}) => {
  const migrated = clone(collection);
  let changed = migrateAiFirstSentMarkers(migrated, now);
  changed = migrateTrainingAudit(migrated, now, auditExclusions) || changed;
  changed = migrateAnswerKeyContract(migrated, now) || changed;
  recomputeActivePools(migrated);
  if (migrated.spots.length > 0 && migrated.selectionState.selectedAt === null) {
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
      job.finishedAt = now;
      job.errors = [...(job.errors || []), {
        code: 'TRAINING_REFRESH_SELECTION_SUPERSEDED',
        message: 'Zadanie utworzone przed limitem selekcji nie może zostać wznowione po migracji.',
        spotVersionIds: [],
      }];
    });
    selectCollectionSpots(migrated, now, { selectionLimit: activePoolLimit });
    recomputeActivePools(migrated);
    changed = true;
  }
  return { collection: migrated, changed };
};

const migrateJsonCollection = async (database, dataDirectory, {
  clock,
  auditExclusions,
  activePoolLimit,
} = {}) => {
  const jsonPath = getCollectionPath(dataDirectory);
  const metadata = getMetadataRow(database);
  if (metadata?.migration_status === 'completed') return { migrated: false, backupPath: metadata.migration_backup_path };
  const jsonExists = await exists(jsonPath);
  const existingCounts = databaseCounts(database);
  const hasPartialDatabase = Object.entries(existingCounts)
    .filter(([key]) => key !== 'selectedSpots' && key !== 'sourceHistory')
    .some(([, count]) => count > 0);
  if (!jsonExists) {
    if (hasPartialDatabase) {
      fail('TRAINING_MIGRATION_SOURCE_MISSING', 'Nie można wznowić migracji bez pozostawionego pliku JSON.');
    }
    database.exec('BEGIN IMMEDIATE;');
    try {
      const timestamp = clock().toISOString();
      updateCollectionMetadata(database, createEmptyTrainingCollection(), {
        now: timestamp,
        migrationStatus: 'completed',
        migrationCompletedAt: timestamp,
      });
      database.exec('COMMIT;');
      return { migrated: false, backupPath: null };
    } catch (error) {
      try { database.exec('ROLLBACK;'); } catch { /* preserve original error */ }
      throw error;
    }
  }
  const sourceCollection = await readTrainingCollection(dataDirectory);
  const timestamp = clock().toISOString();
  const { collection } = prepareLegacyCollectionForMigration(sourceCollection, {
    now: timestamp,
    auditExclusions,
    activePoolLimit,
  });
  const backupPath = migrationBackupPath(path.resolve(dataDirectory), clock);
  database.exec('BEGIN IMMEDIATE;');
  try {
    clearTrainingRows(database);
    insertCollectionRows(database, collection, timestamp);
    updateCollectionMetadata(database, collection, {
      now: timestamp,
      migrationStatus: 'completed',
      migrationStartedAt: timestamp,
      migrationCompletedAt: timestamp,
      migrationBackupPath: backupPath,
    });
    assertMigratedDatabase(database, collection);
    database.exec('COMMIT;');
  } catch (error) {
    try { database.exec('ROLLBACK;'); } catch { /* preserve original error */ }
    if (error instanceof TrainingRepositoryError) throw error;
    throw new TrainingRepositoryError(
      'TRAINING_MIGRATION_FAILED',
      'Nie udało się zmigrować kolekcji ćwiczeń do SQLite.',
      { cause: error },
    );
  }
  try {
    await renameTrainingCollectionWithRetry(jsonPath, backupPath);
  } catch (error) {
    // SQLite is already complete and therefore remains the source of truth.
    throw new TrainingRepositoryError(
      'TRAINING_MIGRATION_BACKUP_FAILED',
      'Baza została zmigrowana, ale nie udało się zmienić nazwy kopii JSON.',
      { cause: error, backupPath },
    );
  }
  return {
    migrated: true,
    backupPath,
    counts: databaseCounts(database),
  };
};

const persistFullCollection = (database, collection, now) => {
  database.exec('BEGIN IMMEDIATE;');
  try {
    clearTrainingRows(database);
    insertCollectionRows(database, collection, now);
    updateCollectionMetadata(database, collection, { now, migrationStatus: 'completed' });
    assertMigratedDatabase(database, collection);
    database.exec('COMMIT;');
  } catch (error) {
    try { database.exec('ROLLBACK;'); } catch { /* preserve original error */ }
    throw error;
  }
};

export const createTrainingRepository = ({
  dataDirectory,
  activePoolLimit = DEFAULT_ACTIVE_POOL_LIMIT,
  clock = () => new Date(),
  auditExclusions = DEFAULT_TRAINING_AUDIT_EXCLUSIONS,
} = {}) => {
  getCollectionPath(dataDirectory);
  if (!Number.isInteger(activePoolLimit) || activePoolLimit < 1 || activePoolLimit > 100) {
    fail('TRAINING_ACTIVE_LIMIT_INVALID', 'Limit aktywnej puli musi być liczbą całkowitą od 1 do 100.');
  }
  let database = createTrainingDatabase({
    dataDirectory,
    filename: TRAINING_DATABASE_FILENAME,
  });
  const now = () => clock().toISOString();
  const openDatabase = () => {
    database = createTrainingDatabase({
      dataDirectory,
      filename: TRAINING_DATABASE_FILENAME,
    });
    return database;
  };
  const closeDatabase = () => {
    try {
      database?.close();
    } finally {
      database = null;
    }
  };
  let operation = Promise.resolve();
  const ready = migrateJsonCollection(database, dataDirectory, {
    clock,
    auditExclusions,
    activePoolLimit,
  }).then(() => {
    const current = getFullTrainingSnapshot(database);
    const next = clone(current);
    const changed = migrateTrainingAudit(next, now(), auditExclusions);
    if (!changed) return;
    next.revision = current.revision + 1;
    next.updatedAt = now();
    persistFullCollection(database, next, next.updatedAt);
  }).finally(closeDatabase);
  const withLock = (task) => {
    const next = operation.then(task, task);
    operation = next.catch(() => {});
    return next;
  };
  const run = (task) => withLock(async () => {
    await ready;
    openDatabase();
    try {
      return await task();
    } finally {
      closeDatabase();
    }
  });
  const transact = (mutator) => {
    if (typeof mutator !== 'function') fail('TRAINING_TRANSACTION_INVALID', 'Transakcja treningowa wymaga funkcji modyfikującej.');
    return run(async () => {
      const current = getFullTrainingSnapshot(database);
      const next = clone(current);
      const result = await mutator(next, now());
      next.revision = current.revision + 1;
      next.updatedAt = now();
      const normalized = normalizeTrainingCollection(next);
      persistFullCollection(database, normalized, normalized.updatedAt);
      return { collection: clone(normalized), result: clone(result) };
    });
  };
  return {
    getSnapshot: () => run(async () => clone(getFullTrainingSnapshot(database))),
    getScanState: () => run(async () => clone(getScanStateData(database))),
    getRefreshEstimateData: (sampleSize) => run(async () => clone(getRefreshEstimateData(database, sampleSize))),
    getTrainingStatusData: (sampleSize) => run(async () => clone(getTrainingStatusData(database, sampleSize))),
    getTrainingSessionSummary: (sessionId) => run(async () => clone(
      getTrainingSessionSummary(database, asString(sessionId)),
    )),
    getTrainingSessionContext: (sessionId) => run(async () => clone(
      getTrainingSessionContext(database, asString(sessionId)),
    )),
    getTrainingQuestionContext: (sessionId) => run(async () => clone(
      getTrainingQuestionContext(database, asString(sessionId), now()),
    )),
    getTrainingAnswerContext: (sessionId, spotVersionId) => run(async () => clone(
      getTrainingAnswerContext(database, asString(sessionId), asString(spotVersionId)),
    )),
    getActiveTrainingSessions: (filters = {}) => run(async () => {
      const clauses = ["status = 'active'"];
      const params = [];
      if (filters.exerciseType) { clauses.push('exercise_type = ?'); params.push(filters.exerciseType); }
      if (filters.gameType && filters.gameType !== 'both') { clauses.push('game_type = ?'); params.push(filters.gameType); }
      const rows = database.prepare(
        `SELECT id FROM sessions WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC, rowid DESC`,
      ).all(...params);
      return rows.map(({ id }) => getTrainingSessionContext(database, id)).filter(Boolean).map(({ session }) => session);
    }),
    saveTrainingSession: (session) => run(async () => {
      database.exec('BEGIN IMMEDIATE;');
      try {
        const saved = saveTrainingSessionRow(database, session, now());
        bumpTrainingRevision(database, session.updatedAt || now());
        database.exec('COMMIT;');
        return saved;
      } catch (error) {
        try { database.exec('ROLLBACK;'); } catch { /* preserve original error */ }
        throw error;
      }
    }),
    saveTrainingAttemptAndSession: (attempt, session) => run(async () => {
      database.exec('BEGIN IMMEDIATE;');
      try {
        const duplicate = database.prepare(
          'SELECT 1 FROM attempts WHERE session_id = ? AND spot_version_id = ? LIMIT 1',
        ).get(attempt.sessionId, attempt.spotVersionId);
        if (duplicate) {
          database.exec('COMMIT;');
          return { duplicate: true };
        }
        const savedAttempt = saveTrainingAttemptRow(database, attempt);
        const savedSession = saveTrainingSessionRow(database, session, now());
        bumpTrainingRevision(database, session.updatedAt || now());
        database.exec('COMMIT;');
        return { attempt: savedAttempt, session: savedSession };
      } catch (error) {
        try { database.exec('ROLLBACK;'); } catch { /* preserve original error */ }
        throw error;
      }
    }),
    saveTrainingAttemptAndAdvance: (attempt, session) => run(async () => (
      saveTrainingAttemptAndAdvance(database, attempt, session, now())
    )),
    getTrainingAttemptsForSpots: (versionIds) => run(async () => {
      const ids = [...new Set((Array.isArray(versionIds) ? versionIds : []).map(asString).filter(Boolean))];
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => '?').join(', ');
      return database.prepare(
        `SELECT * FROM attempts WHERE spot_version_id IN (${placeholders}) ORDER BY answered_at DESC, rowid DESC`,
      ).all(...ids).map(rowToTrainingAttempt);
    }),
    getTrainingHistoryData: (filters, limit) => run(async () => clone(
      getTrainingHistoryData(database, filters, limit),
    )),
    getTrainingStatsRows: (filters) => run(async () => clone(getTrainingStatsRows(database, filters))),
    resetTrainingData: (scope, eventContext = {}) => run(async () => resetTrainingData(database, scope, eventContext)),
    getRefreshJob: (jobId) => run(async () => getRefreshJobRows(database, asString(jobId))[0] || null),
    getRefreshJobs: () => run(async () => clone(getRefreshJobRows(database))),
    getRefreshJobEvents: (options = {}) => run(async () => clone(getRefreshJobEventRows(database, options))),
    appendRefreshJobEvent: (event) => run(async () => {
      database.exec('BEGIN IMMEDIATE;');
      try {
        const saved = insertRefreshJobEventRow(database, event, now());
        database.exec('COMMIT;');
        return saved;
      } catch (error) {
        try { database.exec('ROLLBACK;'); } catch { /* preserve original error */ }
        throw error;
      }
    }),
    getSpotsByVersionIds: (versionIds) => run(async () => clone(getSpotsByVersionIds(database, versionIds))),
    transact,
    scanCanonicalHands: (sources, options = {}) => transact((collection, timestamp) => scanCollection(collection, Array.isArray(sources) ? sources : [], {
      datasetRevision: options.datasetRevision,
      now: timestamp,
      selectionLimit: activePoolLimit,
      rebuildSelection: Boolean(options.rebuildSelection),
    })),
    saveAnswerKeys: (keys) => transact((collection, timestamp) => saveKeys(collection, keys, timestamp)),
    saveRefreshJob: (job) => run(async () => {
      database.exec('BEGIN IMMEDIATE;');
      try {
        const timestamp = now();
        (job.inFlight?.spotVersionIds || []).forEach((spotVersionId) => {
          database.prepare(`
            UPDATE spots SET ai_first_sent_at = COALESCE(ai_first_sent_at, ?),
              ai_first_sent_job_id = COALESCE(ai_first_sent_job_id, ?), updated_at = ?
            WHERE version_id = ?
          `).run(timestamp, job.id, timestamp, spotVersionId);
        });
        const saved = upsertRefreshJobRow(database, job, timestamp);
        bumpTrainingRevision(database, timestamp);
        database.exec('COMMIT;');
        return { collection: null, result: saved };
      } catch (error) {
        try { database.exec('ROLLBACK;'); } catch { /* preserve original error */ }
        throw error;
      }
    }),
    saveAnswerKeyBatch: (keys, job) => run(async () => {
      database.exec('BEGIN IMMEDIATE;');
      try {
        const timestamp = now();
        const savedKeys = (Array.isArray(keys) ? keys : []).map((key) => insertAnswerKeyRow(database, key, timestamp));
        savedKeys.forEach((key) => {
          database.prepare(`
            UPDATE spots SET ai_first_sent_at = COALESCE(ai_first_sent_at, ?),
              ai_first_sent_job_id = COALESCE(ai_first_sent_job_id, ?), updated_at = ?
            WHERE version_id = ?
          `).run(key.createdAt || timestamp, key.refreshJobId || job?.id || null, timestamp, key.spotVersionId);
          recomputeStoredSpot(database, key.spotVersionId);
        });
        const savedJob = job ? upsertRefreshJobRow(database, job, timestamp) : null;
        bumpTrainingRevision(database, timestamp);
        database.exec('COMMIT;');
        return { collection: null, result: { keys: { added: savedKeys.length }, job: savedJob } };
      } catch (error) {
        try { database.exec('ROLLBACK;'); } catch { /* preserve original error */ }
        throw error;
      }
    }),
    saveSession: (session) => run(async () => {
      database.exec('BEGIN IMMEDIATE;');
      try {
        const saved = saveTrainingSessionRow(database, session, now());
        bumpTrainingRevision(database, session.updatedAt || now());
        database.exec('COMMIT;');
        return { collection: null, result: saved };
      } catch (error) {
        try { database.exec('ROLLBACK;'); } catch { /* preserve original error */ }
        throw error;
      }
    }),
    saveAttempt: (attempt) => run(async () => {
      database.exec('BEGIN IMMEDIATE;');
      try {
        const saved = saveTrainingAttemptRow(database, attempt);
        bumpTrainingRevision(database, attempt.updatedAt || now());
        database.exec('COMMIT;');
        return { collection: null, result: saved };
      } catch (error) {
        try { database.exec('ROLLBACK;'); } catch { /* preserve original error */ }
        throw error;
      }
    }),
    getActiveSpots: (filters = {}) => run(async () => {
      const clauses = ['active = 1'];
      const params = [];
      if (filters.exerciseType) { clauses.push('exercise_type = ?'); params.push(filters.exerciseType); }
      if (filters.gameType && filters.gameType !== 'both') { clauses.push('game_type = ?'); params.push(filters.gameType); }
      const rows = database.prepare(`SELECT * FROM spots WHERE ${clauses.join(' AND ')} ORDER BY played_at DESC, rowid`).all(...params);
      return rows.map(rowToTrainingSpot);
    }),
    getDatabasePath: () => getTrainingDatabasePath(dataDirectory, TRAINING_DATABASE_FILENAME),
    close: () => withLock(async () => { await ready; closeDatabase(); }),
  };
};
