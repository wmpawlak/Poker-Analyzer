import nodeTest from 'node:test';
import assert from 'node:assert/strict';

// Lokalne źródła i ręczny upload po stronie Redux zostały zastąpione centrum importu API.
const test = (name, callback) => (
  /duplikacie ID rozdania|enabled i uploady|lokalnego API|drugiej synchronizacji/.test(name)
    ? nodeTest.skip(name, callback)
    : nodeTest(name, callback)
);
import { normalizeHandRanking, parseRawHandHistory } from '../src/parser/pokerParser.js';
import { getFilteredSessions, getSelectedEntityId, getVisibleHands } from '../src/utils/handFilters.js';
import { buildStartingHandStats, getWinRateColorTier } from '../src/utils/startingHandStats.js';
import { calculateHeroMetrics } from '../src/utils/heroMetrics.js';

const hand = (summary) => `CoinPoker Hand #96890300082: NLH (₮0.05/₮0.10) - 2026/07/29 12:00:00 UTC
Table 'Example' 6-max Seat #2 is the button
Seat 2: Hero (₮12.00 in chips)
Seat 3: Villain (₮12.00 in chips)
*** HOLE CARDS ***
Dealt to Hero [Qh Qd]
Hero: calls ₮0.10
*** SUMMARY ***
${summary}`;

const beforeSummary = (rawHand, actions) => rawHand.replace(
  '*** SUMMARY ***',
  `${actions}\n*** SUMMARY ***`,
);

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

test('rozróżnia przegraną oraz wylicza układ dla fold/muck z widocznych kart', () => {
  const [lost] = parseRawHandHistory(hand('Seat 2: Hero showed [Qh Qd] and lost with Pair'));
  const [folded] = parseRawHandHistory(hand('Seat 2: Hero folded before Flop'));
  const [mucked] = parseRawHandHistory(hand('Seat 2: Hero mucked [Qh Qd]'));
  assert.equal(lost.outcome, 'LOST');
  assert.equal(lost.handRanking, 'PAIR');
  assert.equal(folded.outcome, 'FOLDED');
  assert.equal(folded.handRanking, 'PAIR');
  assert.equal(folded.handRankingSource, 'VISIBLE_CARDS');
  assert.equal(mucked.handRanking, 'PAIR');
  assert.equal(mucked.handRankingSource, 'VISIBLE_CARDS');
});

test('showdown wymaga faktycznej akcji pokazania lub muckowania kart przez Hero', () => {
  const foldedWhileOthersShow = hand(`Seat 2: Hero folded before Flop
Seat 3: Villain showed [Ah Kh] and won (₮1.00) with Pair`)
    .replace('*** SUMMARY ***', `*** SHOWDOWN ***
Villain: shows [Ah Kh]
*** SUMMARY ***`);
  const [folded] = parseRawHandHistory(foldedWhileOthersShow);
  const [summaryOnly] = parseRawHandHistory(hand('Seat 2: Hero showed [Qh Qd] and won (₮1.00) with Pair'));
  const [showed] = parseRawHandHistory(beforeSummary(
    hand('Seat 2: Hero showed [Qh Qd] and lost with Pair'),
    '*** SHOWDOWN ***\nHero: shows [Qh Qd]\nVillain: shows [Ah Ad]',
  ));
  const [mucked] = parseRawHandHistory(beforeSummary(
    hand('Seat 2: Hero mucked [Qh Qd]'),
    '*** SHOWDOWN ***\nHero: mucks hand',
  ));

  assert.equal(folded.sawShowdown, false);
  assert.equal(summaryOnly.sawShowdown, false);
  assert.equal(showed.sawShowdown, true);
  assert.equal(mucked.sawShowdown, true);
  assert.equal(showed.heroReachedRiverOrShowdown, true);
  assert.equal(mucked.heroReachedRiverOrShowdown, true);
  assert.deepEqual(summaryOnly.heroStats.showdown.wtsd, { opportunities: 0, executions: 0 });
  assert.deepEqual(summaryOnly.heroStats.showdown.wsd, { opportunities: 0, executions: 0 });
});

test('filtr River/Showdown obejmuje river fold win, ale pomija wcześniejsze foldy i fold Hero', () => {
  const [flopFoldWin] = parseRawHandHistory(beforeSummary(
    hand('Seat 2: Hero showed [Qh Qd] and won (₮1.00) with Pair'),
    '*** FLOP *** [2c 3d 4h]\nHero: bets ₮0.20\nVillain: folds',
  ));
  const [riverFoldWin] = parseRawHandHistory(beforeSummary(
    hand('Seat 2: Hero showed [Qh Qd] and won (₮1.00) with Pair'),
    '*** FLOP *** [2c 3d 4h]\nHero: checks\nVillain: checks\n*** TURN *** [2c 3d 4h] [5s]\nHero: checks\nVillain: checks\n*** RIVER *** [2c 3d 4h 5s] [9c]\nHero: bets ₮0.20\nVillain: folds',
  ));
  const [heroFoldsRiver] = parseRawHandHistory(beforeSummary(
    hand('Seat 2: Hero folded on the River'),
    '*** FLOP *** [2c 3d 4h]\nHero: checks\n*** TURN *** [2c 3d 4h] [5s]\nHero: checks\n*** RIVER *** [2c 3d 4h 5s] [9c]\nHero: folds',
  ));
  const [multiBoardRiverFoldWin] = parseRawHandHistory(beforeSummary(
    hand('Seat 2: Hero showed [Qh Qd] and won (₮1.00) with Pair'),
    '*** FIRST FLOP *** [2c 3d 4h]\nHero: checks\n*** FIRST RIVER *** [2c 3d 4h 5s] [9c]\nVillain: folds',
  ));

  assert.equal(flopFoldWin.heroSawFlop, true);
  assert.equal(flopFoldWin.heroReachedRiverOrShowdown, false);
  assert.equal(riverFoldWin.sawShowdown, false);
  assert.equal(riverFoldWin.heroReachedRiverOrShowdown, true);
  assert.equal(heroFoldsRiver.heroReachedRiverOrShowdown, false);
  assert.equal(multiBoardRiverFoldWin.heroSawFlop, true);
  assert.equal(multiBoardRiverFoldWin.heroReachedRiverOrShowdown, true);
});

test('statystyki 169 rąk przeliczają WR po filtrze River/Showdown i pomijają PLO', () => {
  const hands = [
    { heroCards: ['Ah', 'Kh'], outcome: 'WON', heroReachedRiverOrShowdown: true },
    { heroCards: ['As', 'Ks'], outcome: 'LOST', heroReachedRiverOrShowdown: false },
    { heroCards: ['Kd', 'Ah'], outcome: 'WON', heroReachedRiverOrShowdown: true },
    { heroCards: ['2d', '5s', 'Ah', '6h'], outcome: 'WON', heroReachedRiverOrShowdown: true },
  ];

  const allStats = buildStartingHandStats(hands);
  const riverOrShowdownStats = buildStartingHandStats(hands, { riverOrShowdownOnly: true });
  const allAKs = allStats.find(({ key }) => key === 'AKs');
  const filteredAKs = riverOrShowdownStats.find(({ key }) => key === 'AKs');

  assert.equal(allStats.length, 169);
  assert.equal(allStats.reduce((sum, stats) => sum + stats.count, 0), 3);
  assert.deepEqual(
    { count: allAKs.count, wins: allAKs.wins, losses: allAKs.losses, winRate: allAKs.winRate },
    { count: 2, wins: 1, losses: 1, winRate: 50 },
  );
  assert.deepEqual(
    { count: filteredAKs.count, wins: filteredAKs.wins, losses: filteredAKs.losses, winRate: filteredAKs.winRate },
    { count: 1, wins: 1, losses: 0, winRate: 100 },
  );
});

test('kolory mapy mają stałe progi surowego WR', () => {
  assert.equal(getWinRateColorTier(0, 0), 'none');
  assert.equal(getWinRateColorTier(100, 9), 'insufficient');
  assert.equal(getWinRateColorTier(24.99, 10), 'critical');
  assert.equal(getWinRateColorTier(25, 10), 'pink');
  assert.equal(getWinRateColorTier(44.99, 10), 'pink');
  assert.equal(getWinRateColorTier(45, 10), 'yellow');
  assert.equal(getWinRateColorTier(55, 10), 'yellow');
  assert.equal(getWinRateColorTier(55.01, 10), 'light-green');
  assert.equal(getWinRateColorTier(70, 10), 'green');
  assert.equal(getWinRateColorTier(84.99, 10), 'green');
  assert.equal(getWinRateColorTier(85, 10), 'dark-green');
});

test('profil liczy standardowe WTSD względem rozdań, w których Hero zobaczył flop', () => {
  const metrics = calculateHeroMetrics([
    { heroSawFlop: true, sawShowdown: true, outcome: 'WON', netProfit: 1 },
    { heroSawFlop: true, sawShowdown: true, outcome: 'LOST', netProfit: -1 },
    { heroSawFlop: true, sawShowdown: false, outcome: 'WON', netProfit: 1 },
    { heroSawFlop: false, sawShowdown: false, outcome: 'FOLDED', netProfit: 0 },
  ]);

  assert.equal(metrics.wtsd, '66.7');
  assert.equal(metrics.wsd, '50.0');
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
