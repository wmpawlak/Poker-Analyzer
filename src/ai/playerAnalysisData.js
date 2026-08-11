import {
  buildSessionAnalysisInput,
  validateSessionAnalysis,
} from './sessionAnalysisContract.js';
import { localDateToDateString } from '../utils/dateRange.js';
import {
  PROFILE_GAME_TYPES,
  buildProfileReport,
  normalizeProfileGameType,
} from '../utils/profileReport.js';

export const PLAYER_ANALYSIS_MAX_SESSION_REPORTS = 20;

const asString = (value) => String(value ?? '').trim();

const sessionGameType = (session) => (
  String(session?.type || '').toLowerCase() === 'cash' ? 'cash' : 'tournament'
);

const getActualHands = (session) => (
  Array.isArray(session?.hands)
    ? session.hands.filter((hand) => hand && !hand.isRebuy)
    : []
);

const normalizeSessions = (sessions) => {
  if (Array.isArray(sessions)) return sessions;
  if (!sessions || typeof sessions !== 'object') return [];
  return [
    ...(Array.isArray(sessions.cash) ? sessions.cash : []),
    ...(Array.isArray(sessions.tournament) ? sessions.tournament : []),
  ];
};

const getSessionBounds = (session) => {
  const timestamps = getActualHands(session)
    .map((hand) => Number(hand.timestamp))
    .filter(Number.isFinite);
  if (timestamps.length === 0) return null;
  return {
    fromTimestamp: Math.min(...timestamps),
    toTimestamp: Math.max(...timestamps),
  };
};

const fitsGameType = (session, gameType) => (
  gameType === PROFILE_GAME_TYPES.BOTH || sessionGameType(session) === gameType
);

const fitsWholeDateRange = (bounds, dateRange) => Boolean(bounds)
  && (dateRange.fromTimestamp === null || bounds.fromTimestamp >= dateRange.fromTimestamp)
  && (dateRange.toTimestamp === null || bounds.toTimestamp <= dateRange.toTimestamp);

const reportTimestamp = (report) => {
  const timestamp = Date.parse(report?.analyzedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const getCurrentReports = (reports, sessionInput) => (
  (Array.isArray(reports) ? reports : [])
    .filter((report) => {
      if (!asString(report?.reportId) || report?.fingerprint !== sessionInput.fingerprint) return false;
      try {
        validateSessionAnalysis(report.analysis, sessionInput);
        return true;
      } catch {
        return false;
      }
    })
    .sort((left, right) => (
      reportTimestamp(left) - reportTimestamp(right)
      || asString(left.reportId).localeCompare(asString(right.reportId))
    ))
);

export const selectEvenlySpacedItems = (items, limit = PLAYER_ANALYSIS_MAX_SESSION_REPORTS) => {
  const values = Array.isArray(items) ? items : [];
  const maximum = Math.max(0, Math.floor(Number(limit) || 0));
  if (maximum === 0) return [];
  if (values.length <= maximum) return [...values];
  if (maximum === 1) return [values[Math.floor((values.length - 1) / 2)]];
  return Array.from({ length: maximum }, (_, index) => (
    values[Math.round((index * (values.length - 1)) / (maximum - 1))]
  ));
};

const compactLeak = (mistake) => ({
  title: asString(mistake?.title),
  description: asString(mistake?.description),
  correction: asString(mistake?.correction),
});

const compactSessionEvidence = ({ session, bounds, sessionInput, report }) => {
  const type = sessionGameType(session);
  const sessionId = asString(session.id);
  const reportId = asString(report.reportId);
  return {
    sourceId: `${type}:${sessionId}:${reportId}`,
    type,
    sessionId,
    reportId,
    sessionFingerprint: sessionInput.fingerprint,
    startTime: bounds.fromTimestamp,
    endTime: bounds.toTimestamp,
    date: localDateToDateString(new Date(bounds.fromTimestamp)),
    model: report?.model && typeof report.model === 'object'
      ? { id: asString(report.model.id), name: asString(report.model.name) }
      : null,
    analyzedAt: asString(report.analyzedAt),
    summary: asString(report.analysis.sessionSummary),
    leaks: report.analysis.keyMistakes.map(compactLeak),
  };
};

const emptyCoverageByType = () => ({
  cash: { sessionsInPeriod: 0, availableReports: 0, usedReports: 0 },
  tournament: { sessionsInPeriod: 0, availableReports: 0, usedReports: 0 },
});

export const selectPlayerSessionEvidence = ({
  sessions = [],
  sessionAnalyses = {},
  gameType = PROFILE_GAME_TYPES.BOTH,
  dateRange = { fromTimestamp: null, toTimestamp: null },
  maxReports = PLAYER_ANALYSIS_MAX_SESSION_REPORTS,
} = {}) => {
  const normalizedGameType = normalizeProfileGameType(gameType);
  const eligibleSessions = normalizeSessions(sessions)
    .map((session) => ({ session, bounds: getSessionBounds(session) }))
    .filter(({ session, bounds }) => (
      asString(session?.id)
      && fitsGameType(session, normalizedGameType)
      && fitsWholeDateRange(bounds, dateRange)
    ))
    .sort((left, right) => (
      left.bounds.fromTimestamp - right.bounds.fromTimestamp
      || asString(left.session.id).localeCompare(asString(right.session.id))
    ));

  const candidates = eligibleSessions.flatMap(({ session, bounds }) => {
    const type = sessionGameType(session);
    const sessionInput = buildSessionAnalysisInput({
      sessionId: session.id,
      hands: session.hands,
      gameType: type,
    });
    return getCurrentReports(sessionAnalyses?.[session.id], sessionInput)
      .map((report) => ({ session, bounds, sessionInput, report }));
  }).sort((left, right) => (
    left.bounds.fromTimestamp - right.bounds.fromTimestamp
    || reportTimestamp(left.report) - reportTimestamp(right.report)
    || asString(left.session.id).localeCompare(asString(right.session.id))
    || asString(left.report.reportId).localeCompare(asString(right.report.reportId))
  ));
  const usedCandidates = selectEvenlySpacedItems(candidates, maxReports);
  const byType = emptyCoverageByType();
  eligibleSessions.forEach(({ session }) => {
    byType[sessionGameType(session)].sessionsInPeriod += 1;
  });
  candidates.forEach(({ session }) => {
    byType[sessionGameType(session)].availableReports += 1;
  });
  usedCandidates.forEach(({ session }) => {
    byType[sessionGameType(session)].usedReports += 1;
  });

  return {
    coverage: {
      sessionsInPeriod: eligibleSessions.length,
      availableReports: candidates.length,
      usedReports: usedCandidates.length,
      byGameType: byType,
    },
    reports: usedCandidates.map(compactSessionEvidence),
  };
};

const toSharedMetrics = (metrics) => ({
  gameType: metrics.gameType,
  hands: metrics.hands,
  preflop: metrics.preflop,
  postflop: metrics.postflop,
  showdown: metrics.showdown,
  playerProfile: metrics.playerProfile,
});

const toEconomicMetrics = (metrics) => ({
  hands: metrics.hands,
  totalProfit: metrics.totalProfit,
  winrate: metrics.winrate,
});

const addMetric = (catalog, id, label, metric, unit = null) => {
  if (metric && typeof metric === 'object' && Object.hasOwn(metric, 'value')) {
    catalog[id] = { id, label, ...metric, ...(unit ? { unit } : {}) };
    return;
  }
  catalog[id] = { id, label, value: metric, ...(unit ? { unit } : {}) };
};

const addBehaviorMetrics = (catalog, metrics) => {
  addMetric(catalog, 'shared.hands', 'Liczba rąk', metrics.hands, 'ręce');
  const percentageMetrics = [
    ['preflop.vpip', 'VPIP'],
    ['preflop.pfr', 'PFR'],
    ['preflop.threeBet', '3-bet'],
    ['preflop.foldToThreeBet', 'Fold do 3-betu'],
    ['preflop.fourBet', '4-bet'],
    ['preflop.rfi', 'RFI'],
    ['postflop.cBet', 'C-bet'],
    ['postflop.cBetSrp', 'C-bet w SRP'],
    ['postflop.foldToCBet', 'Fold do C-betu'],
    ['showdown.wtsd', 'WTSD'],
    ['showdown.wsd', 'W$SD'],
  ];
  percentageMetrics.forEach(([path, label]) => {
    const metric = path.split('.').reduce((value, key) => value?.[key], metrics);
    addMetric(catalog, `shared.${path}`, label, metric, '%');
  });
  Object.entries(metrics.preflop.rfiByPosition).forEach(([position, metric]) => {
    addMetric(catalog, `shared.preflop.rfiByPosition.${position}`, `RFI ${position}`, metric, '%');
  });
  ['total', 'flop', 'turn', 'river'].forEach((street) => {
    addMetric(catalog, `shared.postflop.af.${street}`, `AF ${street}`, metrics.postflop.af[street]);
    addMetric(catalog, `shared.postflop.afq.${street}`, `AFq ${street}`, metrics.postflop.afq[street], '%');
  });
};

const addEconomicMetrics = (catalog, type, metrics) => {
  if (!metrics) return;
  const label = type === 'cash' ? 'Cash' : 'Turnieje';
  addMetric(catalog, `${type}.hands`, `Liczba rąk ${label}`, metrics.hands, 'ręce');
  addMetric(
    catalog,
    `${type}.totalProfit`,
    `Wynik ${label}`,
    metrics.totalProfit,
    type === 'cash' ? 'waluta stołu' : 'żetony',
  );
  addMetric(catalog, `${type}.winrate`, `Winrate ${label}`, metrics.winrate);
};

export const createPlayerMetricCatalog = (metrics) => {
  const catalog = {};
  addBehaviorMetrics(catalog, metrics.shared);
  addEconomicMetrics(catalog, 'cash', metrics.cash);
  addEconomicMetrics(catalog, 'tournament', metrics.tournament);
  return catalog;
};

const getActualDateRange = (hands) => {
  const timestamps = hands.map((hand) => Number(hand.timestamp)).filter(Number.isFinite);
  if (timestamps.length === 0) return {
    from: '',
    to: '',
    fromTimestamp: null,
    toTimestamp: null,
  };
  const fromTimestamp = Math.min(...timestamps);
  const toTimestamp = Math.max(...timestamps);
  return {
    from: localDateToDateString(new Date(fromTimestamp)),
    to: localDateToDateString(new Date(toTimestamp)),
    fromTimestamp,
    toTimestamp,
  };
};

const emptyPlayerAnalysisData = ({ gameType, dateFrom, dateTo, datasetRevision, report }) => ({
  isValid: false,
  error: report.error,
  datasetRevision: asString(datasetRevision),
  criteria: { gameType, dateFrom: asString(dateFrom), dateTo: asString(dateTo) },
  actualDateRange: { from: '', to: '', fromTimestamp: null, toTimestamp: null },
  handCount: 0,
  sessionCount: 0,
  cashHandCount: 0,
  tournamentHandCount: 0,
  metrics: null,
  profileStyleId: 'INSUFFICIENT',
  profileStyle: null,
  reliabilityId: 'INSUFFICIENT',
  reliability: null,
  metricCatalog: {},
  sessionEvidence: {
    coverage: {
      sessionsInPeriod: 0,
      availableReports: 0,
      usedReports: 0,
      byGameType: emptyCoverageByType(),
    },
    reports: [],
  },
});

export const buildPlayerAnalysisData = ({
  hands = [],
  sessions = [],
  sessionAnalyses = {},
  gameType = PROFILE_GAME_TYPES.BOTH,
  dateFrom = '',
  dateTo = '',
  datasetRevision = '',
  maxSessionReports = PLAYER_ANALYSIS_MAX_SESSION_REPORTS,
} = {}) => {
  const normalizedGameType = normalizeProfileGameType(gameType);
  const actualHands = Array.isArray(hands) ? hands : [];
  const report = buildProfileReport({
    cashHands: normalizedGameType === PROFILE_GAME_TYPES.TOURNAMENT
      ? []
      : actualHands.filter((hand) => hand && !hand.isTournament),
    tournamentHands: normalizedGameType === PROFILE_GAME_TYPES.CASH
      ? []
      : actualHands.filter((hand) => hand?.isTournament),
    gameType: normalizedGameType,
    dateFrom,
    dateTo,
  });
  if (!report.isValid) {
    return emptyPlayerAnalysisData({
      gameType: normalizedGameType,
      dateFrom,
      dateTo,
      datasetRevision,
      report,
    });
  }

  const metrics = {
    shared: toSharedMetrics(report.metrics),
    ...(normalizedGameType !== PROFILE_GAME_TYPES.TOURNAMENT
      ? { cash: toEconomicMetrics(report.cashMetrics) }
      : {}),
    ...(normalizedGameType !== PROFILE_GAME_TYPES.CASH
      ? { tournament: toEconomicMetrics(report.tournamentMetrics) }
      : {}),
  };
  const profile = report.metrics.playerProfile;
  const selectedSessionIds = new Set(report.hands.map((hand) => asString(hand.sessionId)).filter(Boolean));
  const sessionEvidence = selectPlayerSessionEvidence({
    sessions,
    sessionAnalyses,
    gameType: normalizedGameType,
    dateRange: report.dateRange,
    maxReports: maxSessionReports,
  });

  return {
    isValid: true,
    error: null,
    datasetRevision: asString(datasetRevision),
    criteria: {
      gameType: normalizedGameType,
      dateFrom: asString(dateFrom),
      dateTo: asString(dateTo),
    },
    actualDateRange: getActualDateRange(report.hands),
    handCount: report.hands.length,
    sessionCount: selectedSessionIds.size,
    cashHandCount: report.cashHands.length,
    tournamentHandCount: report.tournamentHands.length,
    metrics,
    profileStyleId: profile?.style?.id || 'INSUFFICIENT',
    profileStyle: profile?.style || null,
    reliabilityId: profile?.reliability?.id || 'INSUFFICIENT',
    reliability: profile?.reliability || null,
    metricCatalog: createPlayerMetricCatalog(metrics),
    sessionEvidence,
  };
};
