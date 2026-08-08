import { calculateSessionMetrics } from '../utils/sessionMetrics.js';

export const SESSION_ANALYSIS_MAX_BYTES = 1_500_000;

const SESSION_STYLE_IDS = [
  'TAG', 'LAG', 'NIT_ROCK', 'LOOSE_PASSIVE', 'TIGHT_PASSIVE', 'MANIAC',
  'WEAK_TIGHT', 'BALANCED', 'RECREATIONAL', 'MIXED', 'INSUFFICIENT',
];

const asFiniteNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const asString = (value) => String(value ?? '').trim();
const unique = (items) => [...new Set(items)];

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
};

export const stableStringify = (value) => JSON.stringify(stableValue(value));

// Deterministic content identifier, not a cryptographic integrity guarantee.
export const createSessionFingerprint = (value) => {
  const text = typeof value === 'string' ? value : stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const compactStreet = (street) => ({
  name: asString(street?.name),
  cards: Array.isArray(street?.cards) ? street.cards.map(asString).filter(Boolean) : [],
  lines: Array.isArray(street?.lines)
    ? street.lines.map(asString).filter((line) => line && !/^\*\*\*\s*SUMMARY\s*\*\*\*/i.test(line))
    : [],
});

export const toCompactSessionHand = (hand) => ({
  id: asString(hand?.id),
  timestamp: asFiniteNumber(hand?.timestamp),
  position: asString(hand?.position) || 'UNKNOWN',
  blinds: asString(hand?.blinds),
  smallBlind: asFiniteNumber(hand?.smallBlind),
  bigBlind: asFiniteNumber(hand?.bigBlind),
  heroStartingStack: asFiniteNumber(hand?.heroStartingStack),
  heroCards: Array.isArray(hand?.heroCards) ? hand.heroCards.map(asString).filter(Boolean) : [],
  boardCards: Array.isArray(hand?.boardCards) ? hand.boardCards.map(asString).filter(Boolean) : [],
  outcome: asString(hand?.outcome),
  heroInvestment: asFiniteNumber(hand?.heroInvestment),
  heroWinnings: asFiniteNumber(hand?.heroWinnings),
  netProfit: asFiniteNumber(hand?.netProfit),
  handRanking: asString(hand?.handRanking) || 'NO_HAND',
  streets: Array.isArray(hand?.streets)
    ? hand.streets.filter((street) => asString(street?.name).toUpperCase() !== 'SUMMARY').map(compactStreet)
    : [],
});

const getStyleId = (metrics) => metrics?.playerProfile?.style?.id || 'INSUFFICIENT';

export const buildSessionAnalysisInput = ({ sessionId, hands, gameType = 'mixed' }) => {
  const actualHands = (Array.isArray(hands) ? hands : [])
    .filter((hand) => hand && !hand.isRebuy)
    .map(toCompactSessionHand)
    .sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id));
  const metrics = calculateSessionMetrics((Array.isArray(hands) ? hands : []).filter((hand) => hand && !hand.isRebuy), gameType);
  const largestSwingHand = actualHands.reduce((largest, hand) => (
    !largest || Math.abs(hand.netProfit) > Math.abs(largest.netProfit) ? hand : largest
  ), null);
  const content = {
    sessionId: asString(sessionId),
    gameType: asString(gameType) || 'mixed',
    profileStyleId: getStyleId(metrics),
    hands: actualHands,
    largestSwingHandId: largestSwingHand?.id || '',
  };
  return {
    ...content,
    fingerprint: createSessionFingerprint(content),
  };
};

export const getSessionAnalysisInputBytes = (sessionInput) => new TextEncoder().encode(stableStringify(sessionInput)).length;

export const validateSessionAnalysisInput = (sessionInput) => {
  if (!sessionInput || typeof sessionInput !== 'object' || !asString(sessionInput.sessionId)) {
    throw new Error('Brakuje prawidłowej sesji do analizy AI.');
  }
  if (!Array.isArray(sessionInput.hands) || sessionInput.hands.length === 0) {
    throw new Error('Sesja nie zawiera prawdziwych rozdań do analizy AI.');
  }
  if (sessionInput.hands.some((hand) => !asString(hand?.id) || Object.hasOwn(hand, 'rawText'))) {
    throw new Error('Sesja zawiera nieprawidłowe dane rozdania do analizy AI.');
  }
  if (!SESSION_STYLE_IDS.includes(sessionInput.profileStyleId)) {
    throw new Error('Sesja ma nieprawidłowy lokalny profil stylu gry.');
  }
  const canonical = {
    sessionId: asString(sessionInput.sessionId),
    gameType: asString(sessionInput.gameType) || 'mixed',
    profileStyleId: sessionInput.profileStyleId,
    hands: sessionInput.hands,
    largestSwingHandId: asString(sessionInput.largestSwingHandId),
  };
  const fingerprint = createSessionFingerprint(canonical);
  if (sessionInput.fingerprint && sessionInput.fingerprint !== fingerprint) {
    throw new Error('Odcisk sesji nie odpowiada przekazanym rozdaniom.');
  }
  const bytes = getSessionAnalysisInputBytes({ ...canonical, fingerprint });
  if (bytes > SESSION_ANALYSIS_MAX_BYTES) {
    const error = new Error(`Sesja przekracza limit ${SESSION_ANALYSIS_MAX_BYTES.toLocaleString('pl-PL')} bajtów i nie będzie analizowana częściowo.`);
    error.code = 'AI_SESSION_TOO_LARGE';
    throw error;
  }
  return { ...canonical, fingerprint, bytes };
};

export const sessionAnalysisResponseSchema = {
  type: 'object',
  properties: {
    profileStyleId: { type: 'string', enum: SESSION_STYLE_IDS },
    sessionSummary: { type: 'string' },
    keyMistakes: {
      type: 'array', maxItems: 5,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' }, description: { type: 'string' }, correction: { type: 'string' },
          handIds: { type: 'array', minItems: 2, maxItems: 3, items: { type: 'string' } },
        },
        required: ['title', 'description', 'correction', 'handIds'], additionalProperties: false,
      },
    },
    notableHands: {
      type: 'array', minItems: 1, maxItems: 5,
      items: {
        type: 'object',
        properties: { handId: { type: 'string' }, reason: { type: 'string' } },
        required: ['handId', 'reason'], additionalProperties: false,
      },
    },
  },
  required: ['profileStyleId', 'sessionSummary', 'keyMistakes', 'notableHands'], additionalProperties: false,
};

export const buildSessionAnalysisPrompt = (session) => `Jesteś profesjonalnym trenerem pokera. Analizujesz całą sesję Hero po polsku.

Twarde fakty lokalne: profil stylu to ${session.profileStyleId}; wszystkie wyniki, kwoty i układy CoinPoker są prawdziwe. Analizuj decyzje, zakresy i sizing, nie oceniaj jakości gry przez sam wynik. RETURN nie jest inwestycją. Nie wymyślaj rąk ani kart. Największy bezwzględny swing ma ręka #${session.largestSwingHandId} i musi trafić do notableHands.

sessionSummary ma mieć 2–4 zdania. keyMistakes zawiera najwyżej 5 rzeczywiście powtarzalnych błędów, od najważniejszych; każdy ma 2–3 różne przykłady z listy rąk i praktyczną korektę. notableHands ma najwyżej 5 różnych rąk. Przy małej próbce stosuj ostrożny język. Zwróć wyłącznie JSON zgodny ze schematem.

Dane sesji:
${stableStringify(session)}`;

export const validateSessionAnalysis = (analysis, session) => {
  if (!analysis || typeof analysis !== 'object') throw new Error('AI nie zwróciło raportu sesji w wymaganym formacie.');
  if (analysis.profileStyleId !== session.profileStyleId) {
    throw new Error(`Analiza AI podała styl ${analysis.profileStyleId || 'brak'}, oczekiwano ${session.profileStyleId}.`);
  }
  const sentenceCount = String(analysis.sessionSummary || '').split(/[.!?]+/).filter((sentence) => sentence.trim()).length;
  if (sentenceCount < 2 || sentenceCount > 4) throw new Error('Podsumowanie sesji musi zawierać od 2 do 4 zdań.');
  const handIds = new Set(session.hands.map((hand) => hand.id));
  const mistakes = Array.isArray(analysis.keyMistakes) ? analysis.keyMistakes : [];
  const notableHands = Array.isArray(analysis.notableHands) ? analysis.notableHands : [];
  if (mistakes.length > 5 || notableHands.length === 0 || notableHands.length > 5) throw new Error('Analiza AI ma nieprawidłową liczbę elementów.');
  const mistakeTitles = new Set();
  for (const mistake of mistakes) {
    const title = asString(mistake?.title).toLocaleLowerCase('pl');
    const examples = Array.isArray(mistake?.handIds) ? mistake.handIds.map(asString) : [];
    if (!title || mistakeTitles.has(title) || examples.length < 2 || examples.length > 3 || unique(examples).length !== examples.length || examples.some((id) => !handIds.has(id))) {
      throw new Error('Analiza AI zawiera nieprawidłowy albo niepowtarzalny błąd sesji.');
    }
    mistakeTitles.add(title);
  }
  const notableIds = notableHands.map((hand) => asString(hand?.handId));
  if (unique(notableIds).length !== notableIds.length || notableIds.some((id) => !handIds.has(id))) {
    throw new Error('Analiza AI wskazuje rozdanie spoza sesji albo powtarza ważne rozdanie.');
  }
  if (!notableIds.includes(session.largestSwingHandId)) throw new Error('Analiza AI nie uwzględnia największego swingu sesji.');
  return analysis;
};
