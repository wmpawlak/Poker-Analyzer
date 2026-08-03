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

