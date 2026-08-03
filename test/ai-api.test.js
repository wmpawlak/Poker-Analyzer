import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiApp } from '../server/app.js';

const parsedHand = {
  id: '96890300082',
  rawText: 'CoinPoker Hand #96890300082\n*** SUMMARY ***\nSeat 2: Hero showed [Qh Qd] and won (₮24.67) with Full House',
  outcome: 'WON',
  heroWinnings: 24.67,
  netProfit: 12.34,
  handRanking: 'FULL_HOUSE',
};

const report = {
  heroResult: { outcome: 'WON' },
  preflop: '',
  flop: '',
  turn: '',
  river: '',
  summary: 'Hero wygrał rozdanie.',
};

const jsonResponse = (body, status = 200) => new Response(
  JSON.stringify(body),
  {
    status,
    headers: { 'Content-Type': 'application/json' },
  },
);

const openAiResponse = (analysis = report) => jsonResponse({
  status: 'completed',
  output: [{
    type: 'message',
    content: [{ type: 'output_text', text: JSON.stringify(analysis) }],
  }],
});

const startApi = async (t, options) => {
  const server = createApiApp(options).listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}`;
};

test('GET /api/ai/models zwraca status trzech modeli bez sekretów', async (t) => {
  const baseUrl = await startApi(t, {
    environment: {
      GEMINI_API_KEY: 'gemini-secret',
      OPENAI_API_KEY: '',
    },
  });
  const response = await fetch(`${baseUrl}/api/ai/models`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.models, [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', configured: true },
    { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', configured: false },
    { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', configured: false },
  ]);
  assert.equal(JSON.stringify(body).includes('gemini-secret'), false);
});

test('API odrzuca nieznany model przed wywołaniem dostawcy', async (t) => {
  let providerCalls = 0;
  const baseUrl = await startApi(t, {
    environment: { OPENAI_API_KEY: 'test' },
    fetchImpl: async () => {
      providerCalls += 1;
      return openAiResponse();
    },
  });
  const response = await fetch(`${baseUrl}/api/ai/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'unknown', hand: parsedHand }),
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Nieznany model AI/);
  assert.equal(providerCalls, 0);
});

test('API zwraca 503 dla modelu bez klucza i nie wywołuje dostawcy', async (t) => {
  let providerCalls = 0;
  const baseUrl = await startApi(t, {
    environment: {},
    fetchImpl: async () => {
      providerCalls += 1;
      return openAiResponse();
    },
  });
  const response = await fetch(`${baseUrl}/api/ai/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'gpt-5.6-terra', hand: parsedHand }),
  });

  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /nie jest skonfigurowany/);
  assert.equal(providerCalls, 0);
});

test('API przekazuje odmowę OpenAI bez automatycznego retry', async (t) => {
  let providerCalls = 0;
  const baseUrl = await startApi(t, {
    environment: { OPENAI_API_KEY: 'test' },
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({
        status: 'completed',
        output: [{
          type: 'message',
          content: [{ type: 'refusal', refusal: 'Nie mogę wykonać zadania.' }],
        }],
      });
    },
  });
  const response = await fetch(`${baseUrl}/api/ai/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'gpt-5.6-sol', hand: parsedHand }),
  });

  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /OpenAI odmówił/);
  assert.equal(providerCalls, 1);
});

test('API przekazuje błąd HTTP dostawcy bez automatycznego retry', async (t) => {
  let providerCalls = 0;
  const baseUrl = await startApi(t, {
    environment: { GEMINI_API_KEY: 'test' },
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({ error: { message: 'bad request' } }, 400);
    },
  });
  const response = await fetch(`${baseUrl}/api/ai/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'gemini-2.5-flash', hand: parsedHand }),
  });

  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /Gemini odrzucił żądanie \(HTTP 400\)/);
  assert.equal(providerCalls, 1);
});

test('API odrzuca sprzeczny outcome i zachowuje CoinPoker jako źródło prawdy', async (t) => {
  let providerCalls = 0;
  const baseUrl = await startApi(t, {
    environment: { OPENAI_API_KEY: 'test' },
    fetchImpl: async () => {
      providerCalls += 1;
      return openAiResponse({
        ...report,
        heroResult: { outcome: 'LOST' },
      });
    },
  });
  const response = await fetch(`${baseUrl}/api/ai/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'gpt-5.6-terra', hand: parsedHand }),
  });

  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /Oczekiwano: WON, otrzymano: LOST/);
  assert.equal(providerCalls, 1);
});

test('regresja #96890300082: API dołącza autorytatywne dane Hero', async (t) => {
  const baseUrl = await startApi(t, {
    environment: { OPENAI_API_KEY: 'test' },
    fetchImpl: async () => openAiResponse(),
  });
  const response = await fetch(`${baseUrl}/api/ai/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'gpt-5.6-terra', hand: parsedHand }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.model, { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' });
  assert.deepEqual(body.analysis.heroResult, {
    handId: '96890300082',
    outcome: 'WON',
    heroWinnings: 24.67,
    netProfit: 12.34,
    handRanking: 'FULL_HOUSE',
  });
});
