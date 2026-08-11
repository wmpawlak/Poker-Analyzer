import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createApiApp } from '../server/app.js';

const dayTimestamp = (day, index = 0) => new Date(2026, 7, day, 12, 0, 0).getTime() + index * 1_000;

const makeHands = () => Array.from({ length: 100 }, (_, index) => {
  const number = index + 1;
  const day = number <= 29 ? 1 : number === 30 ? 2 : number <= 99 ? 3 : 4;
  return {
    id: `hand-${number}`,
    sessionId: `session-${day}`,
    timestamp: dayTimestamp(day, index),
    isTournament: false,
    netProfit: number % 2 === 0 ? 0.2 : -0.1,
    bigBlind: 0.1,
    heroVPIP: number % 2 === 0,
    heroPFR: number % 3 === 0,
    heroSawFlop: false,
    sawShowdown: false,
  };
});

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const makeProviderAnalysis = (preview) => ({
  profileStyleId: preview.profileStyleId,
  reliabilityId: preview.reliabilityId,
  summary: 'To ostrożne podsumowanie statystycznego obrazu gry.',
  summaryMetricIds: ['shared.preflop.vpip'],
  summarySessionReportIds: [],
  strengths: [],
  leaks: [],
  trainingPriorities: [1, 2, 3].map((number) => ({
    title: `Priorytet ${number}`,
    description: `Opis ${number}.`,
    exercise: `Ćwiczenie ${number}.`,
    metricIds: ['shared.preflop.vpip'],
    sessionReportIds: [],
  })),
  categoryInsights: [{
    category: 'cash',
    summary: 'Osobne wnioski ekonomiczne dla Cash.',
    metricIds: ['cash.winrate'],
    sessionReportIds: [],
  }],
});

const startPlayerApi = async (t, { fetchImpl, environment = {} } = {}) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'poker-player-analysis-api-'));
  t.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const snapshot = {
    datasetRevision: 'player-revision-1',
    builtAt: '2026-08-11T10:00:00.000Z',
    hands: makeHands(),
    sessions: { cash: [], tournament: [] },
    sessionsById: new Map(),
  };
  const dataIndex = {
    getSnapshot: async () => snapshot,
    start: async () => snapshot,
    getStatus: () => ({ status: 'ready', activeRevision: snapshot.datasetRevision }),
  };
  const dataImports = {
    scanInbox: async () => {},
    getStatus: () => ({ status: 'idle' }),
  };
  const server = createApiApp({
    dataDirectory,
    dataIndex,
    dataImports,
    environment,
    fetchImpl,
    logger: { error: () => {} },
  }).listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    snapshot,
  };
};

const getPreview = async (baseUrl, dateTo, extra = {}) => {
  const query = new URLSearchParams({ gameType: 'cash', dateTo, ...extra });
  const response = await fetch(`${baseUrl}/api/player-analysis/preview?${query}`);
  return { response, body: await response.json() };
};

test('preview działa bez modelu i stosuje progi 29/30/99/100 rąk', async (t) => {
  let providerCalls = 0;
  const { baseUrl } = await startPlayerApi(t, {
    fetchImpl: async () => {
      providerCalls += 1;
      throw new Error('Preview nie może wywołać modelu.');
    },
  });

  const sample29 = await getPreview(baseUrl, '2026-08-01');
  const sample30 = await getPreview(baseUrl, '2026-08-02');
  const sample99 = await getPreview(baseUrl, '2026-08-03');
  const sample100 = await getPreview(baseUrl, '2026-08-04');

  assert.equal(sample29.response.status, 200);
  assert.equal(sample29.body.handCount, 29);
  assert.equal(sample29.body.canAnalyze, false);
  assert.equal(sample29.body.reliabilityId, 'INSUFFICIENT');
  assert.match(sample29.body.warning, /co najmniej 30/);

  assert.equal(sample30.body.handCount, 30);
  assert.equal(sample30.body.canAnalyze, true);
  assert.equal(sample30.body.reliabilityId, 'PRELIMINARY');
  assert.match(sample30.body.warning, /poniżej 100/);

  assert.equal(sample99.body.handCount, 99);
  assert.equal(sample99.body.reliabilityId, 'PRELIMINARY');
  assert.match(sample99.body.warning, /wstępny profil/);

  assert.equal(sample100.body.handCount, 100);
  assert.equal(sample100.body.canAnalyze, true);
  assert.equal(sample100.body.reliabilityId, 'STATISTICAL');
  assert.equal(sample100.body.warning, null);
  assert.equal(sample100.body.metrics.cash.winrate.unit, 'BB/100');
  assert.equal(Object.hasOwn(sample100.body.metrics.shared, 'totalProfit'), false);
  assert.equal(Object.hasOwn(sample100.body.sessionEvidence, 'reports'), false);
  assert.equal(providerCalls, 0);
});

test('preview i analiza odrzucają nieprawidłowy zakres bez wywołania modelu', async (t) => {
  let providerCalls = 0;
  const { baseUrl, snapshot } = await startPlayerApi(t, {
    environment: { OPENAI_API_KEY: 'test' },
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({});
    },
  });
  const preview = await fetch(`${baseUrl}/api/player-analysis/preview?gameType=cash&dateFrom=2026-08-04&dateTo=2026-08-01`);
  const analysis = await fetch(`${baseUrl}/api/ai/analyze-player`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelId: 'gpt-5.6-terra',
      gameType: 'cash',
      dateFrom: '2026-08-04',
      dateTo: '2026-08-01',
      datasetRevision: snapshot.datasetRevision,
    }),
  });

  assert.equal(preview.status, 400);
  assert.equal((await preview.json()).code, 'AI_PLAYER_DATE_RANGE_INVALID');
  assert.equal(analysis.status, 400);
  assert.equal((await analysis.json()).code, 'AI_PLAYER_DATE_RANGE_INVALID');
  assert.equal(providerCalls, 0);
});

test('POST blokuje małą próbę, konflikt rewizji i nieskonfigurowany model przed dostawcą', async (t) => {
  let providerCalls = 0;
  const { baseUrl, snapshot } = await startPlayerApi(t, {
    environment: { OPENAI_API_KEY: 'test' },
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({});
    },
  });
  const post = (body) => fetch(`${baseUrl}/api/ai/analyze-player`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const baseBody = {
    modelId: 'gpt-5.6-terra',
    gameType: 'cash',
    dateTo: '2026-08-02',
    datasetRevision: snapshot.datasetRevision,
  };

  const tooSmall = await post({ ...baseBody, dateTo: '2026-08-01' });
  assert.equal(tooSmall.status, 400);
  assert.equal((await tooSmall.json()).code, 'AI_PLAYER_SAMPLE_TOO_SMALL');

  const stale = await post({ ...baseBody, datasetRevision: 'stale-revision' });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'DATASET_REVISION_MISMATCH');

  const unconfigured = await post({ ...baseBody, modelId: 'gemini-2.5-flash' });
  assert.equal(unconfigured.status, 503);
  assert.equal((await unconfigured.json()).code, 'AI_MODEL_NOT_CONFIGURED');
  assert.equal(providerCalls, 0);
});

test('analiza przelicza dane kanoniczne i wykonuje dokładnie jedno płatne żądanie', async (t) => {
  let providerCalls = 0;
  let providerBody;
  let providerAnalysis;
  const { baseUrl, snapshot } = await startPlayerApi(t, {
    environment: { OPENAI_API_KEY: 'test-openai-key' },
    fetchImpl: async (_url, options) => {
      providerCalls += 1;
      providerBody = JSON.parse(options.body);
      return jsonResponse({
        status: 'completed',
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(providerAnalysis) }],
        }],
      });
    },
  });
  const preview = (await getPreview(baseUrl, '2026-08-02')).body;
  providerAnalysis = makeProviderAnalysis(preview);

  const response = await fetch(`${baseUrl}/api/ai/analyze-player`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelId: 'gpt-5.6-terra',
      gameType: 'cash',
      dateTo: '2026-08-02',
      datasetRevision: snapshot.datasetRevision,
      metrics: { shared: { hands: 999_999 } },
      hands: [{ rawText: 'DANE KLIENTA NIE MOGĄ TRAFIĆ DO MODELU' }],
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(providerCalls, 1);
  assert.equal(providerBody.model, 'gpt-5.6-terra');
  assert.equal(providerBody.text.format.name, 'poker_player_analysis');
  assert.equal(providerBody.text.format.strict, true);
  assert.equal(providerBody.input.includes('999999'), false);
  assert.equal(providerBody.input.includes('DANE KLIENTA'), false);
  assert.equal(body.datasetRevision, snapshot.datasetRevision);
  assert.equal(body.handCount, 30);
  assert.equal(body.fingerprint.startsWith('fnv1a-'), true);
  assert.deepEqual(body.model, { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' });
  assert.deepEqual(body.analysis, providerAnalysis);
  assert.deepEqual(body.sessionEvidence.reports, []);
});

test('niepełna odpowiedź jest odrzucana bez retry i fallbacku', async (t) => {
  let providerCalls = 0;
  let incompleteAnalysis;
  const { baseUrl, snapshot } = await startPlayerApi(t, {
    environment: { OPENAI_API_KEY: 'test-openai-key', GEMINI_API_KEY: 'fallback-key' },
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({
        status: 'completed',
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(incompleteAnalysis) }],
        }],
      });
    },
  });
  const preview = (await getPreview(baseUrl, '2026-08-02')).body;
  incompleteAnalysis = {
    ...makeProviderAnalysis(preview),
    trainingPriorities: makeProviderAnalysis(preview).trainingPriorities.slice(0, 2),
  };
  const response = await fetch(`${baseUrl}/api/ai/analyze-player`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelId: 'gpt-5.6-terra',
      gameType: 'cash',
      dateTo: '2026-08-02',
      datasetRevision: snapshot.datasetRevision,
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.code, 'AI_INVALID_PLAYER_RESPONSE');
  assert.equal(providerCalls, 1);
});
