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

const asString = (value) => String(value ?? '').trim();

const invalidRequest = (message, code) => new AiServiceError(message, { status: 400, code });

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
