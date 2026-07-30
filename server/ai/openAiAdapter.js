import { AiServiceError, parseAnalysisJson, readUpstreamJson } from './errors.js';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

const getResponseText = (data) => {
  const textParts = [];

  for (const item of data.output || []) {
    if (item.type !== 'message') continue;

    for (const content of item.content || []) {
      if (content.type === 'refusal' && content.refusal) {
        throw new AiServiceError(
          `OpenAI odmówił przygotowania analizy: ${content.refusal}`,
          { code: 'AI_REFUSAL' },
        );
      }
      if (content.type === 'output_text' && typeof content.text === 'string') {
        textParts.push(content.text);
      }
    }
  }

  if (textParts.length > 0) return textParts.join('').trim();
  return typeof data.output_text === 'string' ? data.output_text.trim() : '';
};

export const analyzeWithOpenAi = async ({
  modelId,
  apiKey,
  prompt,
  schema,
  fetchImpl = globalThis.fetch,
}) => {
  let response;

  try {
    response = await fetchImpl(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        input: prompt,
        reasoning: { effort: 'high' },
        store: false,
        max_output_tokens: 8000,
        text: {
          format: {
            type: 'json_schema',
            name: 'poker_hand_analysis',
            strict: true,
            schema,
          },
        },
      }),
    });
  } catch (error) {
    throw new AiServiceError(
      'Nie udało się połączyć z OpenAI.',
      { code: 'AI_CONNECTION_ERROR', cause: error },
    );
  }

  const data = await readUpstreamJson(response, 'OpenAI');
  if (!response.ok) {
    throw new AiServiceError(
      `OpenAI odrzucił żądanie (HTTP ${response.status}).`,
      { code: 'AI_UPSTREAM_HTTP_ERROR' },
    );
  }

  if (data.status === 'incomplete') {
    const reason = data.incomplete_details?.reason || 'nieznany';
    throw new AiServiceError(
      `OpenAI zwrócił niepełną analizę. Powód: ${reason}.`,
      { code: 'AI_INCOMPLETE_RESPONSE' },
    );
  }

  if (data.status === 'failed' || data.error) {
    throw new AiServiceError(
      'OpenAI nie zdołał przygotować analizy.',
      { code: 'AI_FAILED_RESPONSE' },
    );
  }

  const text = getResponseText(data);
  if (!text) {
    throw new AiServiceError(
      'OpenAI nie zwrócił analizy w wymaganym formacie.',
      { code: 'AI_EMPTY_RESPONSE' },
    );
  }

  return parseAnalysisJson(text, 'OpenAI');
};

