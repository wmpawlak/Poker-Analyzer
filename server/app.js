import express from 'express';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import {
  analyzeHandWithModel,
  analyzePlayerWithModel,
  analyzeSessionGroupWithModel,
  analyzeSessionWithModel,
} from './ai/analysisService.js';
import {
  createPlayerAnalysisResponseData,
  resolveHandAnalysisData,
  resolvePlayerAnalysisData,
  resolvePlayerAnalysisPreviewData,
  resolveSessionAnalysisData,
  resolveSessionGroupAnalysisData,
  resolveSessionGroupPreviewData,
} from './ai/dataResolver.js';
import { getPublicAiModels } from './ai/models.js';
import { createSessionGroupMetadata } from '../src/ai/sessionGroupAnalysisContract.js';
import {
  DEFAULT_DATA_DIRECTORY as DEFAULT_AI_CACHE_DATA_DIRECTORY,
  createEmptyAiAnalysesCache,
  mergeAiAnalysesCaches,
  migrateLocalStorageAiAnalyses,
  normalizeAiAnalysesCache,
  pruneAiAnalysesCache,
  readAiAnalysesCache,
  writeAiAnalysesCache,
} from './aiAnalysesCache.js';
import { createDataIndex, DataIndexError } from './dataIndex.js';
import { createImportId } from './dataImportService.js';
import {
  createDataImportCoordinator,
  DataImportError,
  parseTextMultipartUpload,
} from './dataImportCoordinator.js';
import {
  createCardsResponse,
  createHandCollectionsResponse,
  createOpponentsResponse,
  createProfileResponse,
  createSessionDetailResponse,
  createSessionHandsResponse,
  createSessionMonthsResponse,
  createSessionSummariesResponse,
  createSessionsResponse,
  createWalletResponse,
  DataQueryError,
} from './dataQueries.js';
import { readCanonicalRecords } from './dataRepository.js';
import { createTrainingRepository } from './training/trainingRepository.js';
import { createTrainingRefreshService } from './training/refreshService.js';
import { createTrainingService } from './training/trainingService.js';
import { createTrainingRouter } from './training/trainingRoutes.js';

export const createApiApp = ({
  dataDirectory,
  environment = process.env,
  fetchImpl = globalThis.fetch,
  logger = console,
  dataIndex: injectedDataIndex,
  dataImports: injectedDataImports,
  trainingRepository: injectedTrainingRepository,
  trainingRefreshService: injectedTrainingRefreshService,
  trainingService: injectedTrainingService,
  trainingAnalyzeBatch,
  trainingRandom,
  trainingIdFactory,
  readTrainingRecords = readCanonicalRecords,
} = {}) => {
  const app = express();
  app.use(express.json({ limit: '12mb' }));
  const cacheDataDirectory = dataDirectory || DEFAULT_AI_CACHE_DATA_DIRECTORY;
  const trainingInstanceId = `training-server-${randomUUID()}`;
  const dataIndex = injectedDataIndex || createDataIndex({ dataDirectory: cacheDataDirectory, logger });
  const dataImports = injectedDataImports || createDataImportCoordinator({
    dataDirectory: cacheDataDirectory,
    dataIndex,
    logger,
  });
  const trainingRepository = injectedTrainingRepository || createTrainingRepository({
    dataDirectory: cacheDataDirectory,
  });
  const trainingRefreshService = injectedTrainingRefreshService || createTrainingRefreshService({
    repository: trainingRepository,
    ...(trainingAnalyzeBatch ? { analyzeBatch: trainingAnalyzeBatch } : {}),
    ...(trainingIdFactory ? { idFactory: trainingIdFactory } : {}),
    environment,
    fetchImpl,
    logger,
    instanceId: trainingInstanceId,
  });
  const trainingService = injectedTrainingService || createTrainingService({
    repository: trainingRepository,
    ...(trainingRandom ? { random: trainingRandom } : {}),
    ...(trainingIdFactory ? { idFactory: trainingIdFactory } : {}),
    instanceId: trainingInstanceId,
    isRefreshRunning: () => trainingRefreshService.hasActiveRun?.() === true,
    getHandAnalysisSummary: async (handId) => {
      const reports = (await readAiAnalysesCache(cacheDataDirectory)).handAnalyses[String(handId)] || [];
      const newest = [...reports].sort((left, right) => (
        (Date.parse(right?.analyzedAt || '') || 0) - (Date.parse(left?.analyzedAt || '') || 0)
      ))[0];
      return String(newest?.analysis?.summary || '').trim().slice(0, 1_500) || null;
    },
  });
  let cacheOperation = Promise.resolve();
  const withCacheLock = (operation) => {
    const next = cacheOperation.then(operation, operation);
    cacheOperation = next.catch(() => {});
    return next;
  };
  const cacheWithoutTimestamp = (cache) => ({ ...cache, updatedAt: null });
  const cachesEqual = (left, right) => (
    JSON.stringify(cacheWithoutTimestamp(left)) === JSON.stringify(cacheWithoutTimestamp(right))
  );
  const compactAiAnalysesCache = (cache) => ({ ...cache, sessionAnalyses: {} });
  const includeSessionAnalyses = (request) => request.query?.includeSessionAnalyses !== 'false';
  const responseCache = (request, cache) => (
    includeSessionAnalyses(request) ? cache : compactAiAnalysesCache(cache)
  );
  const appendReportToCache = async ({ type, ownerId, report }) => withCacheLock(async () => {
    const normalizedOwnerId = String(ownerId || '').trim();
    const collection = type === 'session' ? 'sessionAnalyses' : 'handAnalyses';
    const incoming = normalizeAiAnalysesCache({
      ...createEmptyAiAnalysesCache(),
      [collection]: { [normalizedOwnerId]: [report] },
    });
    const existing = await readAiAnalysesCache(cacheDataDirectory);
    const merged = mergeAiAnalysesCaches(existing, incoming);
    return cachesEqual(existing, merged)
      ? existing
      : writeAiAnalysesCache({ ...merged, updatedAt: new Date().toISOString() }, cacheDataDirectory);
  });
  const sendCacheError = (response, error) => {
    const status = error.code === 'AI_CACHE_TOO_LARGE' ? 413 : 503;
    response.status(status).json({
      error: error.message || 'Nie udało się obsłużyć wspólnego cache analiz AI.',
      code: error.code || 'AI_CACHE_ERROR',
    });
  };
  const sendDataError = (response, error) => {
    if (error instanceof DataQueryError) {
      response.status(error.status || 400).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof DataIndexError && error.code === 'HAND_LOCATION_STALE') {
      response.status(409).json({ error: error.message, code: error.code });
      return;
    }
    logger?.error?.('Data API error:', error?.message);
    response.status(500).json({
      error: 'Nie udało się odczytać kanonicznych danych pokerowych.',
      code: error?.code || 'DATA_INDEX_ERROR',
    });
  };
  const sendImportError = (response, error) => {
    if (error instanceof DataImportError) {
      response.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    logger?.error?.('Import API error:', error?.message);
    response.status(500).json({
      error: 'Nie udało się obsłużyć importu danych pokerowych.',
      code: error?.code || 'IMPORT_INTERNAL_ERROR',
    });
  };

  // Nie obserwujemy katalogu. Jedno skanowanie przy starcie pozwala przetworzyć
  // ręcznie skopiowane pliki, a późniejsze następuje wyłącznie na żądanie API.
  void dataImports.scanInbox();

  app.use('/api/training', createTrainingRouter({
    repository: trainingRepository,
    refreshService: trainingRefreshService,
    trainingService,
    dataIndex,
    dataDirectory: cacheDataDirectory,
    readCanonicalRecords: readTrainingRecords,
    environment,
    logger,
  }));

  app.get('/api/data/status', (_request, response) => {
    void dataIndex.start().catch(() => {});
    const indexStatus = dataIndex.getStatus();
    response.json({
      datasetRevision: indexStatus.activeRevision || indexStatus.datasetRevision || null,
      ...indexStatus,
      import: dataImports.getStatus(),
    });
  });

  app.get('/api/dataset', async (_request, response) => {
    try {
      const snapshot = await dataIndex.getSnapshot();
      response.json({
        datasetRevision: snapshot.datasetRevision,
        builtAt: snapshot.builtAt,
        handCount: snapshot.hands.length,
        cashSessionCount: snapshot.sessions.cash.length,
        tournamentSessionCount: snapshot.sessions.tournament.length,
      });
    } catch (error) {
      sendDataError(response, error);
    }
  });


  app.get('/api/sessions', async (request, response) => {
    try {
      const [snapshot, aiAnalysesCache] = await Promise.all([
        dataIndex.getSnapshot(),
        readAiAnalysesCache(cacheDataDirectory),
      ]);
      response.json(createSessionsResponse(snapshot, request.query, { aiAnalysesCache }));
    } catch (error) {
      sendDataError(response, error);
    }
  });

  app.get('/api/session-months', async (request, response) => {
    try {
      const [snapshot, aiAnalysesCache] = await Promise.all([
        dataIndex.getSnapshot(),
        readAiAnalysesCache(cacheDataDirectory),
      ]);
      response.json(createSessionMonthsResponse(snapshot, request.query, { aiAnalysesCache }));
    } catch (error) {
      sendDataError(response, error);
    }
  });

  app.post('/api/session-summaries/query', async (request, response) => {
    try {
      const [snapshot, aiAnalysesCache] = await Promise.all([
        dataIndex.getSnapshot(),
        readAiAnalysesCache(cacheDataDirectory),
      ]);
      response.json(createSessionSummariesResponse(snapshot, request.body, { aiAnalysesCache }));
    } catch (error) {
      sendDataError(response, error);
    }
  });

  app.get('/api/sessions/:id', async (request, response) => {
    try {
      const [snapshot, aiAnalysesCache] = await Promise.all([
        dataIndex.getSnapshot(),
        readAiAnalysesCache(cacheDataDirectory),
      ]);
      const result = createSessionDetailResponse(snapshot, request.params.id, { aiAnalysesCache });
      if (!result) {
        response.status(404).json({ error: 'Nie znaleziono sesji.', code: 'SESSION_NOT_FOUND' });
        return;
      }
      response.json(result);
    } catch (error) {
      sendDataError(response, error);
    }
  });

  app.get('/api/sessions/:id/hands', async (request, response) => {
    try {
      const [snapshot, aiAnalysesCache] = await Promise.all([
        dataIndex.getSnapshot(),
        readAiAnalysesCache(cacheDataDirectory),
      ]);
      const result = createSessionHandsResponse(snapshot, request.params.id, request.query, { aiAnalysesCache });
      if (!result) {
        response.status(404).json({ error: 'Nie znaleziono sesji.', code: 'SESSION_NOT_FOUND' });
        return;
      }
      response.json(result);
    } catch (error) {
      sendDataError(response, error);
    }
  });

  app.post('/api/hand-collections/query', async (request, response) => {
    try {
      response.json(createHandCollectionsResponse(await dataIndex.getSnapshot(), request.body));
    } catch (error) {
      sendDataError(response, error);
    }
  });

  app.get('/api/hands/:id', async (request, response) => {
    try {
      const result = await dataIndex.readHand(request.params.id);
      if (!result) {
        response.status(404).json({ error: 'Nie znaleziono rozdania.', code: 'HAND_NOT_FOUND' });
        return;
      }
      response.json(result);
    } catch (error) {
      sendDataError(response, error);
    }
  });

  app.get('/api/profile', async (request, response) => {
    try {
      response.json(createProfileResponse(await dataIndex.getSnapshot(), request.query));
    } catch (error) {
      sendDataError(response, error);
    }
  });

  app.get('/api/opponents', async (request, response) => {
    try {
      response.json(createOpponentsResponse(await dataIndex.getSnapshot(), request.query));
    } catch (error) {
      sendDataError(response, error);
    }
  });

  app.get('/api/cards', async (request, response) => {
    try {
      response.json(createCardsResponse(await dataIndex.getSnapshot(), request.query));
    } catch (error) {
      sendDataError(response, error);
    }
  });

  app.get('/api/wallet', async (request, response) => {
    try {
      response.json(createWalletResponse(await dataIndex.getSnapshot(), request.query));
    } catch (error) {
      sendDataError(response, error);
    }
  });

  app.post('/api/data/refresh', (_request, response) => {
    void dataImports.scanInbox();
    response.status(202).json({ status: dataImports.getStatus() });
  });

  app.post(
    '/api/imports',
    express.raw({
      type: (request) => /^multipart\/form-data\b/i.test(request.headers['content-type'] || ''),
      limit: '32mb',
    }),
    (request, response) => {
      try {
        const upload = parseTextMultipartUpload(request.headers['content-type'], request.body);
        const importId = createImportId(upload.content);
        void dataImports.queueUpload(upload);
        response.status(202).json({
          importId,
          status: dataImports.getStatus(),
        });
      } catch (error) {
        sendImportError(response, error);
      }
    },
  );

  app.get('/api/imports', async (_request, response) => {
    try {
      response.json(await dataImports.listImports());
    } catch (error) {
      sendImportError(response, error);
    }
  });

  app.get('/api/imports/:id', async (request, response) => {
    try {
      const imported = await dataImports.getImport(request.params.id);
      if (!imported) {
        response.status(404).json({ error: 'Nie znaleziono importu.', code: 'IMPORT_NOT_FOUND' });
        return;
      }
      response.json(imported);
    } catch (error) {
      sendImportError(response, error);
    }
  });

  app.get('/api/ai/models', (_request, response) => {
    response.json({ models: getPublicAiModels(environment) });
  });

  app.get('/api/player-analysis/preview', async (request, response) => {
    try {
      const resolved = await resolvePlayerAnalysisPreviewData({
        dataIndex,
        dataDirectory: cacheDataDirectory,
        gameType: request.query?.gameType,
        dateFrom: request.query?.dateFrom,
        dateTo: request.query?.dateTo,
      });
      response.json(resolved.preview);
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      if (status >= 500) logger?.error?.('Player analysis preview error:', error.message);
      response.status(status).json({
        error: error.message || 'Nie udało się przygotować podglądu analizy gracza.',
        code: error.code || 'PLAYER_ANALYSIS_PREVIEW_ERROR',
      });
    }
  });

  app.post('/api/session-groups/preview', async (request, response) => {
    try {
      const resolved = await resolveSessionGroupPreviewData({
        dataIndex,
        sessionIds: request.body?.sessionIds,
        datasetRevision: request.body?.datasetRevision,
      });
      response.json({ datasetRevision: resolved.datasetRevision, ...resolved.preview });
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      if (status >= 500) logger?.error?.('Session group preview error:', error.message);
      response.status(status).json({
        error: error.message || 'Nie udało się pobrać podglądu wybranych sesji.',
        code: error.code || 'SESSION_GROUP_PREVIEW_ERROR',
      });
    }
  });

  app.post('/api/ai/analyze', async (request, response) => {
    try {
      const resolved = await resolveHandAnalysisData({
        dataIndex,
        handId: request.body?.handId,
        datasetRevision: request.body?.datasetRevision,
      });
      const result = await analyzeHandWithModel({
        modelId: request.body?.modelId,
        hand: resolved.hand,
        environment,
        fetchImpl,
      });
      const report = {
        ...result,
        handId: String(resolved.hand.id),
        reportId: randomUUID(),
        analyzedAt: new Date().toISOString(),
        datasetRevision: resolved.datasetRevision,
      };
      await appendReportToCache({ type: 'hand', ownerId: report.handId, report });
      response.json(report);
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      if (status === 500) {
        logger?.error?.('Unexpected AI analysis error:', error.message);
      }
      response.status(status).json({
        error: error.message || 'Nie udało się przeanalizować rozdania.',
        code: error.code || 'AI_INTERNAL_ERROR',
      });
    }
  });

  app.post('/api/ai/analyze-session', async (request, response) => {
    try {
      const resolved = await resolveSessionAnalysisData({
        dataIndex,
        sessionId: request.body?.sessionId,
        datasetRevision: request.body?.datasetRevision,
      });
      const result = await analyzeSessionWithModel({
        modelId: request.body?.modelId,
        session: resolved.session,
        environment,
        fetchImpl,
        logger,
      });
      const report = {
        ...result,
        reportId: randomUUID(),
        analyzedAt: new Date().toISOString(),
        datasetRevision: resolved.datasetRevision,
      };
      await appendReportToCache({ type: 'session', ownerId: report.sessionId, report });
      response.json(report);
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      if (status === 500) logger?.error?.('Unexpected AI session analysis error:', error.message);
      response.status(status).json({
        error: error.message || 'Nie udało się przeanalizować sesji.',
        code: error.code || 'AI_INTERNAL_ERROR',
      });
    }
  });

  app.post('/api/ai/analyze-session-group', async (request, response) => {
    try {
      const resolved = await resolveSessionGroupAnalysisData({
        dataIndex,
        dataDirectory: cacheDataDirectory,
        sessionIds: request.body?.sessionIds,
        datasetRevision: request.body?.datasetRevision,
      });
      const result = await analyzeSessionGroupWithModel({
        modelId: request.body?.modelId,
        group: resolved.group,
        environment,
        fetchImpl,
        logger,
      });
      response.json({
        ...result,
        datasetRevision: resolved.datasetRevision,
        ...createSessionGroupMetadata(resolved.group),
      });
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      if (status >= 500) {
        logger?.error?.('AI session group analysis error:', {
          status,
          code: error.code || 'AI_INTERNAL_ERROR',
          message: error.message,
        });
      }
      response.status(status).json({
        error: error.message || 'Nie udało się przeanalizować wybranych sesji.',
        code: error.code || 'AI_INTERNAL_ERROR',
      });
    }
  });

  app.post('/api/ai/analyze-player', async (request, response) => {
    try {
      const resolved = await resolvePlayerAnalysisData({
        dataIndex,
        dataDirectory: cacheDataDirectory,
        gameType: request.body?.gameType,
        dateFrom: request.body?.dateFrom,
        dateTo: request.body?.dateTo,
        datasetRevision: request.body?.datasetRevision,
      });
      const result = await analyzePlayerWithModel({
        modelId: request.body?.modelId,
        player: resolved.playerInput,
        environment,
        fetchImpl,
        logger,
      });
      response.json({
        ...result,
        referenceWarnings: Array.isArray(result.referenceWarnings)
          ? result.referenceWarnings
          : [],
        ...createPlayerAnalysisResponseData(resolved.player, { includeReports: true }),
      });
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      if (status >= 500) {
        logger?.error?.('AI player analysis error:', {
          status,
          code: error.code || 'AI_INTERNAL_ERROR',
          message: error.message,
        });
      }
      response.status(status).json({
        error: error.message || 'Nie udało się przeanalizować statystyk gracza.',
        code: error.code || 'AI_INTERNAL_ERROR',
      });
    }
  });

  app.get('/api/ai-analyses', async (request, response) => {
    try {
      const cache = await readAiAnalysesCache(cacheDataDirectory);
      response.json({ cache: responseCache(request, cache) });
    } catch (error) {
      sendCacheError(response, error);
    }
  });

  app.get('/api/ai-analyses/sessions/:sessionId', async (request, response) => {
    try {
      const sessionId = String(request.params.sessionId || '').trim();
      if (!sessionId) {
        response.status(400).json({ error: 'Brakuje identyfikatora sesji.', code: 'AI_SESSION_ID_REQUIRED' });
        return;
      }
      const cache = await readAiAnalysesCache(cacheDataDirectory);
      response.json({ sessionId, reports: cache.sessionAnalyses[sessionId] || [] });
    } catch (error) {
      sendCacheError(response, error);
    }
  });

  app.get('/api/ai-analyses/hands/:handId', async (request, response) => {
    try {
      const handId = String(request.params.handId || '').trim();
      if (!handId) {
        response.status(400).json({ error: 'Brakuje identyfikatora rozdania.', code: 'AI_HAND_ID_REQUIRED' });
        return;
      }
      const cache = await readAiAnalysesCache(cacheDataDirectory);
      response.json({ handId, reports: cache.handAnalyses[handId] || [] });
    } catch (error) {
      sendCacheError(response, error);
    }
  });

  app.post('/api/ai-analyses/sessions/:sessionId', async (request, response) => {
    try {
      const sessionId = String(request.params.sessionId || '').trim();
      const report = request.body?.report;
      if (!sessionId || !report || String(report.sessionId || '').trim() !== sessionId) {
        response.status(400).json({ error: 'Raport nie pasuje do wskazanej sesji.', code: 'AI_SESSION_REPORT_INVALID' });
        return;
      }
      const cache = await appendReportToCache({ type: 'session', ownerId: sessionId, report });
      response.json({ sessionId, reports: cache.sessionAnalyses[sessionId] || [] });
    } catch (error) {
      sendCacheError(response, error);
    }
  });

  app.post('/api/ai-analyses/sync', async (request, response) => {
    try {
      const cache = await withCacheLock(async () => {
        const incoming = normalizeAiAnalysesCache(request.body?.cache);
        if (!incoming) {
          const error = new Error('Żądanie synchronizacji cache AI ma nieprawidłowy format.');
          error.code = 'AI_CACHE_INVALID';
          throw error;
        }
        const existing = await readAiAnalysesCache(cacheDataDirectory);
        const merged = mergeAiAnalysesCaches(existing, incoming);
        return cachesEqual(existing, merged)
          ? existing
          : writeAiAnalysesCache({ ...merged, updatedAt: new Date().toISOString() }, cacheDataDirectory);
      });
      response.json({ cache: responseCache(request, cache) });
    } catch (error) {
      sendCacheError(response, error);
    }
  });

  app.post('/api/ai-analyses/import-local-storage', async (request, response) => {
    try {
      const cache = await withCacheLock(async () => {
        const imported = migrateLocalStorageAiAnalyses(request.body);
        const existing = await readAiAnalysesCache(cacheDataDirectory);
        const merged = mergeAiAnalysesCaches(existing, imported);
        return cachesEqual(existing, merged)
          ? existing
          : writeAiAnalysesCache({ ...merged, updatedAt: new Date().toISOString() }, cacheDataDirectory);
      });
      response.json({ cache: responseCache(request, cache) });
    } catch (error) {
      sendCacheError(response, error);
    }
  });

  app.post('/api/ai-analyses/prune', async (request, response) => {
    try {
      const cache = await withCacheLock(async () => {
        const sessionIds = Array.isArray(request.body?.sessionIds)
          ? request.body.sessionIds
          : [];
        const existing = await readAiAnalysesCache(cacheDataDirectory);
        const pruned = pruneAiAnalysesCache(existing, sessionIds);
        return cachesEqual(existing, pruned)
          ? existing
          : writeAiAnalysesCache({ ...pruned, updatedAt: new Date().toISOString() }, cacheDataDirectory);
      });
      response.json({ cache: responseCache(request, cache) });
    } catch (error) {
      sendCacheError(response, error);
    }
  });

  app.use((error, request, response, _next) => {
    void _next;
    const payloadTooLarge = error?.type === 'entity.too.large' || error?.status === 413;
    const malformedJson = error?.type === 'entity.parse.failed' || error instanceof SyntaxError;
    const trainingRequest = request.path.startsWith('/api/training');
    if (payloadTooLarge) {
      response.status(413).json({
        error: request.path === '/api/imports'
          ? 'Plik importu przekracza dopuszczalny rozmiar 32 MB.'
          : trainingRequest
            ? 'Żądanie modułu ćwiczeń przekracza dopuszczalny rozmiar.'
            : 'Zadanie AI przekracza dopuszczalny rozmiar żądania.',
        code: request.path === '/api/imports'
          ? 'IMPORT_FILE_TOO_LARGE'
          : trainingRequest ? 'TRAINING_REQUEST_TOO_LARGE' : 'AI_REQUEST_TOO_LARGE',
      });
      return;
    }
    if (malformedJson) {
      response.status(400).json({
        error: trainingRequest
          ? 'Żądanie modułu ćwiczeń musi zawierać prawidłowy JSON.'
          : 'Żądanie AI musi zawierać prawidłowy JSON.',
        code: trainingRequest ? 'TRAINING_INVALID_REQUEST' : 'AI_INVALID_REQUEST',
      });
      return;
    }
    logger?.error?.('Unexpected API error:', error?.message);
    response.status(Number.isInteger(error?.status) ? error.status : 500).json({
      error: 'Nie udało się obsłużyć żądania API.',
      code: 'AI_INTERNAL_ERROR',
    });
  });

  return app;
};
