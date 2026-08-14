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
import {
  buildPlayerAnalysisGeminiResponseSchema,
  buildPlayerAnalysisResponseSchema,
  buildPlayerAnalysisPrompt,
  normalizePlayerAnalysisReferences,
  validatePlayerAnalysis,
  validatePlayerAnalysisInput,
} from '../../src/ai/playerAnalysisContract.js';
import {
  buildTrainingAnswerKeyBatchInput,
  buildTrainingAnswerKeyPrompt,
  trainingAnswerKeyResponseSchema,
} from '../training/answerKeyContract.js';
import {
  buildEquitySupplementBatchInput,
  equitySupplementResponseSchema,
  validateEquitySupplementBatch,
} from '../training/equitySupplementContract.js';

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

export const analyzeTrainingAnswerKeysWithModel = async ({
  modelId,
  input,
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
  let validatedInput;
  try {
    validatedInput = buildTrainingAnswerKeyBatchInput(input?.spots);
  } catch (error) {
    throw new AiServiceError(error.message, {
      status: 400, code: error.code || 'AI_INVALID_TRAINING_BATCH', cause: error,
    });
  }
  if (!isModelConfigured(definition, environment)) {
    throw new AiServiceError(`Model ${definition.name} nie jest skonfigurowany na serwerze.`, {
      status: 503, code: 'AI_MODEL_NOT_CONFIGURED',
    });
  }

  const adapter = providerAdapters[definition.provider];
  const response = await adapter({
    modelId: definition.id,
    apiKey: environment[definition.environmentKey],
    prompt: buildTrainingAnswerKeyPrompt(validatedInput),
    schema: trainingAnswerKeyResponseSchema,
    schemaName: 'poker_training_answer_keys',
    maxOutputTokens: 32_000,
    reasoningEffort: 'high',
    fetchImpl,
    logger,
  });
  return {
    model: getPublicAiModel(definition),
    response,
  };
};

export const analyzeEquitySupplementsWithModel = async ({
  modelId,
  input,
  environment,
  fetchImpl = globalThis.fetch,
  logger,
}) => {
  const definition = getAiModelDefinition(modelId);
  if (!definition) throw new AiServiceError(`Nieznany model AI: ${modelId || 'brak'}.`, { status: 400, code: 'AI_UNKNOWN_MODEL' });
  let validatedInput;
  try {
    validatedInput = input?.contractVersion === 1 && Array.isArray(input?.supplements) && !input?.spots
      ? input
      : input?.spots
      ? buildEquitySupplementBatchInput(input.spots, input.answerKeys)
      : buildEquitySupplementBatchInput(input?.supplements?.map((supplement) => ({
        ...supplement,
        currentAnswerKeyId: supplement.answerKeyId,
        currentAnswerKey: { id: supplement.answerKeyId, status: 'ready', confidence: 'high', contractVersion: 3, spotVersionId: supplement.spotVersionId },
        sourceStatus: 'current', active: true, exerciseType: 'turn_river',
        question: {
          ...supplement,
          heroCards: supplement.heroCards,
          board: supplement.board,
          context: { opponentsInHand: 1 },
          toCall: supplement.toCall,
          effectiveStack: supplement.effectiveStack,
          legalActions: ['call'],
        },
      })), input?.answerKeys);
  } catch (error) {
    throw new AiServiceError(error.message, { status: 400, code: error.code || 'AI_INVALID_EQUITY_SUPPLEMENT_BATCH', cause: error });
  }
  if (!isModelConfigured(definition, environment)) {
    throw new AiServiceError(`Model ${definition.name} nie jest skonfigurowany na serwerze.`, { status: 503, code: 'AI_MODEL_NOT_CONFIGURED' });
  }
  const prompt = `Jesteś trenerem NLH. Uzupełnij wyłącznie zakres rywala dla gotowych spotów. Nie generuj akcji, sizingu, rationale ani liczbowego equity. Zwróć dokładnie jeden zakres dla każdego spotVersionId. Zakres ma używać kanonicznych klas 169 rąk (np. AKs, QJo, 77) i wag 0.25, 0.5, 0.75 albo 1. Card removal uwzględnij logicznie. Istniejący opponentRangeHint jest tylko podpowiedzią. Zwróć wyłącznie JSON zgodny ze schematem.\nDane:\n${JSON.stringify(validatedInput)}`;
  const adapter = providerAdapters[definition.provider];
  const response = await adapter({
    modelId: definition.id,
    apiKey: environment[definition.environmentKey],
    prompt,
    schema: equitySupplementResponseSchema,
    schemaName: 'poker_equity_supplements',
    maxOutputTokens: 16_000,
    reasoningEffort: 'high',
    fetchImpl,
    logger,
  });
  let validated;
  try { validated = validateEquitySupplementBatch(response, validatedInput); } catch (error) {
    throw new AiServiceError(error.message, { status: 422, code: 'AI_INVALID_EQUITY_SUPPLEMENT_RESPONSE', cause: error });
  }
  return { model: getPublicAiModel(definition), response, validated, contractVersion: validatedInput.contractVersion };
};

export const analyzePlayerWithModel = async ({
  modelId,
  player,
  environment,
  fetchImpl = globalThis.fetch,
  logger,
}) => {
  const definition = getAiModelDefinition(modelId);
  if (!definition) {
    throw new AiServiceError(`Nieznany model AI: ${modelId || 'brak'}.`, {
      status: 400,
      code: 'AI_UNKNOWN_MODEL',
    });
  }

  let validatedPlayer;
  try {
    validatedPlayer = validatePlayerAnalysisInput(player);
  } catch (error) {
    throw new AiServiceError(error.message, {
      status: error.code === 'AI_PLAYER_ANALYSIS_TOO_LARGE' ? 413 : 400,
      code: error.code || 'AI_INVALID_PLAYER_ANALYSIS',
      cause: error,
    });
  }
  if (!isModelConfigured(definition, environment)) {
    throw new AiServiceError(`Model ${definition.name} nie jest skonfigurowany na serwerze.`, {
      status: 503,
      code: 'AI_MODEL_NOT_CONFIGURED',
    });
  }

  const adapter = providerAdapters[definition.provider];
  const responseSchema = definition.provider === 'gemini'
    ? buildPlayerAnalysisGeminiResponseSchema(validatedPlayer)
    : buildPlayerAnalysisResponseSchema(validatedPlayer);
  const openAiPlayerProfile = definition.provider === 'openai'
    ? {
      maxOutputTokens: 32_000,
      reasoningEffort: 'high',
      logger,
    }
    : {};
  const analysis = await adapter({
    modelId: definition.id,
    apiKey: environment[definition.environmentKey],
    prompt: buildPlayerAnalysisPrompt(validatedPlayer),
    schema: responseSchema,
    schemaName: 'poker_player_analysis',
    fetchImpl,
    ...openAiPlayerProfile,
  });
  let validatedAnalysis;
  let referenceWarnings;
  try {
    const normalized = normalizePlayerAnalysisReferences(analysis, validatedPlayer);
    validatedAnalysis = validatePlayerAnalysis(normalized.analysis, validatedPlayer);
    referenceWarnings = normalized.referenceWarnings;
  } catch (error) {
    throw new AiServiceError(error.message, {
      status: 422,
      code: 'AI_INVALID_PLAYER_RESPONSE',
      cause: error,
    });
  }
  return {
    model: getPublicAiModel(definition),
    fingerprint: validatedPlayer.fingerprint,
    analysis: validatedAnalysis,
    referenceWarnings,
  };
};
