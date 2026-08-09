export const AI_ANALYSES_CACHE_VERSION = 1;

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const createEmptyAiAnalysesCache = () => ({
  version: AI_ANALYSES_CACHE_VERSION,
  updatedAt: null,
  handAnalyses: {},
  sessionAnalyses: {},
  sessionGroupAnalyses: [],
});

const clone = (value) => JSON.parse(JSON.stringify(value));

const normalizeReportList = (reports) => {
  if (!Array.isArray(reports)) return [];
  const seen = new Set();
  return reports.filter((report) => {
    if (!isObject(report) || typeof report.reportId !== 'string' || !report.reportId.trim()) return false;
    if (seen.has(report.reportId)) return false;
    seen.add(report.reportId);
    return true;
  }).map(clone);
};

const normalizeReportMap = (reports) => (
  isObject(reports)
    ? Object.fromEntries(Object.entries(reports).map(([key, value]) => [key, normalizeReportList(value)]))
    : {}
);

export const normalizeAiAnalysesCache = (value) => {
  if (!isObject(value) || value.version !== AI_ANALYSES_CACHE_VERSION) return null;
  return {
    version: AI_ANALYSES_CACHE_VERSION,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
    handAnalyses: normalizeReportMap(value.handAnalyses),
    sessionAnalyses: normalizeReportMap(value.sessionAnalyses),
    sessionGroupAnalyses: normalizeReportList(value.sessionGroupAnalyses),
  };
};

const mergeReportLists = (left = [], right = []) => {
  const merged = [];
  const seen = new Set();
  [...left, ...right].forEach((report) => {
    if (!report?.reportId || seen.has(report.reportId)) return;
    seen.add(report.reportId);
    merged.push(clone(report));
  });
  return merged;
};

const mergeReportMaps = (left, right) => {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
  return Object.fromEntries(keys.map((key) => [
    key,
    mergeReportLists(left[key], right[key]),
  ]));
};

export const mergeAiAnalysesCaches = (...caches) => {
  const normalized = caches
    .map(normalizeAiAnalysesCache)
    .filter(Boolean);
  const base = normalized[0] || createEmptyAiAnalysesCache();
  return normalized.slice(1).reduce((merged, cache) => ({
    version: AI_ANALYSES_CACHE_VERSION,
    updatedAt: cache.updatedAt || merged.updatedAt || null,
    handAnalyses: mergeReportMaps(merged.handAnalyses, cache.handAnalyses),
    sessionAnalyses: mergeReportMaps(merged.sessionAnalyses, cache.sessionAnalyses),
    sessionGroupAnalyses: mergeReportLists(merged.sessionGroupAnalyses, cache.sessionGroupAnalyses),
  }), clone(base));
};

export const buildAiAnalysesCache = ({
  aiAnalyses = {},
  sessionAiAnalyses = {},
  sessionGroupAiAnalyses = [],
  updatedAt = null,
} = {}) => normalizeAiAnalysesCache({
  version: AI_ANALYSES_CACHE_VERSION,
  updatedAt,
  handAnalyses: aiAnalyses,
  sessionAnalyses: sessionAiAnalyses,
  sessionGroupAnalyses: sessionGroupAiAnalyses,
}) || createEmptyAiAnalysesCache();

export const applyAiAnalysesCache = ({
  cache,
  storage,
  handCacheKey,
  sessionCacheKey,
  sessionGroupCacheKey,
} = {}) => {
  const normalized = normalizeAiAnalysesCache(cache) || createEmptyAiAnalysesCache();
  if (storage) {
    storage.setItem(handCacheKey, JSON.stringify(normalized.handAnalyses));
    storage.setItem(sessionCacheKey, JSON.stringify(normalized.sessionAnalyses));
    storage.setItem(sessionGroupCacheKey, JSON.stringify(normalized.sessionGroupAnalyses));
  }
  return normalized;
};

