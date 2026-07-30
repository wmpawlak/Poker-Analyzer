import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHandRanking, parseRawHandHistory } from '../src/parser/pokerParser.js';
import { getFilteredSessions, getSelectedEntityId, getVisibleHands } from '../src/utils/handFilters.js';

const hand = (summary) => `CoinPoker Hand #96890300082: NLH (₮0.05/₮0.10) - 2026/07/29 12:00:00 UTC
Table 'Example' 6-max Seat #2 is the button
Seat 2: Hero (₮12.00 in chips)
Seat 3: Villain (₮12.00 in chips)
*** HOLE CARDS ***
Dealt to Hero [Qh Qd]
Hero: calls ₮0.10
*** SUMMARY ***
${summary}`;

test('normalizuje główne kategorie układów', () => {
  assert.equal(normalizeHandRanking('High Card'), 'HIGH_CARD');
  assert.equal(normalizeHandRanking('Two Pair'), 'TWO_PAIR');
  assert.equal(normalizeHandRanking('Full House'), 'FULL_HOUSE');
  assert.equal(normalizeHandRanking('Straight Flush'), 'STRAIGHT_FLUSH');
  assert.equal(normalizeHandRanking(''), 'NO_HAND');
});

test('SUMMARY CoinPoker jest nadrzędne: Hero wygrywa fulla w #96890300082', () => {
  const [parsed] = parseRawHandHistory(hand('Seat 2: Hero showed [Qh Qd] and won (₮24.67) with Full House'));
  assert.equal(parsed.outcome, 'WON');
  assert.equal(parsed.heroWinnings, 24.67);
  assert.equal(parsed.handRanking, 'FULL_HOUSE');
});

test('rozróżnia przegraną, fold i brak układu z podsumowania', () => {
  const [lost] = parseRawHandHistory(hand('Seat 2: Hero showed [Qh Qd] and lost with Pair'));
  const [folded] = parseRawHandHistory(hand('Seat 2: Hero folded before Flop'));
  const [mucked] = parseRawHandHistory(hand('Seat 2: Hero mucked [Qh Qd]'));
  assert.equal(lost.outcome, 'LOST');
  assert.equal(lost.handRanking, 'PAIR');
  assert.equal(folded.outcome, 'FOLDED');
  assert.equal(folded.handRanking, 'NO_HAND');
  assert.equal(mucked.handRanking, 'NO_HAND');
});

test('filtr ogranicza sesje i ręce oraz wybiera pierwszy pasujący element', () => {
  const sessions = [
    { id: 'newest', hands: [{ id: 'a', handRanking: 'PAIR' }, { id: 'rebuy', isRebuy: true, handRanking: 'FULL_HOUSE' }] },
    { id: 'older', hands: [{ id: 'b', handRanking: 'FULL_HOUSE' }] },
  ];
  const filtered = getFilteredSessions(sessions, 'FULL_HOUSE');
  assert.deepEqual(filtered.map(({ id }) => id), ['older']);
  assert.deepEqual(getVisibleHands(filtered[0], 'FULL_HOUSE').map(({ id }) => id), ['b']);
  assert.equal(getSelectedEntityId(filtered, 'newest'), 'older');
});

test('analiza AI zawiera nadrzędny wynik i odrzuca sprzeczną odpowiedź bez retry', async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  const { analysisResponseSchema, buildHandAnalysisPrompt, validateHandAnalysis } = await import('../src/store/pokerSlice.js');
  const parsedHand = {
    id: '96890300082', rawText: 'raw hand', outcome: 'WON', heroWinnings: 24.67,
    netProfit: 12.34, handRanking: 'FULL_HOUSE',
  };
  assert.match(buildHandAnalysisPrompt(parsedHand), /Wynik Hero: WON/);
  assert.equal(JSON.stringify(analysisResponseSchema).includes('nullable'), false);
  assert.deepEqual(analysisResponseSchema.properties.heroResult.required, ['outcome']);
  const accepted = {
    heroResult: {
      handId: 'inne-formatowanie',
      outcome: 'WON',
      heroWinnings: 24.669999,
      netProfit: 0,
      handRanking: 'Full House',
    },
    preflop: '', flop: '', turn: '', river: '', summary: 'OK',
  };
  const validated = validateHandAnalysis(accepted, parsedHand);
  assert.deepEqual(validated.heroResult, {
    handId: '96890300082',
    outcome: 'WON',
    heroWinnings: 24.67,
    netProfit: 12.34,
    handRanking: 'FULL_HOUSE',
  });
  assert.throws(
    () => validateHandAnalysis({ ...accepted, heroResult: { outcome: 'LOST' } }, parsedHand),
    /Oczekiwano: WON, otrzymano: LOST/,
  );
});

test('lokalne źródło ma pierwszeństwo przy duplikacie ID rozdania', async () => {
  globalThis.localStorage ||= {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  const { getUniqueHandsFromSources } = await import('../src/store/pokerSlice.js');
  const localHand = hand('Seat 2: Hero showed [Qh Qd] and won (₮24.67) with Full House')
    .replace("Table 'Example'", "Table 'Local'");
  const uploadedDuplicate = hand('Seat 2: Hero showed [Qh Qd] and lost with Pair')
    .replace("Table 'Example'", "Table 'Uploaded'");

  const uniqueHands = getUniqueHandsFromSources([
    { id: 'upload', origin: 'upload', enabled: true, content: uploadedDuplicate },
    { id: 'local', origin: 'local', enabled: true, content: localHand },
  ]);

  assert.equal(uniqueHands.length, 1);
  assert.equal(uniqueHands[0].tableId, 'Local');
  assert.equal(uniqueHands[0].outcome, 'WON');
});

test('synchronizacja dodaje, zmienia i usuwa lokalne źródła, zachowując enabled i uploady', async () => {
  globalThis.localStorage ||= {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  const { configureStore } = await import('@reduxjs/toolkit');
  const {
    default: pokerReducer,
    syncLocalSources,
    toggleSource,
    uploadHandHistory,
  } = await import('../src/store/pokerSlice.js');
  const localContent = hand('Seat 2: Hero showed [Qh Qd] and won (₮24.67) with Full House');
  let currentContent = localContent;
  let manifest = {
    sources: [{ filename: 'Cash.txt', size: localContent.length, modifiedAt: '2026-07-29T12:00:00.000Z' }],
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url === '/api/local-sources') {
      return new Response(JSON.stringify(manifest), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(currentContent, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  };

  try {
    const store = configureStore({
      reducer: { poker: pokerReducer },
      middleware: (getDefaultMiddleware) => getDefaultMiddleware({ serializableCheck: false }),
    });
    await store.dispatch(syncLocalSources());
    assert.equal(store.getState().poker.sources[0].id, 'local:Cash.txt');
    assert.equal(store.getState().poker.localSourcesStatus, 'succeeded');

    store.dispatch(toggleSource('local:Cash.txt'));
    currentContent = hand('Seat 2: Hero showed [Qh Qd] and lost with Pair');
    manifest = {
      sources: [{ filename: 'Cash.txt', size: currentContent.length, modifiedAt: '2026-07-29T13:00:00.000Z' }],
    };
    await store.dispatch(syncLocalSources());
    assert.equal(store.getState().poker.sources[0].enabled, false);
    assert.equal(store.getState().poker.sources[0].content, currentContent);
    assert.equal(store.getState().poker.sources[0].modifiedAt, '2026-07-29T13:00:00.000Z');

    const uploadedContent = localContent.replace('#96890300082', '#96890300083');
    store.dispatch(uploadHandHistory({ filename: 'Manual.txt', content: uploadedContent }));

    manifest = { sources: [] };
    await store.dispatch(syncLocalSources());
    assert.deepEqual(store.getState().poker.sources.map(({ filename }) => filename), ['Manual.txt']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('błąd lokalnego API nie blokuje ręcznego uploadu', async () => {
  globalThis.localStorage ||= {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  const { configureStore } = await import('@reduxjs/toolkit');
  const {
    default: pokerReducer,
    syncLocalSources,
    uploadHandHistory,
  } = await import('../src/store/pokerSlice.js');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: 'Katalog data jest chwilowo niedostępny.' }),
    { status: 503, headers: { 'Content-Type': 'application/json' } },
  );

  try {
    const store = configureStore({
      reducer: { poker: pokerReducer },
      middleware: (getDefaultMiddleware) => getDefaultMiddleware({ serializableCheck: false }),
    });
    await store.dispatch(syncLocalSources());
    assert.equal(store.getState().poker.localSourcesStatus, 'failed');
    assert.match(store.getState().poker.localSourcesError, /niedostępny/);

    store.dispatch(uploadHandHistory({
      filename: 'Manual.txt',
      content: hand('Seat 2: Hero showed [Qh Qd] and won (₮24.67) with Full House'),
    }));
    assert.equal(store.getState().poker.sources.length, 1);
    assert.equal(store.getState().poker.sources[0].origin, 'upload');
    assert.equal(store.getState().poker.rawHands.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('równoległe wywołanie nie uruchamia drugiej synchronizacji', async () => {
  globalThis.localStorage ||= {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  const { configureStore } = await import('@reduxjs/toolkit');
  const { default: pokerReducer, syncLocalSources } = await import('../src/store/pokerSlice.js');
  const originalFetch = globalThis.fetch;
  let resolveManifest;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Promise((resolve) => {
      resolveManifest = resolve;
    });
  };

  try {
    const store = configureStore({
      reducer: { poker: pokerReducer },
      middleware: (getDefaultMiddleware) => getDefaultMiddleware({ serializableCheck: false }),
    });
    const firstSync = store.dispatch(syncLocalSources());
    const duplicateResult = await store.dispatch(syncLocalSources());
    assert.equal(duplicateResult.meta.condition, true);
    assert.equal(fetchCount, 1);

    resolveManifest(new Response(
      JSON.stringify({ sources: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    await firstSync;
    assert.equal(store.getState().poker.localSourcesStatus, 'succeeded');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
