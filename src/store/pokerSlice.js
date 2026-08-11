import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import {
  applyAiAnalysesCache,
  buildAiAnalysesCache,
  mergeAiAnalysesCaches,
  normalizeAiAnalysesCache,
} from '../ai/aiAnalysesCache.js';

export const AI_ANALYSES_CACHE_KEY = 'poker_ai_analyses_v4';
export const LEGACY_V3_AI_ANALYSES_CACHE_KEY = 'poker_ai_analyses_v3';
export const LEGACY_AI_ANALYSES_CACHE_KEY = 'poker_ai_analyses_v2';
export const AI_DEFAULT_MODEL_CACHE_KEY = 'poker_ai_default_model';
export const SAVED_HANDS_CACHE_KEY = 'poker_saved_hands_v1';
export const SESSION_AI_ANALYSES_CACHE_KEY = 'poker_ai_session_analyses_v1';
export const SESSION_GROUP_AI_ANALYSES_CACHE_KEY = 'poker_ai_session_group_analyses_v1';
export const PLAYER_AI_ANALYSES_CACHE_KEY = 'poker_ai_player_analyses_v1';
export const DEFAULT_AI_MODEL = 'gpt-5.6-terra';
export const OPEN_HAND_CACHE_LIMIT = 8;
export const AI_MODEL_CATALOG = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
];
export const AI_MODEL_IDS = AI_MODEL_CATALOG.map(({ id }) => id);
const LEGACY_GEMINI_MODEL = { ...AI_MODEL_CATALOG[0] };

export {
  analysisResponseSchema,
  buildHandAnalysisPrompt,
  validateHandAnalysis,
} from '../ai/handAnalysisContract.js';

const getResponseErrorDetails = async (response, fallbackMessage) => {
  try {
    const data = await response.json();
    return {
      message: typeof data?.error === 'string' && data.error.trim() ? data.error : fallbackMessage,
      code: typeof data?.code === 'string' && data.code.trim() ? data.code : undefined,
      status: response.status,
    };
  } catch {
    return { message: fallbackMessage, code: undefined, status: response.status };
  }
};

const getResponseError = async (response, fallbackMessage) => (
  (await getResponseErrorDetails(response, fallbackMessage)).message
);

const readLocalStorageJson = (storage, key, fallback) => {
  try {
    const parsed = JSON.parse(storage.getItem(key));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const parseStoredObject = (value) => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const parseStoredArray = (value) => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const EMPTY_STORAGE = Object.freeze({
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});

const getBrowserStorage = () => globalThis.localStorage || EMPTY_STORAGE;

const createReportId = (scope) => (
  globalThis.crypto?.randomUUID?.()
  || `${scope}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
);

const normalizeHistory = (entry, handId, analyzedAt, sourceVersion) => {
  const reports = Array.isArray(entry) ? entry : entry?.analysis ? [entry] : [];
  return reports.map((report, index) => ({
    ...report,
    reportId: report.reportId || `legacy-${sourceVersion}-${handId}-${index + 1}`,
    analyzedAt: report.analyzedAt || analyzedAt,
  }));
};

export const loadDefaultAiModel = (storage = getBrowserStorage()) => {
  const storedModel = storage.getItem(AI_DEFAULT_MODEL_CACHE_KEY);
  return AI_MODEL_IDS.includes(storedModel) ? storedModel : DEFAULT_AI_MODEL;
};

export const loadAiAnalyses = ({
  storage = getBrowserStorage(),
  analyzedAt = new Date().toISOString(),
} = {}) => {
  storage.removeItem('poker_ai_analyses');
  storage.removeItem('poker_gemini_key');

  const cachedV4 = parseStoredObject(storage.getItem(AI_ANALYSES_CACHE_KEY));
  if (cachedV4) {
    storage.removeItem(LEGACY_V3_AI_ANALYSES_CACHE_KEY);
    storage.removeItem(LEGACY_AI_ANALYSES_CACHE_KEY);
    const normalized = Object.fromEntries(
      Object.entries(cachedV4).map(([handId, entry]) => [
        handId,
        normalizeHistory(entry, handId, analyzedAt, 'v4'),
      ]),
    );
    storage.setItem(AI_ANALYSES_CACHE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  const cachedV3 = parseStoredObject(storage.getItem(LEGACY_V3_AI_ANALYSES_CACHE_KEY));
  const cachedV2 = parseStoredObject(storage.getItem(LEGACY_AI_ANALYSES_CACHE_KEY));
  const source = cachedV3 || cachedV2;
  if (!source) return {};

  const migrated = Object.fromEntries(
    Object.entries(source).map(([handId, entry]) => (
      cachedV3
        ? [handId, normalizeHistory(entry, handId, analyzedAt, 'v3')]
        : [handId, normalizeHistory({
          model: { ...LEGACY_GEMINI_MODEL },
          analyzedAt,
          analysis: entry,
        }, handId, analyzedAt, 'v2')]
    )),
  );
  storage.setItem(AI_ANALYSES_CACHE_KEY, JSON.stringify(migrated));
  storage.removeItem(LEGACY_V3_AI_ANALYSES_CACHE_KEY);
  storage.removeItem(LEGACY_AI_ANALYSES_CACHE_KEY);
  return migrated;
};

export const loadSavedHandIds = (storage = getBrowserStorage()) => {
  const savedIds = parseStoredArray(storage.getItem(SAVED_HANDS_CACHE_KEY)) || [];
  return [...new Set(savedIds.map(String))];
};

export const loadSessionAiAnalyses = (storage = getBrowserStorage()) => {
  const cached = parseStoredObject(storage.getItem(SESSION_AI_ANALYSES_CACHE_KEY));
  if (!cached) return {};
  const normalized = Object.fromEntries(Object.entries(cached).map(([sessionId, reports]) => [
    sessionId,
    (Array.isArray(reports) ? reports : [])
      .filter((report) => report && typeof report === 'object')
      .map((report, index) => ({
        ...report,
        reportId: report.reportId || `legacy-session-v1-${sessionId}-${index + 1}`,
      })),
  ]));
  storage.setItem(SESSION_AI_ANALYSES_CACHE_KEY, JSON.stringify(normalized));
  return normalized;
};

export const loadSessionGroupAiAnalyses = (storage = getBrowserStorage()) => {
  const cached = parseStoredArray(storage.getItem(SESSION_GROUP_AI_ANALYSES_CACHE_KEY));
  if (!cached) return [];
  const normalized = cached
    .filter((report) => report && typeof report === 'object')
    .map((report, index) => ({
      ...report,
      reportId: report.reportId || `legacy-session-group-v1-${index + 1}`,
    }));
  storage.setItem(SESSION_GROUP_AI_ANALYSES_CACHE_KEY, JSON.stringify(normalized));
  return normalized;
};

export const loadPlayerAiAnalyses = (storage = getBrowserStorage()) => {
  const cached = parseStoredArray(storage.getItem(PLAYER_AI_ANALYSES_CACHE_KEY));
  if (!cached) return [];
  const normalized = cached
    .filter((report) => report && typeof report === 'object')
    .map((report, index) => ({
      ...report,
      reportId: report.reportId || `legacy-player-v1-${index + 1}`,
    }));
  storage.setItem(PLAYER_AI_ANALYSES_CACHE_KEY, JSON.stringify(normalized));
  return normalized;
};

const buildCurrentAiAnalysesCache = (state) => buildAiAnalysesCache({
  aiAnalyses: state.aiAnalyses,
  sessionAiAnalyses: state.sessionAiAnalyses,
  sessionGroupAiAnalyses: state.sessionGroupAiAnalyses,
  playerAiAnalyses: state.playerAiAnalyses,
});

const buildRawLocalStorageAiAnalyses = (storage = getBrowserStorage()) => ({
  handAnalyses: readLocalStorageJson(storage, AI_ANALYSES_CACHE_KEY, {}),
  sessionAnalyses: readLocalStorageJson(storage, SESSION_AI_ANALYSES_CACHE_KEY, {}),
  sessionGroupAnalyses: readLocalStorageJson(storage, SESSION_GROUP_AI_ANALYSES_CACHE_KEY, []),
  playerAnalyses: readLocalStorageJson(storage, PLAYER_AI_ANALYSES_CACHE_KEY, []),
});

const readAiCacheResponse = async (response, fallbackMessage) => {
  if (!response.ok) throw new Error(await getResponseError(response, fallbackMessage));
  const body = await response.json();
  const cache = normalizeAiAnalysesCache(body?.cache);
  if (!cache) throw new Error('Serwer zwrócił nieprawidłowy wspólny cache analiz AI.');
  return cache;
};

const requireRevision = (state) => {
  const revision = String(state.dataset.datasetRevision || '').trim();
  if (!revision) throw new Error('Dataset nie jest jeszcze gotowy. Odśwież dane i spróbuj ponownie.');
  return revision;
};

const rejectAiResponse = async ({ response, dispatch, rejectWithValue, fallbackMessage }) => {
  const details = await getResponseErrorDetails(response, fallbackMessage);
  if (response.status === 409 && details.code === 'DATASET_REVISION_MISMATCH') {
    // Tylko odświeżamy metadane. Nie ponawiamy automatycznie odpłatnego żądania AI.
    void dispatch(refreshDataset());
  }
  return rejectWithValue(details);
};

const readJsonResponse = async (response, fallbackMessage) => {
  if (!response.ok) throw new Error(await getResponseError(response, fallbackMessage));
  return response.json();
};

export const refreshDataset = createAsyncThunk(
  'poker/refreshDataset',
  async (_, { rejectWithValue }) => {
    try {
      return await readJsonResponse(await fetch('/api/dataset'), 'Nie udało się pobrać informacji o datasecie.');
    } catch (error) {
      return rejectWithValue(error.message || 'Nie udało się pobrać informacji o datasecie.');
    }
  },
  { condition: (_, { getState }) => getState().poker.dataset.status !== 'loading' },
);

export const refreshDataStatus = createAsyncThunk(
  'poker/refreshDataStatus',
  async (_, { rejectWithValue }) => {
    try {
      return await readJsonResponse(await fetch('/api/data/status'), 'Nie udało się pobrać statusu danych.');
    } catch (error) {
      return rejectWithValue(error.message || 'Nie udało się pobrać statusu danych.');
    }
  },
);

export const refreshImportCenter = createAsyncThunk(
  'poker/refreshImportCenter',
  async (_, { rejectWithValue }) => {
    try {
      const [dataStatus, imports] = await Promise.all([
        readJsonResponse(await fetch('/api/data/status'), 'Nie udało się pobrać statusu danych.'),
        readJsonResponse(await fetch('/api/imports'), 'Nie udało się pobrać historii importów.'),
      ]);
      return { dataStatus, imports };
    } catch (error) {
      return rejectWithValue(error.message || 'Nie udało się pobrać centrum importu.');
    }
  },
);

export const scanInbox = createAsyncThunk(
  'poker/scanInbox',
  async (_, { dispatch, rejectWithValue }) => {
    try {
      const result = await readJsonResponse(
        await fetch('/api/data/refresh', { method: 'POST' }),
        'Nie udało się sprawdzić katalogu inbox.',
      );
      void dispatch(refreshImportCenter());
      return result;
    } catch (error) {
      return rejectWithValue(error.message || 'Nie udało się sprawdzić katalogu inbox.');
    }
  },
  { condition: (_, { getState }) => getState().poker.importCenter.actionStatus !== 'loading' },
);

export const uploadImport = createAsyncThunk(
  'poker/uploadImport',
  async ({ file }, { dispatch, rejectWithValue }) => {
    try {
      if (typeof File === 'undefined' || !(file instanceof File) || !/\.txt$/i.test(file.name)) {
        throw new Error('Wybierz pojedynczy plik TXT do importu.');
      }
      const formData = new FormData();
      formData.append('file', file, file.name);
      const result = await readJsonResponse(
        await fetch('/api/imports', { method: 'POST', body: formData }),
        'Nie udało się przesłać pliku TXT.',
      );
      void dispatch(refreshImportCenter());
      return result;
    } catch (error) {
      return rejectWithValue(error.message || 'Nie udało się przesłać pliku TXT.');
    }
  },
  { condition: (_, { getState }) => getState().poker.importCenter.actionStatus !== 'loading' },
);

export const fetchOpenedHand = createAsyncThunk(
  'poker/fetchOpenedHand',
  async ({ handId }, { rejectWithValue }) => {
    try {
      if (!String(handId || '').trim()) throw new Error('Brakuje identyfikatora rozdania.');
      return await readJsonResponse(await fetch(`/api/hands/${encodeURIComponent(handId)}`), 'Nie udało się pobrać rozdania.');
    } catch (error) {
      return rejectWithValue(error.message || 'Nie udało się pobrać rozdania.');
    }
  },
);

const createQueryUrl = (pathname, params = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
};

const createAggregateQueryKey = ({ gameType = 'both', dateFrom = '', dateTo = '', onlyFlop = false, riverOrShowdownOnly = false } = {}) => (
  JSON.stringify({ gameType, dateFrom, dateTo, onlyFlop: Boolean(onlyFlop), riverOrShowdownOnly: Boolean(riverOrShowdownOnly) })
);

const normalizeCollectionHandIds = (ids) => (
  [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean))].sort()
);

const normalizeSessionIdsInOrder = (ids) => {
  const seen = new Set();
  return (Array.isArray(ids) ? ids : [])
    .map((id) => String(id || '').trim())
    .filter((id) => id && !seen.has(id) && seen.add(id));
};

const normalizeSessionQuery = (params = {}) => ({
  gameType: params.gameType || 'both',
  handRanking: params.handRanking || '',
  dateFrom: params.dateFrom || '',
  dateTo: params.dateTo || '',
});

export const createSessionMonthsQueryKey = (params = {}) => JSON.stringify(normalizeSessionQuery(params));

const getSummaryQueryKey = ({ datasetRevision = '', sessionIds = [] } = {}) => JSON.stringify({
  datasetRevision,
  sessionIds: normalizeSessionIdsInOrder(sessionIds),
});

const getSessionMonthKey = (session) => {
  const match = /^(\d{4})[/-](\d{2})(?:[/-]|$)/.exec(String(session?.dateStr || '').trim());
  return match ? `${match[1]}-${match[2]}` : '';
};

const createSessionsQueryKey = ({ gameType = '', handRanking = '' } = {}) => (
  JSON.stringify({ gameType, handRanking })
);

const createSessionHandsQueryKey = ({ sessionId, handRanking = '', sortBy = 'date', sortOrder = 'desc' } = {}) => (
  JSON.stringify({ sessionId: String(sessionId || ''), handRanking, sortBy, sortOrder })
);

const createHandCollectionQueryKey = ({
  datasetRevision = '',
  gameType = '',
  mode = '',
  analyzedHandIds = [],
  savedHandIds = [],
  handRanking = '',
  sortBy = 'date',
  sortOrder = 'desc',
} = {}) => JSON.stringify({
  datasetRevision,
  gameType,
  mode,
  analyzedHandIds: normalizeCollectionHandIds(analyzedHandIds),
  savedHandIds: normalizeCollectionHandIds(savedHandIds),
  handRanking,
  sortBy,
  sortOrder,
});

const createSessionGroupPreviewQueryKey = ({ sessionIds = [], datasetRevision = '' } = {}) => (
  JSON.stringify({
    datasetRevision,
    sessionIds: [...new Set((Array.isArray(sessionIds) ? sessionIds : []).map(String).filter(Boolean))].sort(),
  })
);

const createEmptyHandCollectionPage = () => ({
  items: [],
  nextCursor: null,
  total: 0,
  collectionCounts: { analyzed: 0, saved: 0 },
  status: 'idle',
  error: null,
  datasetRevision: null,
  queryKey: null,
});

const createEmptySessionGroupPreview = () => ({
  data: null,
  status: 'idle',
  error: null,
  datasetRevision: null,
  queryKey: null,
});

const createEmptyPlayerAnalysisPreview = () => ({
  data: null,
  status: 'idle',
  error: null,
  datasetRevision: null,
  queryKey: null,
});

const createPlayerAnalysisQueryKey = ({
  gameType = 'both',
  dateFrom = '',
  dateTo = '',
  datasetRevision = '',
} = {}) => JSON.stringify({ gameType, dateFrom, dateTo, datasetRevision });

const createEmptySessionMonthIndex = () => ({
  months: [],
  availableRanks: [],
  status: 'idle',
  error: null,
  allStatus: 'idle',
  allError: null,
  datasetRevision: null,
  requestId: null,
  allRequestId: null,
});

const createEmptySessionMonthPage = () => ({
  items: [],
  status: 'idle',
  error: null,
  datasetRevision: null,
  requestId: null,
});

const readAggregate = async (pathname, params, fallbackMessage) => (
  readJsonResponse(await fetch(createQueryUrl(pathname, params)), fallbackMessage)
);

export const fetchProfile = createAsyncThunk(
  'poker/fetchProfile',
  async (params = {}, { rejectWithValue }) => {
    try {
      const normalized = {
        gameType: params.gameType || 'both',
        dateFrom: params.dateFrom || '',
        dateTo: params.dateTo || '',
      };
      const result = await readAggregate('/api/profile', normalized, 'Nie udało się pobrać raportu profilu.');
      return { ...result, queryKey: createAggregateQueryKey(normalized) };
    } catch (error) {
      return rejectWithValue(error.message || 'Nie udało się pobrać raportu profilu.');
    }
  },
);

export const fetchPlayerAnalysisPreview = createAsyncThunk(
  'poker/fetchPlayerAnalysisPreview',
  async (params = {}, { getState, rejectWithValue, signal }) => {
    const normalized = {
      gameType: params.gameType || 'both',
      dateFrom: params.dateFrom || '',
      dateTo: params.dateTo || '',
    };
    const datasetRevision = String(getState().poker.dataset.datasetRevision || '');
    try {
      const response = await fetch(createQueryUrl('/api/player-analysis/preview', normalized), { signal });
      if (!response.ok) {
        return rejectWithValue(await getResponseErrorDetails(
          response,
          'Nie udało się pobrać podglądu analizy gracza.',
        ));
      }
      const result = await response.json();
      if (!result?.datasetRevision || !result?.metrics?.shared
        || typeof result.canAnalyze !== 'boolean' || !result?.sessionEvidence?.coverage) {
        throw new Error('Serwer zwrócił nieprawidłowy podgląd analizy gracza.');
      }
      return {
        ...result,
        queryKey: createPlayerAnalysisQueryKey({
          ...normalized,
          datasetRevision,
        }),
      };
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      return rejectWithValue({
        message: error.message || 'Nie udało się pobrać podglądu analizy gracza.',
      });
    }
  },
  {
    condition: (params = {}, { getState }) => {
      const state = getState().poker;
      const queryKey = createPlayerAnalysisQueryKey({
        ...params,
        datasetRevision: state.dataset.datasetRevision || '',
      });
      return state.playerAnalysisPreview.status !== 'loading'
        || state.playerAnalysisPreview.queryKey !== queryKey;
    },
  },
);

export const fetchOpponents = createAsyncThunk(
  'poker/fetchOpponents',
  async (params = {}, { rejectWithValue }) => {
    try {
      const normalized = {
        gameType: params.gameType || 'both',
        dateFrom: params.dateFrom || '',
        dateTo: params.dateTo || '',
      };
      const cursor = params.cursor || null;
      const result = await readAggregate(
        '/api/opponents',
        { ...normalized, cursor, limit: 100 },
        'Nie udało się pobrać listy przeciwników.',
      );
      return { ...result, cursor, queryKey: createAggregateQueryKey(normalized) };
    } catch (error) {
      return rejectWithValue(error.message || 'Nie udało się pobrać listy przeciwników.');
    }
  },
  {
    condition: (params = {}, { getState }) => {
      const opponents = getState().poker.aggregates.opponents;
      return opponents.status !== 'loading'
        || createAggregateQueryKey(params) !== opponents.queryKey;
    },
  },
);

export const fetchCards = createAsyncThunk(
  'poker/fetchCards',
  async (params = {}, { rejectWithValue }) => {
    try {
      const normalized = {
        gameType: params.gameType || 'both',
        dateFrom: params.dateFrom || '',
        dateTo: params.dateTo || '',
        riverOrShowdownOnly: Boolean(params.riverOrShowdownOnly),
      };
      const result = await readAggregate('/api/cards', normalized, 'Nie udało się pobrać statystyk kart startowych.');
      return { ...result, queryKey: createAggregateQueryKey(normalized) };
    } catch (error) {
      return rejectWithValue(error.message || 'Nie udało się pobrać statystyk kart startowych.');
    }
  },
);

export const fetchWallet = createAsyncThunk(
  'poker/fetchWallet',
  async (params = {}, { rejectWithValue }) => {
    try {
      const normalized = {
        dateFrom: params.dateFrom || '',
        dateTo: params.dateTo || '',
        onlyFlop: Boolean(params.onlyFlop),
      };
      const result = await readAggregate('/api/wallet', normalized, 'Nie udało się pobrać danych portfela.');
      return { ...result, queryKey: createAggregateQueryKey({ gameType: 'cash', ...normalized }) };
    } catch (error) {
      return rejectWithValue(error.message || 'Nie udało się pobrać danych portfela.');
    }
  },
);

export const fetchSessionMonths = createAsyncThunk(
  'poker/fetchSessionMonths',
  async (params = {}, { rejectWithValue, signal }) => {
    const query = normalizeSessionQuery(params);
    try {
      if (!['cash', 'tournament', 'both'].includes(query.gameType)) throw new Error('Nieprawidłowy typ sesji.');
      const result = await readJsonResponse(
        await fetch(createQueryUrl('/api/session-months', query), { signal }),
        'Nie udało się pobrać indeksu miesięcy sesji.',
      );
      return { ...result, query, queryKey: createSessionMonthsQueryKey(query) };
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      return rejectWithValue(error.message || 'Nie udało się pobrać indeksu miesięcy sesji.');
    }
  },
  {
    condition: (params = {}, { getState }) => {
      const query = normalizeSessionQuery(params);
      if (!['cash', 'tournament', 'both'].includes(query.gameType)) return true;
      const state = getState().poker;
      const entry = state.sessionMonthIndexes[createSessionMonthsQueryKey(query)];
      if (entry?.status === 'loading') return false;
      return !(entry?.status === 'succeeded'
        && entry.datasetRevision
        && entry.datasetRevision === state.dataset.datasetRevision);
    },
  },
);

export const fetchSessionMonth = createAsyncThunk(
  'poker/fetchSessionMonth',
  async ({ month, ...params } = {}, { rejectWithValue, signal }) => {
    const query = normalizeSessionQuery(params);
    try {
      if (!['cash', 'tournament', 'both'].includes(query.gameType)) throw new Error('Nieprawidłowy typ sesji.');
      const result = await readJsonResponse(
        await fetch(createQueryUrl('/api/sessions', { ...query, month }), { signal }),
        'Nie udało się pobrać sesji z wybranego miesiąca.',
      );
      return { ...result, month, query, queryKey: createSessionMonthsQueryKey(query) };
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      return rejectWithValue(error.message || 'Nie udało się pobrać sesji z wybranego miesiąca.');
    }
  },
  {
    condition: ({ month, ...params } = {}, { getState }) => {
      const query = normalizeSessionQuery(params);
      if (!['cash', 'tournament', 'both'].includes(query.gameType) || !month) return true;
      const state = getState().poker;
      const queryKey = createSessionMonthsQueryKey(query);
      const page = state.sessionMonthPages[queryKey]?.[month];
      if (page?.status === 'loading') return false;
      return !(page?.status === 'succeeded'
        && page.datasetRevision
        && page.datasetRevision === state.dataset.datasetRevision);
    },
  },
);

export const fetchAllSessionsForQuery = createAsyncThunk(
  'poker/fetchAllSessionsForQuery',
  async (params = {}, { rejectWithValue, signal }) => {
    const query = normalizeSessionQuery(params);
    try {
      if (!['cash', 'tournament', 'both'].includes(query.gameType)) throw new Error('Nieprawidłowy typ sesji.');
      const result = await readJsonResponse(
        await fetch(createQueryUrl('/api/sessions', query), { signal }),
        'Nie udało się pobrać pełnej listy sesji.',
      );
      return { ...result, query, queryKey: createSessionMonthsQueryKey(query) };
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      return rejectWithValue(error.message || 'Nie udało się pobrać pełnej listy sesji.');
    }
  },
  {
    condition: (params = {}, { getState }) => {
      const query = normalizeSessionQuery(params);
      if (!['cash', 'tournament', 'both'].includes(query.gameType)) return true;
      const state = getState().poker;
      const entry = state.sessionMonthIndexes[createSessionMonthsQueryKey(query)];
      if (entry?.allStatus === 'loading') return false;
      return !(entry?.allStatus === 'succeeded'
        && entry.datasetRevision
        && entry.datasetRevision === state.dataset.datasetRevision);
    },
  },
);

export const fetchSessionSummariesByIds = createAsyncThunk(
  'poker/fetchSessionSummariesByIds',
  async ({ sessionIds = [], datasetRevision: requestedRevision } = {}, {
    dispatch, getState, rejectWithValue, signal,
  }) => {
    const normalizedIds = normalizeSessionIdsInOrder(sessionIds);
    const datasetRevision = String(requestedRevision || getState().poker.dataset.datasetRevision || '').trim();
    try {
      if (!datasetRevision) throw new Error('Dataset nie jest jeszcze gotowy.');
      const response = await fetch('/api/session-summaries/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datasetRevision, sessionIds: normalizedIds }),
        signal,
      });
      if (!response.ok) {
        const details = await getResponseErrorDetails(response, 'Nie udało się pobrać podsumowań sesji.');
        if (details.status === 409 && details.code === 'DATASET_REVISION_MISMATCH') void dispatch(refreshDataset());
        return rejectWithValue(details);
      }
      const result = await response.json();
      return {
        ...result,
        requestedSessionIds: normalizedIds,
        queryKey: getSummaryQueryKey({ datasetRevision, sessionIds: normalizedIds }),
      };
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      return rejectWithValue({ message: error.message || 'Nie udało się pobrać podsumowań sesji.' });
    }
  },
  {
    condition: ({ sessionIds = [], datasetRevision: requestedRevision } = {}, { getState }) => {
      const state = getState().poker;
      const datasetRevision = String(requestedRevision || state.dataset.datasetRevision || '').trim();
      const queryKey = getSummaryQueryKey({ datasetRevision, sessionIds });
      const entry = state.sessionSummaryQueries[queryKey];
      return entry?.status !== 'loading'
        && !(entry?.status === 'succeeded' && entry.datasetRevision === state.dataset.datasetRevision);
    },
  },
);

export const fetchSessions = createAsyncThunk(
  'poker/fetchSessions',
  async ({ gameType, handRanking = '' }, { rejectWithValue }) => {
    try {
      if (!['cash', 'tournament'].includes(gameType)) throw new Error('Nieprawidłowy typ sesji.');
      const result = await readJsonResponse(
        await fetch(createQueryUrl('/api/sessions', { gameType, handRanking })),
        'Nie udało się pobrać listy sesji.',
      );
      return { ...result, queryKey: createSessionsQueryKey({ gameType, handRanking }) };
    } catch (error) {
      return rejectWithValue(error.message || 'Nie udało się pobrać listy sesji.');
    }
  },
  {
    condition: ({ gameType, handRanking = '' }, { getState }) => {
      if (!['cash', 'tournament'].includes(gameType)) return false;
      const page = getState().poker.currentPages[gameType];
      return page.status !== 'loading' || page.queryKey !== createSessionsQueryKey({ gameType, handRanking });
    },
  },
);

export const fetchSessionDetail = createAsyncThunk(
  'poker/fetchSessionDetail',
  async ({ sessionId }, { rejectWithValue }) => {
    try {
      if (!String(sessionId || '').trim()) throw new Error('Brakuje identyfikatora sesji.');
      return await readJsonResponse(
        await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`),
        'Nie udało się pobrać podsumowania sesji.',
      );
    } catch (error) {
      return rejectWithValue(error.message || 'Nie udało się pobrać podsumowania sesji.');
    }
  },
  {
    condition: ({ sessionId }, { getState }) => {
      const state = getState().poker;
      const detail = state.sessionDetailsById[String(sessionId)];
      return detail?.status !== 'loading'
        && !(detail?.status === 'succeeded' && detail.datasetRevision === state.dataset.datasetRevision);
    },
  },
);

export const fetchSessionHands = createAsyncThunk(
  'poker/fetchSessionHands',
  async ({ sessionId, handRanking = '', sortBy = 'date', sortOrder = 'desc', cursor = null }, { rejectWithValue }) => {
    try {
      if (!String(sessionId || '').trim()) throw new Error('Brakuje identyfikatora sesji.');
      const query = { sessionId, handRanking, sortBy, sortOrder };
      const result = await readJsonResponse(
        await fetch(createQueryUrl(`/api/sessions/${encodeURIComponent(sessionId)}/hands`, {
          handRanking,
          sortBy,
          sortOrder,
          cursor,
          limit: 100,
        })),
        'Nie udało się pobrać rąk sesji.',
      );
      return { ...result, queryKey: createSessionHandsQueryKey(query) };
    } catch (error) {
      return rejectWithValue(error.message || 'Nie udało się pobrać rąk sesji.');
    }
  },
  {
    condition: ({ sessionId, handRanking = '', sortBy = 'date', sortOrder = 'desc', cursor = null }, { getState }) => {
      const state = getState().poker;
      const page = state.sessionHandsById[String(sessionId)];
      const queryKey = createSessionHandsQueryKey({ sessionId, handRanking, sortBy, sortOrder });
      if (page?.status === 'loading' && page.queryKey === queryKey) return false;
      if (!cursor) {
        return !(page?.status === 'succeeded'
          && page.datasetRevision === state.dataset.datasetRevision
          && page.queryKey === queryKey);
      }
      return page?.queryKey === queryKey && Boolean(page?.nextCursor);
    },
  },
);

export const fetchHandCollection = createAsyncThunk(
  'poker/fetchHandCollection',
  async (params = {}, { rejectWithValue }) => {
    try {
      const normalized = {
        datasetRevision: String(params.datasetRevision || '').trim(),
        gameType: params.gameType,
        mode: params.mode,
        analyzedHandIds: normalizeCollectionHandIds(params.analyzedHandIds),
        savedHandIds: normalizeCollectionHandIds(params.savedHandIds),
        handRanking: params.handRanking || '',
        sortBy: params.sortBy || 'date',
        sortOrder: params.sortOrder || 'desc',
      };
      if (!normalized.datasetRevision) throw new Error('Dataset is not ready yet.');
      if (!['cash', 'tournament'].includes(normalized.gameType)) throw new Error('Invalid hand collection game type.');
      if (!['analyzed', 'saved'].includes(normalized.mode)) throw new Error('Invalid hand collection mode.');
      const cursor = params.cursor || null;
      const result = await readJsonResponse(await fetch('/api/hand-collections/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...normalized, cursor, limit: 100 }),
      }), 'Unable to load the hand collection.');
      return { ...result, queryKey: createHandCollectionQueryKey(normalized) };
    } catch (error) {
      return rejectWithValue(error.message || 'Unable to load the hand collection.');
    }
  },
  {
    condition: (params = {}, { getState }) => {
      const { gameType, mode } = params;
      if (!['cash', 'tournament'].includes(gameType) || !['analyzed', 'saved'].includes(mode)) return false;
      const page = getState().poker.handCollections[gameType][mode];
      const queryKey = createHandCollectionQueryKey(params);
      if (page.status === 'loading' && page.queryKey === queryKey) return false;
      if (!params.cursor) return !(page.status === 'succeeded' && page.queryKey === queryKey);
      return page.queryKey === queryKey && Boolean(page.nextCursor);
    },
  },
);

export const fetchAiModels = createAsyncThunk(
  'poker/fetchAiModels',
  async (_, { rejectWithValue }) => {
    try {
      const { models } = await readJsonResponse(await fetch('/api/ai/models'), 'Nie udało się pobrać konfiguracji modeli AI.');
      if (!Array.isArray(models)) throw new Error('Serwer zwrócił nieprawidłową listę modeli AI.');
      return models;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  },
  { condition: (_, { getState }) => getState().poker.aiModelsStatus !== 'loading' },
);

export const syncAiAnalyses = createAsyncThunk(
  'poker/syncAiAnalyses',
  async (_, { getState, rejectWithValue }) => {
    try {
      const localCache = buildCurrentAiAnalysesCache(getState().poker);
      const remoteCache = await readAiCacheResponse(await fetch('/api/ai-analyses'), 'Nie udało się odczytać wspólnego cache analiz AI.');
      const mergedCache = mergeAiAnalysesCaches(remoteCache, localCache);
      const syncResponse = await fetch('/api/ai-analyses/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cache: mergedCache }),
      });
      if (syncResponse.ok) return await readAiCacheResponse(syncResponse, 'Nie udało się zapisać wspólnego cache analiz AI.');
      const importResponse = await fetch('/api/ai-analyses/import-local-storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRawLocalStorageAiAnalyses()),
      });
      return await readAiCacheResponse(importResponse, 'Nie udało się zaimportować starego lokalnego cache analiz AI.');
    } catch (error) {
      return rejectWithValue(error.message || 'Nie udało się zsynchronizować raportów AI.');
    }
  },
);

export const analyzeHandWithAI = createAsyncThunk(
  'poker/analyzeHand',
  async ({ handId, modelId }, { dispatch, getState, rejectWithValue }) => {
    try {
      const state = getState().poker;
      const response = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: modelId || state.defaultAiModel,
          handId,
          datasetRevision: requireRevision(state),
        }),
      });
      if (!response.ok) return rejectAiResponse({ response, dispatch, rejectWithValue, fallbackMessage: 'Nie udało się przeanalizować rozdania.' });
      const result = await response.json();
      if (!result?.model?.id || !result?.model?.name || !result?.analysis) throw new Error('Serwer zwrócił nieprawidłowy raport analizy AI.');
      return {
        handId: String(handId),
        reportId: createReportId(handId),
        model: result.model,
        analyzedAt: new Date().toISOString(),
        datasetRevision: result.datasetRevision,
        analysis: result.analysis,
      };
    } catch (error) {
      return rejectWithValue({ message: error.message || 'Nie udało się przeanalizować rozdania.' });
    }
  },
);

export const analyzeSessionWithAI = createAsyncThunk(
  'poker/analyzeSession',
  async ({ sessionId, modelId }, { dispatch, getState, rejectWithValue }) => {
    try {
      const state = getState().poker;
      const response = await fetch('/api/ai/analyze-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: modelId || state.defaultAiModel,
          sessionId,
          datasetRevision: requireRevision(state),
        }),
      });
      if (!response.ok) return rejectAiResponse({ response, dispatch, rejectWithValue, fallbackMessage: 'Nie udało się przeanalizować sesji.' });
      const result = await response.json();
      if (!result?.model?.id || !result?.model?.name || !result?.sessionId || !result?.fingerprint || !result?.analysis) throw new Error('Serwer zwrócił nieprawidłowy raport analizy sesji AI.');
      return {
        sessionId: result.sessionId,
        reportId: createReportId(result.sessionId),
        model: result.model,
        analyzedAt: new Date().toISOString(),
        fingerprint: result.fingerprint,
        datasetRevision: result.datasetRevision,
        analysis: result.analysis,
      };
    } catch (error) {
      return rejectWithValue({ message: error?.message || 'Nie udało się przeanalizować sesji.' });
    }
  },
  { condition: ({ sessionId }, { getState }) => getState().poker.sessionAnalysisStatusById[sessionId] !== 'loading' },
);

export const fetchSessionGroupPreview = createAsyncThunk(
  'poker/fetchSessionGroupPreview',
  async ({ sessionIds = [] } = {}, { dispatch, getState, rejectWithValue, signal }) => {
    try {
      const normalizedSessionIds = [...new Set((Array.isArray(sessionIds) ? sessionIds : []).map(String).filter(Boolean))];
      if (normalizedSessionIds.length === 0) throw new Error('Podgląd analizy wielu sesji wymaga co najmniej jednej sesji.');
      const state = getState().poker;
      const datasetRevision = requireRevision(state);
      const response = await fetch('/api/session-groups/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds: normalizedSessionIds, datasetRevision }),
        signal,
      });
      if (!response.ok) return rejectAiResponse({ response, dispatch, rejectWithValue, fallbackMessage: 'Nie udało się pobrać podglądu wybranych sesji.' });
      const result = await response.json();
      if (!result?.datasetRevision || !Array.isArray(result.sources) || !result?.metrics?.shared) {
        throw new Error('Serwer zwrócił nieprawidłowy podgląd analizy wielu sesji.');
      }
      return {
        ...result,
        queryKey: createSessionGroupPreviewQueryKey({ sessionIds: normalizedSessionIds, datasetRevision }),
      };
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      return rejectWithValue({ message: error?.message || 'Nie udało się pobrać podglądu wybranych sesji.' });
    }
  },
  {
    condition: ({ sessionIds = [] } = {}, { getState }) => {
      const state = getState().poker;
      const queryKey = createSessionGroupPreviewQueryKey({
        sessionIds,
        datasetRevision: state.dataset.datasetRevision || '',
      });
      return state.sessionGroupPreview.status !== 'loading' || state.sessionGroupPreview.queryKey !== queryKey;
    },
  },
);

export const analyzeSessionGroupWithAI = createAsyncThunk(
  'poker/analyzeSessionGroup',
  async ({ sessionIds, sourceIds, modelId }, { dispatch, getState, rejectWithValue }) => {
    try {
      const uniqueSessionIds = [...new Set((sessionIds || sourceIds || []).map(String).filter(Boolean))];
      if (uniqueSessionIds.length < 2) throw new Error('Analiza wielu sesji wymaga co najmniej dwóch różnych sesji.');
      const state = getState().poker;
      const response = await fetch('/api/ai/analyze-session-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: modelId || state.defaultAiModel,
          sessionIds: uniqueSessionIds,
          datasetRevision: requireRevision(state),
        }),
      });
      if (!response.ok) return rejectAiResponse({ response, dispatch, rejectWithValue, fallbackMessage: 'Nie udało się przeanalizować wybranych sesji.' });
      const result = await response.json();
      if (!result?.model?.id || !result?.model?.name || !result?.fingerprint || !result?.analysis) throw new Error('Serwer zwrócił nieprawidłowy raport analizy wielu sesji AI.');
      return {
        reportId: createReportId(`session-group-${result.fingerprint}`),
        model: result.model,
        analyzedAt: new Date().toISOString(),
        sessionIds: Array.isArray(result.sources) ? result.sources.map((source) => source.sessionId) : uniqueSessionIds,
        sessionCount: Number(result.sessionCount) || uniqueSessionIds.length,
        fingerprint: result.fingerprint,
        datasetRevision: result.datasetRevision,
        activeCategory: result.activeCategory,
        dateRange: result.dateRange,
        sources: result.sources,
        handCount: Number(result.handCount) || 0,
        categoryBreakdown: result.categoryBreakdown,
        analysis: result.analysis,
      };
    } catch (error) {
      return rejectWithValue({ message: error?.message || 'Nie udało się przeanalizować wybranych sesji.' });
    }
  },
  { condition: (_, { getState }) => getState().poker.sessionGroupAnalysisStatus !== 'loading' },
);

export const analyzePlayerWithAI = createAsyncThunk(
  'poker/analyzePlayer',
  async (params = {}, { dispatch, getState, rejectWithValue }) => {
    try {
      const state = getState().poker;
      const profileRange = state.filters.dateRanges.profile;
      const criteria = {
        gameType: params.gameType || state.filters.gameType || 'both',
        dateFrom: params.dateFrom ?? profileRange.from ?? '',
        dateTo: params.dateTo ?? profileRange.to ?? '',
      };
      const response = await fetch('/api/ai/analyze-player', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: params.modelId || state.defaultAiModel,
          ...criteria,
          datasetRevision: requireRevision(state),
        }),
      });
      if (!response.ok) {
        return rejectAiResponse({
          response,
          dispatch,
          rejectWithValue,
          fallbackMessage: 'Nie udało się przeanalizować statystyk gracza.',
        });
      }
      const result = await response.json();
      if (!result?.model?.id || !result?.model?.name || !result?.fingerprint
        || !result?.analysis || !result?.criteria || !result?.metrics?.shared
        || !result?.sessionEvidence?.coverage || !Array.isArray(result.sessionEvidence.reports)) {
        throw new Error('Serwer zwrócił nieprawidłowy raport analizy gracza AI.');
      }
      return {
        reportId: createReportId(`player-${result.fingerprint}`),
        analyzedAt: new Date().toISOString(),
        model: result.model,
        datasetRevision: result.datasetRevision,
        fingerprint: result.fingerprint,
        criteria: result.criteria,
        handCount: Number(result.handCount) || 0,
        sessionCount: Number(result.sessionCount) || 0,
        snapshot: {
          actualDateRange: result.actualDateRange,
          handCount: Number(result.handCount) || 0,
          sessionCount: Number(result.sessionCount) || 0,
          cashHandCount: Number(result.cashHandCount) || 0,
          tournamentHandCount: Number(result.tournamentHandCount) || 0,
          metrics: result.metrics,
          profileStyleId: result.profileStyleId,
          profileStyle: result.profileStyle,
          reliabilityId: result.reliabilityId,
          reliability: result.reliability,
          metricCatalog: result.metricCatalog,
        },
        sourceCoverage: result.sessionEvidence.coverage,
        sources: result.sessionEvidence.reports,
        analysis: result.analysis,
      };
    } catch (error) {
      return rejectWithValue({
        message: error?.message || 'Nie udało się przeanalizować statystyk gracza.',
      });
    }
  },
  { condition: (_, { getState }) => getState().poker.playerAnalysisStatus !== 'loading' },
);

const initialState = {
  dataset: {
    datasetRevision: null,
    status: 'idle',
    error: null,
    builtAt: null,
    handCount: 0,
    cashSessionCount: 0,
    tournamentSessionCount: 0,
  },
  importCenter: {
    status: 'idle',
    error: null,
    actionStatus: 'idle',
    phase: 'ready',
    activeImportIds: [],
    imports: [],
  },
  filters: {
    gameType: 'both',
    sessionGroupGameType: 'both',
    dateRanges: {
      profile: { from: '', to: '' },
      opponents: { from: '', to: '' },
      wallet: { from: '', to: '' },
      cards: { from: '', to: '' },
      sessionGroup: { from: '', to: '' },
    },
  },
  aggregates: {
    profile: { data: null, status: 'idle', error: null, datasetRevision: null, queryKey: null },
    opponents: {
      items: [], nextCursor: null, total: 0, status: 'idle', error: null, datasetRevision: null, queryKey: null,
    },
    cards: { data: null, status: 'idle', error: null, datasetRevision: null, queryKey: null },
    wallet: { data: null, status: 'idle', error: null, datasetRevision: null, queryKey: null },
  },
  currentPages: {
    cash: { cursor: null, items: [], availableRanks: [], handRanking: '', status: 'idle', error: null, datasetRevision: null, queryKey: null },
    tournament: { cursor: null, items: [], availableRanks: [], handRanking: '', status: 'idle', error: null, datasetRevision: null, queryKey: null },
  },
  sessionMonthIndexes: {},
  sessionMonthPages: {},
  activeSessionMonthQueryKeys: { cash: null, tournament: null, both: null },
  sessionSummariesById: {},
  sessionSummaryQueries: {},
  sessionDetailsById: {},
  sessionHandsById: {},
  sessionHandPageOrder: [],
  handCollections: {
    cash: { analyzed: createEmptyHandCollectionPage(), saved: createEmptyHandCollectionPage() },
    tournament: { analyzed: createEmptyHandCollectionPage(), saved: createEmptyHandCollectionPage() },
  },
  openedHandsById: {},
  openedHandOrder: [],
  openedHandStatusById: {},
  openedHandErrorById: {},
  selectedSessionId: null,
  selectedTourneyId: null,
  selectedHandId: null,
  sessionGroupSelection: {
    sourceIds: [],
    reportId: null,
  },
  datasetRefreshNotice: null,
  defaultAiModel: loadDefaultAiModel(),
  aiModels: AI_MODEL_CATALOG.map((model) => ({ ...model, configured: false })),
  aiModelsStatus: 'idle',
  aiModelsError: null,
  aiAnalyses: loadAiAnalyses(),
  sessionAiAnalyses: loadSessionAiAnalyses(),
  selectedSessionAnalysisReportIdBySessionId: {},
  sessionAnalysisStatusById: {},
  sessionAnalysisErrorById: {},
  sessionGroupAiAnalyses: loadSessionGroupAiAnalyses(),
  sessionGroupPreview: createEmptySessionGroupPreview(),
  sessionGroupAnalysisStatus: 'idle',
  sessionGroupAnalysisError: null,
  playerAiAnalyses: loadPlayerAiAnalyses(),
  playerAnalysisPreview: createEmptyPlayerAnalysisPreview(),
  playerAnalysisStatus: 'idle',
  playerAnalysisError: null,
  selectedPlayerAnalysisReportId: null,
  savedHandIds: loadSavedHandIds(),
  loadingAI: false,
  errorAI: null,
  sharedAiAnalysesStatus: 'idle',
  sharedAiAnalysesError: null,
};

const saveHandInBoundedCache = (state, hand) => {
  const handId = String(hand.id);
  state.openedHandsById[handId] = hand;
  state.openedHandOrder = [
    handId,
    ...state.openedHandOrder.filter((id) => id !== handId),
  ];
  while (state.openedHandOrder.length > OPEN_HAND_CACHE_LIMIT) {
    const evictedId = state.openedHandOrder.pop();
    delete state.openedHandsById[evictedId];
    delete state.openedHandStatusById[evictedId];
    delete state.openedHandErrorById[evictedId];
  }
};

const resetBrowsableDatasetData = (state) => {
  state.currentPages.cash = { cursor: null, items: [], availableRanks: [], handRanking: '', status: 'idle', error: null, datasetRevision: null, queryKey: null };
  state.currentPages.tournament = { cursor: null, items: [], availableRanks: [], handRanking: '', status: 'idle', error: null, datasetRevision: null, queryKey: null };
  state.sessionMonthIndexes = {};
  state.sessionMonthPages = {};
  state.activeSessionMonthQueryKeys = { cash: null, tournament: null, both: null };
  state.sessionSummariesById = {};
  state.sessionSummaryQueries = {};
  state.sessionDetailsById = {};
  state.sessionHandsById = {};
  state.sessionHandPageOrder = [];
  state.handCollections = {
    cash: { analyzed: createEmptyHandCollectionPage(), saved: createEmptyHandCollectionPage() },
    tournament: { analyzed: createEmptyHandCollectionPage(), saved: createEmptyHandCollectionPage() },
  };
  state.sessionGroupPreview = createEmptySessionGroupPreview();
  state.playerAnalysisPreview = createEmptyPlayerAnalysisPreview();
  state.openedHandsById = {};
  state.openedHandOrder = [];
  state.openedHandStatusById = {};
  state.openedHandErrorById = {};
  state.aggregates.profile = { data: null, status: 'idle', error: null, datasetRevision: null, queryKey: null };
  state.aggregates.opponents = {
    items: [], nextCursor: null, total: 0, status: 'idle', error: null, datasetRevision: null, queryKey: null,
  };
  state.aggregates.cards = { data: null, status: 'idle', error: null, datasetRevision: null, queryKey: null };
  state.aggregates.wallet = { data: null, status: 'idle', error: null, datasetRevision: null, queryKey: null };
};

const responseHasStaleRevision = (state, payload) => Boolean(
  state.dataset.datasetRevision
  && payload?.datasetRevision
  && state.dataset.datasetRevision !== payload.datasetRevision
);

const saveSessionSummaries = (state, sessions) => {
  (Array.isArray(sessions) ? sessions : []).forEach((session) => {
    if (session?.id) state.sessionSummariesById[String(session.id)] = session;
  });
};

const deriveMonthDescriptors = (sessions) => {
  const months = new Map();
  (Array.isArray(sessions) ? sessions : []).forEach((session) => {
    const key = getSessionMonthKey(session);
    if (!key) return;
    const current = months.get(key) || {
      key,
      year: Number(key.slice(0, 4)),
      month: Number(key.slice(5, 7)),
      sessionCount: 0,
      handCount: 0,
      matchingHandCount: 0,
      cashSessionCount: 0,
      tournamentSessionCount: 0,
    };
    current.sessionCount += 1;
    current.handCount += Number(session.handCount) || 0;
    current.matchingHandCount += Number(session.matchingHandCount) || 0;
    if (session.type === 'Tournament') current.tournamentSessionCount += 1;
    else current.cashSessionCount += 1;
    months.set(key, current);
  });
  return [...months.values()].sort((left, right) => right.key.localeCompare(left.key));
};

const touchSessionHandPage = (state, sessionId) => {
  const normalizedId = String(sessionId);
  state.sessionHandPageOrder = [
    normalizedId,
    ...state.sessionHandPageOrder.filter((id) => id !== normalizedId),
  ];
  while (state.sessionHandPageOrder.length > 3) {
    const evictedId = state.sessionHandPageOrder.pop();
    delete state.sessionHandsById[evictedId];
  }
};

const setDatasetMetadata = (state, payload) => {
  const nextRevision = payload?.datasetRevision || state.dataset.datasetRevision;
  if (nextRevision && state.dataset.datasetRevision && nextRevision !== state.dataset.datasetRevision) {
    resetBrowsableDatasetData(state);
  }
  state.dataset.datasetRevision = nextRevision;
  if (payload?.builtAt !== undefined) state.dataset.builtAt = payload.builtAt || null;
  if (payload?.handCount !== undefined) state.dataset.handCount = Number(payload.handCount) || 0;
  if (payload?.cashSessionCount !== undefined) state.dataset.cashSessionCount = Number(payload.cashSessionCount) || 0;
  if (payload?.tournamentSessionCount !== undefined) state.dataset.tournamentSessionCount = Number(payload.tournamentSessionCount) || 0;
};

const updateImportStatus = (state, status) => {
  state.importCenter.phase = status?.import?.phase || status?.phase || state.importCenter.phase;
  state.importCenter.activeImportIds = status?.import?.activeImportIds || status?.activeImportIds || [];
  const nextRevision = status?.activeRevision || status?.datasetRevision;
  if (nextRevision && state.dataset.datasetRevision && nextRevision !== state.dataset.datasetRevision) {
    resetBrowsableDatasetData(state);
  }
  if (nextRevision) state.dataset.datasetRevision = nextRevision;
};

const pokerSlice = createSlice({
  name: 'poker',
  initialState,
  reducers: {
    selectSession: (state, action) => {
      const sessionId = action.payload ? String(action.payload) : null;
      state.selectedSessionId = sessionId;
      state.selectedHandId = null;
      if (sessionId) delete state.selectedSessionAnalysisReportIdBySessionId[sessionId];
    },
    selectTourney: (state, action) => {
      const sessionId = action.payload ? String(action.payload) : null;
      state.selectedTourneyId = sessionId;
      state.selectedHandId = null;
      if (sessionId) delete state.selectedSessionAnalysisReportIdBySessionId[sessionId];
    },
    selectHand: (state, action) => { state.selectedHandId = action.payload || null; },
    setDataFilters: (state, action) => {
      state.filters = { ...state.filters, ...(action.payload || {}) };
    },
    setDateRange: (state, action) => {
      const payload = action.payload || {};
      const view = String(payload.view || '');
      const currentRange = state.filters.dateRanges[view];
      if (!currentRange) return;
      const range = payload.range || payload;
      state.filters.dateRanges[view] = {
        from: range.from === undefined && range.dateFrom === undefined
          ? currentRange.from
          : String(range.from ?? range.dateFrom ?? '').trim(),
        to: range.to === undefined && range.dateTo === undefined
          ? currentRange.to
          : String(range.to ?? range.dateTo ?? '').trim(),
      };
    },
    setSessionGroupSelection: (state, action) => {
      const sourceIds = Array.isArray(action.payload)
        ? [...new Set(action.payload.map(String).filter(Boolean))]
        : [];
      state.sessionGroupSelection.sourceIds = sourceIds;
    },
    clearSessionGroupPreview: (state) => {
      state.sessionGroupPreview = createEmptySessionGroupPreview();
    },
    setSessionGroupReportSelection: (state, action) => {
      state.sessionGroupSelection.reportId = action.payload ? String(action.payload) : null;
    },
    setPlayerAnalysisReportSelection: (state, action) => {
      state.selectedPlayerAnalysisReportId = action.payload ? String(action.payload) : null;
    },
    setSessionAnalysisReportSelection: (state, action) => {
      const sessionId = String(action.payload?.sessionId || '').trim();
      if (!sessionId) return;
      const reportId = String(action.payload?.reportId || '').trim();
      if (reportId) state.selectedSessionAnalysisReportIdBySessionId[sessionId] = reportId;
      else delete state.selectedSessionAnalysisReportIdBySessionId[sessionId];
    },
    setDefaultAiModel: (state, action) => {
      if (!AI_MODEL_IDS.includes(action.payload)) return;
      state.defaultAiModel = action.payload;
      localStorage.setItem(AI_DEFAULT_MODEL_CACHE_KEY, action.payload);
    },
    toggleSavedHand: (state, action) => {
      const handId = String(action.payload);
      const index = state.savedHandIds.indexOf(handId);
      if (index >= 0) state.savedHandIds.splice(index, 1);
      else state.savedHandIds.push(handId);
      localStorage.setItem(SAVED_HANDS_CACHE_KEY, JSON.stringify(state.savedHandIds));
    },
    clearDatasetRefreshNotice: (state) => { state.datasetRefreshNotice = null; },
    closeOpenedHand: (state, action) => {
      const handId = String(action.payload || state.selectedHandId || '');
      state.selectedHandId = null;
      if (!handId) return;
      delete state.openedHandsById[handId];
      delete state.openedHandStatusById[handId];
      delete state.openedHandErrorById[handId];
      state.openedHandOrder = state.openedHandOrder.filter((id) => id !== handId);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(refreshDataset.pending, (state) => {
        state.dataset.status = 'loading';
        state.dataset.error = null;
      })
      .addCase(refreshDataset.fulfilled, (state, action) => {
        state.dataset.status = 'succeeded';
        state.dataset.error = null;
        setDatasetMetadata(state, action.payload);
      })
      .addCase(refreshDataset.rejected, (state, action) => {
        state.dataset.status = 'failed';
        state.dataset.error = action.payload || 'Nie udało się pobrać informacji o datasecie.';
      })
      .addCase(refreshDataStatus.fulfilled, (state, action) => updateImportStatus(state, action.payload))
      .addCase(refreshImportCenter.pending, (state) => {
        state.importCenter.status = 'loading';
        state.importCenter.error = null;
      })
      .addCase(refreshImportCenter.fulfilled, (state, action) => {
        state.importCenter.status = 'succeeded';
        state.importCenter.error = null;
        state.importCenter.imports = Array.isArray(action.payload.imports?.imports) ? action.payload.imports.imports : [];
        updateImportStatus(state, action.payload.dataStatus);
        updateImportStatus(state, action.payload.imports?.status);
      })
      .addCase(refreshImportCenter.rejected, (state, action) => {
        state.importCenter.status = 'failed';
        state.importCenter.error = action.payload || 'Nie udało się pobrać centrum importu.';
      })
      .addCase(scanInbox.pending, (state) => {
        state.importCenter.actionStatus = 'loading';
        state.importCenter.error = null;
      })
      .addCase(scanInbox.fulfilled, (state, action) => {
        state.importCenter.actionStatus = 'succeeded';
        updateImportStatus(state, action.payload?.status);
      })
      .addCase(scanInbox.rejected, (state, action) => {
        state.importCenter.actionStatus = 'failed';
        state.importCenter.error = action.payload || 'Nie udało się sprawdzić katalogu inbox.';
      })
      .addCase(uploadImport.pending, (state) => {
        state.importCenter.actionStatus = 'loading';
        state.importCenter.error = null;
      })
      .addCase(uploadImport.fulfilled, (state, action) => {
        state.importCenter.actionStatus = 'succeeded';
        const importId = action.payload?.importId;
        if (importId && !state.importCenter.imports.some((item) => item.importId === importId)) {
          state.importCenter.imports.unshift({ importId, phase: 'scanning', outcome: null });
        }
        updateImportStatus(state, action.payload?.status);
      })
      .addCase(uploadImport.rejected, (state, action) => {
        state.importCenter.actionStatus = 'failed';
        state.importCenter.error = action.payload || 'Nie udało się przesłać pliku TXT.';
      })
      .addCase(fetchOpenedHand.pending, (state, action) => {
        const handId = String(action.meta.arg.handId);
        state.openedHandStatusById[handId] = 'loading';
        delete state.openedHandErrorById[handId];
      })
      .addCase(fetchOpenedHand.fulfilled, (state, action) => {
        if (!action.payload?.hand?.id) return;
        setDatasetMetadata(state, action.payload);
        saveHandInBoundedCache(state, action.payload.hand);
        const handId = String(action.payload.hand.id);
        state.selectedHandId = handId;
        state.openedHandStatusById[handId] = 'succeeded';
        delete state.openedHandErrorById[handId];
      })
      .addCase(fetchOpenedHand.rejected, (state, action) => {
        const handId = String(action.meta.arg.handId);
        state.openedHandStatusById[handId] = 'failed';
        state.openedHandErrorById[handId] = action.payload || 'Nie udało się pobrać rozdania.';
      })
      .addCase(fetchSessionMonths.pending, (state, action) => {
        const query = normalizeSessionQuery(action.meta.arg);
        const queryKey = createSessionMonthsQueryKey(query);
        const existing = state.sessionMonthIndexes[queryKey] || createEmptySessionMonthIndex();
        state.activeSessionMonthQueryKeys[query.gameType] = queryKey;
        state.sessionMonthIndexes[queryKey] = {
          ...existing,
          status: 'loading',
          error: null,
          requestId: action.meta.requestId,
        };
      })
      .addCase(fetchSessionMonths.fulfilled, (state, action) => {
        const { query, queryKey } = action.payload;
        const existing = state.sessionMonthIndexes[queryKey];
        if (existing?.requestId !== action.meta.requestId) return;
        if (state.activeSessionMonthQueryKeys[query.gameType] !== queryKey
          || responseHasStaleRevision(state, action.payload)) {
          existing.status = 'idle';
          existing.requestId = null;
          return;
        }
        setDatasetMetadata(state, action.payload);
        state.activeSessionMonthQueryKeys[query.gameType] = queryKey;
        state.sessionMonthIndexes[queryKey] = {
          ...createEmptySessionMonthIndex(),
          ...existing,
          months: Array.isArray(action.payload.months) ? action.payload.months : [],
          availableRanks: Array.isArray(action.payload.availableRanks) ? action.payload.availableRanks : [],
          status: 'succeeded',
          error: null,
          datasetRevision: action.payload.datasetRevision || state.dataset.datasetRevision,
          requestId: null,
        };
      })
      .addCase(fetchSessionMonths.rejected, (state, action) => {
        const query = normalizeSessionQuery(action.meta.arg);
        const queryKey = createSessionMonthsQueryKey(query);
        const entry = state.sessionMonthIndexes[queryKey];
        if (entry?.requestId !== action.meta.requestId) return;
        if (state.activeSessionMonthQueryKeys[query.gameType] !== queryKey) {
          entry.status = 'idle';
          entry.error = null;
          entry.requestId = null;
          return;
        }
        entry.status = action.meta.aborted ? 'idle' : 'failed';
        entry.error = action.meta.aborted ? null : (action.payload || 'Nie udało się pobrać indeksu miesięcy sesji.');
        entry.requestId = null;
      })
      .addCase(fetchSessionMonth.pending, (state, action) => {
        const { month, ...params } = action.meta.arg || {};
        const query = normalizeSessionQuery(params);
        const queryKey = createSessionMonthsQueryKey(query);
        const pages = state.sessionMonthPages[queryKey] || {};
        const existing = pages[month] || createEmptySessionMonthPage();
        state.activeSessionMonthQueryKeys[query.gameType] = queryKey;
        state.sessionMonthPages[queryKey] = {
          ...pages,
          [month]: {
            ...existing,
            status: 'loading',
            error: null,
            requestId: action.meta.requestId,
          },
        };
      })
      .addCase(fetchSessionMonth.fulfilled, (state, action) => {
        const { month, query, queryKey } = action.payload;
        const page = state.sessionMonthPages[queryKey]?.[month];
        if (page?.requestId !== action.meta.requestId) return;
        if (state.activeSessionMonthQueryKeys[query.gameType] !== queryKey
          || responseHasStaleRevision(state, action.payload)) {
          page.status = 'idle';
          page.requestId = null;
          return;
        }
        setDatasetMetadata(state, action.payload);
        state.activeSessionMonthQueryKeys[query.gameType] = queryKey;
        saveSessionSummaries(state, action.payload.sessions);
        state.sessionMonthPages[queryKey] ||= {};
        state.sessionMonthPages[queryKey][month] = {
          items: Array.isArray(action.payload.sessions) ? action.payload.sessions : [],
          status: 'succeeded',
          error: null,
          datasetRevision: action.payload.datasetRevision || state.dataset.datasetRevision,
          requestId: null,
        };
      })
      .addCase(fetchSessionMonth.rejected, (state, action) => {
        const { month, ...params } = action.meta.arg || {};
        const query = normalizeSessionQuery(params);
        const queryKey = createSessionMonthsQueryKey(query);
        const page = state.sessionMonthPages[queryKey]?.[month];
        if (page?.requestId !== action.meta.requestId) return;
        if (state.activeSessionMonthQueryKeys[query.gameType] !== queryKey) {
          page.status = 'idle';
          page.error = null;
          page.requestId = null;
          return;
        }
        page.status = action.meta.aborted ? 'idle' : 'failed';
        page.error = action.meta.aborted ? null : (action.payload || 'Nie udało się pobrać sesji z wybranego miesiąca.');
        page.requestId = null;
      })
      .addCase(fetchAllSessionsForQuery.pending, (state, action) => {
        const query = normalizeSessionQuery(action.meta.arg);
        const queryKey = createSessionMonthsQueryKey(query);
        const existing = state.sessionMonthIndexes[queryKey] || createEmptySessionMonthIndex();
        state.activeSessionMonthQueryKeys[query.gameType] = queryKey;
        state.sessionMonthIndexes[queryKey] = {
          ...existing,
          allStatus: 'loading',
          allError: null,
          allRequestId: action.meta.requestId,
        };
      })
      .addCase(fetchAllSessionsForQuery.fulfilled, (state, action) => {
        const { query, queryKey } = action.payload;
        const existing = state.sessionMonthIndexes[queryKey];
        if (existing?.allRequestId !== action.meta.requestId) return;
        if (state.activeSessionMonthQueryKeys[query.gameType] !== queryKey
          || responseHasStaleRevision(state, action.payload)) {
          existing.allStatus = 'idle';
          existing.allRequestId = null;
          return;
        }
        setDatasetMetadata(state, action.payload);
        state.activeSessionMonthQueryKeys[query.gameType] = queryKey;
        const sessions = Array.isArray(action.payload.sessions) ? action.payload.sessions : [];
        const grouped = new Map();
        sessions.forEach((session) => {
          const month = getSessionMonthKey(session);
          if (!month) return;
          if (!grouped.has(month)) grouped.set(month, []);
          grouped.get(month).push(session);
        });
        const months = existing?.months?.length ? existing.months : deriveMonthDescriptors(sessions);
        const pages = state.sessionMonthPages[queryKey] || {};
        months.forEach(({ key }) => {
          pages[key] = {
            items: grouped.get(key) || [],
            status: 'succeeded',
            error: null,
            datasetRevision: action.payload.datasetRevision || state.dataset.datasetRevision,
            requestId: null,
          };
        });
        grouped.forEach((items, month) => {
          if (pages[month]) return;
          pages[month] = {
            items,
            status: 'succeeded',
            error: null,
            datasetRevision: action.payload.datasetRevision || state.dataset.datasetRevision,
            requestId: null,
          };
        });
        state.sessionMonthPages[queryKey] = pages;
        saveSessionSummaries(state, sessions);
        state.sessionMonthIndexes[queryKey] = {
          ...createEmptySessionMonthIndex(),
          ...existing,
          months,
          availableRanks: Array.isArray(action.payload.availableRanks) ? action.payload.availableRanks : [],
          datasetRevision: action.payload.datasetRevision || state.dataset.datasetRevision,
          allStatus: 'succeeded',
          allError: null,
          allRequestId: null,
        };
      })
      .addCase(fetchAllSessionsForQuery.rejected, (state, action) => {
        const query = normalizeSessionQuery(action.meta.arg);
        const queryKey = createSessionMonthsQueryKey(query);
        const entry = state.sessionMonthIndexes[queryKey];
        if (entry?.allRequestId !== action.meta.requestId) return;
        if (state.activeSessionMonthQueryKeys[query.gameType] !== queryKey) {
          entry.allStatus = 'idle';
          entry.allError = null;
          entry.allRequestId = null;
          return;
        }
        entry.allStatus = action.meta.aborted ? 'idle' : 'failed';
        entry.allError = action.meta.aborted ? null : (action.payload || 'Nie udało się pobrać pełnej listy sesji.');
        entry.allRequestId = null;
      })
      .addCase(fetchSessionSummariesByIds.pending, (state, action) => {
        const datasetRevision = String(action.meta.arg?.datasetRevision || state.dataset.datasetRevision || '').trim();
        const queryKey = getSummaryQueryKey({ datasetRevision, sessionIds: action.meta.arg?.sessionIds });
        state.sessionSummaryQueries[queryKey] = {
          status: 'loading',
          error: null,
          missingSessionIds: [],
          datasetRevision,
          requestId: action.meta.requestId,
        };
      })
      .addCase(fetchSessionSummariesByIds.fulfilled, (state, action) => {
        const entry = state.sessionSummaryQueries[action.payload.queryKey];
        if (entry?.requestId !== action.meta.requestId || responseHasStaleRevision(state, action.payload)) return;
        setDatasetMetadata(state, action.payload);
        saveSessionSummaries(state, action.payload.sessions);
        state.sessionSummaryQueries[action.payload.queryKey] = {
          status: 'succeeded',
          error: null,
          missingSessionIds: Array.isArray(action.payload.missingSessionIds) ? action.payload.missingSessionIds : [],
          datasetRevision: action.payload.datasetRevision || state.dataset.datasetRevision,
          requestId: null,
        };
      })
      .addCase(fetchSessionSummariesByIds.rejected, (state, action) => {
        const datasetRevision = String(action.meta.arg?.datasetRevision || state.dataset.datasetRevision || '').trim();
        const queryKey = getSummaryQueryKey({ datasetRevision, sessionIds: action.meta.arg?.sessionIds });
        const entry = state.sessionSummaryQueries[queryKey];
        if (entry?.requestId !== action.meta.requestId) return;
        entry.status = action.meta.aborted ? 'idle' : 'failed';
        entry.error = action.meta.aborted ? null : (action.payload?.message || action.payload || 'Nie udało się pobrać podsumowań sesji.');
        entry.requestId = null;
      })
      .addCase(fetchSessions.pending, (state, action) => {
        const page = state.currentPages[action.meta.arg.gameType];
        page.status = 'loading';
        page.error = null;
        page.handRanking = action.meta.arg.handRanking || '';
        page.queryKey = createSessionsQueryKey(action.meta.arg);
      })
      .addCase(fetchSessions.fulfilled, (state, action) => {
        const gameType = action.meta.arg.gameType;
        if (state.currentPages[gameType].queryKey !== action.payload.queryKey) return;
        setDatasetMetadata(state, action.payload);
        state.currentPages[gameType] = {
          cursor: null,
          items: Array.isArray(action.payload.sessions) ? action.payload.sessions : [],
          availableRanks: Array.isArray(action.payload.availableRanks) ? action.payload.availableRanks : [],
          handRanking: action.payload.handRanking || '',
          status: 'succeeded',
          error: null,
          datasetRevision: action.payload.datasetRevision || state.dataset.datasetRevision,
          queryKey: action.payload.queryKey,
        };
      })
      .addCase(fetchSessions.rejected, (state, action) => {
        const page = state.currentPages[action.meta.arg.gameType];
        if (page.queryKey !== createSessionsQueryKey(action.meta.arg)) return;
        page.status = 'failed';
        page.error = action.payload || 'Nie udało się pobrać listy sesji.';
      })
      .addCase(fetchSessionDetail.pending, (state, action) => {
        const sessionId = String(action.meta.arg.sessionId);
        const existing = state.sessionDetailsById[sessionId] || {};
        state.sessionDetailsById[sessionId] = { ...existing, status: 'loading', error: null };
      })
      .addCase(fetchSessionDetail.fulfilled, (state, action) => {
        const sessionId = String(action.meta.arg.sessionId);
        setDatasetMetadata(state, action.payload);
        state.sessionDetailsById[sessionId] = {
          status: 'succeeded',
          error: null,
          datasetRevision: action.payload.datasetRevision || state.dataset.datasetRevision,
          session: action.payload.session || null,
        };
      })
      .addCase(fetchSessionDetail.rejected, (state, action) => {
        const sessionId = String(action.meta.arg.sessionId);
        const existing = state.sessionDetailsById[sessionId] || {};
        state.sessionDetailsById[sessionId] = {
          ...existing,
          status: 'failed',
          error: action.payload || 'Nie udało się pobrać podsumowania sesji.',
        };
      })
      .addCase(fetchSessionHands.pending, (state, action) => {
        const sessionId = String(action.meta.arg.sessionId);
        const { handRanking = '', sortBy = 'date', sortOrder = 'desc', cursor = null } = action.meta.arg;
        const queryKey = createSessionHandsQueryKey({ sessionId, handRanking, sortBy, sortOrder });
        const existing = state.sessionHandsById[sessionId];
        state.sessionHandsById[sessionId] = (!cursor && existing?.queryKey !== queryKey)
          ? {
            items: [], nextCursor: null, datasetRevision: null, queryKey, handRanking, sortBy, sortOrder,
            status: 'loading', error: null,
          }
          : { ...(existing || { items: [], nextCursor: null, datasetRevision: null, queryKey, handRanking, sortBy, sortOrder }), status: 'loading', error: null };
        touchSessionHandPage(state, sessionId);
      })
      .addCase(fetchSessionHands.fulfilled, (state, action) => {
        const sessionId = String(action.payload.sessionId || action.meta.arg.sessionId);
        setDatasetMetadata(state, action.payload);
        const existing = state.sessionHandsById[sessionId] || { items: [] };
        if (existing.queryKey !== action.payload.queryKey) return;
        const received = Array.isArray(action.payload.hands) ? action.payload.hands : [];
        const items = action.meta.arg.cursor
          ? [...existing.items, ...received.filter((hand) => !existing.items.some((item) => item.id === hand.id))]
          : received;
        state.sessionHandsById[sessionId] = {
          items,
          nextCursor: action.payload.nextCursor || null,
          status: 'succeeded',
          error: null,
          datasetRevision: action.payload.datasetRevision || state.dataset.datasetRevision,
          queryKey: action.payload.queryKey,
          handRanking: action.payload.handRanking || '',
          sortBy: action.payload.sortBy || 'date',
          sortOrder: action.payload.sortOrder || 'desc',
        };
        touchSessionHandPage(state, sessionId);
      })
      .addCase(fetchSessionHands.rejected, (state, action) => {
        const sessionId = String(action.meta.arg.sessionId);
        const existing = state.sessionHandsById[sessionId] || { items: [], nextCursor: null };
        if (existing.queryKey !== createSessionHandsQueryKey(action.meta.arg)) return;
        state.sessionHandsById[sessionId] = {
          ...existing,
          status: 'failed',
          error: action.payload || 'Nie udało się pobrać rąk sesji.',
        };
      })
      .addCase(fetchHandCollection.pending, (state, action) => {
        const { gameType, mode, cursor = null } = action.meta.arg;
        const queryKey = createHandCollectionQueryKey(action.meta.arg);
        const existing = state.handCollections[gameType][mode];
        state.handCollections[gameType][mode] = !cursor
          ? {
            ...createEmptyHandCollectionPage(),
            queryKey,
            status: 'loading',
          }
          : { ...existing, status: 'loading', error: null };
      })
      .addCase(fetchHandCollection.fulfilled, (state, action) => {
        const { gameType, mode, cursor = null } = action.meta.arg;
        setDatasetMetadata(state, action.payload);
        const existing = state.handCollections[gameType][mode];
        if (existing.queryKey !== action.payload.queryKey) return;
        const received = Array.isArray(action.payload.hands) ? action.payload.hands : [];
        const items = cursor
          ? [...existing.items, ...received.filter((hand) => !existing.items.some((item) => item.id === hand.id))]
          : received;
        state.handCollections[gameType][mode] = {
          items,
          nextCursor: action.payload.nextCursor || null,
          total: Number(action.payload.total) || 0,
          collectionCounts: action.payload.collectionCounts || { analyzed: 0, saved: 0 },
          status: 'succeeded',
          error: null,
          datasetRevision: action.payload.datasetRevision || state.dataset.datasetRevision,
          queryKey: action.payload.queryKey,
        };
      })
      .addCase(fetchHandCollection.rejected, (state, action) => {
        const { gameType, mode } = action.meta.arg;
        const page = state.handCollections[gameType][mode];
        if (page.queryKey !== createHandCollectionQueryKey(action.meta.arg)) return;
        page.status = 'failed';
        page.error = action.payload || 'Could not load the hand collection.';
      })
      .addCase(fetchProfile.pending, (state, action) => {
        state.aggregates.profile.status = 'loading';
        state.aggregates.profile.error = null;
        state.aggregates.profile.queryKey = createAggregateQueryKey(action.meta.arg);
      })
      .addCase(fetchProfile.fulfilled, (state, action) => {
        if (state.aggregates.profile.queryKey !== action.payload.queryKey) return;
        setDatasetMetadata(state, action.payload);
        state.aggregates.profile = {
          data: action.payload,
          status: 'succeeded',
          error: null,
          datasetRevision: action.payload.datasetRevision || state.dataset.datasetRevision,
          queryKey: action.payload.queryKey,
        };
      })
      .addCase(fetchProfile.rejected, (state, action) => {
        if (state.aggregates.profile.queryKey !== createAggregateQueryKey(action.meta.arg)) return;
        state.aggregates.profile.status = 'failed';
        state.aggregates.profile.error = action.payload || 'Nie udało się pobrać raportu profilu.';
      })
      .addCase(fetchPlayerAnalysisPreview.pending, (state, action) => {
        state.playerAnalysisPreview = {
          ...createEmptyPlayerAnalysisPreview(),
          status: 'loading',
          queryKey: createPlayerAnalysisQueryKey({
            ...(action.meta.arg || {}),
            datasetRevision: state.dataset.datasetRevision || '',
          }),
        };
      })
      .addCase(fetchPlayerAnalysisPreview.fulfilled, (state, action) => {
        if (state.playerAnalysisPreview.queryKey !== action.payload.queryKey) return;
        setDatasetMetadata(state, action.payload);
        state.playerAnalysisPreview = {
          data: action.payload,
          status: 'succeeded',
          error: null,
          datasetRevision: action.payload.datasetRevision,
          queryKey: action.payload.queryKey,
        };
      })
      .addCase(fetchPlayerAnalysisPreview.rejected, (state, action) => {
        const queryKey = createPlayerAnalysisQueryKey({
          ...(action.meta.arg || {}),
          datasetRevision: state.dataset.datasetRevision || '',
        });
        if (state.playerAnalysisPreview.queryKey !== queryKey) return;
        state.playerAnalysisPreview.status = action.meta.aborted ? 'idle' : 'failed';
        state.playerAnalysisPreview.error = action.meta.aborted
          ? null
          : (action.payload || { message: 'Nie udało się pobrać podglądu analizy gracza.' });
      })
      .addCase(fetchOpponents.pending, (state, action) => {
        state.aggregates.opponents.status = 'loading';
        state.aggregates.opponents.error = null;
        state.aggregates.opponents.queryKey = createAggregateQueryKey(action.meta.arg);
      })
      .addCase(fetchOpponents.fulfilled, (state, action) => {
        if (state.aggregates.opponents.queryKey !== action.payload.queryKey) return;
        setDatasetMetadata(state, action.payload);
        const previous = state.aggregates.opponents;
        const received = Array.isArray(action.payload.opponents) ? action.payload.opponents : [];
        const items = action.payload.cursor && previous.queryKey === action.payload.queryKey
          ? [...previous.items, ...received.filter((candidate) => !previous.items.some((item) => item.id === candidate.id))]
          : received;
        state.aggregates.opponents = {
          items,
          nextCursor: action.payload.nextCursor || null,
          total: Number(action.payload.total) || 0,
          status: 'succeeded',
          error: null,
          datasetRevision: action.payload.datasetRevision || state.dataset.datasetRevision,
          queryKey: action.payload.queryKey,
        };
      })
      .addCase(fetchOpponents.rejected, (state, action) => {
        if (state.aggregates.opponents.queryKey !== createAggregateQueryKey(action.meta.arg)) return;
        state.aggregates.opponents.status = 'failed';
        state.aggregates.opponents.error = action.payload || 'Nie udało się pobrać listy przeciwników.';
      })
      .addCase(fetchCards.pending, (state, action) => {
        state.aggregates.cards.status = 'loading';
        state.aggregates.cards.error = null;
        state.aggregates.cards.queryKey = createAggregateQueryKey(action.meta.arg);
      })
      .addCase(fetchCards.fulfilled, (state, action) => {
        if (state.aggregates.cards.queryKey !== action.payload.queryKey) return;
        setDatasetMetadata(state, action.payload);
        state.aggregates.cards = {
          data: action.payload,
          status: 'succeeded',
          error: null,
          datasetRevision: action.payload.datasetRevision || state.dataset.datasetRevision,
          queryKey: action.payload.queryKey,
        };
      })
      .addCase(fetchCards.rejected, (state, action) => {
        if (state.aggregates.cards.queryKey !== createAggregateQueryKey(action.meta.arg)) return;
        state.aggregates.cards.status = 'failed';
        state.aggregates.cards.error = action.payload || 'Nie udało się pobrać statystyk kart startowych.';
      })
      .addCase(fetchWallet.pending, (state, action) => {
        state.aggregates.wallet.status = 'loading';
        state.aggregates.wallet.error = null;
        state.aggregates.wallet.queryKey = createAggregateQueryKey({ gameType: 'cash', ...(action.meta.arg || {}) });
      })
      .addCase(fetchWallet.fulfilled, (state, action) => {
        if (state.aggregates.wallet.queryKey !== action.payload.queryKey) return;
        setDatasetMetadata(state, action.payload);
        state.aggregates.wallet = {
          data: action.payload,
          status: 'succeeded',
          error: null,
          datasetRevision: action.payload.datasetRevision || state.dataset.datasetRevision,
          queryKey: action.payload.queryKey,
        };
      })
      .addCase(fetchWallet.rejected, (state, action) => {
        if (state.aggregates.wallet.queryKey !== createAggregateQueryKey({ gameType: 'cash', ...(action.meta.arg || {}) })) return;
        state.aggregates.wallet.status = 'failed';
        state.aggregates.wallet.error = action.payload || 'Nie udało się pobrać danych portfela.';
      })
      .addCase(fetchAiModels.pending, (state) => {
        state.aiModelsStatus = 'loading';
        state.aiModelsError = null;
      })
      .addCase(fetchAiModels.fulfilled, (state, action) => {
        state.aiModels = action.payload;
        state.aiModelsStatus = 'succeeded';
      })
      .addCase(fetchAiModels.rejected, (state, action) => {
        state.aiModelsStatus = 'failed';
        state.aiModelsError = action.payload || 'Nie udało się pobrać konfiguracji modeli AI.';
      })
      .addCase(analyzeHandWithAI.pending, (state) => {
        state.loadingAI = true;
        state.errorAI = null;
      })
      .addCase(analyzeHandWithAI.fulfilled, (state, action) => {
        state.loadingAI = false;
        const report = action.payload;
        const history = Array.isArray(state.aiAnalyses[report.handId]) ? state.aiAnalyses[report.handId] : [];
        history.push(report);
        state.aiAnalyses[report.handId] = history;
        localStorage.setItem(AI_ANALYSES_CACHE_KEY, JSON.stringify(state.aiAnalyses));
      })
      .addCase(analyzeHandWithAI.rejected, (state, action) => {
        state.loadingAI = false;
        state.errorAI = action.payload;
        if (action.payload?.code === 'DATASET_REVISION_MISMATCH') state.datasetRefreshNotice = 'Dane zmieniły się podczas działania. Odświeżyliśmy dataset — ponów analizę ręcznie.';
      })
      .addCase(analyzeSessionWithAI.pending, (state, action) => {
        const sessionId = action.meta.arg.sessionId;
        state.sessionAnalysisStatusById[sessionId] = 'loading';
        delete state.sessionAnalysisErrorById[sessionId];
      })
      .addCase(analyzeSessionWithAI.fulfilled, (state, action) => {
        const report = action.payload;
        state.sessionAnalysisStatusById[report.sessionId] = 'succeeded';
        delete state.sessionAnalysisErrorById[report.sessionId];
        const history = Array.isArray(state.sessionAiAnalyses[report.sessionId]) ? state.sessionAiAnalyses[report.sessionId] : [];
        history.push(report);
        state.sessionAiAnalyses[report.sessionId] = history;
        state.selectedSessionAnalysisReportIdBySessionId[report.sessionId] = report.reportId;
        localStorage.setItem(SESSION_AI_ANALYSES_CACHE_KEY, JSON.stringify(state.sessionAiAnalyses));
      })
      .addCase(analyzeSessionWithAI.rejected, (state, action) => {
        const sessionId = action.meta.arg.sessionId;
        state.sessionAnalysisStatusById[sessionId] = 'failed';
        state.sessionAnalysisErrorById[sessionId] = action.payload;
        if (action.payload?.code === 'DATASET_REVISION_MISMATCH') state.datasetRefreshNotice = 'Dane zmieniły się podczas działania. Odświeżyliśmy dataset — ponów analizę ręcznie.';
      })
      .addCase(fetchSessionGroupPreview.pending, (state, action) => {
        state.sessionGroupPreview = {
          ...createEmptySessionGroupPreview(),
          status: 'loading',
          queryKey: createSessionGroupPreviewQueryKey({
            sessionIds: action.meta.arg?.sessionIds,
            datasetRevision: state.dataset.datasetRevision || '',
          }),
        };
      })
      .addCase(fetchSessionGroupPreview.fulfilled, (state, action) => {
        if (state.sessionGroupPreview.queryKey !== action.payload.queryKey) return;
        setDatasetMetadata(state, action.payload);
        state.sessionGroupPreview = {
          data: action.payload,
          status: 'succeeded',
          error: null,
          datasetRevision: action.payload.datasetRevision || state.dataset.datasetRevision,
          queryKey: action.payload.queryKey,
        };
      })
      .addCase(fetchSessionGroupPreview.rejected, (state, action) => {
        const queryKey = createSessionGroupPreviewQueryKey({
          sessionIds: action.meta.arg?.sessionIds,
          datasetRevision: state.dataset.datasetRevision || '',
        });
        if (state.sessionGroupPreview.queryKey !== queryKey) return;
        state.sessionGroupPreview.status = action.meta.aborted ? 'idle' : 'failed';
        state.sessionGroupPreview.error = action.meta.aborted
          ? null
          : (action.payload || 'Nie udało się pobrać podglądu wybranych sesji.');
      })
      .addCase(analyzeSessionGroupWithAI.pending, (state) => {
        state.sessionGroupAnalysisStatus = 'loading';
        state.sessionGroupAnalysisError = null;
      })
      .addCase(analyzeSessionGroupWithAI.fulfilled, (state, action) => {
        state.sessionGroupAnalysisStatus = 'succeeded';
        state.sessionGroupAiAnalyses.push(action.payload);
        localStorage.setItem(SESSION_GROUP_AI_ANALYSES_CACHE_KEY, JSON.stringify(state.sessionGroupAiAnalyses));
      })
      .addCase(analyzeSessionGroupWithAI.rejected, (state, action) => {
        state.sessionGroupAnalysisStatus = 'failed';
        state.sessionGroupAnalysisError = action.payload;
        if (action.payload?.code === 'DATASET_REVISION_MISMATCH') state.datasetRefreshNotice = 'Dane zmieniły się podczas działania. Odświeżyliśmy dataset — ponów analizę ręcznie.';
      })
      .addCase(analyzePlayerWithAI.pending, (state) => {
        state.playerAnalysisStatus = 'loading';
        state.playerAnalysisError = null;
      })
      .addCase(analyzePlayerWithAI.fulfilled, (state, action) => {
        state.playerAnalysisStatus = 'succeeded';
        state.playerAnalysisError = null;
        state.playerAiAnalyses.push(action.payload);
        state.selectedPlayerAnalysisReportId = action.payload.reportId;
        localStorage.setItem(PLAYER_AI_ANALYSES_CACHE_KEY, JSON.stringify(state.playerAiAnalyses));
      })
      .addCase(analyzePlayerWithAI.rejected, (state, action) => {
        state.playerAnalysisStatus = 'failed';
        state.playerAnalysisError = action.payload || {
          message: 'Nie udało się przeanalizować statystyk gracza.',
        };
        if (action.payload?.code === 'DATASET_REVISION_MISMATCH') {
          state.datasetRefreshNotice = 'Dane zmieniły się podczas działania. Odświeżyliśmy dataset — ponów analizę ręcznie.';
        }
      })
      .addCase(syncAiAnalyses.pending, (state) => {
        state.sharedAiAnalysesStatus = 'loading';
        state.sharedAiAnalysesError = null;
      })
      .addCase(syncAiAnalyses.fulfilled, (state, action) => {
        const normalized = applyAiAnalysesCache({
          cache: action.payload,
          storage: localStorage,
          handCacheKey: AI_ANALYSES_CACHE_KEY,
          sessionCacheKey: SESSION_AI_ANALYSES_CACHE_KEY,
          sessionGroupCacheKey: SESSION_GROUP_AI_ANALYSES_CACHE_KEY,
          playerCacheKey: PLAYER_AI_ANALYSES_CACHE_KEY,
        });
        state.aiAnalyses = normalized.handAnalyses;
        state.sessionAiAnalyses = normalized.sessionAnalyses;
        Object.entries(state.selectedSessionAnalysisReportIdBySessionId).forEach(([sessionId, reportId]) => {
          if (!(state.sessionAiAnalyses[sessionId] || []).some((report) => report.reportId === reportId)) {
            delete state.selectedSessionAnalysisReportIdBySessionId[sessionId];
          }
        });
        state.sessionGroupAiAnalyses = normalized.sessionGroupAnalyses;
        state.playerAiAnalyses = normalized.playerAnalyses;
        if (!state.playerAiAnalyses.some((report) => report.reportId === state.selectedPlayerAnalysisReportId)) {
          state.selectedPlayerAnalysisReportId = [...state.playerAiAnalyses]
            .sort((left, right) => String(right.analyzedAt || '').localeCompare(String(left.analyzedAt || '')))[0]?.reportId || null;
        }
        state.sharedAiAnalysesStatus = 'succeeded';
      })
      .addCase(syncAiAnalyses.rejected, (state, action) => {
        state.sharedAiAnalysesStatus = 'failed';
        state.sharedAiAnalysesError = action.payload || 'Nie udało się zsynchronizować raportów AI.';
      });
  },
});

export const {
  clearSessionGroupPreview,
  clearDatasetRefreshNotice,
  closeOpenedHand,
  selectHand,
  selectSession,
  selectTourney,
  setDataFilters,
  setDateRange,
  setDefaultAiModel,
  setPlayerAnalysisReportSelection,
  setSessionAnalysisReportSelection,
  setSessionGroupReportSelection,
  setSessionGroupSelection,
  toggleSavedHand,
} = pokerSlice.actions;

export default pokerSlice.reducer;
