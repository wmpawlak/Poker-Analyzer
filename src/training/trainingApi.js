import { DEFAULT_TRAINING_REFRESH_SAMPLE_SIZE } from './trainingTypes.js';

const requestJson = async (path, options = {}, fallbackMessage = 'Nie udało się obsłużyć ćwiczeń.') => {
  const response = await fetch(path, options);
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const error = new Error(body?.error || fallbackMessage);
    error.code = body?.code;
    error.status = response.status;
    error.estimate = body?.estimate;
    error.resumableJob = body?.resumableJob;
    throw error;
  }
  return body;
};

const jsonOptions = (body) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const getTrainingStatus = ({
  sampleSize = DEFAULT_TRAINING_REFRESH_SAMPLE_SIZE,
} = {}) => {
  const params = new URLSearchParams({ sampleSize: String(sampleSize) });
  return requestJson(
    `/api/training/status?${params.toString()}`,
    {},
    'Nie udało się pobrać statusu kolekcji ćwiczeń.',
  );
};

export const scanTrainingCollection = (payload = {}) => requestJson(
  '/api/training/refresh/scan',
  jsonOptions(payload),
  'Nie udało się przeskanować lokalnego datasetu.',
);

export const startTrainingRefresh = (payload) => requestJson(
  '/api/training/refresh/start',
  jsonOptions(payload),
  'Nie udało się rozpocząć przygotowywania kluczy odpowiedzi.',
);

export const getTrainingRefreshJob = (jobId) => requestJson(
  `/api/training/refresh/${encodeURIComponent(jobId)}`,
  {},
  'Nie udało się pobrać stanu odświeżania.',
);

export const stopTrainingRefresh = (jobId) => requestJson(
  `/api/training/refresh/${encodeURIComponent(jobId)}/stop`,
  jsonOptions({}),
  'Nie udało się zatrzymać odświeżania.',
);

export const resumeTrainingRefresh = (jobId) => requestJson(
  `/api/training/refresh/${encodeURIComponent(jobId)}/resume`,
  jsonOptions({}),
  'Nie udało się wznowić odświeżania.',
);

export const createTrainingSession = (payload) => requestJson(
  '/api/training/sessions',
  jsonOptions(payload),
  'Nie udało się utworzyć lub wznowić sesji.',
);

export const getTrainingSession = (sessionId) => requestJson(
  `/api/training/sessions/${encodeURIComponent(sessionId)}`,
  {},
  'Nie udało się pobrać sesji.',
);

export const getNextTrainingQuestion = (sessionId) => requestJson(
  `/api/training/sessions/${encodeURIComponent(sessionId)}/next`,
  {},
  'Nie udało się pobrać następnego pytania.',
);

export const getTrainingSessionReviews = (sessionId) => requestJson(
  `/api/training/sessions/${encodeURIComponent(sessionId)}/reviews`,
  {},
  'Nie udało się pobrać poprzednich pytań.',
);

export const submitTrainingAnswer = (sessionId, payload) => requestJson(
  `/api/training/sessions/${encodeURIComponent(sessionId)}/answers`,
  jsonOptions(payload),
  'Nie udało się zapisać odpowiedzi.',
);

export const abandonTrainingSession = (sessionId) => requestJson(
  `/api/training/sessions/${encodeURIComponent(sessionId)}/abandon`,
  jsonOptions({}),
  'Nie udało się przerwać sesji.',
);

export const resetTrainingCollection = (payload) => requestJson(
  '/api/training/reset',
  jsonOptions(payload),
  'Nie udało się wyczyścić kolekcji ćwiczeń.',
);

export const getTrainingHistory = () => requestJson(
  '/api/training/history?limit=100',
  {},
  'Nie udało się pobrać historii ćwiczeń.',
);

export const getTrainingStats = () => requestJson(
  '/api/training/stats',
  {},
  'Nie udało się pobrać statystyk ćwiczeń.',
);
