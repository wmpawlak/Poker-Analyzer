import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DATA_DIRECTORY = path.resolve(serverDirectory, '..', 'data');
export const AI_ANALYSES_CACHE_FILENAME = 'poker-ai-analyses-v1.json';
export const AI_ANALYSES_CACHE_VERSION = 1;
export const MAX_AI_ANALYSES_CACHE_BYTES = 10 * 1024 * 1024;

const forbiddenKeys = new Set([
  'rawtext',
  'handhistory',
  'hands',
  'apikey',
  'openaiapikey',
  'geminiapikey',
  'geminikey',
  'authorization',
  'secret',
]);

const isForbiddenEntry = (key, value) => {
  const normalizedKey = key.replaceAll('_', '').toLowerCase();
  if (!forbiddenKeys.has(normalizedKey)) return false;
  if (normalizedKey === 'hands' && typeof value === 'number' && Number.isFinite(value)) return false;
  return true;
};

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const cacheError = (message, code = 'AI_CACHE_INVALID') => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const assertSafeReport = (value) => {
  if (!isObject(value)) throw cacheError('Raport AI w cache ma nieprawidłowy format.');
  const visit = (candidate) => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!isObject(candidate)) return;
    Object.entries(candidate).forEach(([key, nestedValue]) => {
      if (isForbiddenEntry(key, nestedValue)) {
        throw cacheError('Cache AI nie może zawierać surowych historii ani sekretów.');
      }
      visit(nestedValue);
    });
  };
  visit(value);
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const sanitizeImportedValue = (value) => {
  if (Array.isArray(value)) return value.map(sanitizeImportedValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key, nestedValue]) => !isForbiddenEntry(key, nestedValue))
    .map(([key, nestedValue]) => [key, sanitizeImportedValue(nestedValue)]));
};

const safeReportIdPart = (value) => String(value ?? '')
  .replace(/[^a-zA-Z0-9_-]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 120) || 'unknown';

const migrateLegacyReportList = ({ entry, type, ownerId, importedAt }) => {
  const candidates = Array.isArray(entry) ? entry : [entry];
  return candidates
    .filter(isObject)
    .map((candidate, index) => {
      const report = Object.hasOwn(candidate, 'analysis')
        ? candidate
        : { analysis: candidate };
      const sanitized = sanitizeImportedValue(report);
      return {
        ...sanitized,
        reportId: typeof sanitized.reportId === 'string' && sanitized.reportId.trim()
          ? sanitized.reportId
          : `legacy-import-${type}-${safeReportIdPart(ownerId)}-${index + 1}`,
        analyzedAt: typeof sanitized.analyzedAt === 'string' && sanitized.analyzedAt.trim()
          ? sanitized.analyzedAt
          : importedAt,
        ...(type === 'hand' && !isObject(sanitized.model)
          ? { model: { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' } }
          : {}),
      };
    });
};

const migrateLegacyReportMap = ({ value, type, importedAt }) => (
  isObject(value)
    ? Object.fromEntries(Object.entries(value).map(([ownerId, entry]) => [
      ownerId,
      migrateLegacyReportList({ entry, type, ownerId, importedAt }),
    ]))
    : {}
);

export const migrateLocalStorageAiAnalyses = (value, importedAt = new Date().toISOString()) => {
  const source = isObject(value?.cache) ? value.cache : value;
  const groupEntries = Array.isArray(source?.sessionGroupAnalyses)
    ? source.sessionGroupAnalyses
    : isObject(source?.sessionGroupAnalyses)
      ? Object.values(source.sessionGroupAnalyses)
      : [];
  return normalizeAiAnalysesCache({
    version: AI_ANALYSES_CACHE_VERSION,
    updatedAt: null,
    handAnalyses: migrateLegacyReportMap({
      value: source?.handAnalyses,
      type: 'hand',
      importedAt,
    }),
    sessionAnalyses: migrateLegacyReportMap({
      value: source?.sessionAnalyses,
      type: 'session',
      importedAt,
    }),
    sessionGroupAnalyses: migrateLegacyReportList({
      entry: groupEntries,
      type: 'session-group',
      ownerId: 'group',
      importedAt,
    }),
    playerAnalyses: migrateLegacyReportList({
      entry: Array.isArray(source?.playerAnalyses) ? source.playerAnalyses : [],
      type: 'player',
      ownerId: 'player',
      importedAt,
    }),
  });
};

const normalizeReferenceWarnings = (warnings) => (
  Array.isArray(warnings)
    ? warnings
      .filter((warning) => isObject(warning))
      .map((warning) => ({
        path: typeof warning.path === 'string' ? warning.path.trim() : '',
        kind: typeof warning.kind === 'string' ? warning.kind.trim() : '',
        reason: typeof warning.reason === 'string' ? warning.reason.trim() : '',
        discardedIds: Array.isArray(warning.discardedIds)
          ? warning.discardedIds.map((id) => String(id ?? '').trim())
          : [],
      }))
      .filter((warning) => warning.path && warning.kind && warning.reason)
    : []
);

const normalizeReportList = (reports, label, includeReferenceWarnings = false) => {
  if (!Array.isArray(reports)) throw cacheError(`Cache AI: pole ${label} musi być tablicą.`);
  const seen = new Set();
  return reports.filter((report) => {
    assertSafeReport(report);
    const reportId = typeof report.reportId === 'string' ? report.reportId.trim() : '';
    if (!reportId) throw cacheError(`Cache AI: raport w polu ${label} nie ma reportId.`);
    if (seen.has(reportId)) return false;
    seen.add(reportId);
    return true;
  }).map((report) => ({
    ...clone(report),
    ...(includeReferenceWarnings
      ? { referenceWarnings: normalizeReferenceWarnings(report.referenceWarnings) }
      : {}),
  }));
};

const normalizeReportMap = (reports, label) => {
  if (!isObject(reports)) throw cacheError(`Cache AI: pole ${label} musi być obiektem.`);
  return Object.fromEntries(Object.entries(reports).map(([key, value]) => [
    key,
    normalizeReportList(value, `${label}.${key}`),
  ]));
};

export const createEmptyAiAnalysesCache = () => ({
  version: AI_ANALYSES_CACHE_VERSION,
  updatedAt: null,
  handAnalyses: {},
  sessionAnalyses: {},
  sessionGroupAnalyses: [],
  playerAnalyses: [],
});

export const normalizeAiAnalysesCache = (value) => {
  if (!isObject(value) || value.version !== AI_ANALYSES_CACHE_VERSION) {
    throw cacheError('Cache AI ma nieobsługiwaną wersję formatu.');
  }
  if (value.updatedAt !== null && typeof value.updatedAt !== 'string') {
    throw cacheError('Cache AI ma nieprawidłową datę aktualizacji.');
  }
  return {
    version: AI_ANALYSES_CACHE_VERSION,
    updatedAt: value.updatedAt || null,
    handAnalyses: normalizeReportMap(value.handAnalyses, 'handAnalyses'),
    sessionAnalyses: normalizeReportMap(value.sessionAnalyses, 'sessionAnalyses'),
    sessionGroupAnalyses: normalizeReportList(value.sessionGroupAnalyses, 'sessionGroupAnalyses'),
    playerAnalyses: normalizeReportList(
      value.playerAnalyses || [],
      'playerAnalyses',
      true,
    ),
  };
};

const mergeReportLists = (left = [], right = []) => {
  const merged = [];
  const seen = new Set();
  [...left, ...right].forEach((report) => {
    const reportId = report.reportId;
    if (seen.has(reportId)) return;
    seen.add(reportId);
    merged.push(clone(report));
  });
  return merged;
};

const mergeReportMaps = (left, right) => {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
  return Object.fromEntries(keys.map((key) => [
    key,
    mergeReportLists(left[key] || [], right[key] || []),
  ]));
};

export const mergeAiAnalysesCaches = (left, right) => {
  const normalizedLeft = normalizeAiAnalysesCache(left || createEmptyAiAnalysesCache());
  const normalizedRight = normalizeAiAnalysesCache(right || createEmptyAiAnalysesCache());
  return {
    version: AI_ANALYSES_CACHE_VERSION,
    updatedAt: normalizedRight.updatedAt || normalizedLeft.updatedAt || null,
    handAnalyses: mergeReportMaps(normalizedLeft.handAnalyses, normalizedRight.handAnalyses),
    sessionAnalyses: mergeReportMaps(normalizedLeft.sessionAnalyses, normalizedRight.sessionAnalyses),
    sessionGroupAnalyses: mergeReportLists(
      normalizedLeft.sessionGroupAnalyses,
      normalizedRight.sessionGroupAnalyses,
    ),
    playerAnalyses: mergeReportLists(normalizedLeft.playerAnalyses, normalizedRight.playerAnalyses),
  };
};

const getCachePath = (dataDirectory = DEFAULT_DATA_DIRECTORY) => {
  const resolvedDirectory = path.resolve(dataDirectory);
  const resolvedFile = path.resolve(resolvedDirectory, AI_ANALYSES_CACHE_FILENAME);
  if (!resolvedFile.startsWith(`${resolvedDirectory}${path.sep}`)) {
    throw cacheError('Plik cache znajduje się poza katalogiem danych.');
  }
  return resolvedFile;
};

export const readAiAnalysesCache = async (dataDirectory = DEFAULT_DATA_DIRECTORY) => {
  const filePath = getCachePath(dataDirectory);
  let text;
  try {
    const stats = await fs.stat(filePath);
    if (stats.size > MAX_AI_ANALYSES_CACHE_BYTES) {
      throw cacheError('Cache AI przekracza dopuszczalny rozmiar.', 'AI_CACHE_TOO_LARGE');
    }
    text = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return createEmptyAiAnalysesCache();
    if (error.code === 'AI_CACHE_TOO_LARGE') throw error;
    throw cacheError('Nie udało się odczytać cache analiz AI.', 'AI_CACHE_READ_FAILED');
  }

  try {
    return normalizeAiAnalysesCache(JSON.parse(text));
  } catch (error) {
    if (error.code === 'AI_CACHE_INVALID') throw error;
    throw cacheError('Cache AI nie zawiera prawidłowego JSON.', 'AI_CACHE_INVALID');
  }
};

export const writeAiAnalysesCache = async (cache, dataDirectory = DEFAULT_DATA_DIRECTORY) => {
  const normalized = normalizeAiAnalysesCache(cache);
  const serialized = `${JSON.stringify(normalized, null, 2)}\n`;
  const byteLength = Buffer.byteLength(serialized, 'utf8');
  if (byteLength > MAX_AI_ANALYSES_CACHE_BYTES) {
    throw cacheError('Cache AI przekracza dopuszczalny rozmiar.', 'AI_CACHE_TOO_LARGE');
  }

  const resolvedDirectory = path.resolve(dataDirectory);
  const filePath = getCachePath(resolvedDirectory);
  await fs.mkdir(resolvedDirectory, { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, serialized, 'utf8');
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
  return normalized;
};

export const pruneAiAnalysesCache = (cache, sessionIds = []) => {
  const normalized = normalizeAiAnalysesCache(cache);
  const oldSessionIds = new Set(sessionIds.map((id) => String(id)).filter(Boolean));
  if (oldSessionIds.size === 0) return normalized;

  const referencesOldSession = (source) => {
    const sessionId = String(source?.sessionId || '');
    const sourceId = String(source?.sourceId || '');
    return oldSessionIds.has(sessionId)
      || [...oldSessionIds].some((oldId) => sourceId === oldId || sourceId.endsWith(`:${oldId}`));
  };

  return {
    ...normalized,
    sessionAnalyses: Object.fromEntries(
      Object.entries(normalized.sessionAnalyses)
        .filter(([sessionId]) => !oldSessionIds.has(sessionId)),
    ),
    sessionGroupAnalyses: normalized.sessionGroupAnalyses.filter((report) => ![
      ...(Array.isArray(report?.sources) ? report.sources : []),
      ...(Array.isArray(report?.sourceReports) ? report.sourceReports : []),
    ].some(referencesOldSession)),
    playerAnalyses: normalized.playerAnalyses,
  };
};

const countReports = (cache) => (
  Object.values(cache.handAnalyses).flat().length
  + Object.values(cache.sessionAnalyses).flat().length
  + cache.sessionGroupAnalyses.length
  + cache.playerAnalyses.length
);

// Po świadomym zastąpieniu kanonicznego rozdania nie wolno pozostawić raportów
// odwołujących się do poprzedniego odcisku sesji. Zachowujemy tylko raporty
// sesji zgodne z nowym indeksem i raporty grupowe, których snapshots nadal
// wskazują na istniejące, zgodne raporty sesji.
export const invalidateAiAnalysesForReplacedHand = (cache, {
  handId,
  sessionFingerprints = new Map(),
} = {}) => {
  const normalized = normalizeAiAnalysesCache(cache);
  const normalizedHandId = String(handId ?? '').trim();
  const currentFingerprints = sessionFingerprints instanceof Map
    ? sessionFingerprints
    : new Map(Object.entries(sessionFingerprints || {}));
  const handAnalyses = { ...normalized.handAnalyses };
  delete handAnalyses[normalizedHandId];

  const sessionAnalyses = Object.fromEntries(
    Object.entries(normalized.sessionAnalyses).flatMap(([sessionId, reports]) => {
      const fingerprint = currentFingerprints.get(String(sessionId));
      if (!fingerprint) return [];
      const matchingReports = reports.filter((report) => report?.fingerprint === fingerprint);
      return matchingReports.length > 0 ? [[sessionId, matchingReports]] : [];
    }),
  );

  const hasCurrentSourceReport = (source) => {
    const sessionId = String(source?.sessionId || '').trim();
    const reportId = String(source?.reportId || '').trim();
    const fingerprint = String(source?.reportFingerprint || source?.sessionFingerprint || '').trim();
    return Boolean(sessionId && reportId && fingerprint)
      && (sessionAnalyses[sessionId] || []).some((report) => (
        report.reportId === reportId && report.fingerprint === fingerprint
      ));
  };
  const sessionGroupAnalyses = normalized.sessionGroupAnalyses.filter((report) => {
    const sources = Array.isArray(report?.sources)
      ? report.sources
      : Array.isArray(report?.sourceReports)
        ? report.sourceReports
        : [];
    return sources.length === 0 || sources.every(hasCurrentSourceReport);
  });
  const nextCache = {
    ...normalized,
    handAnalyses,
    sessionAnalyses,
    sessionGroupAnalyses,
    playerAnalyses: normalized.playerAnalyses,
  };
  const before = countReports(normalized);
  const after = countReports(nextCache);
  return {
    cache: nextCache,
    counts: {
      handReportsRemoved: (normalized.handAnalyses[normalizedHandId] || []).length,
      sessionReportsRemoved: Object.values(normalized.sessionAnalyses).flat().length
        - Object.values(sessionAnalyses).flat().length,
      groupReportsRemoved: normalized.sessionGroupAnalyses.length - sessionGroupAnalyses.length,
      removed: before - after,
      preserved: after,
    },
  };
};
