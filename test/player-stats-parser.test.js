import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTourneySessions, parseRawHandHistory } from '../src/parser/pokerParser.js';

const makeHand = ({
  id,
  stakes = '$0.50/$1/$0.10',
  buttonSeat = 5,
  seats = ['bb', 'utg', 'hj', 'Hero', 'btn', 'sb'],
  posts = 'sb: posts small blind $0.50\nbb: posts big blind $1',
  actions = [],
  streets = [],
  showdown = [],
  summary,
}) => {
  const heroSeat = seats.indexOf('Hero') + 1;
  const seatLines = seats.map((player, index) => `Seat ${index + 1}: ${player} ($100 in chips)`).join('\n');
  const dealtLines = seats.map((player) => (player === 'Hero' ? 'Dealt to Hero [Ah Kh]' : `Dealt to ${player}`)).join('\n');
  const defaultSummary = `Seat ${heroSeat}: Hero folded before Flop`;
  return `CoinPoker Hand #${id}: NLH (${stakes}) 2026/08/03 12:00:00 UTC
Table 'stats-test' ${seats.length}-max Seat #${buttonSeat} is the button
${seatLines}
${posts}
*** HOLE CARDS ***
${dealtLines}
${actions.join('\n')}
${streets.join('\n')}
${showdown.join('\n')}
*** SUMMARY ***
Total pot $10 | Rake $0
Board [ ]
${summary || defaultSummary}`;
};

const parseOne = (options) => parseRawHandHistory(makeHand(options))[0];

test('dodaje kontrakt per-hand z nominalnym BB i zgodnymi aliasami VPIP/PFR', () => {
  const hand = parseOne({
    id: '10001',
    actions: [
      'utg: folds',
      'hj: folds',
      'Hero: raises $2 to $3',
      'btn: folds',
      'sb: folds',
      'bb: folds',
    ],
    summary: 'Seat 4: Hero showed [Ah Kh] and won ($4.50) with Pair',
  });

  assert.equal(hand.blinds, '$0.50/$1/$0.10');
  assert.equal(hand.smallBlind, 0.5);
  assert.equal(hand.bigBlind, 1);
  assert.equal(hand.ante, 0.1);
  assert.equal(hand.position, 'CO');
  assert.deepEqual(hand.heroStats.preflop.vpip, { opportunities: 1, executions: 1 });
  assert.deepEqual(hand.heroStats.preflop.pfr, { opportunities: 1, executions: 1 });
  assert.deepEqual(hand.heroStats.preflop.rfi, { opportunities: 1, executions: 1 });
  assert.deepEqual(hand.heroStats.preflop.rfiByPosition.CO, { opportunities: 1, executions: 1 });
  assert.equal(hand.heroVPIP, true);
  assert.equal(hand.heroPFR, true);
  assert.equal(hand.heroInvestment, 3);
});

test('rozpoznaje 3-bet, fold to 3-bet i 4-bet po realnej okazji', () => {
  const threeBet = parseOne({
    id: '10002',
    actions: [
      'utg: folds',
      'hj: raises $2 to $3',
      'Hero: raises $6 to $9',
      'btn: folds',
      'sb: folds',
      'bb: folds',
      'hj: folds',
    ],
  });
  const foldToThreeBet = parseOne({
    id: '10003',
    actions: [
      'utg: folds',
      'hj: folds',
      'Hero: raises $2 to $3',
      'btn: raises $6 to $9',
      'sb: folds',
      'bb: folds',
      'Hero: folds',
    ],
  });
  const fourBet = parseOne({
    id: '10004',
    actions: [
      'utg: folds',
      'hj: folds',
      'Hero: raises $2 to $3',
      'btn: raises $6 to $9',
      'sb: folds',
      'bb: folds',
      'Hero: raises $18 to $27',
      'btn: folds',
    ],
  });

  assert.deepEqual(threeBet.heroStats.preflop.threeBet, { opportunities: 1, executions: 1 });
  assert.equal(threeBet.heroPFR, true);
  assert.deepEqual(foldToThreeBet.heroStats.preflop.foldToThreeBet, { opportunities: 1, executions: 1 });
  assert.deepEqual(foldToThreeBet.heroStats.preflop.fourBet, { opportunities: 1, executions: 0 });
  assert.deepEqual(fourBet.heroStats.preflop.foldToThreeBet, { opportunities: 1, executions: 0 });
  assert.deepEqual(fourBet.heroStats.preflop.fourBet, { opportunities: 1, executions: 1 });
});

test('traktuje short all-in call jako call, a nie falszywy raise', () => {
  const preflopCall = parseOne({
    id: '10005',
    actions: [
      'utg: ALLIN $10',
      'hj: folds',
      'Hero: ALLIN $8',
      'btn: folds',
      'sb: folds',
      'bb: folds',
    ],
  });
  const postflopCall = parseOne({
    id: '10006',
    actions: [
      'utg: calls $1',
      'hj: folds',
      'Hero: calls $1',
      'btn: folds',
      'sb: folds',
      'bb: checks',
    ],
    streets: [
      '*** FLOP *** [2c 3d 4h]',
      'utg: ALLIN $5',
      'Hero: ALLIN $3',
      '*** TURN *** [2c 3d 4h] [5s]',
      '*** RIVER *** [2c 3d 4h 5s] [6c]',
    ],
  });

  assert.equal(preflopCall.heroVPIP, true);
  assert.equal(preflopCall.heroPFR, false);
  assert.deepEqual(preflopCall.heroStats.preflop.threeBet, { opportunities: 1, executions: 0 });
  assert.equal(preflopCall.heroStats.preflop.heroHadDecision, true);
  assert.equal(preflopCall.heroStats.preflop.heroWentAllIn, true);
  assert.equal(preflopCall.heroStats.preflop.heroCallCount, 0);
  assert.equal(postflopCall.heroStats.preflop.heroWentAllIn, false);
  assert.equal(postflopCall.heroStats.preflop.heroCallCount, 1);
  assert.equal(postflopCall.heroPostFlopBetsRaises, 0);
  assert.equal(postflopCall.heroPostFlopCalls, 1);
});

test('regresja #87872500034: Hero nie dostaje drugiego raise za call all-in', () => {
  const hand = parseOne({
    id: '87872500034',
    stakes: '$0.10/$0.25/$0.04',
    buttonSeat: 2,
    seats: ['db585908', 'Hero', '55e78275', 'e9aa6006', 'a124b946', '51d03b07'],
    posts: `db585908: posts ante $0.04
Hero: posts ante $0.04
55e78275: posts ante $0.04
e9aa6006: posts ante $0.04
a124b946: posts ante $0.04
51d03b07: posts ante $0.04
55e78275: posts small blind $0.10
e9aa6006: posts big blind $0.25`,
    actions: [
      'a124b946: raises $0.35 to $0.60',
      '51d03b07: folds',
      'db585908: raises $1.26 to $1.86',
      'Hero: raises $5.96 to $7.82',
      '55e78275: folds',
      'e9aa6006: folds',
      'a124b946: ALLIN $27.48',
      'db585908: folds',
      'Hero: ALLIN $17.41',
      'a124b946: RETURN $2.85',
    ],
  });

  assert.equal(hand.heroPFR, true);
  assert.equal(hand.heroStats.preflop.heroRaiseCount, 1);
  assert.equal(hand.heroStats.preflop.totalRaiseCount, 4);
  assert.equal(hand.heroStats.preflop.heroWentAllIn, true);
  assert.equal(hand.heroStats.preflop.heroCallCount, 0);
});

test('liczy straddle, AUTOBB i RETURN do inwestycji bez falszowania VPIP/PFR/RFI', () => {
  const straddle = parseOne({
    id: '10007',
    stakes: '$0.50/$1/$0.16',
    posts: `Hero: posts ante $0.16
utg: posts ante $0.16
hj: posts ante $0.16
btn: posts ante $0.16
sb: posts ante $0.16
bb: posts ante $0.16
sb: posts small blind $0.50
bb: posts big blind $1`,
    actions: [
      'Hero: STRADDLE $2',
      'utg: folds',
      'hj: folds',
      'btn: folds',
      'sb: folds',
      'bb: folds',
      'Hero: RETURN $1',
    ],
    summary: 'Seat 4: Hero showed [3d 4d] and won ($3.36)',
  });
  const autoBb = parseOne({
    id: '10008',
    stakes: '$0.01/$0.02',
    posts: 'sb: posts small blind $0.01\nbb: posts big blind $0.02',
    actions: [
      'Hero: AUTOBB $0.02',
      'utg: folds',
      'Hero: checks',
      'hj: folds',
      'btn: folds',
      'sb: calls $0.01',
      'bb: checks',
    ],
    streets: [
      '*** FLOP *** [2d Kc 2h]',
      'Hero: bets $0.12',
      'sb: folds',
      'bb: folds',
      'Hero: RETURN $0.12',
    ],
    summary: 'Seat 4: Hero showed [Qs 4h] and won ($0.06)',
  });

  assert.equal(straddle.heroInvestment, 1.16);
  assert.equal(straddle.netProfit, 2.2);
  assert.equal(straddle.heroVPIP, true);
  assert.equal(straddle.heroPFR, false);
  assert.equal(straddle.heroStats.preflop.hasStraddle, true);
  assert.deepEqual(straddle.heroStats.preflop.rfi, { opportunities: 0, executions: 0 });
  assert.equal(autoBb.heroInvestment, 0.02);
  assert.equal(autoBb.netProfit, 0.04);
  assert.equal(autoBb.heroVPIP, false);
  assert.equal(autoBb.heroPFR, false);
  assert.equal(autoBb.heroStats.preflop.hasAutoBigBlind, true);
  assert.deepEqual(autoBb.heroStats.preflop.rfi, { opportunities: 0, executions: 0 });
});

test('liczy RFI osobno na BTN, SB i bez podwojenia w heads-up BTN/SB', () => {
  const button = parseOne({
    id: '10009',
    seats: ['bb', 'utg', 'hj', 'co', 'Hero', 'sb'],
    buttonSeat: 5,
    actions: [
      'utg: folds',
      'hj: folds',
      'co: folds',
      'Hero: raises $2 to $3',
      'sb: folds',
      'bb: folds',
    ],
    summary: 'Seat 5: Hero showed [Ah Kh] and won ($4.50) with Pair',
  });
  const smallBlind = parseOne({
    id: '10010',
    seats: ['bb', 'utg', 'hj', 'btn', 'co', 'Hero'],
    buttonSeat: 4,
    posts: 'Hero: posts small blind $0.50\nbb: posts big blind $1',
    actions: [
      'utg: folds',
      'hj: folds',
      'btn: folds',
      'co: folds',
      'Hero: raises $2.50 to $3',
      'bb: folds',
    ],
    summary: 'Seat 6: Hero showed [Ah Kh] and won ($4.50) with Pair',
  });
  const headsUp = parseOne({
    id: '10011',
    seats: ['bb', 'Hero'],
    buttonSeat: 2,
    posts: 'Hero: posts small blind $0.50\nbb: posts big blind $1',
    actions: ['Hero: raises $2.50 to $3', 'bb: folds'],
    summary: 'Seat 2: Hero showed [Ah Kh] and won ($4.50) with Pair',
  });

  assert.deepEqual(button.heroStats.preflop.rfiByPosition.BTN, { opportunities: 1, executions: 1 });
  assert.deepEqual(smallBlind.heroStats.preflop.rfiByPosition.SB, { opportunities: 1, executions: 1 });
  assert.equal(smallBlind.heroInvestment, 3);
  assert.equal(headsUp.position, 'BTN');
  assert.deepEqual(headsUp.heroStats.preflop.rfiByPosition['BTN/SB'], { opportunities: 1, executions: 1 });
  assert.deepEqual(headsUp.heroStats.preflop.rfiByPosition.BTN, { opportunities: 0, executions: 0 });
});

test('zachowuje kanoniczne nazwy ulic multi-board i sumuje wygrane z SUMMARY', () => {
  const hand = parseOne({
    id: '10012',
    actions: [
      'utg: folds',
      'hj: folds',
      'Hero: raises $2 to $3',
      'btn: calls $3',
      'sb: folds',
      'bb: folds',
    ],
    streets: [
      '*** FIRST FLOP *** [2c 3d 4h]',
      '*** FIRST TURN *** [2c 3d 4h] [5s]',
      '*** FIRST RIVER *** [2c 3d 4h 5s] [6c]',
      '*** SECOND FLOP *** [7c 8d 9h]',
      '*** SECOND TURN *** [7c 8d 9h] [Ts]',
      '*** SECOND RIVER *** [7c 8d 9h Ts] [Jc]',
    ],
    showdown: [
      '*** FIRST SHOWDOWN ***',
      'Hero: shows [Ah Kh] (Pair)',
      '*** SECOND SHOWDOWN ***',
      'Hero: shows [Ah Kh] (Pair)',
    ],
    summary: 'Seat 4: Hero showed [Ah Kh] and won ($0.70), and won ($0.70) with Pair',
  });

  const firstFlop = hand.streets.find((street) => street.displayName === 'FIRST FLOP');
  const secondRiver = hand.streets.find((street) => street.displayName === 'SECOND RIVER');
  assert.equal(firstFlop.name, 'FLOP');
  assert.equal(firstFlop.boardIndex, 1);
  assert.equal(secondRiver.name, 'RIVER');
  assert.equal(secondRiver.boardIndex, 2);
  assert.equal(hand.heroWinnings, 1.4);
  assert.equal(hand.outcome, 'WON');
  assert.deepEqual(hand.heroStats.postflop.cBet, { opportunities: 0, executions: 0 });
  assert.deepEqual(hand.heroStats.postflop.foldToCBet, { opportunities: 0, executions: 0 });
});

test('liczy agresje postflop oraz c-bet i c-bet SRP w puli multiway', () => {
  const hand = parseOne({
    id: '10015',
    actions: [
      'utg: folds',
      'hj: folds',
      'Hero: raises $2 to $3',
      'btn: calls $3',
      'sb: folds',
      'bb: calls $2',
    ],
    streets: [
      '*** FLOP *** [2c 3d 4h]',
      'bb: checks',
      'Hero: bets $4',
      'btn: calls $4',
      'bb: folds',
      '*** TURN *** [2c 3d 4h] [5s]',
      'Hero: checks',
      'btn: bets $8',
      'Hero: calls $8',
      '*** RIVER *** [2c 3d 4h 5s] [6c]',
      'Hero: bets $20',
      'btn: raises $30 to $50',
      'Hero: calls $30',
    ],
    showdown: [
      '*** SHOWDOWN ***',
      'Hero: shows [Ah Kh] (Straight)',
      'btn: mucks hand',
    ],
    summary: 'Seat 4: Hero showed [Ah Kh] and won ($100) with Straight',
  });

  assert.deepEqual(hand.heroStats.postflop.aggression, {
    total: { betsRaises: 2, calls: 2 },
    flop: { betsRaises: 1, calls: 0 },
    turn: { betsRaises: 0, calls: 1 },
    river: { betsRaises: 1, calls: 1 },
  });
  assert.equal(hand.heroPostFlopBetsRaises, 2);
  assert.equal(hand.heroPostFlopCalls, 2);
  assert.deepEqual(hand.heroStats.postflop.cBet, { opportunities: 1, executions: 1 });
  assert.deepEqual(hand.heroStats.postflop.cBetSrp, { opportunities: 1, executions: 1 });
  assert.deepEqual(hand.heroStats.postflop.foldToCBet, { opportunities: 0, executions: 0 });
  assert.deepEqual(hand.heroStats.showdown.wtsd, { opportunities: 1, executions: 1 });
  assert.deepEqual(hand.heroStats.showdown.wsd, { opportunities: 1, executions: 1 });
});

test('odróżnia c-bet w 3-bet pot od SRP oraz liczy fold do c-beta multiway', () => {
  const threeBetPot = parseOne({
    id: '10016',
    actions: [
      'utg: raises $2 to $3',
      'hj: folds',
      'Hero: raises $6 to $9',
      'btn: folds',
      'sb: folds',
      'bb: folds',
      'utg: calls $6',
    ],
    streets: [
      '*** FLOP *** [2c 3d 4h]',
      'utg: checks',
      'Hero: bets $8',
      'utg: folds',
    ],
    summary: 'Seat 4: Hero showed [Ah Kh] and won ($18) with High Card',
  });
  const foldToCBet = parseOne({
    id: '10017',
    actions: [
      'utg: raises $2 to $3',
      'hj: calls $3',
      'Hero: calls $3',
      'btn: calls $3',
      'sb: folds',
      'bb: folds',
    ],
    streets: [
      '*** FLOP *** [2c 3d 4h]',
      'utg: bets $5',
      'hj: calls $5',
      'Hero: folds',
      'btn: folds',
    ],
    summary: 'Seat 4: Hero folded on the Flop',
  });
  const donkBet = parseOne({
    id: '10018',
    actions: [
      'utg: folds',
      'hj: folds',
      'Hero: raises $2 to $3',
      'btn: calls $3',
      'sb: folds',
      'bb: folds',
    ],
    streets: [
      '*** FLOP *** [2c 3d 4h]',
      'btn: bets $4',
      'Hero: folds',
    ],
    summary: 'Seat 4: Hero folded on the Flop',
  });
  const checkedBack = parseOne({
    id: '10020',
    actions: [
      'utg: folds',
      'hj: folds',
      'Hero: raises $2 to $3',
      'btn: calls $3',
      'sb: folds',
      'bb: folds',
    ],
    streets: [
      '*** FLOP *** [2c 3d 4h]',
      'btn: checks',
      'Hero: checks',
    ],
    summary: 'Seat 4: Hero showed [Ah Kh] and won ($6) with High Card',
  });
  const raisedBeforeHero = parseOne({
    id: '10021',
    actions: [
      'utg: raises $2 to $3',
      'hj: calls $3',
      'Hero: calls $3',
      'btn: folds',
      'sb: folds',
      'bb: folds',
    ],
    streets: [
      '*** FLOP *** [2c 3d 4h]',
      'utg: bets $5',
      'hj: raises $5 to $10',
      'Hero: folds',
    ],
    summary: 'Seat 4: Hero folded on the Flop',
  });

  assert.deepEqual(threeBetPot.heroStats.postflop.cBet, { opportunities: 1, executions: 1 });
  assert.deepEqual(threeBetPot.heroStats.postflop.cBetSrp, { opportunities: 0, executions: 0 });
  assert.deepEqual(foldToCBet.heroStats.postflop.foldToCBet, { opportunities: 1, executions: 1 });
  assert.deepEqual(foldToCBet.heroStats.showdown.wtsd, { opportunities: 1, executions: 0 });
  assert.deepEqual(foldToCBet.heroStats.showdown.wsd, { opportunities: 0, executions: 0 });
  assert.deepEqual(donkBet.heroStats.postflop.cBet, { opportunities: 0, executions: 0 });
  assert.deepEqual(donkBet.heroStats.postflop.cBetSrp, { opportunities: 0, executions: 0 });
  assert.deepEqual(checkedBack.heroStats.postflop.cBet, { opportunities: 1, executions: 0 });
  assert.deepEqual(checkedBack.heroStats.postflop.cBetSrp, { opportunities: 1, executions: 0 });
  assert.deepEqual(raisedBeforeHero.heroStats.postflop.foldToCBet, { opportunities: 0, executions: 0 });
});

test('ustala W$SD z wyniku w SUMMARY, ale WTSD tylko z faktycznego showdownu Hero', () => {
  const lostAtShowdown = parseOne({
    id: '10019',
    actions: [
      'utg: raises $2 to $3',
      'hj: folds',
      'Hero: calls $3',
      'btn: folds',
      'sb: folds',
      'bb: folds',
    ],
    streets: [
      '*** FLOP *** [2c 3d 4h]',
      'utg: checks',
      'Hero: checks',
      '*** TURN *** [2c 3d 4h] [5s]',
      'utg: checks',
      'Hero: checks',
      '*** RIVER *** [2c 3d 4h 5s] [6c]',
      'utg: checks',
      'Hero: checks',
    ],
    showdown: [
      '*** SHOWDOWN ***',
      'Hero: shows [Ah Kh] (High Card)',
      'utg: shows [2s 2h] (Three of a Kind)',
    ],
    summary: 'Seat 4: Hero showed [Ah Kh] and lost with High Card',
  });

  assert.equal(lostAtShowdown.outcome, 'LOST');
  assert.deepEqual(lostAtShowdown.heroStats.showdown.wtsd, { opportunities: 1, executions: 1 });
  assert.deepEqual(lostAtShowdown.heroStats.showdown.wsd, { opportunities: 1, executions: 0 });
});

test('pozostawia syntetyczny rebuy poza kontraktem prawdziwych rozdan', () => {
  const toTournament = (raw, heroStack) => raw
    .replace("Table 'stats-test' 6-max Seat #5 is the button", "Tournament 'Stats test' '9001' 6-max Seat #5 is the button")
    .replace('Seat 4: Hero ($100 in chips)', `Seat 4: Hero (${heroStack} in chips)`);
  const first = parseRawHandHistory(toTournament(makeHand({ id: '10013' }), 100))[0];
  const second = parseRawHandHistory(toTournament(makeHand({ id: '10014' }), 350))[0];
  const [tourney] = buildTourneySessions([first, second]);

  assert.equal(tourney.hands.filter((hand) => !hand.isRebuy).length, 2);
  assert.equal(tourney.hands.filter((hand) => hand.isRebuy).length, 1);
  assert.equal(tourney.hands.find((hand) => hand.isRebuy).heroStats, undefined);
  assert.ok(tourney.hands.filter((hand) => !hand.isRebuy).every((hand) => hand.heroStats));
});
