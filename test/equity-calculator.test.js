import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateHoldemEquity,
  calculateHoldemEquityAsync,
  calculateHoldemRangeEquity,
  clearEquityCache,
  DEFAULT_MAX_ENUMERATED_OUTCOMES,
  DEFAULT_SIMULATION_SAMPLES,
  getEquityAnswerOptions,
  getEquityCacheSize,
  getEquityBucket,
  gradeEquityBucket,
  expandWeightedHandClass,
} from '../src/parser/equityCalculator.js';

test('zakres 169 klas rozwija się z card removal i daje deterministyczny wynik', () => {
  assert.equal(expandWeightedHandClass({ handClass: 'AKs', weight: 1 }, ['As', 'Kd']).length, 2);
  const first = calculateHoldemRangeEquity({
    heroCards: ['As', 'Kd'],
    opponentRange: [{ handClass: 'QQ', weight: 1 }],
    boardCards: ['2c', '7d', 'Jh'],
  });
  const second = calculateHoldemRangeEquity({
    heroCards: ['As', 'Kd'],
    opponentRange: [{ handClass: 'QQ', weight: 1 }],
    boardCards: ['2c', '7d', 'Jh'],
  });
  assert.equal(first.equity, second.equity);
  assert.equal(first.rangeCombinationCount, 6);
  assert.equal(first.calculatorVersion, 'equity-v1');
});

test('equity na riverze rozpoznaje wygranÄ…, remis i stratÄ™ z peĹ‚nego porĂłwnania', () => {
  const result = calculateHoldemEquity({
    heroCards: ['Ah', 'Kd'],
    villainCards: ['As', 'Kc'],
    boardCards: ['Qh', 'Jd', 'Tc', '2s', '3h'],
  });

  assert.equal(result.method, 'enumeration');
  assert.equal(result.samples, 1);
  assert.equal(result.wins, 0);
  assert.equal(result.ties, 1);
  assert.equal(result.losses, 0);
  assert.equal(result.equity, 0.5);
  assert.equal(result.marginOfError, 0);
  assert.equal(result.street, 'RIVER');
});

test('odpowiedzi equity używają wartości 10–100% i tolerancji ±5 punktów procentowych', () => {
  assert.deepEqual(getEquityAnswerOptions().map(({ label }) => label), [
    '10%', '20%', '30%', '40%', '50%', '60%', '70%', '80%', '90%', '100%',
  ]);
  assert.equal(getEquityBucket(0).id, 'equity_10');
  assert.equal(getEquityBucket(10).id, 'equity_10');
  assert.equal(getEquityBucket(100).id, 'equity_100');

  const exact = { equityPercent: 31.5, method: 'enumeration' };
  assert.equal(gradeEquityBucket('equity_30', exact).grade, 'correct');
  assert.equal(gradeEquityBucket('equity_20', exact).grade, 'incorrect');
  assert.equal(gradeEquityBucket('equity_40', { ...exact, equityPercent: 35 }).grade, 'correct');
  assert.equal(gradeEquityBucket('equity_40', { ...exact, equityPercent: 34.9 }).grade, 'incorrect');
  assert.equal(gradeEquityBucket('equity_30', {
    equityPercent: 35,
    method: 'simulation',
    confidence95: { marginOfErrorPercent: 5 },
  }).grade, 'correct');
});

test('flop i turn sÄ… liczone przez peĹ‚nÄ… enumeracjÄ™ wszystkich runoutĂłw', () => {
  const flop = calculateHoldemEquity({
    heroCards: ['Ah', 'Ad'],
    villainCards: ['Kc', 'Kh'],
    boardCards: ['2c', '7d', '9s'],
  });
  const turn = calculateHoldemEquity({
    heroCards: ['Ah', 'Ad'],
    villainCards: ['Kc', 'Kh'],
    boardCards: ['2c', '7d', '9s', '3h'],
  });

  assert.equal(flop.method, 'enumeration');
  assert.equal(flop.theoreticalOutcomes, 990);
  assert.equal(flop.samples, 990);
  assert.equal(flop.wins + flop.ties + flop.losses, 990);
  assert.equal(turn.method, 'enumeration');
  assert.equal(turn.theoreticalOutcomes, 44);
  assert.equal(turn.samples, 44);
  assert.equal(turn.wins + turn.ties + turn.losses, 44);
});

test('preflop przekracza prĂłg enumeracji i uĹĽywa deterministycznej symulacji', () => {
  const options = {
    heroCards: ['Ah', 'Kd'],
    villainCards: ['Qs', 'Jc'],
    boardCards: [],
    simulationSamples: 1_000,
    seed: 'equity-test-seed',
    useCache: false,
  };
  const first = calculateHoldemEquity(options);
  const second = calculateHoldemEquity(options);

  assert.equal(first.method, 'simulation');
  assert.equal(first.theoreticalOutcomes, 1_712_304);
  assert.equal(first.samples, 1_000);
  assert.ok(first.marginOfError > 0);
  assert.deepEqual(second, first);
  assert.equal(DEFAULT_MAX_ENUMERATED_OUTCOMES, 250_000);
  assert.equal(DEFAULT_SIMULATION_SAMPLES, 100_000);
});

test('wynik jest cacheowany, a obliczenie asynchroniczne nie zmienia kontraktu', async () => {
  clearEquityCache();
  const options = {
    heroCards: ['Ah', 'Kh'],
    villainCards: ['Qh', 'Qd'],
    boardCards: ['2c', '7s', '9h'],
  };
  assert.equal(getEquityCacheSize(), 0);
  const direct = calculateHoldemEquity(options);
  assert.equal(getEquityCacheSize(), 1);
  const asyncResult = await calculateHoldemEquityAsync(options);
  assert.deepEqual(asyncResult, direct);
});

test('silnik odrzuca zakres inny niĹĽ heads-up NLH i kolizje kart', () => {
  assert.throws(
    () => calculateHoldemEquity({
      heroCards: ['Ah', 'Kd'],
      villainCards: ['Ah', 'Qs'],
      boardCards: [],
    }),
    /duplicate cards/,
  );
  assert.throws(
    () => calculateHoldemEquity({
      heroCards: ['Ah', 'Kd'],
      villainCards: ['Qs', 'Jc'],
      boardCards: ['2c'],
    }),
    /boardCards must contain 0, 3, 4 or 5 cards/,
  );
  assert.throws(
    () => calculateHoldemEquity({
      heroCards: ['Ah', 'Kd'],
      villainCards: ['Qs', 'Jc'],
      boardCards: [],
      gameVariant: 'NLH BombPot',
    }),
    /NLH heads-up only/,
  );
});
