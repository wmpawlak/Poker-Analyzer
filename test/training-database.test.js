import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createTrainingDatabase,
  getTrainingSchemaVersion,
  migrateTrainingSchema,
  TRAINING_DATABASE_FILENAME,
  TRAINING_SCHEMA_VERSION,
  TRAINING_SCHEMA_STATEMENTS,
} from '../server/training/trainingDatabase.js';

const makeDirectory = () => fs.mkdtemp(path.join(os.tmpdir(), 'poker-training-database-'));

test('tworzy wersjonowany schemat SQLite z wymaganymi pragmami i indeksami', async () => {
  const directory = await makeDirectory();
  const database = createTrainingDatabase({ dataDirectory: directory });
  try {
    assert.equal(getTrainingSchemaVersion(database), TRAINING_SCHEMA_VERSION);
    assert.equal(database.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.equal(database.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    assert.equal(database.prepare('PRAGMA busy_timeout').get().timeout, 5_000);
    assert.equal(database.prepare('PRAGMA user_version').get().user_version, TRAINING_SCHEMA_VERSION);
    assert.equal(
      database.prepare('SELECT schema_version FROM collection_metadata WHERE id = 1').get().schema_version,
      TRAINING_SCHEMA_VERSION,
    );

    const tables = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all().map(({ name }) => name);
    assert.deepEqual(tables.filter((name) => name !== 'sqlite_sequence'), [
      'answer_keys',
      'attempts',
      'audit_exclusions',
      'collection_metadata',
      'equity_supplements',
      'refresh_job_events',
      'refresh_job_spots',
      'refresh_jobs',
      'schema_migrations',
      'selected_spots',
      'session_spots',
      'sessions',
      'source_history',
      'sources',
      'spots',
    ]);

    const indexedTables = database.prepare(
      "SELECT DISTINCT tbl_name AS name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY tbl_name",
    ).all().map(({ name }) => name);
    assert.deepEqual(indexedTables, [
      'answer_keys',
      'attempts',
      'audit_exclusions',
      'equity_supplements',
      'refresh_job_events',
      'refresh_job_spots',
      'refresh_jobs',
      'selected_spots',
      'session_spots',
      'sessions',
      'source_history',
      'sources',
      'spots',
    ]);
  } finally {
    database.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('klucze obce oraz limit 100 aktywnych spotów są wymuszane przez schemat', async () => {
  const directory = await makeDirectory();
  const database = createTrainingDatabase({ dataDirectory: directory });
  try {
    const now = '2026-08-13T00:00:00.000Z';
    database.prepare(`
      INSERT INTO sources (hand_id, fingerprint, game_type, status, first_seen_at, scanned_at, updated_at)
      VALUES (?, ?, 'cash', 'current', ?, ?, ?)
    `).run('hand-1', 'fingerprint-1', now, now, now);
    database.prepare(`
      INSERT INTO spots (
        version_id, spot_id, hand_id, source_fingerprint, exercise_type, game_type,
        source_status, readiness, active, question_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'preflop_selection', 'cash', 'current', 'ready', 1, '{}', ?, ?)
    `).run('spot-version-1', 'spot-1', 'hand-1', 'fingerprint-1', now, now);
    database.prepare(`
      INSERT INTO selected_spots (exercise_type, game_type, position, spot_version_id, selected_at)
      VALUES ('preflop_selection', 'cash', 0, 'spot-version-1', ?)
    `).run(now);

    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM selected_spots').get().count, 1);
    assert.throws(() => database.prepare(`
      INSERT INTO spots (
        version_id, spot_id, hand_id, source_fingerprint, exercise_type, game_type,
        source_status, readiness, active, current_answer_key_id, question_json, created_at, updated_at
      ) VALUES ('spot-version-2', 'spot-2', 'hand-1', 'fingerprint-1', 'preflop_selection', 'cash',
        'current', 'ready', 1, 'missing-key', '{}', ?, ?)
    `).run(now, now), /different answer key/i);
    assert.throws(() => database.prepare(`
      INSERT INTO selected_spots (exercise_type, game_type, position, spot_version_id, selected_at)
      VALUES ('preflop_selection', 'cash', 1, 'missing-spot', ?)
    `).run(now), /FOREIGN KEY|non-active spot/i);
    assert.throws(() => database.prepare(`
      INSERT INTO selected_spots (exercise_type, game_type, position, spot_version_id, selected_at)
      VALUES ('preflop_selection', 'cash', 100, 'spot-version-1', ?)
    `).run(now), /CHECK constraint|UNIQUE/i);

    database.prepare("UPDATE spots SET active = 0 WHERE version_id = 'spot-version-1'").run();
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM selected_spots').get().count, 1);
    database.prepare("UPDATE spots SET source_status = 'changed' WHERE version_id = 'spot-version-1'").run();
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM selected_spots').get().count, 0);
  } finally {
    database.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('ponowne otwarcie bazy nie tworzy drugiej migracji', async () => {
  const directory = await makeDirectory();
  const first = createTrainingDatabase({ dataDirectory: directory });
  first.close();
  const second = createTrainingDatabase({ dataDirectory: directory });
  try {
    assert.equal(getTrainingSchemaVersion(second), TRAINING_SCHEMA_VERSION);
    assert.equal(second.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 1);
    assert.equal(await fs.access(path.join(directory, TRAINING_DATABASE_FILENAME)).then(() => true), true);
  } finally {
    second.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

const createLegacyDatabase = async (version) => {
  const directory = await makeDirectory();
  const database = new DatabaseSync(path.join(directory, `legacy-v${version}.sqlite`));
  database.exec(TRAINING_SCHEMA_STATEMENTS.join('\n'));
  database.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  database.prepare('UPDATE collection_metadata SET schema_version = 1 WHERE id = 1').run();

  if (version <= 3) {
    database.exec('DROP INDEX idx_equity_supplements_spot; DROP TABLE equity_supplements;');
    database.exec('ALTER TABLE spots DROP COLUMN source_spot_version_id;');
    database.exec('ALTER TABLE spots DROP COLUMN equity_mode;');
    database.exec('ALTER TABLE sessions DROP COLUMN equity_mode;');
    database.exec('ALTER TABLE refresh_jobs DROP COLUMN job_kind;');
    database.exec('ALTER TABLE attempts DROP COLUMN equity_bucket;');
    database.exec('ALTER TABLE attempts DROP COLUMN equity_grade;');
    database.exec('ALTER TABLE attempts DROP COLUMN action_grade;');
  }
  if (version <= 1) {
    database.exec('ALTER TABLE refresh_jobs DROP COLUMN recovery_count;');
    database.exec('ALTER TABLE refresh_jobs DROP COLUMN last_recovered_at;');
  }

  const history = version === 1 ? [1] : version === 3 ? [1, 3] : [1, 3, 4];
  const insertMigration = database.prepare(
    'INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)',
  );
  history.forEach((migrationVersion) => insertMigration.run(
    migrationVersion,
    `legacy-${migrationVersion}`,
    '2026-08-13T00:00:00.000Z',
  ));
  database.exec(`PRAGMA user_version = ${version};`);
  return { directory, database };
};

test('migracja v1, v3 i v4 doprowadza bazę do pełnego v5 bez pomijania kolumn', async () => {
  for (const version of [1, 3, 4]) {
    const { directory, database } = await createLegacyDatabase(version);
    try {
      assert.equal(getTrainingSchemaVersion(database), version);
      migrateTrainingSchema(database, { now: () => '2026-08-14T00:00:00.000Z' });

      assert.equal(getTrainingSchemaVersion(database), TRAINING_SCHEMA_VERSION);
      assert.equal(database.prepare('PRAGMA user_version').get().user_version, TRAINING_SCHEMA_VERSION);
      assert.equal(
        database.prepare('SELECT schema_version FROM collection_metadata WHERE id = 1').get().schema_version,
        TRAINING_SCHEMA_VERSION,
      );
      assert.deepEqual(
        database.prepare('PRAGMA table_info(attempts)').all().map(({ name }) => name)
          .filter((name) => ['equity_bucket', 'equity_grade', 'action_grade'].includes(name)),
        ['equity_bucket', 'equity_grade', 'action_grade'],
      );
      assert.equal(
        database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'equity_supplements'").get().name,
        'equity_supplements',
      );
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 5').get().count, 1);

      // Drugi przebieg nie dopisuje kolejnej migracji i ponownie naprawia źródła wersji.
      migrateTrainingSchema(database, { now: () => '2026-08-14T00:00:01.000Z' });
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 5').get().count, 1);
      assert.equal(database.prepare('PRAGMA user_version').get().user_version, TRAINING_SCHEMA_VERSION);
    } finally {
      database.close();
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
});
