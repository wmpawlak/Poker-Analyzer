const RANK_ORDER = Object.freeze({
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
});

const CARD_PATTERN = /^([2-9TJQKA])([cdhs])$/i;

export const classifyHeroHand = (cards) => {
  if (!Array.isArray(cards) || cards.length !== 2) return null;
  const parsed = cards.map((card) => {
    const match = String(card || '').trim().match(CARD_PATTERN);
    if (!match) return null;
    return { rank: match[1].toUpperCase(), suit: match[2].toLowerCase() };
  });
  if (parsed.some((card) => !card)) return null;

  const [first, second] = parsed;
  if (first.rank === second.rank) return { notation: `${first.rank}${second.rank}`, class: 'pair' };
  const [high, low] = [first, second].sort((left, right) => RANK_ORDER[right.rank] - RANK_ORDER[left.rank]);
  return {
    notation: `${high.rank}${low.rank}${first.suit === second.suit ? 's' : 'o'}`,
    class: first.suit === second.suit ? 'suited' : 'offsuit',
  };
};

export const HERO_HAND_CLASSES = Object.freeze(['offsuit', 'suited', 'pair']);
