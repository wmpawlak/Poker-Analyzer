import { evaluateVisibleHand } from '../../src/parser/handEvaluator.js';

export const CARD_FACTS_VALIDATION_VERSION = 1;
export const CARD_SUITS = Object.freeze(['c', 'd', 'h', 's']);
export const MADE_HANDS = Object.freeze([
  'HIGH_CARD',
  'PAIR',
  'TWO_PAIR',
  'THREE_OF_A_KIND',
  'STRAIGHT',
  'FLUSH',
  'FULL_HOUSE',
  'FOUR_OF_A_KIND',
  'STRAIGHT_FLUSH',
]);
export const FLUSH_STATUSES = Object.freeze(['made', 'draw', 'backdoor_draw', 'none']);

const emptySuitCounts = () => Object.fromEntries(CARD_SUITS.map((suit) => [suit, 0]));

const countSuits = (cards) => {
  const counts = emptySuitCounts();
  (Array.isArray(cards) ? cards : []).forEach((card) => {
    const suit = String(card || '').trim().slice(-1).toLowerCase();
    if (CARD_SUITS.includes(suit)) counts[suit] += 1;
  });
  return counts;
};

const maxSuitCount = (heroSuitCounts, boardSuitCounts) => Math.max(
  ...CARD_SUITS.map((suit) => heroSuitCounts[suit] + boardSuitCounts[suit]),
);

const getFlushStatus = (maxVisibleSuitCount, cardsToCome) => {
  if (maxVisibleSuitCount >= 5) return 'made';
  if (maxVisibleSuitCount === 4 && cardsToCome >= 1) return 'draw';
  if (maxVisibleSuitCount === 3 && cardsToCome === 2) return 'backdoor_draw';
  return 'none';
};

/**
 * Calculates card facts from the state visible before a decision. It never
 * reads historical actions, showdown data, or cards that are not on the
 * current board.
 */
export const computeDecisionCardFacts = ({ heroCards = [], board = [], boardCards } = {}) => {
  const normalizedHeroCards = Array.isArray(heroCards) ? heroCards.map(String) : [];
  const normalizedBoard = Array.isArray(boardCards)
    ? boardCards.map(String)
    : (Array.isArray(board) ? board.map(String) : []);
  const heroSuitCounts = countSuits(normalizedHeroCards);
  const boardSuitCounts = countSuits(normalizedBoard);
  const cardsToCome = Math.max(0, 5 - normalizedBoard.length);
  const maxVisibleSuitCount = maxSuitCount(heroSuitCounts, boardSuitCounts);

  return {
    madeHand: evaluateVisibleHand({
      heroCards: normalizedHeroCards,
      boardCards: normalizedBoard,
      gameVariant: 'NLH',
    }),
    flushStatus: getFlushStatus(maxVisibleSuitCount, cardsToCome),
    cardsToCome,
    suitCounts: {
      hero: heroSuitCounts,
      board: boardSuitCounts,
    },
  };
};

export const sameDecisionCardFacts = (left, right) => (
  Boolean(left) && Boolean(right) && JSON.stringify(left) === JSON.stringify(right)
);
