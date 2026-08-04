import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildTourneySessions, parseRawHandHistory } from '../src/parser/pokerParser.js';
import {
  calculateSessionMetrics,
  INFINITE_METRIC,
  UNAVAILABLE_METRIC,
} from '../src/utils/sessionMetrics.js';

const fixturePath = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const loadHands = async (name) => parseRawHandHistory(await readFile(fixturePath(name), 'utf8'));

const assertCounterInvariant = (counter, label) => {
  assert.ok(counter.opportunities >= 0, `${label}: opportunities cannot be negative`);
  assert.ok(counter.executions >= 0, `${label}: executions cannot be negative`);
  assert.ok(counter.executions <= counter.opportunities, `${label}: executions cannot exceed opportunities`);
};

const assertMetricInvariants = (metrics) => {
  Object.entries(metrics.preflop)
    .filter(([key]) => key !== 'rfiByPosition')
    .forEach(([key, counter]) => assertCounterInvariant(counter, `preflop.${key}`));
  Object.entries(metrics.preflop.rfiByPosition)
    .forEach(([key, counter]) => assertCounterInvariant(counter, `rfi.${key}`));
  ['cBet', 'cBetSrp', 'foldToCBet'].forEach((key) => assertCounterInvariant(metrics.postflop[key], key));
  Object.entries(metrics.showdown).forEach(([key, counter]) => assertCounterInvariant(counter, `showdown.${key}`));

  assert.ok(metrics.preflop.pfr.executions <= metrics.preflop.vpip.executions, 'PFR must be a VPIP subset');
  assert.equal(
    metrics.preflop.rfi.executions,
    Object.values(metrics.preflop.rfiByPosition).reduce((total, counter) => total + counter.executions, 0),
    'RFI executions must equal tracked positional RFI executions',
  );
  assert.equal(
    metrics.preflop.rfi.opportunities,
    Object.values(metrics.preflop.rfiByPosition).reduce((total, counter) => total + counter.opportunities, 0),
    'RFI opportunities must equal tracked positional RFI opportunities',
  );
  assert.ok(metrics.postflop.cBetSrp.executions <= metrics.postflop.cBet.executions, 'SRP c-bets are c-bets');
  assert.ok(metrics.postflop.cBetSrp.opportunities <= metrics.postflop.cBet.opportunities, 'SRP c-bet opportunities are c-bet opportunities');
  assert.equal(metrics.showdown.wsd.opportunities, metrics.showdown.wtsd.executions, 'W$SD denominator is actual showdowns');
};

test('golden Cash fixture: parser i agregator zwracaja recznie zweryfikowane liczniki oraz BB/100', async () => {
  const hands = await loadHands('stats-cash.txt');
  const metrics = calculateSessionMetrics(hands, 'cash');

  assert.equal(hands.length, 6);
  assert.deepEqual(hands.map((hand) => hand.netProfit), [35, -3, 10, 0, -3, 10]);
  assert.deepEqual(metrics.winrate, {
    value: 816.67,
    unit: 'BB/100',
    numerator: 49,
    denominator: 6,
  });
  assert.equal(metrics.totalProfit, 49);
  assert.deepEqual(metrics.preflop.vpip, { value: 83.3, opportunities: 6, executions: 5 });
  assert.deepEqual(metrics.preflop.pfr, { value: 66.7, opportunities: 6, executions: 4 });
  assert.deepEqual(metrics.preflop.threeBet, { value: 50, opportunities: 2, executions: 1 });
  assert.deepEqual(metrics.preflop.foldToThreeBet, { value: 50, opportunities: 2, executions: 1 });
  assert.deepEqual(metrics.preflop.fourBet, { value: 50, opportunities: 2, executions: 1 });
  assert.deepEqual(metrics.preflop.rfi, { value: 100, opportunities: 3, executions: 3 });
  assert.deepEqual(metrics.preflop.rfiByPosition.CO, { value: 100, opportunities: 1, executions: 1 });
  assert.deepEqual(metrics.preflop.rfiByPosition.BTN, { value: 100, opportunities: 1, executions: 1 });
  assert.deepEqual(metrics.preflop.rfiByPosition.SB, { value: 100, opportunities: 1, executions: 1 });
  assert.equal(metrics.preflop.rfiByPosition['BTN/SB'].value, UNAVAILABLE_METRIC);
  assert.deepEqual(metrics.postflop.cBet, { value: 100, opportunities: 2, executions: 2 });
  assert.deepEqual(metrics.postflop.cBetSrp, { value: 100, opportunities: 1, executions: 1 });
  assert.deepEqual(metrics.postflop.foldToCBet, { value: 100, opportunities: 1, executions: 1 });
  assert.deepEqual(metrics.showdown.wtsd, { value: 25, opportunities: 4, executions: 1 });
  assert.deepEqual(metrics.showdown.wsd, { value: 100, opportunities: 1, executions: 1 });
  assert.equal(metrics.postflop.af.total.value, 4);
  assert.equal(metrics.postflop.afq.total.value, 80);
  assert.equal(metrics.postflop.af.flop.value, INFINITE_METRIC);
  assert.equal(metrics.postflop.afq.flop.value, 100);
  assert.equal(metrics.postflop.af.turn.value, 0);
  assert.equal(metrics.postflop.afq.turn.value, 0);
  assertMetricInvariants(metrics);
});

test('golden tournament fixture: rebuy nie zmienia Hands, licznikow, wyniku ani zetony/100', async () => {
  const parsedHands = await loadHands('stats-tournament.txt');
  const [tourney] = buildTourneySessions(parsedHands);
  const metrics = calculateSessionMetrics(tourney.hands, 'tournament');

  assert.equal(tourney.hands.length, 3);
  assert.equal(tourney.hands.filter((hand) => hand.isRebuy).length, 1);
  assert.equal(tourney.hands.find((hand) => hand.isRebuy).netProfit, 0);
  assert.equal(metrics.hands, 2);
  assert.equal(metrics.totalProfit, 0);
  assert.deepEqual(metrics.winrate, {
    value: 0,
    unit: 'żetony/100',
    numerator: 0,
    denominator: 2,
  });
  assert.deepEqual(metrics.preflop.vpip, { value: 100, opportunities: 2, executions: 2 });
  assert.deepEqual(metrics.preflop.pfr, { value: 50, opportunities: 2, executions: 1 });
  assert.deepEqual(metrics.preflop.threeBet, { value: 0, opportunities: 1, executions: 0 });
  assert.deepEqual(metrics.preflop.rfi, { value: 100, opportunities: 1, executions: 1 });
  assert.deepEqual(metrics.postflop.cBet, { value: 100, opportunities: 1, executions: 1 });
  assert.deepEqual(metrics.postflop.foldToCBet, { value: 100, opportunities: 1, executions: 1 });
  assert.equal(metrics.postflop.af.total.value, INFINITE_METRIC);
  assert.equal(metrics.postflop.afq.total.value, 100);
  assert.equal(metrics.postflop.af.turn.value, UNAVAILABLE_METRIC);
  assert.equal(metrics.postflop.afq.turn.value, UNAVAILABLE_METRIC);
  assert.deepEqual(metrics.showdown.wtsd, { value: 0, opportunities: 2, executions: 0 });
  assert.equal(metrics.showdown.wsd.value, UNAVAILABLE_METRIC);
  assertMetricInvariants(metrics);
});
