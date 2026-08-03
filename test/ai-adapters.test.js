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
    assert.equal(body.store, false);
    assert.equal(body.max_output_tokens, 8000);
    assert.equal(body.text.format.type, 'json_schema');
    assert.equal(body.text.format.strict, true);
    assert.deepEqual(body.text.format.schema, analysisResponseSchema);
    assert.equal(Object.hasOwn(body, 'tools'), false);
  });
}

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
