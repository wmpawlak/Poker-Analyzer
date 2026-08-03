import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPlayerStyle } from '../src/utils/playerStyleClassifier.js';

const percentageMetric = (value, opportunities = 100) => ({
  value,
  opportunities,
  executions: (value / 100) * opportunities,
});

const makeMetrics = ({
  hands = 100,
  vpip = 22,
  pfr = 19,
  threeBet = 7,
  afq = 55,
  foldToCBet = 48,
} = {}) => ({
  hands,
  preflop: {
    vpip: percentageMetric(vpip, hands),
    pfr: percentageMetric(pfr, hands),
    threeBet: percentageMetric(threeBet, 30),
  },
  postflop: {
    afq: {
      total: {
        value: afq,
        betsRaises: afq,
        calls: 100 - afq,
      },
    },
    foldToCBet: percentageMetric(foldToCBet, 20),
  },
});

const makeContextHand = ({ stackBb = 15, allIn = false, calls = 0 } = {}) => ({
  bigBlind: 2,
  heroStartingStack: stackBb * 2,
  heroStats: {
    preflop: {
      heroHadDecision: true,
      heroWentAllIn: allIn,
      heroCallCount: calls,
    },
  },
});

test('nie klasyfikuje stylu poniżej 30 rąk', () => {
  const result = classifyPlayerStyle(makeMetrics({ hands: 29 }));

  assert.equal(result.style, null);
  assert.equal(result.reliability.id, 'INSUFFICIENT');
  assert.equal(result.reliability.label, 'Za mała próba');
});

test('dla 30–99 rąk zwraca wstępny najbliższy profil', () => {
  const result = classifyPlayerStyle(makeMetrics({ hands: 50 }));

  assert.equal(result.style.id, 'TAG');
  assert.equal(result.reliability.id, 'PRELIMINARY');
  assert.equal(result.reliability.label, 'Wstępny profil');
  assert.equal(result.comparedFeatures, 6);
});

test('od 100 rąk oznacza profil jako statystyczny', () => {
  const result = classifyPlayerStyle(makeMetrics({
    hands: 100,
    vpip: 55,
    pfr: 45,
    threeBet: 20,
    afq: 76,
    foldToCBet: 25,
  }));

  assert.equal(result.style.id, 'MANIAC');
  assert.equal(result.reliability.id, 'STATISTICAL');
  assert.equal(result.reliability.label, 'Profil statystyczny');
});

test('rozpoznaje profil pasywny na podstawie luki VPIP–PFR i agresji', () => {
  const result = classifyPlayerStyle(makeMetrics({
    vpip: 40,
    pfr: 14,
    threeBet: 3,
    afq: 30,
    foldToCBet: 38,
  }));

  assert.equal(result.style.id, 'LOOSE_PASSIVE');
});

test('zwraca profil mieszany, gdy brakuje danych do porównania', () => {
  const result = classifyPlayerStyle({
    hands: 100,
    preflop: {
      vpip: percentageMetric(25),
      pfr: { value: '—', opportunities: 0, executions: 0 },
    },
    postflop: {},
  });

  assert.equal(result.style.id, 'MIXED');
  assert.equal(result.comparedFeatures, 1);
});

test('zwraca profil mieszany także dla wzorca odległego od wszystkich profili', () => {
  const result = classifyPlayerStyle(makeMetrics({
    vpip: 5,
    pfr: 5,
    threeBet: 40,
    afq: 95,
    foldToCBet: 5,
  }));

  assert.equal(result.style.id, 'MIXED');
});

test('short-stack i push-fold są niezależnymi badge’ami kontekstowymi', () => {
  const hands = [
    ...Array.from({ length: 8 }, () => makeContextHand({ allIn: true })),
    ...Array.from({ length: 2 }, () => makeContextHand()),
    ...Array.from({ length: 2 }, () => makeContextHand({ stackBb: 50 })),
  ];
  const result = classifyPlayerStyle(makeMetrics({ hands: hands.length }), hands);

  assert.equal(result.style, null);
  assert.equal(result.context.shortStack.active, true);
  assert.equal(result.context.shortStack.share, 83.3);
  assert.equal(result.context.pushFold.active, true);
  assert.deepEqual(result.badges.map((badge) => badge.id), ['SHORT_STACK', 'PUSH_FOLD']);
});

test('nie nadaje badge’a push-fold grze z częstymi zwykłymi callami', () => {
  const hands = Array.from({ length: 10 }, (_, index) => makeContextHand({
    allIn: index < 3,
    calls: index < 4 ? 1 : 0,
  }));
  const result = classifyPlayerStyle(makeMetrics({ hands: hands.length }), hands);

  assert.equal(result.context.shortStack.active, true);
  assert.equal(result.context.pushFold.active, false);
  assert.deepEqual(result.badges.map((badge) => badge.id), ['SHORT_STACK']);
});

test('brak stacka lub BB nie tworzy fałszywego badge’a short-stack', () => {
  const hands = Array.from({ length: 20 }, () => ({
    bigBlind: 0,
    heroStartingStack: 0,
    heroStats: { preflop: { heroWentAllIn: true, heroCallCount: 0 } },
  }));
  const result = classifyPlayerStyle(makeMetrics({ hands: hands.length }), hands);

  assert.equal(result.context.shortStack.measurableHands, 0);
  assert.equal(result.context.shortStack.active, false);
  assert.deepEqual(result.badges, []);
});

test('incydentalne płytkie stacki nie oznaczają całej sesji jako push-fold', () => {
  const hands = [
    ...Array.from({ length: 10 }, () => makeContextHand({ allIn: true })),
    ...Array.from({ length: 90 }, () => makeContextHand({ stackBb: 50 })),
  ];
  const result = classifyPlayerStyle(makeMetrics({ hands: hands.length }), hands);

  assert.equal(result.context.shortStack.share, 10);
  assert.equal(result.context.pushFold.active, false);
  assert.deepEqual(result.badges, []);
});
