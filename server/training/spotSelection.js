import { buildTrainingAnswerKeyBatchInput } from './answerKeyContract.js';

export const TRAINING_SELECTION_STRATEGY = 'diverse_recent_v1';
export const DEFAULT_SELECTION_LIMIT = 100;

const asString = (value) => String(value ?? '').trim();

const newestFirst = (left, right) => {
  const playedAt = (Date.parse(right.playedAt || '') || 0) - (Date.parse(left.playedAt || '') || 0);
  if (playedAt) return playedAt;
  const createdAt = (Date.parse(right.createdAt || '') || 0) - (Date.parse(left.createdAt || '') || 0);
  if (createdAt) return createdAt;
  return asString(left.versionId).localeCompare(asString(right.versionId));
};

const stackBucket = (value) => {
  const stack = Number(value);
  if (!Number.isFinite(stack) || stack <= 0) return 'unknown';
  if (stack < 20) return 'under_20bb';
  if (stack < 40) return '20_39bb';
  if (stack < 75) return '40_74bb';
  if (stack < 150) return '75_149bb';
  return '150bb_plus';
};

const exerciseFeature = (spot) => {
  if (spot.exerciseType === 'preflop_vs_reraise') return `scenario:${asString(spot.scenario) || 'unknown'}`;
  if (spot.exerciseType === 'cbet_barrels') {
    return Number(spot.sequenceLength) > 1 ? 'stage:flop_turn' : `stage:${asString(spot.stage) || 'unknown'}`;
  }
  if (spot.exerciseType === 'turn_river') return `street:${asString(spot.street) || 'unknown'}`;
  return `street:${asString(spot.street) || 'unknown'}`;
};

const groupKey = (spot) => [
  asString(spot.exerciseType) || 'unknown',
  asString(spot.gameType) || 'unknown',
  asString(spot.question?.heroPosition) || 'unknown',
  stackBucket(spot.question?.effectiveStackBb ?? spot.effectiveStackBb),
  `opponents:${Number(spot.question?.context?.opponentsInHand) || 0}`,
  exerciseFeature(spot),
].join('|');

const isAiEligible = (spot) => {
  if (!spot?.versionId || spot?.sourceStatus !== 'current') return false;
  const options = Array.isArray(spot.answerOptions) ? spot.answerOptions : [];
  if (options.length < 2) return false;
  try {
    buildTrainingAnswerKeyBatchInput([spot]);
    return true;
  } catch {
    return false;
  }
};

const makeUnits = (spots) => {
  const units = new Map();
  spots.forEach((spot) => {
    const scope = `${asString(spot.exerciseType) || 'unknown'}:${asString(spot.gameType) || 'unknown'}`;
    const unitId = spot.exerciseType === 'cbet_barrels'
      ? `${scope}:episode:${asString(spot.episodeId) || spot.handId}`
      : `${scope}:hand:${asString(spot.handId)}`;
    const current = units.get(unitId) || { id: unitId, spots: [] };
    current.spots.push(spot);
    units.set(unitId, current);
  });
  return [...units.values()]
    .filter((unit) => {
      if (unit.spots.some((spot) => !isAiEligible(spot))) return false;
      if (unit.spots[0]?.exerciseType !== 'cbet_barrels') return true;
      const expectedLength = Number(unit.spots[0]?.sequenceLength) || 1;
      const stages = new Set(unit.spots.map(({ stage }) => stage));
      return unit.spots.length === expectedLength
        && (expectedLength === 1 || (stages.has('flop') && stages.has('turn')));
    })
    .map((unit) => {
      const newest = [...unit.spots].sort(newestFirst)[0];
      return {
        ...unit,
        // One independent decision per hand; c-bet stages are the one explicit
        // exception and remain a complete episode.
        spots: newest.exerciseType === 'cbet_barrels' ? unit.spots : [newest],
        group: groupKey(newest),
        newest,
      };
    })
    .sort((left, right) => newestFirst(left.newest, right.newest) || left.id.localeCompare(right.id));
};

/**
 * Selects a diverse, stable set within one exercise/game pool. A unit represents
 * one hand, except c-bet episodes where flop and turn must travel together.
 */
export const selectDiverseRecentSpots = (spots, { limit = DEFAULT_SELECTION_LIMIT } = {}) => {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Selection limit must be a positive integer.');
  const unitsByGroup = new Map();
  makeUnits(Array.isArray(spots) ? spots : []).forEach((unit) => {
    const list = unitsByGroup.get(unit.group) || [];
    list.push(unit);
    unitsByGroup.set(unit.group, list);
  });
  const groups = [...unitsByGroup.keys()].sort();
  const selected = [];
  const selectedIds = new Set();
  let madeProgress = true;
  while (selected.length < limit && madeProgress) {
    madeProgress = false;
    for (const group of groups) {
      const units = unitsByGroup.get(group);
      while (units.length && units[0].spots.some((spot) => selectedIds.has(spot.versionId))) units.shift();
      const unit = units[0];
      if (!unit || selected.length + unit.spots.length > limit) continue;
      units.shift();
      unit.spots.sort(newestFirst).forEach((spot) => {
        selected.push(spot);
        selectedIds.add(spot.versionId);
      });
      madeProgress = true;
      if (selected.length >= limit) break;
    }
  }
  return selected;
};

export const isTrainingSpotAiEligible = isAiEligible;

export const getTrainingSpotAiEligibilityError = (spot) => {
  if (!spot?.versionId || spot?.sourceStatus !== 'current') return 'Spot nie pochodzi z aktualnego źródła.';
  if (!Array.isArray(spot.answerOptions) || spot.answerOptions.length < 2) {
    return 'Spot ma mniej niż dwie poprawne odpowiedzi.';
  }
  try {
    buildTrainingAnswerKeyBatchInput([spot]);
    return null;
  } catch (error) {
    return error?.message || 'Spot nie spełnia lokalnego kontraktu AI.';
  }
};
