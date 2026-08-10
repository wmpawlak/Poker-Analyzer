import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { normalizeRawHandText } from '../src/parser/pokerParser.js';

export const DATA_RECORD_VERSION = 1;
export const POKER_GAME_TYPES = Object.freeze({
  CASH: 'cash',
  TOURNAMENT: 'tournament',
});

const JSONL_FILE_PATTERN = /^(cash|tournament)-(\d{4})\.jsonl$/;

export class DataRepositoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DataRepositoryError';
    this.code = code;
  }
}

const asNonEmptyString = (value) => String(value ?? '').trim();

const normalizeGameType = (candidate) => {
  const source = candidate || {};
  const value = asNonEmptyString(source.gameType || source.hand?.gameType).toLowerCase();
  if (value === POKER_GAME_TYPES.CASH || value === 'cash game') return POKER_GAME_TYPES.CASH;
  if (value === POKER_GAME_TYPES.TOURNAMENT || value === 'tourney' || value === 'tournament') {
    return POKER_GAME_TYPES.TOURNAMENT;
  }
  return source.isTournament || source.hand?.isTournament
    ? POKER_GAME_TYPES.TOURNAMENT
    : POKER_GAME_TYPES.CASH;
};

const normalizePlayedAt = (value) => {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new DataRepositoryError('INVALID_PLAYED_AT', 'Rozdanie nie ma poprawnej daty rozegrania.');
  }
  return parsed.toISOString();
};

const parseJsonlLine = (line, sourcePath, lineNumber) => {
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    throw new DataRepositoryError(
      'INVALID_JSONL',
      `Nieprawidłowy JSONL w ${sourcePath} (linia ${lineNumber}).`,
    );
  }

  if (!asNonEmptyString(record?.handId) || !asNonEmptyString(record?.contentHash)) {
    throw new DataRepositoryError(
      'INVALID_JSONL_RECORD',
      `Rekord JSONL w ${sourcePath} (linia ${lineNumber}) nie ma handId albo contentHash.`,
    );
  }
  return record;
};

const readJsonl = async (filePath) => {
  const content = await fs.readFile(filePath, 'utf8');
  const records = [];
  content.split('\n').forEach((line, index) => {
    if (!line.trim()) return;
    records.push(parseJsonlLine(line, filePath, index + 1));
  });
  return records;
};

const getCanonicalHandFiles = async (handsDirectory) => {
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

const getRepositoryPaths = (dataDirectory) => {
  if (!dataDirectory) {
    throw new DataRepositoryError('DATA_DIRECTORY_REQUIRED', 'Repozytorium wymaga katalogu data.');
  }
  const rootDirectory = path.resolve(dataDirectory, 'poker');
  return {
    rootDirectory,
    handsDirectory: path.join(rootDirectory, 'hands'),
  };
};

const getCandidateYear = (candidate, playedAt) => {
  const hand = candidate?.hand || candidate || {};
  const sourceDate = candidate?.playedAt ?? hand.dateStr ?? hand.playedAt;
  const sourceYear = String(sourceDate ?? '').match(/^(\d{4})/);
  if (sourceYear) return Number(sourceYear[1]);
  return new Date(playedAt).getUTCFullYear();
};

const getJsonlFilePath = (handsDirectory, gameType, year) => {
  return path.join(handsDirectory, `${gameType}-${year}.jsonl`);
};

const createRecord = (candidate, importId) => {
  const hand = candidate?.hand || candidate || {};
  const handId = asNonEmptyString(candidate?.handId || hand.id);
  if (!handId) {
    throw new DataRepositoryError('INVALID_HAND_ID', 'Nie można zapisać rozdania bez handId.');
  }

  const rawText = normalizeRawHandText(candidate?.rawText ?? hand.rawText);
  if (!rawText) {
    throw new DataRepositoryError('INVALID_RAW_TEXT', `Rozdanie #${handId} nie ma treści źródłowej.`);
  }

  const firstImportId = asNonEmptyString(candidate?.firstImportId || importId);
  if (!firstImportId) {
    throw new DataRepositoryError('IMPORT_ID_REQUIRED', `Rozdanie #${handId} wymaga firstImportId.`);
  }

  return {
    version: DATA_RECORD_VERSION,
    handId,
    gameType: normalizeGameType(candidate),
    playedAt: normalizePlayedAt(candidate?.playedAt ?? hand.timestamp ?? hand.playedAt),
    contentHash: createContentHash(rawText),
    firstImportId,
    rawText,
  };
};

const appendRecordsAtomically = async (filePath, records) => {
  if (records.length === 0) return;

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  let currentContent = '';
  try {
    currentContent = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const prefix = currentContent && !currentContent.endsWith('\n') ? `${currentContent}\n` : currentContent;
  const nextContent = `${prefix}${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    await fs.writeFile(temporaryPath, nextContent, 'utf8');
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
};

const rewriteRecordsAtomically = async (filePath, records) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const content = records.length > 0
    ? `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
    : '';
  try {
    await fs.writeFile(temporaryPath, content, 'utf8');
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
};

export const createContentHash = (rawText) => createHash('sha256')
  .update(normalizeRawHandText(rawText), 'utf8')
  .digest('hex');

// Publiczny indeks ma dokładnie postać handId -> contentHash. Nie zawiera
// rawText ani danych sesji, dzięki czemu pozostaje minimalnym indeksem
// kanonicznego magazynu.
export const buildHandIndex = async (dataDirectory) => {
  const { handsDirectory } = getRepositoryPaths(dataDirectory);
  const index = new Map();
  const handFiles = await getCanonicalHandFiles(handsDirectory);

  for (const fileName of handFiles) {
    const filePath = path.join(handsDirectory, fileName);
    const records = await readJsonl(filePath);
    for (const record of records) {
      const handId = asNonEmptyString(record.handId);
      const existingHash = index.get(handId);
      if (existingHash && existingHash !== record.contentHash) {
        throw new DataRepositoryError(
          'CONFLICTING_STORED_HAND_ID',
          `Kanoniczny magazyn zawiera sprzeczne wersje rozdania #${handId}.`,
        );
      }
      index.set(handId, record.contentHash);
    }
  }

  return index;
};

export const readCanonicalRecords = async (dataDirectory) => {
  const { handsDirectory } = getRepositoryPaths(dataDirectory);
  const records = [];
  const handFiles = await getCanonicalHandFiles(handsDirectory);
  for (const fileName of handFiles) {
    records.push(...await readJsonl(path.join(handsDirectory, fileName)));
  }
  return records;
};

const classifyCandidates = async (dataDirectory, candidates, { importId, handIndex } = {}) => {
  if (!Array.isArray(candidates)) {
    throw new DataRepositoryError('INVALID_CANDIDATES', 'Kandydaci do importu muszą być tablicą.');
  }

  const { handsDirectory } = getRepositoryPaths(dataDirectory);
  const index = handIndex ? new Map(handIndex) : await buildHandIndex(dataDirectory);
  const additionsByFile = new Map();
  const added = [];
  const duplicates = [];
  const conflicts = [];

  for (const candidate of candidates) {
    const record = createRecord(candidate, importId);
    const ordinal = Number.isInteger(candidate?.ordinal) ? candidate.ordinal : null;
    const existingHash = index.get(record.handId);

    if (existingHash === record.contentHash) {
      duplicates.push({ ordinal, handId: record.handId, contentHash: record.contentHash });
      continue;
    }
    if (existingHash) {
      conflicts.push({
        ordinal,
        handId: record.handId,
        existingContentHash: existingHash,
        contentHash: record.contentHash,
      });
      continue;
    }

    index.set(record.handId, record.contentHash);
    const filePath = getJsonlFilePath(
      handsDirectory,
      record.gameType,
      getCandidateYear(candidate, record.playedAt),
    );
    const records = additionsByFile.get(filePath) || [];
    records.push(record);
    additionsByFile.set(filePath, records);
    added.push({ ordinal, handId: record.handId, contentHash: record.contentHash, record });
  }

  return {
    index,
    additionsByFile,
    added,
    duplicates,
    conflicts,
    counts: {
      added: added.length,
      duplicates: duplicates.length,
      conflicts: conflicts.length,
    },
  };
};

const planHandReplacement = async (dataDirectory, { handId, candidate, importId } = {}) => {
  const normalizedHandId = asNonEmptyString(handId);
  if (!normalizedHandId) {
    throw new DataRepositoryError('INVALID_HAND_ID', 'Zastąpienie wymaga handId.');
  }
  const replacement = createRecord(candidate, importId);
  if (replacement.handId !== normalizedHandId) {
    throw new DataRepositoryError(
      'REPLACEMENT_HAND_ID_MISMATCH',
      `Plik zastępczy zawiera rozdanie #${replacement.handId}, oczekiwano #${normalizedHandId}.`,
    );
  }

  const { handsDirectory } = getRepositoryPaths(dataDirectory);
  const files = await getCanonicalHandFiles(handsDirectory);
  const matches = [];
  const recordsByPath = new Map();
  for (const fileName of files) {
    const filePath = path.join(handsDirectory, fileName);
    const records = await readJsonl(filePath);
    recordsByPath.set(filePath, records);
    records.forEach((record, index) => {
      if (asNonEmptyString(record.handId) === normalizedHandId) {
        matches.push({ filePath, fileName, index, record });
      }
    });
  }
  if (matches.length === 0) {
    throw new DataRepositoryError(
      'STORED_HAND_NOT_FOUND',
      `Kanoniczny magazyn nie zawiera rozdania #${normalizedHandId}.`,
    );
  }
  if (matches.length > 1) {
    throw new DataRepositoryError(
      'CONFLICTING_STORED_HAND_ID',
      `Kanoniczny magazyn zawiera wiele wersji rozdania #${normalizedHandId}.`,
    );
  }

  const existing = matches[0];
  const expectedPath = getJsonlFilePath(
    handsDirectory,
    replacement.gameType,
    getCandidateYear(candidate, replacement.playedAt),
  );
  // Zmiana partycji wymagałaby dwóch niezależnych rename'ów, więc nie daje
  // atomowej, bezpiecznej do wznowienia operacji. Konflikt tego samego ID nie
  // powinien zmieniać typu ani roku; w innym przypadku użytkownik musi wykonać
  // świadomą migrację danych.
  if (expectedPath !== existing.filePath) {
    throw new DataRepositoryError(
      'REPLACEMENT_PARTITION_CHANGED',
      'Zastąpienie nie może zmienić typu gry ani roku kanonicznego rozdania.',
    );
  }

  const changed = existing.record.contentHash !== replacement.contentHash;
  const nextRecords = [...recordsByPath.get(existing.filePath)];
  if (changed) nextRecords[existing.index] = replacement;
  return {
    changed,
    filePath: existing.filePath,
    existing: existing.record,
    replacement,
    nextRecords,
  };
};

export const createDataRepository = ({ dataDirectory } = {}) => {
  const commitCandidates = async (candidates, { importId } = {}) => {
    // Indeks jest odczytywany przed każdym commitem. Gdy proces przerwie się po
    // zapisie części roczników, ponowienie rozpozna już zapisane rekordy jako
    // duplikaty i dopisze wyłącznie brakujące.
    const plan = await classifyCandidates(dataDirectory, candidates, { importId });

    for (const [filePath, records] of plan.additionsByFile) {
      await appendRecordsAtomically(filePath, records);
    }

    return {
      added: plan.added.map((entry) => {
        const summary = { ...entry };
        delete summary.record;
        return summary;
      }),
      duplicates: plan.duplicates,
      conflicts: plan.conflicts,
      counts: plan.counts,
    };
  };

  const previewCandidates = async (candidates, options = {}) => {
    const plan = await classifyCandidates(dataDirectory, candidates, options);
    return {
      ...plan,
      additions: plan.added.map((entry) => {
        const summary = { ...entry };
        delete summary.record;
        return summary;
      }),
      recordsToAdd: plan.added.map(({ record }) => record),
    };
  };

  const previewHandReplacement = async (options = {}) => {
    const plan = await planHandReplacement(dataDirectory, options);
    return {
      changed: plan.changed,
      file: path.basename(plan.filePath),
      handId: plan.replacement.handId,
      existingContentHash: plan.existing.contentHash,
      replacementContentHash: plan.replacement.contentHash,
      gameType: plan.replacement.gameType,
      playedAt: plan.replacement.playedAt,
    };
  };

  const replaceHand = async (options = {}) => {
    const plan = await planHandReplacement(dataDirectory, options);
    if (plan.changed) await rewriteRecordsAtomically(plan.filePath, plan.nextRecords);
    return {
      changed: plan.changed,
      file: path.basename(plan.filePath),
      handId: plan.replacement.handId,
      existingContentHash: plan.existing.contentHash,
      replacementContentHash: plan.replacement.contentHash,
      gameType: plan.replacement.gameType,
      playedAt: plan.replacement.playedAt,
    };
  };

  return Object.freeze({
    buildHandIndex: () => buildHandIndex(dataDirectory),
    readCanonicalRecords: () => readCanonicalRecords(dataDirectory),
    commitCandidates,
    previewCandidates,
    previewHandReplacement,
    replaceHand,
    appendHands: commitCandidates,
    importHands: commitCandidates,
  });
};
