import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { buildTourneySessions, parseRawHandHistory } from '../src/parser/pokerParser.js';
import { buildSessionAnalysisInput } from '../src/ai/sessionAnalysisContract.js';
import {
  createEmptyAiAnalysesCache,
  readAiAnalysesCache,
  writeAiAnalysesCache,
} from '../server/aiAnalysesCache.js';
import {
  buildMigrationSessionSummary,
  runDataMigration,
} from '../server/dataMigration.js';
import { makeHand } from './helpers/pokerHands.js';

const makeDataDirectory = () => fs.mkdtemp(path.join(os.tmpdir(), 'poker-analyzer-data-migration-'));

const legacyContent = () => [
  makeHand({ id: '3001', table: 'Same table', date: '2026/08/01 23:50:00' }),
  makeHand({ id: '3002', table: 'Same table', date: '2026/08/02 00:20:00' }),
  makeHand({ id: '3003', table: 'Same table', date: '2026/08/02 00:51:00' }),
  makeHand({ id: '3004', tournament: true, tournamentId: '777', date: '2026/08/02 01:00:00' }),
].join('\n\n');

test('dry-run migracji nie zapisuje ani nie przenosi TXT, a prognozuje liczniki i sesje', async (t) => {
  const dataDirectory = await makeDataDirectory();
  t.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const sourcePath = path.join(dataDirectory, 'Legacy.txt');
  await fs.writeFile(sourcePath, legacyContent(), 'utf8');

  const result = await runDataMigration({ dataDirectory, mode: 'dry-run' });

  assert.equal(result.mode, 'dry-run');
  assert.deepEqual(result.counts, {
    total: 4,
    valid: 4,
    added: 4,
    duplicates: 0,
    conflicts: 0,
    invalid: 0,
  });
  assert.deepEqual(result.sessions, { cash: 2, tournament: 1 });
  assert.equal(await fs.readFile(sourcePath, 'utf8'), legacyContent());
  await assert.rejects(() => fs.access(path.join(dataDirectory, 'poker')), { code: 'ENOENT' });
});

test('podział Cash zachowuje dokładnie 30 minut i przejście przez północ, ale dzieli przy dłuższej przerwie', () => {
  const start = new Date('2026-08-01T23:50:00.000Z').getTime();
  const summary = buildMigrationSessionSummary([
    { id: 'cash-1', tableId: 'A', timestamp: start, isTournament: false },
    { id: 'cash-2', tableId: 'A', timestamp: start + (30 * 60 * 1000), isTournament: false },
    { id: 'cash-3', tableId: 'A', timestamp: start + (61 * 60 * 1000), isTournament: false },
  ]);

  assert.deepEqual(summary, { cash: 2, tournament: 0 });
});

test('apply archiwizuje źródło po weryfikacji magazynu oraz zachowuje wyłącznie zgodne analizy turniejowe', async (t) => {
  const dataDirectory = await makeDataDirectory();
  t.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const content = legacyContent();
  const sourcePath = path.join(dataDirectory, 'Legacy.txt');
  await fs.writeFile(sourcePath, content, 'utf8');

  const tournamentHand = parseRawHandHistory(makeHand({
    id: '3004', tournament: true, tournamentId: '777', date: '2026/08/02 01:00:00',
  }));
  const [tournamentSession] = buildTourneySessions(tournamentHand);
  const matchingFingerprint = buildSessionAnalysisInput({
    sessionId: tournamentSession.id,
    hands: tournamentSession.hands,
    gameType: 'tournament',
  }).fingerprint;
  await writeAiAnalysesCache({
    ...createEmptyAiAnalysesCache(),
    handAnalyses: { '3001': [{ reportId: 'hand-keep' }] },
    sessionAnalyses: {
      'cash-old': [{ reportId: 'cash-remove', fingerprint: 'cash' }],
      [tournamentSession.id]: [
        { reportId: 'tournament-keep', fingerprint: matchingFingerprint },
        { reportId: 'tournament-remove', fingerprint: 'old-fingerprint' },
      ],
    },
    sessionGroupAnalyses: [
      { reportId: 'group-cash-remove', sources: [{ type: 'cash', sourceId: 'cash:cash-old' }] },
      { reportId: 'group-tournament-keep', sources: [{ type: 'tournament', sourceId: `tournament:${tournamentSession.id}` }] },
    ],
  }, dataDirectory);

  const result = await runDataMigration({ dataDirectory, mode: 'apply' });

  assert.equal(result.mode, 'apply');
  assert.deepEqual(result.sessions, { cash: 2, tournament: 1 });
  assert.deepEqual(result.analyses, { preserved: 3, removed: 3 });
  await assert.rejects(() => fs.access(sourcePath), { code: 'ENOENT' });
  const [archiveFilename] = await fs.readdir(path.join(dataDirectory, 'poker', 'sources'));
  assert.equal(await fs.readFile(path.join(dataDirectory, 'poker', 'sources', archiveFilename), 'utf8'), content);

  const cache = await readAiAnalysesCache(dataDirectory);
  assert.deepEqual(cache.handAnalyses, { '3001': [{ reportId: 'hand-keep' }] });
  assert.deepEqual(cache.sessionAnalyses, {
    [tournamentSession.id]: [{ reportId: 'tournament-keep', fingerprint: matchingFingerprint }],
  });
  assert.deepEqual(cache.sessionGroupAnalyses.map((report) => report.reportId), ['group-tournament-keep']);

  const repeated = await runDataMigration({ dataDirectory, mode: 'apply' });
  assert.deepEqual(repeated.counts, {
    total: 0,
    valid: 0,
    added: 0,
    duplicates: 0,
    conflicts: 0,
    invalid: 0,
  });
  assert.deepEqual(repeated.analyses, { preserved: 3, removed: 0 });
});
