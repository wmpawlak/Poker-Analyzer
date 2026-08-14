const HAND_RANK_VALUES = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
};

const CARD_PATTERN = /^(10|[2-9TJQKA])([cdhs])$/i;
const HOLDEM_VARIANTS = new Set(['NLH', 'NLH BombPot']);

const combinations = (items, size) => {
  if (size === 0) return [[]];
  if (items.length < size) return [];

  const result = [];
  const visit = (start, current) => {
    if (current.length === size) {
      result.push(current);
      return;
    }

    const remaining = size - current.length;
    for (let index = start; index <= items.length - remaining; index += 1) {
      visit(index + 1, [...current, items[index]]);
    }
  };

  visit(0, []);
  return result;
};

const parseCard = (card) => {
  const match = String(card || '').trim().match(CARD_PATTERN);
  if (!match) return null;

  const rankToken = match[1].toUpperCase();
  const rank = rankToken === '10' ? 10 : '23456789TJQKA'.indexOf(rankToken) + 2;
  return { rank, suit: match[2].toLowerCase() };
};

const getStraightHighCard = (ranks) => {
  const uniqueRanks = [...new Set(ranks)];
  if (uniqueRanks.includes(14)) uniqueRanks.push(1);

  for (let highCard = 14; highCard >= 5; highCard -= 1) {
    if ([0, 1, 2, 3, 4].every((offset) => uniqueRanks.includes(highCard - offset))) {
      return highCard;
    }
  }

  return null;
};

const evaluateFiveCards = (cards) => {
  const ranks = cards.map((card) => card.rank);
  const counts = new Map();
  ranks.forEach((rank) => counts.set(rank, (counts.get(rank) || 0) + 1));
  const groups = [...counts.entries()]
    .map(([rank, count]) => ({ rank, count }))
    .sort((left, right) => right.count - left.count || right.rank - left.rank);
  const isFlush = cards.every((card) => card.suit === cards[0].suit);
  const straightHighCard = getStraightHighCard(ranks);

  if (isFlush && straightHighCard !== null) return 'STRAIGHT_FLUSH';
  if (groups[0].count === 4) return 'FOUR_OF_A_KIND';
  if (groups[0].count === 3 && groups[1]?.count === 2) return 'FULL_HOUSE';
  if (isFlush) return 'FLUSH';
  if (straightHighCard !== null) return 'STRAIGHT';
  if (groups[0].count === 3) return 'THREE_OF_A_KIND';
  if (groups[0].count === 2 && groups[1]?.count === 2) return 'TWO_PAIR';
  if (groups[0].count === 2) return 'PAIR';
  return 'HIGH_CARD';
};

// The visible-hand evaluator above intentionally returns only a category.  Equity
// needs the complete showdown ordering as well, including kickers.  Keep that
// information separate so existing callers continue to receive the same string
// values from evaluateVisibleHand.
const evaluateFiveCardsDetailed = (cards) => {
  const ranks = cards.map((card) => card.rank);
  const counts = new Map();
  ranks.forEach((rank) => counts.set(rank, (counts.get(rank) || 0) + 1));
  const groups = [...counts.entries()]
    .map(([rank, count]) => ({ rank, count }))
    .sort((left, right) => right.count - left.count || right.rank - left.rank);
  const isFlush = cards.every((card) => card.suit === cards[0].suit);
  const straightHighCard = getStraightHighCard(ranks);

  if (isFlush && straightHighCard !== null) {
    return { category: 'STRAIGHT_FLUSH', vector: [8, straightHighCard] };
  }
  if (groups[0].count === 4) {
    return {
      category: 'FOUR_OF_A_KIND',
      vector: [7, groups[0].rank, groups[1].rank],
    };
  }
  if (groups[0].count === 3 && groups[1]?.count === 2) {
    return {
      category: 'FULL_HOUSE',
      vector: [6, groups[0].rank, groups[1].rank],
    };
  }
  if (isFlush) {
    return {
      category: 'FLUSH',
      vector: [5, ...ranks.sort((left, right) => right - left)],
    };
  }
  if (straightHighCard !== null) {
    return { category: 'STRAIGHT', vector: [4, straightHighCard] };
  }
  if (groups[0].count === 3) {
    return {
      category: 'THREE_OF_A_KIND',
      vector: [3, groups[0].rank, ...groups.slice(1).map(({ rank }) => rank)
        .sort((left, right) => right - left)],
    };
  }
  if (groups[0].count === 2 && groups[1]?.count === 2) {
    const pairs = groups.filter(({ count }) => count === 2)
      .map(({ rank }) => rank)
      .sort((left, right) => right - left);
    const kicker = groups.find(({ count }) => count === 1)?.rank;
    return { category: 'TWO_PAIR', vector: [2, ...pairs, kicker] };
  }
  if (groups[0].count === 2) {
    return {
      category: 'PAIR',
      vector: [1, groups[0].rank, ...groups.slice(1).map(({ rank }) => rank)
        .sort((left, right) => right - left)],
    };
  }
  return {
    category: 'HIGH_CARD',
    vector: [0, ...ranks.sort((left, right) => right - left)],
  };
};

const compareVectors = (left, right) => {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    if (leftValue !== rightValue) return leftValue > rightValue ? 1 : -1;
  }
  return 0;
};

const parseHoldemCards = (cards, name) => {
  if (!Array.isArray(cards)) throw new TypeError(`${name} must be an array`);
  const parsedCards = cards.map(parseCard);
  if (parsedCards.some((card) => !card)) {
    throw new TypeError(`${name} contains an invalid card`);
  }

  const cardKeys = parsedCards.map(({ rank, suit }) => `${rank}${suit}`);
  if (new Set(cardKeys).size !== cardKeys.length) {
    throw new RangeError(`${name} contains duplicate cards`);
  }
  return parsedCards;
};

const parseExactHoldemCards = (cards, name, expectedLength) => {
  if (!Array.isArray(cards) || cards.length !== expectedLength) {
    throw new TypeError(`${name} must contain ${expectedLength} cards`);
  }
  return parseHoldemCards(cards, name);
};

const getBestHoldemHandRankFromParsedCards = (cards) => {
  const fiveCardHands = combinations(cards, 5);
  if (fiveCardHands.length === 0) return null;

  return fiveCardHands.reduce((bestRank, fiveCardHand) => {
    const candidate = evaluateFiveCardsDetailed(fiveCardHand);
    if (!bestRank || compareVectors(candidate.vector, bestRank.vector) > 0) return candidate;
    return bestRank;
  }, null);
};

const getBestFiveCardRank = (cards) => {
  const fiveCardHands = combinations(cards, 5);
  if (fiveCardHands.length === 0) return 'NO_HAND';

  return fiveCardHands.reduce((bestRank, fiveCardHand) => {
    const rank = evaluateFiveCards(fiveCardHand);
    return HAND_RANK_VALUES[rank] > HAND_RANK_VALUES[bestRank] ? rank : bestRank;
  }, 'HIGH_CARD');
};

const evaluateVisibleBoard = (heroCards, boardCards) => {
  if (boardCards.length === 0) {
    return heroCards[0].rank === heroCards[1].rank ? 'PAIR' : 'HIGH_CARD';
  }

  const allVisibleCards = [...heroCards, ...boardCards];
  if (allVisibleCards.length >= 5) return getBestFiveCardRank(allVisibleCards);

  // Standard logs expose at least three flop cards. This fallback only
  // classifies made groups that are already visible and never completes a
  // straight, flush, or other draw with unseen cards.
  const counts = new Map();
  allVisibleCards.forEach((card) => counts.set(card.rank, (counts.get(card.rank) || 0) + 1));
  const groupedCounts = [...counts.values()].sort((left, right) => right - left);
  if (groupedCounts[0] >= 4) return 'FOUR_OF_A_KIND';
  if (groupedCounts[0] === 3 && groupedCounts[1] >= 2) return 'FULL_HOUSE';
  if (groupedCounts[0] === 3) return 'THREE_OF_A_KIND';
  if (groupedCounts[0] === 2 && groupedCounts[1] === 2) return 'TWO_PAIR';
  if (groupedCounts[0] === 2) return 'PAIR';
  return 'HIGH_CARD';
};

const normalizeEvaluatorArguments = (heroCardsOrOptions, boardCards, gameVariant) => {
  if (!Array.isArray(heroCardsOrOptions) && heroCardsOrOptions && typeof heroCardsOrOptions === 'object') {
    return {
      heroCards: heroCardsOrOptions.heroCards || [],
      boardCards: heroCardsOrOptions.boardCards || [],
      gameVariant: heroCardsOrOptions.gameVariant || 'NLH',
    };
  }

  return {
    heroCards: heroCardsOrOptions || [],
    boardCards: boardCards || [],
    gameVariant: gameVariant || 'NLH',
  };
};

/**
 * Classifies only cards present in the hand history. For BombPot, separate
 * board arrays are evaluated independently and the strongest visible result
 * is returned. PLO is intentionally unsupported here.
 */
export const evaluateVisibleHand = (heroCardsOrOptions = [], boardCards = [], gameVariant = 'NLH') => {
  const normalized = normalizeEvaluatorArguments(heroCardsOrOptions, boardCards, gameVariant);
  if (!HOLDEM_VARIANTS.has(normalized.gameVariant)) return 'NO_HAND';

  const parsedHeroCards = normalized.heroCards.map(parseCard);
  if (parsedHeroCards.length !== 2 || parsedHeroCards.some((card) => !card)) return 'NO_HAND';

  const rawBoards = normalized.boardCards.length > 0 && Array.isArray(normalized.boardCards[0])
    ? normalized.boardCards
    : [normalized.boardCards];
  const parsedBoards = rawBoards
    .map((board) => board.map(parseCard))
    .filter((board) => board.every((card) => card));

  if (parsedBoards.length === 0) return 'NO_HAND';

  return parsedBoards.reduce((bestRank, board) => {
    const rank = evaluateVisibleBoard(parsedHeroCards, board);
    return bestRank === 'NO_HAND' || HAND_RANK_VALUES[rank] > HAND_RANK_VALUES[bestRank]
      ? rank
      : bestRank;
  }, 'NO_HAND');
};

const normalizeComparisonArguments = (heroCardsOrOptions, villainCards, boardCards, gameVariant) => {
  if (!Array.isArray(heroCardsOrOptions)
    && heroCardsOrOptions
    && typeof heroCardsOrOptions === 'object') {
    return {
      heroCards: heroCardsOrOptions.heroCards || [],
      villainCards: heroCardsOrOptions.villainCards || heroCardsOrOptions.opponentCards || [],
      boardCards: heroCardsOrOptions.boardCards || [],
      gameVariant: heroCardsOrOptions.gameVariant || 'NLH',
    };
  }

  return {
    heroCards: heroCardsOrOptions || [],
    villainCards: villainCards || [],
    boardCards: boardCards || [],
    gameVariant: gameVariant || 'NLH',
  };
};

/**
 * Returns the complete NLH showdown rank, including all kickers.
 *
 * This API intentionally requires a complete five-card board.  On earlier
 * streets there is no final winner yet; callers should enumerate/simulate the
 * remaining board cards and evaluate each resulting showdown instead.
 */
export const evaluateHoldemHandRank = (holeCards, boardCards) => {
  const parsedHoleCards = parseExactHoldemCards(holeCards, 'holeCards', 2);
  const parsedBoardCards = parseExactHoldemCards(boardCards, 'boardCards', 5);

  const allCards = [...parsedHoleCards, ...parsedBoardCards];
  if (new Set(allCards.map(({ rank, suit }) => `${rank}${suit}`)).size !== allCards.length) {
    throw new RangeError('holeCards and boardCards contain duplicate cards');
  }

  return getBestHoldemHandRankFromParsedCards(allCards);
};

/**
 * Compares Hero with Villain at showdown.  The return value is 1 when Hero
 * wins, 0 for a split pot, and -1 when Villain wins.
 */
export const compareHoldemHands = (
  heroCardsOrOptions,
  villainCards,
  boardCards,
  gameVariant = 'NLH',
) => {
  const normalized = normalizeComparisonArguments(
    heroCardsOrOptions,
    villainCards,
    boardCards,
    gameVariant,
  );
  if (!HOLDEM_VARIANTS.has(normalized.gameVariant)) {
    throw new RangeError(`Unsupported game variant: ${normalized.gameVariant}`);
  }

  const heroHoleCards = parseExactHoldemCards(normalized.heroCards, 'heroCards', 2);
  const opponentHoleCards = parseExactHoldemCards(normalized.villainCards, 'villainCards', 2);
  const showdownBoard = parseExactHoldemCards(normalized.boardCards, 'boardCards', 5);

  const allCards = [...heroHoleCards, ...opponentHoleCards, ...showdownBoard];
  if (new Set(allCards.map(({ rank, suit }) => `${rank}${suit}`)).size !== allCards.length) {
    throw new RangeError('heroCards, villainCards and boardCards contain duplicate cards');
  }

  const heroRank = getBestHoldemHandRankFromParsedCards([...heroHoleCards, ...showdownBoard]);
  const villainRank = getBestHoldemHandRankFromParsedCards([...opponentHoleCards, ...showdownBoard]);
  return compareVectors(heroRank.vector, villainRank.vector);
};

/**
 * Detailed counterpart used by equity calculations and feedback.  It returns
 * both complete rank vectors while keeping compareHoldemHands convenient for
 * callers that only need win/tie/loss.
 */
export const compareHoldemHandsDetailed = (
  heroCardsOrOptions,
  villainCards,
  boardCards,
  gameVariant = 'NLH',
) => {
  const normalized = normalizeComparisonArguments(
    heroCardsOrOptions,
    villainCards,
    boardCards,
    gameVariant,
  );
  const comparison = compareHoldemHands(normalized);
  const heroCards = parseExactHoldemCards(normalized.heroCards, 'heroCards', 2);
  const opponentCards = parseExactHoldemCards(normalized.villainCards, 'villainCards', 2);
  const board = parseExactHoldemCards(normalized.boardCards, 'boardCards', 5);
  const heroRank = getBestHoldemHandRankFromParsedCards([...heroCards, ...board]);
  const villainRank = getBestHoldemHandRankFromParsedCards([...opponentCards, ...board]);
  return {
    comparison,
    result: comparison === 1 ? 'win' : comparison === -1 ? 'loss' : 'tie',
    hero: heroRank,
    villain: villainRank,
  };
};

export const evaluateHoldemHand = evaluateVisibleHand;
