import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAnalyzedHands,
  getAnalysisHistory,
  getSavedHands,
  sortHands,
} from '../src/utils/handCollections.js';

const hands = [
  { id: 'cash-1', timestamp: 10, netProfit: -2 },
  { id: 'cash-2', timestamp: 30, netProfit: 5 },
  { id: 'cash-3', timestamp: 20, netProfit: 1 },
];

test('kolekcja analiz obejmuje ręce posiadające co najmniej jeden raport', () => {
  const analyses = {
    'cash-1': [],
    'cash-2': [{
      reportId: 'report-1',
      model: { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
      analysis: { summary: 'Raport' },
    }],
  };

  assert.deepEqual(getAnalyzedHands(hands, analyses).map(({ id }) => id), ['cash-2']);
  assert.equal(getAnalysisHistory(analyses['cash-2']).length, 1);
});

test('kolekcja zapisanych rąk filtruje po ID i usuwa duplikaty wejściowe', () => {
  assert.deepEqual(
    getSavedHands(hands, ['cash-3', 'cash-1', 'cash-3']).map(({ id }) => id),
    ['cash-1', 'cash-3'],
  );
});

test('kolekcje można sortować po dacie i wyniku bez mutowania źródła', () => {
  assert.deepEqual(sortHands(hands, 'date', 'desc').map(({ id }) => id), [
    'cash-2',
    'cash-3',
    'cash-1',
  ]);
  assert.deepEqual(sortHands(hands, 'profit', 'asc').map(({ id }) => id), [
    'cash-1',
    'cash-3',
    'cash-2',
  ]);
  assert.deepEqual(hands.map(({ id }) => id), ['cash-1', 'cash-2', 'cash-3']);
});
