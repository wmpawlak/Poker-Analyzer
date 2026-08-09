import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const timestamp = (year, month, day) => new Date(year, month - 1, day).getTime();

const makeHand = ({ timestamp: handTimestamp, netProfit, bigBlind = 1, isTournament = false } = {}) => ({
  timestamp: handTimestamp,
  netProfit,
  bigBlind,
  isTournament,
  heroStats: {
    preflop: { vpip: { opportunities: 1, executions: 0 }, pfr: { opportunities: 1, executions: 0 } },
    postflop: {
      aggression: {
        total: { betsRaises: 0, calls: 0 },
        flop: { betsRaises: 0, calls: 0 },
        turn: { betsRaises: 0, calls: 0 },
        river: { betsRaises: 0, calls: 0 },
      },
    },
    showdown: {
      wtsd: { opportunities: 0, executions: 0 },
      wsd: { opportunities: 0, executions: 0 },
    },
  },
});

test('nowy widok profilu renderuje zakres dat, pełne podsumowanie i osobne wyniki mieszane', async (context) => {
  const vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false },
  });
  context.after(() => vite.close());

  const { ProfileView } = await vite.ssrLoadModule('/src/views/ProfileViews.jsx');
  const html = renderToStaticMarkup(createElement(ProfileView, {
    cashHands: [makeHand({ timestamp: timestamp(2026, 8, 1), netProfit: 1, bigBlind: 0.1 })],
    tournamentHands: [makeHand({ timestamp: timestamp(2026, 8, 2), netProfit: 100, isTournament: true })],
    gameTypeFilter: 'both',
  }));

  assert.match(html, /data-testid="profile-view"/);
  assert.match(html, /data-testid="profile-date-from"/);
  assert.match(html, /data-testid="profile-date-to"/);
  assert.doesNotMatch(html, /Analiza wielu sesji/);
  assert.match(html, /Wyczyść zakres/);
  assert.match(html, /Raport profilu Hero/);
  assert.match(html, /Preflop/);
  assert.match(html, /Cash — wynik netto/);
  assert.match(html, /Turnieje — winrate/);
  assert.match(html, /role="tooltip"/);
});

test('widok profilu pokazuje pusty stan bez rozdań', async (context) => {
  const vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false },
  });
  context.after(() => vite.close());

  const { ProfileView } = await vite.ssrLoadModule('/src/views/ProfileViews.jsx');
  const html = renderToStaticMarkup(createElement(ProfileView, {
    cashHands: [],
    gameTypeFilter: 'cash',
  }));

  assert.doesNotMatch(html, /Raport profilu Hero/);
  assert.match(html, /Brak rozdań w wybranym zakresie/);
});
