import {
  EQUITY_CALCULATOR_VERSION,
  calculateHoldemRangeEquity,
  expandWeightedHandClass,
} from '../../src/parser/equityCalculator.js';
import { CARD_FACTS_VALIDATION_VERSION, sameDecisionCardFacts } from './decisionCardFacts.js';

export const EQUITY_RANGE_CONTRACT_VERSION = 1;
export const EQUITY_SUPPLEMENT_BATCH_LIMIT = 20;
const VALID_WEIGHTS = new Set([0.25, 0.5, 0.75, 1]);
const STREET_ORDER = new Set(['PRE_FLOP', 'FLOP', 'TURN', 'RIVER']);

export class EquitySupplementContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EquitySupplementContractError';
    this.code = code;
  }
}

const fail = (code, message) => { throw new EquitySupplementContractError(code, message); };
const asString = (value) => String(value ?? '').trim();
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const clone = (value) => JSON.parse(JSON.stringify(value));

export const isEquitySupplementEligibleSpot = (spot, answerKey) => (
  spot?.sourceStatus === 'current'
  && spot?.active === true
  && spot?.exerciseType !== 'equity_pot_odds'
  && spot?.question?.context?.opponentsInHand === 1
  && Number(spot?.question?.toCall) > 0
  && Number(spot?.question?.effectiveStack) >= Number(spot.question.toCall)
  && Array.isArray(spot.question.legalActions)
  && spot.question.legalActions.includes('call')
  && answerKey?.status === 'ready'
  && answerKey?.confidence === 'high'
  && answerKey?.contractVersion === 3
  && answerKey?.localFactsValid === true
  && answerKey?.factsValidationVersion === CARD_FACTS_VALIDATION_VERSION
  && sameDecisionCardFacts(answerKey?.decisionCardFacts, spot?.decisionCardFacts)
  && spot?.answerOptions?.some((option) => option.id === answerKey.preferredAnswer)
  && answerKey?.id === spot.currentAnswerKeyId
  && answerKey?.spotVersionId === spot.versionId
);

const minimalSpot = (spot, key) => ({
  spotVersionId: spot.versionId,
  answerKeyId: key.id,
  gameType: spot.gameType,
  street: spot.street,
  heroCards: [...spot.question.heroCards],
  board: [...spot.question.board],
  heroPosition: spot.question.heroPosition || null,
  opponentPosition: spot.question.players?.find((player) => player.playerId !== 'Hero')?.position || null,
  effectiveStack: finite(spot.question.effectiveStack),
  effectiveStackBb: finite(spot.question.effectiveStackBb),
  pot: finite(spot.question.pot),
  toCall: finite(spot.question.toCall),
  priorActions: clone(spot.question.priorActions || []),
  scenario: spot.scenario || null,
  opponentRangeHint: key.opponentRange || null,
});

export const buildEquitySupplementBatchInput = (spots, answerKeys = []) => {
  if (!Array.isArray(spots) || spots.length === 0) fail('EQUITY_SUPPLEMENT_EMPTY_BATCH', 'Partia suplementów equity jest pusta.');
  if (spots.length > EQUITY_SUPPLEMENT_BATCH_LIMIT) fail('EQUITY_SUPPLEMENT_BATCH_TOO_LARGE', `Partia suplementów może zawierać najwyżej ${EQUITY_SUPPLEMENT_BATCH_LIMIT} spotów.`);
  const keysBySpot = new Map((Array.isArray(answerKeys) ? answerKeys : []).map((key) => [key.spotVersionId, key]));
  const seen = new Set();
  const supplements = spots.map((spot) => {
    const key = keysBySpot.get(spot.versionId) || spot.currentAnswerKey;
    if (!key || !spot.versionId || seen.has(spot.versionId)) fail('EQUITY_SUPPLEMENT_INVALID_SPOT', 'Partia zawiera brakujący lub zduplikowany spot.');
    seen.add(spot.versionId);
    if (!isEquitySupplementEligibleSpot(spot, key)) fail('EQUITY_SUPPLEMENT_SPOT_NOT_ELIGIBLE', `Spot ${spot.versionId} nie kwalifikuje się do suplementu equity.`);
    if (!STREET_ORDER.has(spot.street) || spot.question.heroCards.length !== 2 || !Array.isArray(spot.question.board)) {
      fail('EQUITY_SUPPLEMENT_INVALID_STATE', `Spot ${spot.versionId} ma nieprawidłowy stan.`);
    }
    return minimalSpot(spot, key);
  });
  return { contractVersion: EQUITY_RANGE_CONTRACT_VERSION, calculatorVersion: EQUITY_CALCULATOR_VERSION, supplements };
};

export const equitySupplementResponseSchema = Object.freeze({
  type: 'object',
  properties: {
    supplements: {
      type: 'array', maxItems: EQUITY_SUPPLEMENT_BATCH_LIMIT,
      items: {
        type: 'object',
        properties: {
          spotVersionId: { type: 'string' },
          opponentRange: { type: 'array', maxItems: 169, items: {
            type: 'object', properties: { handClass: { type: 'string' }, weight: { type: 'number', enum: [0.25, 0.5, 0.75, 1] } },
            required: ['handClass', 'weight'], additionalProperties: false,
          } },
        },
        required: ['spotVersionId', 'opponentRange'], additionalProperties: false,
      },
    },
  },
  required: ['supplements'], additionalProperties: false,
});

export const validateEquitySupplementBatch = (response, input) => {
  if (!response || !Array.isArray(response.supplements)) fail('EQUITY_SUPPLEMENT_RESPONSE_INVALID', 'AI nie zwróciło tablicy suplementów.');
  if (response.supplements.length > EQUITY_SUPPLEMENT_BATCH_LIMIT) fail('EQUITY_SUPPLEMENT_RESPONSE_TOO_LARGE', 'AI zwróciło zbyt wiele suplementów.');
  const expected = new Map((input?.supplements || []).map((item) => [item.spotVersionId, item]));
  const seen = new Set();
  const valid = [];
  const rejected = [];
  response.supplements.forEach((candidate) => {
    const id = asString(candidate?.spotVersionId);
    const source = expected.get(id);
    const errors = [];
    if (!source || seen.has(id)) errors.push('Nieznany lub zduplikowany spotVersionId.');
    seen.add(id);
    const range = Array.isArray(candidate?.opponentRange) ? candidate.opponentRange : [];
    const classes = new Set();
    if (range.length === 0 || range.length > 169) errors.push('Zakres rywala nie może być pusty.');
    range.forEach((entry) => {
      const handClass = asString(entry?.handClass).toUpperCase();
      const weight = Number(entry?.weight);
      if (classes.has(handClass)) errors.push('Zakres zawiera duplikat klasy rąk.');
      classes.add(handClass);
      if (!VALID_WEIGHTS.has(weight)) errors.push('Zakres zawiera niedozwoloną wagę.');
      try {
        expandWeightedHandClass({ handClass, weight }, [...(source?.heroCards || []), ...(source?.board || [])]);
      } catch (error) { errors.push(error.message); }
    });
    if (errors.length) rejected.push({ spotVersionId: id, errors });
    else valid.push({ spotVersionId: id, opponentRange: range.map(({ handClass, weight }) => ({ handClass: String(handClass).toUpperCase(), weight: Number(weight) })) });
  });
  expected.forEach((_source, id) => { if (!seen.has(id)) rejected.push({ spotVersionId: id, errors: ['AI nie zwróciło suplementu dla spotu.'] }); });
  return { valid, rejected };
};

export const calculateEquitySupplement = (spot, opponentRange) => calculateHoldemRangeEquity({
  heroCards: spot.heroCards,
  opponentRange,
  boardCards: spot.board,
});
