import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const RANGE_SETUP_DATABASE_FILENAME = 'poker-range-setups-v1.sqlite';
export const PREFLOP_SETUP_ID = 'preflop-matrix';
export const DEFAULT_PREFLOP_VERSION_ID = `${PREFLOP_SETUP_ID}-v1`;
export const DEFAULT_PREFLOP_VERSION_NAME = 'Open-raise';

const RANGE_RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const RANGE_POSITIONS = ['UTG', 'HJ', 'BTN', 'SB'];
const DEFAULT_RANGE_HANDS = Object.fromEntries(RANGE_RANKS.flatMap((rowRank, rowIndex) => (
  RANGE_RANKS.map((columnRank, columnIndex) => {
    const notation = rowIndex === columnIndex
      ? `${rowRank}${columnRank}`
      : rowIndex < columnIndex
        ? `${rowRank}${columnRank}s`
        : `${columnRank}${rowRank}o`;
    return [notation, Object.fromEntries(RANGE_POSITIONS.map((position) => [position, 0]))];
  })
)));

const cloneHands = (hands) => JSON.parse(JSON.stringify(hands));

const parseStoredSetup = (serializedSetup) => {
  try {
    const setup = JSON.parse(serializedSetup);
    if (!setup || typeof setup !== 'object' || !setup.hands) throw new Error('Invalid setup');
    return setup;
  } catch (cause) {
    const error = new Error('Zapisana konfiguracja zakresów jest uszkodzona.');
    error.code = 'RANGE_SETUP_READ_FAILED';
    error.cause = cause;
    throw error;
  }
};

const getTableColumns = (database, tableName) => database.prepare(`PRAGMA table_info(${tableName})`).all();

const toVersionMeta = (row) => ({
  id: row.id,
  setupId: row.setupId,
  name: row.name,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  revision: row.revision,
});

const toVersionSetup = (row) => ({
  ...toVersionMeta(row),
  hands: parseStoredSetup(row.setupJson).hands,
});

const openDatabase = (dataDirectory, now) => {
  const databasePath = path.join(dataDirectory, RANGE_SETUP_DATABASE_FILENAME);
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS range_setups (
      id TEXT PRIMARY KEY,
      setup_json TEXT,
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      active_version_id TEXT
    );
    CREATE TABLE IF NOT EXISTS range_setup_versions (
      id TEXT PRIMARY KEY,
      setup_id TEXT NOT NULL,
      name TEXT NOT NULL,
      setup_json TEXT NOT NULL CHECK (json_valid(setup_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_range_setup_versions_setup
      ON range_setup_versions (setup_id, created_at DESC);
  `);

  const setupColumns = getTableColumns(database, 'range_setups');
  if (!setupColumns.some((column) => column.name === 'active_version_id')) {
    database.exec('ALTER TABLE range_setups ADD COLUMN active_version_id TEXT');
  }

  const logicalSetup = database.prepare(`
    SELECT id, setup_json AS setupJson, updated_at AS updatedAt, revision,
      active_version_id AS activeVersionId
    FROM range_setups WHERE id = ?
  `).get(PREFLOP_SETUP_ID);
  const existingVersion = database.prepare(`
    SELECT id FROM range_setup_versions WHERE setup_id = ? ORDER BY created_at ASC, id ASC LIMIT 1
  `).get(PREFLOP_SETUP_ID);

  if (!logicalSetup) {
    const timestamp = now();
    const setupJson = JSON.stringify({ hands: cloneHands(DEFAULT_RANGE_HANDS) });
    database.prepare(`
      INSERT INTO range_setups (id, setup_json, updated_at, revision, active_version_id)
      VALUES (?, ?, ?, 1, ?)
    `).run(PREFLOP_SETUP_ID, setupJson, timestamp, DEFAULT_PREFLOP_VERSION_ID);
    database.prepare(`
      INSERT INTO range_setup_versions (id, setup_id, name, setup_json, created_at, updated_at, revision)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(
      DEFAULT_PREFLOP_VERSION_ID,
      PREFLOP_SETUP_ID,
      DEFAULT_PREFLOP_VERSION_NAME,
      setupJson,
      timestamp,
      timestamp,
    );
  } else if (!existingVersion) {
    const legacySetup = logicalSetup.setupJson
      ? parseStoredSetup(logicalSetup.setupJson)
      : { hands: cloneHands(DEFAULT_RANGE_HANDS) };
    const timestamp = logicalSetup.updatedAt || now();
    const setupJson = JSON.stringify({ hands: legacySetup.hands });
    database.prepare(`
      INSERT INTO range_setup_versions (id, setup_id, name, setup_json, created_at, updated_at, revision)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      DEFAULT_PREFLOP_VERSION_ID,
      PREFLOP_SETUP_ID,
      DEFAULT_PREFLOP_VERSION_NAME,
      setupJson,
      timestamp,
      timestamp,
      logicalSetup.revision || 1,
    );
    database.prepare(`
      UPDATE range_setups SET active_version_id = ?, setup_json = ? WHERE id = ?
    `).run(DEFAULT_PREFLOP_VERSION_ID, setupJson, PREFLOP_SETUP_ID);
  } else if (!logicalSetup.activeVersionId) {
    database.prepare(`
      UPDATE range_setups SET active_version_id = ? WHERE id = ?
    `).run(existingVersion.id, PREFLOP_SETUP_ID);
  }

  return database;
};

const withDatabase = (dataDirectory, now, operation) => {
  const database = openDatabase(dataDirectory, now);
  try {
    return operation(database);
  } finally {
    database.close();
  }
};

const selectVersion = (database, versionId) => database.prepare(`
  SELECT id, setup_id AS setupId, name, setup_json AS setupJson,
    created_at AS createdAt, updated_at AS updatedAt, revision
  FROM range_setup_versions
  WHERE setup_id = ? AND id = ?
`).get(PREFLOP_SETUP_ID, versionId);

const selectActiveVersion = (database) => {
  const logicalSetup = database.prepare(`
    SELECT active_version_id AS activeVersionId FROM range_setups WHERE id = ?
  `).get(PREFLOP_SETUP_ID);
  return logicalSetup ? selectVersion(database, logicalSetup.activeVersionId) : null;
};

export const createRangeSetupRepository = ({
  dataDirectory,
  now = () => new Date().toISOString(),
  idFactory = randomUUID,
} = {}) => {
  if (!dataDirectory) throw new Error('Repozytorium zakresów wymaga katalogu danych.');

  return {
    listPreflopVersions: () => withDatabase(dataDirectory, now, (database) => database.prepare(`
      SELECT id, setup_id AS setupId, name, created_at AS createdAt,
        updated_at AS updatedAt, revision
      FROM range_setup_versions
      WHERE setup_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(PREFLOP_SETUP_ID).map(toVersionMeta)),

    getActivePreflopVersionId: () => withDatabase(dataDirectory, now, (database) => (
      database.prepare('SELECT active_version_id AS activeVersionId FROM range_setups WHERE id = ?')
        .get(PREFLOP_SETUP_ID)?.activeVersionId || null
    )),

    getPreflopSetup: (versionId) => withDatabase(dataDirectory, now, (database) => {
      const row = versionId ? selectVersion(database, versionId) : selectActiveVersion(database);
      return row ? toVersionSetup(row) : null;
    }),

    setActivePreflopVersion: (versionId) => withDatabase(dataDirectory, now, (database) => {
      const version = selectVersion(database, versionId);
      if (!version) return null;
      database.prepare('UPDATE range_setups SET active_version_id = ? WHERE id = ?')
        .run(versionId, PREFLOP_SETUP_ID);
      return toVersionSetup(version);
    }),

    savePreflopSetup: (setup) => withDatabase(dataDirectory, now, (database) => {
      const activeVersion = selectActiveVersion(database);
      if (!activeVersion) return null;
      const updatedAt = now();
      const setupJson = JSON.stringify({ hands: setup.hands });
      database.prepare(`
        UPDATE range_setup_versions
        SET setup_json = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND setup_id = ?
      `).run(setupJson, updatedAt, activeVersion.id, PREFLOP_SETUP_ID);
      const saved = selectVersion(database, activeVersion.id);
      database.prepare(`
        UPDATE range_setups SET setup_json = ?, updated_at = ?, revision = ? WHERE id = ?
      `).run(setupJson, updatedAt, saved.revision, PREFLOP_SETUP_ID);
      return toVersionSetup(saved);
    }),

    renamePreflopVersion: (versionId, name) => withDatabase(dataDirectory, now, (database) => {
      const version = selectVersion(database, versionId);
      if (!version) return null;
      database.prepare(`
        UPDATE range_setup_versions
        SET name = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND setup_id = ?
      `).run(name, now(), versionId, PREFLOP_SETUP_ID);
      return toVersionSetup(selectVersion(database, versionId));
    }),

    copyPreflopVersion: (versionId) => withDatabase(dataDirectory, now, (database) => {
      const source = selectVersion(database, versionId);
      if (!source) return null;
      const timestamp = now();
      const copyId = `${PREFLOP_SETUP_ID}-${idFactory()}`;
      const copyName = `Kopia — ${source.name}`;
      database.prepare(`
        INSERT INTO range_setup_versions (id, setup_id, name, setup_json, created_at, updated_at, revision)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run(copyId, PREFLOP_SETUP_ID, copyName, source.setupJson, timestamp, timestamp);
      database.prepare(`
        UPDATE range_setups
        SET active_version_id = ?, setup_json = ?, updated_at = ?, revision = 1
        WHERE id = ?
      `).run(copyId, source.setupJson, timestamp, PREFLOP_SETUP_ID);
      return toVersionSetup(selectVersion(database, copyId));
    }),

    deletePreflopVersion: (versionId) => withDatabase(dataDirectory, now, (database) => {
      const version = selectVersion(database, versionId);
      if (!version) return null;
      const count = database.prepare(
        'SELECT COUNT(*) AS count FROM range_setup_versions WHERE setup_id = ?',
      ).get(PREFLOP_SETUP_ID).count;
      if (count <= 1) {
        const error = new Error('Nie można usunąć ostatniej wersji zakresów.');
        error.code = 'RANGE_VERSION_LAST_CANNOT_DELETE';
        error.status = 409;
        throw error;
      }

      const activeVersionId = database.prepare(
        'SELECT active_version_id AS activeVersionId FROM range_setups WHERE id = ?',
      ).get(PREFLOP_SETUP_ID).activeVersionId;
      database.prepare('DELETE FROM range_setup_versions WHERE id = ? AND setup_id = ?')
        .run(versionId, PREFLOP_SETUP_ID);

      let nextActiveVersionId = activeVersionId;
      if (activeVersionId === versionId) {
        nextActiveVersionId = database.prepare(`
          SELECT id FROM range_setup_versions
          WHERE setup_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `).get(PREFLOP_SETUP_ID).id;
        const nextVersion = selectVersion(database, nextActiveVersionId);
        database.prepare(`
          UPDATE range_setups
          SET active_version_id = ?, setup_json = ?, updated_at = ?, revision = ?
          WHERE id = ?
        `).run(
          nextActiveVersionId,
          nextVersion.setupJson,
          now(),
          nextVersion.revision,
          PREFLOP_SETUP_ID,
        );
      }

      return {
        deletedVersionId: versionId,
        activeVersionId: nextActiveVersionId,
        setup: toVersionSetup(selectVersion(database, nextActiveVersionId)),
      };
    }),
  };
};
