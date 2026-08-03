export const STARTING_HAND_RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];

const RANK_ORDER = '23456789TJQKA';

const createStartingHandsMap = () => {
  const handsMap = {};

  STARTING_HAND_RANKS.forEach((rank) => {
    const key = rank + rank;
    handsMap[key] = {
      key,
      type: 'pair',
      labelText: 'Para',
      cards: [`${rank.toLowerCase()}s`, `${rank.toLowerCase()}h`],
      count: 0,
      wins: 0,
      losses: 0,
    };
  });

  for (let highIndex = 0; highIndex < STARTING_HAND_RANKS.length; highIndex++) {
    for (let lowIndex = highIndex + 1; lowIndex < STARTING_HAND_RANKS.length; lowIndex++) {
      const high = STARTING_HAND_RANKS[highIndex];
      const low = STARTING_HAND_RANKS[lowIndex];

      handsMap[`${high}${low}s`] = {
        key: `${high}${low}s`,
        type: 'suited',
        labelText: 'Suited',
        cards: [`${high.toLowerCase()}s`, `${low.toLowerCase()}s`],
        count: 0,
        wins: 0,
        losses: 0,
      };
      handsMap[`${high}${low}o`] = {
        key: `${high}${low}o`,
        type: 'offsuit',
        labelText: 'Off-suit',
        cards: [`${high.toLowerCase()}s`, `${low.toLowerCase()}h`],
        count: 0,
        wins: 0,
        losses: 0,
      };
    }
  }

  return handsMap;
};

const getStartingHandKey = (heroCards) => {
  if (!Array.isArray(heroCards) || heroCards.length !== 2) return null;

  const [firstCard, secondCard] = heroCards;
  if (typeof firstCard !== 'string' || typeof secondCard !== 'string' || firstCard.length < 2 || secondCard.length < 2) {
    return null;
  }

  const firstRank = firstCard[0].toUpperCase();
  const secondRank = secondCard[0].toUpperCase();
  const firstSuit = firstCard[1].toLowerCase();
  const secondSuit = secondCard[1].toLowerCase();
  if (!RANK_ORDER.includes(firstRank) || !RANK_ORDER.includes(secondRank)) return null;

  if (firstRank === secondRank) return firstRank + secondRank;

  const firstIsHigher = RANK_ORDER.indexOf(firstRank) > RANK_ORDER.indexOf(secondRank);
  const highRank = firstIsHigher ? firstRank : secondRank;
  const lowRank = firstIsHigher ? secondRank : firstRank;
  return highRank + lowRank + (firstSuit === secondSuit ? 's' : 'o');
};

export const getWinRateColorTier = (winRate, count) => {
  if (count <= 0) return 'none';
  if (count < 10) return 'insufficient';
  if (winRate < 25) return 'critical';
  if (winRate < 45) return 'pink';
  if (winRate <= 55) return 'yellow';
  if (winRate < 70) return 'light-green';
  if (winRate < 85) return 'green';
  return 'dark-green';
};

export const buildStartingHandStats = (hands = [], { riverOrShowdownOnly = false } = {}) => {
  const handsMap = createStartingHandsMap();
  let totalWins = 0;

  hands.forEach((hand) => {
    if (riverOrShowdownOnly && !hand.heroReachedRiverOrShowdown) return;

    const lookupKey = getStartingHandKey(hand.heroCards);
    if (!lookupKey || !handsMap[lookupKey]) return;

    const stats = handsMap[lookupKey];
    stats.count += 1;
    if (hand.outcome === 'WON') {
      stats.wins += 1;
      totalWins += 1;
    } else {
      stats.losses += 1;
    }
  });

  return Object.values(handsMap).map((stats) => {
    const winRate = stats.count > 0 ? (stats.wins / stats.count) * 100 : 0;
    return {
      ...stats,
      winRate,
      winContribution: totalWins > 0 ? (stats.wins / totalWins) * 100 : 0,
      colorTier: getWinRateColorTier(winRate, stats.count),
    };
  });
};
