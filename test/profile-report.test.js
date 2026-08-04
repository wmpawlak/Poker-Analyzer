import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  buildSessions,
  buildTourneySessions,
  parseRawHandHistory,
} from '../src/parser/pokerParser.js';
import {
  buildProfileReport,
  filterHandsByDateRange,
  getProfileDateRange,
} from '../src/utils/profileReport.js';

const fixturePath = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const loadFixtureHands = async (name) => parseRawHandHistory(
  await readFile(fixturePath(name), 'utf8'),
);

const localTimestamp = (year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) => (
  new Date(year, month - 1, day, hour, minute, second, millisecond).getTime()
);

const makeHand = ({ timestamp, netProfit = 0, bigBlind = 1, isTournament = false, isRebuy = false } = {}) => ({
  timestamp,
  netProfit,
  bigBlind,
  isTournament,
  isRebuy,
});

test('filtr zakresu dat ma włączne granice dnia i wyklucza rebuy', () => {
  const hands = [
    makeHand({ timestamp: localTimestamp(2026, 8, 1, 0, 0, 0, 0) }),
    makeHand({ timestamp: localTimestamp(2026, 8, 1, 23, 59, 59, 999) }),
    makeHand({ timestamp: localTimestamp(2026, 8, 2) }),
    makeHand({ timestamp: localTimestamp(2026, 8, 1, 12), isRebuy: true }),
  ];

  const filtered = filterHandsByDateRange(hands, { from: '2026-08-01', to: '2026-08-01' });
  assert.equal(filtered.length, 2);
  assert.equal(filtered.some((hand) => hand.isRebuy), false);
});

test('pusty zakres zwraca całą historię bez rebuyów', () => {
  const hands = [
    makeHand({ timestamp: localTimestamp(2026, 8, 1) }),
    makeHand({ timestamp: localTimestamp(2026, 8, 2), isRebuy: true }),
  ];

  assert.equal(filterHandsByDateRange(hands, { from: '', to: '' }).length, 1);
  assert.deepEqual(getProfileDateRange('', ''), {
    valid: true,
    error: null,
    fromTimestamp: null,
    toTimestamp: null,
    isEmpty: true,
  });
});

test('odwrócony zakres zatrzymuje raport i zwraca komunikat walidacyjny', () => {
  const report = buildProfileReport({
    cashHands: [makeHand({ timestamp: localTimestamp(2026, 8, 2) })],
    dateFrom: '2026-08-03',
    dateTo: '2026-08-01',
  });

  assert.equal(report.isValid, false);
  assert.match(report.error, /późniejsza/);
  assert.equal(report.metrics, null);
  assert.deepEqual(report.hands, []);
});

test('raport mieszany używa wspólnych statystyk, ale rozdziela wynik Cash i turniejów', () => {
  const report = buildProfileReport({
    cashHands: [makeHand({
      timestamp: localTimestamp(2026, 8, 1),
      netProfit: 1,
      bigBlind: 0.1,
    })],
    tournamentHands: [makeHand({
      timestamp: localTimestamp(2026, 8, 2),
      netProfit: 100,
      isTournament: true,
    })],
    gameType: 'both',
  });

  assert.equal(report.isValid, true);
  assert.equal(report.metrics.gameType, 'mixed');
  assert.equal(report.metrics.hands, 2);
  assert.equal(report.cashMetrics.totalProfit, 1);
  assert.equal(report.cashMetrics.winrate.value, 1000);
  assert.equal(report.tournamentMetrics.totalProfit, 100);
  assert.equal(report.tournamentMetrics.winrate.value, 10000);
  assert.equal(report.metrics.winrate.value, '—');
});

test('raport Cash i Turnieje wybiera odpowiedni podzbiór rąk', () => {
  const cash = makeHand({ timestamp: localTimestamp(2026, 8, 1), netProfit: 2, bigBlind: 1 });
  const tournament = makeHand({ timestamp: localTimestamp(2026, 8, 1), netProfit: 50, isTournament: true });

  const cashReport = buildProfileReport({ cashHands: [cash], tournamentHands: [tournament], gameType: 'cash' });
  const tournamentReport = buildProfileReport({ cashHands: [cash], tournamentHands: [tournament], gameType: 'tournament' });

  assert.deepEqual(cashReport.hands, [cash]);
  assert.equal(cashReport.metrics.gameType, 'cash');
  assert.deepEqual(tournamentReport.hands, [tournament]);
  assert.equal(tournamentReport.metrics.gameType, 'tournament');
});

test('mała próbka profilu obejmuje kilka sesji Cash i turniejów bez dużego pliku danych', async () => {
  const cashHands = await loadFixtureHands('profile-period-cash.txt');
  const tournamentHands = await loadFixtureHands('profile-period-tournaments.txt');
  const cashSessions = buildSessions(cashHands);
  const tournamentSessions = buildTourneySessions(tournamentHands);
  const report = buildProfileReport({
    cashHands: cashSessions.flatMap((session) => session.hands),
    tournamentHands: tournamentSessions.flatMap((tournament) => tournament.hands),
    gameType: 'both',
  });

  assert.equal(cashHands.length, 6);
  assert.equal(tournamentHands.length, 6);
  assert.equal(cashSessions.length, 3);
  assert.equal(tournamentSessions.length, 3);
  assert.equal(tournamentSessions.some((session) => session.hands.some((hand) => hand.isRebuy)), true);
  assert.equal(report.metrics.hands, 12);
  assert.equal(report.cashHands.length, 6);
  assert.equal(report.tournamentHands.length, 6);

  const firstPeriod = buildProfileReport({
    cashHands: cashSessions.flatMap((session) => session.hands),
    tournamentHands: tournamentSessions.flatMap((tournament) => tournament.hands),
    gameType: 'both',
    dateFrom: '2026-07-01',
    dateTo: '2026-07-04',
  });
  assert.equal(firstPeriod.cashHands.length, 6);
  assert.equal(firstPeriod.tournamentHands.length, 2);
});
