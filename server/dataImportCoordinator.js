import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  createDataImportService,
  createImportId,
  prepareTextImport,
} from './dataImportService.js';

const IMPORT_ID_PATTERN = /^[a-f0-9]{64}$/i;
const IMPORT_PHASES = new Set([
  'scanning',
  'parsing',
  'committing',
  'reindexing',
  'ready',
  'failed',
]);

export class DataImportError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'DataImportError';
    this.code = code;
    this.status = status;
  }
}

const asFilename = (value) => path.basename(String(value ?? '').trim());
const isTextFilename = (filename) => path.extname(filename).toLowerCase() === '.txt';

const toError = (error) => ({
  code: error?.code || 'IMPORT_FAILED',
  message: error?.message || 'Nie udało się zaimportować pliku.',
});

const getPokerPaths = (dataDirectory) => {
  const pokerDirectory = path.resolve(dataDirectory, 'poker');
  return {
    inboxDirectory: path.resolve(dataDirectory, 'inbox'),
    importsDirectory: path.join(pokerDirectory, 'imports'),
    issuesDirectory: path.join(pokerDirectory, 'issues'),
  };
};

const listInboxSources = async (inboxDirectory) => {
  let entries;
  try {
    entries = await fs.readdir(inboxDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && isTextFilename(entry.name))
    .map((entry) => ({
      filename: entry.name,
      filePath: path.join(inboxDirectory, entry.name),
    }))
    .sort((left, right) => left.filename.localeCompare(right.filename, 'pl'));
};

const readJsonFile = async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8'));

const readStoredReports = async ({ importsDirectory, logger }) => {
  let entries;
  try {
    entries = await fs.readdir(importsDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const reports = await Promise.all(entries
    .filter((entry) => entry.isFile() && IMPORT_ID_PATTERN.test(path.basename(entry.name, '.json'))
      && path.extname(entry.name).toLowerCase() === '.json')
    .map(async (entry) => {
      try {
        return await readJsonFile(path.join(importsDirectory, entry.name));
      } catch (error) {
        logger?.error?.(`Nie udało się odczytać raportu importu ${entry.name}:`, error?.message);
        return null;
      }
    }));

  return reports
    .filter((report) => report && IMPORT_ID_PATTERN.test(String(report.importId || '')))
    .sort((left, right) => String(right.importedAt || '').localeCompare(String(left.importedAt || '')));
};

const createSyntheticFailureReport = (prepared, importedAt) => ({
  version: 1,
  importId: prepared.importId,
  filename: prepared.filename,
  importedAt,
  size: prepared.size,
  total: prepared.parsed.validHands.length + prepared.parsed.issues.length,
  added: 0,
  duplicates: 0,
  conflicts: 0,
  invalid: prepared.parsed.issues.length || 1,
});

const isCompletelyUnreadable = (prepared) => prepared.parsed.validHands.length === 0;

const outcomeForReport = (report) => (
  report.invalid > 0 || report.conflicts > 0 ? 'completed_with_warnings' : 'completed'
);

const toReportSummary = (report, runtime = {}) => ({
  importId: report.importId,
  filename: report.filename,
  importedAt: report.importedAt,
  size: report.size,
  total: report.total,
  added: report.added,
  duplicates: report.duplicates,
  conflicts: report.conflicts,
  invalid: report.invalid,
  source: runtime.source || 'archive',
  phase: runtime.phase || 'ready',
  outcome: runtime.outcome || outcomeForReport(report),
  error: runtime.error || null,
});

const toRuntimePublicStatus = (runtime) => ({
  importId: runtime.importId,
  filename: runtime.filename,
  source: runtime.source,
  phase: runtime.phase,
  outcome: runtime.outcome || null,
  queuedAt: runtime.queuedAt,
  startedAt: runtime.startedAt || null,
  completedAt: runtime.completedAt || null,
  error: runtime.error || null,
  report: runtime.report || null,
  issues: runtime.issues || [],
});

export const parseTextMultipartUpload = (contentType, body) => {
  const boundaryMatch = String(contentType || '').match(/multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
  if (!boundary) {
    throw new DataImportError('IMPORT_MULTIPART_REQUIRED', 'Import wymaga danych multipart/form-data.', 415);
  }
  if (!Buffer.isBuffer(body)) {
    throw new DataImportError('IMPORT_FILE_REQUIRED', 'Brakuje pliku TXT do importu.');
  }

  const openingBoundary = Buffer.from(`--${boundary}`);
  const separator = Buffer.from(`\r\n--${boundary}`);
  if (body.length < openingBoundary.length || !body.subarray(0, openingBoundary.length).equals(openingBoundary)) {
    throw new DataImportError('IMPORT_MULTIPART_INVALID', 'Nieprawidłowy format formularza importu.');
  }

  let position = openingBoundary.length;
  const uploads = [];
  if (body.subarray(position, position + 2).equals(Buffer.from('--'))) {
    throw new DataImportError('IMPORT_FILE_REQUIRED', 'Brakuje pliku TXT do importu.');
  }
  if (!body.subarray(position, position + 2).equals(Buffer.from('\r\n'))) {
    throw new DataImportError('IMPORT_MULTIPART_INVALID', 'Nieprawidłowy format formularza importu.');
  }
  position += 2;

  while (position < body.length) {
    const headersEnd = body.indexOf(Buffer.from('\r\n\r\n'), position);
    if (headersEnd === -1) {
      throw new DataImportError('IMPORT_MULTIPART_INVALID', 'Nieprawidłowy format formularza importu.');
    }
    const headerLines = body.subarray(position, headersEnd).toString('utf8').split('\r\n');
    const headers = new Map(headerLines.map((line) => {
      const colon = line.indexOf(':');
      if (colon <= 0) {
        throw new DataImportError('IMPORT_MULTIPART_INVALID', 'Nieprawidłowy format formularza importu.');
      }
      return [line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()];
    }));
    const contentStart = headersEnd + 4;
    const boundaryStart = body.indexOf(separator, contentStart);
    if (boundaryStart === -1) {
      throw new DataImportError('IMPORT_MULTIPART_INVALID', 'Nieprawidłowy format formularza importu.');
    }
    const disposition = headers.get('content-disposition') || '';
    const name = disposition.match(/(?:^|;)\s*name="([^"]*)"/i)?.[1];
    const filename = disposition.match(/(?:^|;)\s*filename="([^"]*)"/i)?.[1];
    if (name === 'file' && filename !== undefined) {
      uploads.push({ filename, content: body.subarray(contentStart, boundaryStart) });
    }

    position = boundaryStart + separator.length;
    if (body.subarray(position, position + 2).equals(Buffer.from('--'))) {
      break;
    }
    if (!body.subarray(position, position + 2).equals(Buffer.from('\r\n'))) {
      throw new DataImportError('IMPORT_MULTIPART_INVALID', 'Nieprawidłowy format formularza importu.');
    }
    position += 2;
  }

  if (uploads.length !== 1) {
    throw new DataImportError(
      uploads.length === 0 ? 'IMPORT_FILE_REQUIRED' : 'IMPORT_MULTIPLE_FILES',
      uploads.length === 0 ? 'Brakuje pola file z plikiem TXT.' : 'Można przesłać dokładnie jeden plik TXT.',
    );
  }
  const upload = uploads[0];
  const filename = asFilename(upload.filename);
  if (!filename || filename === '.' || !isTextFilename(filename)) {
    throw new DataImportError('IMPORT_FILE_TYPE_INVALID', 'Do importu można przesłać wyłącznie plik TXT.');
  }
  return { filename, content: upload.content.toString('utf8') };
};

export const createDataImportCoordinator = ({ dataDirectory, dataIndex, importer, logger = console } = {}) => {
  if (!dataDirectory) {
    throw new DataImportError('DATA_DIRECTORY_REQUIRED', 'Import wymaga katalogu data.', 500);
  }
  if (!dataIndex?.start) {
    throw new DataImportError('DATA_INDEX_REQUIRED', 'Import wymaga indeksu danych.', 500);
  }

  const resolvedDataDirectory = path.resolve(dataDirectory);
  const paths = getPokerPaths(resolvedDataDirectory);
  const dataImporter = importer || createDataImportService({ dataDirectory: resolvedDataDirectory });
  const runtimes = new Map();
  let operation = Promise.resolve();
  let scanPromise = null;
  let status = {
    phase: 'ready',
    startedAt: null,
    completedAt: null,
    error: null,
  };

  const updateStatus = (changes) => {
    status = { ...status, ...changes };
  };
  const schedule = (task) => {
    const next = operation.then(task, task);
    operation = next.catch(() => {});
    return next;
  };
  const updateRuntime = (importId, changes) => {
    const current = runtimes.get(importId) || { importId };
    const next = { ...current, ...changes };
    if (!IMPORT_PHASES.has(next.phase)) {
      throw new DataImportError('IMPORT_PHASE_INVALID', `Nieprawidłowa faza importu: ${next.phase}.`, 500);
    }
    runtimes.set(importId, next);
    return next;
  };
  const setImportPhase = (importId, phase, changes = {}) => updateRuntime(importId, { phase, ...changes });

  const processPrepared = async ({ prepared, source, sourcePath }) => {
    const { importId } = prepared;
    const startedAt = new Date().toISOString();
    setImportPhase(importId, 'parsing', { startedAt, error: null });
    updateStatus({ phase: 'parsing', startedAt, completedAt: null, error: null });

    if (isCompletelyUnreadable(prepared)) {
      const error = new DataImportError(
        'IMPORT_NO_VALID_HANDS',
        source === 'inbox'
          ? 'Plik nie zawiera poprawnego rozdania. Pozostaje w katalogu inbox.'
          : 'Plik nie zawiera poprawnego rozdania i nie został zarchiwizowany.',
      );
      const report = createSyntheticFailureReport(prepared, startedAt);
      setImportPhase(importId, 'failed', {
        source,
        completedAt: new Date().toISOString(),
        outcome: 'failed',
        error: toError(error),
        report,
        issues: prepared.parsed.issues,
      });
      updateStatus({ phase: 'failed', completedAt: new Date().toISOString(), error: toError(error) });
      return getImport(importId);
    }

    try {
      setImportPhase(importId, 'committing', { source });
      updateStatus({ phase: 'committing', error: null });
      const result = await dataImporter.importText({
        filename: prepared.filename,
        content: prepared.content,
        importedAt: startedAt,
        sourcePath,
        removeSourceAfterImport: Boolean(sourcePath),
      });
      const outcome = outcomeForReport(result.report);
      setImportPhase(importId, 'reindexing', {
        source,
        outcome,
        report: result.report,
        issues: result.issues,
      });
      updateStatus({ phase: 'reindexing', error: null });

      // createDataIndex zachowuje poprzedni snapshot aż do udanej przebudowy,
      // dlatego odczytowe endpointy nadal zwracają spójną, starszą rewizję.
      if (result.report.added > 0) await dataIndex.start();

      const completedAt = new Date().toISOString();
      setImportPhase(importId, 'ready', { completedAt });
      updateStatus({ phase: 'ready', completedAt, error: null });
      return getImport(importId);
    } catch (error) {
      const completedAt = new Date().toISOString();
      setImportPhase(importId, 'failed', {
        source,
        completedAt,
        outcome: 'failed',
        error: toError(error),
      });
      updateStatus({ phase: 'failed', completedAt, error: toError(error) });
      logger?.error?.('Nie udało się zaimportować pliku pokerowego:', error?.message);
      return getImport(importId);
    }
  };

  const prepareRuntimeImport = ({ filename, content, source }) => {
    const prepared = prepareTextImport({ filename, content });
    const queuedAt = new Date().toISOString();
    setImportPhase(prepared.importId, 'scanning', {
      filename: prepared.filename,
      source,
      queuedAt,
      startedAt: null,
      completedAt: null,
      outcome: null,
      error: null,
      report: null,
      issues: [],
    });
    return prepared;
  };

  const processText = ({ filename, content, source, sourcePath }) => {
    const prepared = prepareRuntimeImport({ filename, content, source });
    return schedule(() => processPrepared({ prepared, source, sourcePath }));
  };

  const processInboxSource = async ({ filename, filePath }) => {
    const content = await fs.readFile(filePath, 'utf8');
    const prepared = prepareRuntimeImport({ filename, content, source: 'inbox' });
    // Skan już działa wewnątrz kolejki. Ponowne dodanie tego samego zadania do
    // kolejki i oczekiwanie na nie zablokowałoby ją, dlatego wywołujemy wspólną
    // procedurę importu bezpośrednio.
    return processPrepared({ prepared, source: 'inbox', sourcePath: filePath });
  };

  const scanInbox = () => {
    if (scanPromise) return scanPromise;
    const startedAt = new Date().toISOString();
    updateStatus({ phase: 'scanning', startedAt, completedAt: null, error: null });
    scanPromise = schedule(async () => {
      try {
        const sources = await listInboxSources(paths.inboxDirectory);
        for (const source of sources) {
          try {
            await processInboxSource(source);
          } catch (error) {
            const importId = createImportId(`${source.filename}\n${error?.message || ''}`);
            setImportPhase(importId, 'failed', {
              filename: source.filename,
              source: 'inbox',
              queuedAt: startedAt,
              startedAt,
              completedAt: new Date().toISOString(),
              outcome: 'failed',
              error: toError(error),
              report: null,
              issues: [],
            });
            logger?.error?.(`Nie udało się odczytać pliku inbox ${source.filename}:`, error?.message);
          }
        }
        if (status.phase === 'scanning') {
          updateStatus({ phase: 'ready', completedAt: new Date().toISOString(), error: null });
        }
        return getStatus();
      } catch (error) {
        updateStatus({ phase: 'failed', completedAt: new Date().toISOString(), error: toError(error) });
        logger?.error?.('Nie udało się przeskanować katalogu inbox:', error?.message);
        return getStatus();
      } finally {
        scanPromise = null;
      }
    });
    return scanPromise;
  };

  const queueUpload = ({ filename, content }) => processText({ filename, content, source: 'upload' });

  const getStatus = () => ({
    ...status,
    activeImportIds: [...runtimes.values()]
      .filter((runtime) => !['ready', 'failed'].includes(runtime.phase))
      .map((runtime) => runtime.importId),
  });

  async function getImport(importId) {
    const normalizedId = String(importId || '').trim();
    if (!IMPORT_ID_PATTERN.test(normalizedId)) return null;
    const runtime = runtimes.get(normalizedId);
    let report = runtime?.report || null;
    let issues = runtime?.issues || [];
    if (!report) {
      try {
        report = await readJsonFile(path.join(paths.importsDirectory, `${normalizedId}.json`));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    if (issues.length === 0 && report) {
      try {
        const issueReport = await readJsonFile(path.join(paths.issuesDirectory, `${normalizedId}.json`));
        issues = Array.isArray(issueReport?.issues) ? issueReport.issues : [];
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    if (!runtime && !report) return null;
    return {
      ...(runtime ? toRuntimePublicStatus(runtime) : {}),
      ...(report ? toReportSummary(report, runtime) : {}),
      report,
      issues,
    };
  }

  const listImports = async () => {
    const reports = await readStoredReports({ importsDirectory: paths.importsDirectory, logger });
    const byId = new Map(reports.map((report) => [report.importId, toReportSummary(report, runtimes.get(report.importId))]));
    runtimes.forEach((runtime, importId) => {
      if (!byId.has(importId)) byId.set(importId, toRuntimePublicStatus(runtime));
    });
    return {
      status: getStatus(),
      imports: [...byId.values()].sort((left, right) => String(right.importedAt || right.queuedAt || '')
        .localeCompare(String(left.importedAt || left.queuedAt || ''))),
    };
  };

  return Object.freeze({
    scanInbox,
    queueUpload,
    getStatus,
    getImport,
    listImports,
  });
};
