import { compareHoldemHands } from './handEvaluator.js';

export const EQUITY_CALCULATOR_VERSION = 'equity-v1';
export const DEFAULT_MAX_ENUMERATED_OUTCOMES = 250_000;
export const DEFAULT_SIMULATION_SAMPLES = 100_000;
export const DEFAULT_CONFIDENCE_LEVEL = 0.95;

/** Ten rounded equity values available in the training exercise. */
export const EQUITY_BUCKETS = Object.freeze(Array.from({ length: 10 }, (_value, index) => {
  const equityPercent = (index + 1) * 10;
  return Object.freeze({ id: `equity_${equityPercent}`, label: `${equityPercent}%`, equityPercent });
}));

export const EQUITY_BUCKET_TOLERANCE_PERCENT = 5;

const bucketById = new Map(EQUITY_BUCKETS.map((bucket) => [bucket.id, bucket]));

export const getEquityAnswerOptions = () => EQUITY_BUCKETS.map((bucket) => ({
  id: bucket.id,
  label: bucket.label,
  action: 'equity_bucket',
  equityPercent: bucket.equityPercent,
}));

export const getEquityBucket = (equityPercent) => {
  const value = Number(equityPercent);
  if (!Number.isFinite(value)) return null;
  const clamped = Math.min(100, Math.max(0, value));
  return EQUITY_BUCKETS.reduce((closest, bucket) => (
    Math.abs(bucket.equityPercent - clamped) < Math.abs(closest.equityPercent - clamped)
      ? bucket
      : closest
  ));
};

/** Grades a rounded answer against the exact calculated equity with ±5 pp tolerance. */
export const gradeEquityBucket = (selectedBucketId, result) => {
  const selected = bucketById.get(String(selectedBucketId));
  const equityPercent = Number(result?.equityPercent ?? Number(result?.equity) * 100);
  const correct = getEquityBucket(equityPercent);
  if (!selected || !correct || !Number.isFinite(equityPercent)) return {
    grade: 'incorrect',
    correctBucket: correct?.id || null,
    selectedBucket: String(selectedBucketId || '') || null,
    distancePercent: null,
  };
  const distance = Math.abs(equityPercent - selected.equityPercent);
  return {
    grade: distance <= EQUITY_BUCKET_TOLERANCE_PERCENT ? 'correct' : 'incorrect',
    correctBucket: correct.id,
    selectedBucket: selected.id,
    distancePercent: round(distance, 6),
  };
};

const RANKS = '23456789TJQKA';
const SUITS = 'cdhs';
const CARD_PATTERN = /^(10|[2-9TJQKA])([cdhs])$/i;
const SUPPORTED_BOARD_LENGTHS = new Set([0, 3, 4, 5]);
const EQUITY_CACHE_LIMIT = 256;
const equityCache = new Map();

const round = (value, digits = 8) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const choose = (n, k) => {
  if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || k > n) return 0;
  const size = Math.min(k, n - k);
  let result = 1;
  for (let index = 1; index <= size; index += 1) {
    result = (result * (n - size + index)) / index;
  }
  return Math.round(result);
};

const normalizeCard = (card, fieldName) => {
  const match = String(card ?? '').trim().match(CARD_PATTERN);
  if (!match) throw new TypeError(`${fieldName} contains an invalid card`);

  const rank = match[1].toUpperCase() === '10' ? 'T' : match[1].toUpperCase();
  return `${rank}${match[2].toLowerCase()}`;
};

const normalizeCardList = (cards, fieldName, expectedLength) => {
  if (!Array.isArray(cards)) throw new TypeError(`${fieldName} must be an array`);
  if (expectedLength !== undefined && cards.length !== expectedLength) {
    throw new TypeError(`${fieldName} must contain ${expectedLength} cards`);
  }

  const normalized = cards.map((card) => normalizeCard(card, fieldName));
  if (new Set(normalized).size !== normalized.length) {
    throw new RangeError(`${fieldName} contains duplicate cards`);
  }
  return normalized;
};

const createDeck = () => RANKS.split('').flatMap((rank) => (
  SUITS.split('').map((suit) => `${rank}${suit}`)
));

const assertNoCardOverlap = (heroCards, villainCards, boardCards) => {
  const allCards = [...heroCards, ...villainCards, ...boardCards];
  if (new Set(allCards).size !== allCards.length) {
    throw new RangeError('heroCards, villainCards and boardCards contain duplicate cards');
  }
};

const getStreet = (boardLength) => {
  if (boardLength === 0) return 'PRE_FLOP';
  if (boardLength === 3) return 'FLOP';
  if (boardLength === 4) return 'TURN';
  return 'RIVER';
};

const forEachCombination = (items, size, callback) => {
  const current = [];
  const visit = (start) => {
    if (current.length === size) {
      callback(current);
      return;
    }

    const remaining = size - current.length;
    for (let index = start; index <= items.length - remaining; index += 1) {
      current.push(items[index]);
      visit(index + 1);
      current.pop();
    }
  };

  if (size === 0) callback([]);
  else visit(0);
};

const hashSeed = (value) => {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 || 0x9e3779b9;
};

const createRandom = (seed) => {
  let state = hashSeed(seed);
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
};

const sampleRunout = (deck, count, random) => {
  const available = [...deck];
  const result = [];
  for (let index = 0; index < count; index += 1) {
    const selectedIndex = index + Math.floor(random() * (available.length - index));
    [available[index], available[selectedIndex]] = [available[selectedIndex], available[index]];
    result.push(available[index]);
  }
  return result;
};

const createOutcomeCounter = () => ({ wins: 0, ties: 0, losses: 0 });

const recordOutcome = (counter, heroCards, villainCards, boardCards, runout) => {
  const comparison = compareHoldemHands(heroCards, villainCards, [...boardCards, ...runout]);
  if (comparison > 0) counter.wins += 1;
  else if (comparison < 0) counter.losses += 1;
  else counter.ties += 1;
};

const createConfidence = (counter, sampleCount, confidenceLevel) => {
  if (sampleCount === 0) {
    return {
      level: confidenceLevel,
      marginOfError: 0,
      lower: 0,
      upper: 0,
    };
  }

  const winProbability = counter.wins / sampleCount;
  const tieProbability = counter.ties / sampleCount;
  const equity = winProbability + (tieProbability / 2);
  const secondMoment = winProbability + (tieProbability / 4);
  const variance = Math.max(0, secondMoment - (equity ** 2));
  const zScore = 1.96;
  const marginOfError = zScore * Math.sqrt(variance / sampleCount);

  return {
    level: confidenceLevel,
    marginOfError: round(marginOfError),
    lower: round(Math.max(0, equity - marginOfError)),
    upper: round(Math.min(1, equity + marginOfError)),
  };
};

const buildResult = ({
  heroCards,
  villainCards,
  boardCards,
  street,
  method,
  theoreticalOutcomes,
  counter,
  seed,
  confidenceLevel,
}) => {
  const sampleCount = counter.wins + counter.ties + counter.losses;
  const winProbability = sampleCount > 0 ? counter.wins / sampleCount : 0;
  const tieProbability = sampleCount > 0 ? counter.ties / sampleCount : 0;
  const lossProbability = sampleCount > 0 ? counter.losses / sampleCount : 0;
  const equity = winProbability + (tieProbability / 2);
  const confidence = method === 'enumeration'
    ? { level: confidenceLevel, marginOfError: 0, lower: equity, upper: equity }
    : createConfidence(counter, sampleCount, confidenceLevel);

  return {
    calculatorVersion: EQUITY_CALCULATOR_VERSION,
    method,
    street,
    heroCards: [...heroCards],
    villainCards: [...villainCards],
    boardCards: [...boardCards],
    wins: counter.wins,
    ties: counter.ties,
    losses: counter.losses,
    winCount: counter.wins,
    tieCount: counter.ties,
    lossCount: counter.losses,
    samples: sampleCount,
    sampleCount,
    theoreticalOutcomes,
    winProbability: round(winProbability),
    tieProbability: round(tieProbability),
    lossProbability: round(lossProbability),
    equity: round(equity),
    equityPercent: round(equity * 100, 6),
    marginOfError: confidence.marginOfError,
    confidence95: {
      level: confidence.level,
      lower: confidence.lower,
      upper: confidence.upper,
      lowerPercent: round(confidence.lower * 100, 6),
      upperPercent: round(confidence.upper * 100, 6),
      marginOfErrorPercent: round(confidence.marginOfError * 100, 6),
    },
    seed: method === 'simulation' ? seed : null,
  };
};

const cloneResult = (result) => ({
  ...result,
  heroCards: [...result.heroCards],
  villainCards: [...result.villainCards],
  boardCards: [...result.boardCards],
  confidence95: { ...result.confidence95 },
  ...(Array.isArray(result.opponentRange) ? { opponentRange: result.opponentRange.map((entry) => ({ ...entry })) } : {}),
});

const getCacheKey = ({
  heroCards,
  villainCards,
  boardCards,
  maxEnumeratedOutcomes,
  simulationSamples,
  seed,
  confidenceLevel,
}) => (
  JSON.stringify({
    heroCards,
    villainCards,
    boardCards,
    maxEnumeratedOutcomes,
    simulationSamples,
    seed,
    confidenceLevel,
  })
);

const putInCache = (key, result) => {
  if (equityCache.has(key)) equityCache.delete(key);
  equityCache.set(key, result);
  while (equityCache.size > EQUITY_CACHE_LIMIT) {
    equityCache.delete(equityCache.keys().next().value);
  }
};

/**
 * Calculates heads-up NLH equity against one known opponent hand.
 *
 * The function is deliberately independent from training/session state. It can
 * therefore be called by a background job and its result cached before a
 * question is served. `equity` is a ratio in [0, 1]; `equityPercent` is the
 * same value in percentage points for UI and bucket calculations.
 */
export const calculateHoldemEquity = ({
  heroCards,
  villainCards,
  opponentCards,
  boardCards = [],
  gameVariant = 'NLH',
  maxEnumeratedOutcomes = DEFAULT_MAX_ENUMERATED_OUTCOMES,
  simulationSamples = DEFAULT_SIMULATION_SAMPLES,
  seed,
  confidenceLevel = DEFAULT_CONFIDENCE_LEVEL,
  useCache = true,
} = {}) => {
  if (gameVariant !== 'NLH') {
    throw new RangeError('Equity calculator supports NLH heads-up only');
  }
  if (!Number.isInteger(maxEnumeratedOutcomes) || maxEnumeratedOutcomes < 1) {
    throw new RangeError('maxEnumeratedOutcomes must be a positive integer');
  }
  if (!Number.isInteger(simulationSamples) || simulationSamples < 1) {
    throw new RangeError('simulationSamples must be a positive integer');
  }
  if (confidenceLevel !== DEFAULT_CONFIDENCE_LEVEL) {
    throw new RangeError('Only 95% confidence intervals are supported');
  }

  const normalizedHeroCards = normalizeCardList(heroCards, 'heroCards', 2);
  const normalizedVillainCards = normalizeCardList(villainCards || opponentCards, 'villainCards', 2);
  const normalizedBoardCards = normalizeCardList(boardCards, 'boardCards');
  if (!SUPPORTED_BOARD_LENGTHS.has(normalizedBoardCards.length)) {
    throw new RangeError('boardCards must contain 0, 3, 4 or 5 cards');
  }
  assertNoCardOverlap(normalizedHeroCards, normalizedVillainCards, normalizedBoardCards);

  const normalizedSeed = seed === undefined || seed === null
    ? `${EQUITY_CALCULATOR_VERSION}:${normalizedHeroCards.join(',')}:${normalizedVillainCards.join(',')}:${normalizedBoardCards.join(',')}`
    : String(seed);
  const cacheKey = getCacheKey({
    heroCards: normalizedHeroCards,
    villainCards: normalizedVillainCards,
    boardCards: normalizedBoardCards,
    maxEnumeratedOutcomes,
    simulationSamples,
    seed: normalizedSeed,
    confidenceLevel,
  });
  if (useCache && equityCache.has(cacheKey)) return cloneResult(equityCache.get(cacheKey));

  const knownCards = new Set([...normalizedHeroCards, ...normalizedVillainCards, ...normalizedBoardCards]);
  const deck = createDeck().filter((card) => !knownCards.has(card));
  const cardsToCome = 5 - normalizedBoardCards.length;
  const theoreticalOutcomes = choose(deck.length, cardsToCome);
  const method = theoreticalOutcomes <= maxEnumeratedOutcomes ? 'enumeration' : 'simulation';
  const counter = createOutcomeCounter();

  if (method === 'enumeration') {
    forEachCombination(deck, cardsToCome, (runout) => {
      recordOutcome(
        counter,
        normalizedHeroCards,
        normalizedVillainCards,
        normalizedBoardCards,
        runout,
      );
    });
  } else {
    const random = createRandom(normalizedSeed);
    for (let sample = 0; sample < simulationSamples; sample += 1) {
      recordOutcome(
        counter,
        normalizedHeroCards,
        normalizedVillainCards,
        normalizedBoardCards,
        sampleRunout(deck, cardsToCome, random),
      );
    }
  }

  const result = buildResult({
    heroCards: normalizedHeroCards,
    villainCards: normalizedVillainCards,
    boardCards: normalizedBoardCards,
    street: getStreet(normalizedBoardCards.length),
    method,
    theoreticalOutcomes,
    counter,
    seed: method === 'simulation' ? normalizedSeed : null,
    confidenceLevel,
  });
  if (useCache) putInCache(cacheKey, result);
  return cloneResult(result);
};

/**
 * Defers the calculation so callers can schedule it from a background queue
 * without doing expensive work while fetching/rendering a training question.
 */
export const calculateHoldemEquityAsync = (options = {}) => new Promise((resolve, reject) => {
  const defer = typeof globalThis.setImmediate === 'function'
    ? globalThis.setImmediate
    : globalThis.setTimeout;
  defer(() => {
    try {
      resolve(calculateHoldemEquity(options));
    } catch (error) {
      reject(error);
    }
  }, 0);
});

export const clearEquityCache = () => equityCache.clear();
export const getEquityCacheSize = () => equityCache.size;

export const calculateEquity = calculateHoldemEquity;

const VALID_RANGE_WEIGHTS = new Set([0.25, 0.5, 0.75, 1]);

/** 169 canonical NLH hand classes, expanded with card-removal filtering. */
export const expandWeightedHandClass = ({ handClass, weight } = {}, blockedCards = []) => {
  const notation = String(handClass || '').trim().toUpperCase();
  const match = notation.match(/^([2-9TJQKA])([2-9TJQKA])([SO]?)$/);
  if (!match) throw new TypeError(`Invalid opponent hand class: ${handClass}`);
  const first = match[1];
  const second = match[2];
  const suffix = match[3];
  if (first !== second && RANKS.indexOf(first) < RANKS.indexOf(second)) {
    throw new TypeError(`Hand class must use descending ranks: ${handClass}`);
  }
  if (first === second && suffix) throw new TypeError(`Pair hand class cannot be suited or offsuit: ${handClass}`);
  if (first !== second && !suffix) throw new TypeError(`Non-pair hand class requires s or o: ${handClass}`);
  const normalizedWeight = Number(weight);
  if (!VALID_RANGE_WEIGHTS.has(normalizedWeight)) throw new TypeError(`Invalid range weight: ${weight}`);
  const blocked = new Set(blockedCards.map((card) => normalizeCard(card, 'blockedCards')));
  const cards = [];
  if (first === second) {
    for (let left = 0; left < SUITS.length; left += 1) {
      for (let right = left + 1; right < SUITS.length; right += 1) cards.push([`${first}${SUITS[left]}`, `${second}${SUITS[right]}`]);
    }
  } else if (suffix === 'S') {
    SUITS.split('').forEach((suit) => cards.push([`${first}${suit}`, `${second}${suit}`]));
  } else {
    SUITS.split('').forEach((leftSuit) => SUITS.split('').forEach((rightSuit) => {
      if (leftSuit !== rightSuit) cards.push([`${first}${leftSuit}`, `${second}${rightSuit}`]);
    }));
  }
  return cards.filter(([left, right]) => !blocked.has(left) && !blocked.has(right))
    .map((villainCards) => ({ villainCards, weight: normalizedWeight }));
};

const normalizeWeightedRange = (range, blockedCards) => {
  if (!Array.isArray(range) || range.length === 0) throw new TypeError('opponentRange must be a non-empty array');
  const seen = new Set();
  const expanded = [];
  range.forEach((entry) => {
    const handClass = String(entry?.handClass || '').trim().toUpperCase();
    if (seen.has(handClass)) throw new TypeError(`Duplicate opponent hand class: ${handClass}`);
    seen.add(handClass);
    expanded.push(...expandWeightedHandClass({ handClass, weight: entry?.weight }, blockedCards));
  });
  if (expanded.length === 0) throw new RangeError('opponentRange has no legal combinations after card removal');
  return expanded;
};

export const calculateHoldemRangeEquity = ({
  heroCards,
  opponentRange,
  boardCards = [],
  maxEnumeratedOutcomes = DEFAULT_MAX_ENUMERATED_OUTCOMES,
  simulationSamples = DEFAULT_SIMULATION_SAMPLES,
  seed,
  confidenceLevel = DEFAULT_CONFIDENCE_LEVEL,
  useCache = true,
} = {}) => {
  if (!Number.isInteger(maxEnumeratedOutcomes) || maxEnumeratedOutcomes < 1) throw new RangeError('maxEnumeratedOutcomes must be a positive integer');
  if (!Number.isInteger(simulationSamples) || simulationSamples < 1) throw new RangeError('simulationSamples must be a positive integer');
  if (confidenceLevel !== DEFAULT_CONFIDENCE_LEVEL) throw new RangeError('Only 95% confidence intervals are supported');
  const normalizedHeroCards = normalizeCardList(heroCards, 'heroCards', 2);
  const normalizedBoardCards = normalizeCardList(boardCards, 'boardCards');
  if (!SUPPORTED_BOARD_LENGTHS.has(normalizedBoardCards.length)) throw new RangeError('boardCards must contain 0, 3, 4 or 5 cards');
  const expanded = normalizeWeightedRange(opponentRange, [...normalizedHeroCards, ...normalizedBoardCards]);
  const normalizedSeed = seed == null
    ? `${EQUITY_CALCULATOR_VERSION}:range:${normalizedHeroCards.join(',')}:${normalizedBoardCards.join(',')}:${JSON.stringify(opponentRange)}`
    : String(seed);
  const cacheKey = JSON.stringify({ type: 'range', heroCards: normalizedHeroCards, boardCards: normalizedBoardCards, opponentRange, maxEnumeratedOutcomes, simulationSamples, seed: normalizedSeed, confidenceLevel });
  if (useCache && equityCache.has(cacheKey)) return cloneResult(equityCache.get(cacheKey));
  const cardsToCome = 5 - normalizedBoardCards.length;
  const combinations = expanded.map(({ villainCards, weight }) => {
    const known = new Set([...normalizedHeroCards, ...normalizedBoardCards, ...villainCards]);
    const deck = createDeck().filter((card) => !known.has(card));
    return { villainCards, weight, deck, outcomes: choose(deck.length, cardsToCome) };
  });
  const totalWeight = combinations.reduce((sum, item) => sum + item.weight, 0);
  const theoreticalOutcomes = combinations.reduce((sum, item) => sum + (item.outcomes * item.weight), 0);
  const method = theoreticalOutcomes <= maxEnumeratedOutcomes ? 'enumeration' : 'simulation';
  const counter = createOutcomeCounter();
  if (method === 'enumeration') {
    combinations.forEach(({ villainCards, weight, deck }) => {
      forEachCombination(deck, cardsToCome, (runout) => {
        const comparison = compareHoldemHands(normalizedHeroCards, villainCards, [...normalizedBoardCards, ...runout]);
        if (comparison > 0) counter.wins += weight;
        else if (comparison < 0) counter.losses += weight;
        else counter.ties += weight;
      });
    });
  } else {
    const random = createRandom(normalizedSeed);
    const cumulativeWeights = [];
    combinations.reduce((sum, item) => {
      const next = sum + item.weight;
      cumulativeWeights.push(next);
      return next;
    }, 0);
    for (let sample = 0; sample < simulationSamples; sample += 1) {
      const target = random() * totalWeight;
      let low = 0;
      let high = cumulativeWeights.length - 1;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (target < cumulativeWeights[middle]) high = middle;
        else low = middle + 1;
      }
      const selected = combinations[low] || combinations.at(-1);
      recordOutcome(counter, normalizedHeroCards, selected.villainCards, normalizedBoardCards, sampleRunout(selected.deck, cardsToCome, random));
    }
  }
  const result = buildResult({
    heroCards: normalizedHeroCards,
    villainCards: [],
    boardCards: normalizedBoardCards,
    street: getStreet(normalizedBoardCards.length),
    method,
    theoreticalOutcomes,
    counter,
    seed: method === 'simulation' ? normalizedSeed : null,
    confidenceLevel,
  });
  result.opponentRange = opponentRange.map(({ handClass, weight }) => ({ handClass: String(handClass).toUpperCase(), weight: Number(weight) }));
  result.rangeCombinationCount = expanded.length;
  if (useCache) putInCache(cacheKey, result);
  return cloneResult(result);
};
