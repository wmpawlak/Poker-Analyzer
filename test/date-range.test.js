import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dateStringToLocalDate,
  getLocalDateRange,
  localDateToDateString,
} from '../src/utils/dateRange.js';

test('konwersje YYYY-MM-DD używają lokalnej strefy czasowej bez przesunięcia UTC', () => {
  const date = dateStringToLocalDate('2026-08-11');
  assert.ok(date instanceof Date);
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 7);
  assert.equal(date.getDate(), 11);
  assert.equal(date.getHours(), 0);
  assert.equal(localDateToDateString(date), '2026-08-11');
});

test('lokalny zakres zachowuje włączną końcową granicę dnia i odrzuca błędne daty', () => {
  const range = getLocalDateRange('2026-08-11', '2026-08-11');
  assert.equal(range.valid, true);
  assert.equal(range.fromDate.getHours(), 0);
  assert.equal(range.toDate.getHours(), 23);
  assert.equal(range.toDate.getMinutes(), 59);
  assert.equal(range.toDate.getMilliseconds(), 999);
  assert.equal(getLocalDateRange('2026-02-30', '').valid, false);
});
