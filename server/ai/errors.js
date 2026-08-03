export class AiServiceError extends Error {
  constructor(message, { status = 502, code = 'AI_PROVIDER_ERROR', cause } = {}) {
    super(message, { cause });
    this.name = 'AiServiceError';
    this.status = status;
    this.code = code;
  }
}

export const readUpstreamJson = async (response, providerName) => {
  try {
    return await response.json();
  } catch (error) {
    throw new AiServiceError(
      `${providerName} zwrócił odpowiedź, której nie można odczytać.`,
      { code: 'AI_INVALID_RESPONSE', cause: error },
    );
  }
};

export const parseAnalysisJson = (text, providerName) => {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new AiServiceError(
      `${providerName} zwrócił nieprawidłowy raport JSON.`,
      { code: 'AI_INVALID_JSON', cause: error },
    );
  }
};

