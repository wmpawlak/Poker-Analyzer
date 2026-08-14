import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CBET_SIZING,
  EXERCISE_TYPES,
  classifyTrainingSpots,
} from '../server/training/exerciseClassifier.js';
import { extractTrainingSpots } from '../server/training/spotExtractor.js';

const extract = (rawText) => {
  const result = extractTrainingSpots(rawText);
  assert.equal(result.status, 'accepted', result.rejection?.message);
  return result.spots;
};

const threeBetHand = `CoinPoker Hand #82001: NLH (0.50/1) 2026/08/11 10:00:00 UTC
Table 'three-bet' 3-max Seat #1 is the button
Seat 1: Hero (100 in chips)
Seat 2: Small (100 in chips)
Seat 3: Big (100 in chips)
Small: posts small blind 0.50
Big: posts big blind 1
*** HOLE CARDS ***
Dealt to Hero [Ah Kd]
Hero: raises 2 to 3
Small: raises 7 to 10
Big: folds
Hero: calls 7
*** FLOP *** [As 7c 2d]
Small: checks
Hero: checks
*** SUMMARY ***
Board [ As 7c 2d ]`;

const cbetHand = `CoinPoker Hand #82002: NLH (0.50/1) 2026/08/11 10:01:00 UTC
Table 'barrels' 2-max Seat #1 is the button
Seat 1: Hero (100 in chips)
Seat 2: Villain (100 in chips)
Hero: posts small blind 0.50
Villain: posts big blind 1
*** HOLE CARDS ***
Dealt to Hero [Qs Js]
Hero: raises 2 to 3
Villain: calls 2
*** FLOP *** [Ts 8d 2c]
Villain: checks
Hero: bets 2.40
Villain: calls 2.40
*** TURN *** [Ts 8d 2c] [3h]
Villain: checks
Hero: bets 6
Villain: calls 6
*** RIVER *** [Ts 8d 2c 3h] [Ac]
Villain: checks
Hero: checks
*** SUMMARY ***
Board [ Ts 8d 2c 3h Ac ]`;

const cbetShowdownHand = cbetHand.replace(
  '*** SUMMARY ***',
  '*** SHOWDOWN ***\nVillain: shows [Qc Qd]\nHero: shows [Qs Js]\n*** SUMMARY ***',
);

test('pierwsza decyzja trafia do selekcji, a późniejsza odpowiedź na 3-bet do osobnego trybu', () => {
  const spots = extract(threeBetHand);
  const pools = classifyTrainingSpots(spots);

  assert.equal(pools.preflop_selection.length, 1);
  assert.equal(pools.preflop_selection[0].sourceDecisionId, spots[0].id);
  assert.deepEqual(
    pools.preflop_selection[0].answerOptions.map(({ id }) => id),
    ['fold', 'call', 'raise'],
  );
  assert.equal(pools.preflop_vs_reraise.length, 1);
  assert.equal(pools.preflop_vs_reraise[0].sourceDecisionId, spots[1].id);
  assert.equal(pools.preflop_vs_reraise[0].scenario, 'open_vs_3bet');
  assert.equal(pools.preflop_vs_reraise[0].effectiveStackBb, spots[1].effectiveStackBb);
  assert.equal(pools.preflop_vs_reraise[0].potOdds, spots[1].potOdds);
});

test('znana reka nie tworzy equity spotu dla decyzji multiway', () => {
  const showdown = threeBetHand.replace(
    '*** SUMMARY ***',
    '*** SHOWDOWN ***\nSmall: shows [Qc Qd]\nHero: shows [Ah Kd]\n*** SUMMARY ***',
  );
  const spots = extract(showdown);
  const pools = classifyTrainingSpots(spots);

  assert.equal(pools.equity_pot_odds.length, 2);
  assert.deepEqual(
    pools.equity_pot_odds.map(({ sourceDecisionId }) => sourceDecisionId),
    [spots[1].id, spots[2].id],
  );
  assert.equal(pools.equity_pot_odds.every(({ question }) => question.context.opponentsInHand === 1), true);
});

test('rozpoznaje reshove po raise Hero, ale nie klasyfikuje limp–raise jako 3-betu', () => {
  const reshove = threeBetHand
    .replace('Small (100 in chips)', 'Small (10 in chips)')
    .replace('Small: raises 7 to 10', 'Small: ALLIN 9.50')
    .replace('*** FLOP *** [As 7c 2d]\nSmall: checks\nHero: checks\n', '');
  const reshovePools = classifyTrainingSpots(extract(reshove));
  assert.equal(reshovePools.preflop_vs_reraise.length, 1);
  assert.equal(reshovePools.preflop_vs_reraise[0].scenario, 'raise_vs_reshove');

  const limpRaise = threeBetHand
    .replace('Hero: raises 2 to 3', 'Hero: calls 1')
    .replace('Small: raises 7 to 10', 'Small: raises 3.50 to 4')
    .replace('Hero: calls 7', 'Hero: calls 3');
  const limpPools = classifyTrainingSpots(extract(limpRaise));
  assert.equal(limpPools.preflop_selection.length, 1);
  assert.equal(limpPools.preflop_vs_reraise.length, 0);
});

test('tworzy dwuetapowy epizod c-bet, stosuje próg 40% i oznacza historyczną linię turn', () => {
  const pools = classifyTrainingSpots(extract(cbetHand));
  const [flop, turn] = pools.cbet_barrels;

  assert.equal(pools.cbet_barrels.length, 2);
  assert.equal(pools.equity_pot_odds.length, 0);
  assert.equal(flop.episodeId, turn.episodeId);
  assert.equal(flop.stage, 'flop');
  assert.equal(turn.stage, 'turn');
  assert.equal(flop.sequenceLength, 2);
  assert.equal(flop.historicalAnswer.sizing, CBET_SIZING.SMALL_BET);
  assert.equal(flop.historicalAnswer.betToPotRatio, 0.4);
  assert.equal(turn.historicalAnswer.sizing, CBET_SIZING.LARGE_BET);
  assert.equal(turn.usesHistoricalLine, true);
  assert.match(turn.continuationNotice, /historycznej linii/i);
  assert.equal(turn.question.priorActions.some(
    ({ street, actor, type }) => street === 'FLOP' && actor === 'Hero' && type === 'bet',
  ), true);
});

test('pytanie nie zawiera odpowiedzi ani przyszłego boardu, a bet powyżej 40% jest duży', () => {
  const largeBetHand = cbetHand
    .replace('Hero: bets 2.40', 'Hero: bets 2.41')
    .replace('Villain: calls 2.40', 'Villain: calls 2.41');
  const [flop] = classifyTrainingSpots(extract(largeBetHand)).cbet_barrels;

  assert.equal('historicalAction' in flop.question, false);
  assert.deepEqual(flop.question.board, ['Ts', '8d', '2c']);
  assert.equal(flop.question.board.includes('Ac'), false);
  assert.equal(flop.question.priorActions.some(({ street }) => street === 'TURN'), false);
  assert.equal(flop.historicalAnswer.sizing, CBET_SIZING.LARGE_BET);
  assert.equal(flop.answerOptions.find(({ id }) => id === 'small_bet').maximumPotRatio, 0.4);
});

test('check flop kończy epizod c-bet, a donk bet nie tworzy fałszywej okazji', () => {
  const checkedFlop = cbetHand
    .replace('Hero: bets 2.40\nVillain: calls 2.40', 'Hero: checks')
    .replace('Hero: bets 6\nVillain: calls 6', 'Hero: bets 3\nVillain: calls 3');
  const checkedPools = classifyTrainingSpots(extract(checkedFlop));
  assert.equal(checkedPools.cbet_barrels.length, 1);
  assert.equal(checkedPools.cbet_barrels[0].historicalAnswer.sizing, CBET_SIZING.CHECK);

  const donk = cbetHand
    .replace('Villain: checks\nHero: bets 2.40\nVillain: calls 2.40', 'Villain: bets 2\nHero: calls 2')
    .replace('Villain: checks\nHero: bets 6\nVillain: calls 6', 'Villain: checks\nHero: checks');
  const donkPools = classifyTrainingSpots(extract(donk));
  assert.equal(donkPools.cbet_barrels.length, 0);
});

test('tryb equity znanej reki korzysta z showdownu tylko dla heads-up i nie przecieka do zwyklych pytan', () => {
  const pools = classifyTrainingSpots(extract(cbetShowdownHand));
  const summaryOnly = cbetHand.replace(
    '*** SUMMARY ***\nBoard',
    '*** SUMMARY ***\nSeat 2: Villain showed [Qc Qd] and won (20)\nSeat 1: Hero showed [Qs Js] and lost\nBoard',
  );
  const summaryPools = classifyTrainingSpots(extract(summaryOnly));

  assert.equal(pools.equity_pot_odds.length, 4);
  assert.equal(summaryPools.equity_pot_odds.length, 4);
  const flop = pools.equity_pot_odds.find(({ street }) => street === 'FLOP');
  const turn = pools.equity_pot_odds.find(({ street }) => street === 'TURN');
  assert.equal(flop.equityMode, 'known_hand');
  assert.deepEqual(flop.question.knownOpponentCards, ['Qc', 'Qd']);
  assert.equal(flop.question.equityMode, 'known_hand');
  assert.deepEqual(flop.question.board, ['Ts', '8d', '2c']);
  assert.deepEqual(turn.question.board, ['Ts', '8d', '2c', '3h']);
  assert.equal(flop.question.board.includes('Ac'), false);
  assert.equal('knownOpponentCards' in pools.cbet_barrels[0].question, false);
});

test('turn/river mapuje kategorie strategiczne na legalne akcje', () => {
  const pools = classifyTrainingSpots(extract(cbetHand));
  assert.equal(pools.turn_river.length, 2);

  const turn = pools.turn_river.find(({ street }) => street === 'TURN');
  assert.deepEqual(turn.actionByCategory, {
    check: 'check',
    value_bet: 'bet',
    bluff: 'bet',
  });
  assert.equal(turn.requiresStrategicCategory, true);

  const facingBet = cbetHand
    .replace('Villain: checks\nHero: bets 6\nVillain: calls 6', 'Villain: bets 6\nHero: calls 6')
    .replace('Villain: checks\nHero: checks', 'Villain: bets 10\nHero: folds');
  const facingPools = classifyTrainingSpots(extract(facingBet));
  const facingTurn = facingPools.turn_river.find(({ street }) => street === 'TURN');
  assert.deepEqual(facingTurn.actionByCategory, {
    fold: 'fold',
    bluff_catcher: 'call',
    value_bet: 'raise',
    bluff: 'raise',
  });
  assert.equal(facingPools.turn_river.find(({ street }) => street === 'RIVER').historicalAnswer.type, 'fold');
});

test('klasyfikacja jest deterministyczna i usuwa duplikaty wejściowych spotów', () => {
  const spots = extract(cbetHand);
  const first = classifyTrainingSpots([...spots, ...spots]);
  const second = classifyTrainingSpots([...spots].reverse());

  Object.values(EXERCISE_TYPES).forEach((type) => {
    assert.deepEqual(first[type].map(({ id }) => id), second[type].map(({ id }) => id));
  });
});
