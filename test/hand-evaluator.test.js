import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareHoldemHands,
  compareHoldemHandsDetailed,
  detectGameVariant,
  evaluateHoldemHandRank,
  evaluateVisibleHand,
  parseRawHandHistory,
} from '../src/parser/pokerParser.js';

const makeHand = ({
  id = '70001',
  variant = 'NLH',
  heroCards = ['Ah', 'Kd'],
  flop = ['2c', '7s', '9h'],
  summary = `Seat 1: Hero showed [${heroCards.join(' ')}] and won ($1.00)`,
  boardSummary = flop,
}) => `CoinPoker Hand #${id}: ${variant} ($0.50/$1) 2026/08/04 12:00:00 UTC
Table 'evaluator-test' 2-max Seat #1 is the button
Seat 1: Hero ($100 in chips)
Seat 2: Villain ($100 in chips)
*** HOLE CARDS ***
Dealt to Hero [${heroCards.join(' ')}]
*** FLOP *** [${flop.join(' ')}]
*** SUMMARY ***
Board [ ${boardSummary.join(' ')} ]
${summary}`;

test('ewaluator rozpoznaje pocket pair i high card preflop', () => {
  assert.equal(evaluateVisibleHand(['Qh', 'Qd'], []), 'PAIR');
  assert.equal(evaluateVisibleHand(['Qh', 'Jd'], []), 'HIGH_CARD');
});

test('ewaluator rozpoznaje wszystkie kategorie NLH z widocznych kart', () => {
  const cases = [
    ['PAIR', ['Ah', 'Ad'], ['2c', '7d', '9s']],
    ['TWO_PAIR', ['Ah', 'Ad'], ['2c', '2d', '9s']],
    ['THREE_OF_A_KIND', ['Ah', 'Ad'], ['As', '7d', '9c']],
    ['STRAIGHT', ['Ah', '5d'], ['2c', '3s', '4h']],
    ['FLUSH', ['Ah', 'Kh'], ['2h', '7h', '9h']],
    ['FULL_HOUSE', ['Ah', 'Ad'], ['2c', '2d', '2s']],
    ['FOUR_OF_A_KIND', ['Ah', 'Ad'], ['Ac', 'As', '2h']],
    ['STRAIGHT_FLUSH', ['Ah', 'Kh'], ['Qh', 'Jh', 'Th']],
  ];

  cases.forEach(([expected, heroCards, boardCards]) => {
    assert.equal(evaluateVisibleHand(heroCards, boardCards), expected, expected);
  });
});

test('ewaluator wybiera najlepszy układ z 5–7 kart i nie przewiduje drawów', () => {
  assert.equal(
    evaluateVisibleHand(['6h', '7d'], ['2c', '3s', '4h', '5d', 'Kc']),
    'STRAIGHT',
  );
  assert.equal(evaluateVisibleHand(['Ah', 'Kh'], ['2c', '7d', '9s']), 'HIGH_CARD');
});

test('porownuje pelne uklady z uwzglednieniem kickerow', () => {
  const result = compareHoldemHands(
    ['Ah', 'Kd'],
    ['Ac', 'Qs'],
    ['2c', '2d', '9h', '3s', '4c'],
  );

  assert.equal(result, 1);
  assert.deepEqual(
    evaluateHoldemHandRank(['Ah', 'Kd'], ['2c', '2d', '9h', '3s', '4c']),
    { category: 'PAIR', vector: [1, 2, 14, 13, 9] },
  );
});

test('rozpoznaje remis, gdy najlepsze uklady maja identyczna sile', () => {
  const details = compareHoldemHandsDetailed({
    heroCards: ['Ah', 'Kd'],
    villainCards: ['As', 'Kc'],
    boardCards: ['Qh', 'Jd', 'Tc', '2s', '3h'],
  });

  assert.equal(details.comparison, 0);
  assert.equal(details.result, 'tie');
  assert.deepEqual(details.hero.vector, [4, 14]);
  assert.deepEqual(details.villain.vector, [4, 14]);
});

test('porownanie odrzuca niekompletny board, duplikaty i nieobslugiwany wariant', () => {
  assert.throws(
    () => compareHoldemHands(['Ah', 'Kd'], ['Ac', 'Qs'], ['2c', '2d', '9h']),
    /boardCards must contain 5 cards/,
  );
  assert.throws(
    () => compareHoldemHands(['Ah', 'Kd'], ['Ah', 'Qs'], ['2c', '2d', '9h', '3s', '4c']),
    /duplicate cards/,
  );
  assert.throws(
    () => compareHoldemHands({
      heroCards: ['Ah', 'Kd'],
      villainCards: ['Ac', 'Qs'],
      boardCards: ['2c', '2d', '9h', '3s', '4c'],
      gameVariant: 'PLO 4',
    }),
    /Unsupported game variant/,
  );
});

test('PLO 4 nie przechodzi przez ewaluator holdemowy', () => {
  assert.equal(evaluateVisibleHand(['Ah', 'Kh'], ['Qh', 'Jh', 'Th'], 'PLO 4'), 'NO_HAND');
});

test('rozpoznaje warianty nagłówka rozdania', () => {
  assert.equal(detectGameVariant('CoinPoker Hand #1: NLH ($1/$2)'), 'NLH');
  assert.equal(detectGameVariant('CoinPoker Hand #2: NLH BombPot ($1/$2/$2)'), 'NLH BombPot');
  assert.equal(detectGameVariant('CoinPoker Hand #3: PLO 4 ($1/$2)'), 'PLO 4');
});

test('parser stosuje kolejność SUMMARY, potem widoczne karty, a PLO oznacza jako nieobsługiwane', () => {
  const [summaryFirst] = parseRawHandHistory(makeHand({
    id: '70002',
    heroCards: ['Ah', 'Kh'],
    flop: ['Qh', 'Jh', 'Th'],
    summary: 'Seat 1: Hero showed [Ah Kh] and won ($1.00) with Pair',
  }));
  assert.equal(summaryFirst.handRanking, 'PAIR');
  assert.equal(summaryFirst.handRankingSource, 'SUMMARY');

  const [visibleCards] = parseRawHandHistory(makeHand({
    id: '70003',
    heroCards: ['Ah', 'Kh'],
    flop: ['Qh', 'Jh', 'Th'],
  }));
  assert.equal(visibleCards.handRanking, 'STRAIGHT_FLUSH');
  assert.equal(visibleCards.handRankingSource, 'VISIBLE_CARDS');

  const [unsupported] = parseRawHandHistory(makeHand({
    id: '70004',
    variant: 'PLO 4',
    heroCards: ['Ah', 'Kh', 'Qd', 'Jd'],
    summary: 'Seat 1: Hero showed [Ah Kh Qd Jd] and won ($1.00)',
  }));
  assert.equal(unsupported.handRanking, 'NO_HAND');
  assert.equal(unsupported.handRankingSource, 'UNSUPPORTED_VARIANT');
});

test('parser używa jawnie pokazanych kart Hero, gdy brakuje linii Dealt to Hero', () => {
  const raw = makeHand({
    id: '70006',
    heroCards: ['Ah', 'Kh'],
    flop: ['Qh', 'Jh', 'Th'],
  }).replace('Dealt to Hero [Ah Kh]\n', '');
  const [parsed] = parseRawHandHistory(raw);

  assert.deepEqual(parsed.heroCards, ['Ah', 'Kh']);
  assert.equal(parsed.handRanking, 'STRAIGHT_FLUSH');
  assert.equal(parsed.handRankingSource, 'VISIBLE_CARDS');
});

test('BombPot ocenia osobne boardy regułami NLH', () => {
  const raw = makeHand({
    id: '70005',
    variant: 'NLH BombPot',
    heroCards: ['Ah', 'Kh'],
    flop: ['2c', '7s', '9h'],
    boardSummary: ['2c', '7s', '9h'],
  }).replace(
    'Board [ 2c 7s 9h ]',
    'FIRST Board [ 2c 7s 9h ]\nSECOND Board [ Qh Jh Th ]',
  );
  const [parsed] = parseRawHandHistory(raw);

  assert.deepEqual(parsed.boardCardsByBoard, [['2c', '7s', '9h'], ['Qh', 'Jh', 'Th']]);
  assert.equal(parsed.handRanking, 'STRAIGHT_FLUSH');
  assert.equal(parsed.handRankingSource, 'VISIBLE_CARDS');
});
