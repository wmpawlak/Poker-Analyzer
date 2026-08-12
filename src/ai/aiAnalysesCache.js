export const AI_ANALYSES_CACHE_VERSION = 1;

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const createEmptyAiAnalysesCache = () => ({
  version: AI_ANALYSES_CACHE_VERSION,
  updatedAt: null,
  handAnalyses: {},
  sessionAnalyses: {},
  sessionGroupAnalyses: [],
  playerAnalyses: [],
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
    playerAnalyses: normalizeReportList(value.playerAnalyses),
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
    playerAnalyses: mergeReportLists(merged.playerAnalyses, cache.playerAnalyses),
  }), clone(base));
};

export const buildAiAnalysesCache = ({
  aiAnalyses = {},
  sessionAiAnalyses = {},
  sessionGroupAiAnalyses = [],
  playerAiAnalyses = [],
  updatedAt = null,
} = {}) => normalizeAiAnalysesCache({
  version: AI_ANALYSES_CACHE_VERSION,
  updatedAt,
  handAnalyses: aiAnalyses,
  sessionAnalyses: sessionAiAnalyses,
  sessionGroupAnalyses: sessionGroupAiAnalyses,
  playerAnalyses: playerAiAnalyses,
}) || createEmptyAiAnalysesCache();

export const applyAiAnalysesCache = ({
  cache,
  storage,
  handCacheKey,
  sessionCacheKey,
  sessionGroupCacheKey,
  playerCacheKey,
  includeSessionAnalyses = true,
} = {}) => {
  const normalized = normalizeAiAnalysesCache(cache) || createEmptyAiAnalysesCache();
  const applied = includeSessionAnalyses ? normalized : { ...normalized, sessionAnalyses: {} };
  if (storage) {
    storage.setItem(handCacheKey, JSON.stringify(applied.handAnalyses));
    if (includeSessionAnalyses) storage.setItem(sessionCacheKey, JSON.stringify(applied.sessionAnalyses));
    else storage.removeItem(sessionCacheKey);
    storage.setItem(sessionGroupCacheKey, JSON.stringify(applied.sessionGroupAnalyses));
    if (playerCacheKey) storage.setItem(playerCacheKey, JSON.stringify(applied.playerAnalyses));
  }
  return applied;
};

