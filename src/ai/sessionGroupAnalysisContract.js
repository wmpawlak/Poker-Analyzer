import {
  SESSION_ANALYSIS_MAX_BYTES,
  buildSessionAnalysisInput,
  createSessionFingerprint,
  stableStringify,
  validateSessionAnalysis,
} from './sessionAnalysisContract.js';
import { calculateSessionMetrics } from '../utils/sessionMetrics.js';
import { getProfileDateRange } from '../utils/profileReport.js';

export const SESSION_GROUP_ANALYSIS_MAX_BYTES = SESSION_ANALYSIS_MAX_BYTES;
export const SESSION_GROUP_SOURCE_TYPES = Object.freeze(['cash', 'tournament']);
export const SESSION_GROUP_CATEGORY_TYPES = Object.freeze(['both', ...SESSION_GROUP_SOURCE_TYPES]);

const SESSION_STYLE_IDS = new Set([
  'TAG', 'LAG', 'NIT_ROCK', 'LOOSE_PASSIVE', 'TIGHT_PASSIVE', 'MANIAC',
  'WEAK_TIGHT', 'BALANCED', 'RECREATIONAL', 'MIXED', 'INSUFFICIENT',
]);

const asString = (value) => String(value ?? '').trim();
const asFiniteNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const unique = (items) => [...new Set(items)];
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const hasExactKeys = (value, keys) => (
  isObject(value)
  && Object.keys(value).every((key) => keys.includes(key))
  && keys.every((key) => Object.hasOwn(value, key))
);

const createGroupError = (message, code = 'AI_INVALID_SESSION_GROUP') => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const normalizeType = (value) => {
  const type = asString(value).toLowerCase();
  return SESSION_GROUP_SOURCE_TYPES.includes(type) ? type : '';
};

const normalizeCategory = (value) => {
  const category = asString(value).toLowerCase();
  return SESSION_GROUP_CATEGORY_TYPES.includes(category) ? category : '';
};

const SESSION_REPORT_ANALYSIS_KEYS = ['profileStyleId', 'sessionSummary', 'keyMistakes', 'notableHands'];
const SESSION_REPORT_MISTAKE_KEYS = ['title', 'description', 'correction', 'handIds'];
const SESSION_REPORT_NOTABLE_HAND_KEYS = ['handId', 'reason'];

const getSentenceCount = (value) => asString(value)
  .split(/[.!?]+/)
  .filter((sentence) => sentence.trim())
  .length;

const normalizeReportModel = (model) => {
  if (!isObject(model)) return null;
  const id = asString(model.id);
  const name = asString(model.name);
  return id || name ? { id, name } : null;
};

const normalizeSourceReportAnalysis = (analysis, sessionInput = null) => {
  if (!hasExactKeys(analysis, SESSION_REPORT_ANALYSIS_KEYS)) {
    throw createGroupError('Snapshot raportu źródłowego ma nieprawidłowy format.');
  }
  const profileStyleId = asString(analysis.profileStyleId);
  const sessionSummary = asString(analysis.sessionSummary);
  if (!SESSION_STYLE_IDS.has(profileStyleId) || getSentenceCount(sessionSummary) < 2 || getSentenceCount(sessionSummary) > 4) {
    throw createGroupError('Snapshot raportu źródłowego ma nieprawidłowy styl lub podsumowanie.');
  }
  const keyMistakes = Array.isArray(analysis.keyMistakes) ? analysis.keyMistakes : [];
  const notableHands = Array.isArray(analysis.notableHands) ? analysis.notableHands : [];
  if (keyMistakes.length > 5 || notableHands.length === 0 || notableHands.length > 5) {
    throw createGroupError('Snapshot raportu źródłowego ma nieprawidłową liczbę wniosków.');
  }
  const mistakeTitles = new Set();
  const normalizedMistakes = keyMistakes.map((mistake) => {
    if (!hasExactKeys(mistake, SESSION_REPORT_MISTAKE_KEYS)) {
      throw createGroupError('Snapshot raportu źródłowego ma nieprawidłowy błąd sesji.');
    }
    const title = asString(mistake.title);
    const description = asString(mistake.description);
    const correction = asString(mistake.correction);
    const handIds = Array.isArray(mistake.handIds) ? mistake.handIds.map(asString).filter(Boolean) : [];
    const normalizedTitle = title.toLocaleLowerCase('pl');
    if (!title || !description || !correction || mistakeTitles.has(normalizedTitle)
      || handIds.length < 2 || handIds.length > 3 || unique(handIds).length !== handIds.length) {
      throw createGroupError('Snapshot raportu źródłowego ma nieprawidłowy błąd sesji.');
    }
    mistakeTitles.add(normalizedTitle);
    return { title, description, correction, handIds };
  });
  const normalizedNotableHands = notableHands.map((hand) => {
    if (!hasExactKeys(hand, SESSION_REPORT_NOTABLE_HAND_KEYS)) {
      throw createGroupError('Snapshot raportu źródłowego ma nieprawidłową istotną rękę.');
    }
    const handId = asString(hand.handId);
    const reason = asString(hand.reason);
    if (!handId || !reason) {
      throw createGroupError('Snapshot raportu źródłowego ma nieprawidłową istotną rękę.');
    }
    return { handId, reason };
  });
  const notableIds = normalizedNotableHands.map((hand) => hand.handId);
  if (unique(notableIds).length !== notableIds.length) {
    throw createGroupError('Snapshot raportu źródłowego powtarza istotne ręce.');
  }
  const normalized = {
    profileStyleId,
    sessionSummary,
    keyMistakes: normalizedMistakes,
    notableHands: normalizedNotableHands,
  };
  if (sessionInput) {
    try {
      validateSessionAnalysis(normalized, sessionInput);
    } catch (error) {
      throw createGroupError(error.message);
    }
  }
  return normalized;
};

const normalizeDateRange = (dateRange = {}) => ({
  from: asString(dateRange?.from ?? dateRange?.dateFrom),
  to: asString(dateRange?.to ?? dateRange?.dateTo),
});

const readReportHandIds = (analysis = {}) => unique([
  ...(Array.isArray(analysis?.keyMistakes)
    ? analysis.keyMistakes.flatMap((mistake) => Array.isArray(mistake?.handIds) ? mistake.handIds : [])
    : []),
  ...(Array.isArray(analysis?.notableHands)
    ? analysis.notableHands.map((hand) => hand?.handId)
    : []),
].map(asString).filter(Boolean)).sort();

const getProfileStyleId = (metrics) => metrics?.playerProfile?.style?.id || 'INSUFFICIENT';

const getReliability = (metrics) => ({
  id: asString(metrics?.playerProfile?.reliability?.id) || 'INSUFFICIENT',
  label: asString(metrics?.playerProfile?.reliability?.label) || 'Za mała próba',
  minimumHands: asFiniteNumber(metrics?.playerProfile?.reliability?.minimumHands),
});

const comparableMetrics = (metrics) => ({
  hands: asFiniteNumber(metrics?.hands),
  vpip: metrics?.preflop?.vpip || null,
  pfr: metrics?.preflop?.pfr || null,
  threeBet: metrics?.preflop?.threeBet || null,
  rfi: metrics?.preflop?.rfi || null,
  af: metrics?.postflop?.af?.total || null,
  afq: metrics?.postflop?.afq?.total || null,
  cBet: metrics?.postflop?.cBet || null,
  wtsd: metrics?.showdown?.wtsd || null,
  wsd: metrics?.showdown?.wsd || null,
  profileStyleId: getProfileStyleId(metrics),
  reliability: getReliability(metrics),
});

const categoryMetrics = (metrics) => ({
  ...comparableMetrics(metrics),
  totalProfit: asFiniteNumber(metrics?.totalProfit),
  winrate: metrics?.winrate || null,
});

const previewDateFromSource = (source) => {
  const date = asString(source?.metadata?.date).replaceAll('/', '-');
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const timestamp = asFiniteNumber(source?.metadata?.startTime);
  return timestamp ? new Date(timestamp).toISOString().slice(0, 10) : '';
};

const toSafeGroupSource = (source) => {
  const metadata = source?.metadata || {};
  const safe = {
    sourceId: asString(source?.sourceId),
    type: normalizeType(source?.type),
    sessionId: asString(source?.sessionId),
    sessionFingerprint: asString(source?.sessionFingerprint),
    metadata: {
      label: asString(metadata.label),
      date: asString(metadata.date),
      startTime: asFiniteNumber(metadata.startTime),
      handCount: asFiniteNumber(metadata.handCount),
      tableId: asString(metadata.tableId),
      tournamentId: asString(metadata.tournamentId),
      tournamentName: asString(metadata.tournamentName),
    },
  };
  const reportId = asString(source?.reportId);
  const reportFingerprint = asString(source?.reportFingerprint);
  return {
    ...safe,
    ...(reportId ? { reportId } : {}),
    ...(reportFingerprint ? { reportFingerprint } : {}),
  };
};

const buildCategoryBreakdown = (sources) => Object.fromEntries(
  SESSION_GROUP_SOURCE_TYPES.map((type) => {
    const categorySources = sources.filter((source) => source.type === type);
    return [type, {
      sessionCount: categorySources.length,
      handCount: categorySources.reduce((total, source) => total + Number(source.metadata.handCount), 0),
    }];
  }),
);

export const createSessionGroupMetadata = ({
  activeCategory = 'both',
  dateRange = {},
  sources = [],
  metrics = {},
} = {}) => {
  const safeSources = sortSources(sources).map(toSafeGroupSource);
  return {
    activeCategory: normalizeCategory(activeCategory) || 'both',
    dateRange: normalizeDateRange(dateRange),
    sources: safeSources,
    sessionCount: safeSources.length,
    handCount: asFiniteNumber(metrics?.shared?.hands)
      || safeSources.reduce((total, source) => total + Number(source.metadata.handCount), 0),
    categoryBreakdown: buildCategoryBreakdown(safeSources),
  };
};

const compactPreviewSourceFromCandidate = (candidate) => {
  const type = normalizeType(candidate?.type);
  const sessionId = asString(candidate?.sessionId);
  const sourceId = asString(candidate?.sourceId) || `${type}:${sessionId}`;
  const sessionFingerprint = asString(candidate?.sessionFingerprint);
  const hands = (Array.isArray(candidate?.hands) ? candidate.hands : [])
    .filter((hand) => hand && !hand.isRebuy);
  if (!type || !sessionId || !sessionFingerprint || sourceId !== `${type}:${sessionId}`) {
    throw createGroupError('Podgląd analizy wielu sesji zawiera nieprawidłowe źródło.');
  }
  if (hands.length === 0 || hands.some((hand) => !asString(hand?.id))) {
    throw createGroupError('Podgląd analizy wielu sesji wymaga sesji z prawdziwymi rozdaniami.');
  }
  return {
    source: {
      sourceId,
      type,
      sessionId,
      sessionFingerprint,
      metadata: {
        label: asString(candidate?.label),
        date: asString(candidate?.date),
        startTime: asFiniteNumber(candidate?.startTime),
        handCount: hands.length,
        tableId: asString(candidate?.tableId),
        tournamentId: asString(candidate?.tournamentId),
        tournamentName: asString(candidate?.tournamentName),
      },
    },
    hands,
  };
};

export const buildSessionGroupPreview = ({ sources = [] } = {}) => {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw createGroupError('Podgląd analizy wielu sesji wymaga co najmniej jednej sesji.', 'AI_SESSION_IDS_REQUIRED');
  }
  const compactSources = sources.map(compactPreviewSourceFromCandidate);
  const sortedSources = [...compactSources].sort((left, right) => (
    left.source.type.localeCompare(right.source.type)
    || left.source.sessionId.localeCompare(right.source.sessionId)
  ));
  const sourceIds = sortedSources.map(({ source }) => source.sourceId);
  if (unique(sourceIds).length !== sourceIds.length) {
    throw createGroupError('Podgląd analizy wielu sesji nie może zawierać powielonych źródeł.');
  }
  const allHands = sortedSources.flatMap(({ hands }) => hands);
  const cashHands = sortedSources.filter(({ source }) => source.type === 'cash').flatMap(({ hands }) => hands);
  const tournamentHands = sortedSources.filter(({ source }) => source.type === 'tournament').flatMap(({ hands }) => hands);
  const sourceTypes = new Set(sortedSources.map(({ source }) => source.type));
  const metrics = {
    shared: comparableMetrics(calculateSessionMetrics(allHands, 'mixed')),
    ...(cashHands.length > 0 ? { cash: categoryMetrics(calculateSessionMetrics(cashHands, 'cash')) } : {}),
    ...(tournamentHands.length > 0 ? { tournament: categoryMetrics(calculateSessionMetrics(tournamentHands, 'tournament')) } : {}),
  };
  const dates = sortedSources.map(({ source }) => previewDateFromSource(source)).filter(Boolean).sort();
  const metadata = createSessionGroupMetadata({
    activeCategory: sourceTypes.size === 1 ? sortedSources[0].source.type : 'both',
    dateRange: { from: dates[0] || '', to: dates.at(-1) || '' },
    sources: sortedSources.map(({ source }) => source),
    metrics,
  });
  return { ...metadata, metrics };
};

const SHARED_METRIC_KEYS = [
  'hands', 'vpip', 'pfr', 'threeBet', 'rfi', 'af', 'afq', 'cBet', 'wtsd', 'wsd',
  'profileStyleId', 'reliability',
];
const CATEGORY_METRIC_KEYS = [...SHARED_METRIC_KEYS, 'totalProfit', 'winrate'];
const COMPARABLE_METRIC_KEYS = ['vpip', 'pfr', 'threeBet', 'rfi', 'af', 'afq', 'cBet', 'wtsd', 'wsd'];
const PERCENTAGE_METRIC_KEYS = ['value', 'opportunities', 'executions'];
const AGGRESSION_METRIC_KEYS = ['value', 'betsRaises', 'calls'];
const RELIABILITY_METRIC_KEYS = ['id', 'label', 'minimumHands'];
const WINRATE_METRIC_KEYS = ['value', 'unit', 'numerator', 'denominator'];

const normalizeMetricValue = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value === '—' || value === '∞') return value;
  throw createGroupError('Analiza wielu sesji ma nieprawidłową wartość metryki.');
};

const normalizeComparableMetric = (metric, kind) => {
  if (!isObject(metric) || !Object.hasOwn(metric, 'value')) {
    throw createGroupError('Analiza wielu sesji ma nieprawidłową porównywalną metrykę.');
  }
  const keys = kind === 'aggression' ? AGGRESSION_METRIC_KEYS : PERCENTAGE_METRIC_KEYS;
  if (!hasExactKeys(metric, keys)) {
    throw createGroupError('Analiza wielu sesji ma nieprawidłowy zakres porównywalnej metryki.');
  }
  const numeratorKey = kind === 'aggression' ? 'betsRaises' : 'opportunities';
  const denominatorKey = kind === 'aggression' ? 'calls' : 'executions';
  if (!Number.isFinite(Number(metric[numeratorKey])) || Number(metric[numeratorKey]) < 0
    || !Number.isFinite(Number(metric[denominatorKey])) || Number(metric[denominatorKey]) < 0) {
    throw createGroupError('Analiza wielu sesji ma nieprawidłowe liczniki metryki.');
  }
  return {
    value: normalizeMetricValue(metric.value),
    [numeratorKey]: Number(metric[numeratorKey]),
    [denominatorKey]: Number(metric[denominatorKey]),
  };
};

const expectedReliability = (hands) => {
  if (hands < 30) return { id: 'INSUFFICIENT', label: 'Za mała próba', minimumHands: 30 };
  if (hands < 100) return { id: 'PRELIMINARY', label: 'Wstępny profil', minimumHands: 30 };
  return { id: 'STATISTICAL', label: 'Profil statystyczny', minimumHands: 100 };
};

const normalizeReliability = (reliability, expectedHands) => {
  const expected = expectedReliability(expectedHands);
  if (!hasExactKeys(reliability, RELIABILITY_METRIC_KEYS)
    || asString(reliability.id) !== expected.id
    || asString(reliability.label) !== expected.label
    || !Number.isFinite(Number(reliability.minimumHands))
    || Number(reliability.minimumHands) !== expected.minimumHands) {
    throw createGroupError('Analiza wielu sesji ma nieprawidłową lokalną wiarygodność.');
  }
  return expected;
};

const normalizeWinrate = (winrate, expectedUnit, expectedHands) => {
  if (!hasExactKeys(winrate, WINRATE_METRIC_KEYS)
    || asString(winrate.unit) !== expectedUnit
    || !Number.isFinite(Number(winrate.denominator))
    || Number(winrate.denominator) !== expectedHands) {
    throw createGroupError('Metryki kategorii muszą zachować właściwy wynik i jednostkę winrate.');
  }
  return {
    value: normalizeMetricValue(winrate.value),
    unit: expectedUnit,
    numerator: normalizeMetricValue(winrate.numerator),
    denominator: Number(winrate.denominator),
  };
};

const normalizeSharedMetrics = (metrics, expectedHands) => {
  if (!isObject(metrics)
    || Object.keys(metrics).some((key) => !SHARED_METRIC_KEYS.includes(key))
    || SHARED_METRIC_KEYS.some((key) => !Object.hasOwn(metrics, key))) {
    throw createGroupError('Wspólne metryki analizy wielu sesji mają nieprawidłowy zakres.');
  }
  if (!Number.isFinite(Number(metrics.hands)) || Number(metrics.hands) !== expectedHands) {
    throw createGroupError('Wspólne metryki analizy wielu sesji mają nieprawidłową liczbę rąk.');
  }
  const normalizedComparable = Object.fromEntries(COMPARABLE_METRIC_KEYS.map((key) => [
    key,
    normalizeComparableMetric(metrics[key], key === 'af' || key === 'afq' ? 'aggression' : 'percentage'),
  ]));
  const profileStyleId = asString(metrics.profileStyleId);
  const reliability = metrics.reliability;
  if (!SESSION_STYLE_IDS.has(profileStyleId) || !isObject(reliability) || !asString(reliability.id)) {
    throw createGroupError('Analiza wielu sesji ma nieprawidłowy lokalny profil stylu gry.');
  }
  return {
    hands: Number(metrics.hands),
    ...normalizedComparable,
    profileStyleId,
    reliability: normalizeReliability(reliability, expectedHands),
  };
};

const normalizeCategoryMetrics = (metrics, type, expectedHands) => {
  if (!isObject(metrics)
    || Object.keys(metrics).some((key) => !CATEGORY_METRIC_KEYS.includes(key))
    || CATEGORY_METRIC_KEYS.some((key) => !Object.hasOwn(metrics, key))) {
    throw createGroupError('Metryki kategorii analizy wielu sesji mają nieprawidłowy zakres.');
  }
  const normalizedComparable = normalizeSharedMetrics(
    Object.fromEntries(SHARED_METRIC_KEYS.map((key) => [key, metrics[key]])),
    expectedHands,
  );
  const expectedUnit = type === 'cash' ? 'BB/100' : 'żetony/100';
  if (!Number.isFinite(Number(metrics.totalProfit))
    || !isObject(metrics.winrate)
    || asString(metrics.winrate.unit) !== expectedUnit) {
    throw createGroupError('Metryki kategorii muszą zachować właściwy wynik i jednostkę winrate.');
  }
  const normalizedWinrate = normalizeWinrate(metrics.winrate, expectedUnit, expectedHands);
  return {
    ...normalizedComparable,
    totalProfit: Number(metrics.totalProfit),
    winrate: normalizedWinrate,
  };
};

const normalizeGroupMetrics = (metrics, sources) => {
  const totalHands = sources.reduce((total, source) => total + Number(source.metadata.handCount), 0);
  const normalized = {
    shared: normalizeSharedMetrics(metrics?.shared, totalHands),
  };
  SESSION_GROUP_SOURCE_TYPES.forEach((type) => {
    const categoryHands = sources
      .filter((source) => source.type === type)
      .reduce((total, source) => total + Number(source.metadata.handCount), 0);
    const hasCategory = Object.hasOwn(metrics || {}, type);
    if (Boolean(categoryHands) !== hasCategory) {
      throw createGroupError('Metryki kategorii nie odpowiadają wybranym źródłom analizy wielu sesji.');
    }
    if (hasCategory) normalized[type] = normalizeCategoryMetrics(metrics[type], type, categoryHands);
  });
  return normalized;
};

const sortSources = (sources) => [...sources].sort((left, right) => (
  left.type.localeCompare(right.type)
  || left.sessionId.localeCompare(right.sessionId)
  || left.sourceId.localeCompare(right.sourceId)
));

const compactSourceFromCandidate = (candidate) => {
  const type = normalizeType(candidate?.type);
  const sessionId = asString(candidate?.sessionId);
  const sourceId = asString(candidate?.sourceId) || `${type}:${sessionId}`;
  const report = candidate?.report;
  const reportId = asString(candidate?.reportId || report?.reportId);
  const sessionFingerprint = asString(candidate?.sessionFingerprint);
  const reportFingerprint = asString(candidate?.reportFingerprint || report?.fingerprint);
  const actualHands = (Array.isArray(candidate?.hands) ? candidate.hands : [])
    .filter((hand) => hand && !hand.isRebuy);

  if (!type || !sessionId || !sourceId || !reportId || !sessionFingerprint || !reportFingerprint) {
    throw createGroupError('Źródło analizy wielu sesji nie ma wymaganych danych sesji lub raportu.');
  }
  if (sourceId !== `${type}:${sessionId}`) {
    throw createGroupError('Źródło analizy wielu sesji ma niekanoniczny identyfikator.');
  }
  if (!report?.analysis || !isObject(report.analysis) || reportFingerprint !== sessionFingerprint) {
    throw createGroupError('Wybrany raport źródłowy nie jest aktualny dla pełnych danych sesji.');
  }
  if (actualHands.length === 0 || actualHands.some((hand) => !asString(hand?.id))) {
    throw createGroupError('Źródło analizy wielu sesji nie zawiera prawdziwych rozdań.');
  }
  const sessionInput = buildSessionAnalysisInput({ sessionId, hands: actualHands, gameType: type });
  if (sessionFingerprint !== sessionInput.fingerprint || reportFingerprint !== sessionInput.fingerprint) {
    throw createGroupError('Wybrany raport źródłowy nie jest aktualny dla pełnych danych sesji.');
  }
  const normalizedAnalysis = normalizeSourceReportAnalysis(report.analysis, sessionInput);
  const actualHandIds = new Set(actualHands.map((hand) => asString(hand?.id)).filter(Boolean));
  const referencedHandIds = readReportHandIds(normalizedAnalysis);
  if (referencedHandIds.some((handId) => !actualHandIds.has(handId))) {
    throw createGroupError('Raport źródłowy wskazuje rozdanie niedostępne w aktualnej sesji.');
  }

  return {
    source: {
      sourceId,
      type,
      sessionId,
      sessionFingerprint,
      reportId,
      reportFingerprint,
      metadata: {
        label: asString(candidate?.label),
        date: asString(candidate?.date),
        startTime: asFiniteNumber(candidate?.startTime),
        handCount: actualHands.length,
        tableId: asString(candidate?.tableId),
        tournamentId: asString(candidate?.tournamentId),
        tournamentName: asString(candidate?.tournamentName),
      },
      referencedHandIds,
      report: {
        model: normalizeReportModel(report?.model || candidate?.reportModel),
        analyzedAt: asString(report?.analyzedAt || candidate?.reportAnalyzedAt),
        analysis: normalizedAnalysis,
      },
    },
    hands: actualHands,
  };
};

const makeCanonicalGroup = ({ activeCategory, dateRange, sources, metrics }) => ({
  activeCategory,
  dateRange,
  sources: sortSources(sources),
  metrics,
});

const ensureSourceSelection = (sources, activeCategory) => {
  if (!Array.isArray(sources) || sources.length < 2) {
    throw createGroupError('Do analizy wielu sesji trzeba wybrać co najmniej dwie różne sesje.');
  }
  const sourceIds = sources.map((source) => asString(source?.sourceId));
  const sessionKeys = sources.map((source) => `${source?.type}:${source?.sessionId}`);
  if (sourceIds.some((sourceId) => !sourceId)
    || unique(sourceIds).length !== sourceIds.length
    || unique(sessionKeys).length !== sessionKeys.length) {
    throw createGroupError('Analiza wielu sesji nie może zawierać powielonych źródeł.');
  }
  if (activeCategory !== 'both' && sources.some((source) => source.type !== activeCategory)) {
    throw createGroupError('Wybrane źródło nie pasuje do aktywnej kategorii profilu.');
  }
};

const ensureSourcesFitDateRange = (sources, dateRange) => {
  const range = getProfileDateRange(dateRange.from, dateRange.to);
  if (!range.valid) throw createGroupError(range.error);
  if (range.fromTimestamp === null && range.toTimestamp === null) return;
  if (sources.some((source) => {
    const startTime = asFiniteNumber(source?.metadata?.startTime);
    return !startTime
      || (range.fromTimestamp !== null && startTime < range.fromTimestamp)
      || (range.toTimestamp !== null && startTime > range.toTimestamp);
  })) {
    throw createGroupError('Wybrane źródło nie mieści się w aktywnym zakresie dat profilu.');
  }
};

export const buildSessionGroupAnalysisInput = ({
  sources = [],
  activeCategory = 'both',
  dateRange = {},
} = {}) => {
  const normalizedCategory = normalizeCategory(activeCategory);
  if (!normalizedCategory) {
    throw createGroupError('Analiza wielu sesji ma nieprawidłową kategorię profilu.');
  }

  const compactSources = sources.map(compactSourceFromCandidate);
  const sortedCompactSources = [...compactSources].sort((left, right) => (
    left.source.type.localeCompare(right.source.type)
    || left.source.sessionId.localeCompare(right.source.sessionId)
    || left.source.sourceId.localeCompare(right.source.sourceId)
  ));
  ensureSourceSelection(sortedCompactSources.map(({ source }) => source), normalizedCategory);
  const normalizedDateRange = normalizeDateRange(dateRange);
  ensureSourcesFitDateRange(sortedCompactSources.map(({ source }) => source), normalizedDateRange);
  const allHands = sortedCompactSources.flatMap(({ hands }) => hands);
  const cashHands = sortedCompactSources
    .filter(({ source }) => source.type === 'cash')
    .flatMap(({ hands }) => hands);
  const tournamentHands = sortedCompactSources
    .filter(({ source }) => source.type === 'tournament')
    .flatMap(({ hands }) => hands);
  const shared = calculateSessionMetrics(allHands, 'mixed');
  const cash = calculateSessionMetrics(cashHands, 'cash');
  const tournament = calculateSessionMetrics(tournamentHands, 'tournament');
  const metrics = {
    shared: comparableMetrics(shared),
    ...(cashHands.length > 0 ? { cash: categoryMetrics(cash) } : {}),
    ...(tournamentHands.length > 0 ? { tournament: categoryMetrics(tournament) } : {}),
  };
  const canonical = makeCanonicalGroup({
    activeCategory: normalizedCategory,
    dateRange: normalizedDateRange,
    sources: sortedCompactSources.map(({ source }) => source),
    metrics,
  });
  const fingerprint = createSessionFingerprint(canonical);
  const bytes = getSessionGroupAnalysisInputBytes({ ...canonical, fingerprint });
  if (bytes > SESSION_GROUP_ANALYSIS_MAX_BYTES) {
    throw createGroupError(
      `Analiza wielu sesji przekracza limit ${SESSION_GROUP_ANALYSIS_MAX_BYTES.toLocaleString('pl-PL')} bajtów i nie będzie analizowana częściowo.`,
      'AI_SESSION_GROUP_TOO_LARGE',
    );
  }
  return {
    ...canonical,
    fingerprint,
    bytes,
  };
};

export const getSessionGroupAnalysisInputBytes = (group) => (
  new TextEncoder().encode(stableStringify(group)).length
);

const containsForbiddenHistory = (value) => {
  if (Array.isArray(value)) return value.some(containsForbiddenHistory);
  if (!isObject(value)) return false;
  if (Object.hasOwn(value, 'rawText') || Array.isArray(value.hands)) return true;
  return Object.values(value).some(containsForbiddenHistory);
};

const validateCompactSource = (source, activeCategory) => {
  const type = normalizeType(source?.type);
  const sourceId = asString(source?.sourceId);
  const sessionId = asString(source?.sessionId);
  const sessionFingerprint = asString(source?.sessionFingerprint);
  const reportId = asString(source?.reportId);
  const reportFingerprint = asString(source?.reportFingerprint);
  const referencedHandIds = Array.isArray(source?.referencedHandIds)
    ? source.referencedHandIds.map(asString).filter(Boolean).sort()
    : [];
  if (!type || !sourceId || !sessionId || !sessionFingerprint || !reportId || reportFingerprint !== sessionFingerprint) {
    throw createGroupError('Analiza wielu sesji zawiera nieprawidłowe źródło lub nieaktualny raport.');
  }
  if (sourceId !== `${type}:${sessionId}`) {
    throw createGroupError('Analiza wielu sesji zawiera źródło o niekanonicznym identyfikatorze.');
  }
  if (activeCategory !== 'both' && type !== activeCategory) {
    throw createGroupError('Analiza wielu sesji zawiera źródło spoza aktywnej kategorii.');
  }
  if (unique(referencedHandIds).length !== referencedHandIds.length || containsForbiddenHistory(source)) {
    throw createGroupError('Analiza wielu sesji nie może przekazywać surowych historii ani powielonych identyfikatorów rąk.');
  }
  const normalizedAnalysis = normalizeSourceReportAnalysis(source?.report?.analysis);
  const reportHandIds = readReportHandIds(normalizedAnalysis);
  if (!isObject(source?.report?.analysis) || !Number.isFinite(Number(source?.metadata?.handCount)) || Number(source.metadata.handCount) < 1) {
    throw createGroupError('Analiza wielu sesji zawiera nieprawidłowy snapshot raportu źródłowego.');
  }
  if (referencedHandIds.join('|') !== reportHandIds.join('|')) {
    throw createGroupError('Analiza wielu sesji zawiera niespójny snapshot raportu źródłowego.');
  }
  return {
    sourceId,
    type,
    sessionId,
    sessionFingerprint,
    reportId,
    reportFingerprint,
    metadata: {
      label: asString(source.metadata.label),
      date: asString(source.metadata.date),
      startTime: asFiniteNumber(source.metadata.startTime),
      handCount: asFiniteNumber(source.metadata.handCount),
      tableId: asString(source.metadata.tableId),
      tournamentId: asString(source.metadata.tournamentId),
      tournamentName: asString(source.metadata.tournamentName),
    },
    referencedHandIds,
    report: {
      model: normalizeReportModel(source.report.model),
      analyzedAt: asString(source.report.analyzedAt),
      analysis: normalizedAnalysis,
    },
  };
};

export const validateSessionGroupAnalysisInput = (group) => {
  if (!isObject(group) || containsForbiddenHistory(group)) {
    throw createGroupError('Brakuje prawidłowych danych analizy wielu sesji.');
  }
  const activeCategory = normalizeCategory(group.activeCategory);
  if (!activeCategory) throw createGroupError('Analiza wielu sesji ma nieprawidłową kategorię profilu.');
  const sources = (Array.isArray(group.sources) ? group.sources : [])
    .map((source) => validateCompactSource(source, activeCategory));
  ensureSourceSelection(sources, activeCategory);
  const normalizedDateRange = normalizeDateRange(group.dateRange);
  ensureSourcesFitDateRange(sources, normalizedDateRange);
  const normalizedMetrics = normalizeGroupMetrics(group?.metrics, sources);
  const shared = normalizedMetrics.shared;
  const profileStyleId = asString(shared?.profileStyleId);
  const reliabilityId = asString(shared?.reliability?.id);
  if (!SESSION_STYLE_IDS.has(profileStyleId) || !reliabilityId) {
    throw createGroupError('Analiza wielu sesji ma nieprawidłowy lokalny profil stylu gry.');
  }
  const canonical = makeCanonicalGroup({
    activeCategory,
    dateRange: normalizedDateRange,
    sources,
    metrics: normalizedMetrics,
  });
  const fingerprint = createSessionFingerprint(canonical);
  if (group.fingerprint && group.fingerprint !== fingerprint) {
    throw createGroupError('Odcisk analizy wielu sesji nie odpowiada przekazanym źródłom.');
  }
  const bytes = getSessionGroupAnalysisInputBytes({ ...canonical, fingerprint });
  if (bytes > SESSION_GROUP_ANALYSIS_MAX_BYTES) {
    throw createGroupError(
      `Analiza wielu sesji przekracza limit ${SESSION_GROUP_ANALYSIS_MAX_BYTES.toLocaleString('pl-PL')} bajtów i nie będzie analizowana częściowo.`,
      'AI_SESSION_GROUP_TOO_LARGE',
    );
  }
  return { ...canonical, fingerprint, bytes };
};

const sourceReferenceSchema = {
  type: 'object',
  properties: {
    sourceId: { type: 'string' },
    reportId: { type: 'string' },
    handIds: { type: 'array', maxItems: 5, items: { type: 'string' } },
  },
  required: ['sourceId', 'reportId', 'handIds'],
  additionalProperties: false,
};

const sourceRefsSchema = {
  type: 'array', minItems: 1, maxItems: 5, items: sourceReferenceSchema,
};

const findingSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    sourceRefs: sourceRefsSchema,
  },
  required: ['title', 'description', 'sourceRefs'],
  additionalProperties: false,
};

const repeatedMistakeSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    correction: { type: 'string' },
    sourceRefs: sourceRefsSchema,
  },
  required: ['title', 'description', 'correction', 'sourceRefs'],
  additionalProperties: false,
};

const categoryInsightSchema = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: SESSION_GROUP_SOURCE_TYPES },
    summary: { type: 'string' },
    sourceRefs: sourceRefsSchema,
    tendencies: { type: 'array', minItems: 1, maxItems: 5, items: findingSchema },
    recommendations: { type: 'array', minItems: 1, maxItems: 5, items: findingSchema },
  },
  required: ['category', 'summary', 'sourceRefs', 'tendencies', 'recommendations'],
  additionalProperties: false,
};

export const sessionGroupAnalysisResponseSchema = {
  type: 'object',
  properties: {
    profileStyleId: { type: 'string', enum: [...SESSION_STYLE_IDS] },
    reliabilityId: { type: 'string' },
    summary: { type: 'string' },
    summarySourceRefs: sourceRefsSchema,
    strengths: { type: 'array', maxItems: 5, items: findingSchema },
    repeatedMistakes: { type: 'array', maxItems: 5, items: repeatedMistakeSchema },
    trainingPriorities: { type: 'array', minItems: 3, maxItems: 3, items: findingSchema },
    categoryInsights: { type: 'array', maxItems: 2, items: categoryInsightSchema },
  },
  required: [
    'profileStyleId', 'reliabilityId', 'summary', 'summarySourceRefs', 'strengths', 'repeatedMistakes',
    'trainingPriorities', 'categoryInsights',
  ],
  additionalProperties: false,
};

// Gemini translates nested array bounds and closed-object flags into a serving
// state machine. In this report shape their combinations can exceed the
// serving limit before generation starts. The server-side validator below
// remains the source of truth for every cardinality and object-shape rule, so
// Gemini only needs the response shape and useful value hints.
const withoutArrayCardinalityConstraints = (schema) => {
  if (Array.isArray(schema)) return schema.map(withoutArrayCardinalityConstraints);
  if (!isObject(schema)) return schema;
  return Object.fromEntries(Object.entries(schema)
    .filter(([key]) => key !== 'minItems' && key !== 'maxItems' && key !== 'additionalProperties')
    .map(([key, value]) => [key, withoutArrayCardinalityConstraints(value)]));
};

export const sessionGroupAnalysisGeminiResponseSchema = withoutArrayCardinalityConstraints(
  sessionGroupAnalysisResponseSchema,
);

// Fingerprints, payload size and source-report bookkeeping are needed to
// validate the request on the server, but they are not evidence for the model.
// Keep the model-facing context deliberately separate from that transport
// payload so technical fields cannot leak into the prompt when the input
// contract grows.
export const buildSessionGroupAnalysisModelContext = (group = {}) => ({
  activeCategory: group.activeCategory,
  dateRange: group.dateRange,
  sources: (Array.isArray(group.sources) ? group.sources : []).map((source) => ({
    sourceId: source.sourceId,
    type: source.type,
    sessionId: source.sessionId,
    reportId: source.reportId,
    metadata: source.metadata,
    referencedHandIds: source.referencedHandIds,
    report: {
      analysis: source.report?.analysis,
    },
  })),
  metrics: group.metrics,
});

const validateSourceRefs = (sourceRefs, sourceById, requiredType) => {
  const refs = Array.isArray(sourceRefs) ? sourceRefs : [];
  if (refs.length === 0) throw new Error('Wniosek analizy wielu sesji nie wskazuje raportu źródłowego.');
  const sourceIds = new Set();
  refs.forEach((reference) => {
    const sourceId = asString(reference?.sourceId);
    const reportId = asString(reference?.reportId);
    const source = sourceById.get(sourceId);
    const handIds = Array.isArray(reference?.handIds) ? reference.handIds.map(asString).filter(Boolean) : null;
    if (!source || reportId !== source.reportId || sourceIds.has(sourceId) || handIds === null) {
      throw new Error('Wniosek analizy wielu sesji wskazuje obcy albo powielony raport źródłowy.');
    }
    if (requiredType && source.type !== requiredType) {
      throw new Error('Wniosek kategorii wskazuje raport z niewłaściwego rodzaju sesji.');
    }
    if (unique(handIds).length !== handIds.length || handIds.some((handId) => !source.referencedHandIds.includes(handId))) {
      throw new Error('Wniosek analizy wielu sesji wskazuje rozdanie spoza raportu źródłowego.');
    }
    sourceIds.add(sourceId);
  });
  return sourceIds;
};

const validateFindingList = ({
  findings,
  sourceById,
  requiredType,
  fieldName,
  requireTwoSources = false,
  requireCorrection = false,
}) => {
  const list = Array.isArray(findings) ? findings : [];
  const titles = new Set();
  list.forEach((finding) => {
    const title = asString(finding?.title).toLocaleLowerCase('pl');
    if (!title || titles.has(title) || !asString(finding?.description)) {
      throw new Error(`${fieldName} analizy wielu sesji zawierają nieprawidłowy wniosek.`);
    }
    if ((requireCorrection && !Object.hasOwn(finding, 'correction'))
      || (Object.hasOwn(finding, 'correction') && !asString(finding?.correction))) {
      throw new Error(`${fieldName} analizy wielu sesji nie zawierają praktycznej korekty.`);
    }
    const sourceIds = validateSourceRefs(finding?.sourceRefs, sourceById, requiredType);
    if (requireTwoSources && sourceIds.size < 2) {
      throw new Error('Powtarzalny błąd musi mieć dowody z co najmniej dwóch różnych sesji.');
    }
    titles.add(title);
  });
};

export const validateSessionGroupAnalysis = (analysis, group) => {
  if (!isObject(analysis)) throw new Error('AI nie zwróciło raportu wielu sesji w wymaganym formacie.');
  const expectedStyle = asString(group?.metrics?.shared?.profileStyleId);
  const expectedReliability = asString(group?.metrics?.shared?.reliability?.id);
  if (asString(analysis.profileStyleId) !== expectedStyle || asString(analysis.reliabilityId) !== expectedReliability) {
    throw new Error('Analiza AI podała styl lub wiarygodność niezgodne z lokalnymi metrykami.');
  }
  if (!asString(analysis.summary)) throw new Error('Analiza wielu sesji nie zawiera podsumowania.');
  const sourceById = new Map((group?.sources || []).map((source) => [source.sourceId, source]));
  validateSourceRefs(analysis.summarySourceRefs, sourceById);
  const strengths = Array.isArray(analysis.strengths) ? analysis.strengths : [];
  const mistakes = Array.isArray(analysis.repeatedMistakes) ? analysis.repeatedMistakes : [];
  const priorities = Array.isArray(analysis.trainingPriorities) ? analysis.trainingPriorities : [];
  if (mistakes.some((mistake) => !Object.hasOwn(mistake || {}, 'correction') || !asString(mistake.correction))) {
    throw new Error('Powtarzalne błędy analizy wielu sesji muszą zawierać praktyczną korektę.');
  }
  if (strengths.length > 5 || mistakes.length > 5 || priorities.length !== 3) {
    throw new Error('Analiza wielu sesji ma nieprawidłową liczbę mocnych stron, błędów albo priorytetów.');
  }
  validateFindingList({ findings: strengths, sourceById, fieldName: 'Mocne strony' });
  validateFindingList({ findings: mistakes, sourceById, fieldName: 'Powtarzalne błędy', requireTwoSources: true });
  validateFindingList({ findings: priorities, sourceById, fieldName: 'Priorytety treningowe' });

  const categoryInsights = Array.isArray(analysis.categoryInsights) ? analysis.categoryInsights : [];
  const expectedCategories = unique((group?.sources || []).map((source) => source.type)).sort();
  const returnedCategories = categoryInsights.map((insight) => normalizeType(insight?.category));
  if (categoryInsights.length !== expectedCategories.length
    || returnedCategories.some((category) => !category)
    || unique(returnedCategories).length !== returnedCategories.length
    || returnedCategories.sort().join('|') !== expectedCategories.join('|')) {
    throw new Error('Analiza wielu sesji ma nieprawidłowe sekcje kategorii.');
  }
  categoryInsights.forEach((insight) => {
    const category = normalizeType(insight.category);
    if (!asString(insight.summary)) throw new Error('Sekcja kategorii nie zawiera podsumowania.');
    if (!Array.isArray(insight.tendencies) || insight.tendencies.length === 0
      || !Array.isArray(insight.recommendations) || insight.recommendations.length === 0) {
      throw new Error('Sekcja kategorii musi zawierać tendencje i zalecenia.');
    }
    validateSourceRefs(insight.sourceRefs, sourceById, category);
    validateFindingList({
      findings: insight.tendencies,
      sourceById,
      requiredType: category,
      fieldName: 'Tendencje kategorii',
    });
    validateFindingList({
      findings: insight.recommendations,
      sourceById,
      requiredType: category,
      fieldName: 'Zalecenia kategorii',
    });
  });
  return analysis;
};

export const buildSessionGroupAnalysisPrompt = (group) => `Jesteś profesjonalnym trenerem pokera. Analizujesz wiele pełnych sesji Hero po polsku.

Pracuj wyłącznie na zagregowanych metrykach i skróconych raportach źródłowych przekazanych poniżej. Łącz powtarzające się wzorce z istniejących raportów; nie analizuj ponownie pełnych rozdań ani nie próbuj odtwarzać historii, kart lub akcji, których tu nie ma.

Twarde fakty lokalne są autorytatywne: wspólny styl to ${group.metrics.shared.profileStyleId}, wiarygodność to ${group.metrics.shared.reliability.id}, a Cash i Turnieje mają odrębne jednostki wyniku. Nie sumuj ani nie przeliczaj ich we wspólny rezultat lub winrate. Oceniaj decyzje, zakresy i sizing, a nie sam wynik. Nie wymyślaj rąk, kart, raportów ani faktów spoza danych. Każdy wniosek musi wskazywać sourceRefs do aktualnych raportów źródłowych; handIds mogą być użyte tylko z odpowiedniego raportu.

Zwróć wyłącznie JSON zgodny ze schematem. summary wyjaśnia przekrojowy obraz gry, a summarySourceRefs wskazuje raporty źródłowe dla tego podsumowania. strengths ma najwyżej 5 pozycji. repeatedMistakes ma najwyżej 5 faktycznie powtarzalnych błędów, a każdy musi mieć dowody z co najmniej dwóch różnych sesji. trainingPriorities zawiera dokładnie 3 priorytety. categoryInsights ma dokładnie jedną sekcję dla każdego rodzaju obecnego w źródłach; sekcja Cash dotyczy tylko Cash, a Turnieje tylko turniejów.

Dane grupy:
${stableStringify(buildSessionGroupAnalysisModelContext(group))}`;
