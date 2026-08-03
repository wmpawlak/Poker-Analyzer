import { classifyPlayerStyle } from './playerStyleClassifier.js';

export const UNAVAILABLE_METRIC = '—';
export const INFINITE_METRIC = '∞';

const RFI_POSITIONS = ['CO', 'BTN', 'SB', 'BTN/SB'];
const AGGRESSION_SCOPES = ['total', 'flop', 'turn', 'river'];

const createCounter = () => ({ opportunities: 0, executions: 0 });
const createAggressionCounter = () => ({ betsRaises: 0, calls: 0 });

const toFiniteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const round = (value, precision = 1) => {
  const rounded = Number(toFiniteNumber(value).toFixed(precision));
  return Object.is(rounded, -0) ? 0 : rounded;
};

const addCounter = (target, source) => {
  target.opportunities += Math.max(0, toFiniteNumber(source?.opportunities));
  target.executions += Math.max(0, toFiniteNumber(source?.executions));
};

const addAggressionCounter = (target, source) => {
  target.betsRaises += Math.max(0, toFiniteNumber(source?.betsRaises));
  target.calls += Math.max(0, toFiniteNumber(source?.calls));
};

const toPercentageMetric = (counter) => ({
  value: counter.opportunities > 0
    ? round((counter.executions / counter.opportunities) * 100)
    : UNAVAILABLE_METRIC,
  opportunities: counter.opportunities,
  executions: counter.executions,
});

const toAggressionFactorMetric = (counter) => {
  let value = UNAVAILABLE_METRIC;
  if (counter.calls > 0) value = round(counter.betsRaises / counter.calls, 2);
  else if (counter.betsRaises > 0) value = INFINITE_METRIC;

  return {
    value,
    betsRaises: counter.betsRaises,
    calls: counter.calls,
  };
};

const toAggressionFrequencyMetric = (counter) => {
  const decisions = counter.betsRaises + counter.calls;
  return {
    value: decisions > 0
      ? round((counter.betsRaises / decisions) * 100)
      : UNAVAILABLE_METRIC,
    betsRaises: counter.betsRaises,
    calls: counter.calls,
  };
};

const normalizeGameType = (gameType) => {
  const normalized = String(gameType || '').trim().toLowerCase();
  if (normalized === 'cash') return 'cash';
  if (normalized === 'tournament' || normalized === 'turniej' || normalized === 'turnieje') {
    return 'tournament';
  }
  return 'mixed';
};

const createWinrateMetric = (hands, gameType) => {
  const handCount = hands.length;
  const unit = gameType === 'cash'
    ? 'BB/100'
    : gameType === 'tournament' ? 'żetony/100' : null;

  if (handCount === 0 || gameType === 'mixed') {
    return {
      value: UNAVAILABLE_METRIC,
      unit,
      numerator: UNAVAILABLE_METRIC,
      denominator: handCount,
    };
  }

  if (gameType === 'cash') {
    const hasCompleteBlindData = hands.every((hand) => toFiniteNumber(hand.bigBlind) > 0);
    if (!hasCompleteBlindData) {
      return {
        value: UNAVAILABLE_METRIC,
        unit,
        numerator: UNAVAILABLE_METRIC,
        denominator: handCount,
      };
    }

    const totalBigBlinds = hands.reduce(
      (total, hand) => total + (toFiniteNumber(hand.netProfit) / toFiniteNumber(hand.bigBlind)),
      0,
    );
    return {
      value: round((totalBigBlinds / handCount) * 100, 2),
      unit,
      numerator: round(totalBigBlinds, 4),
      denominator: handCount,
    };
  }

  const totalChips = hands.reduce((total, hand) => total + toFiniteNumber(hand.netProfit), 0);
  return {
    value: round((totalChips / handCount) * 100, 2),
    unit,
    numerator: round(totalChips, 2),
    denominator: handCount,
  };
};

const createAggregateCounters = () => ({
  preflop: {
    vpip: createCounter(),
    pfr: createCounter(),
    threeBet: createCounter(),
    foldToThreeBet: createCounter(),
    fourBet: createCounter(),
    rfi: createCounter(),
    rfiByPosition: Object.fromEntries(RFI_POSITIONS.map((position) => [position, createCounter()])),
  },
  aggression: Object.fromEntries(AGGRESSION_SCOPES.map((scope) => [scope, createAggressionCounter()])),
  cBet: createCounter(),
  cBetSrp: createCounter(),
  foldToCBet: createCounter(),
  showdown: {
    wtsd: createCounter(),
    wsd: createCounter(),
  },
});

const addHandCounters = (aggregate, hand) => {
  const heroStats = hand.heroStats;
  const preflop = heroStats?.preflop;

  addCounter(aggregate.preflop.vpip, preflop?.vpip || {
    opportunities: 1,
    executions: hand.heroVPIP ? 1 : 0,
  });
  addCounter(aggregate.preflop.pfr, preflop?.pfr || {
    opportunities: 1,
    executions: hand.heroPFR ? 1 : 0,
  });
  addCounter(aggregate.preflop.threeBet, preflop?.threeBet);
  addCounter(aggregate.preflop.foldToThreeBet, preflop?.foldToThreeBet);
  addCounter(aggregate.preflop.fourBet, preflop?.fourBet);
  addCounter(aggregate.preflop.rfi, preflop?.rfi);
  RFI_POSITIONS.forEach((position) => {
    addCounter(aggregate.preflop.rfiByPosition[position], preflop?.rfiByPosition?.[position]);
  });

  const postflop = heroStats?.postflop;
  if (postflop?.aggression?.total) {
    AGGRESSION_SCOPES.forEach((scope) => {
      addAggressionCounter(aggregate.aggression[scope], postflop.aggression?.[scope]);
    });
  } else {
    addAggressionCounter(aggregate.aggression.total, {
      betsRaises: hand.heroPostFlopBetsRaises,
      calls: hand.heroPostFlopCalls,
    });
  }
  addCounter(aggregate.cBet, postflop?.cBet);
  addCounter(aggregate.cBetSrp, postflop?.cBetSrp);
  addCounter(aggregate.foldToCBet, postflop?.foldToCBet);

  const showdown = heroStats?.showdown;
  addCounter(aggregate.showdown.wtsd, showdown?.wtsd || {
    opportunities: hand.heroSawFlop ? 1 : 0,
    executions: hand.heroSawFlop && hand.sawShowdown ? 1 : 0,
  });
  addCounter(aggregate.showdown.wsd, showdown?.wsd || {
    opportunities: hand.sawShowdown ? 1 : 0,
    executions: hand.sawShowdown && hand.outcome === 'WON' ? 1 : 0,
  });
};

export const calculateSessionMetrics = (hands = [], gameType = 'mixed') => {
  const actualHands = (Array.isArray(hands) ? hands : []).filter((hand) => hand && !hand.isRebuy);
  const normalizedGameType = normalizeGameType(gameType);
  const aggregate = createAggregateCounters();

  actualHands.forEach((hand) => addHandCounters(aggregate, hand));

  const totalProfit = round(
    actualHands.reduce((total, hand) => total + toFiniteNumber(hand.netProfit), 0),
    2,
  );
  const preflop = Object.fromEntries(
    Object.entries(aggregate.preflop)
      .filter(([key]) => key !== 'rfiByPosition')
      .map(([key, counter]) => [key, toPercentageMetric(counter)]),
  );
  preflop.rfiByPosition = Object.fromEntries(
    RFI_POSITIONS.map((position) => [
      position,
      toPercentageMetric(aggregate.preflop.rfiByPosition[position]),
    ]),
  );

  const metrics = {
    gameType: normalizedGameType,
    hands: actualHands.length,
    totalProfit,
    winrate: createWinrateMetric(actualHands, normalizedGameType),
    preflop,
    postflop: {
      af: Object.fromEntries(AGGRESSION_SCOPES.map((scope) => [
        scope,
        toAggressionFactorMetric(aggregate.aggression[scope]),
      ])),
      afq: Object.fromEntries(AGGRESSION_SCOPES.map((scope) => [
        scope,
        toAggressionFrequencyMetric(aggregate.aggression[scope]),
      ])),
      cBet: toPercentageMetric(aggregate.cBet),
      cBetSrp: toPercentageMetric(aggregate.cBetSrp),
      foldToCBet: toPercentageMetric(aggregate.foldToCBet),
    },
    showdown: {
      wtsd: toPercentageMetric(aggregate.showdown.wtsd),
      wsd: toPercentageMetric(aggregate.showdown.wsd),
    },
  };

  metrics.playerProfile = classifyPlayerStyle(metrics, actualHands);
  return metrics;
};
