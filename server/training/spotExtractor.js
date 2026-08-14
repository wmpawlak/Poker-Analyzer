import { GAME_VARIANTS, detectGameVariant, normalizeRawHandText } from '../../src/parser/pokerParser.js';
import { computeDecisionCardFacts } from './decisionCardFacts.js';

export const TRAINING_EXTRACTOR_VERSION = 2;

const EPSILON = 0.000001;
const SUPPORTED_STREETS = new Set(['PRE_FLOP', 'FLOP', 'TURN', 'RIVER']);
const POSITION_MAPS = Object.freeze({
  2: ['BB', 'BTN/SB'],
  3: ['BB', 'BTN', 'SB'],
  4: ['BB', 'CO', 'BTN', 'SB'],
  5: ['BB', 'HJ', 'CO', 'BTN', 'SB'],
  6: ['BB', 'UTG', 'HJ', 'CO', 'BTN', 'SB'],
  7: ['BB', 'UTG', 'UTG+1', 'HJ', 'CO', 'BTN', 'SB'],
  8: ['BB', 'UTG', 'UTG+1', 'UTG+2', 'HJ', 'CO', 'BTN', 'SB'],
  9: ['BB', 'UTG', 'UTG+1', 'UTG+2', 'UTG+3', 'HJ', 'CO', 'BTN', 'SB'],
});

export const TRAINING_SPOT_REJECTIONS = Object.freeze({
  EMPTY_HAND: 'EMPTY_HAND',
  UNSUPPORTED_VARIANT: 'UNSUPPORTED_VARIANT',
  REBUY: 'REBUY',
  MISSING_HAND_ID: 'MISSING_HAND_ID',
  INVALID_BLINDS: 'INVALID_BLINDS',
  INVALID_SEATS: 'INVALID_SEATS',
  MISSING_HERO: 'MISSING_HERO',
  INVALID_HERO_CARDS: 'INVALID_HERO_CARDS',
  INVALID_POSITIONS: 'INVALID_POSITIONS',
  UNKNOWN_ACTOR: 'UNKNOWN_ACTOR',
  INVALID_ACTION: 'INVALID_ACTION',
  INCONSISTENT_STACK: 'INCONSISTENT_STACK',
  INCONSISTENT_ACTION: 'INCONSISTENT_ACTION',
  INVALID_CARDS: 'INVALID_CARDS',
});

class ExtractionError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const round = (value, digits = 2) => Number((Number(value) || 0).toFixed(digits));

// CoinPoker uses a dot as decimal separator and a comma as a thousands separator.
// Accept a decimal comma too when there is no dot and the suffix is not three digits.
const parseAmount = (value) => {
  const token = String(value ?? '').match(/-?[\d][\d.,]*/)?.[0] || '';
  if (!token) return 0;
  let normalized = token;
  if (normalized.includes('.')) normalized = normalized.replace(/,/g, '');
  else if (/^-?\d+,\d{1,2}$/.test(normalized)) normalized = normalized.replace(',', '.');
  else normalized = normalized.replace(/,/g, '');
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : 0;
};

const normalizeStreetName = (value) => {
  const name = String(value || '').toUpperCase();
  return name === 'HOLE CARDS' ? 'PRE_FLOP' : name;
};

const getStreetHeader = (line) => {
  const match = String(line).match(/^\*\*\*\s+(?:(FIRST|SECOND|THIRD)\s+)?(HOLE CARDS|FLOP|TURN|RIVER|SHOWDOWN|SUMMARY)\s+\*\*\*(.*)$/i);
  if (!match) return null;
  return {
    boardPrefix: match[1]?.toUpperCase() || '',
    street: normalizeStreetName(match[2]),
    suffix: match[3] || '',
  };
};

const getBracketCards = (value) => [...String(value).matchAll(/\[([^\]]*)\]/g)]
  .map((match) => match[1].trim().split(/\s+/).filter(Boolean));

const assertCards = (heroCards, board) => {
  const cards = [...heroCards, ...board];
  if (cards.some((card) => !/^[2-9TJQKA][cdhs]$/i.test(card)) || new Set(cards).size !== cards.length) {
    throw new ExtractionError(TRAINING_SPOT_REJECTIONS.INVALID_CARDS, 'Karty są nieprawidłowe albo powtarzają się.');
  }
};

const parseHeader = (rawText) => {
  const firstLine = rawText.split('\n')[0] || '';
  const id = firstLine.match(/CoinPoker Hand #(\d+)/i)?.[1] || '';
  if (!id) throw new ExtractionError(TRAINING_SPOT_REJECTIONS.MISSING_HAND_ID, 'Brakuje identyfikatora rozdania.');
  const blindsText = firstLine.match(/\(([^)]+)\)/)?.[1] || '';
  const blindValues = blindsText.split('/').map(parseAmount);
  const smallBlind = blindValues[0] || 0;
  const bigBlind = blindValues[1] || 0;
  const ante = blindValues[2] || 0;
  if (smallBlind <= 0 || bigBlind <= 0 || smallBlind > bigBlind) {
    throw new ExtractionError(TRAINING_SPOT_REJECTIONS.INVALID_BLINDS, 'Nie można ustalić poprawnych blindów.');
  }
  return { id, smallBlind, bigBlind, ante };
};

const parseSeats = (rawText) => {
  const seats = [];
  const seenSeats = new Set();
  const seenPlayers = new Set();
  for (const match of rawText.matchAll(/^Seat\s+(\d+):\s+(.+?)\s+\(([^()]*)\s+in chips\)\s*$/gim)) {
    const seat = Number(match[1]);
    const playerId = match[2].trim();
    const startingStack = parseAmount(match[3]);
    if (!Number.isInteger(seat) || seat < 1 || !playerId || startingStack <= 0
      || seenSeats.has(seat) || seenPlayers.has(playerId)) {
      throw new ExtractionError(TRAINING_SPOT_REJECTIONS.INVALID_SEATS, 'Lista miejsc lub stacków jest niepełna albo niespójna.');
    }
    seenSeats.add(seat);
    seenPlayers.add(playerId);
    seats.push({ seat, playerId, startingStack });
  }
  if (seats.length < 2 || seats.length > 9) {
    throw new ExtractionError(TRAINING_SPOT_REJECTIONS.INVALID_SEATS, 'Obsługiwane są stoły od 2 do 9 graczy.');
  }
  if (!seenPlayers.has('Hero')) {
    throw new ExtractionError(TRAINING_SPOT_REJECTIONS.MISSING_HERO, 'Na liście miejsc brakuje Hero.');
  }
  return seats.sort((left, right) => left.seat - right.seat);
};

const assignPositions = (rawText, seats) => {
  const buttonSeat = Number(rawText.match(/Seat #(\d+) is the button/i)?.[1]);
  const buttonIndex = seats.findIndex(({ seat }) => seat === buttonSeat);
  if (buttonIndex < 0) {
    throw new ExtractionError(TRAINING_SPOT_REJECTIONS.INVALID_POSITIONS, 'Nie można przypisać pozycji bez aktywnego buttona.');
  }
  const count = seats.length;
  const positions = POSITION_MAPS[count];
  const expectedBigBlindIndex = count === 2 ? (buttonIndex + 1) % count : (buttonIndex + 2) % count;
  return seats.map((player, index) => {
    const distanceFromBigBlind = (index - expectedBigBlindIndex + count) % count;
    return { ...player, position: positions[distanceFromBigBlind] };
  });
};

const getHeroCards = (rawText) => {
  const match = rawText.match(/^Dealt to Hero\s+\[([^\]]+)\]/im);
  const cards = match?.[1].trim().split(/\s+/).filter(Boolean) || [];
  if (cards.length !== 2) {
    throw new ExtractionError(TRAINING_SPOT_REJECTIONS.INVALID_HERO_CARDS, 'Rozdanie nie zawiera dokładnie dwóch kart Hero.');
  }
  return cards;
};

const getShowdownHands = (rawText) => {
  const showdownMatch = String(rawText).match(
    /^\*\*\*\s+SHOWDOWN\s+\*\*\*\s*([\s\S]*?)(?=^\*\*\*\s+SUMMARY\s+\*\*\*)/im,
  );
  const summaryMatch = String(rawText).match(/^\*\*\*\s+SUMMARY\s+\*\*\*\s*([\s\S]*)$/im);
  const sourceBlocks = [showdownMatch?.[1], summaryMatch?.[1]].filter(Boolean);
  if (sourceBlocks.length === 0) return new Map();

  const hands = new Map();
  sourceBlocks.join('\n').split(/\r?\n/).forEach((line) => {
    const match = line.trim().match(/^(?:Seat\s+\d+:\s*)?([^:]+?):?\s+(?:shows?|showed|mucks?|mucked)\s+\[([^\]]+)\]/i);
    if (!match) return;
    const cards = match[2].trim().split(/\s+/).filter(Boolean);
    if (cards.length !== 2
      || cards.some((card) => !/^(?:10|[2-9TJQKA])[cdhs]$/i.test(card))
      || new Set(cards.map((card) => card.toUpperCase())).size !== cards.length) return;
    hands.set(match[1].trim(), [...cards]);
  });
  return hands;
};

const parseAction = (line, bigBlind) => {
  const match = String(line).match(/^(.+?):\s+(.+)$/);
  if (!match) return null;
  const actor = match[1].trim();
  const text = match[2].trim();
  const post = text.match(/^posts\s+(.+?)\s+([^\s]+)(?:\s+ALLIN)?$/i);
  if (post) {
    const kind = post[1].trim().toLowerCase();
    let amount = parseAmount(post[2]);
    if (/auto\s+big\s+blind/.test(kind)) amount = Math.max(amount, bigBlind);
    if (/\bante\b/.test(kind)) return { actor, type: 'ante', amount, forced: true, live: false };
    if (/\bstraddle\b/.test(kind)) return { actor, type: 'straddle', amount, forced: true, live: true };
    if (/auto\s+big\s+blind/.test(kind)) return { actor, type: 'auto_big_blind', amount, forced: true, live: true };
    if (/small\s*&\s*big\s+blind/.test(kind)) return { actor, type: 'small_big_blind', amount, forced: true, live: true };
    if (/small\s+blind/.test(kind)) return { actor, type: 'small_blind', amount, forced: true, live: true };
    if (/big\s+blind/.test(kind)) return { actor, type: 'big_blind', amount, forced: true, live: true };
  }
  if (/^STRADDLE\b/i.test(text)) return { actor, type: 'straddle', amount: parseAmount(text), forced: true, live: true };
  if (/^AUTOBB\b/i.test(text)) return { actor, type: 'auto_big_blind', amount: Math.max(parseAmount(text), bigBlind), forced: true, live: true };
  if (/^(?:RETURN|Uncalled bet .* returned to)\b/i.test(text)) return { actor, type: 'return', amount: parseAmount(text), forced: true, live: false };
  if (/^folds\b/i.test(text)) return { actor, type: 'fold', amount: 0, forced: false };
  if (/^checks\b/i.test(text)) return { actor, type: 'check', amount: 0, forced: false };
  const raise = text.match(/^raises\s+([^\s]+)\s+to\s+([^\s]+)/i);
  if (raise) return { actor, type: 'raise', amount: parseAmount(raise[1]), toAmount: parseAmount(raise[2]), forced: false };
  if (/^calls\b/i.test(text)) return { actor, type: 'call', amount: parseAmount(text), forced: false };
  if (/^bets\b/i.test(text)) return { actor, type: 'bet', amount: parseAmount(text), forced: false };
  if (/^ALLIN\b/i.test(text)) return { actor, type: 'all_in', amount: parseAmount(text), forced: false };
  return null;
};

const clonePlayers = (players, invested, folded, allIn) => players.map((player) => ({
  seat: player.seat,
  playerId: player.playerId,
  position: player.position,
  startingStack: round(player.startingStack),
  invested: round(invested.get(player.playerId) || 0),
  stack: round(player.startingStack - (invested.get(player.playerId) || 0)),
  folded: folded.has(player.playerId),
  allIn: allIn.has(player.playerId),
}));

const getLegalActions = ({ toCall, stack, highContribution, opponentsCanAct }) => {
  if (toCall <= EPSILON) return stack > EPSILON ? ['check', 'bet'] : ['check'];
  const actions = ['fold'];
  if (stack > EPSILON) actions.push('call');
  if (stack > toCall + EPSILON && opponentsCanAct && highContribution >= 0) actions.push('raise');
  return actions;
};

const makeSpot = ({
  header,
  gameType,
  heroCards,
  board,
  street,
  streetActionOrder,
  players,
  invested,
  folded,
  allIn,
  contributions,
  highContribution,
  pot,
  priorActions,
  aggression,
  historicalAction,
  showdownHands,
}) => {
  const playerSnapshot = clonePlayers(players, invested, folded, allIn);
  const hero = playerSnapshot.find(({ playerId }) => playerId === 'Hero');
  const opponents = playerSnapshot.filter((player) => player.playerId !== 'Hero' && !player.folded);
  const knownOpponentCards = opponents.length === 1
    ? showdownHands.get(opponents[0].playerId) || null
    : null;
  const heroContribution = contributions.get('Hero') || 0;
  const toCall = Math.max(0, Math.min(hero.stack, highContribution - heroContribution));
  const effectiveByOpponent = opponents.map((opponent) => ({
    playerId: opponent.playerId,
    amount: round(Math.min(hero.startingStack, opponent.startingStack)),
    amountBb: round(Math.min(hero.startingStack, opponent.startingStack) / header.bigBlind, 3),
    behind: round(Math.min(hero.stack, opponent.stack)),
    behindBb: round(Math.min(hero.stack, opponent.stack) / header.bigBlind, 3),
  }));
  const effectiveStack = Math.max(0, ...effectiveByOpponent.map(({ amount }) => amount));
  const effectiveStackBehind = Math.max(0, ...effectiveByOpponent.map(({ behind }) => behind));
  const potOdds = toCall > EPSILON ? toCall / (pot + toCall) : 0;
  const opponentsCanAct = opponents.some((opponent) => !opponent.allIn && opponent.stack > EPSILON);
  return {
    id: `${header.id}:${street.toLowerCase()}:${streetActionOrder}`,
    handId: header.id,
    gameType,
    street,
    actionOrder: streetActionOrder,
    heroCards: [...heroCards],
    board: [...board],
    decisionCardFacts: computeDecisionCardFacts({ heroCards, board }),
    heroPosition: hero.position,
    blinds: { smallBlind: header.smallBlind, bigBlind: header.bigBlind, ante: header.ante },
    pot: round(pot),
    toCall: round(toCall),
    potOdds: round(potOdds, 6),
    effectiveStack: round(effectiveStack),
    effectiveStackBb: round(effectiveStack / header.bigBlind, 3),
    effectiveStackBehind: round(effectiveStackBehind),
    effectiveStackBehindBb: round(effectiveStackBehind / header.bigBlind, 3),
    effectiveStackByOpponent: effectiveByOpponent,
    players: playerSnapshot,
    knownOpponentCards: knownOpponentCards ? [...knownOpponentCards] : null,
    priorActions: priorActions.map((action) => ({ ...action })),
    legalActions: getLegalActions({ toCall, stack: hero.stack, highContribution, opponentsCanAct }),
    context: {
      opponentsInHand: opponents.length,
      preflopRaiseCount: aggression.preflopRaiseCount,
      facingRaiseLevel: street === 'PRE_FLOP' ? aggression.preflopRaiseCount : 0,
      isFacingReraise: street === 'PRE_FLOP' && aggression.preflopRaiseCount >= 2,
      isFacingReshove: street === 'PRE_FLOP'
        && aggression.preflopRaiseCount >= 2
        && aggression.lastAggressiveAction?.allIn === true,
    },
    historicalAction,
  };
};

const reject = (error, handId = '') => ({
  status: 'rejected',
  handId,
  spots: [],
  rejection: {
    code: error instanceof ExtractionError ? error.code : TRAINING_SPOT_REJECTIONS.INVALID_ACTION,
    message: error instanceof Error ? error.message : String(error),
  },
});

export const extractTrainingSpots = (source) => {
  const rawText = normalizeRawHandText(typeof source === 'string' ? source : source?.rawText);
  let handId = String(source?.handId || '');
  try {
    if (!rawText) throw new ExtractionError(TRAINING_SPOT_REJECTIONS.EMPTY_HAND, 'Rozdanie jest puste.');
    const variant = detectGameVariant(rawText);
    if (variant !== GAME_VARIANTS.NLH || /CoinPoker Hand #\d+:.*\bBomb\s*Pot\b/i.test(rawText.split('\n')[0] || '')) {
      throw new ExtractionError(TRAINING_SPOT_REJECTIONS.UNSUPPORTED_VARIANT, `Wariant ${variant} nie jest obsługiwany.`);
    }
    if (source?.isRebuy || source?.hand?.isRebuy || /^\*\*\*\s+REBUY\s+\*\*\*$/im.test(rawText)) {
      throw new ExtractionError(TRAINING_SPOT_REJECTIONS.REBUY, 'Rebuy nie jest rozdaniem treningowym.');
    }

    const header = parseHeader(rawText);
    handId = header.id;
    if (source?.handId && String(source.handId) !== header.id) {
      throw new ExtractionError(TRAINING_SPOT_REJECTIONS.MISSING_HAND_ID, 'Identyfikator rekordu nie zgadza się z tekstem rozdania.');
    }
    const heroCards = getHeroCards(rawText);
    const showdownHands = getShowdownHands(rawText);
    const players = assignPositions(rawText, parseSeats(rawText));
    assertCards(heroCards, []);
    const gameType = source?.gameType === 'tournament' || /^Tournament\s+'/im.test(rawText)
      ? 'tournament'
      : 'cash';

    const playerById = new Map(players.map((player) => [player.playerId, player]));
    const invested = new Map(players.map((player) => [player.playerId, 0]));
    const contributions = new Map(players.map((player) => [player.playerId, 0]));
    const folded = new Set();
    const allIn = new Set();
    const priorActions = [];
    const spots = [];
    const streetOrders = new Map();
    const aggression = { preflopRaiseCount: 0, lastAggressiveAction: null };
    let street = 'PRE_FLOP';
    let board = [];
    let highContribution = 0;
    let pot = 0;
    let reachedActions = false;
    let regularBigBlindActor = '';

    const applyInvestment = (actor, delta) => {
      if (delta < -EPSILON) throw new ExtractionError(TRAINING_SPOT_REJECTIONS.INCONSISTENT_ACTION, 'Ujemna inwestycja w pulę.');
      const player = playerById.get(actor);
      const current = invested.get(actor) || 0;
      if (current + delta > player.startingStack + 0.011) {
        throw new ExtractionError(TRAINING_SPOT_REJECTIONS.INCONSISTENT_STACK, `${actor} inwestuje więcej niż wynosi jego stack.`);
      }
      invested.set(actor, round(current + delta));
      pot = round(pot + delta);
      if (player.startingStack - (invested.get(actor) || 0) <= 0.011) allIn.add(actor);
    };

    for (const rawLine of rawText.split('\n').map((line) => line.trim()).filter(Boolean)) {
      const streetHeader = getStreetHeader(rawLine);
      if (streetHeader) {
        if (streetHeader.street === 'SUMMARY') break;
        if (streetHeader.street === 'SHOWDOWN') {
          street = 'SHOWDOWN';
          continue;
        }
        street = streetHeader.street;
        if (streetHeader.boardPrefix) {
          throw new ExtractionError(TRAINING_SPOT_REJECTIONS.UNSUPPORTED_VARIANT, 'Rozdania z wieloma boardami nie są obsługiwane.');
        }
        if (['FLOP', 'TURN', 'RIVER'].includes(street)) {
          const sets = getBracketCards(streetHeader.suffix);
          if (street === 'FLOP') board = sets.at(-1) || [];
          else board = [...board, ...(sets.at(-1) || [])];
          assertCards(heroCards, board);
          contributions.clear();
          players.forEach(({ playerId }) => contributions.set(playerId, 0));
          highContribution = 0;
        }
        continue;
      }
      if (!SUPPORTED_STREETS.has(street)) continue;
      const action = parseAction(rawLine, header.bigBlind);
      if (!action) {
        const possibleActor = rawLine.match(/^(.+?):/)?.[1]?.trim();
        if (possibleActor && playerById.has(possibleActor)) {
          throw new ExtractionError(TRAINING_SPOT_REJECTIONS.INVALID_ACTION, `Nie można odczytać akcji gracza ${possibleActor}.`);
        }
        continue;
      }
      if (!playerById.has(action.actor)) {
        throw new ExtractionError(TRAINING_SPOT_REJECTIONS.UNKNOWN_ACTOR, `Akcja należy do nieznanego gracza: ${action.actor}.`);
      }
      reachedActions = true;
      const actor = action.actor;
      const player = playerById.get(actor);
      const contributionBefore = contributions.get(actor) || 0;
      const stackBefore = player.startingStack - (invested.get(actor) || 0);
      const highBefore = highContribution;

      if (action.type === 'return') {
        const amount = Math.min(action.amount, contributionBefore, invested.get(actor) || 0);
        if (amount <= 0 || Math.abs(amount - action.amount) > 0.011) {
          throw new ExtractionError(TRAINING_SPOT_REJECTIONS.INCONSISTENT_ACTION, 'Zwrot niewyrównanego zakładu przekracza inwestycję gracza.');
        }
        contributions.set(actor, round(contributionBefore - amount));
        invested.set(actor, round((invested.get(actor) || 0) - amount));
        pot = round(pot - amount);
        allIn.delete(actor);
        priorActions.push({ street, actor, type: 'return', amount: round(amount), forced: true });
        highContribution = Math.max(0, ...contributions.values());
        continue;
      }

      if (action.forced) {
        if (action.amount <= 0) throw new ExtractionError(TRAINING_SPOT_REJECTIONS.INCONSISTENT_ACTION, 'Wymuszona wpłata ma nieprawidłową kwotę.');
        if (action.type === 'big_blind') {
          regularBigBlindActor = actor;
          if (player.position !== 'BB') {
            throw new ExtractionError(TRAINING_SPOT_REJECTIONS.INVALID_POSITIONS, 'Pozycja BB nie zgadza się z listą wymuszonych wpłat.');
          }
        }
        if (action.type === 'small_blind' && !['SB', 'BTN/SB'].includes(player.position)) {
          throw new ExtractionError(TRAINING_SPOT_REJECTIONS.INVALID_POSITIONS, 'Pozycja SB nie zgadza się z listą wymuszonych wpłat.');
        }
        applyInvestment(actor, action.amount);
        if (action.live) {
          contributions.set(actor, round(contributionBefore + action.amount));
          highContribution = Math.max(
            highContribution,
            action.type === 'big_blind' ? header.bigBlind : contributions.get(actor),
          );
        }
        priorActions.push({ street, actor, type: action.type, amount: round(action.amount), forced: true });
        continue;
      }

      if (folded.has(actor) || allIn.has(actor)) {
        throw new ExtractionError(TRAINING_SPOT_REJECTIONS.INCONSISTENT_ACTION, `${actor} wykonuje akcję po foldzie albo all-inie.`);
      }
      const toCallBefore = Math.max(0, highBefore - contributionBefore);
      let normalizedType = action.type;
      let delta = 0;
      let contributionAfter = contributionBefore;
      let target = contributionBefore;

      if (action.type === 'fold') {
        // Fold is applied after the pre-decision snapshot is created.
      } else if (action.type === 'check') {
        if (toCallBefore > 0.011) {
          throw new ExtractionError(TRAINING_SPOT_REJECTIONS.INCONSISTENT_ACTION, `${actor} czeka mimo kwoty do sprawdzenia.`);
        }
      } else if (action.type === 'call') {
        delta = Math.min(action.amount, stackBefore);
        const expected = Math.min(toCallBefore, stackBefore);
        if (Math.abs(delta - expected) > 0.011) {
          throw new ExtractionError(TRAINING_SPOT_REJECTIONS.INCONSISTENT_ACTION, `Kwota call gracza ${actor} nie zgadza się ze stanem stołu.`);
        }
        contributionAfter += delta;
      } else if (action.type === 'bet') {
        if (highBefore > 0.011 || action.amount <= 0) {
          throw new ExtractionError(TRAINING_SPOT_REJECTIONS.INCONSISTENT_ACTION, `Bet gracza ${actor} nie otwiera akcji.`);
        }
        delta = Math.min(action.amount, stackBefore);
        contributionAfter += delta;
      } else if (action.type === 'raise') {
        target = action.toAmount;
        const isNoOpCheck = action.amount <= EPSILON
          && Math.abs(target - contributionBefore) <= 0.011
          && highBefore <= contributionBefore + 0.011;
        if (isNoOpCheck) {
          normalizedType = 'check';
        } else if (target <= highBefore + EPSILON || target <= contributionBefore || target - contributionBefore > stackBefore + 0.011) {
          throw new ExtractionError(TRAINING_SPOT_REJECTIONS.INCONSISTENT_ACTION, `Raise gracza ${actor} ma nieprawidłowy cel.`);
        } else {
          delta = target - contributionBefore;
          contributionAfter = target;
        }
      } else if (action.type === 'all_in') {
        delta = Math.min(action.amount, stackBefore);
        if (Math.abs(delta - stackBefore) > 0.011) {
          throw new ExtractionError(TRAINING_SPOT_REJECTIONS.INCONSISTENT_ACTION, `Akcja ALLIN gracza ${actor} nie wykorzystuje całego stacka.`);
        }
        contributionAfter += delta;
        normalizedType = contributionAfter > highBefore + EPSILON
          ? (highBefore > EPSILON ? 'raise' : 'bet')
          : 'call';
      } else {
        throw new ExtractionError(TRAINING_SPOT_REJECTIONS.INVALID_ACTION, `Nieobsługiwany typ akcji: ${action.type}.`);
      }

      const historicalAction = {
        type: normalizedType,
        amount: round(delta),
        toAmount: round(contributionAfter),
        allIn: stackBefore - delta <= 0.011,
      };
      const streetActionOrder = (streetOrders.get(street) || 0) + 1;
      streetOrders.set(street, streetActionOrder);
      if (actor === 'Hero') {
        spots.push(makeSpot({
          header,
          gameType,
          heroCards,
          board,
          street,
          streetActionOrder,
          players,
          invested,
          folded,
          allIn,
          contributions,
          highContribution: highBefore,
          pot,
          priorActions,
          aggression,
          historicalAction,
          showdownHands,
        }));
      }

      if (action.type === 'fold') folded.add(actor);

      if (delta > EPSILON) {
        applyInvestment(actor, delta);
        contributions.set(actor, round(contributionAfter));
      }
      if (['bet', 'raise'].includes(normalizedType)) {
        highContribution = Math.max(highContribution, contributionAfter);
        const aggressive = { street, actor, type: normalizedType, allIn: historicalAction.allIn };
        aggression.lastAggressiveAction = aggressive;
        if (street === 'PRE_FLOP' && normalizedType === 'raise') aggression.preflopRaiseCount += 1;
      }
      priorActions.push({
        street,
        actor,
        type: normalizedType,
        amount: round(delta),
        toAmount: round(contributionAfter),
        allIn: historicalAction.allIn,
        forced: false,
      });
    }

    if (!reachedActions) {
      throw new ExtractionError(TRAINING_SPOT_REJECTIONS.INVALID_ACTION, 'Rozdanie nie zawiera akcji graczy.');
    }
    const regularBigBlind = playerById.get(regularBigBlindActor);
    if (!regularBigBlind || regularBigBlind.position !== 'BB') {
      throw new ExtractionError(TRAINING_SPOT_REJECTIONS.INVALID_POSITIONS, 'Pozycja BB nie zgadza się z listą wymuszonych wpłat.');
    }
    return { status: 'accepted', handId, spots, rejection: null };
  } catch (error) {
    return reject(error, handId);
  }
};

export const extractTrainingSpotsBatch = (sources) => {
  const accepted = [];
  const rejected = [];
  for (const source of Array.isArray(sources) ? sources : []) {
    const result = extractTrainingSpots(source);
    if (result.status === 'accepted') accepted.push(...result.spots);
    else rejected.push({ handId: result.handId, ...result.rejection });
  }
  return { spots: accepted, rejected };
};
