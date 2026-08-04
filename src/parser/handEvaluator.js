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

export const evaluateHoldemHand = evaluateVisibleHand;
