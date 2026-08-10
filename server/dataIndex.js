import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gunzip, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { Worker } from 'node:worker_threads';
import { PARSER_VERSION, parseSingleRawHand } from '../src/parser/pokerParser.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
export const DATA_INDEX_CACHE_VERSION = 1;
const JSONL_FILE_PATTERN = /^(cash|tournament)-\d{4}\.jsonl$/;

export class DataIndexError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DataIndexError';
    this.code = code;
  }
}

const getCachePath = (dataDirectory) => path.join(
  dataDirectory,
  '.cache',
  `poker-index-v${DATA_INDEX_CACHE_VERSION}.json.gz`,
);

const listCanonicalFileNames = async (dataDirectory) => {
  const handsDirectory = path.join(dataDirectory, 'poker', 'hands');
  let entries;
  try {
    entries = await fs.readdir(handsDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && JSONL_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
};

export const createDatasetRevision = async (dataDirectory) => {
  const fileNames = await listCanonicalFileNames(dataDirectory);
  const digest = createHash('sha256').update(`parser:${PARSER_VERSION}\n`);
  for (const fileName of fileNames) {
    const content = await fs.readFile(path.join(dataDirectory, 'poker', 'hands', fileName));
    digest.update(fileName).update('\n').update(content).update('\n');
  }
  return `p${PARSER_VERSION}-${digest.digest('hex')}`;
};

const containsRawText = (value) => {
  if (Array.isArray(value)) return value.some(containsRawText);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => key === 'rawText' || containsRawText(child));
};

const readCache = async (cachePath, datasetRevision) => {
  let compressed;
  try {
    compressed = await fs.readFile(cachePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  try {
    const cached = JSON.parse((await gunzipAsync(compressed)).toString('utf8'));
    if (cached?.formatVersion !== DATA_INDEX_CACHE_VERSION
      || cached?.parserVersion !== PARSER_VERSION
      || cached?.datasetRevision !== datasetRevision
      || !Array.isArray(cached?.hands)
      || !cached?.sessions
      || containsRawText(cached)) {
      return null;
    }
    return cached;
  } catch {
    return null;
  }
};

const writeCache = async (cachePath, index) => {
  const compressed = await gzipAsync(JSON.stringify(index));
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(cachePath),
    `.${path.basename(cachePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(temporaryPath, compressed);
    await fs.rename(temporaryPath, cachePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
};

const createRuntimeSnapshot = (index) => ({
  ...index,
  handsById: new Map(index.hands.map((hand) => [String(hand.id), hand])),
  sessionsById: new Map([
    ...(index.sessions?.cash || []),
    ...(index.sessions?.tournament || []),
  ].map((session) => [String(session.id), session])),
});

const runIndexWorker = ({ dataDirectory, datasetRevision, onProgress }) => new Promise((resolve, reject) => {
  const worker = new Worker(new URL('./dataIndexWorker.js', import.meta.url), {
    workerData: {
      dataDirectory,
      datasetRevision,
      formatVersion: DATA_INDEX_CACHE_VERSION,
      parserVersion: PARSER_VERSION,
    },
  });
  let finished = false;
  worker.on('message', (message) => {
    if (message?.type === 'progress') {
      onProgress(message);
      return;
    }
    if (message?.type === 'complete') {
      finished = true;
      resolve(message.index);
      return;
    }
    if (message?.type === 'error') {
      finished = true;
      reject(new DataIndexError('DATA_INDEX_BUILD_FAILED', message.error));
    }
  });
  worker.once('error', (error) => {
    if (!finished) reject(new DataIndexError('DATA_INDEX_WORKER_ERROR', error.message));
  });
  worker.once('exit', (code) => {
    if (!finished && code !== 0) {
      reject(new DataIndexError('DATA_INDEX_WORKER_EXIT', `Worker indeksu zakończył się kodem ${code}.`));
    }
  });
});

export const createDataIndex = ({ dataDirectory, logger = console } = {}) => {
  if (!dataDirectory) throw new DataIndexError('DATA_DIRECTORY_REQUIRED', 'Indeks danych wymaga katalogu data.');
  const resolvedDataDirectory = path.resolve(dataDirectory);
  const cachePath = getCachePath(resolvedDataDirectory);
  let snapshot = null;
  let refreshPromise = null;
  let status = {
    phase: 'idle',
    current: 0,
    total: 0,
    datasetRevision: null,
    activeRevision: null,
    error: null,
  };

  const updateStatus = (changes) => {
    status = { ...status, ...changes, activeRevision: snapshot?.datasetRevision || null };
  };

  const refreshForRevision = async (datasetRevision) => {
    if (snapshot?.datasetRevision === datasetRevision) return snapshot;
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
      updateStatus({
        phase: 'loading-cache',
        current: 0,
        total: 0,
        datasetRevision,
        error: null,
      });
      const cached = await readCache(cachePath, datasetRevision);
      if (cached) {
        snapshot = createRuntimeSnapshot(cached);
        updateStatus({ phase: 'ready', current: 1, total: 1, error: null });
        return snapshot;
      }

      updateStatus({ phase: 'scanning', current: 0, total: 0, error: null });
      const built = await runIndexWorker({
        dataDirectory: resolvedDataDirectory,
        datasetRevision,
        onProgress: ({ phase, current, total }) => updateStatus({ phase, current, total }),
      });
      if (containsRawText(built)) {
        throw new DataIndexError('DATA_INDEX_CONTAINS_RAW_TEXT', 'Cache indeksu zawiera niedozwolony rawText.');
      }
      await writeCache(cachePath, built);
      snapshot = createRuntimeSnapshot(built);
      updateStatus({ phase: 'ready', current: 1, total: 1, error: null });
      return snapshot;
    })().catch((error) => {
      logger?.error?.('Nie udało się przebudować indeksu danych:', error?.message);
      updateStatus({ phase: 'failed', error: error?.message || 'Nie udało się zbudować indeksu danych.' });
      if (snapshot) return snapshot;
      throw error;
    }).finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  };

  const start = async () => {
    if (!snapshot && !refreshPromise && status.phase === 'idle') {
      updateStatus({ phase: 'scanning', current: 0, total: 0, error: null });
    }
    const revision = await createDatasetRevision(resolvedDataDirectory);
    return refreshForRevision(revision);
  };

  const getSnapshot = async () => {
    const revision = await createDatasetRevision(resolvedDataDirectory);
    if (snapshot?.datasetRevision === revision) return snapshot;
    const refresh = refreshForRevision(revision);
    return snapshot || refresh;
  };

  const getStatus = () => ({ ...status, activeRevision: snapshot?.datasetRevision || null });

  const readHand = async (handId) => {
    const current = await getSnapshot();
    const indexedHand = current.handsById.get(String(handId));
    if (!indexedHand) return null;
    const location = indexedHand.location;
    const handsDirectory = path.resolve(resolvedDataDirectory, 'poker', 'hands');
    const filePath = path.resolve(resolvedDataDirectory, location?.file || '');
    if (!location || !Number.isInteger(location.line)
      || !filePath.startsWith(`${handsDirectory}${path.sep}`)) {
      throw new DataIndexError('INVALID_HAND_LOCATION', `Nieprawidłowa lokalizacja rozdania #${handId}.`);
    }
    const lines = (await fs.readFile(filePath, 'utf8')).split('\n');
    const line = lines[location.line - 1];
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      throw new DataIndexError('INVALID_HAND_LOCATION', `Nie można odczytać rozdania #${handId}.`);
    }
    if (String(record.handId) !== String(handId)) {
      throw new DataIndexError('HAND_LOCATION_STALE', `Lokalizacja rozdania #${handId} jest nieaktualna.`);
    }
    const parsed = parseSingleRawHand(record.rawText);
    if (!parsed.hand) {
      throw new DataIndexError('HAND_PARSE_FAILED', `Nie można sparsować rozdania #${handId}.`);
    }
    return { datasetRevision: current.datasetRevision, hand: parsed.hand };
  };

  return Object.freeze({
    start,
    getSnapshot,
    getStatus,
    readHand,
  });
};
