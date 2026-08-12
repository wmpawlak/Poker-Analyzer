import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRAINING_SPOT_REJECTIONS,
  extractTrainingSpots,
  extractTrainingSpotsBatch,
} from '../server/training/spotExtractor.js';

const standardHand = `CoinPoker Hand #81001: NLH (10/20/2) 2026/08/10 12:00:00 UTC
Table 'training' 6-max Seat #6 is the button
Seat 1: Small (1,000 in chips)
Seat 2: Big (800 in chips)
Seat 3: Under (1,200 in chips)
Seat 4: Hijack (900 in chips)
Seat 5: Hero (1,000 in chips)
Seat 6: Button (1,100 in chips)
Small: posts ante 2
Big: posts ante 2
Under: posts ante 2
Hijack: posts ante 2
Hero: posts ante 2
Button: posts ante 2
Small: posts small blind 10
Big: posts big blind 20
*** HOLE CARDS ***
Dealt to Hero [Ah Kd]
Under: folds
Hijack: raises 40 to 60
Hero: calls 60
Button: folds
Small: folds
Big: calls 40
*** FLOP *** [As 7c 2d]
Big: checks
Hijack: bets 100
Hero: calls 100
Big: folds
*** TURN *** [As 7c 2d] [9h]
Hijack: checks
Hero: checks
*** RIVER *** [As 7c 2d 9h] [Qc]
Hijack: checks
Hero: bets 250
Hijack: folds
Hero: RETURN 250
*** SUMMARY ***
Total pot 402
Board [ As 7c 2d 9h Qc ]`;

test('ekstrahuje stan przed decyzją: pozycje, ante, pulę, call, pot odds i stack efektywny', () => {
  const result = extractTrainingSpots(standardHand);
  assert.equal(result.status, 'accepted');
  assert.equal(result.spots.length, 4);

  const preflop = result.spots[0];
  assert.equal(preflop.id, '81001:pre_flop:3');
  assert.equal(preflop.heroPosition, 'CO');
  assert.deepEqual(
    Object.fromEntries(preflop.players.map(({ playerId, position }) => [playerId, position])),
    { Small: 'SB', Big: 'BB', Under: 'UTG', Hijack: 'HJ', Hero: 'CO', Button: 'BTN' },
  );
  assert.equal(preflop.pot, 102);
  assert.equal(preflop.toCall, 60);
  assert.equal(preflop.potOdds, 0.37037);
  assert.equal(preflop.effectiveStack, 1000);
  assert.equal(preflop.effectiveStackBb, 50);
  assert.deepEqual(preflop.legalActions, ['fold', 'call', 'raise']);
  assert.equal(preflop.players.find(({ playerId }) => playerId === 'Hero').folded, false);
});

test('spot nie ujawnia przyszłych kart ani przyszłych akcji', () => {
  const { spots } = extractTrainingSpots(standardHand);
  const preflop = spots[0];
  const flop = spots[1];

  assert.deepEqual(preflop.board, []);
  assert.equal(preflop.priorActions.some(({ street }) => street === 'FLOP'), false);
  assert.equal(JSON.stringify(preflop).includes('Qc'), false);
  assert.deepEqual(flop.board, ['As', '7c', '2d']);
  assert.equal(flop.pot, 302);
  assert.equal(flop.toCall, 100);
  assert.equal(flop.context.opponentsInHand, 2);
  assert.equal(flop.priorActions.some(({ street }) => street === 'TURN'), false);
});

test('regresja #108986300029: na riverze Hero ma high card, cztery piki i nie ma drawa do koloru', () => {
  const raw = `CoinPoker Hand #108986300029: NLH (0.05/0.10) 2026/08/11 16:05:57 UTC
Table 'training' 6-max Seat #6 is the button
Seat 1: Small (10 in chips)
Seat 2: Big (10 in chips)
Seat 3: Raiser (10 in chips)
Seat 4: Caller (10 in chips)
Seat 5: Folded (10 in chips)
Seat 6: Hero (25 in chips)
Small: posts small blind 0.05
Big: posts big blind 0.10
*** HOLE CARDS ***
Dealt to Hero [Th As]
Raiser: raises 0.20 to 0.30
Caller: folds
Folded: folds
Hero: calls 0.30
Small: calls 0.25
Big: folds
*** FLOP *** [2s 8c 9s]
Small: checks
Raiser: checks
Hero: bets 0.33
Small: calls 0.33
Raiser: calls 0.33
*** TURN *** [2s 8c 9s] [6c]
Small: checks
Raiser: checks
Hero: checks
*** RIVER *** [2s 8c 9s 6c] [4s]
Small: checks
Raiser: bets 1.49
Hero: folds
*** SUMMARY ***
Board [ 2s 8c 9s 6c 4s ]`;
  const result = extractTrainingSpots(raw);
  assert.equal(result.status, 'accepted');
  const river = result.spots.find(({ street }) => street === 'RIVER');
  assert.deepEqual(river.decisionCardFacts, {
    madeHand: 'HIGH_CARD',
    flushStatus: 'none',
    cardsToCome: 0,
    suitCounts: {
      hero: { c: 0, d: 0, h: 1, s: 1 },
      board: { c: 2, d: 0, h: 0, s: 3 },
    },
  });
});

test('normalizuje auto-BB do pełnego BB i zachowuje poprawne kolejne kwoty call', () => {
  const raw = `CoinPoker Hand #81002: NLH (5/10/2) 2026/08/10 12:01:00 UTC
Table 'auto-bb' 3-max Seat #3 is the button
Seat 1: Small (100 in chips)
Seat 2: Big (100 in chips)
Seat 3: Hero (100 in chips)
Small: posts ante 2
Big: posts ante 2
Hero: posts ante 2
Small: posts small blind 5
Big: posts big blind 10
Hero: posts auto big blind 2
*** HOLE CARDS ***
Dealt to Hero [5c Jc]
Hero: checks
Small: raises 20 to 30
Big: calls 20
Hero: calls 20
*** FLOP *** [Qc 9d 9h]
Big: checks
Hero: checks
Small: checks
*** SUMMARY ***
Board [ Qc 9d 9h ]`;
  const result = extractTrainingSpots(raw);

  assert.equal(result.status, 'accepted');
  assert.equal(result.spots[0].pot, 31);
  assert.equal(result.spots[0].toCall, 0);
  assert.deepEqual(result.spots[0].legalActions, ['check', 'bet']);
  assert.equal(result.spots[1].pot, 76);
  assert.equal(result.spots[1].toCall, 20);
  assert.equal(result.spots[1].potOdds, 0.208333);

  const shortBigBlind = `CoinPoker Hand #81005: NLH (400/800/100) 2026/08/10 12:01:30 UTC
Table 'short-bb' 3-max Seat #3 is the button
Seat 1: Small (5,000 in chips)
Seat 2: Short (727 in chips)
Seat 3: Hero (5,000 in chips)
Small: posts ante 100
Short: posts ante 100
Hero: posts ante 100
Small: posts small blind 400
Short: posts big blind 627 ALLIN
*** HOLE CARDS ***
Dealt to Hero [Ks 2s]
Hero: calls 800
Small: folds
Hero: RETURN 173
*** SUMMARY ***
Board [  ]`;
  const shortResult = extractTrainingSpots(shortBigBlind);
  assert.equal(shortResult.status, 'accepted');
  assert.equal(shortResult.spots[0].pot, 1327);
  assert.equal(shortResult.spots[0].toCall, 800);
});

test('obsługuje straddle, multiway i stabilny identyfikator decyzji', () => {
  const raw = `CoinPoker Hand #81003: NLH (0.50/1) 2026/08/10 12:02:00 UTC
Table 'straddle' 4-max Seat #4 is the button
Seat 1: Small (100 in chips)
Seat 2: Big (100 in chips)
Seat 3: Straddler (60 in chips)
Seat 4: Hero (80 in chips)
Small: posts small blind 0.50
Big: posts big blind 1
Straddler: posts straddle 2
*** HOLE CARDS ***
Dealt to Hero [Qs Js]
Hero: calls 2
Small: folds
Big: calls 1
Straddler: checks
*** FLOP *** [Ts 8d 2c]
Big: checks
Straddler: checks
Hero: checks
*** SUMMARY ***
Board [ Ts 8d 2c ]`;
  const first = extractTrainingSpots(raw);
  const second = extractTrainingSpots(`${raw}\nSeat 4: Hero folded after River`);

  assert.equal(first.status, 'accepted');
  assert.equal(first.spots[0].pot, 3.5);
  assert.equal(first.spots[0].toCall, 2);
  assert.equal(first.spots[0].context.opponentsInHand, 3);
  assert.deepEqual(first.spots.map(({ id }) => id), second.spots.map(({ id }) => id));
});

test('rozpoznaje reshove i przyjmuje poprawny zwrot niewyrównanego zakładu', () => {
  const raw = `CoinPoker Hand #81004: NLH (0.50/1) 2026/08/10 12:03:00 UTC
Table 'reshove' 3-max Seat #1 is the button
Seat 1: Hero (20 in chips)
Seat 2: Short (3 in chips)
Seat 3: Big (20 in chips)
Short: posts small blind 0.50
Big: posts big blind 1
*** HOLE CARDS ***
Dealt to Hero [Td Ts]
Hero: raises 3 to 4
Short: ALLIN 2.50
Big: folds
Hero: RETURN 1
*** SUMMARY ***
Board [  ]`;
  const result = extractTrainingSpots(raw);

  assert.equal(result.status, 'accepted');
  assert.equal(result.spots.length, 1);
  assert.equal(result.spots[0].historicalAction.type, 'raise');

  const reshove = raw
    .replace('Short: ALLIN 2.50\nBig: folds\nHero: RETURN 1', 'Short: folds\nBig: ALLIN 19\nHero: folds');
  const reshoveResult = extractTrainingSpots(reshove);
  assert.equal(reshoveResult.status, 'accepted');
  assert.equal(reshoveResult.spots[1].context.isFacingReraise, true);
  assert.equal(reshoveResult.spots[1].context.isFacingReshove, true);
  assert.equal(reshoveResult.spots[1].toCall, 16);
});

test('odrzuca warianty, rebuy oraz niepełne i niespójne dane z diagnostyką', () => {
  const plo = extractTrainingSpots(standardHand.replace(': NLH ', ': PLO 4 '));
  const bomb = extractTrainingSpots(standardHand.replace(': NLH ', ': NLH BombPot '));
  const spacedBomb = extractTrainingSpots(standardHand.replace(': NLH ', ': NLH Bomb Pot '));
  const rebuy = extractTrainingSpots({ rawText: standardHand, isRebuy: true });
  const badCall = extractTrainingSpots(standardHand.replace('Hero: calls 60', 'Hero: calls 40'));
  const badPosition = extractTrainingSpots(standardHand.replace('Big: posts big blind 20', 'Under: posts big blind 20'));

  assert.equal(plo.rejection.code, TRAINING_SPOT_REJECTIONS.UNSUPPORTED_VARIANT);
  assert.equal(bomb.rejection.code, TRAINING_SPOT_REJECTIONS.UNSUPPORTED_VARIANT);
  assert.equal(spacedBomb.rejection.code, TRAINING_SPOT_REJECTIONS.UNSUPPORTED_VARIANT);
  assert.equal(rebuy.rejection.code, TRAINING_SPOT_REJECTIONS.REBUY);
  assert.equal(badCall.rejection.code, TRAINING_SPOT_REJECTIONS.INCONSISTENT_ACTION);
  assert.equal(badPosition.rejection.code, TRAINING_SPOT_REJECTIONS.INVALID_POSITIONS);

  const batch = extractTrainingSpotsBatch([standardHand, { rawText: standardHand, isRebuy: true }]);
  assert.equal(batch.spots.length, 4);
  assert.deepEqual(batch.rejected.map(({ code }) => code), [TRAINING_SPOT_REJECTIONS.REBUY]);
});
