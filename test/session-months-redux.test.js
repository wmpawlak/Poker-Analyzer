import test from 'node:test';
import assert from 'node:assert/strict';
import { configureStore } from '@reduxjs/toolkit';
import pokerReducer, {
  createSessionMonthsQueryKey,
  fetchAllSessionsForQuery,
  fetchSessionMonth,
  fetchSessionMonths,
  fetchSessionSummariesByIds,
  refreshDataset,
} from '../src/store/pokerSlice.js';

class MemoryStorage {
  getItem() { return null; }
  setItem() {}
  removeItem() {}
}
globalThis.localStorage = new MemoryStorage();

const query = {
  gameType: 'cash',
  handRanking: '',
  dateFrom: '2026-01-01',
  dateTo: '2026-12-31',
};
const queryKey = createSessionMonthsQueryKey(query);

const makeStore = (revision = 'revision-1') => {
  const base = pokerReducer(undefined, { type: '@@init' });
  return configureStore({
    reducer: { poker: pokerReducer },
    preloadedState: {
      poker: {
        ...base,
        dataset: { ...base.dataset, datasetRevision: revision },
      },
    },
  });
};

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const monthIndex = (months = [{ key: '2026-08', year: 2026, month: 8, sessionCount: 1 }]) => ({
  datasetRevision: 'revision-1',
  gameType: 'cash',
  handRanking: '',
  dateFrom: query.dateFrom,
  dateTo: query.dateTo,
  availableRanks: [],
  months,
});

const session = (id, dateStr, type = 'Cash') => ({
  id,
  type,
  dateStr,
  startTime: Date.parse(dateStr.replaceAll('/', '-') + 'T12:00:00Z'),
  handCount: 2,
  matchingHandCount: 2,
  fingerprint: `fingerprint-${id}`,
});

test('indeks i najnowszy miesiąc są niezależnymi żądaniami', async () => {
  const store = makeStore();
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return String(url).startsWith('/api/session-months')
      ? jsonResponse(monthIndex())
      : jsonResponse({ ...monthIndex(), sessions: [session('august', '2026/08/01')] });
  };
  try {
    await store.dispatch(fetchSessionMonths(query));
    assert.equal(store.getState().poker.sessionMonthPages[queryKey], undefined);
    await store.dispatch(fetchSessionMonth({ ...query, month: '2026-08' }));
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(urls.length, 2);
  assert.match(urls[0], /^\/api\/session-months\?/);
  assert.match(urls[1], /^\/api\/sessions\?/);
  assert.match(urls[1], /month=2026-08/);
  assert.equal(store.getState().poker.sessionMonthPages[queryKey]['2026-08'].items[0].id, 'august');
});

test('równoległe miesiące nie nadpisują się, a ponowne otwarcie korzysta z cache', async () => {
  const store = makeStore();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const pending = new Map();
  globalThis.fetch = (url) => {
    calls += 1;
    const month = new URL(`http://local${url}`).searchParams.get('month');
    return new Promise((resolve) => pending.set(month, resolve));
  };
  try {
    const julyRequest = store.dispatch(fetchSessionMonth({ ...query, month: '2026-07' }));
    const augustRequest = store.dispatch(fetchSessionMonth({ ...query, month: '2026-08' }));
    pending.get('2026-08')(jsonResponse({ ...monthIndex(), sessions: [session('august', '2026/08/01')] }));
    pending.get('2026-07')(jsonResponse({ ...monthIndex(), sessions: [session('july', '2026/07/01')] }));
    await Promise.all([julyRequest, augustRequest]);
    await store.dispatch(fetchSessionMonth({ ...query, month: '2026-07' }));
  } finally {
    globalThis.fetch = originalFetch;
  }
  const pages = store.getState().poker.sessionMonthPages[queryKey];
  assert.equal(pages['2026-07'].items[0].id, 'july');
  assert.equal(pages['2026-08'].items[0].id, 'august');
  assert.equal(calls, 2);
});

test('pełne pobranie bez month nawadnia wszystkie strony miesięczne', async () => {
  const store = makeStore();
  const originalFetch = globalThis.fetch;
  let requestedUrl;
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return jsonResponse({
      datasetRevision: 'revision-1',
      gameType: 'cash',
      handRanking: '',
      availableRanks: [{ id: 'PAIR', count: 4 }],
      sessions: [session('august', '2026/08/01'), session('july', '2026/07/01')],
    });
  };
  try {
    await store.dispatch(fetchAllSessionsForQuery(query));
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(new URL(`http://local${requestedUrl}`).searchParams.has('month'), false);
  const state = store.getState().poker;
  assert.deepEqual(state.sessionMonthIndexes[queryKey].months.map(({ key }) => key), ['2026-08', '2026-07']);
  assert.equal(state.sessionMonthIndexes[queryKey].allStatus, 'succeeded');
  assert.equal(state.sessionMonthPages[queryKey]['2026-08'].items[0].id, 'august');
  assert.equal(state.sessionMonthPages[queryKey]['2026-07'].items[0].id, 'july');
  assert.equal(state.sessionSummariesById.august.id, 'august');
});

test('zmiana rewizji unieważnia miesięczny cache i podsumowania', async () => {
  const store = makeStore();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({
    ...monthIndex(),
    sessions: [session('august', '2026/08/01')],
  });
  try {
    await store.dispatch(fetchSessionMonth({ ...query, month: '2026-08' }));
  } finally {
    globalThis.fetch = originalFetch;
  }
  store.dispatch(refreshDataset.fulfilled({ datasetRevision: 'revision-2' }, 'refresh', undefined));
  const state = store.getState().poker;
  assert.deepEqual(state.sessionMonthIndexes, {});
  assert.deepEqual(state.sessionMonthPages, {});
  assert.deepEqual(state.sessionSummariesById, {});
});

test('odpowiedź starego filtra nie zapisuje danych po aktywowaniu nowego', async () => {
  const store = makeStore();
  const originalFetch = globalThis.fetch;
  const pending = new Map();
  globalThis.fetch = (url) => {
    const rank = new URL(`http://local${url}`).searchParams.get('handRanking') || 'all';
    return new Promise((resolve) => pending.set(rank, resolve));
  };
  const pairQuery = { ...query, handRanking: 'PAIR' };
  try {
    const oldRequest = store.dispatch(fetchSessionMonths(query));
    const newRequest = store.dispatch(fetchSessionMonths(pairQuery));
    pending.get('all')(jsonResponse(monthIndex()));
    pending.get('PAIR')(jsonResponse({ ...monthIndex(), handRanking: 'PAIR' }));
    await Promise.all([oldRequest, newRequest]);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const state = store.getState().poker;
  assert.equal(state.sessionMonthIndexes[queryKey].status, 'idle');
  assert.equal(state.sessionMonthIndexes[createSessionMonthsQueryKey(pairQuery)].status, 'succeeded');
  assert.equal(state.activeSessionMonthQueryKeys.cash, createSessionMonthsQueryKey(pairQuery));
});

test('błąd jednego miesiąca nie usuwa ani nie psuje pozostałych', async () => {
  const store = makeStore();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const month = new URL(`http://local${url}`).searchParams.get('month');
    if (month === '2026-07') return jsonResponse({ error: 'awaria' }, 500);
    return jsonResponse({ ...monthIndex(), sessions: [session('august', '2026/08/01')] });
  };
  try {
    await store.dispatch(fetchSessionMonth({ ...query, month: '2026-08' }));
    await store.dispatch(fetchSessionMonth({ ...query, month: '2026-07' }));
  } finally {
    globalThis.fetch = originalFetch;
  }
  const pages = store.getState().poker.sessionMonthPages[queryKey];
  assert.equal(pages['2026-08'].status, 'succeeded');
  assert.equal(pages['2026-08'].items[0].id, 'august');
  assert.equal(pages['2026-07'].status, 'failed');
});

test('zbiorcze rozwiązywanie ID zapisuje sesje i zgłasza brakujące', async () => {
  const store = makeStore();
  const originalFetch = globalThis.fetch;
  let body;
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return jsonResponse({
      datasetRevision: 'revision-1',
      sessions: [session('known', '2026/08/01')],
      missingSessionIds: ['missing'],
    });
  };
  let result;
  try {
    result = await store.dispatch(fetchSessionSummariesByIds({ sessionIds: ['known', 'missing'] }));
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(body, { datasetRevision: 'revision-1', sessionIds: ['known', 'missing'] });
  assert.equal(store.getState().poker.sessionSummariesById.known.id, 'known');
  assert.deepEqual(store.getState().poker.sessionSummaryQueries[result.payload.queryKey].missingSessionIds, ['missing']);
});
