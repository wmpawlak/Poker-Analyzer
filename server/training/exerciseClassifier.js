import { EXERCISE_TYPES } from '../../src/training/trainingTypes.js';
import { classifyHeroHand } from './heroHandClassifier.js';

export { EXERCISE_TYPES };
export { classifyHeroHand };

export const CBET_SIZING = Object.freeze({
  CHECK: 'check',
  SMALL_BET: 'small_bet',
  LARGE_BET: 'large_bet',
});

const STREET_ORDER = Object.freeze({ PRE_FLOP: 0, FLOP: 1, TURN: 2, RIVER: 3 });
const PREFLOP_ANSWERS = new Set(['fold', 'call', 'raise']);
const AGGRESSIVE_ACTIONS = new Set(['bet', 'raise']);

const compareSpots = (left, right) => {
  const handComparison = String(left.handId).localeCompare(String(right.handId));
  if (handComparison !== 0) return handComparison;
  const streetComparison = (STREET_ORDER[left.street] ?? 99) - (STREET_ORDER[right.street] ?? 99);
  if (streetComparison !== 0) return streetComparison;
  return (Number(left.actionOrder) || 0) - (Number(right.actionOrder) || 0);
};

const groupByHand = (spots) => {
  const groups = new Map();
  [...new Map((Array.isArray(spots) ? spots : [])
    .filter((spot) => spot?.id && spot?.handId && spot?.historicalAction)
    .map((spot) => [spot.id, spot])).values()]
    .sort(compareSpots)
    .forEach((spot) => {
      const group = groups.get(spot.handId) || [];
      group.push(spot);
      groups.set(spot.handId, group);
    });
  return groups;
};

const createQuestion = (spot) => {
  const question = { ...spot };
  delete question.historicalAction;
  return question;
};

const createCandidate = (spot, exerciseType, values = {}) => ({
  id: `${spot.id}:${exerciseType}`,
  exerciseType,
  sourceDecisionId: spot.id,
  handId: spot.handId,
  street: spot.street,
  question: createQuestion(spot),
  heroHand: classifyHeroHand(spot.question?.heroCards),
  historicalAnswer: { ...spot.historicalAction },
  ...values,
});

const toActionOptions = (spot, allowed) => (spot.legalActions || [])
  .filter((action) => allowed.has(action))
  .map((action) => ({ id: action, action }));

const getPreflopRaises = (spot) => (spot.priorActions || [])
  .map((action, index) => ({ action, index }))
  .filter(({ action }) => action.street === 'PRE_FLOP' && action.type === 'raise' && !action.forced);

const classifyReraiseScenario = (spot) => {
  if (spot.street !== 'PRE_FLOP' || Number(spot.toCall) <= 0) return null;
  const raises = getPreflopRaises(spot);
  const lastHeroRaise = raises.filter(({ action }) => action.actor === 'Hero').at(-1);
  const lastRaise = raises.at(-1);
  if (!lastHeroRaise || !lastRaise || lastRaise.index <= lastHeroRaise.index
    || lastRaise.action.actor === 'Hero') return null;

  if (lastRaise.action.allIn) return 'raise_vs_reshove';
  const raisesBeforeHero = raises.filter(({ index }) => index < lastHeroRaise.index);
  return raisesBeforeHero.length === 0 && raises.indexOf(lastHeroRaise) === 0
    ? 'open_vs_3bet'
    : null;
};

const getLastPreflopAggressor = (spot) => getPreflopRaises(spot).at(-1)?.action.actor || null;

const getStreetActions = (spot, street) => (spot.priorActions || [])
  .filter((action) => action.street === street && !action.forced);

const isFlopCbetOpportunity = (spot) => spot.street === 'FLOP'
  && Number(spot.toCall) === 0
  && getLastPreflopAggressor(spot) === 'Hero'
  && !getStreetActions(spot, 'FLOP').some((action) => AGGRESSIVE_ACTIONS.has(action.type));

export const classifyCbetSizing = (action, pot) => {
  if (action?.type === 'check') return {
    answer: CBET_SIZING.CHECK,
    betToPotRatio: 0,
  };
  if (!AGGRESSIVE_ACTIONS.has(action?.type) || !(Number(pot) > 0)) return null;
  const ratio = Number(action.amount) / Number(pot);
  return {
    answer: ratio <= 0.4 + Number.EPSILON ? CBET_SIZING.SMALL_BET : CBET_SIZING.LARGE_BET,
    betToPotRatio: Number(ratio.toFixed(6)),
  };
};

const createCbetCandidate = (spot, episodeId, stage, sequenceLength) => {
  const sizing = classifyCbetSizing(spot.historicalAction, spot.pot);
  return createCandidate(spot, EXERCISE_TYPES.CBET_BARRELS, {
    id: `${episodeId}:${stage}`,
    episodeId,
    stage,
    sequenceIndex: stage === 'flop' ? 1 : 2,
    sequenceLength,
    answerOptions: [
      { id: CBET_SIZING.CHECK, action: 'check' },
      { id: CBET_SIZING.SMALL_BET, action: 'bet', maximumPotRatio: 0.4 },
      { id: CBET_SIZING.LARGE_BET, action: 'bet', minimumPotRatioExclusive: 0.4 },
    ],
    historicalAnswer: {
      ...spot.historicalAction,
      sizing: sizing?.answer || null,
      betToPotRatio: sizing?.betToPotRatio ?? null,
    },
    usesHistoricalLine: stage === 'turn',
    continuationNotice: stage === 'turn'
      ? 'Etap turn jest dalszym ciągiem historycznej linii rozdania, a nie symulacją odpowiedzi z etapu flop.'
      : null,
  });
};

const isTurnBarrelOpportunity = (spot, flopSpot) => {
  if (spot.street !== 'TURN' || Number(spot.toCall) !== 0
    || flopSpot.historicalAction.type !== 'bet'
    || getLastPreflopAggressor(spot) !== 'Hero') return false;
  const flopActions = getStreetActions(spot, 'FLOP');
  const heroBetIndex = flopActions.findIndex((action) => action.actor === 'Hero' && action.type === 'bet');
  if (heroBetIndex < 0) return false;
  if (flopActions.slice(heroBetIndex + 1)
    .some((action) => action.actor !== 'Hero' && action.type === 'raise')) return false;
  return !getStreetActions(spot, 'TURN').some((action) => AGGRESSIVE_ACTIONS.has(action.type));
};

const createTurnRiverOptions = (spot) => {
  const legal = new Set(spot.legalActions || []);
  const options = [];
  if (legal.has('check')) options.push({ id: 'check', category: 'check', action: 'check' });
  if (legal.has('fold')) options.push({ id: 'fold', category: 'fold', action: 'fold' });
  if (legal.has('call')) options.push({ id: 'bluff_catcher', category: 'bluff_catcher', action: 'call' });
  const aggressiveAction = legal.has('bet') ? 'bet' : legal.has('raise') ? 'raise' : null;
  if (aggressiveAction) {
    options.push({ id: 'value_bet', category: 'value_bet', action: aggressiveAction });
    options.push({ id: 'bluff', category: 'bluff', action: aggressiveAction });
  }
  return options;
};

const createTurnRiverCandidate = (spot) => {
  const answerOptions = createTurnRiverOptions(spot);
  return createCandidate(spot, EXERCISE_TYPES.TURN_RIVER, {
    answerOptions,
    actionByCategory: Object.fromEntries(answerOptions.map(({ category, action }) => [category, action])),
    requiresStrategicCategory: ['call', 'bet', 'raise'].includes(spot.historicalAction.type),
  });
};

export const classifyTrainingSpots = (spots) => {
  const pools = {
    [EXERCISE_TYPES.PREFLOP_SELECTION]: [],
    [EXERCISE_TYPES.PREFLOP_VS_RERAISE]: [],
    [EXERCISE_TYPES.CBET_BARRELS]: [],
    [EXERCISE_TYPES.TURN_RIVER]: [],
  };

  for (const handSpots of groupByHand(spots).values()) {
    const preflopSpots = handSpots.filter((spot) => spot.street === 'PRE_FLOP');
    const firstPreflop = preflopSpots[0];
    if (firstPreflop && PREFLOP_ANSWERS.has(firstPreflop.historicalAction.type)) {
      pools.preflop_selection.push(createCandidate(firstPreflop, EXERCISE_TYPES.PREFLOP_SELECTION, {
        answerOptions: toActionOptions(firstPreflop, PREFLOP_ANSWERS),
      }));
    }

    preflopSpots.forEach((spot) => {
      const scenario = classifyReraiseScenario(spot);
      if (!scenario) return;
      pools.preflop_vs_reraise.push(createCandidate(spot, EXERCISE_TYPES.PREFLOP_VS_RERAISE, {
        scenario,
        answerOptions: toActionOptions(spot, PREFLOP_ANSWERS),
        effectiveStackBb: spot.effectiveStackBb,
        potOdds: spot.potOdds,
      }));
    });

    const flopSpot = handSpots.find(isFlopCbetOpportunity);
    if (flopSpot) {
      const turnSpot = flopSpot.historicalAction.type === 'bet'
        ? handSpots.find((spot) => isTurnBarrelOpportunity(spot, flopSpot))
        : null;
      const episodeId = `${flopSpot.handId}:cbet:${flopSpot.actionOrder}`;
      const sequenceLength = turnSpot ? 2 : 1;
      pools.cbet_barrels.push(createCbetCandidate(flopSpot, episodeId, 'flop', sequenceLength));
      if (turnSpot) pools.cbet_barrels.push(createCbetCandidate(turnSpot, episodeId, 'turn', sequenceLength));
    }

    handSpots
      .filter((spot) => ['TURN', 'RIVER'].includes(spot.street))
      .forEach((spot) => pools.turn_river.push(createTurnRiverCandidate(spot)));
  }

  return pools;
};
