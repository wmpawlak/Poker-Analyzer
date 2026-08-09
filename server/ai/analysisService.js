import {
  HERO_OUTCOMES,
  analysisResponseSchema,
  buildHandAnalysisPrompt,
  validateHandAnalysis,
} from '../../src/ai/handAnalysisContract.js';
import { AiServiceError } from './errors.js';
import { analyzeWithGemini } from './geminiAdapter.js';
import {
  getAiModelDefinition,
  getPublicAiModel,
  isModelConfigured,
} from './models.js';
import { analyzeWithOpenAi } from './openAiAdapter.js';
import {
  buildSessionAnalysisPrompt,
  sessionAnalysisResponseSchema,
  validateSessionAnalysis,
  validateSessionAnalysisInput,
} from '../../src/ai/sessionAnalysisContract.js';
import {
  buildSessionGroupAnalysisPrompt,
  sessionGroupAnalysisGeminiResponseSchema,
  sessionGroupAnalysisResponseSchema,
  validateSessionGroupAnalysis,
  validateSessionGroupAnalysisInput,
} from '../../src/ai/sessionGroupAnalysisContract.js';

const providerAdapters = {
  gemini: analyzeWithGemini,
  openai: analyzeWithOpenAi,
};

const validateHandPayload = (hand) => {
  if (
    !hand
    || typeof hand !== 'object'
    || !String(hand.id || '').trim()
    || typeof hand.rawText !== 'string'
    || !hand.rawText.trim()
    || !HERO_OUTCOMES.includes(hand.outcome)
  ) {
    throw new AiServiceError(
      'Brakuje prawidłowych danych rozdania do analizy AI.',
      { status: 400, code: 'AI_INVALID_HAND' },
    );
  }
};

export const analyzeHandWithModel = async ({
  modelId,
  hand,
  environment,
  fetchImpl = globalThis.fetch,
}) => {
  const definition = getAiModelDefinition(modelId);
  if (!definition) {
    throw new AiServiceError(
      `Nieznany model AI: ${modelId || 'brak'}.`,
      { status: 400, code: 'AI_UNKNOWN_MODEL' },
    );
  }

  validateHandPayload(hand);

  if (!isModelConfigured(definition, environment)) {
    throw new AiServiceError(
      `Model ${definition.name} nie jest skonfigurowany na serwerze.`,
      { status: 503, code: 'AI_MODEL_NOT_CONFIGURED' },
    );
  }

  const adapter = providerAdapters[definition.provider];
  const analysis = await adapter({
    modelId: definition.id,
    apiKey: environment[definition.environmentKey],
    prompt: buildHandAnalysisPrompt(hand),
    schema: analysisResponseSchema,
    fetchImpl,
  });

  let validatedAnalysis;
  try {
    validatedAnalysis = validateHandAnalysis(analysis, hand);
  } catch (error) {
    throw new AiServiceError(
      error.message,
      { status: 422, code: 'AI_OUTCOME_MISMATCH', cause: error },
    );
  }

  return {
    model: getPublicAiModel(definition),
    analysis: validatedAnalysis,
  };
};

export const analyzeSessionWithModel = async ({
  modelId,
  session,
  environment,
  fetchImpl = globalThis.fetch,
  logger,
}) => {
  const definition = getAiModelDefinition(modelId);
  if (!definition) {
    throw new AiServiceError(`Nieznany model AI: ${modelId || 'brak'}.`, {
      status: 400, code: 'AI_UNKNOWN_MODEL',
    });
  }

  let validatedSession;
  try {
    validatedSession = validateSessionAnalysisInput(session);
  } catch (error) {
    throw new AiServiceError(error.message, {
      status: error.code === 'AI_SESSION_TOO_LARGE' ? 413 : 400,
      code: error.code || 'AI_INVALID_SESSION', cause: error,
    });
  }
  if (!isModelConfigured(definition, environment)) {
    throw new AiServiceError(`Model ${definition.name} nie jest skonfigurowany na serwerze.`, {
      status: 503, code: 'AI_MODEL_NOT_CONFIGURED',
    });
  }

  const adapter = providerAdapters[definition.provider];
  const openAiSessionProfile = definition.provider === 'openai'
    ? {
      maxOutputTokens: 32_000,
      reasoningEffort: 'high',
      logger,
    }
    : {};
  const analysis = await adapter({
    modelId: definition.id,
    apiKey: environment[definition.environmentKey],
    prompt: buildSessionAnalysisPrompt(validatedSession),
    schema: sessionAnalysisResponseSchema,
    schemaName: 'poker_session_analysis',
    fetchImpl,
    ...openAiSessionProfile,
  });
  let validatedAnalysis;
  try {
    validatedAnalysis = validateSessionAnalysis(analysis, validatedSession);
  } catch (error) {
    throw new AiServiceError(error.message, {
      status: 422, code: 'AI_INVALID_SESSION_RESPONSE', cause: error,
    });
  }
  return {
    model: getPublicAiModel(definition),
    sessionId: validatedSession.sessionId,
    fingerprint: validatedSession.fingerprint,
    analysis: validatedAnalysis,
  };
};

export const analyzeSessionGroupWithModel = async ({
  modelId,
  group,
  environment,
  fetchImpl = globalThis.fetch,
  logger,
}) => {
  const definition = getAiModelDefinition(modelId);
  if (!definition) {
    throw new AiServiceError(`Nieznany model AI: ${modelId || 'brak'}.`, {
      status: 400, code: 'AI_UNKNOWN_MODEL',
    });
  }

  let validatedGroup;
  try {
    validatedGroup = validateSessionGroupAnalysisInput(group);
  } catch (error) {
    throw new AiServiceError(error.message, {
      status: error.code === 'AI_SESSION_GROUP_TOO_LARGE' ? 413 : 400,
      code: error.code || 'AI_INVALID_SESSION_GROUP',
      cause: error,
    });
  }
  if (!isModelConfigured(definition, environment)) {
    throw new AiServiceError(`Model ${definition.name} nie jest skonfigurowany na serwerze.`, {
      status: 503, code: 'AI_MODEL_NOT_CONFIGURED',
    });
  }

  const adapter = providerAdapters[definition.provider];
  const openAiSessionProfile = definition.provider === 'openai'
    ? {
      maxOutputTokens: 32_000,
      reasoningEffort: 'high',
      logger,
    }
    : {};
  const analysis = await adapter({
    modelId: definition.id,
    apiKey: environment[definition.environmentKey],
    prompt: buildSessionGroupAnalysisPrompt(validatedGroup),
    schema: definition.provider === 'gemini'
      ? sessionGroupAnalysisGeminiResponseSchema
      : sessionGroupAnalysisResponseSchema,
    schemaName: 'poker_session_group_analysis',
    fetchImpl,
    ...openAiSessionProfile,
  });
  let validatedAnalysis;
  try {
    validatedAnalysis = validateSessionGroupAnalysis(analysis, validatedGroup);
  } catch (error) {
    throw new AiServiceError(error.message, {
      status: 422, code: 'AI_INVALID_SESSION_GROUP_RESPONSE', cause: error,
    });
  }
  return {
    model: getPublicAiModel(definition),
    fingerprint: validatedGroup.fingerprint,
    analysis: validatedAnalysis,
  };
};
