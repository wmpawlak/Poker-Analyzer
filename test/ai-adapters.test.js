import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWithGemini } from '../server/ai/geminiAdapter.js';
import { analyzeWithOpenAi } from '../server/ai/openAiAdapter.js';
import { analysisResponseSchema } from '../src/ai/handAnalysisContract.js';

const report = {
  heroResult: { outcome: 'WON' },
  preflop: 'Preflop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
  summary: 'Podsumowanie',
};

const jsonResponse = (body, status = 200) => new Response(
  JSON.stringify(body),
  {
    status,
    headers: { 'Content-Type': 'application/json' },
  },
);

test('adapter Gemini wykonuje jedno żądanie i wymusza raport JSON', async () => {
  const calls = [];
  const result = await analyzeWithGemini({
    modelId: 'gemini-2.5-flash',
    apiKey: 'test-gemini-key',
    prompt: 'prompt',
    schema: analysisResponseSchema,
    fetchImpl: async (...args) => {
      calls.push(args);
      return jsonResponse({
        candidates: [{
          finishReason: 'STOP',
          content: { parts: [{ text: JSON.stringify(report) }] },
        }],
      });
    },
  });

  assert.deepEqual(result, report);
  assert.equal(calls.length, 1);
  const [url, options] = calls[0];
  assert.match(url, /gemini-2\.5-flash:generateContent$/);
  assert.equal(options.headers['x-goog-api-key'], 'test-gemini-key');
  assert.equal(url.includes('test-gemini-key'), false);
  const body = JSON.parse(options.body);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(body.generationConfig.responseJsonSchema, analysisResponseSchema);
});

for (const modelId of ['gpt-5.6-terra', 'gpt-5.6-sol']) {
  test(`adapter OpenAI obsługuje ${modelId} jednym żądaniem Responses API`, async () => {
    const calls = [];
    const result = await analyzeWithOpenAi({
      modelId,
      apiKey: 'test-openai-key',
      prompt: 'prompt',
      schema: analysisResponseSchema,
      fetchImpl: async (...args) => {
        calls.push(args);
        return jsonResponse({
          status: 'completed',
          output: [{
            type: 'message',
            content: [{ type: 'output_text', text: JSON.stringify(report) }],
          }],
        });
      },
    });

    assert.deepEqual(result, report);
    assert.equal(calls.length, 1);
    const [url, options] = calls[0];
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization, 'Bearer test-openai-key');
    const body = JSON.parse(options.body);
    assert.equal(body.model, modelId);
    assert.deepEqual(body.reasoning, { effort: 'high' });
    assert.equal(body.background, true);
    assert.equal(body.store, true);
    assert.equal(body.max_output_tokens, 8000);
    assert.equal(body.text.format.type, 'json_schema');
    assert.equal(body.text.format.name, 'poker_hand_analysis');
    assert.equal(body.text.format.strict, true);
    assert.deepEqual(body.text.format.schema, analysisResponseSchema);
    assert.equal(Object.hasOwn(body, 'tools'), false);
  });
}

test('adapter OpenAI wykonuje jeden płatny POST i odpytuje odpowiedź w tle przez GET', async () => {
  const calls = [];
  let pollCount = 0;
  const result = await analyzeWithOpenAi({
    modelId: 'gpt-5.6-terra',
    apiKey: 'test-openai-key',
    prompt: 'prompt',
    schema: analysisResponseSchema,
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      calls.push([url, options]);
      if (options.method === 'POST') return jsonResponse({ id: 'resp_123', status: 'queued' });
      pollCount += 1;
      if (pollCount === 1) {
        return new Response(JSON.stringify({ id: 'resp_123', status: 'in_progress' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '0' },
        });
      }
      return jsonResponse({
        id: 'resp_123',
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(report) }] }],
      });
    },
  });

  assert.deepEqual(result, report);
  assert.equal(calls.filter(([, options]) => options.method === 'POST').length, 1);
  assert.equal(calls.filter(([, options]) => !options.method).length, 2);
  assert.equal(calls[1][0], 'https://api.openai.com/v1/responses/resp_123');
  assert.equal(calls[1][1].headers.Authorization, 'Bearer test-openai-key');
});

test('timeout analizy OpenAI nie wykonuje drugiego płatnego POST-a', async () => {
  const calls = [];
  await assert.rejects(
    analyzeWithOpenAi({
      modelId: 'gpt-5.6-terra',
      apiKey: 'test',
      prompt: 'prompt',
      schema: analysisResponseSchema,
      timeoutMs: 0,
      sleepImpl: async () => {},
      fetchImpl: async (url, options = {}) => {
        calls.push([url, options]);
        return jsonResponse({ id: 'resp_timeout', status: 'queued' });
      },
    }),
    (error) => error.code === 'AI_TIMEOUT' && error.status === 504,
  );
  assert.equal(calls.filter(([, options]) => options.method === 'POST').length, 1);
  assert.equal(calls.length, 1);
});

test('adapter OpenAI przyjmuje nazwę ścisłego schematu sesji', async () => {
  const calls = [];
  await analyzeWithOpenAi({
    modelId: 'gpt-5.6-terra', apiKey: 'test', prompt: 'prompt', schema: analysisResponseSchema,
    schemaName: 'poker_session_analysis',
    fetchImpl: async (...args) => {
      calls.push(args);
      return jsonResponse({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(report) }] }] });
    },
  });
  assert.equal(JSON.parse(calls[0][1].body).text.format.name, 'poker_session_analysis');
});

test('adapter OpenAI przyjmuje profil generowania sesji', async () => {
  const calls = [];
  await analyzeWithOpenAi({
    modelId: 'gpt-5.6-terra',
    apiKey: 'test',
    prompt: 'prompt',
    schema: analysisResponseSchema,
    maxOutputTokens: 32_000,
    reasoningEffort: 'high',
    fetchImpl: async (...args) => {
      calls.push(args);
      return jsonResponse({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(report) }] }],
      });
    },
  });

  const body = JSON.parse(calls[0][1].body);
  assert.equal(body.max_output_tokens, 32_000);
  assert.deepEqual(body.reasoning, { effort: 'high' });
});

test('adapter OpenAI nie ponawia incomplete max_output_tokens i loguje wyłącznie bezpieczną telemetrię', async () => {
  const calls = [];
  const telemetry = [];
  const secretPrompt = 'PRIVATE-HAND-HISTORY';
  const secretApiKey = 'PRIVATE-API-KEY';

  await assert.rejects(
    analyzeWithOpenAi({
      modelId: 'gpt-5.6-terra',
      apiKey: secretApiKey,
      prompt: secretPrompt,
      schema: analysisResponseSchema,
      logger: { info: (...args) => telemetry.push(args) },
      fetchImpl: async (...args) => {
        calls.push(args);
        return jsonResponse({
          id: 'resp_limit',
          status: 'incomplete',
          incomplete_details: {
            reason: 'max_output_tokens',
            handHistory: secretPrompt,
          },
          input: secretPrompt,
          usage: {
            input_tokens: 1_200,
            input_tokens_details: { cached_tokens: 200, handHistory: secretPrompt },
            output_tokens: 8_000,
            output_tokens_details: { reasoning_tokens: 6_300, prompt: secretPrompt },
            total_tokens: 9_200,
            apiKey: secretApiKey,
          },
        });
      },
    }),
    (error) => (
      error.code === 'AI_INCOMPLETE_RESPONSE'
      && /wykorzystał cały budżet tokenów/i.test(error.message)
      && /Raport nie został zapisany/i.test(error.message)
      && !/max_output_tokens/i.test(error.message)
    ),
  );

  assert.equal(calls.filter(([, options]) => options.method === 'POST').length, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(telemetry, [[
    {
      responseId: 'resp_limit',
      status: 'incomplete',
      reason: 'max_output_tokens',
      usage: {
        inputTokens: 1_200,
        cachedInputTokens: 200,
        outputTokens: 8_000,
        reasoningTokens: 6_300,
        totalTokens: 9_200,
      },
    },
  ]]);
  const serializedTelemetry = JSON.stringify(telemetry);
  assert.equal(serializedTelemetry.includes(secretPrompt), false);
  assert.equal(serializedTelemetry.includes(secretApiKey), false);
});

test('adaptery nie ponawiają żądania po błędzie połączenia', async () => {
  let geminiCalls = 0;
  let openAiCalls = 0;

  await assert.rejects(
    analyzeWithGemini({
      modelId: 'gemini-2.5-flash',
      apiKey: 'test',
      prompt: 'prompt',
      schema: analysisResponseSchema,
      fetchImpl: async () => {
        geminiCalls += 1;
        throw new Error('offline');
      },
    }),
    /Nie udało się połączyć z Gemini/,
  );
  await assert.rejects(
    analyzeWithOpenAi({
      modelId: 'gpt-5.6-terra',
      apiKey: 'test',
      prompt: 'prompt',
      schema: analysisResponseSchema,
      fetchImpl: async () => {
        openAiCalls += 1;
        throw new Error('offline');
      },
    }),
    /Nie udało się połączyć z OpenAI/,
  );

  assert.equal(geminiCalls, 1);
  assert.equal(openAiCalls, 1);
});
