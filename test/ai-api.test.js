import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createApiApp } from '../server/app.js';
import { createDataImportService } from '../server/dataImportService.js';
import { makeHand } from './helpers/pokerHands.js';

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const openAiResponse = (analysis) => jsonResponse({
  status: 'completed',
  output: [{
    type: 'message',
    content: [{ type: 'output_text', text: JSON.stringify(analysis) }],
  }],
});

const handReport = (outcome = 'FOLDED') => ({
  heroResult: { outcome },
  preflop: '',
  flop: '',
  turn: '',
  river: '',
  summary: 'Hero spasował przed flopem.',
});

const startSeededApi = async (t, options = {}) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'poker-analyzer-ai-api-'));
  t.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  await createDataImportService({ dataDirectory }).importText({
    filename: 'seed.txt',
    content: makeHand({ id: '96890300082' }),
  });
  const server = createApiApp({
    dataDirectory,
    logger: { error: () => {}, info: () => {} },
    ...options,
  }).listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const dataset = await fetch(`${baseUrl}/api/dataset`).then((response) => response.json());
  return {
    baseUrl,
    request: {
      handId: '96890300082',
      datasetRevision: dataset.datasetRevision,
    },
  };
};

test('GET /api/ai/models zwraca status modeli bez sekretów', async (t) => {
  const { baseUrl } = await startSeededApi(t, {
    environment: { GEMINI_API_KEY: 'gemini-secret', OPENAI_API_KEY: '' },
  });
  const response = await fetch(`${baseUrl}/api/ai/models`);
  const body = await response.json();
  assert.deepEqual(body.models, [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', configured: true },
    { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', configured: false },
    { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', configured: false },
  ]);
  assert.equal(JSON.stringify(body).includes('gemini-secret'), false);
});

test('API AI odrzuca model bez konfiguracji przed wywołaniem dostawcy', async (t) => {
  let providerCalls = 0;
  const { baseUrl, request } = await startSeededApi(t, {
    environment: {},
    fetchImpl: async () => {
      providerCalls += 1;
      return openAiResponse(handReport());
    },
  });
  const response = await fetch(`${baseUrl}/api/ai/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'gpt-5.6-terra', ...request }),
  });
  assert.equal(response.status, 503);
  assert.equal(providerCalls, 0);
});

test('API AI rozwiązuje kanoniczną rękę i nie przyjmuje pełnego payloadu z klienta', async (t) => {
  let providerInput = '';
  const { baseUrl, request } = await startSeededApi(t, {
    environment: { OPENAI_API_KEY: 'test' },
    fetchImpl: async (_url, options) => {
      providerInput = options.body;
      return openAiResponse(handReport());
    },
  });
  const response = await fetch(`${baseUrl}/api/ai/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelId: 'gpt-5.6-terra',
      ...request,
      hand: { id: 'forged', rawText: 'nie może trafić do modelu' },
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.analysis.heroResult.handId, request.handId);
  assert.match(providerInput, /CoinPoker Hand #96890300082/);
  assert.doesNotMatch(providerInput, /nie może trafić do modelu/);
});

test('API AI zwraca 409 dla nieaktualnej rewizji bez płatnego wywołania', async (t) => {
  let providerCalls = 0;
  const { baseUrl, request } = await startSeededApi(t, {
    environment: { OPENAI_API_KEY: 'test' },
    fetchImpl: async () => {
      providerCalls += 1;
      return openAiResponse(handReport());
    },
  });
  const response = await fetch(`${baseUrl}/api/ai/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'gpt-5.6-terra', ...request, datasetRevision: 'stale' }),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'DATASET_REVISION_MISMATCH');
  assert.equal(providerCalls, 0);
});

test('API AI nie powtarza odmowy dostawcy i waliduje wynik CoinPoker', async (t) => {
  let providerCalls = 0;
  const refusal = await startSeededApi(t, {
    environment: { OPENAI_API_KEY: 'test' },
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Odmowa.' }] }],
      });
    },
  });
  const refusalResponse = await fetch(`${refusal.baseUrl}/api/ai/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'gpt-5.6-terra', ...refusal.request }),
  });
  assert.equal(refusalResponse.status, 502);
  assert.equal(providerCalls, 1);

  const mismatch = await startSeededApi(t, {
    environment: { OPENAI_API_KEY: 'test' },
    fetchImpl: async () => openAiResponse(handReport('WON')),
  });
  const mismatchResponse = await fetch(`${mismatch.baseUrl}/api/ai/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'gpt-5.6-terra', ...mismatch.request }),
  });
  assert.equal(mismatchResponse.status, 422);
});
