import express from 'express';
import process from 'node:process';
import { analyzeHandWithModel } from './ai/analysisService.js';
import { getPublicAiModels } from './ai/models.js';
import { listLocalSources, readLocalSource } from './localSources.js';

export const createApiApp = ({
  dataDirectory,
  environment = process.env,
  fetchImpl = globalThis.fetch,
} = {}) => {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

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
        console.error('Unexpected AI analysis error:', error.message);
      }
      response.status(status).json({
        error: error.message || 'Nie udało się przeanalizować rozdania.',
      });
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

  return app;
};
