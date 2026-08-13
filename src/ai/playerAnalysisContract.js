import {
  createSessionFingerprint,
  stableStringify,
} from './sessionAnalysisContract.js';
import { PLAYER_ANALYSIS_MAX_SESSION_REPORTS } from './playerAnalysisData.js';

export const PLAYER_ANALYSIS_MAX_BYTES = 1_500_000;
export const PLAYER_ANALYSIS_MIN_HANDS = 30;
export const PLAYER_ANALYSIS_FULL_RELIABILITY_HANDS = 100;

const GAME_TYPES = ['cash', 'tournament', 'both'];
const CATEGORY_TYPES = ['cash', 'tournament'];
const STYLE_IDS = new Set([
  'TAG', 'LAG', 'NIT_ROCK', 'LOOSE_PASSIVE', 'TIGHT_PASSIVE', 'MANIAC',
  'WEAK_TIGHT', 'BALANCED', 'RECREATIONAL', 'MIXED', 'INSUFFICIENT',
]);
const RELIABILITY_IDS = new Set(['INSUFFICIENT', 'PRELIMINARY', 'STATISTICAL']);

const asString = (value) => String(value ?? '').trim();
const asCount = (value) => Number.isInteger(Number(value)) && Number(value) >= 0
  ? Number(value)
  : -1;
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const unique = (items) => [...new Set(items)];
const clone = (value) => JSON.parse(JSON.stringify(value));
const hasExactKeys = (value, keys) => (
  isObject(value)
  && Object.keys(value).every((key) => keys.includes(key))
  && keys.every((key) => Object.hasOwn(value, key))
);

const playerContractError = (message, code = 'AI_INVALID_PLAYER_ANALYSIS') => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const containsForbiddenHistory = (value) => {
  if (Array.isArray(value)) return value.some(containsForbiddenHistory);
  if (!isObject(value)) return false;
  return Object.entries(value).some(([key, nested]) => {
    const normalizedKey = key.replaceAll('_', '').toLowerCase();
    if (normalizedKey === 'rawtext' || normalizedKey === 'handhistory') return true;
    if (normalizedKey === 'hands' && Array.isArray(nested)) return true;
    return containsForbiddenHistory(nested);
  });
};

const expectedCategories = (gameType) => (
  gameType === 'both' ? CATEGORY_TYPES : [gameType]
);

const normalizeCriteria = (criteria) => {
  const gameType = asString(criteria?.gameType).toLowerCase();
  if (!GAME_TYPES.includes(gameType)) {
    throw playerContractError('Analiza gracza ma nieprawidłowy typ gry.');
  }
  return {
    gameType,
    dateFrom: asString(criteria?.dateFrom),
    dateTo: asString(criteria?.dateTo),
  };
};

const normalizeActualDateRange = (range) => {
  const fromTimestamp = range?.fromTimestamp === null ? null : Number(range?.fromTimestamp);
  const toTimestamp = range?.toTimestamp === null ? null : Number(range?.toTimestamp);
  const from = asString(range?.from);
  const to = asString(range?.to);
  const isEmpty = fromTimestamp === null && toTimestamp === null && !from && !to;
  if (!isEmpty && (!Number.isFinite(fromTimestamp) || !Number.isFinite(toTimestamp)
    || fromTimestamp > toTimestamp || !/^\d{4}-\d{2}-\d{2}$/.test(from)
    || !/^\d{4}-\d{2}-\d{2}$/.test(to))) {
    throw playerContractError('Analiza gracza ma nieprawidłowy faktyczny zakres danych.');
  }
  return { from, to, fromTimestamp, toTimestamp };
};

const validateMetrics = (metrics, criteria, handCount) => {
  if (!isObject(metrics?.shared) || containsForbiddenHistory(metrics)) {
    throw playerContractError('Analiza gracza ma nieprawidłowe metryki wspólne.');
  }
  if (Object.hasOwn(metrics.shared, 'totalProfit') || Object.hasOwn(metrics.shared, 'winrate')) {
    throw playerContractError('Analiza gracza nie może zawierać wspólnego wyniku Cash i Turniejów.');
  }
  if (asCount(metrics.shared.hands) !== handCount) {
    throw playerContractError('Liczba rąk nie odpowiada wspólnym metrykom analizy gracza.');
  }
  const categories = expectedCategories(criteria.gameType);
  const allowedMetricKeys = new Set(['shared', ...categories]);
  if (Object.keys(metrics).some((key) => !allowedMetricKeys.has(key))) {
    throw playerContractError('Analiza gracza zawiera nieznaną kategorię metryk.');
  }
  CATEGORY_TYPES.forEach((category) => {
    const shouldExist = categories.includes(category);
    if (shouldExist !== isObject(metrics[category])) {
      throw playerContractError('Kategorie metryk nie odpowiadają wybranemu typowi gry.');
    }
    if (!shouldExist) return;
    const winrateUnit = asString(metrics[category]?.winrate?.unit);
    const expectedUnit = category === 'cash' ? 'BB/100' : 'żetony/100';
    if (asCount(metrics[category].hands) < 0
      || !Object.hasOwn(metrics[category], 'totalProfit')
      || winrateUnit !== expectedUnit) {
      throw playerContractError(`Metryki ${category} mają nieprawidłowy wynik lub jednostkę winrate.`);
    }
  });
  return clone(metrics);
};

const validateMetricCatalog = (catalog, criteria) => {
  if (!isObject(catalog) || Object.keys(catalog).length === 0 || containsForbiddenHistory(catalog)) {
    throw playerContractError('Analiza gracza nie zawiera katalogu dozwolonych metryk.');
  }
  if (Object.hasOwn(catalog, 'shared.totalProfit') || Object.hasOwn(catalog, 'shared.winrate')) {
    throw playerContractError('Katalog nie może udostępniać wspólnego wyniku ekonomicznego.');
  }
  const categories = expectedCategories(criteria.gameType);
  Object.entries(catalog).forEach(([metricId, metric]) => {
    if (!isObject(metric) || asString(metric.id) !== metricId || !asString(metric.label)
      || !Object.hasOwn(metric, 'value')) {
      throw playerContractError('Katalog analizy gracza zawiera nieprawidłową metrykę.');
    }
    const prefix = metricId.split('.')[0];
    if (prefix !== 'shared' && !categories.includes(prefix)) {
      throw playerContractError('Katalog analizy gracza zawiera metrykę spoza wybranego typu gry.');
    }
  });
  return clone(catalog);
};

const normalizeCoverageBucket = (bucket) => {
  const normalized = {
    sessionsInPeriod: asCount(bucket?.sessionsInPeriod),
    availableReports: asCount(bucket?.availableReports),
    usedReports: asCount(bucket?.usedReports),
  };
  if (Object.values(normalized).some((value) => value < 0)
    || normalized.usedReports > normalized.availableReports) {
    throw playerContractError('Pokrycie raportami sesji ma nieprawidłowe liczniki.');
  }
  return normalized;
};

const normalizeEvidenceReport = (report) => {
  const type = asString(report?.type).toLowerCase();
  const sessionId = asString(report?.sessionId);
  const reportId = asString(report?.reportId);
  const expectedSourceId = `${type}:${sessionId}:${reportId}`;
  const startTime = Number(report?.startTime);
  const endTime = Number(report?.endTime);
  const leaks = Array.isArray(report?.leaks) ? report.leaks.map((leak) => ({
    title: asString(leak?.title),
    description: asString(leak?.description),
    correction: asString(leak?.correction),
  })) : null;
  if (!CATEGORY_TYPES.includes(type) || !sessionId || !reportId
    || asString(report?.sourceId) !== expectedSourceId || !asString(report?.sessionFingerprint)
    || !asString(report?.summary) || !Array.isArray(leaks)
    || !Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime > endTime
    || leaks.some((leak) => !leak.title || !leak.description || !leak.correction)) {
    throw playerContractError('Analiza gracza zawiera nieprawidłowy skrót raportu sesji.');
  }
  return {
    sourceId: expectedSourceId,
    type,
    sessionId,
    reportId,
    sessionFingerprint: asString(report.sessionFingerprint),
    startTime,
    endTime,
    date: asString(report.date),
    model: isObject(report.model)
      ? { id: asString(report.model.id), name: asString(report.model.name) }
      : null,
    analyzedAt: asString(report.analyzedAt),
    summary: asString(report.summary),
    leaks,
  };
};

const validateSessionEvidence = (evidence, criteria) => {
  if (!isObject(evidence?.coverage) || !Array.isArray(evidence?.reports)
    || containsForbiddenHistory(evidence)) {
    throw playerContractError('Analiza gracza ma nieprawidłowe dowody sesyjne.');
  }
  const byGameType = {
    cash: normalizeCoverageBucket(evidence.coverage?.byGameType?.cash),
    tournament: normalizeCoverageBucket(evidence.coverage?.byGameType?.tournament),
  };
  const coverage = {
    ...normalizeCoverageBucket(evidence.coverage),
    byGameType,
  };
  const reports = evidence.reports.map(normalizeEvidenceReport);
  const categories = expectedCategories(criteria.gameType);
  if (reports.length > PLAYER_ANALYSIS_MAX_SESSION_REPORTS
    || reports.length !== coverage.usedReports
    || unique(reports.map((report) => report.sourceId)).length !== reports.length
    || unique(reports.map((report) => report.reportId)).length !== reports.length
    || reports.some((report) => !categories.includes(report.type))) {
    throw playerContractError('Dowody sesyjne nie odpowiadają pokryciu analizy gracza.');
  }
  CATEGORY_TYPES.forEach((category) => {
    const used = reports.filter((report) => report.type === category).length;
    if (used !== coverage.byGameType[category].usedReports) {
      throw playerContractError('Pokrycie kategorii nie odpowiada wykorzystanym raportom sesji.');
    }
  });
  if (coverage.usedReports !== Object.values(byGameType)
    .reduce((total, bucket) => total + bucket.usedReports, 0)
    || coverage.availableReports !== Object.values(byGameType)
      .reduce((total, bucket) => total + bucket.availableReports, 0)
    || coverage.sessionsInPeriod !== Object.values(byGameType)
      .reduce((total, bucket) => total + bucket.sessionsInPeriod, 0)) {
    throw playerContractError('Łączne pokrycie nie odpowiada kategoriom raportów sesji.');
  }
  return { coverage, reports };
};

const normalizePlayerAnalysisInput = (value) => {
  if (!isObject(value) || containsForbiddenHistory(value)) {
    throw playerContractError('Brakuje prawidłowych danych analizy gracza.');
  }
  const criteria = normalizeCriteria(value.criteria);
  const handCount = asCount(value.handCount);
  const sessionCount = asCount(value.sessionCount);
  const cashHandCount = asCount(value.cashHandCount);
  const tournamentHandCount = asCount(value.tournamentHandCount);
  if ([handCount, sessionCount, cashHandCount, tournamentHandCount].some((count) => count < 0)
    || cashHandCount + tournamentHandCount !== handCount) {
    throw playerContractError('Analiza gracza ma nieprawidłowe liczniki rąk lub sesji.');
  }
  if ((criteria.gameType === 'cash' && tournamentHandCount !== 0)
    || (criteria.gameType === 'tournament' && cashHandCount !== 0)) {
    throw playerContractError('Liczniki rąk nie odpowiadają wybranemu typowi gry.');
  }
  const metrics = validateMetrics(value.metrics, criteria, handCount);
  const profileStyleId = asString(value.profileStyleId);
  const reliabilityId = asString(value.reliabilityId);
  if (!STYLE_IDS.has(profileStyleId) || !RELIABILITY_IDS.has(reliabilityId)
    || asString(metrics.shared?.playerProfile?.style?.id) !== profileStyleId
    || asString(metrics.shared?.playerProfile?.reliability?.id) !== reliabilityId) {
    throw playerContractError('Styl lub wiarygodność nie odpowiadają lokalnym metrykom gracza.');
  }
  if (asString(value.profileStyle?.id) !== profileStyleId
    || asString(value.reliability?.id) !== reliabilityId) {
    throw playerContractError('Snapshot stylu lub wiarygodności jest niespójny z analizą gracza.');
  }
  return {
    criteria,
    actualDateRange: normalizeActualDateRange(value.actualDateRange),
    handCount,
    sessionCount,
    cashHandCount,
    tournamentHandCount,
    metrics,
    profileStyleId,
    profileStyle: value.profileStyle === null ? null : clone(value.profileStyle),
    reliabilityId,
    reliability: value.reliability === null ? null : clone(value.reliability),
    metricCatalog: validateMetricCatalog(value.metricCatalog, criteria),
    sessionEvidence: validateSessionEvidence(value.sessionEvidence, criteria),
  };
};

export const getPlayerAnalysisInputBytes = (value) => (
  new TextEncoder().encode(stableStringify(value)).length
);

export const createPlayerAnalysisFingerprint = (value) => {
  const { fingerprint, bytes, ...canonical } = value || {};
  void fingerprint;
  void bytes;
  return createSessionFingerprint(canonical);
};

const withFingerprint = (value) => {
  const canonical = normalizePlayerAnalysisInput(value);
  const fingerprint = createPlayerAnalysisFingerprint(canonical);
  if (value.fingerprint && value.fingerprint !== fingerprint) {
    throw playerContractError('Odcisk analizy gracza nie odpowiada kanonicznym danym.');
  }
  const bytes = getPlayerAnalysisInputBytes({ ...canonical, fingerprint });
  if (bytes > PLAYER_ANALYSIS_MAX_BYTES) {
    throw playerContractError(
      `Analiza gracza przekracza limit ${PLAYER_ANALYSIS_MAX_BYTES.toLocaleString('pl-PL')} bajtów.`,
      'AI_PLAYER_ANALYSIS_TOO_LARGE',
    );
  }
  return { ...canonical, fingerprint, bytes };
};

export const buildPlayerAnalysisInput = (playerData) => withFingerprint(playerData);
export const validatePlayerAnalysisInput = (playerInput) => withFingerprint(playerInput);

const withoutArrayCardinalityConstraints = (schema) => {
  if (Array.isArray(schema)) return schema.map(withoutArrayCardinalityConstraints);
  if (!isObject(schema)) return schema;
  return Object.fromEntries(Object.entries(schema)
    .filter(([key]) => key !== 'minItems' && key !== 'maxItems' && key !== 'additionalProperties')
    .map(([key, value]) => [key, withoutArrayCardinalityConstraints(value)]));
};

const schemaReference = (name) => ({ $ref: `#/$defs/${name}` });

const createPlayerAnalysisResponseSchema = ({
  metricIds = [],
  sessionReportIds = [],
  categories = CATEGORY_TYPES,
} = {}) => {
  const hasSessionReports = sessionReportIds.length > 0;
  const referenceProperties = {
    metricIds: schemaReference('metricIds'),
    sessionReportIds: schemaReference('sessionReportIds'),
  };
  const definitions = {
    metricIds: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: { type: 'string', enum: metricIds },
    },
    sessionReportIds: {
      type: 'array',
      maxItems: hasSessionReports ? 5 : 0,
      // JSON Schema providers require a non-empty enum. maxItems: 0 keeps
      // this placeholder unreachable when no session report is available.
      items: {
        type: 'string',
        enum: hasSessionReports ? sessionReportIds : ['__no_available_session_report__'],
      },
    },
    finding: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        ...referenceProperties,
      },
      required: ['title', 'description', 'metricIds', 'sessionReportIds'],
      additionalProperties: false,
    },
    leak: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        correction: { type: 'string' },
        ...referenceProperties,
      },
      required: ['title', 'description', 'correction', 'metricIds', 'sessionReportIds'],
      additionalProperties: false,
    },
    priority: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        exercise: { type: 'string' },
        ...referenceProperties,
      },
      required: ['title', 'description', 'exercise', 'metricIds', 'sessionReportIds'],
      additionalProperties: false,
    },
    categoryInsight: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: categories },
        summary: { type: 'string' },
        ...referenceProperties,
      },
      required: ['category', 'summary', 'metricIds', 'sessionReportIds'],
      additionalProperties: false,
    },
  };

  return {
    type: 'object',
    $defs: definitions,
    properties: {
      profileStyleId: { type: 'string', enum: [...STYLE_IDS] },
      reliabilityId: { type: 'string', enum: [...RELIABILITY_IDS] },
      summary: { type: 'string' },
      summaryMetricIds: schemaReference('metricIds'),
      summarySessionReportIds: schemaReference('sessionReportIds'),
      strengths: { type: 'array', maxItems: 5, items: schemaReference('finding') },
      leaks: { type: 'array', maxItems: 5, items: schemaReference('leak') },
      trainingPriorities: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: schemaReference('priority'),
      },
      categoryInsights: {
        type: 'array',
        minItems: categories.length,
        maxItems: categories.length,
        items: schemaReference('categoryInsight'),
      },
    },
    required: [
      'profileStyleId', 'reliabilityId', 'summary', 'summaryMetricIds',
      'summarySessionReportIds', 'strengths', 'leaks', 'trainingPriorities', 'categoryInsights',
    ],
    additionalProperties: false,
  };
};

const getSchemaContext = (input = {}) => {
  const gameType = asString(input.criteria?.gameType).toLowerCase();
  return {
    metricIds: isObject(input.metricCatalog) ? Object.keys(input.metricCatalog) : [],
    sessionReportIds: Array.isArray(input.sessionEvidence?.reports)
      ? unique(input.sessionEvidence.reports.map((report) => asString(report?.reportId)).filter(Boolean))
      : [],
    categories: GAME_TYPES.includes(gameType) && gameType !== 'both'
      ? expectedCategories(gameType)
      : CATEGORY_TYPES,
  };
};

export const buildPlayerAnalysisResponseSchema = (input = {}) => (
  createPlayerAnalysisResponseSchema(getSchemaContext(input))
);

export const buildPlayerAnalysisGeminiResponseSchema = (input = {}) => (
  buildPlayerAnalysisResponseSchema(input)
);

// Kept as a generic export for callers that only need the response shape. The
// provider path uses the dynamic builders above so references are constrained
// by the current player-analysis input.
export const playerAnalysisResponseSchema = createPlayerAnalysisResponseSchema();
export const playerAnalysisGeminiResponseSchema = withoutArrayCardinalityConstraints(
  playerAnalysisResponseSchema,
);

export const PLAYER_ANALYSIS_REFERENCE_WARNING_REASONS = [
  'missing',
  'unknown',
  'duplicate',
  'wrongCategory',
  'limit',
];

const normalizeDiscardedReferenceId = (value) => asString(value);

const createReferenceWarningCollector = () => {
  const warnings = [];
  const byKey = new Map();
  return {
    add: ({ path, kind, reason, discardedId }) => {
      const key = `${path}|${kind}|${reason}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.discardedIds.push(normalizeDiscardedReferenceId(discardedId));
        return;
      }
      const warning = {
        path,
        kind,
        reason,
        discardedIds: [normalizeDiscardedReferenceId(discardedId)],
      };
      byKey.set(key, warning);
      warnings.push(warning);
    },
    get: () => warnings,
  };
};

const normalizeReferenceList = ({
  value,
  input,
  category = '',
  path,
  kind,
  warningCollector,
}) => {
  if (!Array.isArray(value)) return value;
  const normalized = [];
  const seen = new Set();
  const sourceByReportId = kind === 'sessionReport'
    ? new Map(input.sessionEvidence.reports.map((source) => [source.reportId, source]))
    : null;

  value.forEach((rawId) => {
    const id = asString(rawId);
    if (!id) {
      warningCollector.add({ path, kind, reason: 'missing', discardedId: id });
      return;
    }
    if (seen.has(id)) {
      warningCollector.add({ path, kind, reason: 'duplicate', discardedId: id });
      return;
    }

    const known = kind === 'metric'
      ? Object.hasOwn(input.metricCatalog, id)
      : sourceByReportId.has(id);
    if (!known) {
      warningCollector.add({ path, kind, reason: 'unknown', discardedId: id });
      return;
    }

    const belongsToCategory = !category || (kind === 'metric'
      ? id.startsWith('shared.') || id.startsWith(`${category}.`)
      : sourceByReportId.get(id).type === category);
    if (!belongsToCategory) {
      warningCollector.add({ path, kind, reason: 'wrongCategory', discardedId: id });
      return;
    }
    if (normalized.length >= 5) {
      warningCollector.add({ path, kind, reason: 'limit', discardedId: id });
      return;
    }
    seen.add(id);
    normalized.push(id);
  });

  return normalized;
};

const normalizeReferenceFields = ({
  value,
  input,
  pathPrefix,
  category = '',
  warningCollector,
}) => {
  if (!isObject(value)) return;
  value.metricIds = normalizeReferenceList({
    value: value.metricIds,
    input,
    category,
    path: `${pathPrefix}.metricIds`,
    kind: 'metric',
    warningCollector,
  });
  value.sessionReportIds = normalizeReferenceList({
    value: value.sessionReportIds,
    input,
    category,
    path: `${pathPrefix}.sessionReportIds`,
    kind: 'sessionReport',
    warningCollector,
  });
};

export const normalizePlayerAnalysisReferences = (analysis, input) => {
  if (!isObject(analysis)) return { analysis, referenceWarnings: [] };
  const normalized = clone(analysis);
  const warningCollector = createReferenceWarningCollector();
  normalized.summaryMetricIds = normalizeReferenceList({
    value: normalized.summaryMetricIds,
    input,
    path: 'summaryMetricIds',
    kind: 'metric',
    warningCollector,
  });
  normalized.summarySessionReportIds = normalizeReferenceList({
    value: normalized.summarySessionReportIds,
    input,
    path: 'summarySessionReportIds',
    kind: 'sessionReport',
    warningCollector,
  });
  ['strengths', 'leaks', 'trainingPriorities'].forEach((field) => {
    if (!Array.isArray(normalized[field])) return;
    normalized[field].forEach((finding, index) => normalizeReferenceFields({
      value: finding,
      input,
      pathPrefix: `${field}[${index}]`,
      warningCollector,
    }));
  });
  if (Array.isArray(normalized.categoryInsights)) {
    normalized.categoryInsights.forEach((insight, index) => normalizeReferenceFields({
      value: insight,
      input,
      category: asString(insight?.category).toLowerCase(),
      pathPrefix: `categoryInsights[${index}]`,
      warningCollector,
    }));
  }
  return {
    analysis: normalized,
    referenceWarnings: warningCollector.get(),
  };
};

const validateReferences = ({
  metricIds,
  sessionReportIds,
  input,
  category = '',
}) => {
  const metrics = Array.isArray(metricIds) ? metricIds.map(asString).filter(Boolean) : null;
  const reports = Array.isArray(sessionReportIds)
    ? sessionReportIds.map(asString).filter(Boolean)
    : null;
  if (!metrics || metrics.length > 5
    || unique(metrics).length !== metrics.length
    || metrics.some((metricId) => !Object.hasOwn(input.metricCatalog, metricId))) {
    throw new Error('Wniosek analizy gracza wskazuje obcą, powieloną albo brakującą metrykę.');
  }
  if (category && metrics.some((metricId) => (
    !metricId.startsWith('shared.') && !metricId.startsWith(`${category}.`)
  ))) {
    throw new Error('Sekcja kategorii wskazuje metrykę innego typu gry.');
  }
  const sourceByReportId = new Map(input.sessionEvidence.reports
    .map((source) => [source.reportId, source]));
  if (!reports || reports.length > 5 || unique(reports).length !== reports.length
    || reports.some((reportId) => !sourceByReportId.has(reportId))) {
    throw new Error('Wniosek analizy gracza wskazuje obcy albo powielony raport sesji.');
  }
  if (category && reports.some((reportId) => sourceByReportId.get(reportId).type !== category)) {
    throw new Error('Sekcja kategorii wskazuje raport sesji innego typu gry.');
  }
};

const validateFindingList = ({ list, input, kind }) => {
  const values = Array.isArray(list) ? list : null;
  if (!values || values.length > 5) {
    throw new Error(`Analiza gracza ma nieprawidłową liczbę pozycji: ${kind}.`);
  }
  const requiredKeys = kind === 'leaki'
    ? ['title', 'description', 'correction', 'metricIds', 'sessionReportIds']
    : ['title', 'description', 'metricIds', 'sessionReportIds'];
  const titles = new Set();
  values.forEach((finding) => {
    const title = asString(finding?.title).toLocaleLowerCase('pl');
    if (!hasExactKeys(finding, requiredKeys) || !title || titles.has(title)
      || !asString(finding.description)
      || (kind === 'leaki' && !asString(finding.correction))) {
      throw new Error(`Analiza gracza zawiera nieprawidłowy albo powielony wniosek: ${kind}.`);
    }
    validateReferences({
      metricIds: finding.metricIds,
      sessionReportIds: finding.sessionReportIds,
      input,
    });
    titles.add(title);
  });
};

export const validatePlayerAnalysis = (analysis, input) => {
  const requiredKeys = playerAnalysisResponseSchema.required;
  if (!hasExactKeys(analysis, requiredKeys)) {
    throw new Error('AI nie zwróciło kompletnego raportu gracza w wymaganym formacie.');
  }
  if (asString(analysis.profileStyleId) !== input.profileStyleId
    || asString(analysis.reliabilityId) !== input.reliabilityId) {
    throw new Error('Analiza AI podała styl lub wiarygodność niezgodne z lokalnymi metrykami.');
  }
  if (!asString(analysis.summary)) throw new Error('Analiza gracza nie zawiera podsumowania.');
  validateReferences({
    metricIds: analysis.summaryMetricIds,
    sessionReportIds: analysis.summarySessionReportIds,
    input,
  });
  validateFindingList({ list: analysis.strengths, input, kind: 'mocne strony' });
  validateFindingList({ list: analysis.leaks, input, kind: 'leaki' });

  const priorities = Array.isArray(analysis.trainingPriorities)
    ? analysis.trainingPriorities
    : [];
  if (priorities.length !== 3) {
    throw new Error('Analiza gracza musi zawierać dokładnie trzy priorytety treningowe.');
  }
  const priorityTitles = new Set();
  priorities.forEach((priority) => {
    const title = asString(priority?.title).toLocaleLowerCase('pl');
    if (!hasExactKeys(priority, ['title', 'description', 'exercise', 'metricIds', 'sessionReportIds'])
      || !title || priorityTitles.has(title) || !asString(priority.description)
      || !asString(priority.exercise)) {
      throw new Error('Priorytet treningowy musi być unikalny i zawierać praktyczne ćwiczenie.');
    }
    validateReferences({
      metricIds: priority.metricIds,
      sessionReportIds: priority.sessionReportIds,
      input,
    });
    priorityTitles.add(title);
  });

  const insights = Array.isArray(analysis.categoryInsights) ? analysis.categoryInsights : [];
  const categories = expectedCategories(input.criteria.gameType);
  const returnedCategories = insights.map((insight) => asString(insight?.category).toLowerCase());
  if (insights.length !== categories.length || unique(returnedCategories).length !== insights.length
    || [...returnedCategories].sort().join('|') !== [...categories].sort().join('|')) {
    throw new Error('Analiza gracza ma nieprawidłowe sekcje Cash/Turnieje.');
  }
  insights.forEach((insight) => {
    if (!hasExactKeys(insight, ['category', 'summary', 'metricIds', 'sessionReportIds'])
      || !asString(insight.summary)) {
      throw new Error('Sekcja typu gry ma nieprawidłowy format lub puste podsumowanie.');
    }
    validateReferences({
      metricIds: insight.metricIds,
      sessionReportIds: insight.sessionReportIds,
      input,
      category: insight.category,
    });
  });
  return analysis;
};

export const buildPlayerAnalysisModelContext = (input) => ({
  criteria: input.criteria,
  actualDateRange: input.actualDateRange,
  handCount: input.handCount,
  sessionCount: input.sessionCount,
  metrics: input.metrics,
  profileStyleId: input.profileStyleId,
  reliabilityId: input.reliabilityId,
  metricCatalog: input.metricCatalog,
  sessionEvidence: {
    coverage: input.sessionEvidence.coverage,
    reports: input.sessionEvidence.reports.map((report) => ({
      reportId: report.reportId,
      type: report.type,
      date: report.date,
      summary: report.summary,
      leaks: report.leaks,
    })),
  },
});

const formatAllowedIds = (ids) => ids.length > 0 ? ids.join(', ') : '(brak dostępnych identyfikatorów)';

export const buildPlayerAnalysisPrompt = (input) => {
  const metricIds = Object.keys(input.metricCatalog);
  const sessionReportIds = input.sessionEvidence.reports.map((report) => report.reportId);
  return `Jesteś profesjonalnym trenerem pokera. Tworzysz przekrojową analizę statystyk Hero po polsku.

Pracuj wyłącznie na lokalnych metrykach i opcjonalnych skrótach raportów sesji przekazanych poniżej. Nie odtwarzaj historii rąk, kart ani akcji. Wynik finansowy jest kontekstem, a nie oceną jakości decyzji.

Twarde fakty lokalne są autorytatywne: styl to ${input.profileStyleId}, a wiarygodność to ${input.reliabilityId}. Dozwolone metricIds to wyłącznie: ${formatAllowedIds(metricIds)}. Dozwolone sessionReportIds to wyłącznie: ${formatAllowedIds(sessionReportIds)}. Każdy wniosek — podsumowanie, mocna strona, leak, priorytet i sekcja typu gry — powinien wskazać od 1 do 5 dokładnych metricIds z metricCatalog. sessionReportIds są opcjonalne i mogą być puste. Nie wymyślaj metryk ani źródeł.

Nie powtarzaj tego samego metricId ani sessionReportId w obrębie jednej listy referencji jednego wniosku. Referencje muszą pozostać zgodne z kategorią: w categoryInsights dla Cash używaj tylko metryk wspólnych lub Cash i tylko raportów Cash, a dla Turniejów analogicznie. Jeżeli skrót raportu sesji wspiera wniosek, traktuj go jako sygnał pomocniczy, nie jako dowód z pojedynczej sesji.

Nie twórz wspólnego wyniku ani winrate dla Cash i Turniejów. W trybie both zwróć dokładnie dwie osobne categoryInsights: cash i tournament, z odwołaniami wyłącznie do metryk wspólnych lub właściwej kategorii. Syntetyzuj lokalne statystyki z powtarzalnymi wzorcami znalezionymi w skrótach raportów sesji; pojedynczego raportu nie przedstawiaj jako ogólnej prawidłowości. strengths i leaks mają najwyżej po 5 pozycji. Każdy leak zawiera praktyczną correction. trainingPriorities zawiera dokładnie 3 różne priorytety, każdy z konkretnym exercise. Zachowaj format: summary, osobne wnioski categoryInsights dla Cash/Turniejów, strengths, leaks z korektami oraz trzy priorytety treningowe. Przy wiarygodności PRELIMINARY używaj ostrożnego języka.

Zwróć wyłącznie JSON zgodny ze schematem.

Dane analizy gracza:
${stableStringify(buildPlayerAnalysisModelContext(input))}`;
};
