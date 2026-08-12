import express from 'express';
import { getPublicAiModels } from '../ai/models.js';
import { toPublicRefreshJob } from './trainingService.js';
import { normalizeTrainingRefreshSampleSize } from './refreshService.js';

const asString = (value) => String(value ?? '').trim();
const asBoolean = (value) => value === true || value === 'true' || value === '1';

const getErrorStatus = (error) => {
  if (Number.isInteger(error?.status)) return error.status;
  if (['TRAINING_REFRESH_CONFIRMATION_REQUIRED', 'TRAINING_REFRESH_RESUME_REQUIRED', 'TRAINING_SELECTION_REBUILD_BLOCKED'].includes(error?.code)) return 409;
  if (error?.code?.endsWith('_NOT_FOUND')) return 404;
  if (['TRAINING_COLLECTION_READ_FAILED', 'TRAINING_COLLECTION_WRITE_FAILED', 'TRAINING_COLLECTION_TOO_LARGE', 'TRAINING_COLLECTION_INVALID'].includes(error?.code)) return 503;
  if (['TrainingRefreshError', 'TrainingRepositoryError', 'TrainingServiceError'].includes(error?.name)) return 400;
  return 500;
};

export const createTrainingRouter = ({
  repository,
  refreshService,
  trainingService,
  dataIndex,
  dataDirectory,
  readCanonicalRecords,
  environment,
  logger = console,
} = {}) => {
  if (!repository || !refreshService || !trainingService || !dataIndex
    || typeof readCanonicalRecords !== 'function') {
    throw new Error('Router treningowy wymaga kompletu zależności.');
  }
  const router = express.Router();
  const route = (handler) => async (request, response) => {
    try {
      await handler(request, response);
    } catch (error) {
      const status = getErrorStatus(error);
      if (status >= 500) {
        logger?.error?.('Training API error:', {
          code: error?.code || 'TRAINING_INTERNAL_ERROR',
          message: error?.message,
        });
      }
      response.status(status).json({
        error: error?.code === 'TRAINING_COLLECTION_WRITE_FAILED'
          ? 'Nie udało się zapisać kolekcji ćwiczeń. Spróbuj ponownie.'
          : error?.message || 'Nie udało się obsłużyć modułu ćwiczeń.',
        code: error?.code || 'TRAINING_INTERNAL_ERROR',
        ...(error?.estimate ? { estimate: error.estimate } : {}),
        ...(error?.resumableJob ? { resumableJob: toPublicRefreshJob(error.resumableJob) } : {}),
      });
    }
  };

  router.get('/status', route(async (request, response) => {
    const sampleSize = normalizeTrainingRefreshSampleSize(request.query.sampleSize);
    const status = await trainingService.getStatus({
      sampleSize,
    });
    response.json({ ...status, models: getPublicAiModels(environment) });
  }));

  router.post('/refresh/scan', route(async (request, response) => {
    const sampleSize = normalizeTrainingRefreshSampleSize(request.body?.sampleSize);
    const before = await dataIndex.getSnapshot();
    const requestedRevision = asString(request.body?.datasetRevision);
    if (requestedRevision && requestedRevision !== before.datasetRevision) {
      const error = new Error('Dataset zmienił się przed rozpoczęciem skanu treningowego.');
      error.code = 'DATASET_REVISION_MISMATCH';
      error.status = 409;
      throw error;
    }
    const sources = await readCanonicalRecords(dataDirectory);
    const after = await dataIndex.getSnapshot();
    if (before.datasetRevision !== after.datasetRevision) {
      const error = new Error('Dataset zmienił się podczas skanu treningowego. Uruchom skan ponownie.');
      error.code = 'DATASET_REVISION_MISMATCH';
      error.status = 409;
      throw error;
    }
    const scan = await repository.scanCanonicalHands(sources, {
      datasetRevision: after.datasetRevision,
      rebuildSelection: asBoolean(request.body?.rebuildSelection),
      sampleSize,
    });
    response.json({
      datasetRevision: after.datasetRevision,
      scan: scan.result,
      status: await trainingService.getStatus({
        sampleSize,
      }),
    });
  }));

  router.post('/refresh/start', route(async (request, response) => {
    const sampleSize = normalizeTrainingRefreshSampleSize(request.body?.sampleSize);
    const selectedModel = getPublicAiModels(environment)
      .find(({ id }) => id === asString(request.body?.modelId));
    if (!selectedModel) {
      const error = new Error('Wybierz dostępny model AI.');
      error.code = 'AI_UNKNOWN_MODEL';
      error.status = 400;
      throw error;
    }
    if (!selectedModel.configured) {
      const error = new Error(`Model ${selectedModel.name} nie jest skonfigurowany na serwerze.`);
      error.code = 'AI_MODEL_NOT_CONFIGURED';
      error.status = 503;
      throw error;
    }
    const [dataset, collection] = await Promise.all([
      dataIndex.getSnapshot(),
      repository.getSnapshot(),
    ]);
    if (collection.scanState.datasetRevision !== dataset.datasetRevision) {
      const error = new Error('Najpierw wykonaj lokalny skan aktualnego datasetu.');
      error.code = 'TRAINING_SCAN_STALE';
      error.status = 409;
      throw error;
    }
    const job = await refreshService.startRefresh({
      modelId: request.body?.modelId,
      confirmed: request.body?.confirmed === true,
      sampleSize,
    });
    response.status(202).json({ job: toPublicRefreshJob(job) });
  }));

  router.get('/refresh/:jobId', route(async (request, response) => {
    response.json({ job: toPublicRefreshJob(await refreshService.getJob(request.params.jobId)) });
  }));

  router.post('/refresh/:jobId/stop', route(async (request, response) => {
    response.status(202).json({
      job: toPublicRefreshJob(await refreshService.stopRefresh(request.params.jobId)),
    });
  }));

  router.post('/refresh/:jobId/resume', route(async (request, response) => {
    response.status(202).json({
      job: toPublicRefreshJob(await refreshService.resumeRefresh(request.params.jobId)),
    });
  }));

  router.post('/sessions', route(async (request, response) => {
    const result = await trainingService.createOrResumeSession(request.body);
    response.status(result.resumed ? 200 : 201).json(result);
  }));

  router.get('/sessions/:sessionId', route(async (request, response) => {
    response.json({ session: await trainingService.getSession(request.params.sessionId) });
  }));

  router.get('/sessions/:sessionId/next', route(async (request, response) => {
    response.json(await trainingService.getNextQuestion(request.params.sessionId));
  }));

  router.get('/sessions/:sessionId/reviews', route(async (request, response) => {
    response.json(await trainingService.getSessionReviews(request.params.sessionId));
  }));

  router.post('/sessions/:sessionId/answers', route(async (request, response) => {
    response.json(await trainingService.submitAnswer(request.params.sessionId, request.body));
  }));

  router.post('/sessions/:sessionId/abandon', route(async (request, response) => {
    response.json(await trainingService.abandonSession(request.params.sessionId));
  }));

  router.post('/reset', route(async (request, response) => {
    response.json(await trainingService.reset({
      scope: asString(request.body?.scope),
      confirmed: request.body?.confirmed === true,
    }));
  }));

  router.get('/history', route(async (request, response) => {
    response.json(await trainingService.getHistory(request.query));
  }));

  router.get('/stats', route(async (request, response) => {
    response.json(await trainingService.getStats(request.query));
  }));

  return router;
};
