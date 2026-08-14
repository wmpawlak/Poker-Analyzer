import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { createDatasetRevision } from './dataIndex.js';
import { readCanonicalRecords } from './dataRepository.js';
import {
  getTrainingDatabasePath,
  TRAINING_DATABASE_FILENAME,
  TRAINING_SCHEMA_VERSION,
} from './training/trainingDatabase.js';
import { createTrainingRepository } from './training/trainingRepository.js';
import { TRAINING_EXTRACTOR_VERSION } from './training/spotExtractor.js';

// Historical known-hand spots are bucketed locally during the one-time rescan.
// Flop/turn/river remain exact; pre-flop uses a deterministic sample large
// enough for ten-percent buckets without making the operator wait hours.
export const MIGRATION_EQUITY_SIMULATION_SAMPLES = 5_000;

const REQUIRED_TABLES = [
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
];

const REQUIRED_COLUMNS = {
  collection_metadata: ['schema_version'],
  refresh_jobs: ['recovery_count', 'last_recovered_at', 'job_kind'],
  spots: ['source_spot_version_id', 'equity_mode'],
  sessions: ['equity_mode'],
  attempts: ['equity_bucket', 'equity_grade', 'action_grade'],
  equity_supplements: [
    'spot_version_id',
    'answer_key_id',
    'range_contract_version',
    'calculator_version',
  ],
};

export class TrainingMigrationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TrainingMigrationError';
    this.code = code;
    Object.assign(this, details);
  }
}

const pathExists = async (filePath) => fs.access(filePath).then(() => true, () => false);

const openReadOnlyDatabase = async (databasePath) => {
  const walPath = `${databasePath}-wal`;
  let walSize = 0;
  try {
    walSize = (await fs.stat(walPath)).size;
  } catch {
    // Brak WAL oznacza, że główny plik może zostać odczytany immutable.
  }
  if (walSize === 0) {
    const databaseUrl = pathToFileURL(databasePath);
    databaseUrl.searchParams.set('immutable', '1');
    return new DatabaseSync(databaseUrl.href, { readOnly: true });
  }
  return new DatabaseSync(databasePath, { readOnly: true });
};

const listTables = (database) => new Set(database.prepare(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
).all().map(({ name }) => name));

const listColumns = (database, tableName) => new Set(database.prepare(`PRAGMA table_info(${tableName})`).all()
  .map(({ name }) => name));

const readVersionSources = (database, tables) => ({
  schemaMigrations: tables.has('schema_migrations')
    ? Number(database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get()?.version) || 0
    : 0,
  pragmaUserVersion: Number(database.prepare('PRAGMA user_version').get()?.user_version) || 0,
  collectionMetadata: tables.has('collection_metadata')
    ? Number(database.prepare('SELECT schema_version FROM collection_metadata WHERE id = 1').get()?.schema_version) || 0
    : 0,
});

const readExtractorVersions = (database, tables) => {
  if (!tables.has('sources') || !listColumns(database, 'sources').has('extractor_version')) return {};
  return Object.fromEntries(database.prepare(`
    SELECT COALESCE(extractor_version, '') AS extractor_version, COUNT(*) AS count
    FROM sources
    GROUP BY extractor_version
    ORDER BY extractor_version
  `).all().map(({ extractor_version: version, count }) => [String(version || 'unknown'), Number(count) || 0]));
};

const readCounts = (database, tables) => Object.fromEntries([
  ['sources', 'sources'],
  ['spots', 'spots'],
  ['answerKeys', 'answer_keys'],
  ['equitySupplements', 'equity_supplements'],
  ['selectedSpots', 'selected_spots'],
  ['refreshJobs', 'refresh_jobs'],
  ['sessions', 'sessions'],
  ['attempts', 'attempts'],
].filter(([, table]) => tables.has(table)).map(([key, table]) => [
  key,
  Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count) || 0,
]));

const readSchemaGaps = (database, tables) => {
  const missingTables = REQUIRED_TABLES.filter((table) => !tables.has(table));
  const missingColumns = {};
  Object.entries(REQUIRED_COLUMNS).forEach(([table, columns]) => {
    if (!tables.has(table)) {
      missingColumns[table] = [...columns];
      return;
    }
    const existing = listColumns(database, table);
    const missing = columns.filter((column) => !existing.has(column));
    if (missing.length > 0) missingColumns[table] = missing;
  });
  return { missingTables, missingColumns };
};

const readDatasetState = (database, tables) => ({
  datasetRevision: tables.has('collection_metadata')
    ? database.prepare('SELECT scan_dataset_revision FROM collection_metadata WHERE id = 1').get()?.scan_dataset_revision || null
    : null,
});

const buildRescanReasons = ({ databaseExists, datasetRevision, storedDatasetRevision, extractorVersions }) => {
  const reasons = [];
  if (!databaseExists) reasons.push('database_missing');
  if (storedDatasetRevision !== datasetRevision) reasons.push('dataset_revision_changed');
  Object.entries(extractorVersions).forEach(([version, count]) => {
    if (version !== String(TRAINING_EXTRACTOR_VERSION) && count > 0) {
      reasons.push(`extractor_version_${version || 'unknown'}`);
    }
  });
  return reasons;
};

export const inspectTrainingDatabase = async ({ dataDirectory, datasetRevision, verify = false } = {}) => {
  if (!dataDirectory) throw new TrainingMigrationError('TRAINING_DATA_DIRECTORY_REQUIRED', 'Migrator wymaga katalogu data.');
  const resolvedDataDirectory = path.resolve(dataDirectory);
  const databasePath = getTrainingDatabasePath(resolvedDataDirectory, TRAINING_DATABASE_FILENAME);
  const databaseExists = await pathExists(databasePath);
  const base = {
    databasePath,
    databaseExists,
    target: {
      schemaVersion: TRAINING_SCHEMA_VERSION,
      extractorVersion: TRAINING_EXTRACTOR_VERSION,
    },
    versions: {
      schemaMigrations: 0,
      pragmaUserVersion: 0,
      collectionMetadata: 0,
    },
    schema: { missingTables: [...REQUIRED_TABLES], missingColumns: { ...REQUIRED_COLUMNS } },
    counts: {},
    extractorVersions: {},
    storedDatasetRevision: null,
  };
  if (!databaseExists) {
    const reasons = buildRescanReasons({
      databaseExists,
      datasetRevision,
      storedDatasetRevision: null,
      extractorVersions: {},
    });
    return {
      ...base,
      datasetRevision,
      needsRescan: reasons.length > 0,
      rescanReasons: reasons,
    };
  }

  let database;
  try {
    database = await openReadOnlyDatabase(databasePath);
    const tables = listTables(database);
    const versions = readVersionSources(database, tables);
    const schema = readSchemaGaps(database, tables);
    const extractorVersions = readExtractorVersions(database, tables);
    const storedDatasetRevision = readDatasetState(database, tables).datasetRevision;
    const reasons = buildRescanReasons({
      databaseExists,
      datasetRevision,
      storedDatasetRevision,
      extractorVersions,
    });
    const result = {
      ...base,
      versions,
      schema,
      counts: readCounts(database, tables),
      extractorVersions,
      storedDatasetRevision,
      datasetRevision,
      needsRescan: reasons.length > 0,
      rescanReasons: reasons,
    };
    if (verify) {
      result.integrityCheck = String(database.prepare('PRAGMA integrity_check').get()?.integrity_check || 'unknown');
      result.foreignKeyViolations = database.prepare('PRAGMA foreign_key_check').all().length;
    }
    return result;
  } catch (error) {
    if (error instanceof TrainingMigrationError) throw error;
    throw new TrainingMigrationError(
      'TRAINING_DATABASE_INSPECTION_FAILED',
      'Nie udało się odczytać stanu bazy treningowej.',
      { cause: error },
    );
  } finally {
    try {
      database?.close();
    } catch {
      // Zachowaj pierwotny błąd odczytu.
    }
  }
};

const createDatabaseBackup = async (databasePath, dataDirectory, clock) => {
  if (!await pathExists(databasePath)) return null;
  const backupDirectory = path.join(dataDirectory, '.backups');
  await fs.mkdir(backupDirectory, { recursive: true });
  const stamp = clock().toISOString().replace(/[.:]/g, '-');
  const backupPath = path.join(
    backupDirectory,
    `${path.basename(databasePath)}.${stamp}.${process.pid}.bak`,
  );
  let database;
  let transactionOpen = false;
  try {
    database = new DatabaseSync(databasePath);
    database.exec('PRAGMA wal_checkpoint(TRUNCATE); BEGIN IMMEDIATE;');
    transactionOpen = true;
    await fs.copyFile(databasePath, backupPath);
    database.exec('COMMIT;');
    transactionOpen = false;
    return backupPath;
  } catch (error) {
    if (transactionOpen) {
      try { database.exec('ROLLBACK;'); } catch { /* preserve original error */ }
    }
    await fs.rm(backupPath, { force: true }).catch(() => {});
    throw new TrainingMigrationError(
      'TRAINING_DATABASE_BACKUP_FAILED',
      'Nie udało się utworzyć spójnej kopii bazy treningowej.',
      { cause: error, backupPath },
    );
  } finally {
    try {
      database?.close();
    } catch {
      // Zachowaj pierwotny błąd kopii.
    }
  }
};

const verifyFinalDatabase = async ({ dataDirectory, datasetRevision }) => {
  const report = await inspectTrainingDatabase({ dataDirectory, datasetRevision, verify: true });
  if (report.schema.missingTables.length > 0 || Object.keys(report.schema.missingColumns).length > 0) {
    throw new TrainingMigrationError(
      'TRAINING_SCHEMA_INCOMPLETE',
      'Po migracji baza treningowa nie ma pełnego schematu v5.',
      { report },
    );
  }
  if (report.integrityCheck !== 'ok' || report.foreignKeyViolations !== 0) {
    throw new TrainingMigrationError(
      'TRAINING_DATABASE_INVALID_AFTER_MIGRATION',
      'Po migracji kontrola integralności bazy treningowej nie przeszła pomyślnie.',
      { report },
    );
  }
  if (report.versions.schemaMigrations !== TRAINING_SCHEMA_VERSION
    || report.versions.pragmaUserVersion !== TRAINING_SCHEMA_VERSION
    || report.versions.collectionMetadata !== TRAINING_SCHEMA_VERSION) {
    throw new TrainingMigrationError(
      'TRAINING_SCHEMA_VERSION_MISMATCH',
      'Po migracji źródła wersji schematu nie są zgodne.',
      { report },
    );
  }
  if (report.needsRescan) {
    throw new TrainingMigrationError(
      'TRAINING_RESCAN_INCOMPLETE',
      'Po migracji baza treningowa nadal wymaga reskanu kanonicznych rozdań.',
      { report },
    );
  }
  return report;
};

export const runTrainingMigration = async ({
  dataDirectory,
  mode = 'dry-run',
  clock = () => new Date(),
} = {}) => {
  if (!dataDirectory) throw new TrainingMigrationError('TRAINING_DATA_DIRECTORY_REQUIRED', 'Migrator wymaga katalogu data.');
  if (!['dry-run', 'apply'].includes(mode)) {
    throw new TrainingMigrationError('TRAINING_MIGRATION_MODE_INVALID', 'Migracja obsługuje wyłącznie tryb --dry-run albo --apply.');
  }

  const resolvedDataDirectory = path.resolve(dataDirectory);
  const datasetRevision = await createDatasetRevision(resolvedDataDirectory);
  const before = await inspectTrainingDatabase({
    dataDirectory: resolvedDataDirectory,
    datasetRevision,
  });
  if (mode === 'dry-run') {
    return {
      mode,
      dataDirectory: resolvedDataDirectory,
      ...before,
    };
  }

  const backupPath = await createDatabaseBackup(before.databasePath, resolvedDataDirectory, clock);
  const repository = createTrainingRepository({ dataDirectory: resolvedDataDirectory, clock });
  let scan = null;
  let appliedDatasetRevision = datasetRevision;
  try {
    await repository.getScanState();
    if (before.needsRescan) {
      const records = await readCanonicalRecords(resolvedDataDirectory);
      appliedDatasetRevision = await createDatasetRevision(resolvedDataDirectory);
      if (appliedDatasetRevision !== datasetRevision) {
        throw new TrainingMigrationError(
          'TRAINING_DATASET_CHANGED',
          'Dataset kanoniczny zmienił się podczas przygotowania migracji. Uruchom migrator ponownie.',
        );
      }
      scan = await repository.scanCanonicalHands(records, {
        datasetRevision: appliedDatasetRevision,
        rebuildSelection: false,
        equitySimulationSamples: MIGRATION_EQUITY_SIMULATION_SAMPLES,
      });
    }
  } catch (error) {
    if (error instanceof TrainingMigrationError) throw error;
    throw new TrainingMigrationError(
      'TRAINING_MIGRATION_FAILED',
      'Nie udało się zmigrować i uzupełnić bazy treningowej.',
      { cause: error },
    );
  }

  const after = await verifyFinalDatabase({
    dataDirectory: resolvedDataDirectory,
    datasetRevision: appliedDatasetRevision,
  });
  return {
    mode,
    dataDirectory: resolvedDataDirectory,
    databasePath: before.databasePath,
    backupPath,
    before,
    scan: scan?.result || null,
    after,
  };
};
