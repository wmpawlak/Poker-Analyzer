import express from 'express';
import process from 'node:process';
import {
  analyzeHandWithModel,
  analyzeSessionGroupWithModel,
  analyzeSessionWithModel,
} from './ai/analysisService.js';
import { getPublicAiModels } from './ai/models.js';
import {
  DEFAULT_DATA_DIRECTORY as DEFAULT_AI_CACHE_DATA_DIRECTORY,
  mergeAiAnalysesCaches,
  normalizeAiAnalysesCache,
  pruneAiAnalysesCache,
  readAiAnalysesCache,
  writeAiAnalysesCache,
} from './aiAnalysesCache.js';
import { listLocalSources, readLocalSource } from './localSources.js';

export const createApiApp = ({
  dataDirectory,
  environment = process.env,
  fetchImpl = globalThis.fetch,
  logger = console,
} = {}) => {
  const app = express();
  app.use(express.json({ limit: '12mb' }));
  const cacheDataDirectory = dataDirectory || DEFAULT_AI_CACHE_DATA_DIRECTORY;
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
  const sendCacheError = (response, error) => {
    const status = error.code === 'AI_CACHE_TOO_LARGE' ? 413 : 503;
    response.status(status).json({
      error: error.message || 'Nie udało się obsłużyć wspólnego cache analiz AI.',
      code: error.code || 'AI_CACHE_ERROR',
    });
  };

  app.get('/api/ai/models', (_request, response) => {
    response.json({ models: getPublicAiModels(environment) });
  });

  app.post('/api/ai/analyze', async (request, response) => {
    try {
      const result = await analyzeHandWithModel({
        modelId: request.body?.modelId,
        hand: request.body?.hand,
        environment,
        fetchImpl,
      });
      response.json(result);
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
      const result = await analyzeSessionWithModel({
        modelId: request.body?.modelId,
        session: request.body?.session,
        environment,
        fetchImpl,
        logger,
      });
      response.json(result);
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
      const result = await analyzeSessionGroupWithModel({
        modelId: request.body?.modelId,
        group: request.body?.group,
        environment,
        fetchImpl,
        logger,
      });
      response.json(result);
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

  app.get('/api/ai-analyses', async (_request, response) => {
    try {
      const cache = await readAiAnalysesCache(cacheDataDirectory);
      response.json({ cache });
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
      response.json({ cache });
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
      response.json({ cache });
    } catch (error) {
      sendCacheError(response, error);
    }
  });

  app.get('/api/local-sources', async (_request, response) => {
    try {
      const sources = await listLocalSources(dataDirectory);
      response.json({ sources });
    } catch (error) {
      console.error('Cannot list local poker sources:', error);
      response.status(500).json({ error: 'Nie udało się odczytać katalogu danych lokalnych.' });
    }
  });

  app.get('/api/local-sources/:filename/content', async (request, response) => {
    try {
      const content = await readLocalSource(request.params.filename, dataDirectory);
      response.type('text/plain; charset=utf-8').send(content);
    } catch (error) {
      if (error.code === 'ENOENT') {
        response.status(404).json({ error: 'Nie znaleziono lokalnego pliku.' });
        return;
      }
      if (error.message?.includes('pliku') || error.message?.includes('katalogiem')) {
        response.status(400).json({ error: error.message });
        return;
      }
      console.error('Cannot read local poker source:', error);
      response.status(500).json({ error: 'Nie udało się odczytać lokalnego pliku.' });
    }
  });

  app.use((error, _request, response, _next) => {
    void _next;
    const payloadTooLarge = error?.type === 'entity.too.large' || error?.status === 413;
    const malformedJson = error?.type === 'entity.parse.failed' || error instanceof SyntaxError;
    if (payloadTooLarge) {
      response.status(413).json({
        error: 'Zadanie AI przekracza dopuszczalny rozmiar żądania.',
        code: 'AI_REQUEST_TOO_LARGE',
      });
      return;
    }
    if (malformedJson) {
      response.status(400).json({
        error: 'Żądanie AI musi zawierać prawidłowy JSON.',
        code: 'AI_INVALID_REQUEST',
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
