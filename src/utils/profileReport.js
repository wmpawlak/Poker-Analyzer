import { calculateSessionMetrics } from './sessionMetrics.js';
import { getLocalDateRange } from './dateRange.js';

export const PROFILE_GAME_TYPES = Object.freeze({
  CASH: 'cash',
  TOURNAMENT: 'tournament',
  BOTH: 'both',
});

export const normalizeProfileGameType = (gameType) => {
  const normalized = String(gameType || '').trim().toLowerCase();
  if (normalized === PROFILE_GAME_TYPES.CASH) return PROFILE_GAME_TYPES.CASH;
  if (normalized === PROFILE_GAME_TYPES.TOURNAMENT
    || normalized === 'turniej'
    || normalized === 'turnieje') {
    return PROFILE_GAME_TYPES.TOURNAMENT;
  }
  return PROFILE_GAME_TYPES.BOTH;
};

export const getProfileDateRange = (dateFrom = '', dateTo = '') => {
  const range = getLocalDateRange(dateFrom, dateTo);
  return {
    valid: range.valid,
    error: range.error,
    fromTimestamp: range.fromTimestamp,
    toTimestamp: range.toTimestamp,
    isEmpty: range.isEmpty,
  };
};

const resolveDateRange = (dateRangeOrFrom = '', dateTo = '') => {
  if (dateRangeOrFrom && typeof dateRangeOrFrom === 'object') {
    if (typeof dateRangeOrFrom.fromTimestamp !== 'undefined'
      && typeof dateRangeOrFrom.toTimestamp !== 'undefined') {
      return dateRangeOrFrom;
    }
    return getProfileDateRange(dateRangeOrFrom.from || '', dateRangeOrFrom.to || '');
  }
  return getProfileDateRange(dateRangeOrFrom, dateTo);
};

export const filterHandsByDateRange = (hands = [], dateRangeOrFrom = '', dateTo = '') => {
  const range = resolveDateRange(dateRangeOrFrom, dateTo);
  if (!range.valid) return [];

  return (Array.isArray(hands) ? hands : []).filter((hand) => {
    if (!hand || hand.isRebuy) return false;
    if (range.fromTimestamp === null && range.toTimestamp === null) return true;

    const timestamp = Number(hand.timestamp);
    if (!Number.isFinite(timestamp)) return false;
    return (range.fromTimestamp === null || timestamp >= range.fromTimestamp)
      && (range.toTimestamp === null || timestamp <= range.toTimestamp);
  });
};

export const buildProfileReport = ({
  cashHands = [],
  tournamentHands = [],
  gameType = PROFILE_GAME_TYPES.BOTH,
  dateFrom = '',
  dateTo = '',
} = {}) => {
  const normalizedGameType = normalizeProfileGameType(gameType);
  const dateRange = getProfileDateRange(dateFrom, dateTo);

  if (!dateRange.valid) {
    return {
      isValid: false,
      error: dateRange.error,
      dateRange,
      gameType: normalizedGameType,
      cashHands: [],
      tournamentHands: [],
      hands: [],
      metrics: null,
      cashMetrics: null,
      tournamentMetrics: null,
    };
  }

  const filteredCashHands = filterHandsByDateRange(cashHands, dateRange);
  const filteredTournamentHands = filterHandsByDateRange(tournamentHands, dateRange);
  const mixedHands = [...filteredCashHands, ...filteredTournamentHands]
    .sort((left, right) => Number(left.timestamp) - Number(right.timestamp));
  const cashMetrics = calculateSessionMetrics(filteredCashHands, 'cash');
  const tournamentMetrics = calculateSessionMetrics(filteredTournamentHands, 'tournament');
  const metrics = normalizedGameType === PROFILE_GAME_TYPES.CASH
    ? cashMetrics
    : normalizedGameType === PROFILE_GAME_TYPES.TOURNAMENT
      ? tournamentMetrics
      : calculateSessionMetrics(mixedHands, 'mixed');
  const hands = normalizedGameType === PROFILE_GAME_TYPES.CASH
    ? filteredCashHands
    : normalizedGameType === PROFILE_GAME_TYPES.TOURNAMENT
      ? filteredTournamentHands
      : mixedHands;

  return {
    isValid: true,
    error: null,
    dateRange,
    gameType: normalizedGameType,
    cashHands: filteredCashHands,
    tournamentHands: filteredTournamentHands,
    hands,
    metrics,
    cashMetrics,
    tournamentMetrics,
  };
};
