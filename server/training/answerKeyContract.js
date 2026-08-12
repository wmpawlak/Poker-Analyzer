import { classifyHeroHand, HERO_HAND_CLASSES } from './heroHandClassifier.js';
import {
  CARD_FACTS_VALIDATION_VERSION,
  CARD_SUITS,
  FLUSH_STATUSES,
  MADE_HANDS,
  computeDecisionCardFacts,
  sameDecisionCardFacts,
} from './decisionCardFacts.js';

export { CARD_FACTS_VALIDATION_VERSION, computeDecisionCardFacts };

export const TRAINING_ANSWER_KEY_CONTRACT_VERSION = 3;
export const TRAINING_ANSWER_KEY_BATCH_LIMIT = 20;

const CONFIDENCE_LEVELS = new Set(['high', 'medium', 'low']);
const SIZING_ACTIONS = new Set(['none', 'check', 'fold', 'call', 'bet', 'raise']);
const PASSIVE_ACTIONS = new Set(['check', 'fold', 'call']);
const STREET_ORDER = Object.freeze({ PRE_FLOP: 0, FLOP: 1, TURN: 2, RIVER: 3 });
const EXPECTED_BOARD_CARDS = Object.freeze({ PRE_FLOP: 0, FLOP: 3, TURN: 4, RIVER: 5 });

export class TrainingAnswerKeyContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TrainingAnswerKeyContractError';
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new TrainingAnswerKeyContractError(code, message);
};

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const asString = (value) => String(value ?? '').trim();
const finiteOrZero = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const optionalString = (value) => asString(value) || null;
const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const sanitizePlayers = (players) => (Array.isArray(players) ? players : []).map((player) => ({
  playerId: asString(player?.playerId),
  seat: finiteOrZero(player?.seat),
  position: asString(player?.position),
  startingStack: finiteOrZero(player?.startingStack),
  stack: finiteOrZero(player?.stack),
  invested: finiteOrZero(player?.invested),
  folded: Boolean(player?.folded),
  allIn: Boolean(player?.allIn),
}));

const sanitizePriorActions = (actions) => (Array.isArray(actions) ? actions : []).map((action) => ({
  street: asString(action?.street),
  actor: asString(action?.actor),
  type: asString(action?.type),
  amount: finiteOrZero(action?.amount),
  toAmount: finiteOrZero(action?.toAmount),
  allIn: Boolean(action?.allIn),
  forced: Boolean(action?.forced),
}));

const sanitizeEffectiveStacks = (values) => (Array.isArray(values) ? values : []).map((value) => ({
  playerId: asString(value?.playerId),
  amount: finiteOrZero(value?.amount),
  amountBb: finiteOrZero(value?.amountBb),
  behind: finiteOrZero(value?.behind),
  behindBb: finiteOrZero(value?.behindBb),
}));

const sanitizeQuestion = (question) => ({
  street: asString(question?.street),
  heroCards: Array.isArray(question?.heroCards) ? question.heroCards.map(asString).filter(Boolean) : [],
  board: Array.isArray(question?.board) ? question.board.map(asString).filter(Boolean) : [],
  heroPosition: asString(question?.heroPosition),
  blinds: {
    smallBlind: finiteOrZero(question?.blinds?.smallBlind),
    bigBlind: finiteOrZero(question?.blinds?.bigBlind),
    ante: finiteOrZero(question?.blinds?.ante),
  },
  pot: finiteOrZero(question?.pot),
  toCall: finiteOrZero(question?.toCall),
  potOdds: finiteOrZero(question?.potOdds),
  effectiveStack: finiteOrZero(question?.effectiveStack),
  effectiveStackBb: finiteOrZero(question?.effectiveStackBb),
  effectiveStackBehind: finiteOrZero(question?.effectiveStackBehind),
  effectiveStackBehindBb: finiteOrZero(question?.effectiveStackBehindBb),
  effectiveStackByOpponent: sanitizeEffectiveStacks(question?.effectiveStackByOpponent),
  players: sanitizePlayers(question?.players),
  priorActions: sanitizePriorActions(question?.priorActions),
  legalActions: Array.isArray(question?.legalActions)
    ? [...new Set(question.legalActions.map(asString).filter(Boolean))]
    : [],
  context: {
    opponentsInHand: finiteOrZero(question?.context?.opponentsInHand),
    preflopRaiseCount: finiteOrZero(question?.context?.preflopRaiseCount),
    facingRaiseLevel: finiteOrZero(question?.context?.facingRaiseLevel),
    isFacingReraise: Boolean(question?.context?.isFacingReraise),
    isFacingReshove: Boolean(question?.context?.isFacingReshove),
  },
});

const sanitizeAnswerOptions = (options) => (Array.isArray(options) ? options : []).map((option) => ({
  id: asString(option?.id),
  action: asString(option?.action),
  category: optionalString(option?.category),
  maximumPotRatio: Number.isFinite(Number(option?.maximumPotRatio))
    ? Number(option.maximumPotRatio)
    : null,
  minimumPotRatioExclusive: Number.isFinite(Number(option?.minimumPotRatioExclusive))
    ? Number(option.minimumPotRatioExclusive)
    : null,
}));

const sanitizeSuitCounts = (counts) => Object.fromEntries(
  CARD_SUITS.map((suit) => [suit, Number.isInteger(Number(counts?.[suit])) ? Number(counts[suit]) : 0]),
);

const sanitizeDecisionCardFacts = (facts) => ({
  madeHand: asString(facts?.madeHand),
  flushStatus: asString(facts?.flushStatus),
  cardsToCome: Number.isInteger(Number(facts?.cardsToCome)) ? Number(facts.cardsToCome) : -1,
  suitCounts: {
    hero: sanitizeSuitCounts(facts?.suitCounts?.hero),
    board: sanitizeSuitCounts(facts?.suitCounts?.board),
  },
});

const sanitizeSpot = (spot) => {
  const spotVersionId = asString(spot?.versionId || spot?.spotVersionId);
  const exerciseType = asString(spot?.exerciseType);
  const answerOptions = sanitizeAnswerOptions(spot?.answerOptions);
  const question = sanitizeQuestion(spot?.question);
  const heroHand = classifyHeroHand(question.heroCards);
  if (!spotVersionId || !exerciseType || !isObject(spot?.question)) {
    fail('TRAINING_AI_INVALID_SPOT', 'Spot do analizy AI nie ma wymaganych danych.');
  }
  const optionIds = answerOptions.map(({ id }) => id);
  if (answerOptions.length === 0 || optionIds.some((id) => !id)
    || new Set(optionIds).size !== optionIds.length
    || answerOptions.some(({ action }) => !action || !question.legalActions.includes(action))) {
    fail('TRAINING_AI_INVALID_OPTIONS', `Spot ${spotVersionId} ma nieprawidłowe lokalne odpowiedzi.`);
  }
  if (!(question.street in STREET_ORDER)
    || question.street !== asString(spot?.street || question.street)
    || question.heroCards.length !== 2
    || !heroHand
    || question.board.length !== EXPECTED_BOARD_CARDS[question.street]
    || question.priorActions.some((action) => (
      !(action.street in STREET_ORDER) || STREET_ORDER[action.street] > STREET_ORDER[question.street]
    ))) {
    fail('TRAINING_AI_INVALID_STATE', `Spot ${spotVersionId} nie jest spójnym stanem sprzed decyzji.`);
  }
  const decisionCardFacts = computeDecisionCardFacts({
    heroCards: question.heroCards,
    board: question.board,
  });
  return {
    spotVersionId,
    exerciseType,
    heroHand,
    decisionCardFacts,
    factsValidationVersion: CARD_FACTS_VALIDATION_VERSION,
    gameType: asString(spot?.gameType),
    stage: optionalString(spot?.stage),
    scenario: optionalString(spot?.scenario),
    usesHistoricalLine: Boolean(spot?.usesHistoricalLine),
    continuationNotice: optionalString(spot?.continuationNotice),
    question,
    answerOptions,
    actionByCategory: isObject(spot?.actionByCategory)
      ? Object.fromEntries(Object.entries(spot.actionByCategory).map(([key, value]) => [asString(key), asString(value)]))
      : {},
  };
};

export const buildTrainingAnswerKeyBatchInput = (spots) => {
  if (!Array.isArray(spots) || spots.length === 0) {
    fail('TRAINING_AI_EMPTY_BATCH', 'Partia AI musi zawierać co najmniej jeden spot.');
  }
  if (spots.length > TRAINING_ANSWER_KEY_BATCH_LIMIT) {
    fail(
      'TRAINING_AI_BATCH_TOO_LARGE',
      `Jedno żądanie AI może zawierać najwyżej ${TRAINING_ANSWER_KEY_BATCH_LIMIT} spotów.`,
    );
  }
  const sanitized = spots.map(sanitizeSpot);
  const ids = sanitized.map(({ spotVersionId }) => spotVersionId);
  if (new Set(ids).size !== ids.length) {
    fail('TRAINING_AI_DUPLICATE_SPOT', 'Partia AI zawiera powtórzony spot.');
  }
  return { contractVersion: TRAINING_ANSWER_KEY_CONTRACT_VERSION, spots: sanitized };
};

const suitCountsSchema = {
  type: 'object',
  properties: Object.fromEntries(CARD_SUITS.map((suit) => [suit, { type: 'integer', minimum: 0, maximum: 5 }])),
  required: [...CARD_SUITS],
  additionalProperties: false,
};

const decisionCardFactsSchema = {
  type: 'object',
  properties: {
    madeHand: { type: 'string', enum: MADE_HANDS },
    flushStatus: { type: 'string', enum: FLUSH_STATUSES },
    cardsToCome: { type: 'integer', minimum: 0, maximum: 5 },
    suitCounts: {
      type: 'object',
      properties: { hero: suitCountsSchema, board: suitCountsSchema },
      required: ['hero', 'board'],
      additionalProperties: false,
    },
  },
  required: ['madeHand', 'flushStatus', 'cardsToCome', 'suitCounts'],
  additionalProperties: false,
};

export const trainingAnswerKeyResponseSchema = {
  type: 'object',
  properties: {
    keys: {
      type: 'array', minItems: 1, maxItems: TRAINING_ANSWER_KEY_BATCH_LIMIT,
      items: {
        type: 'object',
        properties: {
          spotVersionId: { type: 'string' },
          heroHand: {
            type: 'object',
            properties: {
              notation: { type: 'string' },
              class: { type: 'string', enum: HERO_HAND_CLASSES },
            },
            required: ['notation', 'class'],
            additionalProperties: false,
          },
          decisionCardFacts: decisionCardFactsSchema,
          factsValidationVersion: { type: 'integer', const: CARD_FACTS_VALIDATION_VERSION },
          preferredAnswer: { type: 'string' },
          acceptableAlternatives: {
            type: 'array', maxItems: 10, items: { type: 'string' },
          },
          confidence: { type: 'string', enum: [...CONFIDENCE_LEVELS] },
          rationale: { type: 'string' },
          blockersEquity: { type: 'string' },
          opponentRange: { type: 'string' },
          suggestedSizing: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: [...SIZING_ACTIONS] },
              potRatio: { type: 'number', minimum: 0, maximum: 20 },
              raiseToBb: { type: 'number', minimum: 0, maximum: 1_000 },
            },
            required: ['action', 'potRatio', 'raiseToBb'],
            additionalProperties: false,
          },
        },
        required: [
          'spotVersionId', 'heroHand', 'decisionCardFacts', 'factsValidationVersion',
          'preferredAnswer', 'acceptableAlternatives', 'confidence',
          'rationale', 'blockersEquity', 'opponentRange', 'suggestedSizing',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['keys'],
  additionalProperties: false,
};

export const buildTrainingAnswerKeyPrompt = (input) => `Jesteś profesjonalnym trenerem NLH. Przygotuj klucze odpowiedzi po polsku.

Otrzymujesz wyłącznie stan sprzed decyzji. Nie zgaduj wyniku rozdania, kart rywali, dalszego boardu, późniejszych akcji ani faktycznej decyzji Hero. Lokalne wartości puli, pot odds, stacków, legalnych odpowiedzi, mapowania kategorii na akcje i progów sizingu są autorytatywne — nie poprawiaj ich. Autorytatywne są również decisionCardFacts, madeHand, flushStatus, cardsToCome i suitCounts; przepisz je bez zmian. Cztery karty jednego koloru nie tworzą jeszcze flusha, a trzy karty jednego koloru nie są bezpośrednim flush drawem — przy dwóch kartach do wyłożenia mogą oznaczać wyłącznie backdoor_draw. Cztery karty jednego koloru na riverze nie są drawem, bo cardsToCome wynosi zero. Oceniasz wyłącznie strategię.

Dla każdego spotVersionId zwróć dokładnie jeden klucz i przepisz bez zmian autorytatywne heroHand, decisionCardFacts oraz factsValidationVersion. Nie przypisuj Hero koloru ani flush draw, jeśli nie wynika to z decisionCardFacts; możesz natomiast opisywać kolor lub draw w zakresie rywala. preferredAnswer i acceptableAlternatives muszą być identyfikatorami z answerOptions danego spotu. Alternatywy mają być rzeczywiście sensowne, nie mogą zawierać odpowiedzi preferowanej. confidence=high stosuj tylko wtedy, gdy rekomendacja jest jednoznaczna bez danych o rywalu. suggestedSizing.action musi odpowiadać akcji odpowiedzi preferowanej; dla braku sizingu ustaw liczby na 0. Dla small_bet potRatio musi być <=0.4, a dla large_bet >0.4. Zwróć wyłącznie JSON zgodny ze schematem.

Dane spotów:
${JSON.stringify(input)}`;

const validateText = (value, label, maximumLength) => {
  const text = asString(value);
  if (!text || text.length > maximumLength) return `${label} ma nieprawidłową treść.`;
  return null;
};

const validateSizing = (sizing, option) => {
  if (!isObject(sizing)) return 'Brakuje sugerowanego sizingu.';
  const action = asString(sizing.action);
  const potRatio = Number(sizing.potRatio);
  const raiseToBb = Number(sizing.raiseToBb);
  if (!SIZING_ACTIONS.has(action) || !Number.isFinite(potRatio) || !Number.isFinite(raiseToBb)
    || potRatio < 0 || potRatio > 20 || raiseToBb < 0 || raiseToBb > 1_000) {
    return 'Sugerowany sizing ma nieprawidłowe wartości.';
  }
  if (action !== option.action) return 'Sugerowany sizing nie odpowiada preferowanej akcji.';
  if (PASSIVE_ACTIONS.has(action) && (potRatio !== 0 || raiseToBb !== 0)) {
    return 'Akcja pasywna nie może zawierać sizingu.';
  }
  if (action === 'bet' && !(potRatio > 0)) return 'Bet wymaga dodatniego udziału puli.';
  if (action === 'raise' && !(potRatio > 0 || raiseToBb > 0)) return 'Raise wymaga dodatniego sizingu.';
  if (option.maximumPotRatio !== null && potRatio > option.maximumPotRatio + Number.EPSILON) {
    return 'Sizing przekracza lokalny próg małego beta.';
  }
  if (option.minimumPotRatioExclusive !== null && potRatio <= option.minimumPotRatioExclusive) {
    return 'Sizing nie przekracza lokalnego progu dużego beta.';
  }
  return null;
};

const HERO_REFERENCES = /\b(?:hero|you|ty|twoja(?:\s+ręka)?|ręka\s+hero)\b/i;
const FLUSH_DRAW_WORDS = /\b(?:flush\s+draw|draw\s+(?:do|w)\s+koloru|draw\s+kolorowy|backdoor\s+flush\s+draw)\b/i;
const MADE_FLUSH_WORDS = /\b(?:ma|masz|has|have|holds|posiada|posiadasz)\s+(?:a\s+)?(?:flush|kolor)\b|\b(?:ma|masz|has|have|holds|posiada|posiadasz)\s+kolor\b/i;
const NEGATION_WORDS = /\b(?:nie|bez|brak|not|no|without|doesn['’]?t|does\s+not)\b/i;
const OTHER_PLAYER_REFERENCES = /\b(?:rywal|rywala|przeciwnik|przeciwnika|villain|opponent)\b/i;

const hasHeroCardClaim = (text, expression) => String(text || '').split(/[.!?;]+/).some((sentence) => {
  const heroMatch = sentence.match(HERO_REFERENCES);
  const termMatch = sentence.match(expression);
  if (!heroMatch || !termMatch || termMatch.index < heroMatch.index) return false;
  const claimText = sentence.slice(heroMatch.index, termMatch.index);
  return !NEGATION_WORDS.test(claimText) && !OTHER_PLAYER_REFERENCES.test(claimText);
});

const CARD_PAIR_REFERENCE = /\b(?:[2-9TJQKA][cdhs]){2}\b/i;
const ADDITIONAL_MADE_FLUSH_WORDS = /\b(?:nut(?:owy)?|gotow(?:y|a|e)|królewski|wysoki|niski|q-high|k-high)\s+(?:flush|kolor)\b/i;
const hasImplicitCardClaim = (text, expression) => String(text || '').split(/[.!?;]+/).some((sentence) => {
  if (!CARD_PAIR_REFERENCE.test(sentence) || OTHER_PLAYER_REFERENCES.test(sentence)) return false;
  return expression.test(sentence) && !(/\b(?:bez|brak|nie ma|not|without)\b/i.test(sentence)
    && !/\b(?:ma|posiada|daje|tworzy|draw)\b/i.test(sentence));
});

export const validateHeroCardDescription = (candidate, facts) => {
  const descriptions = [candidate.rationale, candidate.blockersEquity];
  const claimsFlushDraw = descriptions.some((text) => (
    hasHeroCardClaim(text, FLUSH_DRAW_WORDS) || hasImplicitCardClaim(text, FLUSH_DRAW_WORDS)
  ));
  const claimsMadeFlush = descriptions.some((text) => (
    hasHeroCardClaim(text, MADE_FLUSH_WORDS)
      || hasHeroCardClaim(text, ADDITIONAL_MADE_FLUSH_WORDS)
      || hasImplicitCardClaim(text, MADE_FLUSH_WORDS)
      || hasImplicitCardClaim(text, ADDITIONAL_MADE_FLUSH_WORDS)
  ));
  const claimsBackdoor = descriptions.some((text) => hasHeroCardClaim(
    text,
    /\bbackdoor(?:\s+flush)?\s+draw\b/i,
  ));
  const claimsDirect = descriptions.some((text) => hasHeroCardClaim(
    text,
    /\b(?:direct|bezpośredni|bezpośrednie)\s+(?:flush\s+)?draw\b/i,
  ));

  if (facts.flushStatus === 'none' && (claimsFlushDraw || claimsMadeFlush)) {
    return 'Uzasadnienie przypisuje Hero kolor lub draw do koloru, którego nie potwierdzają autorytatywne fakty.';
  }
  if (facts.flushStatus === 'draw' && (claimsMadeFlush || claimsBackdoor)) {
    return 'Uzasadnienie opisuje Hero jako mającego gotowy kolor albo backdoor draw zamiast lokalnego draw.';
  }
  if (facts.flushStatus === 'backdoor_draw' && (claimsMadeFlush || claimsDirect)) {
    return 'Uzasadnienie przypisuje Hero gotowy kolor albo bezpośredni draw, choć lokalnie jest to backdoor draw.';
  }
  if (facts.flushStatus === 'made' && claimsFlushDraw) {
    return 'Uzasadnienie opisuje gotowy kolor Hero jako flush draw.';
  }
  return null;
};

const validateOneKey = (candidate, spot) => {
  const errors = [];
  if (!isObject(candidate)) return { errors: ['Klucz ma nieprawidłowy format.'] };
  const options = new Map(spot.answerOptions.map((option) => [option.id, option]));
  const preferredAnswer = asString(candidate.preferredAnswer);
  const acceptableAlternatives = Array.isArray(candidate.acceptableAlternatives)
    ? candidate.acceptableAlternatives.map(asString)
    : [];
  const confidence = asString(candidate.confidence);
  const returnedHeroHand = candidate.heroHand;
  const returnedCardFacts = sanitizeDecisionCardFacts(candidate.decisionCardFacts);
  if (!isObject(returnedHeroHand)
    || asString(returnedHeroHand.notation) !== spot.heroHand.notation
    || asString(returnedHeroHand.class) !== spot.heroHand.class) {
    errors.push('Rozpoznanie ręki Hero nie zgadza się z autorytatywnymi kartami.');
  }
  if (asString(candidate.factsValidationVersion) !== String(CARD_FACTS_VALIDATION_VERSION)
    || !sameDecisionCardFacts(returnedCardFacts, spot.decisionCardFacts)) {
    errors.push('decisionCardFacts nie zgadzają się z lokalnym wyliczeniem stanu sprzed decyzji.');
  }
  if (!options.has(preferredAnswer)) errors.push('Preferowana odpowiedź nie jest lokalnie legalna.');
  if (!Array.isArray(candidate.acceptableAlternatives)
    || acceptableAlternatives.some((answer) => !options.has(answer))
    || new Set(acceptableAlternatives).size !== acceptableAlternatives.length
    || acceptableAlternatives.includes(preferredAnswer)) {
    errors.push('Dopuszczalne alternatywy są nieprawidłowe.');
  }
  if (!CONFIDENCE_LEVELS.has(confidence)) errors.push('Poziom pewności jest nieprawidłowy.');
  [
    validateText(candidate.rationale, 'Uzasadnienie', 4_000),
    validateText(candidate.blockersEquity, 'Opis blockerów/equity', 2_000),
    validateText(candidate.opponentRange, 'Zakres rywala', 2_000),
  ].filter(Boolean).forEach((error) => errors.push(error));
  const opposingNotation = spot.heroHand.class === 'pair'
    ? null
    : `${spot.heroHand.notation.slice(0, -1)}${spot.heroHand.class === 'suited' ? 'o' : 's'}`;
  if (opposingNotation && [candidate.rationale, candidate.blockersEquity].some((value) => (
    new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(opposingNotation)}([^A-Za-z0-9]|$)`, 'i').test(asString(value))
  ))) {
    errors.push(`Uzasadnienie opisuje rękę Hero jako ${opposingNotation}, choć autorytatywne karty tworzą ${spot.heroHand.notation}.`);
  }
  const cardDescriptionError = validateHeroCardDescription(candidate, spot.decisionCardFacts);
  if (cardDescriptionError) errors.push(cardDescriptionError);
  const preferredOption = options.get(preferredAnswer);
  if (preferredOption) {
    const sizingError = validateSizing(candidate.suggestedSizing, preferredOption);
    if (sizingError) errors.push(sizingError);
  }
  if (errors.length > 0) return { errors };
  return {
    errors: [],
    key: {
      spotVersionId: spot.spotVersionId,
      heroHand: { ...spot.heroHand },
      decisionCardFacts: JSON.parse(JSON.stringify(spot.decisionCardFacts)),
      factsValidationVersion: CARD_FACTS_VALIDATION_VERSION,
      status: confidence === 'high' ? 'ready' : 'review',
      confidence,
      localFactsValid: true,
      contractVersion: TRAINING_ANSWER_KEY_CONTRACT_VERSION,
      preferredAnswer,
      acceptableAlternatives,
      rationale: asString(candidate.rationale),
      blockersEquity: asString(candidate.blockersEquity),
      opponentRange: asString(candidate.opponentRange),
      suggestedSizing: {
        action: asString(candidate.suggestedSizing.action),
        potRatio: Number(candidate.suggestedSizing.potRatio),
        raiseToBb: Number(candidate.suggestedSizing.raiseToBb),
      },
    },
  };
};

export const validateTrainingAnswerKeyBatch = (response, input) => {
  const spots = Array.isArray(input?.spots) ? input.spots : [];
  const requestedIds = new Set(spots.map(({ spotVersionId }) => spotVersionId));
  const candidates = Array.isArray(response?.keys) ? response.keys : [];
  const grouped = new Map();
  const unknownResults = [];
  candidates.forEach((candidate) => {
    const id = asString(candidate?.spotVersionId);
    if (!requestedIds.has(id)) {
      unknownResults.push(id || null);
      return;
    }
    const values = grouped.get(id) || [];
    values.push(candidate);
    grouped.set(id, values);
  });

  const validKeys = [];
  const rejected = [];
  spots.forEach((spot) => {
    const values = grouped.get(spot.spotVersionId) || [];
    if (values.length === 0) {
      rejected.push({ spotVersionId: spot.spotVersionId, code: 'missing', errors: ['AI nie zwróciło klucza dla spotu.'] });
      return;
    }
    if (values.length > 1) {
      rejected.push({ spotVersionId: spot.spotVersionId, code: 'duplicate', errors: ['AI zwróciło więcej niż jeden klucz dla spotu.'] });
      return;
    }
    const validated = validateOneKey(values[0], spot);
    if (validated.errors.length > 0) {
      rejected.push({ spotVersionId: spot.spotVersionId, code: 'invalid', errors: validated.errors });
      return;
    }
    validKeys.push(validated.key);
  });
  return { validKeys, rejected, unknownResults };
};

export const createRejectedAnswerKey = ({
  spotVersionId,
  heroHand = null,
  decisionCardFacts = null,
  errors,
}) => ({
  spotVersionId,
  status: 'review',
  confidence: 'low',
  localFactsValid: false,
  contractVersion: TRAINING_ANSWER_KEY_CONTRACT_VERSION,
  heroHand,
  decisionCardFacts: decisionCardFacts ? JSON.parse(JSON.stringify(decisionCardFacts)) : null,
  factsValidationVersion: CARD_FACTS_VALIDATION_VERSION,
  preferredAnswer: null,
  acceptableAlternatives: [],
  rationale: 'Klucz AI nie przeszedł walidacji lokalnej i wymaga ponownej analizy.',
  blockersEquity: '',
  opponentRange: '',
  suggestedSizing: { action: 'none', potRatio: 0, raiseToBb: 0 },
  validationErrors: Array.isArray(errors) ? errors.map(asString).filter(Boolean).slice(0, 10) : [],
});
