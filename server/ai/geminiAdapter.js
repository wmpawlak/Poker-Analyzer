import { AiServiceError, parseAnalysisJson, readUpstreamJson } from './errors.js';

const GEMINI_API_ORIGIN = 'https://generativelanguage.googleapis.com';

export const analyzeWithGemini = async ({
  modelId,
  apiKey,
  prompt,
  schema,
  fetchImpl = globalThis.fetch,
}) => {
  let response;

  try {
    response = await fetchImpl(
      `${GEMINI_API_ORIGIN}/v1beta/models/${encodeURIComponent(modelId)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseJsonSchema: schema,
          },
        }),
      },
    );
  } catch (error) {
    throw new AiServiceError(
      'Nie udało się połączyć z Gemini.',
      { code: 'AI_CONNECTION_ERROR', cause: error },
    );
  }

  const data = await readUpstreamJson(response, 'Gemini');
  if (!response.ok) {
    throw new AiServiceError(
      `Gemini odrzucił żądanie (HTTP ${response.status}).`,
      { code: 'AI_UPSTREAM_HTTP_ERROR' },
    );
  }

  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts
    ?.filter((part) => typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
    .trim();

  if (!text) {
    const finishReason = candidate?.finishReason;
    const suffix = finishReason ? ` Powód: ${finishReason}.` : '';
    throw new AiServiceError(
      `Gemini nie zwrócił analizy w wymaganym formacie.${suffix}`,
      { code: 'AI_EMPTY_RESPONSE' },
    );
  }

  return parseAnalysisJson(text, 'Gemini');
};

