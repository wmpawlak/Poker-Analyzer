// src/parser/pokerParser.js

import { evaluateVisibleHand } from './handEvaluator.js';

export { evaluateHoldemHand, evaluateVisibleHand } from './handEvaluator.js';

// Zwiększyć przy każdej zmianie, która może wpłynąć na postać danych
// parsowanych albo agregatów zależnych od parsera.
export const PARSER_VERSION = 1;

export const GAME_VARIANTS = Object.freeze({
  NLH: 'NLH',
  NLH_BOMB_POT: 'NLH BombPot',
  PLO_4: 'PLO 4',
});

export const HAND_PARSE_ISSUES = Object.freeze({
  EMPTY_SECTION: 'EMPTY_SECTION',
  MISSING_HAND_ID: 'MISSING_HAND_ID',
  INVALID_PLAYED_AT: 'INVALID_PLAYED_AT',
  PARSE_ERROR: 'PARSE_ERROR',
});

// Kanoniczna reprezentacja tekstu jest współdzielona z repozytorium JSONL.
// Dzięki temu ten sam eksport, niezależnie od BOM-u lub końców linii, zawsze
// ma taki sam hash zawartości.
export const normalizeRawHandText = (rawText) => String(rawText ?? '')
  .replace(/^\uFEFF/, '')
  .replace(/\r\n?/g, '\n')
  .trim();

export const detectGameVariant = (rawHand) => {
  const headerMatch = String(rawHand || '').match(/CoinPoker Hand #\d+:\s*([^\r\n(]+)/i);
  const gameDescription = headerMatch?.[1]?.trim() || '';

  if (/\bPLO\s*4\b/i.test(gameDescription) || /\bPLO\b/i.test(gameDescription)) {
    return GAME_VARIANTS.PLO_4;
  }
  if (/\bNLH\s+BombPot\b/i.test(gameDescription)) return GAME_VARIANTS.NLH_BOMB_POT;
  return GAME_VARIANTS.NLH;
};

const parsePokerDate = (dateStr) => {
  const cleanStr = String(dateStr || '').replace(/\b(?:CE[S]?T|GMT|UTC)\b/gi, '').trim();
  const match = cleanStr.match(/^(\d{4})[-/](\d{2})[-/](\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return null;

  const [, yearValue, monthValue, dayValue, hourValue = '00', minuteValue = '00', secondValue = '00'] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  const second = Number(secondValue);
  const validationDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  if (validationDate.getUTCFullYear() !== year
    || validationDate.getUTCMonth() !== month - 1
    || validationDate.getUTCDate() !== day
    || validationDate.getUTCHours() !== hour
    || validationDate.getUTCMinutes() !== minute
    || validationDate.getUTCSeconds() !== second) {
    return null;
  }

  const parsed = new Date(`${yearValue}-${monthValue}-${dayValue}T${hourValue}:${minuteValue}:${secondValue}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseChips = (valStr) => {
  if (!valStr) return 0;
  if (typeof valStr === 'number') return valStr;
  return parseFloat(valStr.replace(/[^\d.-]/g, '')) || 0;
};

export const normalizeHandRanking = (value) => {
  const normalized = (value || '').trim().toLowerCase();
  if (!normalized) return 'NO_HAND';
  if (/straight\s*flush|royal\s*flush|\bpoker\b/.test(normalized)) return 'STRAIGHT_FLUSH';
  if (/four of a kind|quads?|kareta/.test(normalized)) return 'FOUR_OF_A_KIND';
  if (/full house|full\b/.test(normalized)) return 'FULL_HOUSE';
  if (/flush|kolor/.test(normalized)) return 'FLUSH';
  if (/straight|strit/.test(normalized)) return 'STRAIGHT';
  if (/three of a kind|trips?|set\b|trójka/.test(normalized)) return 'THREE_OF_A_KIND';
  if (/two pair|dwie pary/.test(normalized)) return 'TWO_PAIR';
  if (/one pair|\bpair\b|para/.test(normalized)) return 'PAIR';
  if (/high card|wysoka karta/.test(normalized)) return 'HIGH_CARD';
  return 'NO_HAND';
};

const getSummaryHeroLines = (rawHand) => {
  const summaryMatch = rawHand.match(/^\*\*\* SUMMARY \*\*\*\s*([\s\S]*)$/im);
  if (!summaryMatch) return [];

  return summaryMatch[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^Seat \d+:\s+Hero(?:\s|:|$)/i.test(line));
};

const getSummaryWinnings = (summaryLine) => {
  const parenthesizedWins = [...summaryLine.matchAll(/\b(?:and\s+won|collected)\s*\([^\d]*([\d.,]+)\)/gi)];
  if (parenthesizedWins.length > 0) {
    return parenthesizedWins.reduce((total, match) => total + parseChips(match[1]), 0);
  }

  const collectedMatch = summaryLine.match(/\bcollected\s+[^\d]*([\d.,]+)/i);
  return collectedMatch ? parseChips(collectedMatch[1]) : 0;
};

const parseBoardCards = (value) => value.split(/\s+/).filter(Boolean);

const getHeroCards = (rawHand) => {
  const dealtMatch = rawHand.match(/Dealt to Hero\s+\[([^\]]+)\]/i);
  const exposedMatch = rawHand.match(/(?:^|\n)(?:Hero:|Seat \d+:\s+Hero)\s+(?:shows?|showed|mucks?|mucked)\s+\[([^\]]+)\]/im);
  const cardsMatch = dealtMatch || exposedMatch;
  return cardsMatch ? cardsMatch[1].split(/\s+/).filter(Boolean) : [];
};

const getVisibleBoardSets = (rawHand, streets) => {
  const summaryBoards = [...rawHand.matchAll(/^\s*(?:(FIRST|SECOND|THIRD)\s+)?Board\s*\[\s*([^\]]*)\s*\]/gim)]
    .map((match) => ({
      boardIndex: BOARD_INDEX_BY_PREFIX[match[1]?.toUpperCase() || ''] || 1,
      cards: parseBoardCards(match[2]),
    }))
    .filter(({ cards }) => cards.length > 0);

  if (summaryBoards.length > 0) {
    const groupedBoards = new Map();
    summaryBoards.forEach(({ boardIndex, cards }) => groupedBoards.set(boardIndex, cards));
    return [...groupedBoards.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, cards]) => cards);
  }

  const boards = new Map();
  streets
    .filter((street) => ['FLOP', 'TURN', 'RIVER'].includes(street.name))
    .forEach((street) => {
      const boardIndex = street.boardIndex || 1;
      const currentCards = boards.get(boardIndex) || [];
      const nextCards = street.name === 'FLOP'
        ? [...street.cards]
        : [...currentCards, ...street.cards.filter((card) => !currentCards.includes(card))];
      boards.set(boardIndex, nextCards);
    });

  return [...boards.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, cards]) => cards)
    .filter((cards) => cards.length > 0);
};

const STREET_HEADER_PATTERN = /^\*\*\*\s+(?:(FIRST|SECOND|THIRD)\s+)?(HOLE CARDS|FLOP|TURN|RIVER|SHOWDOWN|SUMMARY)\s*\*\*\*(.*)$/i;
const BOARD_INDEX_BY_PREFIX = { FIRST: 1, SECOND: 2, THIRD: 3 };

const roundChips = (value) => parseFloat((value || 0).toFixed(2));

const createCounter = (opportunities = 0, executions = 0) => ({ opportunities, executions });

const getStreetHeader = (line) => {
  const match = line.match(STREET_HEADER_PATTERN);
  if (!match) return null;

  const prefix = match[1]?.toUpperCase() || '';
  const sourceName = match[2].toUpperCase();
  const name = sourceName === 'HOLE CARDS' ? 'PRE-FLOP' : sourceName;
  return {
    name,
    suffix: match[3] || '',
    boardIndex: BOARD_INDEX_BY_PREFIX[prefix] || null,
    displayName: prefix ? `${prefix} ${name}` : name,
  };
};

const parseHeaderBlinds = (rawHand) => {
  const match = rawHand.match(/CoinPoker Hand #\d+:\s*[^\r\n]*?\(([^)]+)\)/i);
  if (!match) return { blinds: '', smallBlind: 0, bigBlind: 0, ante: 0 };

  const amounts = match[1].split('/').map((value) => parseChips(value));
  return {
    blinds: match[1].trim(),
    smallBlind: amounts[0] || 0,
    bigBlind: amounts[1] || 0,
    ante: amounts[2] || 0,
  };
};

const getHeroPosition = (rawHand, activeSeats) => {
  if (activeSeats.length < 2) return 'UNKNOWN';

  const sortedSeats = [...activeSeats].sort((a, b) => a.seatNum - b.seatNum);
  const bbMatch = rawHand.match(/^([^:\r\n]+):\s+posts\s+(?:small\s*&\s*)?big blind\b/im);
  let bbIndex = -1;

  if (bbMatch) {
    bbIndex = sortedSeats.findIndex((seat) => seat.playerId === bbMatch[1].trim());
  }

  if (bbIndex === -1) {
    const buttonMatch = rawHand.match(/Seat #(\d+) is the button/i);
    if (buttonMatch) {
      const buttonSeat = parseInt(buttonMatch[1], 10);
      const buttonIndex = sortedSeats.findIndex((seat) => seat.seatNum === buttonSeat);
      if (buttonIndex !== -1) {
        bbIndex = sortedSeats.length === 2
          ? (buttonIndex + 1) % sortedSeats.length
          : (buttonIndex + 2) % sortedSeats.length;
      }
    }
  }

  const heroIndex = sortedSeats.findIndex((seat) => seat.playerId === 'Hero');
  if (heroIndex === -1 || bbIndex === -1) return 'UNKNOWN';

  const playerCount = sortedSeats.length;
  const distanceFromBigBlind = (heroIndex - bbIndex + playerCount) % playerCount;
  let positionMap = [];
  if (playerCount === 2) positionMap = ['BB', 'BTN'];
  else if (playerCount === 3) positionMap = ['BB', 'BTN', 'SB'];
  else if (playerCount === 4) positionMap = ['BB', 'CO', 'BTN', 'SB'];
  else if (playerCount === 5) positionMap = ['BB', 'HJ', 'CO', 'BTN', 'SB'];
  else if (playerCount === 6) positionMap = ['BB', 'UTG', 'HJ', 'CO', 'BTN', 'SB'];
  else if (playerCount === 7) positionMap = ['BB', 'UTG', 'UTG+1', 'HJ', 'CO', 'BTN', 'SB'];
  else if (playerCount === 8) positionMap = ['BB', 'UTG', 'UTG+1', 'UTG+2', 'HJ', 'CO', 'BTN', 'SB'];
  else if (playerCount >= 9) positionMap = ['BB', 'UTG', 'UTG+1', 'UTG+2', 'UTG+3', 'HJ', 'CO', 'BTN', 'SB'];

  return positionMap[distanceFromBigBlind] || 'UNKNOWN';
};

const getAmountFromAction = (value) => {
  const match = value.match(/[^\d]*([\d.,]+)/);
  return match ? parseChips(match[1]) : 0;
};

const parseActionLine = (line) => {
  const match = line.match(/^(.+?):\s+(.+)$/);
  if (!match) return null;

  const actor = match[1].trim();
  const action = match[2].trim();
  const postAction = action.match(/^posts\s+(.+?)(?:\s+ALLIN)?$/i);
  if (postAction) {
    const amountMatch = postAction[1].match(/([\d.,]+)\s*$/);
    if (amountMatch) {
      const postType = postAction[1].slice(0, amountMatch.index).trim().toLowerCase();
      const amount = parseChips(amountMatch[1]);
      if (/\bante\b/.test(postType)) return { actor, rawType: 'ANTE', amount, forced: true, live: false };
      if (/\bstraddle\b/.test(postType)) return { actor, rawType: 'STRADDLE', amount, forced: false, live: true };
      if (/auto\s+big\s+blind/.test(postType)) return { actor, rawType: 'AUTO_BB_POST', amount, forced: true, live: false };
      if (/small\s*&\s*big\s+blind/.test(postType)) return { actor, rawType: 'SMALL_BIG_BLIND', amount, forced: true, live: true };
      if (/small\s+blind/.test(postType)) return { actor, rawType: 'SMALL_BLIND', amount, forced: true, live: true };
      if (/big\s+blind/.test(postType)) return { actor, rawType: 'BIG_BLIND', amount, forced: true, live: true };
    }
  }

  if (/^STRADDLE\b/i.test(action)) return { actor, rawType: 'STRADDLE', amount: getAmountFromAction(action), forced: false, live: true };
  if (/^AUTOBB\b/i.test(action)) return { actor, rawType: 'AUTOBB', amount: getAmountFromAction(action), forced: true, live: true };
  if (/^RETURN\b/i.test(action)) return { actor, rawType: 'RETURN', amount: getAmountFromAction(action), forced: false, live: false };
  if (/^folds\b/i.test(action)) return { actor, rawType: 'FOLD', amount: 0, forced: false, live: false };
  if (/^checks\b/i.test(action)) return { actor, rawType: 'CHECK', amount: 0, forced: false, live: false };

  const raiseMatch = action.match(/^raises\s+[^\d]*([\d.,]+)\s+to\s+[^\d]*([\d.,]+)/i);
  if (raiseMatch) {
    return {
      actor,
      rawType: 'RAISE',
      amount: parseChips(raiseMatch[1]),
      toAmount: parseChips(raiseMatch[2]),
      forced: false,
      live: true,
    };
  }
  if (/^calls\b/i.test(action)) return { actor, rawType: 'CALL', amount: getAmountFromAction(action), forced: false, live: true };
  if (/^bets\b/i.test(action)) return { actor, rawType: 'BET', amount: getAmountFromAction(action), forced: false, live: true };
  if (/^ALLIN\b/i.test(action)) return { actor, rawType: 'ALLIN', amount: getAmountFromAction(action), forced: false, live: true };

  return null;
};

const addToObject = (object, key, value) => {
  object[key] = (object[key] || 0) + value;
};

const POSTFLOP_STREETS = ['FLOP', 'TURN', 'RIVER'];
const EPSILON = 0.000001;

const createAggressionCounter = () => ({ betsRaises: 0, calls: 0 });

const isAggressiveAction = (event) => ['bet', 'raise'].includes(event.type);
const isPostflopDecision = (event) => !event.forced
  && ['bet', 'raise', 'call', 'fold', 'check'].includes(event.type);
const isPrimaryFlopEvent = (event) => event.street === 'FLOP'
  && (event.boardIndex === null || event.boardIndex === 1);

const createPostflopStats = ({ normalizedActions, heroSawFlop }) => {
  const aggression = {
    total: createAggressionCounter(),
    flop: createAggressionCounter(),
    turn: createAggressionCounter(),
    river: createAggressionCounter(),
  };
  const cBet = createCounter();
  const cBetSrp = createCounter();
  const foldToCBet = createCounter();

  normalizedActions.events.forEach((event) => {
    if (event.actor !== 'Hero' || !POSTFLOP_STREETS.includes(event.street)) return;

    const streetAggression = aggression[event.street.toLowerCase()];
    if (isAggressiveAction(event)) {
      aggression.total.betsRaises += 1;
      streetAggression.betsRaises += 1;
    } else if (event.type === 'call') {
      aggression.total.calls += 1;
      streetAggression.calls += 1;
    }
  });

  const flopEvents = normalizedActions.events.filter(isPrimaryFlopEvent);
  const preflopAggressor = normalizedActions.lastPreflopAggressor;

  // C-bet oznacza pierwszy flopowy bet/raise preflopowego agresora w sytuacji,
  // w której jeszcze nie ma zakładu. Przechowujemy liczniki, a nie stosunki,
  // aby agregator sesji dzielił sumy zamiast średnich z pojedynczych rąk.
  if (heroSawFlop && preflopAggressor === 'Hero') {
    const heroFlopDecision = flopEvents.find((event) => event.actor === 'Hero'
      && isPostflopDecision(event)
      && event.highBefore <= EPSILON);

    if (heroFlopDecision) {
      cBet.opportunities += 1;
      if (isAggressiveAction(heroFlopDecision)) cBet.executions += 1;

      if (normalizedActions.totalPreflopRaises === 1) {
        cBetSrp.opportunities += 1;
        if (isAggressiveAction(heroFlopDecision)) cBetSrp.executions += 1;
      }
    }
  }

  if (heroSawFlop && preflopAggressor && preflopAggressor !== 'Hero') {
    const cBetIndex = flopEvents.findIndex((event) => event.actor === preflopAggressor
      && isAggressiveAction(event)
      && event.highBefore <= EPSILON);

    if (cBetIndex !== -1) {
      const cBetEvent = flopEvents[cBetIndex];
      const cBetHigh = cBetEvent.contributionAfter;
      let heroResponse = null;

      for (let index = cBetIndex + 1; index < flopEvents.length; index += 1) {
        const event = flopEvents[index];

        if (event.actor === 'Hero' && isPostflopDecision(event)) {
          if (event.highBefore <= cBetHigh + EPSILON) heroResponse = event;
          break;
        }

        // Gdy ktoś przebił c-beta zanim Hero dostał ruch, Hero nie reaguje już
        // bezpośrednio na c-beta, więc nie tworzymy sztucznej okazji Fold to C-bet.
        if (event.actor !== preflopAggressor
          && isAggressiveAction(event)
          && event.contributionAfter > cBetHigh + EPSILON) {
          break;
        }
      }

      if (heroResponse) {
        foldToCBet.opportunities += 1;
        if (heroResponse.type === 'fold') foldToCBet.executions += 1;
      }
    }
  }

  return {
    betsRaises: aggression.total.betsRaises,
    calls: aggression.total.calls,
    aggression,
    cBet,
    cBetSrp,
    foldToCBet,
  };
};

const createShowdownStats = ({ heroSawFlop, sawShowdown, hasSummaryOutcome, outcome }) => ({
  wtsd: createCounter(heroSawFlop ? 1 : 0, heroSawFlop && sawShowdown ? 1 : 0),
  // `outcome` pochodzi wyłącznie z CoinPoker SUMMARY; pokazanie/muckowanie
  // kart zachowuje istniejącą, precyzyjną definicję dojścia Hero do showdownu.
  wsd: createCounter(
    sawShowdown && hasSummaryOutcome ? 1 : 0,
    sawShowdown && hasSummaryOutcome && outcome === 'WON' ? 1 : 0,
  ),
});

const normalizeHandActions = (lines) => {
  let streetName = 'PRE-FLOP';
  let streetBoardIndex = null;
  let streetContributions = Object.create(null);
  let streetHighContribution = 0;
  let preflopRaiseLevel = 0;
  let totalPreflopRaises = 0;
  let lastPreflopAggressor = null;
  let hasStraddle = false;
  let hasAutoBigBlind = false;
  const playerInvestments = Object.create(null);
  const playerReturns = Object.create(null);
  const events = [];

  for (const line of lines) {
    const header = getStreetHeader(line);
    if (header) {
      streetName = header.name;
      streetBoardIndex = POSTFLOP_STREETS.includes(streetName) ? (header.boardIndex || 1) : null;
      if (POSTFLOP_STREETS.includes(streetName)) {
        streetContributions = Object.create(null);
        streetHighContribution = 0;
      }
      continue;
    }

    const parsed = parseActionLine(line);
    if (!parsed) continue;

    const contributionBefore = streetContributions[parsed.actor] || 0;
    const highBefore = streetHighContribution;
    const event = {
      actor: parsed.actor,
      street: streetName,
      boardIndex: streetBoardIndex,
      rawType: parsed.rawType,
      type: parsed.rawType.toLowerCase(),
      amount: parsed.amount,
      contributionBefore,
      contributionAfter: contributionBefore,
      highBefore,
      preflopRaiseLevelBefore: preflopRaiseLevel,
      preflopRaiseLevelAfter: preflopRaiseLevel,
      forced: parsed.forced,
    };

    if (parsed.rawType === 'RETURN') {
      addToObject(playerReturns, parsed.actor, parsed.amount);
      streetContributions[parsed.actor] = Math.max(0, contributionBefore - parsed.amount);
      event.type = 'return';
      event.contributionAfter = streetContributions[parsed.actor];
      events.push(event);
      continue;
    }

    if (['ANTE', 'SMALL_BLIND', 'BIG_BLIND', 'SMALL_BIG_BLIND', 'AUTO_BB_POST', 'AUTOBB', 'STRADDLE'].includes(parsed.rawType)) {
      addToObject(playerInvestments, parsed.actor, parsed.amount);
      if (parsed.rawType === 'STRADDLE') hasStraddle = true;
      if (['AUTO_BB_POST', 'AUTOBB'].includes(parsed.rawType)) hasAutoBigBlind = true;
      if (parsed.live) {
        streetContributions[parsed.actor] = contributionBefore + parsed.amount;
        streetHighContribution = Math.max(streetHighContribution, streetContributions[parsed.actor]);
        event.contributionAfter = streetContributions[parsed.actor];
      }
      event.type = parsed.rawType === 'STRADDLE' ? 'straddle' : 'forced';
      events.push(event);
      continue;
    }

    if (!['PRE-FLOP', ...POSTFLOP_STREETS].includes(streetName)) {
      events.push(event);
      continue;
    }

    let contributionAfter = contributionBefore;
    if (parsed.rawType === 'RAISE') contributionAfter = Math.max(contributionBefore, parsed.toAmount);
    else if (['CALL', 'BET', 'ALLIN'].includes(parsed.rawType)) contributionAfter += parsed.amount;

    const delta = Math.max(0, contributionAfter - contributionBefore);
    if (delta > 0) addToObject(playerInvestments, parsed.actor, delta);
    streetContributions[parsed.actor] = contributionAfter;
    event.contributionAfter = contributionAfter;
    event.delta = delta;

    if (parsed.rawType === 'RAISE') {
      event.type = contributionAfter > highBefore ? 'raise' : 'call';
    } else if (parsed.rawType === 'BET') {
      event.type = contributionAfter > highBefore ? 'bet' : 'call';
    } else if (parsed.rawType === 'ALLIN') {
      event.type = contributionAfter > highBefore ? (highBefore > 0 ? 'raise' : 'bet') : 'call';
    } else if (parsed.rawType === 'CALL') {
      event.type = 'call';
    } else if (parsed.rawType === 'FOLD') {
      event.type = 'fold';
    } else if (parsed.rawType === 'CHECK') {
      event.type = 'check';
    }

    if (['raise', 'bet'].includes(event.type)) {
      streetHighContribution = Math.max(streetHighContribution, contributionAfter);
    }

    if (streetName === 'PRE-FLOP' && ['raise', 'bet'].includes(event.type)) {
      preflopRaiseLevel += 1;
      totalPreflopRaises += 1;
      lastPreflopAggressor = parsed.actor;
      event.preflopRaiseLevelAfter = preflopRaiseLevel;
    }
    events.push(event);
  }

  return {
    events,
    heroInvestment: roundChips((playerInvestments.Hero || 0) - (playerReturns.Hero || 0)),
    heroPostFlopBetsRaises: events.filter((event) => event.actor === 'Hero' && POSTFLOP_STREETS.includes(event.street) && ['bet', 'raise'].includes(event.type)).length,
    heroPostFlopCalls: events.filter((event) => event.actor === 'Hero' && POSTFLOP_STREETS.includes(event.street) && event.type === 'call').length,
    hasStraddle,
    hasAutoBigBlind,
    totalPreflopRaises,
    lastPreflopAggressor,
  };
};

const createHeroStats = ({
  position,
  playerCount,
  normalizedActions,
  heroSawFlop,
  sawShowdown,
  hasSummaryOutcome,
  outcome,
}) => {
  const rfiPosition = playerCount === 2 && position === 'BTN' ? 'BTN/SB' : position;
  const rfiByPosition = {
    CO: createCounter(),
    BTN: createCounter(),
    SB: createCounter(),
    'BTN/SB': createCounter(),
  };
  const postflop = createPostflopStats({ normalizedActions, heroSawFlop });
  const stats = {
    preflop: {
      vpip: createCounter(1),
      pfr: createCounter(1),
      threeBet: createCounter(),
      foldToThreeBet: createCounter(),
      fourBet: createCounter(),
      rfi: createCounter(),
      rfiByPosition,
      totalRaiseCount: normalizedActions.totalPreflopRaises,
      heroRaiseCount: 0,
      heroWasFinalAggressor: normalizedActions.lastPreflopAggressor === 'Hero',
      heroHadDecision: false,
      heroWentAllIn: false,
      heroCallCount: 0,
      hasStraddle: normalizedActions.hasStraddle,
      hasAutoBigBlind: normalizedActions.hasAutoBigBlind,
    },
    postflop,
    showdown: createShowdownStats({ heroSawFlop, sawShowdown, hasSummaryOutcome, outcome }),
  };

  let firstHeroDecisionSeen = false;
  let nonFoldActionBeforeHero = false;
  let threeBetDecisionSeen = false;
  let heroOpened = false;
  let facingThreeBet = false;

  const isAggressive = (event) => ['raise', 'bet'].includes(event.type);
  const isVoluntary = (event) => ['call', 'raise', 'bet'].includes(event.type);

  normalizedActions.events
    .filter((event) => event.street === 'PRE-FLOP')
    .forEach((event) => {
      if (event.rawType === 'STRADDLE' && event.actor === 'Hero') {
        stats.preflop.vpip.executions = 1;
        return;
      }
      if (event.forced || event.rawType === 'STRADDLE') return;

      if (event.actor !== 'Hero') {
        if (!firstHeroDecisionSeen && event.type !== 'fold') nonFoldActionBeforeHero = true;
        if (heroOpened && isAggressive(event) && event.preflopRaiseLevelBefore === 1) {
          facingThreeBet = true;
        }
        if (facingThreeBet && isAggressive(event) && event.preflopRaiseLevelBefore >= 2) {
          facingThreeBet = false;
        }
        return;
      }

      stats.preflop.heroHadDecision = true;
      if (event.rawType === 'ALLIN') stats.preflop.heroWentAllIn = true;
      if (event.rawType === 'CALL') stats.preflop.heroCallCount += 1;

      if (!firstHeroDecisionSeen) {
        firstHeroDecisionSeen = true;
        if (rfiByPosition[rfiPosition] && !nonFoldActionBeforeHero && !normalizedActions.hasStraddle && !normalizedActions.hasAutoBigBlind) {
          stats.preflop.rfi.opportunities += 1;
          rfiByPosition[rfiPosition].opportunities += 1;
          if (isAggressive(event) && event.preflopRaiseLevelBefore === 0) {
            stats.preflop.rfi.executions += 1;
            rfiByPosition[rfiPosition].executions += 1;
          }
        }
      }

      if (isVoluntary(event)) stats.preflop.vpip.executions = 1;
      if (isAggressive(event)) {
        stats.preflop.pfr.executions = 1;
        stats.preflop.heroRaiseCount += 1;
      }

      if (!threeBetDecisionSeen && event.preflopRaiseLevelBefore === 1) {
        stats.preflop.threeBet.opportunities += 1;
        if (isAggressive(event)) stats.preflop.threeBet.executions += 1;
        threeBetDecisionSeen = true;
      }

      if (facingThreeBet && event.preflopRaiseLevelBefore === 2) {
        stats.preflop.foldToThreeBet.opportunities += 1;
        stats.preflop.fourBet.opportunities += 1;
        if (event.type === 'fold') stats.preflop.foldToThreeBet.executions += 1;
        if (isAggressive(event)) stats.preflop.fourBet.executions += 1;
        facingThreeBet = false;
      }

      if (isAggressive(event) && event.preflopRaiseLevelBefore === 0) heroOpened = true;
    });

  return stats;
};

const buildStreetBlocks = (rawHand) => {
  const streetBlocks = rawHand.split(/(?=^\*\*\*\s+(?:(?:FIRST|SECOND|THIRD)\s+)?(?:HOLE CARDS|FLOP|TURN|RIVER|SHOWDOWN|SUMMARY)\s+\*\*\*)/im);
  const streets = [];

  streetBlocks.forEach((block) => {
    if (!block.trim()) return;
    const blockLines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const header = getStreetHeader(blockLines[0] || '');
    if (!header) return;

    let cards = [];
    if (['FLOP', 'TURN', 'RIVER'].includes(header.name)) {
      const brackets = [...header.suffix.matchAll(/\[(.*?)\]/g)];
      if (brackets.length > 0) cards = brackets.at(-1)[1].split(' ').filter(Boolean);
    }

    const lines = blockLines.slice(1).filter((line) => !line.startsWith('Dealt to')
      && !line.startsWith('Total pot')
      && !line.startsWith('Board')
      && !line.startsWith('Hand was')
      && !line.startsWith('Game ended'));

    if (lines.length > 0 || cards.length > 0) {
      streets.push({
        name: header.name,
        displayName: header.displayName,
        boardIndex: header.boardIndex,
        cards,
        lines,
      });
    }
  });

  return streets;
};

export const parseSingleRawHand = (rawText) => {
  const rawHand = normalizeRawHandText(rawText);
  if (!rawHand) {
    return { hand: null, rawText: rawHand, reason: HAND_PARSE_ISSUES.EMPTY_SECTION };
  }

  const idMatch = rawHand.match(/CoinPoker Hand #(\d+)/i);
  if (!idMatch) {
    return { hand: null, rawText: rawHand, reason: HAND_PARSE_ISSUES.MISSING_HAND_ID };
  }

  try {
      const handData = {
        id: '', timestamp: null, dateStr: '', timeStr: '', blinds: '', smallBlind: 0, bigBlind: 0, ante: 0, gameType: 'NLH',
        gameVariant: GAME_VARIANTS.NLH, heroCards: [], boardCards: [], boardCardsByBoard: [],
        handRanking: 'NO_HAND', handRankingSource: 'UNAVAILABLE', heroInvestment: 0,
        heroWinnings: 0, netProfit: 0, outcome: 'FOLDED', rawText: rawHand,
        position: 'UNKNOWN', streets: [], isTournament: false, heroStartingStack: 0,
        tableId: '', tourneyName: '', tourneyId: '',
        heroVPIP: false, heroPFR: false, sawShowdown: false,
        heroSawFlop: false, heroReachedRiverOrShowdown: false,
        heroPostFlopBetsRaises: 0, heroPostFlopCalls: 0, heroStats: null,
        opponents: []
      };

      handData.id = idMatch[1];
      handData.gameVariant = detectGameVariant(rawHand);
      Object.assign(handData, parseHeaderBlinds(rawHand));

      const tableMatch = rawHand.match(/Table '([^']+)'/i);
      if (tableMatch) handData.tableId = tableMatch[1];

      const tourneyMatch = rawHand.match(/Tournament '([^']+)' '([^']+)'/i);
      if (tourneyMatch) {
        handData.isTournament = true;
        handData.tourneyName = tourneyMatch[1];
        handData.tourneyId = tourneyMatch[2];
      }

      const stackMatch = rawHand.match(/Seat \d+:\s+Hero\s*\([^\d]*([\d.,]+)\s+in chips\)/i);
      if (stackMatch) handData.heroStartingStack = parseChips(stackMatch[1]);

      const lines = rawHand.split(/\r?\n/).map(l => l.trim()).filter(l => l);
      if (lines.length === 0) {
        return { hand: null, rawText: rawHand, reason: HAND_PARSE_ISSUES.EMPTY_SECTION };
      }

      const dateMatch = lines[0].match(/(\d{4}[-/]\d{2}[-/]\d{2}.*)/);
      if (dateMatch) {
        handData.dateStr = dateMatch[1].trim();
        const d = parsePokerDate(handData.dateStr);
        if (!d) {
          return { hand: null, rawText: rawHand, reason: HAND_PARSE_ISSUES.INVALID_PLAYED_AT };
        }
        handData.timestamp = d.getTime();
      } else {
        return { hand: null, rawText: rawHand, reason: HAND_PARSE_ISSUES.INVALID_PLAYED_AT };
      }

      handData.heroCards = getHeroCards(rawHand);

      const actionText = rawHand.split(/^\*\*\* SUMMARY \*\*\*/im)[0];
      const firstFlopIndex = actionText.search(/^\*\*\* (?:FIRST |SECOND |THIRD )?FLOP \*\*\*/im);
      const heroFoldedBeforeFlop = firstFlopIndex >= 0
        && /^Hero:\s+folds(?:\s|$)/im.test(actionText.slice(0, firstFlopIndex));
      handData.heroSawFlop = firstFlopIndex >= 0 && !heroFoldedBeforeFlop;
      handData.sawShowdown = /^Hero:\s+(?:shows|mucks)(?:\s|$)/im.test(actionText);

// DEDUPLIKACJA MIEJSC (PANCERNA WERSJA)
      // Szuka graczy TYLKO na początku rozdania, gdzie deklarowane są żetony (in chips)
      // Dzięki temu ignoruje fałszywe nicki i podsumowania na końcu logu.
      const seats = [...rawHand.matchAll(/Seat (\d+):\s+(.*?)\s*\([^)]+in chips\)/gi)]; 
      let activeSeats = [];
      let seenSeats = new Set();
      
      seats.forEach(seat => {
        const sNum = parseInt(seat[1]);
        const playerId = seat[2].trim(); // Pobiera pełny nick, nawet ze spacjami
        if (!seenSeats.has(sNum)) {
            seenSeats.add(sNum);
            activeSeats.push({ seatNum: sNum, playerId });
            if (playerId !== 'Hero') handData.opponents.push(playerId);
        }
      });

      handData.position = getHeroPosition(rawHand, activeSeats);
      const normalizedActions = normalizeHandActions(lines);
      handData.streets = buildStreetBlocks(rawHand);
      handData.boardCardsByBoard = getVisibleBoardSets(rawHand, handData.streets);
      handData.boardCards = handData.boardCardsByBoard[0] || [];
      handData.heroInvestment = normalizedActions.heroInvestment;

      const heroSummaryLines = getSummaryHeroLines(rawHand);
      const isWinner = heroSummaryLines.some((line) => /\b(?:and\s+won|collected)\b/i.test(line));
      const isLoser = !isWinner && heroSummaryLines.some((line) => /\band\s+lost\b/i.test(line));
      const isFolded = !isWinner && !isLoser && heroSummaryLines.some((line) => /\b(?:folded|mucked)\b/i.test(line));
      const hasSummaryOutcome = isWinner || isLoser || isFolded;
      const heroSummaryLineWithRank = heroSummaryLines.find((line) => /\bwith\s+/i.test(line)) || '';
      const rankMatch = heroSummaryLineWithRank.match(/\bwith\s+(.+?)(?:\s*\([^)]*\))?\s*$/i);
      const summaryRanking = normalizeHandRanking(rankMatch?.[1]);
      if (summaryRanking !== 'NO_HAND') {
        handData.handRanking = summaryRanking;
        handData.handRankingSource = 'SUMMARY';
      } else if (handData.gameVariant === GAME_VARIANTS.PLO_4) {
        handData.handRanking = 'NO_HAND';
        handData.handRankingSource = 'UNSUPPORTED_VARIANT';
      } else {
        const visibleRanking = evaluateVisibleHand(
          handData.heroCards,
          handData.gameVariant === GAME_VARIANTS.NLH_BOMB_POT
            ? handData.boardCardsByBoard
            : handData.boardCards,
          handData.gameVariant,
        );
        handData.handRanking = visibleRanking;
        handData.handRankingSource = visibleRanking === 'NO_HAND' ? 'UNAVAILABLE' : 'VISIBLE_CARDS';
      }

      if (isWinner) {
        handData.outcome = 'WON';
        handData.heroWinnings = roundChips(heroSummaryLines.reduce(
          (total, line) => total + getSummaryWinnings(line),
          0,
        ));
      } else if (isLoser) {
        handData.outcome = 'LOST';
        handData.heroWinnings = 0;
      } else if (isFolded) {
        handData.outcome = 'FOLDED';
        handData.heroWinnings = 0;
      } else {
        handData.outcome = handData.heroInvestment > 0 ? 'LOST' : 'FOLDED';
        handData.heroWinnings = 0;
      }

      const reachedRiver = /^\*\*\* (?:FIRST |SECOND |THIRD )?RIVER \*\*\*/im.test(actionText);
      handData.heroReachedRiverOrShowdown = handData.sawShowdown
        || (handData.outcome === 'WON' && reachedRiver);
      handData.netProfit = parseFloat((handData.heroWinnings - handData.heroInvestment).toFixed(2));
      handData.heroStats = createHeroStats({
        position: handData.position,
        playerCount: activeSeats.length,
        normalizedActions,
        heroSawFlop: handData.heroSawFlop,
        sawShowdown: handData.sawShowdown,
        hasSummaryOutcome,
        outcome: handData.outcome,
      });
      handData.heroVPIP = handData.heroStats.preflop.vpip.executions > 0;
      handData.heroPFR = handData.heroStats.preflop.pfr.executions > 0;
      handData.heroPostFlopBetsRaises = handData.heroStats.postflop.betsRaises;
      handData.heroPostFlopCalls = handData.heroStats.postflop.calls;

      // PRECYZYJNA LOGIKA POZYCJI ODLICZANA OD BIG BLINDA
      if (handData.position === 'UNKNOWN' && activeSeats.length >= 2) {
        activeSeats.sort((a, b) => a.seatNum - b.seatNum);
        
        // Szukamy regularnego BB ignorując 'auto big blind'
        const bbMatch = rawHand.match(/^([^:]+):\s+posts (?:small & )?big blind/m);
        let bbIndex = -1;
        
        if (bbMatch) {
            bbIndex = activeSeats.findIndex(s => s.playerId === bbMatch[1]);
        }
        
        // Zabezpieczenie: jeśli nie znaleziono czystego BB, próbujemy policzyć to od Buttona
        if (bbIndex === -1) {
            const btnMatch = rawHand.match(/Seat #(\d+) is the button/i);
            if (btnMatch) {
                const btnSeat = parseInt(btnMatch[1]);
                const btnIndex = activeSeats.findIndex(s => s.seatNum === btnSeat);
                if (btnIndex !== -1) {
                    bbIndex = activeSeats.length === 2 ? (btnIndex + 1) % 2 : (btnIndex + 2) % activeSeats.length;
                }
            }
        }

        const heroIndex = activeSeats.findIndex(s => s.playerId === 'Hero');

        if (heroIndex !== -1 && bbIndex !== -1) {
           const N = activeSeats.length;
           const distFromBB = (heroIndex - bbIndex + N) % N;
           
           let posMap = [];
           // Skalowalna mapa (obsłuży również stoły z innej liczby graczy jeśli takie wyślesz)
           if (N === 2) posMap = ['BB', 'BTN'];
           else if (N === 3) posMap = ['BB', 'BTN', 'SB'];
           else if (N === 4) posMap = ['BB', 'CO', 'BTN', 'SB'];
           else if (N === 5) posMap = ['BB', 'HJ', 'CO', 'BTN', 'SB'];
           else if (N === 6) posMap = ['BB', 'UTG', 'HJ', 'CO', 'BTN', 'SB'];
           else if (N === 7) posMap = ['BB', 'UTG', 'UTG+1', 'HJ', 'CO', 'BTN', 'SB'];
           else if (N === 8) posMap = ['BB', 'UTG', 'UTG+1', 'UTG+2', 'HJ', 'CO', 'BTN', 'SB'];
           else if (N >= 9) posMap = ['BB', 'UTG', 'UTG+1', 'UTG+2', 'UTG+3', 'HJ', 'CO', 'BTN', 'SB'];

           handData.position = posMap[distFromBB] || 'UNKNOWN';
        }
      }

      handData.gameType = handData.isTournament ? 'tournament' : 'cash';
      return { hand: handData, rawText: rawHand };
  } catch (error) {
    return {
      hand: null,
      rawText: rawHand,
      reason: `${HAND_PARSE_ISSUES.PARSE_ERROR}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const splitRawHandSections = (rawText) => {
  const sections = [];
  const handStartPattern = /CoinPoker Hand #/gi;
  let match = handStartPattern.exec(rawText);
  if (!match) return rawText ? [rawText] : [];

  if (match.index > 0) sections.push(rawText.slice(0, match.index));
  while (match) {
    const start = match.index;
    const next = handStartPattern.exec(rawText);
    sections.push(rawText.slice(start, next?.index));
    match = next;
  }
  return sections;
};

export const parseHandHistoryDocument = (rawText) => {
  const normalizedDocument = normalizeRawHandText(rawText);
  const validHands = [];
  const issues = [];

  splitRawHandSections(normalizedDocument).forEach((section, index) => {
    const ordinal = index + 1;
    const parsed = parseSingleRawHand(section);
    const handId = parsed.hand?.id || section.match(/CoinPoker Hand #(\d+)/i)?.[1] || null;

    if (parsed.hand) {
      validHands.push({ hand: parsed.hand, rawText: parsed.rawText, ordinal });
      return;
    }
    issues.push({ ordinal, handId, reason: parsed.reason || HAND_PARSE_ISSUES.PARSE_ERROR });
  });

  return { validHands, issues };
};

// Dotychczasowe API parsera pozostaje dostępne dla klienta. Nowy kontrakt
// dokumentu pozwala importerowi raportować odrzucone sekcje, a wrapper zwraca
// wyłącznie te same poprawne ręce, których oczekuje istniejący interfejs.
export const parseRawHandHistory = (rawText) => parseHandHistoryDocument(rawText)
  .validHands
  .map(({ hand }) => hand)
  .sort((left, right) => left.timestamp - right.timestamp);

export const buildSessions = (hands) => {
  const sessionMap = {};
  hands.forEach((hand) => {
    if (hand.isTournament) return;
    const tableId = hand.tableId || 'Nieznany';
    const sId = `${tableId}_${hand.dateStr.split(' ')[0]}`;
    if (!sessionMap[sId]) {
      sessionMap[sId] = {
        id: `session_${sId}`, tableId: tableId, startTime: hand.timestamp, lastTimestamp: hand.timestamp,
        dateStr: hand.dateStr, hands: [], totalProfit: 0, type: 'Cash'
      };
    }
    const currentSession = sessionMap[sId];
    currentSession.hands.push({ ...hand, sessionHandIndex: currentSession.hands.length + 1 });
    currentSession.totalProfit += hand.netProfit;
    currentSession.lastTimestamp = Math.max(currentSession.lastTimestamp, hand.timestamp);
  });
  return Object.values(sessionMap).map(finalizeSession).sort((a, b) => b.startTime - a.startTime);
};

const finalizeSession = (session) => {
  let runningProfit = 0;
  session.chartData = session.hands.map(hand => {
    runningProfit += hand.netProfit;
    return { handIndex: hand.sessionHandIndex, profit: parseFloat(runningProfit.toFixed(2)) };
  });
  session.totalProfit = parseFloat(session.totalProfit.toFixed(2));
  return session;
};

export const buildTourneySessions = (hands) => {
  const tourneyGroups = new Map();

  hands.forEach((hand, inputIndex) => {
    if (!hand.isTournament) return;

    const tourneyId = hand.tourneyId == null ? '' : String(hand.tourneyId).trim();
    // A hand without a tournament number is never grouped with another hand.
    // The input index also keeps two malformed hands with the same timestamp
    // from being silently joined.
    const groupKey = tourneyId
      ? `id:${tourneyId}`
      : `unknown:${hand.id || hand.timestamp || inputIndex}:${inputIndex}`;
    const dateKey = String(hand.dateStr || '').split(' ')[0] || 'unknown-date';
    const dailySessionId = tourneyId
      ? `tourney_${tourneyId}_${dateKey}`
      : `tourney_unknown_${hand.id || hand.timestamp || inputIndex}`;

    if (!tourneyGroups.has(groupKey)) {
      tourneyGroups.set(groupKey, {
        tourneyId,
        hands: [],
        dailyFragments: new Map(),
      });
    }
    const group = tourneyGroups.get(groupKey);
    group.hands.push({ hand, inputIndex });
    if (!group.dailyFragments.has(dailySessionId)) {
      group.dailyFragments.set(dailySessionId, {
        id: dailySessionId,
        firstTimestamp: Number.isFinite(Number(hand.timestamp)) ? Number(hand.timestamp) : Number.MAX_SAFE_INTEGER,
      });
    }
  });

  const sessions = [...tourneyGroups.values()].map((group) => {
    const orderedHands = [...group.hands]
      .sort((left, right) => (
        Number(left.hand.timestamp) - Number(right.hand.timestamp)
        || left.inputIndex - right.inputIndex
      ))
      .map(({ hand }) => hand);
    const dailyFragments = [...group.dailyFragments.values()]
      .sort((left, right) => left.firstTimestamp - right.firstTimestamp || left.id.localeCompare(right.id));
    const isMultiDay = dailyFragments.length > 1;
    const firstHand = orderedHands[0];
    const session = {
      id: isMultiDay ? `tourney_${group.tourneyId}` : dailyFragments[0].id,
      tourneyId: group.tourneyId || 'Nieznane ID',
      tourneyName: firstHand.tourneyName || 'Nieznany Turniej',
      startTime: firstHand.timestamp,
      lastTimestamp: firstHand.timestamp,
      dateStr: firstHand.dateStr,
      hands: [],
      totalProfit: 0,
      type: 'Tournament',
      rebuys: 0,
      startStack: firstHand.heroStartingStack,
      mergedFromSessionIds: isMultiDay ? dailyFragments.map((fragment) => fragment.id) : [],
    };

    orderedHands.forEach((hand) => {
      if (session.hands.length > 0) {
        const lastActualHands = session.hands.filter((candidate) => !candidate.isRebuy);
        if (lastActualHands.length > 0) {
          const lastHand = lastActualHands[lastActualHands.length - 1];
          const expectedStack = lastHand.heroStartingStack + lastHand.netProfit;
          if (hand.heroStartingStack > expectedStack + 100) {
            session.rebuys += 1;
            const rebuyAmount = hand.heroStartingStack - expectedStack;
            session.hands.push({
              id: `rebuy_${hand.id}`, timestamp: hand.timestamp - 1, isRebuy: true, rebuyValue: rebuyAmount,
              isTournament: true, netProfit: 0, heroStartingStack: expectedStack, sessionHandIndex: session.hands.length + 1,
              heroCards: [], boardCards: [], opponents: []
            });
          }
        }
      }
      session.hands.push({ ...hand, sessionHandIndex: session.hands.length + 1 });
      session.totalProfit += hand.netProfit;
      session.lastTimestamp = Math.max(session.lastTimestamp, hand.timestamp);
    });

    return finalizeTourneySession(session);
  });

  return sessions.sort((a, b) => b.startTime - a.startTime);
};

const finalizeTourneySession = (session) => {
  session.chartData = session.hands.map(hand => {
    return { 
      handIndex: hand.sessionHandIndex, 
      stack: hand.isRebuy ? hand.heroStartingStack + hand.rebuyValue : hand.heroStartingStack + hand.netProfit,
      profit: hand.netProfit,
      isRebuy: hand.isRebuy || false
    };
  });
  session.totalProfit = parseFloat(session.totalProfit.toFixed(2));
  return session;
};
