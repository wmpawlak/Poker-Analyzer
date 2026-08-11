import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createApiApp } from '../server/app.js';
import {
  createEmptyAiAnalysesCache,
  normalizeAiAnalysesCache as normalizeServerAiAnalysesCache,
  readAiAnalysesCache,
  writeAiAnalysesCache,
} from '../server/aiAnalysesCache.js';
import {
  mergeAiAnalysesCaches,
  normalizeAiAnalysesCache,
} from '../src/ai/aiAnalysesCache.js';

const handReport = (reportId) => ({
  reportId,
  model: { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
  analyzedAt: '2026-08-09T10:00:00.000Z',
  analysis: { summary: `Raport ${reportId}` },
});

const sessionReport = (reportId, sessionId) => ({
  reportId,
  model: { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
  analyzedAt: '2026-08-09T10:00:00.000Z',
  sessionId,
  handCount: 20,
  fingerprint: `fingerprint-${sessionId}`,
  analysis: { sessionSummary: 'Raport sesji.' },
});

const groupReport = (reportId, sessionId) => ({
  reportId,
  model: { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
  analyzedAt: '2026-08-09T10:00:00.000Z',
  sources: [{ sourceId: `tournament:${sessionId}`, sessionId }],
  sessionCount: 2,
  handCount: 40,
  fingerprint: `group-${sessionId}`,
  analysis: { summary: `Raport grupy ${reportId}` },
});

const playerReport = (reportId, analyzedAt = '2026-08-09T10:00:00.000Z') => ({
  reportId,
  model: { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
  analyzedAt,
  datasetRevision: 'revision-1',
  fingerprint: `player-${reportId}`,
  criteria: { gameType: 'cash', dateFrom: '', dateTo: '' },
  snapshot: { handCount: 100, metrics: { shared: { hands: 100 } } },
  sourceCoverage: { sessionsInPeriod: 2, availableReports: 1, usedReports: 1 },
  sources: [],
  analysis: { summary: `Analiza gracza ${reportId}` },
});

const startApi = async (t, dataDirectory) => {
  const server = createApiApp({
    dataDirectory,
    logger: { info: () => {}, error: () => {} },
  }).listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}`;
};

const postCache = (baseUrl, cache) => fetch(`${baseUrl}/api/ai-analyses/sync`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ cache }),
});

test('cache AI scala raporty z wielu maszyn po reportId bez surowych historii', () => {
  const first = {
    ...createEmptyAiAnalysesCache(),
    handAnalyses: { 'hand-1': [handReport('hand-report-1')] },
  };
  const second = {
    ...createEmptyAiAnalysesCache(),
    handAnalyses: { 'hand-1': [handReport('hand-report-1'), handReport('hand-report-2')] },
    sessionAnalyses: { 'session-1': [sessionReport('session-report-1', 'session-1')] },
    playerAnalyses: [playerReport('player-report-1')],
  };

  const merged = mergeAiAnalysesCaches(first, second);
  assert.equal(merged.handAnalyses['hand-1'].length, 2);
  assert.equal(merged.sessionAnalyses['session-1'][0].reportId, 'session-report-1');
  assert.equal(merged.playerAnalyses[0].reportId, 'player-report-1');
  assert.equal(JSON.stringify(merged).includes('rawText'), false);
});

test('magazyn zapisuje i odczytuje wersjonowany plik atomowo oraz odrzuca surową historię', async () => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'poker-analyzer-ai-cache-'));
  try {
    const cache = {
      ...createEmptyAiAnalysesCache(),
      handAnalyses: { 'hand-1': [handReport('hand-report-1')] },
      playerAnalyses: [playerReport('player-report-1')],
    };
    await writeAiAnalysesCache(cache, dataDirectory);
    const loaded = await readAiAnalysesCache(dataDirectory);
    assert.deepEqual(loaded.handAnalyses, cache.handAnalyses);
    assert.equal(loaded.playerAnalyses[0].snapshot.metrics.shared.hands, 100);
    await assert.rejects(
      () => writeAiAnalysesCache({
        ...cache,
        handAnalyses: { 'hand-1': [{ ...handReport('unsafe'), rawText: 'CoinPoker Hand #1' }] },
      }, dataDirectory),
      /surowych historii/,
    );
    await assert.rejects(
      () => writeAiAnalysesCache({
        ...cache,
        playerAnalyses: [{ ...playerReport('unsafe-player'), snapshot: { hands: [{ id: '1' }] } }],
      }, dataDirectory),
      /surowych historii/,
    );
  } finally {
    await fs.rm(dataDirectory, { recursive: true, force: true });
  }
});

test('API merge nie gubi raportów drugiej maszyny, a prune usuwa stare fragmenty i zależne grupy', async (t) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'poker-analyzer-ai-api-'));
  t.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const baseUrl = await startApi(t, dataDirectory);
  const machineA = {
    ...createEmptyAiAnalysesCache(),
    sessionAnalyses: { 'fragment-old': [sessionReport('session-old', 'fragment-old')] },
    sessionGroupAnalyses: [groupReport('group-old', 'fragment-old')],
  };
  const machineB = {
    ...createEmptyAiAnalysesCache(),
    handAnalyses: { 'hand-1': [handReport('hand-report-1')] },
    sessionAnalyses: { 'session-current': [sessionReport('session-current-report', 'session-current')] },
    sessionGroupAnalyses: [groupReport('group-current', 'session-current')],
  };

  assert.equal((await postCache(baseUrl, machineA)).status, 200);
  assert.equal((await postCache(baseUrl, machineB)).status, 200);
  const mergedResponse = await fetch(`${baseUrl}/api/ai-analyses`);
  const merged = await mergedResponse.json();
  assert.equal(mergedResponse.status, 200);
  assert.equal(merged.cache.handAnalyses['hand-1'].length, 1);
  assert.equal(merged.cache.sessionAnalyses['fragment-old'].length, 1);
  assert.equal(merged.cache.sessionAnalyses['session-current'].length, 1);
  assert.equal(merged.cache.sessionGroupAnalyses.length, 2);

  const pruneResponse = await fetch(`${baseUrl}/api/ai-analyses/prune`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionIds: ['fragment-old'] }),
  });
  const pruned = await pruneResponse.json();
  assert.equal(pruneResponse.status, 200);
  assert.equal(pruned.cache.sessionAnalyses['fragment-old'], undefined);
  assert.equal(pruned.cache.sessionAnalyses['session-current'].length, 1);
  assert.deepEqual(pruned.cache.sessionGroupAnalyses.map((report) => report.reportId), ['group-current']);
});

test('błędny wspólny cache nie nadpisuje poprawnego pliku', async (t) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'poker-analyzer-ai-invalid-'));
  t.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const baseUrl = await startApi(t, dataDirectory);
  const valid = {
    ...createEmptyAiAnalysesCache(),
    handAnalyses: { 'hand-1': [handReport('hand-report-1')] },
  };
  assert.equal((await postCache(baseUrl, valid)).status, 200);

  const response = await postCache(baseUrl, { version: 99 });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'AI_CACHE_INVALID');
  const unchanged = await (await fetch(`${baseUrl}/api/ai-analyses`)).json();
  assert.equal(unchanged.cache.handAnalyses['hand-1'].length, 1);
});

test('import localStorage mapuje stare singletony i usuwa surowe dane przed zapisem', async (t) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'poker-analyzer-ai-import-'));
  t.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const baseUrl = await startApi(t, dataDirectory);
  const response = await fetch(`${baseUrl}/api/ai-analyses/import-local-storage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      handAnalyses: {
        'hand-old': { summary: 'Stary raport ręki.', rawText: 'CoinPoker Hand #1' },
      },
      sessionAnalyses: {
        'session-old': {
          analysis: { sessionSummary: 'Stary raport sesji.' },
          hands: [{ id: '1', rawText: 'CoinPoker Hand #1' }],
        },
      },
      sessionGroupAnalyses: [{
        analysis: { summary: 'Stary raport grupowy.' },
        sources: [{ sourceId: 'cash:session-old', sessionId: 'session-old' }],
        apiKey: 'sekret',
      }],
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.match(body.cache.handAnalyses['hand-old'][0].reportId, /^legacy-import-hand-/);
  assert.match(body.cache.sessionAnalyses['session-old'][0].reportId, /^legacy-import-session-/);
  assert.match(body.cache.sessionGroupAnalyses[0].reportId, /^legacy-import-session-group-/);
  const serialized = JSON.stringify(body.cache);
  assert.equal(serialized.includes('rawText'), false);
  assert.equal(serialized.includes('CoinPoker Hand'), false);
  assert.equal(serialized.includes('sekret'), false);
});

test('normalizacja cache frontendu odrzuca nieprawidłową wersję zamiast usuwać lokalne raporty', () => {
  assert.equal(normalizeAiAnalysesCache({ version: 99 }), null);
  assert.throws(() => normalizeServerAiAnalysesCache({ version: 99 }), /nieobsługiwaną wersję/);
});

test('starszy cache bez playerAnalyses migruje do pustej historii, a raporty gracza scalają się po reportId', () => {
  const legacy = {
    version: 1,
    updatedAt: null,
    handAnalyses: {},
    sessionAnalyses: {},
    sessionGroupAnalyses: [],
  };
  assert.deepEqual(normalizeAiAnalysesCache(legacy).playerAnalyses, []);
  assert.deepEqual(normalizeServerAiAnalysesCache(legacy).playerAnalyses, []);

  const first = { ...legacy, playerAnalyses: [playerReport('same'), playerReport('first')] };
  const second = { ...legacy, playerAnalyses: [playerReport('same'), playerReport('second')] };
  assert.deepEqual(
    mergeAiAnalysesCaches(first, second).playerAnalyses.map((report) => report.reportId),
    ['same', 'first', 'second'],
  );
});
