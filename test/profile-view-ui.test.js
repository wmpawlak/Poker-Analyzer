import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { buildProfileReport } from '../src/utils/profileReport.js';

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
    report: buildProfileReport({
      cashHands: [makeHand({ timestamp: timestamp(2026, 8, 1), netProfit: 1, bigBlind: 0.1 })],
      tournamentHands: [makeHand({ timestamp: timestamp(2026, 8, 2), netProfit: 100, isTournament: true })],
      gameType: 'both',
    }),
    gameTypeFilter: 'both',
  }));

  assert.match(html, /data-testid="profile-view"/);
  assert.match(html, /data-testid="profile-date-range"/);
  assert.match(html, /data-testid="profile-controls"/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /Statystyki/);
  assert.match(html, /Analizy AI/);
  assert.match(html, /data-testid="date-range-picker"/);
  assert.doesNotMatch(html, /Analiza wielu sesji/);
  assert.match(html, /Cała historia/);
  assert.match(html, /Raport profilu Hero/);
  assert.match(html, /Preflop/);
  assert.match(html, /Cash — wynik netto/);
  assert.match(html, /Turnieje — winrate/);
  assert.match(html, /role="tooltip"/);
});

test('podzakładka Analizy AI pokazuje preview, model i jedno płatne żądanie', async (context) => {
  const vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false },
  });
  context.after(() => vite.close());

  const { ProfileView } = await vite.ssrLoadModule('/src/views/ProfileViews.jsx');
  const html = renderToStaticMarkup(createElement(ProfileView, {
    defaultSubtab: 'analysis',
    gameTypeFilter: 'cash',
    dateFrom: '2026-08-01',
    dateTo: '2026-08-02',
    analysisPreviewStatus: 'succeeded',
    analysisPreview: {
      handCount: 30,
      sessionCount: 2,
      canAnalyze: true,
      warning: 'Próba poniżej 100 rąk daje wyłącznie wstępny profil.',
      profileStyleId: 'MIXED',
      profileStyle: { id: 'MIXED', label: 'Mieszany' },
      reliabilityId: 'PRELIMINARY',
      reliability: { id: 'PRELIMINARY', label: 'Wstępny profil' },
      sessionEvidence: {
        coverage: { sessionsInPeriod: 2, availableReports: 2, usedReports: 1 },
      },
    },
    aiModels: [{ id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', configured: true }],
    defaultAiModel: 'gpt-5.6-terra',
  }));

  assert.match(html, /data-testid="player-analysis-create"/);
  assert.match(html, /data-testid="profile-controls"/);
  assert.match(html, /Ręce/);
  assert.match(html, />30</);
  assert.match(html, /Sesje/);
  assert.match(html, /Mieszany/);
  assert.match(html, /Wstępny profil/);
  assert.match(html, /1 z 2/);
  assert.match(html, /GPT-5.6 Terra/);
  assert.match(html, /Utwórz analizę AI — jedno płatne żądanie/);
  assert.doesNotMatch(html, /<button[^>]*disabled=""[^>]*>Utwórz analizę AI — jedno płatne żądanie<\/button>/);
});

test('analiza jest blokowana dla małej próby i braku konfiguracji modelu', async (context) => {
  const vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false },
  });
  context.after(() => vite.close());

  const { ProfileView } = await vite.ssrLoadModule('/src/views/ProfileViews.jsx');
  const html = renderToStaticMarkup(createElement(ProfileView, {
    defaultSubtab: 'analysis',
    analysisPreviewStatus: 'succeeded',
    analysisPreview: {
      handCount: 29,
      sessionCount: 1,
      canAnalyze: false,
      warning: 'Analiza AI wymaga co najmniej 30 rąk.',
      profileStyleId: 'INSUFFICIENT',
      reliabilityId: 'INSUFFICIENT',
      sessionEvidence: { coverage: { availableReports: 0, usedReports: 0 } },
    },
    aiModels: [{ id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', configured: false }],
    defaultAiModel: 'gpt-5.6-terra',
  }));

  assert.match(html, /co najmniej 30 rąk/);
  assert.match(html, /Model nie jest skonfigurowany/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Utwórz analizę AI — jedno płatne żądanie<\/button>/);
});

test('retry po błędzie jest opisany jako nowe płatne żądanie', async (context) => {
  const vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false },
  });
  context.after(() => vite.close());

  const { ProfileView } = await vite.ssrLoadModule('/src/views/ProfileViews.jsx');
  const html = renderToStaticMarkup(createElement(ProfileView, {
    defaultSubtab: 'analysis',
    analysisPreviewStatus: 'succeeded',
    analysisPreview: {
      handCount: 100,
      sessionCount: 5,
      canAnalyze: true,
      profileStyleId: 'TAG',
      reliabilityId: 'STATISTICAL',
      sessionEvidence: { coverage: { availableReports: 0, usedReports: 0 } },
    },
    aiModels: [{ id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', configured: true }],
    defaultAiModel: 'gpt-5.6-terra',
    analysisStatus: 'failed',
    analysisError: { message: 'Niepełny raport.', code: 'AI_INVALID_PLAYER_RESPONSE' },
  }));

  assert.match(html, /Spróbuj ponownie — nowe płatne żądanie/);
  assert.match(html, /Ponowienie uruchomi nowe płatne żądanie/);
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
    report: buildProfileReport({ cashHands: [], tournamentHands: [], gameType: 'cash' }),
    gameTypeFilter: 'cash',
  }));

  assert.doesNotMatch(html, /Raport profilu Hero/);
  assert.match(html, /Brak rozdań w wybranym zakresie/);
});
