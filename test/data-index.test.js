import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createDataImportService } from '../server/dataImportService.js';
import { readAiAnalysesCache, writeAiAnalysesCache } from '../server/aiAnalysesCache.js';
import { runDataHandReplacement } from '../server/dataHandReplacement.js';
import { createDataIndex } from '../server/dataIndex.js';
import { readCanonicalRecords } from '../server/dataRepository.js';
import { buildSessionAnalysisInput } from '../src/ai/sessionAnalysisContract.js';
import { makeHand } from './helpers/pokerHands.js';

test('indeks używa cache bez rawText i przebudowuje go po zmianie rewizji danych', async (t) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'poker-analyzer-index-'));
  t.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const importer = createDataImportService({ dataDirectory });
  await importer.importText({ filename: 'first.txt', content: makeHand({ id: '7101' }) });

  const firstIndex = createDataIndex({ dataDirectory, logger: { error: () => {} } });
  const firstSnapshot = await firstIndex.start();
  const cachePath = path.join(dataDirectory, '.cache', 'poker-index-v1.json.gz');
  const cached = JSON.parse(gunzipSync(await fs.readFile(cachePath)).toString('utf8'));
  assert.equal(firstSnapshot.hands.length, 1);
  assert.equal(JSON.stringify(cached).includes('rawText'), false);

  const cachedIndex = createDataIndex({ dataDirectory, logger: { error: () => {} } });
  const cachedSnapshot = await cachedIndex.start();
  assert.equal(cachedSnapshot.datasetRevision, firstSnapshot.datasetRevision);

  await importer.importText({ filename: 'second.txt', content: makeHand({ id: '7102' }) });
  // getSnapshot celowo może oddać poprzednią rewizję podczas przebudowy;
  // start czeka na nowy snapshot i pozwala zweryfikować unieważnienie cache.
  const updatedSnapshot = await cachedIndex.start();
  assert.equal(updatedSnapshot.hands.length, 2);
  assert.notEqual(updatedSnapshot.datasetRevision, firstSnapshot.datasetRevision);
});

test('zastąpienie ręki działa dopiero z --apply i usuwa zależne analizy z cache', async (t) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'poker-analyzer-replace-'));
  t.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const importer = createDataImportService({ dataDirectory });
  const original = makeHand({ id: '7111', table: 'Original table' });
  await importer.importText({ filename: 'original.txt', content: original });
  const index = createDataIndex({ dataDirectory, logger: { error: () => {} } });
  const snapshot = await index.start();
  const session = snapshot.sessions.cash[0];
  const input = buildSessionAnalysisInput({ sessionId: session.id, hands: session.hands, gameType: 'cash' });
  await writeAiAnalysesCache({
    version: 1,
    updatedAt: null,
    handAnalyses: { '7111': [{ reportId: 'hand-report', analysis: { summary: 'Stary raport.' } }] },
    sessionAnalyses: {
      [session.id]: [{
        reportId: 'session-report',
        fingerprint: input.fingerprint,
        analysis: {
          profileStyleId: input.profileStyleId,
          sessionSummary: 'Mała próba. Ostrożny wniosek.',
          keyMistakes: [],
          notableHands: [{ handId: '7111', reason: 'Jedyna ręka.' }],
        },
      }],
    },
    sessionGroupAnalyses: [],
  }, dataDirectory);
  const replacementPath = path.join(dataDirectory, 'replacement.txt');
  await fs.writeFile(replacementPath, makeHand({ id: '7111', table: 'Corrected table' }), 'utf8');

  const dryRun = await runDataHandReplacement({
    dataDirectory, handId: '7111', filePath: replacementPath, mode: 'dry-run', logger: { error: () => {} },
  });
  assert.equal(dryRun.replacement.changed, true);
  assert.match((await readCanonicalRecords(dataDirectory))[0].rawText, /Original table/);

  const applied = await runDataHandReplacement({
    dataDirectory, handId: '7111', filePath: replacementPath, mode: 'apply', logger: { error: () => {} },
  });
  assert.equal(applied.replacement.changed, true);
  assert.ok(applied.analyses.handReportsRemoved >= 1);
  assert.match((await readCanonicalRecords(dataDirectory))[0].rawText, /Corrected table/);
  assert.equal(Object.hasOwn(await readAiAnalysesCache(dataDirectory).then((cache) => cache.handAnalyses), '7111'), false);
});
