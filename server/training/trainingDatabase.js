import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const TRAINING_SCHEMA_VERSION = 5;
export const TRAINING_COLLECTION_VERSION = 2;
export const TRAINING_DATABASE_FILENAME = 'poker-training-v2.sqlite';
export const TRAINING_MIGRATION_BACKUP_PATTERN = 'poker-training-v1.json.migrated-*';
export const TRAINING_DATABASE_BUSY_TIMEOUT_MS = 5_000;
export const MINIMUM_NODE_MAJOR_VERSION = 24;

const INITIAL_METADATA = `
INSERT OR IGNORE INTO collection_metadata (
  id,
  schema_version,
  collection_version,
  revision,
  selection_strategy,
  selection_strategy_version,
  selection_limit,
  migration_status
) VALUES (1, ${TRAINING_SCHEMA_VERSION}, ${TRAINING_COLLECTION_VERSION}, 0, 'diverse_recent_v1', 'diverse_recent_v1', 100, 'not_started');
`;

const INITIAL_SCHEMA_STATEMENTS = [
  `
CREATE TABLE IF NOT EXISTS collection_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL,
  collection_version INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TEXT,
  selection_strategy TEXT NOT NULL DEFAULT 'diverse_recent_v1',
  selection_strategy_version TEXT NOT NULL DEFAULT 'diverse_recent_v1',
  selection_limit INTEGER NOT NULL DEFAULT 100 CHECK (selection_limit BETWEEN 1 AND 100),
  selected_at TEXT,
  replenishment_disabled INTEGER NOT NULL DEFAULT 0 CHECK (replenishment_disabled IN (0, 1)),
  selection_frozen INTEGER NOT NULL DEFAULT 0 CHECK (selection_frozen IN (0, 1)),
  selection_pool_stats_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(selection_pool_stats_json)),
  scan_last_scanned_at TEXT,
  scan_dataset_revision TEXT,
  scan_last_result_json TEXT CHECK (scan_last_result_json IS NULL OR json_valid(scan_last_result_json)),
  migration_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (migration_status IN ('not_started', 'running', 'completed', 'failed')),
  migration_started_at TEXT,
  migration_completed_at TEXT,
  migration_backup_path TEXT,
  migration_error_json TEXT CHECK (migration_error_json IS NULL OR json_valid(migration_error_json))
);
`,
  `
CREATE TABLE IF NOT EXISTS sources (
  hand_id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  game_type TEXT NOT NULL CHECK (game_type IN ('cash', 'tournament')),
  played_at TEXT,
  status TEXT NOT NULL,
  expected_spot_count INTEGER NOT NULL DEFAULT 0 CHECK (expected_spot_count >= 0),
  observed_spot_count INTEGER NOT NULL DEFAULT 0 CHECK (observed_spot_count >= 0),
  extractor_version TEXT,
  dataset_revision TEXT,
  rejection_json TEXT CHECK (rejection_json IS NULL OR json_valid(rejection_json)),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT,
  scanned_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (hand_id, fingerprint)
);
`,
  `
CREATE TABLE IF NOT EXISTS source_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hand_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  replaced_by_fingerprint TEXT,
  expected_spot_count INTEGER NOT NULL DEFAULT 0 CHECK (expected_spot_count >= 0),
  observed_spot_count INTEGER NOT NULL DEFAULT 0 CHECK (observed_spot_count >= 0),
  extractor_version TEXT,
  dataset_revision TEXT,
  details_json TEXT CHECK (details_json IS NULL OR json_valid(details_json)),
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (hand_id) REFERENCES sources (hand_id) ON DELETE CASCADE
);
`,
  `
CREATE TABLE IF NOT EXISTS spots (
  version_id TEXT PRIMARY KEY,
  spot_id TEXT NOT NULL,
  hand_id TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  source_spot_version_id TEXT,
  equity_mode TEXT,
  exercise_type TEXT NOT NULL,
  game_type TEXT NOT NULL CHECK (game_type IN ('cash', 'tournament')),
  street TEXT,
  stage TEXT,
  scenario TEXT,
  episode_id TEXT,
  sequence_index INTEGER CHECK (sequence_index IS NULL OR sequence_index >= 0),
  sequence_length INTEGER CHECK (sequence_length IS NULL OR sequence_length >= 1),
  uses_historical_line INTEGER NOT NULL DEFAULT 0 CHECK (uses_historical_line IN (0, 1)),
  continuation_notice TEXT,
  source_status TEXT NOT NULL,
  readiness TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  local_validation_version INTEGER NOT NULL DEFAULT 1,
  local_valid INTEGER NOT NULL DEFAULT 0 CHECK (local_valid IN (0, 1)),
  local_validation_error TEXT,
  current_answer_key_id TEXT,
  ai_first_sent_at TEXT,
  ai_first_sent_job_id TEXT,
  question_json TEXT NOT NULL CHECK (json_valid(question_json)),
  answer_options_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(answer_options_json)),
  decision_card_facts_json TEXT CHECK (decision_card_facts_json IS NULL OR json_valid(decision_card_facts_json)),
  historical_answer_json TEXT CHECK (historical_answer_json IS NULL OR json_valid(historical_answer_json)),
  historical_result_json TEXT CHECK (historical_result_json IS NULL OR json_valid(historical_result_json)),
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  played_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT,
  archived_at TEXT,
  archive_reason TEXT,
  FOREIGN KEY (hand_id) REFERENCES sources (hand_id) ON DELETE CASCADE,
  UNIQUE (spot_id, source_fingerprint)
);
`,
  `
CREATE TABLE IF NOT EXISTS refresh_jobs (
  id TEXT PRIMARY KEY,
  job_kind TEXT NOT NULL DEFAULT 'answer_keys',
  status TEXT NOT NULL,
  model_id TEXT,
  contract_version INTEGER,
  batch_size INTEGER CHECK (batch_size IS NULL OR batch_size > 0),
  sample_size INTEGER CHECK (sample_size IS NULL OR sample_size > 0),
  candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  cursor INTEGER NOT NULL DEFAULT 0 CHECK (cursor >= 0),
  attempted_requests INTEGER NOT NULL DEFAULT 0 CHECK (attempted_requests >= 0),
  successful_requests INTEGER NOT NULL DEFAULT 0 CHECK (successful_requests >= 0),
  recovery_count INTEGER NOT NULL DEFAULT 0 CHECK (recovery_count >= 0),
  last_recovered_at TEXT,
  processed_spot_count INTEGER NOT NULL DEFAULT 0 CHECK (processed_spot_count >= 0),
  skipped_spot_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_spot_count >= 0),
  saved_key_count INTEGER NOT NULL DEFAULT 0 CHECK (saved_key_count >= 0),
  ready_key_count INTEGER NOT NULL DEFAULT 0 CHECK (ready_key_count >= 0),
  review_key_count INTEGER NOT NULL DEFAULT 0 CHECK (review_key_count >= 0),
  invalid_key_count INTEGER NOT NULL DEFAULT 0 CHECK (invalid_key_count >= 0),
  unknown_result_count INTEGER NOT NULL DEFAULT 0 CHECK (unknown_result_count >= 0),
  estimated_requests INTEGER NOT NULL DEFAULT 0 CHECK (estimated_requests >= 0),
  stop_requested INTEGER NOT NULL DEFAULT 0 CHECK (stop_requested IN (0, 1)),
  in_flight_json TEXT CHECK (in_flight_json IS NULL OR json_valid(in_flight_json)),
  errors_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(errors_json)),
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  resumed_at TEXT,
  stopped_at TEXT,
  finished_at TEXT
);
`,
  `
CREATE TABLE IF NOT EXISTS refresh_job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT,
  event_type TEXT NOT NULL,
  instance_id TEXT,
  status TEXT,
  cursor INTEGER,
  batch_size INTEGER,
  spot_count INTEGER NOT NULL DEFAULT 0,
  attempted_requests INTEGER,
  successful_requests INTEGER,
  in_flight_spot_count INTEGER NOT NULL DEFAULT 0,
  details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
  created_at TEXT NOT NULL
);
`,
  `
CREATE TABLE IF NOT EXISTS refresh_job_spots (
  job_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  spot_version_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (job_id, position),
  UNIQUE (job_id, spot_version_id),
  FOREIGN KEY (job_id) REFERENCES refresh_jobs (id) ON DELETE CASCADE,
  FOREIGN KEY (spot_version_id) REFERENCES spots (version_id) ON DELETE CASCADE
);
`,
  `
CREATE TABLE IF NOT EXISTS answer_keys (
  id TEXT PRIMARY KEY,
  spot_version_id TEXT NOT NULL,
  refresh_job_id TEXT,
  contract_version INTEGER,
  status TEXT NOT NULL,
  confidence TEXT,
  local_facts_valid INTEGER CHECK (local_facts_valid IS NULL OR local_facts_valid IN (0, 1)),
  historical_only INTEGER NOT NULL DEFAULT 0 CHECK (historical_only IN (0, 1)),
  facts_validation_version INTEGER,
  preferred_answer TEXT,
  hero_hand_json TEXT CHECK (hero_hand_json IS NULL OR json_valid(hero_hand_json)),
  decision_card_facts_json TEXT CHECK (decision_card_facts_json IS NULL OR json_valid(decision_card_facts_json)),
  acceptable_alternatives_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(acceptable_alternatives_json)),
  suggested_sizing_json TEXT CHECK (suggested_sizing_json IS NULL OR json_valid(suggested_sizing_json)),
  model_json TEXT CHECK (model_json IS NULL OR json_valid(model_json)),
  errors_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(errors_json)),
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  rationale TEXT,
  blockers_equity TEXT,
  opponent_range TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  archived_at TEXT,
  archive_reason TEXT,
  FOREIGN KEY (spot_version_id) REFERENCES spots (version_id) ON DELETE CASCADE,
  FOREIGN KEY (refresh_job_id) REFERENCES refresh_jobs (id) ON DELETE SET NULL
);
`,
  `
CREATE TABLE IF NOT EXISTS equity_supplements (
  id TEXT PRIMARY KEY,
  spot_version_id TEXT NOT NULL,
  answer_key_id TEXT NOT NULL,
  range_contract_version INTEGER NOT NULL,
  calculator_version TEXT NOT NULL,
  opponent_range_json TEXT NOT NULL CHECK (json_valid(opponent_range_json)),
  equity_result_json TEXT NOT NULL CHECK (json_valid(equity_result_json)),
  model_json TEXT CHECK (model_json IS NULL OR json_valid(model_json)),
  created_at TEXT NOT NULL,
  stale_at TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  FOREIGN KEY (spot_version_id) REFERENCES spots (version_id) ON DELETE CASCADE,
  FOREIGN KEY (answer_key_id) REFERENCES answer_keys (id) ON DELETE CASCADE,
  UNIQUE (spot_version_id, answer_key_id)
);
`,
  `
CREATE TABLE IF NOT EXISTS selected_spots (
  exercise_type TEXT NOT NULL,
  game_type TEXT NOT NULL CHECK (game_type IN ('cash', 'tournament')),
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 99),
  spot_version_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  selected_at TEXT NOT NULL,
  PRIMARY KEY (exercise_type, game_type, position),
  UNIQUE (exercise_type, game_type, spot_version_id),
  FOREIGN KEY (spot_version_id) REFERENCES spots (version_id) ON DELETE CASCADE
);
`,
  `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  exercise_type TEXT NOT NULL,
  game_type TEXT NOT NULL,
  equity_mode TEXT,
  requested_size TEXT NOT NULL,
  target_size INTEGER NOT NULL DEFAULT 0 CHECK (target_size >= 0),
  status TEXT NOT NULL,
  current_position INTEGER CHECK (current_position IS NULL OR current_position >= 0),
  current_spot_version_id TEXT,
  last_spot_version_id TEXT,
  score_correct INTEGER NOT NULL DEFAULT 0 CHECK (score_correct >= 0),
  score_acceptable INTEGER NOT NULL DEFAULT 0 CHECK (score_acceptable >= 0),
  score_incorrect INTEGER NOT NULL DEFAULT 0 CHECK (score_incorrect >= 0),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  abandoned_at TEXT,
  FOREIGN KEY (current_spot_version_id) REFERENCES spots (version_id) ON DELETE SET NULL,
  FOREIGN KEY (last_spot_version_id) REFERENCES spots (version_id) ON DELETE SET NULL
);
`,
  `
CREATE TABLE IF NOT EXISTS session_spots (
  session_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  spot_version_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'current', 'answered', 'skipped')),
  answered_at TEXT,
  PRIMARY KEY (session_id, position),
  UNIQUE (session_id, spot_version_id),
  FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE,
  FOREIGN KEY (spot_version_id) REFERENCES spots (version_id) ON DELETE RESTRICT
);
`,
  `
CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  spot_version_id TEXT,
  answer_key_id TEXT,
  answer TEXT,
  equity_bucket TEXT,
  grade TEXT CHECK (grade IS NULL OR grade IN ('correct', 'acceptable', 'incorrect')),
  equity_grade TEXT CHECK (equity_grade IS NULL OR equity_grade IN ('correct', 'acceptable', 'incorrect')),
  action_grade TEXT CHECK (action_grade IS NULL OR action_grade IN ('correct', 'acceptable', 'incorrect')),
  feedback_json TEXT CHECK (feedback_json IS NULL OR json_valid(feedback_json)),
  answered_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE,
  FOREIGN KEY (spot_version_id) REFERENCES spots (version_id) ON DELETE RESTRICT,
  FOREIGN KEY (answer_key_id) REFERENCES answer_keys (id) ON DELETE SET NULL
);
`,
  `
CREATE TABLE IF NOT EXISTS audit_exclusions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hand_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  reason TEXT NOT NULL,
  excluded_at TEXT NOT NULL,
  UNIQUE (hand_id, fingerprint)
);
`,
  INITIAL_METADATA,
  `
CREATE INDEX IF NOT EXISTS idx_spots_exercise_game_active
  ON spots (exercise_type, game_type, active);
CREATE INDEX IF NOT EXISTS idx_spots_exercise_type ON spots (exercise_type);
CREATE INDEX IF NOT EXISTS idx_spots_game_type ON spots (game_type);
CREATE INDEX IF NOT EXISTS idx_spots_active ON spots (active);
CREATE INDEX IF NOT EXISTS idx_spots_readiness ON spots (readiness);
CREATE INDEX IF NOT EXISTS idx_spots_source_status ON spots (source_status);
CREATE INDEX IF NOT EXISTS idx_spots_refresh_candidates
  ON spots (source_status, readiness, local_valid, ai_first_sent_at, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_spots_played_at ON spots (played_at);
CREATE INDEX IF NOT EXISTS idx_spots_hand_id ON spots (hand_id);
CREATE INDEX IF NOT EXISTS idx_spots_source_fingerprint ON spots (source_fingerprint);

CREATE INDEX IF NOT EXISTS idx_answer_keys_spot_version_created
  ON answer_keys (spot_version_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_answer_keys_status ON answer_keys (status);
CREATE INDEX IF NOT EXISTS idx_answer_keys_refresh_job ON answer_keys (refresh_job_id);
CREATE INDEX IF NOT EXISTS idx_equity_supplements_spot ON equity_supplements (spot_version_id, stale_at);

CREATE INDEX IF NOT EXISTS idx_sources_status ON sources (status);
CREATE INDEX IF NOT EXISTS idx_sources_fingerprint ON sources (fingerprint);
CREATE INDEX IF NOT EXISTS idx_sources_played_at ON sources (played_at);
CREATE INDEX IF NOT EXISTS idx_source_history_hand_id ON source_history (hand_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_history_fingerprint ON source_history (fingerprint);

CREATE INDEX IF NOT EXISTS idx_selected_spots_spot_version ON selected_spots (spot_version_id);
CREATE INDEX IF NOT EXISTS idx_selected_spots_active_pool
  ON selected_spots (exercise_type, game_type, active, position);

CREATE INDEX IF NOT EXISTS idx_refresh_jobs_status_updated
  ON refresh_jobs (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_refresh_job_events_job_created
  ON refresh_job_events (job_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_refresh_job_spots_spot_version
  ON refresh_job_spots (spot_version_id);

CREATE INDEX IF NOT EXISTS idx_sessions_status_updated
  ON sessions (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_exercise_game
  ON sessions (exercise_type, game_type, status);
CREATE INDEX IF NOT EXISTS idx_session_spots_spot_version
  ON session_spots (spot_version_id);
CREATE INDEX IF NOT EXISTS idx_session_spots_session_position
  ON session_spots (session_id, position);

CREATE INDEX IF NOT EXISTS idx_attempts_session_answered
  ON attempts (session_id, answered_at DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_spot_version_answered
  ON attempts (spot_version_id, answered_at DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_grade_answered
  ON attempts (grade, answered_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_exclusions_hand_id
  ON audit_exclusions (hand_id);
CREATE INDEX IF NOT EXISTS idx_audit_exclusions_fingerprint
  ON audit_exclusions (fingerprint);
`,
  `
CREATE TRIGGER IF NOT EXISTS trg_selected_spots_validate_insert
BEFORE INSERT ON selected_spots
BEGIN
  SELECT CASE WHEN NEW.active <> 1
    THEN RAISE(ABORT, 'selected_spots must contain active spots') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM spots
    WHERE version_id = NEW.spot_version_id
      AND source_status = 'current'
      AND exercise_type = NEW.exercise_type
      AND game_type = NEW.game_type
  ) THEN RAISE(ABORT, 'selected_spots references a non-active spot') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_selected_spots_validate_update
BEFORE UPDATE OF exercise_type, game_type, position, spot_version_id, active ON selected_spots
BEGIN
  SELECT CASE WHEN NEW.active <> 1
    THEN RAISE(ABORT, 'selected_spots must contain active spots') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM spots
    WHERE version_id = NEW.spot_version_id
      AND source_status = 'current'
      AND exercise_type = NEW.exercise_type
      AND game_type = NEW.game_type
  ) THEN RAISE(ABORT, 'selected_spots references a non-active spot') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_spots_remove_inactive_selection
AFTER UPDATE OF source_status ON spots
WHEN NEW.source_status <> 'current'
BEGIN
  DELETE FROM selected_spots WHERE spot_version_id = NEW.version_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_spots_current_key_exists
BEFORE UPDATE OF current_answer_key_id ON spots
WHEN NEW.current_answer_key_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM answer_keys WHERE id = NEW.current_answer_key_id AND spot_version_id = NEW.version_id
  )
BEGIN
  SELECT RAISE(ABORT, 'spots.current_answer_key_id references a different answer key');
END;

CREATE TRIGGER IF NOT EXISTS trg_spots_current_key_exists_insert
BEFORE INSERT ON spots
WHEN NEW.current_answer_key_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM answer_keys WHERE id = NEW.current_answer_key_id AND spot_version_id = NEW.version_id
  )
BEGIN
  SELECT RAISE(ABORT, 'spots.current_answer_key_id references a different answer key');
END;

CREATE TRIGGER IF NOT EXISTS trg_answer_keys_clear_current_key
AFTER DELETE ON answer_keys
BEGIN
  UPDATE spots SET current_answer_key_id = NULL
  WHERE current_answer_key_id = OLD.id;
END;
`,
];

const asPositiveInteger = (value, fallback) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
};

const assertSupportedNode = () => {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (!Number.isInteger(major) || major < MINIMUM_NODE_MAJOR_VERSION) {
    throw new TrainingDatabaseError(
      'TRAINING_NODE_VERSION_UNSUPPORTED',
      `Moduł ćwiczeń SQLite wymaga Node.js ${MINIMUM_NODE_MAJOR_VERSION} lub nowszego.`,
    );
  }
};

export class TrainingDatabaseError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TrainingDatabaseError';
    this.code = code;
    Object.assign(this, details);
  }
}

const getDataDirectory = (dataDirectory) => {
  if (!dataDirectory || typeof dataDirectory !== 'string') {
    throw new TrainingDatabaseError(
      'TRAINING_DATA_DIRECTORY_REQUIRED',
      'Baza ćwiczeń SQLite wymaga katalogu danych.',
    );
  }
  return path.resolve(dataDirectory);
};

export const getTrainingDatabasePath = (dataDirectory, filename = TRAINING_DATABASE_FILENAME) => {
  const directory = getDataDirectory(dataDirectory);
  const normalizedFilename = String(filename || '').trim();
  if (!normalizedFilename || path.basename(normalizedFilename) !== normalizedFilename) {
    throw new TrainingDatabaseError(
      'TRAINING_DATABASE_PATH_INVALID',
      'Nazwa pliku bazy ćwiczeń musi wskazywać plik w katalogu danych.',
    );
  }
  const databasePath = path.resolve(directory, normalizedFilename);
  if (!databasePath.startsWith(`${directory}${path.sep}`)) {
    throw new TrainingDatabaseError(
      'TRAINING_DATABASE_PATH_INVALID',
      'Plik bazy ćwiczeń znajduje się poza katalogiem danych.',
    );
  }
  return databasePath;
};

export const configureTrainingDatabase = (database, {
  busyTimeoutMs = TRAINING_DATABASE_BUSY_TIMEOUT_MS,
} = {}) => {
  if (!database || typeof database.exec !== 'function' || typeof database.prepare !== 'function') {
    throw new TrainingDatabaseError(
      'TRAINING_DATABASE_INVALID',
      'Konfiguracja SQLite wymaga otwartej bazy DatabaseSync.',
    );
  }
  const timeout = asPositiveInteger(busyTimeoutMs, TRAINING_DATABASE_BUSY_TIMEOUT_MS);
  database.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = ${timeout};`);
  const foreignKeys = database.prepare('PRAGMA foreign_keys').get()?.foreign_keys;
  const journalMode = String(database.prepare('PRAGMA journal_mode').get()?.journal_mode || '').toLowerCase();
  const effectiveBusyTimeout = database.prepare('PRAGMA busy_timeout').get()?.timeout;
  if (foreignKeys !== 1) {
    throw new TrainingDatabaseError(
      'TRAINING_DATABASE_FOREIGN_KEYS_FAILED',
      'Nie udało się włączyć kontroli kluczy obcych SQLite.',
    );
  }
  return {
    foreignKeys: foreignKeys === 1,
    journalMode,
    busyTimeoutMs: Number(effectiveBusyTimeout) || timeout,
  };
};

const getTableColumns = (database, tableName) => database.prepare(`PRAGMA table_info(${tableName})`).all()
  .map(({ name }) => name);

const ensureColumn = (database, tableName, columnName, definition) => {
  if (!getTableColumns(database, tableName).includes(columnName)) {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
  }
};

const getSchemaVersionSources = (database) => {
  const migrationTable = database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  ).get();
  const migrationVersion = migrationTable
    ? Number(database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get()?.version) || 0
    : 0;
  const pragmaVersion = Number(database.prepare('PRAGMA user_version').get()?.user_version) || 0;
  const metadataTable = database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'collection_metadata'",
  ).get();
  const metadataVersion = metadataTable
    ? Number(database.prepare('SELECT schema_version FROM collection_metadata WHERE id = 1').get()?.schema_version) || 0
    : 0;
  return {
    migrationVersion,
    pragmaVersion,
    metadataVersion,
  };
};

const getStoredSchemaVersion = (database) => getSchemaVersionSources(database).migrationVersion;

export const getTrainingSchemaVersion = (database) => getStoredSchemaVersion(database);

const ensureFinalSchema = (database) => {
  database.exec(INITIAL_SCHEMA_STATEMENTS.join('\n'));

  // These columns were introduced by intermediate migrations. Check each one
  // independently so a database that skipped an intermediate version still
  // reaches the complete current shape.
  ensureColumn(database, 'refresh_jobs', 'recovery_count', 'INTEGER NOT NULL DEFAULT 0 CHECK (recovery_count >= 0)');
  ensureColumn(database, 'refresh_jobs', 'last_recovered_at', 'TEXT');
  ensureColumn(database, 'refresh_jobs', 'job_kind', "TEXT NOT NULL DEFAULT 'answer_keys'");
  ensureColumn(database, 'spots', 'source_spot_version_id', 'TEXT');
  ensureColumn(database, 'spots', 'equity_mode', 'TEXT');
  ensureColumn(database, 'sessions', 'equity_mode', 'TEXT');
  ensureColumn(database, 'attempts', 'equity_bucket', 'TEXT');
  ensureColumn(database, 'attempts', 'equity_grade', "TEXT CHECK (equity_grade IS NULL OR equity_grade IN ('correct', 'acceptable', 'incorrect'))");
  ensureColumn(database, 'attempts', 'action_grade', "TEXT CHECK (action_grade IS NULL OR action_grade IN ('correct', 'acceptable', 'incorrect'))");
};

export const migrateTrainingSchema = (database, { now = () => new Date().toISOString() } = {}) => {
  if (!database || typeof database.exec !== 'function' || typeof database.prepare !== 'function') {
    throw new TrainingDatabaseError(
      'TRAINING_DATABASE_INVALID',
      'Migracja schematu wymaga otwartej bazy DatabaseSync.',
    );
  }
  try {
    database.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    const versions = getSchemaVersionSources(database);
    const currentVersion = Math.max(
      versions.migrationVersion,
      versions.pragmaVersion,
      versions.metadataVersion,
    );
    if (currentVersion > TRAINING_SCHEMA_VERSION) {
      throw new TrainingDatabaseError(
        'TRAINING_SCHEMA_VERSION_UNSUPPORTED',
        `Baza ćwiczeń używa nowszego schematu (${currentVersion}). Obsługiwany jest ${TRAINING_SCHEMA_VERSION}.`,
      );
    }
    ensureFinalSchema(database);
    if (versions.migrationVersion < TRAINING_SCHEMA_VERSION) {
      database.prepare(
        'INSERT OR IGNORE INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)',
      ).run(TRAINING_SCHEMA_VERSION, 'Equity answer buckets and separate action/equity grades', now());
    }
    database.prepare('UPDATE collection_metadata SET schema_version = ? WHERE id = 1')
      .run(TRAINING_SCHEMA_VERSION);
    database.exec(`PRAGMA user_version = ${TRAINING_SCHEMA_VERSION};`);
    database.exec('COMMIT;');
    return getStoredSchemaVersion(database);
  } catch (error) {
    try {
      database.exec('ROLLBACK;');
    } catch {
      // Zachowaj pierwotny błąd migracji.
    }
    if (error instanceof TrainingDatabaseError) throw error;
    throw new TrainingDatabaseError(
      'TRAINING_SCHEMA_MIGRATION_FAILED',
      'Nie udało się utworzyć schematu bazy ćwiczeń SQLite.',
      { cause: error },
    );
  }
};

export const createTrainingDatabase = ({
  dataDirectory,
  filename = TRAINING_DATABASE_FILENAME,
  busyTimeoutMs = TRAINING_DATABASE_BUSY_TIMEOUT_MS,
  migrate = true,
  now,
} = {}) => {
  assertSupportedNode();
  const databasePath = getTrainingDatabasePath(dataDirectory, filename);
  mkdirSync(path.dirname(databasePath), { recursive: true });
  let database;
  try {
    database = new DatabaseSync(databasePath);
    configureTrainingDatabase(database, { busyTimeoutMs });
    if (migrate) migrateTrainingSchema(database, { now });
    return database;
  } catch (error) {
    try {
      database?.close();
    } catch {
      // Nie zasłaniaj błędu otwarcia lub migracji.
    }
    if (error instanceof TrainingDatabaseError) throw error;
    throw new TrainingDatabaseError(
      'TRAINING_DATABASE_OPEN_FAILED',
      'Nie udało się otworzyć bazy ćwiczeń SQLite.',
      { databasePath, cause: error },
    );
  }
};

export const TRAINING_SCHEMA_STATEMENTS = Object.freeze([...INITIAL_SCHEMA_STATEMENTS]);
