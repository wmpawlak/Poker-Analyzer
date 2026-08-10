import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  normalizeRawHandText,
  parseHandHistoryDocument,
} from '../src/parser/pokerParser.js';
import { createDataRepository } from './dataRepository.js';

export const IMPORT_REPORT_VERSION = 1;

const asFilename = (value) => String(value ?? '').trim() || 'unknown.txt';

const getImportPaths = (dataDirectory, importId) => {
  const pokerDirectory = path.resolve(dataDirectory, 'poker');
  return {
    pokerDirectory,
    sourcePath: path.join(pokerDirectory, 'sources', `${importId}.txt`),
    reportPath: path.join(pokerDirectory, 'imports', `${importId}.json`),
    issuesPath: path.join(pokerDirectory, 'issues', `${importId}.json`),
  };
};

const writeFileIfMissing = async (filePath, content) => {
  try {
    await fs.access(filePath);
    return false;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(temporaryPath, content, 'utf8');
    await fs.rename(temporaryPath, filePath);
    return true;
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
};

const writeJsonIfMissing = (filePath, value) => writeFileIfMissing(
  filePath,
  `${JSON.stringify(value, null, 2)}\n`,
);

const assertDataSourcePath = (sourcePath, dataDirectory) => {
  if (!sourcePath) return;
  const resolvedDataDirectory = path.resolve(dataDirectory);
  const resolvedSourcePath = path.resolve(sourcePath);
  const relativePath = path.relative(resolvedDataDirectory, resolvedSourcePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Plik migracji musi znajdować się bezpośrednio w katalogu data.');
  }
};

const buildIssues = (parsed, commit) => [
  ...parsed.issues,
  ...commit.conflicts.map((conflict) => ({
    ordinal: conflict.ordinal,
    handId: conflict.handId,
    reason: 'CONFLICTING_HAND_ID',
  })),
];

export const createImportId = (content) => createHash('sha256')
  .update(normalizeRawHandText(content), 'utf8')
  .digest('hex');

export const prepareTextImport = ({ filename, content } = {}) => {
  const rawContent = String(content ?? '');
  const parsed = parseHandHistoryDocument(rawContent);
  return {
    importId: createImportId(rawContent),
    filename: asFilename(filename),
    content: rawContent,
    parsed,
    size: Buffer.byteLength(rawContent, 'utf8'),
  };
};

export const createDataImportService = ({ dataDirectory, repository } = {}) => {
  if (!dataDirectory) throw new Error('Importer wymaga katalogu data.');
  const dataRepository = repository || createDataRepository({ dataDirectory });
  let importOperation = Promise.resolve();

  const withImportLock = (operation) => {
    const next = importOperation.then(operation, operation);
    importOperation = next.catch(() => {});
    return next;
  };

  const importText = async ({
    filename,
    content,
    importedAt = new Date().toISOString(),
    sourcePath,
    removeSourceAfterImport = false,
  } = {}) => withImportLock(async () => {
    if (removeSourceAfterImport) assertDataSourcePath(sourcePath, dataDirectory);
    const prepared = prepareTextImport({ filename, content });
    const commit = await dataRepository.commitCandidates(prepared.parsed.validHands, {
      importId: prepared.importId,
    });
    const verifiedIndex = await dataRepository.buildHandIndex();
    const unverifiedAddition = commit.added.find((addition) => (
      verifiedIndex.get(addition.handId) !== addition.contentHash
    ));
    if (unverifiedAddition) {
      throw new Error(`Nie udało się zweryfikować zapisu rozdania #${unverifiedAddition.handId}.`);
    }

    const paths = getImportPaths(dataDirectory, prepared.importId);
    const issues = buildIssues(prepared.parsed, commit);
    const report = {
      version: IMPORT_REPORT_VERSION,
      importId: prepared.importId,
      filename: prepared.filename,
      importedAt,
      size: prepared.size,
      total: prepared.parsed.validHands.length + prepared.parsed.issues.length,
      added: commit.counts.added,
      duplicates: commit.counts.duplicates,
      conflicts: commit.counts.conflicts,
      invalid: prepared.parsed.issues.length,
    };

    const archiveCreated = await writeFileIfMissing(paths.sourcePath, prepared.content);
    const reportCreated = await writeJsonIfMissing(paths.reportPath, report);
    const issuesCreated = await writeJsonIfMissing(paths.issuesPath, {
      version: IMPORT_REPORT_VERSION,
      importId: prepared.importId,
      issues,
    });

    // Kopia archiwalna i oba raporty są już trwałe. Dopiero teraz można usunąć
    // źródłowy plik migracji; przerwanie wcześniej pozostawia plik do ponowienia.
    if (removeSourceAfterImport && sourcePath) {
      await fs.rm(path.resolve(sourcePath), { force: true });
    }

    return {
      importId: prepared.importId,
      report,
      issues,
      archiveCreated,
      reportCreated,
      issuesCreated,
    };
  });

  const importFile = async ({ filePath, ...options } = {}) => {
    if (!filePath) throw new Error('Brakuje ścieżki pliku do importu.');
    const content = await fs.readFile(filePath, 'utf8');
    return importText({
      ...options,
      filename: options.filename || path.basename(filePath),
      content,
      sourcePath: options.sourcePath || filePath,
    });
  };

  return Object.freeze({
    importText,
    importFile,
    prepareTextImport,
    repository: dataRepository,
  });
};
