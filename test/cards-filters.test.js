import test from 'node:test';
import assert from 'node:assert/strict';
import pokerReducer, { setCardsDateRange, setDataFilters } from '../src/store/pokerSlice.js';

test('zakres kart jest niezależny od zakresu profilu i można go wyczyścić', () => {
  let state = pokerReducer(undefined, { type: '@@init' });
  state = pokerReducer(state, setDataFilters({ dateFrom: '2026-01-01', dateTo: '2026-01-31' }));
  state = pokerReducer(state, setCardsDateRange({ dateFrom: '2026-08-01', dateTo: '2026-08-31' }));

  assert.deepEqual(
    { dateFrom: state.filters.dateFrom, dateTo: state.filters.dateTo },
    { dateFrom: '2026-01-01', dateTo: '2026-01-31' },
  );
  assert.deepEqual(
    { dateFrom: state.filters.cardsDateFrom, dateTo: state.filters.cardsDateTo },
    { dateFrom: '2026-08-01', dateTo: '2026-08-31' },
  );

  state = pokerReducer(state, setCardsDateRange({}));
  assert.equal(state.filters.cardsDateFrom, '');
  assert.equal(state.filters.cardsDateTo, '');
});
