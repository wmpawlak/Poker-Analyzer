import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseHandHistoryDocument } from '../src/parser/pokerParser.js';
import {
  invalidateAiAnalysesForReplacedHand,
  readAiAnalysesCache,
  writeAiAnalysesCache,
} from './aiAnalysesCache.js';
import { createImportId } from './dataImportService.js';
import { createDataIndex } from './dataIndex.js';
import { createDataRepository } from './dataRepository.js';

export class DataHandReplacementError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DataHandReplacementError';
    this.code = code;
  }
}

const asString = (value) => String(value ?? '').trim();

const findReplacementCandidate = ({ handId, content }) => {
  const normalizedHandId = asString(handId);
  if (!normalizedHandId) {
    throw new DataHandReplacementError('HAND_ID_REQUIRED', 'Zastąpienie wymaga --hand-id.');
  }
  const parsed = parseHandHistoryDocument(content);
  if (parsed.issues.length > 0 || parsed.validHands.length !== 1) {
    throw new DataHandReplacementError(
      'REPLACEMENT_SOURCE_INVALID',
      'Plik zastępczy musi zawierać dokładnie jedno poprawne rozdanie i żadnych błędnych sekcji.',
    );
  }
  const candidate = parsed.validHands[0];
  if (String(candidate.hand.id) !== normalizedHandId) {
    throw new DataHandReplacementError(
      'REPLACEMENT_HAND_ID_MISMATCH',
      `Plik zastępczy zawiera rozdanie #${candidate.hand.id}, oczekiwano #${normalizedHandId}.`,
    );
  }
  return candidate;
};

const buildSessionFingerprints = (snapshot) => new Map([
  ...(snapshot.sessions?.cash || []),
  ...(snapshot.sessions?.tournament || []),
].map((session) => [String(session.id), session.fingerprint]));

export const runDataHandReplacement = async ({
  dataDirectory,
  handId,
  filePath,
  mode = 'dry-run',
  logger = console,
} = {}) => {
  if (!dataDirectory) {
    throw new DataHandReplacementError('DATA_DIRECTORY_REQUIRED', 'Zastąpienie wymaga katalogu data.');
  }
  if (!['dry-run', 'apply'].includes(mode)) {
    throw new DataHandReplacementError('MODE_INVALID', 'Dostępne są wyłącznie tryby --dry-run oraz --apply.');
  }
  const resolvedFilePath = path.resolve(asString(filePath));
  if (!asString(filePath) || path.extname(resolvedFilePath).toLowerCase() !== '.txt') {
    throw new DataHandReplacementError('REPLACEMENT_FILE_REQUIRED', 'Zastąpienie wymaga pliku TXT przekazanego przez --file.');
  }

  let content;
  try {
    content = await fs.readFile(resolvedFilePath, 'utf8');
  } catch (error) {
    throw new DataHandReplacementError(
      'REPLACEMENT_FILE_READ_FAILED',
      `Nie udało się odczytać pliku zastępczego: ${error.message}`,
    );
  }
  const candidate = findReplacementCandidate({ handId, content });
  const repository = createDataRepository({ dataDirectory });
  const options = {
    handId,
    candidate,
    importId: createImportId(content),
  };
  const preview = await repository.previewHandReplacement(options);
  if (mode === 'dry-run' || !preview.changed) {
    return {
      mode,
      replacement: preview,
      analyses: {
        handReportsRemoved: 0,
        sessionReportsRemoved: 0,
        groupReportsRemoved: 0,
        removed: 0,
        preserved: null,
      },
      datasetRevision: null,
    };
  }

  const replacement = await repository.replaceHand(options);
  const dataIndex = createDataIndex({ dataDirectory, logger });
  const snapshot = await dataIndex.start();
  const existingCache = await readAiAnalysesCache(dataDirectory);
  const invalidated = invalidateAiAnalysesForReplacedHand(existingCache, {
    handId,
    sessionFingerprints: buildSessionFingerprints(snapshot),
  });
  if (invalidated.counts.removed > 0) {
    await writeAiAnalysesCache({
      ...invalidated.cache,
      updatedAt: new Date().toISOString(),
    }, dataDirectory);
  }
  return {
    mode,
    replacement,
    analyses: invalidated.counts,
    datasetRevision: snapshot.datasetRevision,
  };
};
