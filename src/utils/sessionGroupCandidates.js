import {
  buildSessionAnalysisInput,
  validateSessionAnalysis,
} from '../ai/sessionAnalysisContract.js';
import { getProfileDateRange, normalizeProfileGameType } from './profileReport.js';

export const SESSION_GROUP_SOURCE_TYPES = Object.freeze({
  CASH: 'cash',
  TOURNAMENT: 'tournament',
});

const toTimestamp = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

const getCurrentReport = (history, sessionInput) => (
  [...(Array.isArray(history) ? history : [])]
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

const isInDateRange = (startTime, dateRange) => (
  (dateRange.fromTimestamp === null || startTime >= dateRange.fromTimestamp)
  && (dateRange.toTimestamp === null || startTime <= dateRange.toTimestamp)
);

const createCandidate = ({ session, type, sessionAiAnalyses }) => {
  const hands = (Array.isArray(session?.hands) ? session.hands : []).filter((hand) => hand && !hand.isRebuy);
  const sessionInput = buildSessionAnalysisInput({
    sessionId: session?.id,
    hands,
    gameType: type,
  });
  const report = getCurrentReport(sessionAiAnalyses?.[session?.id], sessionInput);
  const isCash = type === SESSION_GROUP_SOURCE_TYPES.CASH;

  return {
    sourceId: `${type}:${session?.id || ''}`,
    type,
    sessionId: String(session?.id || ''),
    startTime: toTimestamp(session?.startTime),
    date: session?.dateStr || '',
    label: isCash
      ? `Stół ${session?.tableId || 'Nieznany'}`
      : `${session?.tourneyName || 'Nieznany turniej'} #${session?.tourneyId || 'Nieznane ID'}`,
    tableId: isCash ? session?.tableId || '' : undefined,
    tournamentId: isCash ? undefined : session?.tourneyId || '',
    tournamentName: isCash ? undefined : session?.tourneyName || '',
    hands,
    handCount: hands.length,
    sessionFingerprint: sessionInput.fingerprint,
    report,
    reportId: report?.reportId || '',
    reportFingerprint: report?.fingerprint || '',
    reportModel: report?.model || null,
    reportAnalyzedAt: report?.analyzedAt || '',
  };
};

export const buildSessionGroupCandidates = ({
  sessions = [],
  tournaments = [],
  sessionAiAnalyses = {},
  gameType = 'both',
  dateFrom = '',
  dateTo = '',
} = {}) => {
  const normalizedGameType = normalizeProfileGameType(gameType);
  const dateRange = getProfileDateRange(dateFrom, dateTo);
  if (!dateRange.valid) {
    return { candidates: [], dateRange, gameType: normalizedGameType };
  }

  const allCandidates = [
    ...(Array.isArray(sessions) ? sessions : []).map((session) => createCandidate({
      session,
      type: SESSION_GROUP_SOURCE_TYPES.CASH,
      sessionAiAnalyses,
    })),
    ...(Array.isArray(tournaments) ? tournaments : []).map((session) => createCandidate({
      session,
      type: SESSION_GROUP_SOURCE_TYPES.TOURNAMENT,
      sessionAiAnalyses,
    })),
  ];

  const candidates = allCandidates
    .filter((candidate) => candidate.sessionId && candidate.hands.length > 0 && candidate.report)
    .filter((candidate) => (
      normalizedGameType === 'both' || candidate.type === normalizedGameType
    ))
    .filter((candidate) => isInDateRange(candidate.startTime, dateRange))
    .sort((left, right) => (
      right.startTime - left.startTime
      || left.type.localeCompare(right.type)
      || left.sessionId.localeCompare(right.sessionId)
    ));

  return { candidates, dateRange, gameType: normalizedGameType };
};

export const getCurrentGroupSourceMap = (candidates = []) => new Map(
  (Array.isArray(candidates) ? candidates : []).map((candidate) => [candidate.sourceId, candidate]),
);

export const buildSessionGroupSourceAvailability = ({ sessions = [], tournaments = [] } = {}) => new Map([
  ...(Array.isArray(sessions) ? sessions : []).map((session) => ({
    sourceId: `${SESSION_GROUP_SOURCE_TYPES.CASH}:${session?.id || ''}`,
    type: SESSION_GROUP_SOURCE_TYPES.CASH,
    sessionId: String(session?.id || ''),
    hands: (Array.isArray(session?.hands) ? session.hands : []).filter((hand) => hand && !hand.isRebuy),
  })),
  ...(Array.isArray(tournaments) ? tournaments : []).map((session) => ({
    sourceId: `${SESSION_GROUP_SOURCE_TYPES.TOURNAMENT}:${session?.id || ''}`,
    type: SESSION_GROUP_SOURCE_TYPES.TOURNAMENT,
    sessionId: String(session?.id || ''),
    hands: (Array.isArray(session?.hands) ? session.hands : []).filter((hand) => hand && !hand.isRebuy),
  })),
].filter((source) => source.sessionId).map((source) => [source.sourceId, source]));

export const isSessionGroupReportCurrent = (report, candidates = []) => {
  const sourceSnapshots = Array.isArray(report?.sources)
    ? report.sources
    : Array.isArray(report?.sourceReports) ? report.sourceReports : [];
  if (sourceSnapshots.length < 2) return false;
  const currentBySourceId = getCurrentGroupSourceMap(candidates);
  return sourceSnapshots.every((snapshot) => {
    const current = currentBySourceId.get(snapshot?.sourceId);
    return current
      && current.sessionFingerprint === snapshot.sessionFingerprint
      && current.reportFingerprint === snapshot.reportFingerprint
      && current.reportId === snapshot.reportId;
  });
};
