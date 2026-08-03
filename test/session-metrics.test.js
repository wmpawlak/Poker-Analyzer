import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateHeroMetrics } from '../src/utils/heroMetrics.js';
import {
  calculateSessionMetrics,
  INFINITE_METRIC,
  UNAVAILABLE_METRIC,
} from '../src/utils/sessionMetrics.js';

const toCounter = ([opportunities = 0, executions = 0] = []) => ({
  opportunities,
  executions,
});

const toAggression = ([betsRaises = 0, calls = 0] = []) => ({ betsRaises, calls });

const makeHand = ({
  netProfit = 0,
  bigBlind = 1,
  isTournament = false,
  vpip = 0,
  pfr = 0,
  threeBet,
  foldToThreeBet,
  fourBet,
  rfi,
  rfiByPosition = {},
  aggression = {},
  cBet,
  cBetSrp,
  foldToCBet,
  wtsd,
  wsd,
} = {}) => ({
  netProfit,
  bigBlind,
  isTournament,
  heroStats: {
    preflop: {
      vpip: toCounter([1, vpip]),
      pfr: toCounter([1, pfr]),
      threeBet: toCounter(threeBet),
      foldToThreeBet: toCounter(foldToThreeBet),
      fourBet: toCounter(fourBet),
      rfi: toCounter(rfi),
      rfiByPosition: {
        CO: toCounter(rfiByPosition.CO),
        BTN: toCounter(rfiByPosition.BTN),
        SB: toCounter(rfiByPosition.SB),
        'BTN/SB': toCounter(rfiByPosition['BTN/SB']),
      },
    },
    postflop: {
      aggression: {
        total: toAggression(aggression.total),
        flop: toAggression(aggression.flop),
        turn: toAggression(aggression.turn),
        river: toAggression(aggression.river),
      },
      cBet: toCounter(cBet),
      cBetSrp: toCounter(cBetSrp),
      foldToCBet: toCounter(foldToCBet),
    },
    showdown: {
      wtsd: toCounter(wtsd),
      wsd: toCounter(wsd),
    },
  },
});

test('zwraca kreskę dla metryk bez okazji i pustej sesji', () => {
  const metrics = calculateSessionMetrics([], 'cash');

  assert.equal(metrics.hands, 0);
  assert.equal(metrics.totalProfit, 0);
  assert.deepEqual(metrics.winrate, {
    value: UNAVAILABLE_METRIC,
    unit: 'BB/100',
    numerator: UNAVAILABLE_METRIC,
    denominator: 0,
  });
  assert.equal(metrics.preflop.vpip.value, UNAVAILABLE_METRIC);
  assert.equal(metrics.preflop.threeBet.value, UNAVAILABLE_METRIC);
  assert.equal(metrics.postflop.af.total.value, UNAVAILABLE_METRIC);
  assert.equal(metrics.postflop.afq.total.value, UNAVAILABLE_METRIC);
  assert.equal(metrics.showdown.wsd.value, UNAVAILABLE_METRIC);
  assert.equal(metrics.playerProfile.style, null);
  assert.equal(metrics.playerProfile.reliability.id, 'INSUFFICIENT');
});

test('agreguje Cash w BB/100 oraz AF i AFq łącznie i ulicami', () => {
  const hands = [
    makeHand({
      netProfit: 1,
      bigBlind: 0.1,
      vpip: 1,
      pfr: 1,
      threeBet: [1, 1],
      rfi: [1, 1],
      rfiByPosition: { CO: [1, 1] },
      aggression: {
        total: [2, 0],
        flop: [1, 0],
        turn: [1, 0],
      },
      cBet: [1, 1],
      cBetSrp: [1, 1],
      wtsd: [1, 1],
      wsd: [1, 1],
    }),
    makeHand({
      netProfit: -0.4,
      bigBlind: 0.2,
      foldToThreeBet: [1, 1],
      aggression: {
        total: [0, 2],
        flop: [0, 1],
        river: [0, 1],
      },
      foldToCBet: [1, 1],
      wtsd: [1, 0],
    }),
  ];
  const metrics = calculateSessionMetrics(hands, 'Cash');

  assert.equal(metrics.hands, 2);
  assert.equal(metrics.totalProfit, 0.6);
  assert.deepEqual(metrics.winrate, {
    value: 400,
    unit: 'BB/100',
    numerator: 8,
    denominator: 2,
  });
  assert.equal(metrics.preflop.vpip.value, 50);
  assert.equal(metrics.preflop.pfr.value, 50);
  assert.equal(metrics.preflop.threeBet.value, 100);
  assert.equal(metrics.preflop.foldToThreeBet.value, 100);
  assert.equal(metrics.preflop.fourBet.value, UNAVAILABLE_METRIC);
  assert.deepEqual(metrics.preflop.rfiByPosition.CO, {
    value: 100,
    opportunities: 1,
    executions: 1,
  });
  assert.equal(metrics.preflop.rfiByPosition.BTN.value, UNAVAILABLE_METRIC);

  assert.equal(metrics.postflop.af.total.value, 1);
  assert.equal(metrics.postflop.afq.total.value, 50);
  assert.equal(metrics.postflop.af.flop.value, 1);
  assert.equal(metrics.postflop.afq.flop.value, 50);
  assert.equal(metrics.postflop.af.turn.value, INFINITE_METRIC);
  assert.equal(metrics.postflop.afq.turn.value, 100);
  assert.equal(metrics.postflop.af.river.value, 0);
  assert.equal(metrics.postflop.afq.river.value, 0);
  assert.equal(metrics.postflop.cBet.value, 100);
  assert.equal(metrics.postflop.cBetSrp.value, 100);
  assert.equal(metrics.postflop.foldToCBet.value, 100);
  assert.equal(metrics.showdown.wtsd.value, 50);
  assert.equal(metrics.showdown.wsd.value, 100);
});

test('liczy turniej w żetonach na 100 i pomija syntetyczne rebuy', () => {
  const hands = [
    makeHand({ netProfit: 500, isTournament: true }),
    { isRebuy: true, isTournament: true, netProfit: 999999 },
    makeHand({ netProfit: -100, isTournament: true }),
  ];
  const metrics = calculateSessionMetrics(hands, 'Tournament');

  assert.equal(metrics.hands, 2);
  assert.equal(metrics.totalProfit, 400);
  assert.deepEqual(metrics.winrate, {
    value: 20000,
    unit: 'żetony/100',
    numerator: 400,
    denominator: 2,
  });
});

test('nie łączy Cash i turniejów w pozorny wspólny winrate', () => {
  const metrics = calculateSessionMetrics([
    makeHand({ netProfit: 1, bigBlind: 0.1 }),
    makeHand({ netProfit: 500, isTournament: true }),
  ], 'both');

  assert.equal(metrics.hands, 2);
  assert.equal(metrics.totalProfit, 501);
  assert.deepEqual(metrics.winrate, {
    value: UNAVAILABLE_METRIC,
    unit: null,
    numerator: UNAVAILABLE_METRIC,
    denominator: 2,
  });
});

test('nie zgaduje Cash winrate, gdy choć jedno rozdanie nie ma nominalnego BB', () => {
  const metrics = calculateSessionMetrics([
    makeHand({ netProfit: 1, bigBlind: 0 }),
  ], 'cash');

  assert.equal(metrics.winrate.value, UNAVAILABLE_METRIC);
  assert.equal(metrics.winrate.numerator, UNAVAILABLE_METRIC);
});

test('Mój profil korzysta z tego samego agregatora i właściwej jednostki', () => {
  const profile = calculateHeroMetrics([
    makeHand({
      netProfit: 1,
      bigBlind: 0.1,
      vpip: 1,
      pfr: 1,
      aggression: { total: [2, 0] },
    }),
    makeHand({
      netProfit: -0.4,
      bigBlind: 0.2,
      aggression: { total: [0, 2] },
    }),
  ], 'cash');

  assert.equal(profile.totalHands, 2);
  assert.equal(profile.vpip, '50.0');
  assert.equal(profile.pfr, '50.0');
  assert.equal(profile.af, '1.00');
  assert.equal(profile.totalProfit, '0.60');
  assert.equal(profile.winrate, '400.00');
  assert.equal(profile.winrateUnit, 'BB/100');
  assert.equal(profile.sessionMetrics.postflop.afq.total.value, 50);
  assert.equal(profile.sessionMetrics.playerProfile.reliability.id, 'INSUFFICIENT');
});

test('wspólny agregator dołącza klasyfikację stylu dla pełnej próby', () => {
  const hands = Array.from({ length: 100 }, (_, index) => makeHand({
    vpip: index < 22 ? 1 : 0,
    pfr: index < 19 ? 1 : 0,
    threeBet: index < 30 ? [1, index < 2 ? 1 : 0] : undefined,
    aggression: { total: index < 55 ? [1, 0] : [0, 1] },
    foldToCBet: index < 20 ? [1, index < 10 ? 1 : 0] : undefined,
  }));
  const metrics = calculateSessionMetrics(hands, 'cash');

  assert.equal(metrics.playerProfile.style.id, 'TAG');
  assert.equal(metrics.playerProfile.reliability.id, 'STATISTICAL');
});
