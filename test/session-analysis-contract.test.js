import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_ANALYSIS_MAX_BYTES,
  buildSessionAnalysisInput,
  validateSessionAnalysis,
  validateSessionAnalysisInput,
} from '../src/ai/sessionAnalysisContract.js';

const makeHand = (id, netProfit, extra = {}) => ({
  id,
  timestamp: Number(id),
  position: 'BTN',
  blinds: '€0.05/€0.10',
  smallBlind: 0.05,
  bigBlind: 0.1,
  heroStartingStack: 10,
  heroCards: ['As', 'Kd'],
  boardCards: ['Ah', '7c', '2d'],
  outcome: netProfit >= 0 ? 'WON' : 'LOST',
  heroInvestment: 1,
  heroWinnings: Math.max(0, netProfit + 1),
  netProfit,
  handRanking: 'PAIR',
  streets: [{ name: 'PRE-FLOP', cards: [], lines: ['Hero: raises €0.20 to €0.30'] }, { name: 'SUMMARY', lines: ['Hero collected €2'] }],
  ...extra,
});

test('kontrakt sesji obejmuje wszystkie ręce bez rebuy, rawText i SUMMARY oraz ma stabilny odcisk', () => {
  const hands = [
    makeHand('2', -3),
    makeHand('1', 1),
    makeHand('rebuy', 1000, { isRebuy: true, rawText: 'nie może trafić do wejścia' }),
  ];
  const first = buildSessionAnalysisInput({ sessionId: 'cash:table', hands, gameType: 'cash' });
  const second = buildSessionAnalysisInput({ sessionId: 'cash:table', hands: [...hands].reverse(), gameType: 'cash' });

  assert.deepEqual(first.hands.map((hand) => hand.id), ['1', '2']);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.largestSwingHandId, '2');
  assert.equal(Object.hasOwn(first.hands[0], 'rawText'), false);
  assert.deepEqual(first.hands[0].streets.map((street) => street.name), ['PRE-FLOP']);
  assert.equal(validateSessionAnalysisInput(first).fingerprint, first.fingerprint);
});

test('kontrakt sesji odrzuca przekroczony limit zamiast skracania danych', () => {
  const input = buildSessionAnalysisInput({
    sessionId: 'large',
    gameType: 'cash',
    hands: [makeHand('1', 1, { streets: [{ name: 'FLOP', lines: ['x'.repeat(SESSION_ANALYSIS_MAX_BYTES)] }] })],
  });
  assert.throws(() => validateSessionAnalysisInput(input), /przekracza limit/);
});

test('walidacja raportu wymaga lokalnego stylu, powtarzalnych poprawnych ID i największego swingu', () => {
  const session = buildSessionAnalysisInput({
    sessionId: 'cash:table',
    hands: [makeHand('1', 1), makeHand('2', -4), makeHand('3', -1)],
    gameType: 'cash',
  });
  const report = {
    profileStyleId: 'INSUFFICIENT',
    sessionSummary: 'Próba jest krótka. Wnioski wymagają ostrożności.',
    keyMistakes: [{ title: 'Za szerokie calle', description: 'Za dużo calli.', correction: 'Częściej folduj.', handIds: ['1', '3'] }],
    notableHands: [{ handId: '2', reason: 'Największy swing.' }],
  };
  assert.deepEqual(validateSessionAnalysis(report, session), report);
  assert.throws(() => validateSessionAnalysis({ ...report, notableHands: [{ handId: '1', reason: 'Nie swing.' }] }, session), /największego swingu/);
  assert.throws(() => validateSessionAnalysis({ ...report, keyMistakes: [{ ...report.keyMistakes[0], handIds: ['1', '1'] }] }, session), /nieprawidłowy albo niepowtarzalny/);
});
