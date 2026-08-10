import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createDataImportService } from '../server/dataImportService.js';
import { createDataRepository } from '../server/dataRepository.js';
import { parseHandHistoryDocument } from '../src/parser/pokerParser.js';
import { makeHand } from './helpers/pokerHands.js';

const makeDataDirectory = () => fs.mkdtemp(path.join(os.tmpdir(), 'poker-analyzer-data-repository-'));

test('repozytorium rozróżnia nowe ręce, duplikaty i konflikty oraz dzieli JSONL po typie i roku', async (t) => {
  const dataDirectory = await makeDataDirectory();
  t.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const repository = createDataRepository({ dataDirectory });
  const cash = parseHandHistoryDocument(makeHand({ id: '2001', date: '2026/08/01 12:00:00' })).validHands;
  const tournament = parseHandHistoryDocument(makeHand({
    id: '2002', date: '2027/01/01 00:01:00', tournament: true,
  })).validHands;

  const first = await repository.commitCandidates([...cash, ...tournament], { importId: 'first-import' });
  assert.deepEqual(first.counts, { added: 2, duplicates: 0, conflicts: 0 });
  assert.equal(await fs.readFile(path.join(dataDirectory, 'poker', 'hands', 'cash-2026.jsonl'), 'utf8').then(Boolean), true);
  assert.equal(await fs.readFile(path.join(dataDirectory, 'poker', 'hands', 'tournament-2027.jsonl'), 'utf8').then(Boolean), true);

  const beforeRepeat = await fs.readFile(path.join(dataDirectory, 'poker', 'hands', 'cash-2026.jsonl'), 'utf8');
  const duplicate = await repository.commitCandidates(cash, { importId: 'second-import' });
  assert.deepEqual(duplicate.counts, { added: 0, duplicates: 1, conflicts: 0 });
  assert.equal(await fs.readFile(path.join(dataDirectory, 'poker', 'hands', 'cash-2026.jsonl'), 'utf8'), beforeRepeat);

  const changedSameId = parseHandHistoryDocument(makeHand({ id: '2001', table: 'Changed table' })).validHands;
  const conflict = await repository.commitCandidates(changedSameId, { importId: 'third-import' });
  assert.deepEqual(conflict.counts, { added: 0, duplicates: 0, conflicts: 1 });
  assert.equal((await repository.buildHandIndex()).size, 2);
});

test('import zachowuje poprawne ręce, archiwum i audyt mimo problemu oraz kończy przerwany commit idempotentnie', async (t) => {
  const dataDirectory = await makeDataDirectory();
  t.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const repository = createDataRepository({ dataDirectory });
  const service = createDataImportService({ dataDirectory, repository });
  const first = makeHand({ id: '2101' });
  const second = makeHand({ id: '2102', table: 'Second table' });
  const broken = 'CoinPoker Hand #broken: NLH - 2026/08/01 12:00:00 UTC';
  const content = `${first}\n\n${broken}\n\n${second}`;
  const parsed = parseHandHistoryDocument(content);

  // Symuluje zatrzymanie procesu po atomowym commicie JSONL, przed archiwum.
  await repository.commitCandidates(parsed.validHands, { importId: service.prepareTextImport({ filename: 'Broken.txt', content }).importId });
  const importedAt = '2026-08-10T12:00:00.000Z';
  const completed = await service.importText({ filename: 'Broken.txt', content, importedAt });

  assert.deepEqual(completed.report, {
    version: 1,
    importId: completed.importId,
    filename: 'Broken.txt',
    importedAt: completed.report.importedAt,
    size: Buffer.byteLength(content, 'utf8'),
    total: 3,
    added: 0,
    duplicates: 2,
    conflicts: 0,
    invalid: 1,
  });
  const sourcePath = path.join(dataDirectory, 'poker', 'sources', `${completed.importId}.txt`);
  const issuesPath = path.join(dataDirectory, 'poker', 'issues', `${completed.importId}.json`);
  assert.equal(await fs.readFile(sourcePath, 'utf8'), content);
  assert.deepEqual((await fs.readFile(issuesPath, 'utf8')).includes('CoinPoker Hand #broken'), false);
  assert.deepEqual(JSON.parse(await fs.readFile(issuesPath, 'utf8')).issues, [{
    ordinal: 2,
    handId: null,
    reason: 'MISSING_HAND_ID',
  }]);

  const repeated = await service.importText({ filename: 'Broken.txt', content, importedAt });
  assert.equal(repeated.archiveCreated, false);
  assert.equal(repeated.reportCreated, false);
  assert.deepEqual(repeated.report, { ...completed.report, added: 0, duplicates: 2 });
});
