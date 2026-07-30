export const AI_MODEL_DEFINITIONS = [
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'gemini',
    environmentKey: 'GEMINI_API_KEY',
  },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT-5.6 Terra',
    provider: 'openai',
    environmentKey: 'OPENAI_API_KEY',
  },
  {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    provider: 'openai',
    environmentKey: 'OPENAI_API_KEY',
  },
];

export const getAiModelDefinition = (modelId) => (
  AI_MODEL_DEFINITIONS.find(({ id }) => id === modelId)
);

export const isModelConfigured = (definition, environment) => (
  Boolean(environment[definition.environmentKey]?.trim())
);

export const getPublicAiModels = (environment) => (
  AI_MODEL_DEFINITIONS.map((definition) => ({
    id: definition.id,
    name: definition.name,
    configured: isModelConfigured(definition, environment),
  }))
);

export const getPublicAiModel = (definition) => ({
  id: definition.id,
  name: definition.name,
});

