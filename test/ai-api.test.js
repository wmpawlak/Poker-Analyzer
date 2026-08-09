import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiApp } from '../server/app.js';
import { buildSessionAnalysisInput } from '../src/ai/sessionAnalysisContract.js';
import { buildSessionGroupAnalysisInput } from '../src/ai/sessionGroupAnalysisContract.js';

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

const sessionInput = buildSessionAnalysisInput({
  sessionId: 'cash:table-1',
  gameType: 'cash',
  hands: [
    { ...parsedHand, timestamp: 1, position: 'BTN', blinds: '€0.05/€0.10', smallBlind: 0.05, bigBlind: 0.1, heroStartingStack: 10, heroCards: ['Qh', 'Qd'], boardCards: [], streets: [] },
    { ...parsedHand, id: '96890300083', timestamp: 2, netProfit: -20, outcome: 'LOST', heroWinnings: 0, position: 'BB', blinds: '€0.05/€0.10', smallBlind: 0.05, bigBlind: 0.1, heroStartingStack: 10, heroCards: ['Ah', 'Kd'], boardCards: [], streets: [] },
  ],
});

const sessionReport = {
  profileStyleId: 'INSUFFICIENT',
  sessionSummary: 'Próba jest niewielka. Wnioski trzeba traktować ostrożnie.',
  keyMistakes: [],
  notableHands: [{ handId: '96890300083', reason: 'Największa zmiana wyniku.' }],
};

const createGroupSource = ({ type, sessionId, startTime }) => {
  const hands = sessionInput.hands.map((hand, index) => ({
    ...hand,
    id: `${sessionId}-${index + 1}`,
    timestamp: startTime + index,
  }));
  const sessionFingerprint = buildSessionAnalysisInput({ sessionId, gameType: type, hands }).fingerprint;
  return {
    sourceId: `${type}:${sessionId}`,
    type,
    sessionId,
    startTime,
    date: '2026-08-08 12:00:00',
    label: type === 'cash' ? `Stół ${sessionId}` : `Turniej ${sessionId}`,
    hands,
    sessionFingerprint,
    report: {
      reportId: `report-${sessionId}`,
      fingerprint: sessionFingerprint,
      model: { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
      analyzedAt: '2026-08-08T12:00:00.000Z',
      analysis: {
        ...sessionReport,
        notableHands: [{ handId: `${sessionId}-2`, reason: 'Największa zmiana wyniku.' }],
      },
    },
  };
};

const groupInput = buildSessionGroupAnalysisInput({
  sources: [
    createGroupSource({ type: 'cash', sessionId: 'cash-a', startTime: 1_754_640_000_000 }),
    createGroupSource({ type: 'tournament', sessionId: 'tourney-b', startTime: 1_754_726_400_000 }),
  ],
  activeCategory: 'both',
});

const groupSourceRef = (source, handIds = []) => ({
  sourceId: source.sourceId,
  reportId: source.reportId,
  handIds,
});

const sessionGroupReport = {
  profileStyleId: groupInput.metrics.shared.profileStyleId,
  reliabilityId: groupInput.metrics.shared.reliability.id,
  summary: 'Przekrojowy raport z wybranych sesji.',
  summarySourceRefs: [groupSourceRef(groupInput.sources[0])],
  strengths: [{
    title: 'Dyscyplina', description: 'Mocna strona.',
    sourceRefs: [groupSourceRef(groupInput.sources[0], [groupInput.sources[0].referencedHandIds[0]])],
  }],
  repeatedMistakes: [{
    title: 'Za szerokie calle', description: 'Powtarzają się.', correction: 'Częściej folduj.',
    sourceRefs: groupInput.sources.map((source) => groupSourceRef(source, [source.referencedHandIds[0]])),
  }],
  trainingPriorities: [1, 2, 3].map((index) => ({
    title: `Priorytet ${index}`, description: 'Ćwiczenie.',
    sourceRefs: [groupSourceRef(groupInput.sources[0])],
  })),
  categoryInsights: groupInput.sources.map((source) => ({
    category: source.type,
    summary: `Podsumowanie ${source.type}.`,
    sourceRefs: [groupSourceRef(source)],
    tendencies: [{ title: 'Tendencja', description: 'Opis.', sourceRefs: [groupSourceRef(source)] }],
    recommendations: [{ title: 'Zalecenie', description: 'Opis.', sourceRefs: [groupSourceRef(source)] }],
  })),
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
  const server = createApiApp({
    logger: { info: () => {}, error: () => {} },
    ...options,
  }).listen(0);
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
  const responseBody = await response.json();
  assert.match(responseBody.error, /Gemini odrzucił żądanie \(HTTP 400\)/);
  assert.match(responseBody.error, /bad request/);
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

test('API sesji wykonuje dokładnie jedno wywołanie, zwraca odcisk i schemat sesji', async (t) => {
  let providerCalls = 0;
  let requestBody;
  const baseUrl = await startApi(t, {
    environment: { OPENAI_API_KEY: 'test' },
    fetchImpl: async (_url, options) => {
      providerCalls += 1;
      requestBody = JSON.parse(options.body);
      return openAiResponse(sessionReport);
    },
  });
  const response = await fetch(`${baseUrl}/api/ai/analyze-session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'gpt-5.6-terra', session: sessionInput }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(providerCalls, 1);
  assert.equal(body.sessionId, sessionInput.sessionId);
  assert.equal(body.fingerprint, sessionInput.fingerprint);
  assert.deepEqual(body.analysis, sessionReport);
  assert.equal(requestBody.text.format.name, 'poker_session_analysis');
  assert.equal(requestBody.background, true);
  assert.equal(requestBody.store, true);
  assert.equal(requestBody.max_output_tokens, 32_000);
  assert.deepEqual(requestBody.reasoning, { effort: 'high' });
});

test('API sesji zwraca kod incomplete bez drugiego płatnego POST-a', async (t) => {
  let providerCalls = 0;
  const telemetry = [];
  const baseUrl = await startApi(t, {
    environment: { OPENAI_API_KEY: 'test' },
    logger: {
      info: (...args) => telemetry.push(args),
      error: () => {},
    },
    fetchImpl: async (_url, options) => {
      providerCalls += 1;
      assert.equal(options.method, 'POST');
      return jsonResponse({
        id: 'resp_session_limit',
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        usage: {
          input_tokens: 12_000,
          output_tokens: 32_000,
          output_tokens_details: { reasoning_tokens: 22_000 },
          total_tokens: 44_000,
        },
      });
    },
  });
  const response = await fetch(`${baseUrl}/api/ai/analyze-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'gpt-5.6-terra', session: sessionInput }),
  });
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.code, 'AI_INCOMPLETE_RESPONSE');
  assert.match(body.error, /wykorzystał cały budżet tokenów/i);
  assert.match(body.error, /Raport nie został zapisany/i);
  assert.doesNotMatch(body.error, /max_output_tokens/i);
  assert.deepEqual(Object.keys(body).sort(), ['code', 'error']);
  assert.equal(providerCalls, 1);
  assert.deepEqual(telemetry, [[
    {
      responseId: 'resp_session_limit',
      status: 'incomplete',
      reason: 'max_output_tokens',
      usage: {
        inputTokens: 12_000,
        outputTokens: 32_000,
        reasoningTokens: 22_000,
        totalTokens: 44_000,
      },
    },
  ]]);
});

test('API sesji odrzuca wadliwy raport i zbyt dużą sesję bez ponowienia dostawcy', async (t) => {
  let providerCalls = 0;
  const baseUrl = await startApi(t, {
    environment: { OPENAI_API_KEY: 'test' },
    fetchImpl: async () => {
      providerCalls += 1;
      return openAiResponse({ ...sessionReport, notableHands: [{ handId: '96890300082', reason: 'Nie ten swing.' }] });
    },
  });
  const invalidResponse = await fetch(`${baseUrl}/api/ai/analyze-session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'gpt-5.6-terra', session: sessionInput }),
  });
  assert.equal(invalidResponse.status, 422);
  assert.equal(providerCalls, 1);

  const malformed = { ...sessionInput, hands: [{ ...sessionInput.hands[0], rawText: 'niedozwolone' }] };
  const malformedResponse = await fetch(`${baseUrl}/api/ai/analyze-session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'gpt-5.6-terra', session: malformed }),
  });
  assert.equal(malformedResponse.status, 400);
  assert.equal(providerCalls, 1);
});

test('API wielu sesji wykonuje jedno wywołanie, używa profilu 32k/high i nie wysyła surowych historii', async (t) => {
  let providerCalls = 0;
  let requestBody;
  const baseUrl = await startApi(t, {
    environment: { OPENAI_API_KEY: 'test' },
    fetchImpl: async (_url, options) => {
      providerCalls += 1;
      requestBody = JSON.parse(options.body);
      return openAiResponse(sessionGroupReport);
    },
  });
  const response = await fetch(`${baseUrl}/api/ai/analyze-session-group`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'gpt-5.6-terra', group: groupInput }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(providerCalls, 1);
  assert.equal(body.fingerprint, groupInput.fingerprint);
  assert.deepEqual(body.analysis, sessionGroupReport);
  assert.equal(requestBody.text.format.name, 'poker_session_group_analysis');
  assert.equal(requestBody.max_output_tokens, 32_000);
  assert.deepEqual(requestBody.reasoning, { effort: 'high' });
  assert.equal(requestBody.background, true);
  assert.equal(JSON.stringify(requestBody).includes('rawText'), false);
  assert.doesNotMatch(requestBody.input, /fnv1a-|sessionFingerprint|reportFingerprint|analyzedAt/);
  assert.doesNotMatch(requestBody.input, /"model"/);
  assert.match(requestBody.input, /reportId/);
  assert.match(requestBody.input, /referencedHandIds/);
});

test('API wielu sesji upraszcza zagnieżdżone limity schematu dla Gemini', async (t) => {
  let providerCalls = 0;
  let requestBody;
  const baseUrl = await startApi(t, {
    environment: { GEMINI_API_KEY: 'test' },
    fetchImpl: async (_url, options) => {
      providerCalls += 1;
      requestBody = JSON.parse(options.body);
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: JSON.stringify(sessionGroupReport) }] } }],
      });
    },
  });
  const response = await fetch(`${baseUrl}/api/ai/analyze-session-group`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'gemini-2.5-flash', group: groupInput }),
  });

  assert.equal(response.status, 200);
  assert.equal(providerCalls, 1);
  const schemaText = JSON.stringify(requestBody.generationConfig.responseJsonSchema);
  assert.equal(schemaText.includes('minItems'), false);
  assert.equal(schemaText.includes('maxItems'), false);
  assert.equal(schemaText.includes('additionalProperties'), false);
  assert.equal(schemaText.includes('sourceRefs'), true);
});

test('API wielu sesji odrzuca nieaktualne źródło i nie wykonuje płatnego wywołania', async (t) => {
  let providerCalls = 0;
  const baseUrl = await startApi(t, {
    environment: { OPENAI_API_KEY: 'test' },
    fetchImpl: async () => {
      providerCalls += 1;
      return openAiResponse(sessionGroupReport);
    },
  });
  const invalidGroup = {
    ...groupInput,
    sources: groupInput.sources.map((source, index) => index === 0
      ? { ...source, reportFingerprint: 'stale-report' }
      : source),
  };
  const response = await fetch(`${baseUrl}/api/ai/analyze-session-group`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'gpt-5.6-terra', group: invalidGroup }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.code, 'AI_INVALID_SESSION_GROUP');
  assert.equal(providerCalls, 0);
});

test('API wielu sesji zwraca JSONowy błąd dla uszkodzonego żądania', async (t) => {
  let providerCalls = 0;
  const baseUrl = await startApi(t, {
    environment: { OPENAI_API_KEY: 'test' },
    fetchImpl: async () => {
      providerCalls += 1;
      return openAiResponse(sessionGroupReport);
    },
  });
  const response = await fetch(`${baseUrl}/api/ai/analyze-session-group`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"modelId":',
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: 'Żądanie AI musi zawierać prawidłowy JSON.',
    code: 'AI_INVALID_REQUEST',
  });
  assert.equal(providerCalls, 0);
});
