import { AiServiceError, parseAnalysisJson, readUpstreamJson } from './errors.js';
import { configureSystemCertificates } from '../systemCertificates.js';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const MAX_POLL_INTERVAL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 8_000;
const DEFAULT_REASONING_EFFORT = 'high';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const getRetryAfterMs = (response, nowImpl) => {
  const value = response.headers?.get?.('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - nowImpl()) : null;
};

const getFiniteNumber = (value) => (Number.isFinite(value) ? value : undefined);

const getSafeUsage = (rawUsage) => {
  if (!rawUsage || typeof rawUsage !== 'object') return undefined;

  const usage = {
    inputTokens: getFiniteNumber(rawUsage.input_tokens),
    cachedInputTokens: getFiniteNumber(rawUsage.input_tokens_details?.cached_tokens),
    outputTokens: getFiniteNumber(rawUsage.output_tokens),
    reasoningTokens: getFiniteNumber(rawUsage.output_tokens_details?.reasoning_tokens),
    totalTokens: getFiniteNumber(rawUsage.total_tokens),
  };
  const entries = Object.entries(usage).filter(([, value]) => value !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const getSafeReason = (data, fallback) => {
  const reason = data?.incomplete_details?.reason
    ?? data?.error?.code
    ?? data?.error?.type
    ?? fallback;
  return typeof reason === 'string' && reason.trim() ? reason.trim() : undefined;
};

const logOpenAiResponseTelemetry = (logger, {
  responseId,
  data,
  status,
  reason,
} = {}) => {
  const safeResponseId = typeof responseId === 'string'
    ? responseId
    : (typeof data?.id === 'string' ? data.id : undefined);
  const safeStatus = typeof status === 'string'
    ? status
    : (typeof data?.status === 'string' ? data.status : undefined);
  const safeReason = getSafeReason(data, reason);
  const usage = getSafeUsage(data?.usage);
  const telemetry = {};

  if (safeResponseId) telemetry.responseId = safeResponseId;
  if (safeStatus) telemetry.status = safeStatus;
  if (safeReason) telemetry.reason = safeReason;
  if (usage) telemetry.usage = usage;
  if (Object.keys(telemetry).length === 0) return;

  try {
    logger?.info?.(telemetry);
  } catch {
    // Telemetria lokalna nie może wpływać na wynik analizy.
  }
};

const getIncompleteResponseMessage = (reason) => (
  reason === 'max_output_tokens'
    ? 'OpenAI wykorzystał cały budżet tokenów. Raport nie został zapisany.'
    : `OpenAI zwrócił niepełną analizę. Powód: ${reason}.`
);

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

const throwForTerminalStatus = (data) => {
  if (data.status === 'incomplete') {
    const reason = data.incomplete_details?.reason || 'nieznany';
    throw new AiServiceError(
      getIncompleteResponseMessage(reason),
      { code: 'AI_INCOMPLETE_RESPONSE' },
    );
  }
  if (data.status === 'failed' || data.status === 'cancelled' || data.error) {
    const reason = data.error?.message || data.status || 'nieznany';
    throw new AiServiceError(
      `OpenAI nie zdołał przygotować analizy. Powód: ${reason}.`,
      { code: 'AI_FAILED_RESPONSE' },
    );
  }
};

const fetchOpenAiJson = async ({ url, options, fetchImpl, operation }) => {
  // Keep direct adapter usage safe as well as the normal server entrypoint.
  // This is important on Windows/Node installations whose default CA bundle
  // does not include the system trust store.
  configureSystemCertificates();
  let response;
  try {
    response = await fetchImpl(url, options);
  } catch (error) {
    const suffix = error.cause?.code ? ` (${error.cause.code})` : '';
    throw new AiServiceError(
      `Nie udało się połączyć z OpenAI podczas ${operation}${suffix}.`,
      { code: 'AI_CONNECTION_ERROR', cause: error },
    );
  }

  const data = await readUpstreamJson(response, 'OpenAI');
  if (!response.ok) {
    const upstreamReason = data.error?.message ? ` ${data.error.message}` : '';
    throw new AiServiceError(
      `OpenAI odrzucił żądanie (HTTP ${response.status}).${upstreamReason}`,
      { code: 'AI_UPSTREAM_HTTP_ERROR' },
    );
  }
  return { response, data };
};

const pollOpenAiResponse = async ({
  responseId,
  apiKey,
  fetchImpl,
  sleepImpl,
  nowImpl,
  pollIntervalMs,
  timeoutMs,
  logger,
}) => {
  const deadline = nowImpl() + timeoutMs;
  let delayMs = pollIntervalMs;

  while (nowImpl() < deadline) {
    await sleepImpl(delayMs);
    let result;
    try {
      result = await fetchOpenAiJson({
        url: `${OPENAI_RESPONSES_URL}/${encodeURIComponent(responseId)}`,
        options: { headers: { Authorization: `Bearer ${apiKey}` } },
        fetchImpl,
        operation: 'sprawdzania statusu analizy',
      });
    } catch (error) {
      logOpenAiResponseTelemetry(logger, {
        responseId,
        status: 'polling_error',
        reason: error.code || 'AI_PROVIDER_ERROR',
      });
      throw error;
    }
    const isPending = ['queued', 'in_progress'].includes(result.data.status);
    if (!isPending || result.data.error) {
      logOpenAiResponseTelemetry(logger, { responseId, data: result.data });
    }
    throwForTerminalStatus(result.data);
    if (result.data.status === 'completed') return result.data;
    if (!isPending) {
      throw new AiServiceError(
        `OpenAI zwrócił nieznany status analizy: ${result.data.status || 'brak'}.`,
        { code: 'AI_INVALID_RESPONSE' },
      );
    }
    delayMs = Math.min(
      getRetryAfterMs(result.response, nowImpl) ?? Math.ceil(delayMs * 1.5),
      MAX_POLL_INTERVAL_MS,
    );
  }

  logOpenAiResponseTelemetry(logger, {
    responseId,
    status: 'timeout',
    reason: 'AI_TIMEOUT',
  });
  throw new AiServiceError(
    'OpenAI nie zakończył analizy w ciągu 15 minut. Nie wykonano ponownego płatnego żądania.',
    { status: 504, code: 'AI_TIMEOUT' },
  );
};

export const analyzeWithOpenAi = async ({
  modelId,
  apiKey,
  prompt,
  schema,
  schemaName = 'poker_hand_analysis',
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
  reasoningEffort = DEFAULT_REASONING_EFFORT,
  fetchImpl = globalThis.fetch,
  sleepImpl = wait,
  nowImpl = Date.now,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logger,
}) => {
  const initial = await fetchOpenAiJson({
    url: OPENAI_RESPONSES_URL,
    options: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        input: prompt,
        background: true,
        reasoning: { effort: reasoningEffort },
        store: true,
        max_output_tokens: maxOutputTokens,
        text: {
          format: {
            type: 'json_schema',
            name: schemaName,
            strict: true,
            schema,
          },
        },
      }),
    },
    fetchImpl,
    operation: 'uruchamiania analizy',
  });

  let data = initial.data;
  const isPending = ['queued', 'in_progress'].includes(data.status);
  if (isPending && !data.error) {
    if (!data.id) {
      logOpenAiResponseTelemetry(logger, { data });
      throw new AiServiceError(
        'OpenAI nie zwrócił ID analizy w tle.',
        { code: 'AI_INVALID_RESPONSE' },
      );
    }
    logOpenAiResponseTelemetry(logger, { data });
    data = await pollOpenAiResponse({
      responseId: data.id,
      apiKey,
      fetchImpl,
      sleepImpl,
      nowImpl,
      pollIntervalMs,
      timeoutMs,
      logger,
    });
  } else {
    logOpenAiResponseTelemetry(logger, { data });
    throwForTerminalStatus(data);
    if (data.status && data.status !== 'completed') {
      throw new AiServiceError(
        `OpenAI zwrócił nieznany status analizy: ${data.status}.`,
        { code: 'AI_INVALID_RESPONSE' },
      );
    }
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
