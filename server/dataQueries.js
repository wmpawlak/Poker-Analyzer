import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { buildProfileReport, getProfileDateRange } from '../src/utils/profileReport.js';
import { calculateSessionMetrics } from '../src/utils/sessionMetrics.js';
import { buildStartingHandStats, getStartingHandKey } from '../src/utils/startingHandStats.js';

export class DataQueryError extends Error {
  constructor(message, code = 'DATA_INVALID_QUERY', status = 400) {
    super(message);
    this.name = 'DataQueryError';
    this.code = code;
    this.status = status;
  }
}

const MAX_PAGE_SIZE = 100;
export const MAX_WALLET_POINTS = 1200;
const HAND_RANK_ORDER = [
  'HIGH_CARD',
  'PAIR',
  'TWO_PAIR',
  'THREE_OF_A_KIND',
  'STRAIGHT',
  'FLUSH',
  'FULL_HOUSE',
  'FOUR_OF_A_KIND',
  'STRAIGHT_FLUSH',
  'NO_HAND',
];
const HAND_RANK_IDS = new Set(HAND_RANK_ORDER);
const HOLDEM_CARD_VARIANTS = new Set(['NLH', 'NLH BombPot']);

const asGameType = (value, fallback = 'both') => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['cash', 'tournament', 'both'].includes(normalized)) return normalized;
  throw new DataQueryError('gameType musi mieć wartość cash, tournament albo both.');
};

const asBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  throw new DataQueryError('Parametr logiczny musi mieć wartość true albo false.');
};

const asPageSize = (value, fallback = MAX_PAGE_SIZE) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw new DataQueryError('limit musi być dodatnią liczbą całkowitą.');
  const limit = Number(value);
  if (limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new DataQueryError(`limit musi mieścić się w zakresie 1–${MAX_PAGE_SIZE}.`);
  }
  return limit;
};

const asHandRanking = (value) => {
  if (value === undefined || value === null || value === '') return '';
  const normalized = String(value).trim().toUpperCase();
  if (HAND_RANK_IDS.has(normalized)) return normalized;
  throw new DataQueryError('handRanking ma nieprawidłową wartość.');
};

const asHandSortBy = (value) => {
  if (value === undefined || value === null || value === '') return 'date';
  if (value === 'date' || value === 'profit') return value;
  throw new DataQueryError('sortBy musi mieć wartość date albo profit.');
};

const asSortOrder = (value) => {
  if (value === undefined || value === null || value === '') return 'desc';
  if (value === 'asc' || value === 'desc') return value;
  throw new DataQueryError('sortOrder musi mieć wartość asc albo desc.');
};

const getDateRange = (query) => {
  const dateFrom = String(query?.dateFrom || '');
  const dateTo = String(query?.dateTo || '');
  const range = getProfileDateRange(dateFrom, dateTo);
  if (!range.valid) throw new DataQueryError(range.error);
  return { dateFrom, dateTo, range };
};

const isInDateRange = (hand, range) => {
  const timestamp = Number(hand.timestamp);
  return Number.isFinite(timestamp)
    && (range.fromTimestamp === null || timestamp >= range.fromTimestamp)
    && (range.toTimestamp === null || timestamp <= range.toTimestamp);
};

export const filterIndexedHands = (hands, query = {}, { defaultGameType = 'both' } = {}) => {
  const gameType = asGameType(query.gameType, defaultGameType);
  const { range, dateFrom, dateTo } = getDateRange(query);
  const filtered = (Array.isArray(hands) ? hands : []).filter((hand) => {
    if (!hand || hand.isRebuy || !isInDateRange(hand, range)) return false;
    if (gameType === 'cash') return !hand.isTournament;
    if (gameType === 'tournament') return hand.isTournament;
    return true;
  });
  return { hands: filtered, gameType, dateFrom, dateTo, range };
};

export const toHandSummary = (hand) => ({
  id: hand.id,
  timestamp: hand.timestamp,
  dateStr: hand.dateStr,
  timeStr: hand.timeStr,
  gameType: hand.gameType,
  gameVariant: hand.gameVariant,
  isTournament: hand.isTournament,
  sessionId: hand.sessionId,
  tableId: hand.tableId,
  tourneyId: hand.tourneyId,
  tourneyName: hand.tourneyName,
  heroCards: hand.heroCards,
  boardCards: hand.boardCards,
  handRanking: hand.handRanking,
  handRankingSource: hand.handRankingSource,
  position: hand.position,
  outcome: hand.outcome,
  netProfit: hand.netProfit,
  heroWinnings: hand.heroWinnings,
  heroInvestment: hand.heroInvestment,
  heroSawFlop: hand.heroSawFlop,
  sawShowdown: hand.sawShowdown,
  heroReachedRiverOrShowdown: hand.heroReachedRiverOrShowdown,
});

export const toSessionSummary = (session) => ({
  id: session.id,
  type: session.type,
  tableId: session.tableId,
  tourneyId: session.tourneyId,
  tourneyName: session.tourneyName,
  startTime: session.startTime,
  lastTimestamp: session.lastTimestamp,
  dateStr: session.dateStr,
  totalProfit: session.totalProfit,
  fingerprint: session.fingerprint,
  handCount: session.hands.filter((hand) => !hand.isRebuy).length,
  rebuys: session.rebuys || 0,
  startStack: session.startStack,
  mergedFromSessionIds: session.mergedFromSessionIds || [],
});

const getHandRanking = (hand) => hand?.handRanking || 'NO_HAND';

const getNonRebuyHands = (session) => (
  Array.isArray(session?.hands) ? session.hands.filter((hand) => hand && !hand.isRebuy) : []
);

const sortHands = (hands, sortBy, sortOrder) => (
  [...hands].sort((left, right) => {
    const leftValue = Number(sortBy === 'profit' ? left.netProfit : left.timestamp) || 0;
    const rightValue = Number(sortBy === 'profit' ? right.netProfit : right.timestamp) || 0;
    if (leftValue !== rightValue) {
      return sortOrder === 'desc' ? rightValue - leftValue : leftValue - rightValue;
    }
    return String(left.id).localeCompare(String(right.id));
  })
);

const countAvailableRanks = (hands) => {
  const counts = new Map();
  hands.forEach((hand) => {
    const id = getHandRanking(hand);
    counts.set(id, (counts.get(id) || 0) + 1);
  });
  return [...counts.entries()]
    .sort(([left], [right]) => {
      const leftIndex = HAND_RANK_ORDER.indexOf(left);
      const rightIndex = HAND_RANK_ORDER.indexOf(right);
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      return left.localeCompare(right);
    })
    .map(([id, count]) => ({ id, count }));
};

const encodeCursor = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

const decodeCursor = (cursor) => {
  try {
    const parsed = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (!Number.isInteger(parsed?.offset) || parsed.offset < 0) throw new Error();
    return parsed;
  } catch {
    throw new DataQueryError('cursor ma nieprawidłowy format.');
  }
};

export const paginate = (items, { cursor, limit, scope, datasetRevision }) => {
  const pageSize = asPageSize(limit);
  let offset = 0;
  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (decoded.scope !== scope || decoded.datasetRevision !== datasetRevision) {
      throw new DataQueryError('cursor nie pasuje do bieżącego datasetu.');
    }
    offset = decoded.offset;
  }
  const values = items.slice(offset, offset + pageSize);
  const nextOffset = offset + values.length;
  return {
    values,
    nextCursor: nextOffset < items.length
      ? encodeCursor({ scope, offset: nextOffset, datasetRevision })
      : null,
  };
};

const buildOpponents = (hands) => {
  const opponents = new Map();
  hands.forEach((hand) => {
    const values = Array.isArray(hand.opponents) ? hand.opponents : [];
    values.forEach((rawOpponent) => {
      const id = String(rawOpponent || '').trim();
      if (!id) return;
      const current = opponents.get(id) || {
        id,
        handsPlayed: 0,
        sessions: new Set(),
        showdowns: 0,
        heroWins: 0,
        heroLosses: 0,
        netExchanged: 0,
      };
      current.handsPlayed += 1;
      current.sessions.add(hand.sessionId || 'unknown');
      if (hand.sawShowdown) current.showdowns += 1;
      const profitShare = (Number(hand.netProfit) || 0) / values.length;
      if (hand.outcome === 'WON') {
        current.heroWins += 1;
        current.netExchanged += profitShare;
      } else if (hand.outcome === 'LOST') {
        current.heroLosses += 1;
        current.netExchanged += profitShare;
      }
      opponents.set(id, current);
    });
  });
  return [...opponents.values()]
    .map(({ sessions, ...opponent }) => ({
      ...opponent,
      sessionsCount: sessions.size,
      netExchanged: Number(opponent.netExchanged.toFixed(2)),
    }))
    .sort((left, right) => right.handsPlayed - left.handsPlayed || left.id.localeCompare(right.id));
};

export const createProfileResponse = (snapshot, query) => {
  const { gameType, dateFrom, dateTo } = filterIndexedHands(snapshot.hands, query);
  const report = buildProfileReport({
    cashHands: snapshot.hands.filter((hand) => !hand.isTournament),
    tournamentHands: snapshot.hands.filter((hand) => hand.isTournament),
    gameType,
    dateFrom,
    dateTo,
  });
  return {
    datasetRevision: snapshot.datasetRevision,
    isValid: report.isValid,
    error: report.error,
    dateRange: report.dateRange,
    gameType: report.gameType,
    metrics: report.metrics,
    cashMetrics: report.cashMetrics,
    tournamentMetrics: report.tournamentMetrics,
    handCount: report.hands.length,
    cashHandCount: report.cashHands.length,
    tournamentHandCount: report.tournamentHands.length,
  };
};

const buildWalletData = (hands) => {
  let totalProfit = 0;
  const positions = new Map();
  const timeline = hands.map((hand, index) => {
    totalProfit += Number(hand.netProfit) || 0;
    const position = hand.position || 'UNKNOWN';
    if (position !== 'UNKNOWN') {
      const current = positions.get(position) || { position, wins: 0, total: 0 };
      current.total += 1;
      if (hand.outcome === 'WON') current.wins += 1;
      positions.set(position, current);
    }
    return {
      handIndex: index + 1,
      timestamp: hand.timestamp,
      date: hand.dateStr,
      profit: Number(totalProfit.toFixed(2)),
    };
  });
  const positionFrequencyData = [...positions.values()];
  return {
    timeline,
    positionFrequencyData,
    maxPosHands: Math.max(...positionFrequencyData.map(({ total }) => total), 1),
    totalHands: hands.length,
    totalProfit: Number(totalProfit.toFixed(2)),
  };
};

const evenlySpacedIndices = (size, count) => {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, index) => Math.round((index * (size - 1)) / Math.max(count - 1, 1)));
};

// Najpierw zachowuje wszystkie wykryte lokalne ekstrema, gdy mieszczą się w
// limicie. Dla bardzo długich serii wybiera minimum i maksimum w każdym koszu.
export const downsampleWalletTimeline = (points, maximum = MAX_WALLET_POINTS) => {
  if (maximum <= 1) return points.length > 0 ? [points[0]] : [];
  if (maximum === 2) return points.length > 1 ? [points[0], points.at(-1)] : points;
  if (points.length <= maximum) return points;
  const extrema = [];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1].profit;
    const current = points[index].profit;
    const next = points[index + 1].profit;
    if ((current <= previous && current <= next) || (current >= previous && current >= next)) {
      extrema.push(index);
    }
  }

  if (extrema.length + 2 <= maximum) {
    const selected = new Set([0, ...extrema, points.length - 1]);
    for (const index of evenlySpacedIndices(points.length, maximum)) {
      if (selected.size >= maximum) break;
      selected.add(index);
    }
    return [...selected].sort((left, right) => left - right).map((index) => points[index]);
  }

  const selected = new Set([0, points.length - 1]);
  const remainingSlots = maximum - 2;
  const bucketCount = Math.max(1, Math.floor(remainingSlots / 2));
  const bucketSize = (points.length - 2) / bucketCount;
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = 1 + Math.floor(bucket * bucketSize);
    const end = Math.min(points.length - 1, 1 + Math.floor((bucket + 1) * bucketSize));
    let minimum = start;
    let maximumIndex = start;
    for (let index = start + 1; index < end; index += 1) {
      if (points[index].profit < points[minimum].profit) minimum = index;
      if (points[index].profit > points[maximumIndex].profit) maximumIndex = index;
    }
    for (const candidate of [minimum, maximumIndex]) {
      if (selected.size >= maximum) break;
      selected.add(candidate);
    }
  }
  if (selected.size < maximum) {
    for (const index of evenlySpacedIndices(points.length, maximum)) {
      if (selected.size >= maximum) break;
      selected.add(index);
    }
  }
  return [...selected].sort((left, right) => left - right).map((index) => points[index]);
};

export const createWalletResponse = (snapshot, query) => {
  const { hands, dateFrom, dateTo } = filterIndexedHands(snapshot.hands, query, { defaultGameType: 'cash' });
  const onlyFlop = asBoolean(query?.onlyFlop);
  const cashHands = hands
    .filter((hand) => !hand.isTournament)
    .filter((hand) => !onlyFlop || hand.streets?.some((street) => street.name === 'FLOP'))
    .sort((left, right) => left.timestamp - right.timestamp);
  const wallet = buildWalletData(cashHands);
  return {
    datasetRevision: snapshot.datasetRevision,
    gameType: 'cash',
    dateFrom,
    dateTo,
    onlyFlop,
    ...wallet,
    timeline: downsampleWalletTimeline(wallet.timeline),
  };
};

export const createCardsResponse = (snapshot, query) => {
  const { hands, gameType, dateFrom, dateTo } = filterIndexedHands(snapshot.hands, query);
  const riverOrShowdownOnly = asBoolean(query?.riverOrShowdownOnly);
  const excludedByReason = {
    unsupportedVariant: 0,
    invalidHeroCards: 0,
  };
  const indexedHands = hands.filter((hand) => {
    if (!HOLDEM_CARD_VARIANTS.has(hand.gameVariant)) {
      excludedByReason.unsupportedVariant += 1;
      return false;
    }
    if (!getStartingHandKey(hand.heroCards)) {
      excludedByReason.invalidHeroCards += 1;
      return false;
    }
    return true;
  });
  const startingHands = buildStartingHandStats(indexedHands, { riverOrShowdownOnly });
  return {
    datasetRevision: snapshot.datasetRevision,
    gameType,
    dateFrom,
    dateTo,
    riverOrShowdownOnly,
    candidateHandCount: hands.length,
    indexedHandCount: indexedHands.length,
    excludedHandCount: hands.length - indexedHands.length,
    excludedByReason,
    populatedClassCount: startingHands.filter((hand) => hand.count > 0).length,
    hands: startingHands,
  };
};

export const createOpponentsResponse = (snapshot, query) => {
  const { hands, gameType, dateFrom, dateTo } = filterIndexedHands(snapshot.hands, query);
  const opponents = buildOpponents(hands);
  const page = paginate(opponents, {
    cursor: query?.cursor,
    limit: query?.limit,
    scope: `opponents:${gameType}:${dateFrom}:${dateTo}`,
    datasetRevision: snapshot.datasetRevision,
  });
  return {
    datasetRevision: snapshot.datasetRevision,
    gameType,
    dateFrom,
    dateTo,
    opponents: page.values,
    nextCursor: page.nextCursor,
    total: opponents.length,
  };
};

export const createSessionsResponse = (snapshot, query) => {
  const gameType = asGameType(query?.gameType);
  const { range } = getDateRange(query);
  const handRanking = asHandRanking(query?.handRanking);
  const selectedSessions = [
    ...(gameType === 'tournament' ? [] : snapshot.sessions.cash || []),
    ...(gameType === 'cash' ? [] : snapshot.sessions.tournament || []),
  ]
    .filter((session) => isInDateRange({ timestamp: session.startTime }, range))
    .sort((left, right) => right.startTime - left.startTime);
  const availableRanks = countAvailableRanks(selectedSessions.flatMap(getNonRebuyHands));
  const sessions = selectedSessions
    .map((session) => {
      const hands = getNonRebuyHands(session);
      const matchingHandCount = handRanking
        ? hands.filter((hand) => getHandRanking(hand) === handRanking).length
        : hands.length;
      return { session, matchingHandCount };
    })
    .filter(({ matchingHandCount }) => !handRanking || matchingHandCount > 0)
    .map(({ session, matchingHandCount }) => ({
      ...toSessionSummary(session),
      matchingHandCount,
    }));
  return {
    datasetRevision: snapshot.datasetRevision,
    gameType,
    handRanking,
    availableRanks,
    sessions,
  };
};

export const createSessionHandsResponse = (snapshot, sessionId, query = {}) => {
  const session = snapshot.sessionsById.get(String(sessionId));
  if (!session) return null;
  const handRanking = asHandRanking(query.handRanking);
  const sortBy = asHandSortBy(query.sortBy);
  const sortOrder = asSortOrder(query.sortOrder);
  const hands = sortHands(
    getNonRebuyHands(session).filter((hand) => !handRanking || getHandRanking(hand) === handRanking),
    sortBy,
    sortOrder,
  );
  const page = paginate(hands, {
    cursor: query.cursor,
    limit: query.limit,
    scope: `session:${session.id}:rank:${handRanking || 'all'}:sort:${sortBy}:${sortOrder}`,
    datasetRevision: snapshot.datasetRevision,
  });
  return {
    datasetRevision: snapshot.datasetRevision,
    sessionId: session.id,
    handRanking,
    sortBy,
    sortOrder,
    hands: page.values.map(toHandSummary),
    total: hands.length,
    nextCursor: page.nextCursor,
  };
};

const asCollectionMode = (value) => {
  if (value === 'analyzed' || value === 'saved') return value;
  throw new DataQueryError('mode musi mieć wartość analyzed albo saved.');
};

const normalizeHandIds = (value, fieldName) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new DataQueryError(`${fieldName} musi być tablicą identyfikatorów.`);
  return [...new Set(value
    .map((id) => String(id ?? '').trim())
    .filter(Boolean))]
    .sort();
};

const createCollectionIdsHash = ({ analyzedHandIds, savedHandIds }) => (
  createHash('sha256')
    .update(JSON.stringify({ analyzedHandIds, savedHandIds }))
    .digest('hex')
);

const getPayloadHandIds = (payload, primaryField, legacyField) => (
  payload?.[primaryField] ?? payload?.[legacyField]
);

export const createHandCollectionsResponse = (snapshot, payload = {}) => {
  const requestedRevision = String(payload.datasetRevision || '').trim();
  if (!requestedRevision) {
    throw new DataQueryError('datasetRevision jest wymagane.', 'DATASET_REVISION_REQUIRED');
  }
  if (requestedRevision !== snapshot.datasetRevision) {
    throw new DataQueryError(
      'Dataset zmienił się przed pobraniem kolekcji rąk.',
      'DATASET_REVISION_MISMATCH',
      409,
    );
  }

  const gameType = asGameType(payload.gameType);
  const mode = asCollectionMode(payload.mode);
  const handRanking = asHandRanking(payload.handRanking);
  const sortBy = asHandSortBy(payload.sortBy);
  const sortOrder = asSortOrder(payload.sortOrder);
  const analyzedHandIds = normalizeHandIds(
    getPayloadHandIds(payload, 'analyzedHandIds', 'analyzedIds'),
    'analyzedHandIds',
  );
  const savedHandIds = normalizeHandIds(
    getPayloadHandIds(payload, 'savedHandIds', 'savedIds'),
    'savedHandIds',
  );
  const analyzedIds = new Set(analyzedHandIds);
  const savedIds = new Set(savedHandIds);
  const indexedHandsById = new Map();
  (Array.isArray(snapshot.hands) ? snapshot.hands : []).forEach((hand) => {
    if (!hand || hand.isRebuy) return;
    if (gameType === 'cash' && hand.isTournament) return;
    if (gameType === 'tournament' && !hand.isTournament) return;
    const id = String(hand.id || '');
    if (id && !indexedHandsById.has(id)) indexedHandsById.set(id, hand);
  });
  const indexedHands = [...indexedHandsById.values()];
  const collectionCounts = {
    analyzed: indexedHands.filter((hand) => analyzedIds.has(String(hand.id))).length,
    saved: indexedHands.filter((hand) => savedIds.has(String(hand.id))).length,
  };
  const selectedIds = mode === 'analyzed' ? analyzedIds : savedIds;
  const matchingHands = sortHands(
    indexedHands.filter((hand) => (
      selectedIds.has(String(hand.id))
      && (!handRanking || getHandRanking(hand) === handRanking)
    )),
    sortBy,
    sortOrder,
  );
  const idsHash = createCollectionIdsHash({ analyzedHandIds, savedHandIds });
  const page = paginate(matchingHands, {
    cursor: payload.cursor,
    limit: payload.limit,
    scope: `hand-collection:${mode}:${gameType}:rank:${handRanking || 'all'}:sort:${sortBy}:${sortOrder}:ids:${idsHash}`,
    datasetRevision: snapshot.datasetRevision,
  });
  return {
    datasetRevision: snapshot.datasetRevision,
    gameType,
    mode,
    handRanking,
    sortBy,
    sortOrder,
    hands: page.values.map(toHandSummary),
    total: matchingHands.length,
    nextCursor: page.nextCursor,
    collectionCounts,
  };
};

export const createSessionDetailResponse = (snapshot, sessionId) => {
  const session = snapshot.sessionsById.get(String(sessionId));
  if (!session) return null;
  const gameType = session.type === 'Cash' ? 'cash' : 'tournament';
  return {
    datasetRevision: snapshot.datasetRevision,
    session: {
      ...toSessionSummary(session),
      metrics: calculateSessionMetrics(session.hands, gameType),
      chartData: Array.isArray(session.chartData) ? session.chartData : [],
    },
  };
};
