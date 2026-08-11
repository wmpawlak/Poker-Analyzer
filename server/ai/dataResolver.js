import {
  buildSessionAnalysisInput,
  validateSessionAnalysis,
} from '../../src/ai/sessionAnalysisContract.js';
import {
  buildSessionGroupAnalysisInput,
  buildSessionGroupPreview,
} from '../../src/ai/sessionGroupAnalysisContract.js';
import { readAiAnalysesCache } from '../aiAnalysesCache.js';
import { AiServiceError } from './errors.js';
import { buildPlayerAnalysisData } from '../../src/ai/playerAnalysisData.js';
import {
  PLAYER_ANALYSIS_FULL_RELIABILITY_HANDS,
  PLAYER_ANALYSIS_MIN_HANDS,
  buildPlayerAnalysisInput,
} from '../../src/ai/playerAnalysisContract.js';

const asString = (value) => String(value ?? '').trim();

const invalidRequest = (message, code) => new AiServiceError(message, { status: 400, code });

const PLAYER_GAME_TYPES = new Set(['cash', 'tournament', 'both']);

const sessionType = (session) => (
  String(session?.type || '').toLowerCase() === 'cash' ? 'cash' : 'tournament'
);

const assertDatasetRevision = (requestedRevision, snapshot) => {
  const expectedRevision = asString(requestedRevision);
  if (!expectedRevision) {
    throw invalidRequest('Żądanie analizy wymaga datasetRevision.', 'DATASET_REVISION_REQUIRED');
  }
  if (expectedRevision !== snapshot.datasetRevision) {
    throw new AiServiceError(
      'Dane pokerowe zmieniły się. Odśwież widok i świadomie ponów analizę.',
      { status: 409, code: 'DATASET_REVISION_MISMATCH' },
    );
  }
};

const normalizePlayerCriteria = ({ gameType, dateFrom, dateTo } = {}) => {
  const normalizedGameType = asString(gameType).toLowerCase() || 'both';
  if (!PLAYER_GAME_TYPES.has(normalizedGameType)) {
    throw invalidRequest('Typ gry analizy gracza musi mieć wartość cash, tournament albo both.', 'AI_PLAYER_GAME_TYPE_INVALID');
  }
  return {
    gameType: normalizedGameType,
    dateFrom: asString(dateFrom),
    dateTo: asString(dateTo),
  };
};

const getPlayerSampleState = (handCount) => {
  if (handCount < PLAYER_ANALYSIS_MIN_HANDS) {
    return {
      canAnalyze: false,
      warning: `Analiza AI wymaga co najmniej ${PLAYER_ANALYSIS_MIN_HANDS} rąk.`,
    };
  }
  if (handCount < PLAYER_ANALYSIS_FULL_RELIABILITY_HANDS) {
    return {
      canAnalyze: true,
      warning: `Próba poniżej ${PLAYER_ANALYSIS_FULL_RELIABILITY_HANDS} rąk daje wyłącznie wstępny profil.`,
    };
  }
  return { canAnalyze: true, warning: null };
};

export const createPlayerAnalysisResponseData = (player, { includeReports = false } = {}) => ({
  datasetRevision: player.datasetRevision,
  criteria: player.criteria,
  actualDateRange: player.actualDateRange,
  handCount: player.handCount,
  sessionCount: player.sessionCount,
  cashHandCount: player.cashHandCount,
  tournamentHandCount: player.tournamentHandCount,
  metrics: player.metrics,
  profileStyleId: player.profileStyleId,
  profileStyle: player.profileStyle,
  reliabilityId: player.reliabilityId,
  reliability: player.reliability,
  metricCatalog: player.metricCatalog,
  sessionEvidence: includeReports
    ? player.sessionEvidence
    : { coverage: player.sessionEvidence.coverage },
  ...getPlayerSampleState(player.handCount),
});

const buildCanonicalPlayerData = async ({
  snapshot,
  dataDirectory,
  criteria,
}) => {
  const cache = await readAiAnalysesCache(dataDirectory);
  const player = buildPlayerAnalysisData({
    hands: snapshot.hands,
    sessions: snapshot.sessions,
    sessionAnalyses: cache.sessionAnalyses,
    datasetRevision: snapshot.datasetRevision,
    ...criteria,
  });
  if (!player.isValid) {
    throw invalidRequest(player.error || 'Zakres dat analizy gracza jest nieprawidłowy.', 'AI_PLAYER_DATE_RANGE_INVALID');
  }
  return player;
};

const getValidatedSnapshot = async ({ dataIndex, datasetRevision }) => {
  const snapshot = await dataIndex.getSnapshot();
  assertDatasetRevision(datasetRevision, snapshot);
  return snapshot;
};

const toSessionInput = (session) => buildSessionAnalysisInput({
  sessionId: session.id,
  hands: session.hands,
  gameType: sessionType(session),
});

const getCurrentSessionReport = (reports, sessionInput) => (
  [...(Array.isArray(reports) ? reports : [])]
    .reverse()
    .find((report) => {
      if (report?.fingerprint !== sessionInput.fingerprint) return false;
      try {
        validateSessionAnalysis(report.analysis, sessionInput);
        return true;
      } catch {
        return false;
      }
    }) || null
);

const toGroupCandidate = ({ session, sessionInput, report }) => {
  const type = sessionType(session);
  const isCash = type === 'cash';
  return {
    sourceId: `${type}:${session.id}`,
    type,
    sessionId: String(session.id),
    startTime: session.startTime,
    date: session.dateStr || '',
    label: isCash
      ? `Stół ${session.tableId || 'Nieznany'}`
      : `${session.tourneyName || 'Nieznany turniej'} #${session.tourneyId || 'Nieznane ID'}`,
    tableId: isCash ? session.tableId || '' : undefined,
    tournamentId: isCash ? undefined : session.tourneyId || '',
    tournamentName: isCash ? undefined : session.tourneyName || '',
    hands: session.hands,
    sessionFingerprint: sessionInput.fingerprint,
    report,
  };
};

export const resolveHandAnalysisData = async ({ dataIndex, handId, datasetRevision }) => {
  const normalizedHandId = asString(handId);
  if (!normalizedHandId) {
    throw invalidRequest('Żądanie analizy wymaga handId.', 'AI_HAND_ID_REQUIRED');
  }
  const snapshot = await getValidatedSnapshot({ dataIndex, datasetRevision });
  const result = await dataIndex.readHand(normalizedHandId);
  if (!result?.hand) {
    throw new AiServiceError('Nie znaleziono rozdania do analizy.', {
      status: 404,
      code: 'HAND_NOT_FOUND',
    });
  }
  if (result.datasetRevision !== snapshot.datasetRevision) {
    throw new AiServiceError(
      'Dane pokerowe zmieniły się podczas przygotowania analizy. Odśwież widok i ponów żądanie.',
      { status: 409, code: 'DATASET_REVISION_MISMATCH' },
    );
  }
  return { datasetRevision: snapshot.datasetRevision, hand: result.hand };
};

export const resolveSessionAnalysisData = async ({ dataIndex, sessionId, datasetRevision }) => {
  const normalizedSessionId = asString(sessionId);
  if (!normalizedSessionId) {
    throw invalidRequest('Żądanie analizy wymaga sessionId.', 'AI_SESSION_ID_REQUIRED');
  }
  const snapshot = await getValidatedSnapshot({ dataIndex, datasetRevision });
  const session = snapshot.sessionsById.get(normalizedSessionId);
  if (!session) {
    throw new AiServiceError('Nie znaleziono sesji do analizy.', {
      status: 404,
      code: 'SESSION_NOT_FOUND',
    });
  }
  const sessionInput = toSessionInput(session);
  return { datasetRevision: snapshot.datasetRevision, session: sessionInput };
};

export const resolvePlayerAnalysisPreviewData = async ({
  dataIndex,
  dataDirectory,
  gameType,
  dateFrom,
  dateTo,
}) => {
  const criteria = normalizePlayerCriteria({ gameType, dateFrom, dateTo });
  const snapshot = await dataIndex.getSnapshot();
  const player = await buildCanonicalPlayerData({ snapshot, dataDirectory, criteria });
  return {
    datasetRevision: snapshot.datasetRevision,
    player,
    preview: createPlayerAnalysisResponseData(player),
  };
};

export const resolvePlayerAnalysisData = async ({
  dataIndex,
  dataDirectory,
  gameType,
  dateFrom,
  dateTo,
  datasetRevision,
}) => {
  const criteria = normalizePlayerCriteria({ gameType, dateFrom, dateTo });
  const snapshot = await getValidatedSnapshot({ dataIndex, datasetRevision });
  const player = await buildCanonicalPlayerData({ snapshot, dataDirectory, criteria });
  if (player.handCount < PLAYER_ANALYSIS_MIN_HANDS) {
    throw invalidRequest(
      `Analiza AI gracza wymaga co najmniej ${PLAYER_ANALYSIS_MIN_HANDS} rąk; wybrany zakres zawiera ${player.handCount}.`,
      'AI_PLAYER_SAMPLE_TOO_SMALL',
    );
  }
  let playerInput;
  try {
    playerInput = buildPlayerAnalysisInput(player);
  } catch (error) {
    throw new AiServiceError(error.message, {
      status: error.code === 'AI_PLAYER_ANALYSIS_TOO_LARGE' ? 413 : 400,
      code: error.code || 'AI_INVALID_PLAYER_ANALYSIS',
      cause: error,
    });
  }
  return {
    datasetRevision: snapshot.datasetRevision,
    player,
    playerInput,
  };
};

export const resolveSessionGroupAnalysisData = async ({
  dataIndex,
  dataDirectory,
  sessionIds,
  datasetRevision,
}) => {
  if (!Array.isArray(sessionIds) || sessionIds.length < 2) {
    throw invalidRequest(
      'Analiza wielu sesji wymaga co najmniej dwóch sessionIds.',
      'AI_SESSION_IDS_REQUIRED',
    );
  }
  const normalizedIds = sessionIds.map(asString);
  if (normalizedIds.some((sessionId) => !sessionId)
    || new Set(normalizedIds).size !== normalizedIds.length) {
    throw invalidRequest(
      'Analiza wielu sesji nie może zawierać pustych ani powielonych sessionIds.',
      'AI_SESSION_IDS_INVALID',
    );
  }

  const snapshot = await getValidatedSnapshot({ dataIndex, datasetRevision });
  const cache = await readAiAnalysesCache(dataDirectory);
  const candidates = normalizedIds.map((sessionId) => {
    const session = snapshot.sessionsById.get(sessionId);
    if (!session) {
      throw new AiServiceError(`Nie znaleziono sesji ${sessionId} do analizy.`, {
        status: 404,
        code: 'SESSION_NOT_FOUND',
      });
    }
    const sessionInput = toSessionInput(session);
    const report = getCurrentSessionReport(cache.sessionAnalyses[sessionId], sessionInput);
    if (!report) {
      throw new AiServiceError(
        `Sesja ${sessionId} nie ma aktualnego raportu AI. Najpierw przeanalizuj tę sesję.`,
        { status: 409, code: 'AI_SESSION_REPORT_REQUIRED' },
      );
    }
    return toGroupCandidate({ session, sessionInput, report });
  });
  const types = new Set(candidates.map((candidate) => candidate.type));
  const activeCategory = types.size === 1 ? candidates[0].type : 'both';
  const group = buildSessionGroupAnalysisInput({
    sources: candidates,
    activeCategory,
    dateRange: {},
  });
  return { datasetRevision: snapshot.datasetRevision, group };
};

export const resolveSessionGroupPreviewData = async ({
  dataIndex,
  sessionIds,
  datasetRevision,
}) => {
  if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
    throw invalidRequest(
      'Podgląd analizy wielu sesji wymaga co najmniej jednego sessionId.',
      'AI_SESSION_IDS_REQUIRED',
    );
  }
  const normalizedIds = sessionIds.map(asString);
  if (normalizedIds.some((sessionId) => !sessionId)
    || new Set(normalizedIds).size !== normalizedIds.length) {
    throw invalidRequest(
      'Podgląd analizy wielu sesji nie może zawierać pustych ani powielonych sessionIds.',
      'AI_SESSION_IDS_INVALID',
    );
  }
  const snapshot = await getValidatedSnapshot({ dataIndex, datasetRevision });
  const candidates = normalizedIds.map((sessionId) => {
    const session = snapshot.sessionsById.get(sessionId);
    if (!session) {
      throw new AiServiceError(`Nie znaleziono sesji ${sessionId} do podglądu.`, {
        status: 404,
        code: 'SESSION_NOT_FOUND',
      });
    }
    return toGroupCandidate({ session, sessionInput: toSessionInput(session), report: null });
  });
  return {
    datasetRevision: snapshot.datasetRevision,
    preview: buildSessionGroupPreview({ sources: candidates }),
  };
};
