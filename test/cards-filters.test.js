import test from 'node:test';
import assert from 'node:assert/strict';
import pokerReducer, { setDateRange } from '../src/store/pokerSlice.js';

test('zakres kart jest niezależny od zakresu profilu i można go wyczyścić', () => {
  let state = pokerReducer(undefined, { type: '@@init' });
  state = pokerReducer(state, setDateRange({ view: 'profile', from: '2026-01-01', to: '2026-01-31' }));
  state = pokerReducer(state, setDateRange({ view: 'cards', from: '2026-08-01', to: '2026-08-31' }));

  assert.deepEqual(
    state.filters.dateRanges.profile,
    { from: '2026-01-01', to: '2026-01-31' },
  );
  assert.deepEqual(
    state.filters.dateRanges.cards,
    { from: '2026-08-01', to: '2026-08-31' },
  );

  state = pokerReducer(state, setDateRange({ view: 'cards', from: '', to: '' }));
  assert.equal(state.filters.dateRanges.cards.from, '');
  assert.equal(state.filters.dateRanges.cards.to, '');
});

test('każdy widok ma własny zakres dat, a częściowa zmiana zachowuje drugą granicę', () => {
  let state = pokerReducer(undefined, { type: '@@init' });
  const ranges = {
    profile: ['2026-01-01', '2026-01-31'],
    opponents: ['2026-02-01', '2026-02-28'],
    wallet: ['2026-03-01', '2026-03-31'],
    cards: ['2026-04-01', '2026-04-30'],
    sessionGroup: ['2026-05-01', '2026-05-31'],
  };

  Object.entries(ranges).forEach(([view, [from, to]]) => {
    state = pokerReducer(state, setDateRange({ view, from, to }));
  });
  state = pokerReducer(state, setDateRange({ view: 'wallet', from: '2026-03-05' }));

  assert.deepEqual(state.filters.dateRanges, {
    profile: { from: '2026-01-01', to: '2026-01-31' },
    opponents: { from: '2026-02-01', to: '2026-02-28' },
    wallet: { from: '2026-03-05', to: '2026-03-31' },
    cards: { from: '2026-04-01', to: '2026-04-30' },
    sessionGroup: { from: '2026-05-01', to: '2026-05-31' },
  });
});
