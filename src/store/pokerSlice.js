// src/store/pokerSlice.js
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { parseRawHandHistory, buildSessions, buildTourneySessions } from '../parser/pokerParser.js';
import { buildSessionAnalysisInput } from '../ai/sessionAnalysisContract.js';
import {
  buildSessionGroupAnalysisInput,
  validateSessionGroupAnalysis,
} from '../ai/sessionGroupAnalysisContract.js';
import {
  applyAiAnalysesCache,
  buildAiAnalysesCache,
  mergeAiAnalysesCaches,
  normalizeAiAnalysesCache,
} from '../ai/aiAnalysesCache.js';
import { buildSessionGroupCandidates } from '../utils/sessionGroupCandidates.js';

export const AI_ANALYSES_CACHE_KEY = 'poker_ai_analyses_v4';
export const LEGACY_V3_AI_ANALYSES_CACHE_KEY = 'poker_ai_analyses_v3';
export const LEGACY_AI_ANALYSES_CACHE_KEY = 'poker_ai_analyses_v2';
export const AI_DEFAULT_MODEL_CACHE_KEY = 'poker_ai_default_model';
export const SAVED_HANDS_CACHE_KEY = 'poker_saved_hands_v1';
export const SESSION_AI_ANALYSES_CACHE_KEY = 'poker_ai_session_analyses_v1';
export const SESSION_GROUP_AI_ANALYSES_CACHE_KEY = 'poker_ai_session_group_analyses_v1';
export const DEFAULT_AI_MODEL = 'gpt-5.6-terra';
export const AI_MODEL_CATALOG = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
];
export const AI_MODEL_IDS = AI_MODEL_CATALOG.map(({ id }) => id);
const LEGACY_GEMINI_MODEL = {
  ...AI_MODEL_CATALOG[0],
};
export const LOCAL_SOURCE_ORIGIN = 'local';
export const UPLOAD_SOURCE_ORIGIN = 'upload';
export {
  analysisResponseSchema,
  buildHandAnalysisPrompt,
  validateHandAnalysis,
} from '../ai/handAnalysisContract.js';

const getResponseErrorDetails = async (response, fallbackMessage) => {
  try {
    const data = await response.json();
    return {
      message: typeof data?.error === 'string' && data.error.trim()
        ? data.error
        : fallbackMessage,
      code: typeof data?.code === 'string' && data.code.trim()
        ? data.code
        : undefined,
    };
  } catch {
    return { message: fallbackMessage, code: undefined };
  }
};

const getResponseError = async (response, fallbackMessage) => (
  (await getResponseErrorDetails(response, fallbackMessage)).message
);

export const getLocalSourceId = (filename) => `local:${filename}`;

export const syncLocalSources = createAsyncThunk(
  'poker/syncLocalSources',
  async (_, { rejectWithValue }) => {
    try {
      const listResponse = await fetch('/api/local-sources');
      if (!listResponse.ok) {
        throw new Error(await getResponseError(listResponse, 'Nie udało się pobrać listy lokalnych plików.'));
      }

      const { sources = [] } = await listResponse.json();
      return await Promise.all(sources.map(async (metadata) => {
        const contentResponse = await fetch(`/api/local-sources/${encodeURIComponent(metadata.filename)}/content`);
        if (!contentResponse.ok) {
          throw new Error(await getResponseError(contentResponse, `Nie udało się odczytać pliku ${metadata.filename}.`));
        }

        const content = await contentResponse.text();
        return {
          id: getLocalSourceId(metadata.filename),
          filename: metadata.filename,
          content,
          type: /Tournament '/i.test(content) ? 'Tournament' : 'Cash',
          origin: LOCAL_SOURCE_ORIGIN,
          enabled: true,
          size: metadata.size,
          modifiedAt: metadata.modifiedAt,
          dateAdded: metadata.modifiedAt,
        };
      }));
    } catch (error) {
      return rejectWithValue(error.message);
    }
  },
  {
    condition: (_, { getState }) => getState().poker.localSourcesStatus !== 'loading',
  },
);

const buildCurrentAiAnalysesCache = (state) => buildAiAnalysesCache({
  aiAnalyses: state.aiAnalyses,
  sessionAiAnalyses: state.sessionAiAnalyses,
  sessionGroupAiAnalyses: state.sessionGroupAiAnalyses,
});

const readLocalStorageJson = (storage, key, fallback) => {
  try {
    const parsed = JSON.parse(storage.getItem(key));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const buildRawLocalStorageAiAnalyses = (storage = localStorage) => ({
  handAnalyses: readLocalStorageJson(storage, AI_ANALYSES_CACHE_KEY, {}),
  sessionAnalyses: readLocalStorageJson(storage, SESSION_AI_ANALYSES_CACHE_KEY, {}),
  sessionGroupAnalyses: readLocalStorageJson(storage, SESSION_GROUP_AI_ANALYSES_CACHE_KEY, []),
});

const readAiCacheResponse = async (response, fallbackMessage) => {
  if (!response.ok) throw new Error(await getResponseError(response, fallbackMessage));
  const body = await response.json();
  const cache = normalizeAiAnalysesCache(body?.cache);
  if (!cache) throw new Error('Serwer zwrócił nieprawidłowy wspólny cache analiz AI.');
  return cache;
};

export const syncAiAnalyses = createAsyncThunk(
  'poker/syncAiAnalyses',
  async ({ sessionIds = [] } = {}, { getState, rejectWithValue }) => {
    try {
      const localCache = buildCurrentAiAnalysesCache(getState().poker);
      const remoteResponse = await fetch('/api/ai-analyses');
      const remoteCache = await readAiCacheResponse(
        remoteResponse,
        'Nie udało się odczytać wspólnego cache analiz AI.',
      );
      const mergedCache = mergeAiAnalysesCaches(remoteCache, localCache);
      const syncResponse = await fetch('/api/ai-analyses/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cache: mergedCache }),
      });
      let cache;
      if (syncResponse.ok) {
        cache = await readAiCacheResponse(
          syncResponse,
          'Nie udało się zapisać wspólnego cache analiz AI.',
        );
      } else {
        const importResponse = await fetch('/api/ai-analyses/import-local-storage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildRawLocalStorageAiAnalyses()),
        });
        cache = await readAiCacheResponse(
          importResponse,
          'Nie udało się zaimportować starego lokalnego cache analiz AI.',
        );
      }

      const mergedSessionIds = Array.isArray(sessionIds)
        ? sessionIds.map(String).filter(Boolean)
        : [];
      if (mergedSessionIds.length > 0) {
        const pruneResponse = await fetch('/api/ai-analyses/prune', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionIds: [...new Set(mergedSessionIds)] }),
        });
        cache = await readAiCacheResponse(
          pruneResponse,
          'Nie udało się usunąć nieaktualnych raportów AI ze wspólnego cache.',
        );
      }
      return cache;
    } catch (error) {
      return rejectWithValue(error.message || 'Nie udało się zsynchronizować raportów AI.');
    }
  },
);

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

const createReportId = (handId) => (
  globalThis.crypto?.randomUUID?.()
  || `${handId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
);

const normalizeHistory = (entry, handId, analyzedAt, sourceVersion) => {
  const reports = Array.isArray(entry) ? entry : entry?.analysis ? [entry] : [];
  return reports.map((report, index) => ({
    ...report,
    reportId: report.reportId || `legacy-${sourceVersion}-${handId}-${index + 1}`,
    analyzedAt: report.analyzedAt || analyzedAt,
  }));
};

export const loadDefaultAiModel = (storage = localStorage) => {
  const storedModel = storage.getItem(AI_DEFAULT_MODEL_CACHE_KEY);
  return AI_MODEL_IDS.includes(storedModel) ? storedModel : DEFAULT_AI_MODEL;
};

export const loadAiAnalyses = ({
  storage = localStorage,
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
    Object.entries(source).map(([handId, entry]) => {
      if (cachedV3) {
        return [
          handId,
          normalizeHistory(entry, handId, analyzedAt, 'v3'),
        ];
      }
      return [
        handId,
        normalizeHistory({
          model: { ...LEGACY_GEMINI_MODEL },
          analyzedAt,
          analysis: entry,
        }, handId, analyzedAt, 'v2'),
      ];
    }),
  );
  storage.setItem(AI_ANALYSES_CACHE_KEY, JSON.stringify(migrated));
  storage.removeItem(LEGACY_V3_AI_ANALYSES_CACHE_KEY);
  storage.removeItem(LEGACY_AI_ANALYSES_CACHE_KEY);
  return migrated;
};

export const loadSavedHandIds = (storage = localStorage) => {
  const savedIds = parseStoredArray(storage.getItem(SAVED_HANDS_CACHE_KEY)) || [];
  return [...new Set(savedIds.map(String))];
};

export const loadSessionAiAnalyses = (storage = localStorage) => {
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

export const loadSessionGroupAiAnalyses = (storage = localStorage) => {
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

export const fetchAiModels = createAsyncThunk(
  'poker/fetchAiModels',
  async (_, { rejectWithValue }) => {
    try {
      const response = await fetch('/api/ai/models');
      if (!response.ok) {
        throw new Error(await getResponseError(response, 'Nie udało się pobrać konfiguracji modeli AI.'));
      }
      const { models } = await response.json();
      if (!Array.isArray(models)) throw new Error('Serwer zwrócił nieprawidłową listę modeli AI.');
      return models;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  },
  {
    condition: (_, { getState }) => getState().poker.aiModelsStatus !== 'loading',
  },
);

export const analyzeHandWithAI = createAsyncThunk(
  'poker/analyzeHand',
  async ({ handId, modelId }, { getState, rejectWithValue }) => {
    try {
      const { rawHands, defaultAiModel } = getState().poker;
      const hand = rawHands.find((candidate) => candidate.id === handId);
      if (!hand?.id || !hand.rawText) throw new Error('Brakuje danych rozdania do analizy AI.');
      const selectedModelId = modelId || defaultAiModel;

      const response = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: selectedModelId,
          hand,
        }),
      });

      if (!response.ok) {
        throw new Error(await getResponseError(response, 'Nie udało się przeanalizować rozdania.'));
      }

      const { model, analysis } = await response.json();
      if (!model?.id || !model?.name || !analysis) {
        throw new Error('Serwer zwrócił nieprawidłowy raport analizy AI.');
      }
      return {
        handId: hand.id,
        reportId: createReportId(hand.id),
        model,
        analyzedAt: new Date().toISOString(),
        analysis,
      };
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

export const analyzeSessionWithAI = createAsyncThunk(
  'poker/analyzeSession',
  async ({ sessionId, hands, gameType }, { getState, rejectWithValue }) => {
    try {
      const state = getState().poker;
      const session = buildSessionAnalysisInput({ sessionId, hands, gameType });
      const response = await fetch('/api/ai/analyze-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: state.defaultAiModel, session }),
      });
      if (!response.ok) {
        return rejectWithValue(await getResponseErrorDetails(response, 'Nie udało się przeanalizować sesji.'));
      }
      const result = await response.json();
      if (!result?.model?.id || !result?.model?.name || !result?.sessionId || !result?.fingerprint || !result?.analysis) {
        throw new Error('Serwer zwrócił nieprawidłowy raport analizy sesji AI.');
      }
      return {
        sessionId: result.sessionId,
        reportId: createReportId(result.sessionId),
        model: result.model,
        analyzedAt: new Date().toISOString(),
        handCount: session.hands.length,
        fingerprint: result.fingerprint,
        analysis: result.analysis,
      };
    } catch (error) {
      return rejectWithValue({
        message: error?.message || 'Nie udało się przeanalizować sesji.',
        code: typeof error?.code === 'string' && error.code.trim() ? error.code : undefined,
      });
    }
  },
  {
    condition: ({ sessionId }, { getState }) => getState().poker.sessionAnalysisStatusById[sessionId] !== 'loading',
  },
);

export const analyzeSessionGroupWithAI = createAsyncThunk(
  'poker/analyzeSessionGroup',
  async ({ sourceIds, activeCategory, dateRange }, { getState, rejectWithValue }) => {
    try {
      const state = getState().poker;
      const requestedSourceIds = Array.isArray(sourceIds) ? sourceIds.map((sourceId) => String(sourceId)) : [];
      const uniqueSourceIds = [...new Set(requestedSourceIds)];
      if (uniqueSourceIds.length < 2 || uniqueSourceIds.length !== requestedSourceIds.length) {
        throw new Error('Analiza wielu sesji wymaga co najmniej dwóch różnych sesji.');
      }
      const candidateResult = buildSessionGroupCandidates({
        sessions: state.sessions,
        tournaments: state.tournaments,
        sessionAiAnalyses: state.sessionAiAnalyses,
        gameType: activeCategory,
        dateFrom: dateRange?.from || '',
        dateTo: dateRange?.to || '',
      });
      const requestedIdSet = new Set(uniqueSourceIds);
      const sources = candidateResult.candidates.filter((candidate) => requestedIdSet.has(candidate.sourceId));
      if (sources.length !== uniqueSourceIds.length) {
        throw new Error('Wybrane sesje lub ich aktualne raporty nie są już dostępne. Odśwież wybór przed analizą.');
      }
      const group = buildSessionGroupAnalysisInput({
        sources,
        activeCategory: candidateResult.gameType,
        dateRange: { from: dateRange?.from || '', to: dateRange?.to || '' },
      });
      const response = await fetch('/api/ai/analyze-session-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: state.defaultAiModel, group }),
      });
      if (!response.ok) {
        return rejectWithValue(await getResponseErrorDetails(response, 'Nie udało się przeanalizować wybranych sesji.'));
      }
      const result = await response.json();
      if (!result?.model?.id || !result?.model?.name || !result?.fingerprint || !result?.analysis) {
        throw new Error('Serwer zwrócił nieprawidłowy raport analizy wielu sesji AI.');
      }
      if (result.fingerprint !== group.fingerprint) {
        throw new Error('Serwer zwrócił raport dla innego wyboru sesji.');
      }
      // The server validates provider output too, but the client must keep the
      // cache safe even if a proxy, stale response, or malformed mock returns
      // a truthy yet incomplete analysis object.
      const validatedAnalysis = validateSessionGroupAnalysis(result.analysis, group);
      const categoryBreakdown = group.sources.reduce((breakdown, source) => {
        breakdown[source.type].sessions += 1;
        breakdown[source.type].hands += source.metadata.handCount;
        return breakdown;
      }, {
        cash: { sessions: 0, hands: 0 },
        tournament: { sessions: 0, hands: 0 },
      });
      return {
        reportId: createReportId(`session-group-${result.fingerprint}`),
        model: result.model,
        analyzedAt: new Date().toISOString(),
        activeCategory: group.activeCategory,
        dateRange: group.dateRange,
        sources: group.sources,
        sessionCount: group.sources.length,
        handCount: group.metrics.shared.hands,
        categoryBreakdown,
        fingerprint: result.fingerprint,
        analysis: validatedAnalysis,
      };
    } catch (error) {
      return rejectWithValue({
        message: error?.message || 'Nie udało się przeanalizować wybranych sesji.',
        code: typeof error?.code === 'string' && error.code.trim() ? error.code : undefined,
      });
    }
  },
  {
    condition: (_, { getState }) => getState().poker.sessionGroupAnalysisStatus !== 'loading',
  },
);
const initialState = {
  sources: [], // Magazyn wgranych plików źródłowych
  rawHands: [], 
  sessions: [], 
  tournaments: [],
  heroMetrics: null,
  opponentsMetrics: [],
  selectedSessionId: null,
  selectedTourneyId: null,
  selectedHandId: null,
  defaultAiModel: loadDefaultAiModel(),
  aiModels: AI_MODEL_CATALOG.map((model) => ({ ...model, configured: false })),
  aiModelsStatus: 'idle',
  aiModelsError: null,
  aiAnalyses: loadAiAnalyses(),
  sessionAiAnalyses: loadSessionAiAnalyses(),
  sessionAnalysisStatusById: {},
  sessionAnalysisErrorById: {},
  sessionGroupAiAnalyses: loadSessionGroupAiAnalyses(),
  sessionGroupAnalysisStatus: 'idle',
  sessionGroupAnalysisError: null,
  savedHandIds: loadSavedHandIds(),
  loadingAI: false,
  errorAI: null,
  localSourcesStatus: 'idle',
  localSourcesError: null,
  sharedAiAnalysesStatus: 'idle',
  sharedAiAnalysesError: null,
};

export const getUniqueHandsFromSources = (sources) => {
  const orderedSources = sources
    .filter((source) => source.enabled)
    .map((source, index) => ({ source, index }))
    .sort((a, b) => {
      const priorityA = a.source.origin === LOCAL_SOURCE_ORIGIN ? 0 : 1;
      const priorityB = b.source.origin === LOCAL_SOURCE_ORIGIN ? 0 : 1;
      return priorityA - priorityB || a.index - b.index;
    })
    .map(({ source }) => source);

  const handsById = new Map();
  orderedSources.forEach((source) => {
    parseRawHandHistory(source.content).forEach((hand) => {
      if (!handsById.has(hand.id)) handsById.set(hand.id, hand);
    });
  });

  return [...handsById.values()].sort((a, b) => a.timestamp - b.timestamp);
};

// Funkcja pomocnicza do przeliczania rozdań na podstawie TYLKO aktywnych plików
const sourceReferencesAnySessionId = (source, sessionIds) => {
  const sessionId = String(source?.sessionId || '');
  const sourceId = String(source?.sourceId || '');
  return sessionIds.has(sessionId)
    || [...sessionIds].some((oldSessionId) => sourceId === oldSessionId || sourceId.endsWith(`:${oldSessionId}`));
};

export const getMergedSessionIds = (tournaments) => {
  const mergedSessionIds = new Set();
  (Array.isArray(tournaments) ? tournaments : []).forEach((session) => {
    const mergedFromSessionIds = Array.isArray(session?.mergedFromSessionIds)
      ? session.mergedFromSessionIds.map(String).filter(Boolean)
      : [];
    mergedFromSessionIds.forEach((oldSessionId) => {
      if (oldSessionId !== session.id) mergedSessionIds.add(oldSessionId);
    });
  });
  return [...mergedSessionIds];
};

export const cleanupMergedSessionAnalyses = (state, tournaments) => {
  const sessionMigrations = new Map();
  (Array.isArray(tournaments) ? tournaments : []).forEach((session) => {
    const mergedFromSessionIds = Array.isArray(session?.mergedFromSessionIds)
      ? session.mergedFromSessionIds.map(String).filter(Boolean)
      : [];
    mergedFromSessionIds.forEach((oldSessionId) => {
      if (oldSessionId !== session.id) sessionMigrations.set(oldSessionId, session.id);
    });
  });

  if (sessionMigrations.size === 0) return;

  const mergedSessionIds = new Set(sessionMigrations.keys());
  state.sessionAiAnalyses = Object.fromEntries(
    Object.entries(state.sessionAiAnalyses || {})
      .filter(([sessionId]) => !mergedSessionIds.has(sessionId)),
  );
  Object.keys(state.sessionAnalysisStatusById || {}).forEach((sessionId) => {
    if (mergedSessionIds.has(sessionId)) delete state.sessionAnalysisStatusById[sessionId];
  });
  Object.keys(state.sessionAnalysisErrorById || {}).forEach((sessionId) => {
    if (mergedSessionIds.has(sessionId)) delete state.sessionAnalysisErrorById[sessionId];
  });
  state.sessionGroupAiAnalyses = (Array.isArray(state.sessionGroupAiAnalyses)
    ? state.sessionGroupAiAnalyses
    : []).filter((report) => ![
    ...(Array.isArray(report?.sources) ? report.sources : []),
    ...(Array.isArray(report?.sourceReports) ? report.sourceReports : []),
  ].some((source) => sourceReferencesAnySessionId(source, mergedSessionIds)));

  const selectedTourneyId = String(state.selectedTourneyId || '');
  if (mergedSessionIds.has(selectedTourneyId)) {
    state.selectedTourneyId = sessionMigrations.get(selectedTourneyId);
  }

  localStorage.setItem(SESSION_AI_ANALYSES_CACHE_KEY, JSON.stringify(state.sessionAiAnalyses));
  localStorage.setItem(SESSION_GROUP_AI_ANALYSES_CACHE_KEY, JSON.stringify(state.sessionGroupAiAnalyses));
};

const recalculateAllHands = (state) => {
  const allHands = getUniqueHandsFromSources(state.sources);
  state.rawHands = allHands;
  
  const cashHands = allHands.filter(h => !h.isTournament);
  const tourneyHands = allHands.filter(h => h.isTournament);
  
  state.sessions = buildSessions(cashHands);
  state.tournaments = buildTourneySessions(tourneyHands, 20);
  cleanupMergedSessionAnalyses(state, state.tournaments);

  // Aggregating Metrics
  const heroStats = {
    vpipCount: 0,
    pfrCount: 0,
    totalHands: allHands.length,
    wtsdCount: 0,
    wsdCount: 0,
    totalProfit: 0,
    totalBets: 0,
    totalRaises: 0,
    totalCalls: 0
  };

  const opponents = {};

  allHands.forEach(hand => {
    const players = hand.players || {};
    
    // Hero Stats
    const hero = players['Hero'];
    if (hero) {
      if (hero.vpip) heroStats.vpipCount++;
      if (hero.pfr) heroStats.pfrCount++;
      if (hero.reachedShowdown) heroStats.wtsdCount++;
      if (hero.wonShowdown) heroStats.wsdCount++;
      heroStats.totalProfit += hero.netProfit;
      heroStats.totalBets += hero.bets;
      heroStats.totalRaises += hero.raises;
      heroStats.totalCalls += hero.calls;
    }

    // Opponent Stats
    Object.keys(players).forEach(name => {
      if (name === 'Hero') return;
      if (!opponents[name]) {
        opponents[name] = {
          name,
          hands: 0,
          showdowns: 0,
          wins: 0,
          losses: 0,
          netProfit: 0,
          sessions: new Set()
        };
      }
      const opp = opponents[name];
      opp.hands++;
      if (players[name].reachedShowdown) opp.showdowns++;
      if (players[name].wonHand) opp.wins++;
      else if (players[name].investment > 0) opp.losses++;
      opp.netProfit += players[name].netProfit;
      
      const sId = hand.isTournament ? hand.tourneyId : hand.tableId;
      if (sId) opp.sessions.add(sId);
    });
  });

  // Finalize Hero Stats
  state.heroMetrics = {
    vpip: heroStats.totalHands > 0 ? (heroStats.vpipCount / heroStats.totalHands) * 100 : 0,
    pfr: heroStats.totalHands > 0 ? (heroStats.pfrCount / heroStats.totalHands) * 100 : 0,
    af: heroStats.totalCalls > 0 ? (heroStats.totalBets + heroStats.totalRaises) / heroStats.totalCalls : (heroStats.totalBets + heroStats.totalRaises > 0 ? 100 : 0),
    wtsd: heroStats.totalHands > 0 ? (heroStats.wtsdCount / heroStats.totalHands) * 100 : 0,
    wsd: heroStats.wtsdCount > 0 ? (heroStats.wsdCount / heroStats.wtsdCount) * 100 : 0,
    winrate: heroStats.totalHands > 0 ? (heroStats.totalProfit / heroStats.totalHands) : 0,
    totalProfit: heroStats.totalProfit,
    totalHands: heroStats.totalHands
  };

  // Finalize Opponent Stats
  state.opponentsMetrics = Object.values(opponents).map(opp => ({
    ...opp,
    sessionCount: opp.sessions.size,
    netProfit: parseFloat(opp.netProfit.toFixed(2))
  })).sort((a, b) => b.hands - a.hands);
};

const pokerSlice = createSlice({
  name: 'poker',
  initialState,
  reducers: {
    uploadHandHistory: (state, action) => {
      const { filename, content, modifiedAt } = action.payload;
      const isTourney = /Tournament '/i.test(content);
      const now = new Date().toISOString();
      
      state.sources.push({
        id: `src_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        filename,
        content,
        type: isTourney ? 'Tournament' : 'Cash',
        origin: UPLOAD_SOURCE_ORIGIN,
        enabled: true,
        size: new TextEncoder().encode(content).length,
        modifiedAt: modifiedAt || now,
        dateAdded: now,
      });
      
      recalculateAllHands(state);
    },
    toggleSource: (state, action) => {
      const src = state.sources.find(s => s.id === action.payload);
      if (src) {
        src.enabled = !src.enabled;
        recalculateAllHands(state);
      }
    },
    removeSource: (state, action) => {
      state.sources = state.sources.filter(s => s.id !== action.payload || s.origin === LOCAL_SOURCE_ORIGIN);
      recalculateAllHands(state);
    },
    selectSession: (state, action) => { state.selectedSessionId = action.payload; state.selectedHandId = null; },
    selectTourney: (state, action) => { state.selectedTourneyId = action.payload; state.selectedHandId = null; },
    selectHand: (state, action) => { state.selectedHandId = action.payload; },
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
    clearData: (state) => {
      state.sources = []; state.rawHands = []; state.sessions = []; state.tournaments = []; 
      state.selectedSessionId = null; state.selectedTourneyId = null; state.selectedHandId = null;
      state.aiAnalyses = {}; localStorage.removeItem(AI_ANALYSES_CACHE_KEY);
      state.sessionAiAnalyses = {}; localStorage.removeItem(SESSION_AI_ANALYSES_CACHE_KEY);
      state.sessionAnalysisStatusById = {}; state.sessionAnalysisErrorById = {};
      state.sessionGroupAiAnalyses = []; localStorage.removeItem(SESSION_GROUP_AI_ANALYSES_CACHE_KEY);
      state.sessionGroupAnalysisStatus = 'idle'; state.sessionGroupAnalysisError = null;
      state.savedHandIds = []; localStorage.removeItem(SAVED_HANDS_CACHE_KEY);
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(analyzeHandWithAI.pending, (state) => { state.loadingAI = true; state.errorAI = null; })
      .addCase(analyzeHandWithAI.fulfilled, (state, action) => {
        state.loadingAI = false;
        const existingEntry = state.aiAnalyses[action.payload.handId];
        const history = Array.isArray(existingEntry)
          ? existingEntry
          : existingEntry?.analysis ? [existingEntry] : [];
        history.push({
          reportId: action.payload.reportId,
          model: action.payload.model,
          analyzedAt: action.payload.analyzedAt,
          analysis: action.payload.analysis,
        });
        state.aiAnalyses[action.payload.handId] = history;
        localStorage.setItem(AI_ANALYSES_CACHE_KEY, JSON.stringify(state.aiAnalyses));
      })
      .addCase(analyzeHandWithAI.rejected, (state, action) => { state.loadingAI = false; state.errorAI = action.payload; })
      .addCase(analyzeSessionWithAI.pending, (state, action) => {
        const sessionId = action.meta.arg.sessionId;
        state.sessionAnalysisStatusById[sessionId] = 'loading';
        delete state.sessionAnalysisErrorById[sessionId];
      })
      .addCase(analyzeSessionWithAI.fulfilled, (state, action) => {
        const report = action.payload;
        state.sessionAnalysisStatusById[report.sessionId] = 'succeeded';
        delete state.sessionAnalysisErrorById[report.sessionId];
        const history = Array.isArray(state.sessionAiAnalyses[report.sessionId])
          ? state.sessionAiAnalyses[report.sessionId]
          : [];
        history.push({
          reportId: report.reportId,
          model: report.model,
          analyzedAt: report.analyzedAt,
          handCount: report.handCount,
          fingerprint: report.fingerprint,
          analysis: report.analysis,
        });
        state.sessionAiAnalyses[report.sessionId] = history;
        localStorage.setItem(SESSION_AI_ANALYSES_CACHE_KEY, JSON.stringify(state.sessionAiAnalyses));
      })
      .addCase(analyzeSessionWithAI.rejected, (state, action) => {
        const sessionId = action.meta.arg.sessionId;
        state.sessionAnalysisStatusById[sessionId] = 'failed';
        const rejectedError = action.payload;
        const message = typeof rejectedError === 'string'
          ? rejectedError
          : rejectedError?.message;
        const code = typeof rejectedError === 'object' && typeof rejectedError?.code === 'string'
          ? rejectedError.code
          : undefined;
        state.sessionAnalysisErrorById[sessionId] = {
          message: message || 'Nie udało się przeanalizować sesji.',
          ...(code ? { code } : {}),
        };
      })
      .addCase(analyzeSessionGroupWithAI.pending, (state) => {
        state.sessionGroupAnalysisStatus = 'loading';
        state.sessionGroupAnalysisError = null;
      })
      .addCase(analyzeSessionGroupWithAI.fulfilled, (state, action) => {
        state.sessionGroupAnalysisStatus = 'succeeded';
        state.sessionGroupAnalysisError = null;
        state.sessionGroupAiAnalyses.push(action.payload);
        localStorage.setItem(
          SESSION_GROUP_AI_ANALYSES_CACHE_KEY,
          JSON.stringify(state.sessionGroupAiAnalyses),
        );
      })
      .addCase(analyzeSessionGroupWithAI.rejected, (state, action) => {
        state.sessionGroupAnalysisStatus = 'failed';
        const rejectedError = action.payload;
        const message = typeof rejectedError === 'string'
          ? rejectedError
          : rejectedError?.message;
        const code = typeof rejectedError === 'object' && typeof rejectedError?.code === 'string'
          ? rejectedError.code
          : undefined;
        state.sessionGroupAnalysisError = {
          message: message || 'Nie udało się przeanalizować wybranych sesji.',
          ...(code ? { code } : {}),
        };
      })
      .addCase(fetchAiModels.pending, (state) => {
        state.aiModelsStatus = 'loading';
        state.aiModelsError = null;
      })
      .addCase(fetchAiModels.fulfilled, (state, action) => {
        state.aiModels = action.payload;
        state.aiModelsStatus = 'succeeded';
        state.aiModelsError = null;
      })
      .addCase(fetchAiModels.rejected, (state, action) => {
        state.aiModelsStatus = 'failed';
        state.aiModelsError = action.payload || 'Nie udało się pobrać konfiguracji modeli AI.';
      })
      .addCase(syncLocalSources.pending, (state) => {
        state.localSourcesStatus = 'loading';
        state.localSourcesError = null;
      })
      .addCase(syncLocalSources.fulfilled, (state, action) => {
        const enabledById = new Map(
          state.sources
            .filter((source) => source.origin === LOCAL_SOURCE_ORIGIN)
            .map((source) => [source.id, source.enabled]),
        );
        const localSources = action.payload.map((source) => ({
          ...source,
          enabled: enabledById.get(source.id) ?? true,
        }));
        const uploadedSources = state.sources.filter((source) => source.origin !== LOCAL_SOURCE_ORIGIN);
        state.sources = [...localSources, ...uploadedSources];
        state.localSourcesStatus = 'succeeded';
        state.localSourcesError = null;
        recalculateAllHands(state);
      })
      .addCase(syncLocalSources.rejected, (state, action) => {
        state.localSourcesStatus = 'failed';
        state.localSourcesError = action.payload || 'Nie udało się zsynchronizować lokalnych plików.';
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
        });
        state.aiAnalyses = normalized.handAnalyses;
        state.sessionAiAnalyses = normalized.sessionAnalyses;
        state.sessionGroupAiAnalyses = normalized.sessionGroupAnalyses;
        state.sharedAiAnalysesStatus = 'succeeded';
        state.sharedAiAnalysesError = null;
      })
      .addCase(syncAiAnalyses.rejected, (state, action) => {
        state.sharedAiAnalysesStatus = 'failed';
        state.sharedAiAnalysesError = action.payload || 'Nie udało się zsynchronizować raportów AI.';
      });
  }
});

export const {
  uploadHandHistory,
  toggleSource,
  removeSource,
  selectSession,
  selectTourney,
  selectHand,
  setDefaultAiModel,
  toggleSavedHand,
  clearData,
} = pokerSlice.actions;
export default pokerSlice.reducer;

//Chciałbym żebyś mi zrobił podstawowe metryki gracza pokerowego w nowej zakładce "Mój profil". Które to statystki wyliczają się do gracza Hero. Statystyki takie: VPIP, PFR, AF, WSTD, WATSD, Winrate

//Dodatkowo kolejna zakładka "Przeciwnicy" z listą zawodników-przeciwników na bazie ich ID - żeby móc zobaczyć z kim najwięcej grałem/wygrałem/przegrałem. Czyli żeby było wypisane ile rozdań, ile sesji, ile razy showdown, ile razy wygrałem, ile razy przegrałem, jaka wartość łączna wygranych/przegranych - danych/oddanych żetonów

//Lista układów które są najlepsze poszła w złym kierunku - chciałbym żeby ona sprawdziła moja historię wszystkich rozdań cash + turnieje i pokazywała jaka szansa na wygraną z danym układem wg wzoru - ile razy dana ręka wygrała / ilość rozdań wszytskich oraz ile razy dana ręka wygrała / ilość wygranych rozdań
