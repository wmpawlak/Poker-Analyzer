import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDataImportService } from '../server/dataImportService.js';
import { runTrainingMigration } from '../server/trainingMigration.js';
import { TRAINING_EXTRACTOR_VERSION } from '../server/training/spotExtractor.js';
import { TRAINING_SCHEMA_VERSION } from '../server/training/trainingDatabase.js';

const makeDirectory = () => fs.mkdtemp(path.join(os.tmpdir(), 'poker-training-migration-'));

const makeHand = () => `CoinPoker Hand #991001: NLH (0.50/1) 2026/08/01 12:00:00 UTC
Table 'training-migration' 2-max Seat #1 is the button
Seat 1: Hero (100 in chips)
Seat 2: Villain (100 in chips)
Hero: posts small blind 0.50
Villain: posts big blind 1
*** HOLE CARDS ***
Dealt to Hero [Ah Kd]
Hero: folds
*** SUMMARY ***
Seat 1: Hero folded before Flop`;

test('migrator raportuje dry-run, skanuje starszy extractor i zachowuje idempotencję apply', async (t) => {
  const dataDirectory = await makeDirectory();
  t.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  await createDataImportService({ dataDirectory }).importText({
    filename: 'training-migration.txt',
    content: makeHand(),
  });

  const dryRun = await runTrainingMigration({ dataDirectory, mode: 'dry-run' });
  assert.equal(dryRun.databaseExists, false);
  assert.equal(dryRun.needsRescan, true);
  assert.equal(dryRun.target.schemaVersion, TRAINING_SCHEMA_VERSION);
  assert.equal(dryRun.target.extractorVersion, TRAINING_EXTRACTOR_VERSION);
  assert.equal(await fs.access(path.join(dataDirectory, 'poker-training-v2.sqlite')).then(() => true, () => false), false);

  const applied = await runTrainingMigration({
    dataDirectory,
    mode: 'apply',
    clock: () => new Date('2026-08-14T12:00:00.000Z'),
  });
  assert.equal(applied.backupPath, null);
  assert.equal(applied.after.versions.schemaMigrations, TRAINING_SCHEMA_VERSION);
  assert.equal(applied.after.versions.pragmaUserVersion, TRAINING_SCHEMA_VERSION);
  assert.equal(applied.after.versions.collectionMetadata, TRAINING_SCHEMA_VERSION);
  assert.deepEqual(applied.after.extractorVersions, { [String(TRAINING_EXTRACTOR_VERSION)]: 1 });
  assert.equal(applied.after.needsRescan, false);
  assert.equal(applied.after.integrityCheck, 'ok');
  assert.equal(applied.after.foreignKeyViolations, 0);

  const repeated = await runTrainingMigration({
    dataDirectory,
    mode: 'apply',
    clock: () => new Date('2026-08-14T12:00:01.000Z'),
  });
  assert.match(repeated.backupPath, /[\\/]\.backups[\\/].+\.bak$/);
  assert.equal(repeated.scan, null);
  assert.equal(repeated.after.needsRescan, false);
  assert.deepEqual(repeated.after.counts, applied.after.counts);
});
