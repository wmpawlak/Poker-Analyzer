import test from 'node:test';
import assert from 'node:assert/strict';
import { selectDiverseRecentSpots } from '../server/training/spotSelection.js';

const makeSpot = (index, overrides = {}) => ({
  versionId: `spot-${index}`,
  handId: `hand-${index}`,
  sourceStatus: 'current',
  exerciseType: 'preflop_selection',
  gameType: 'cash',
  street: 'PRE_FLOP',
  playedAt: new Date(Date.UTC(2026, 7, 1, 0, index)).toISOString(),
  answerOptions: [
    { id: 'fold', action: 'fold' },
    { id: 'raise', action: 'raise' },
  ],
  question: {
    street: 'PRE_FLOP', heroCards: ['Ah', 'Kd'], board: [], heroPosition: 'BTN',
    blinds: { smallBlind: 0.5, bigBlind: 1, ante: 0 }, pot: 1.5, toCall: 0,
    potOdds: 0, effectiveStack: 100, effectiveStackBb: 100,
    effectiveStackBehind: 99, effectiveStackBehindBb: 99,
    effectiveStackByOpponent: [], players: [], priorActions: [], legalActions: ['fold', 'raise'],
    context: { opponentsInHand: 1, preflopRaiseCount: 0, facingRaiseLevel: 0, isFacingReraise: false, isFacingReshove: false },
  },
  ...overrides,
});

test('diverse_recent_v1 jest deterministyczny, ograniczony i wybiera najnowszy spot w kontekście', () => {
  const spots = [
    makeSpot(1, { handId: 'same-hand' }),
    makeSpot(2, { handId: 'same-hand' }),
    makeSpot(3, { question: { ...makeSpot(3).question, heroPosition: 'CO' } }),
    makeSpot(4, { question: { ...makeSpot(4).question, effectiveStackBb: 25 } }),
    makeSpot(5, { answerOptions: [{ id: 'fold', action: 'fold' }] }),
    makeSpot(6, { question: { ...makeSpot(6).question, board: ['As'] } }),
  ];
  const first = selectDiverseRecentSpots(spots, { limit: 3 });
  const second = selectDiverseRecentSpots([...spots].reverse(), { limit: 3 });

  assert.deepEqual(first.map(({ versionId }) => versionId), second.map(({ versionId }) => versionId));
  assert.equal(first.length, 3);
  assert.equal(first.some(({ versionId }) => versionId === 'spot-2'), true);
  assert.equal(first.some(({ versionId }) => versionId === 'spot-1'), false);
  assert.equal(first.some(({ versionId }) => ['spot-5', 'spot-6'].includes(versionId)), false);
  assert.equal(new Set(first.map(({ handId }) => handId)).size, first.length);
});

test('nie rozdziela dwuetapowego epizodu c-bet nawet gdy pozostaje tylko jedno miejsce', () => {
  const episode = (index, episodeId, stage) => makeSpot(index, {
    handId: `hand-${episodeId}`,
    exerciseType: 'cbet_barrels',
    street: stage === 'flop' ? 'FLOP' : 'TURN',
    stage,
    episodeId,
    sequenceLength: 2,
    question: {
      ...makeSpot(index).question,
      street: stage === 'flop' ? 'FLOP' : 'TURN',
      board: stage === 'flop' ? ['2c', '7d', 'Ts'] : ['2c', '7d', 'Ts', 'Jh'],
      legalActions: ['check', 'bet'],
    },
    answerOptions: [{ id: 'check', action: 'check' }, { id: 'bet', action: 'bet' }],
  });
  const selected = selectDiverseRecentSpots([
    episode(1, 'old', 'flop'), episode(2, 'old', 'turn'),
    episode(3, 'new', 'flop'), episode(4, 'new', 'turn'),
  ], { limit: 3 });

  assert.equal(selected.length, 2);
  assert.deepEqual(selected.map(({ episodeId }) => episodeId), ['new', 'new']);
});

test('round-robin balances exercise types and game formats before taking older spots', () => {
  const categories = [
    ['preflop_selection', 'cash'],
    ['preflop_selection', 'tournament'],
    ['turn_river', 'cash'],
    ['turn_river', 'tournament'],
  ];
  const spots = categories.flatMap(([exerciseType, gameType], categoryIndex) => (
    Array.from({ length: 3 }, (_, index) => makeSpot(categoryIndex * 3 + index + 1, {
      exerciseType,
      gameType,
      playedAt: new Date(Date.UTC(2026, 7, categoryIndex, 3 - index)).toISOString(),
    }))
  ));
  const selected = selectDiverseRecentSpots(spots, { limit: 8 });
  assert.equal(selected.length, 8);
  assert.deepEqual([...new Set(selected.map(({ exerciseType, gameType }) => `${exerciseType}:${gameType}`))].sort(), [
    'preflop_selection:cash',
    'preflop_selection:tournament',
    'turn_river:cash',
    'turn_river:tournament',
  ]);
  assert.equal(selected.filter(({ exerciseType, gameType }) => exerciseType === 'preflop_selection' && gameType === 'cash').length, 2);
  assert.equal(selected.filter(({ exerciseType, gameType }) => exerciseType === 'preflop_selection' && gameType === 'tournament').length, 2);
  assert.equal(selected.filter(({ exerciseType, gameType }) => exerciseType === 'turn_river' && gameType === 'cash').length, 2);
  assert.equal(selected.filter(({ exerciseType, gameType }) => exerciseType === 'turn_river' && gameType === 'tournament').length, 2);
});
