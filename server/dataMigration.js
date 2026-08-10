import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  buildTourneySessions,
  parseSingleRawHand,
} from '../src/parser/pokerParser.js';
import { buildSessionAnalysisInput } from '../src/ai/sessionAnalysisContract.js';
import {
  readAiAnalysesCache,
  writeAiAnalysesCache,
} from './aiAnalysesCache.js';
import { createDataImportService, prepareTextImport } from './dataImportService.js';
import { createDataRepository } from './dataRepository.js';

export const CASH_SESSION_BREAK_MS = 30 * 60 * 1000;

const isTournamentHand = (hand) => hand?.isTournament || hand?.gameType === 'tournament';

const reportCount = (cache) => (
  Object.values(cache.handAnalyses).flat().length
  + Object.values(cache.sessionAnalyses).flat().length
  + cache.sessionGroupAnalyses.length
);

const getReportSources = (report) => [
  ...(Array.isArray(report?.sources) ? report.sources : []),
  ...(Array.isArray(report?.sourceReports) ? report.sourceReports : []),
];

const groupContainsCash = (report) => getReportSources(report).some((source) => {
  const type = String(source?.type || '').trim().toLowerCase();
  const sourceId = String(source?.sourceId || '').trim();
  return type === 'cash' || /^cash:/i.test(sourceId) || /^session_/i.test(sourceId);
});

const buildCashSessionCount = (hands) => {
  const handsByTable = new Map();
  hands.filter((hand) => !isTournamentHand(hand)).forEach((hand) => {
    const tableId = String(hand.tableId || 'Nieznany');
    const tableHands = handsByTable.get(tableId) || [];
    tableHands.push(hand);
    handsByTable.set(tableId, tableHands);
  });

  let count = 0;
  handsByTable.forEach((tableHands) => {
    const ordered = [...tableHands].sort((left, right) => left.timestamp - right.timestamp);
    let previousTimestamp = null;
    ordered.forEach((hand) => {
      const timestamp = Number(hand.timestamp);
      if (!Number.isFinite(timestamp)
        || previousTimestamp === null
        || timestamp - previousTimestamp > CASH_SESSION_BREAK_MS) {
        count += 1;
      }
      previousTimestamp = timestamp;
    });
  });
  return count;
};

export const buildMigrationSessionSummary = (hands) => ({
  cash: buildCashSessionCount(hands),
  tournament: buildTourneySessions(hands.filter(isTournamentHand)).length,
});

const parseCanonicalRecords = (records) => {
  const hands = new Map();
  records.forEach((record) => {
    const parsed = parseSingleRawHand(record.rawText);
    if (parsed.hand) hands.set(parsed.hand.id, parsed.hand);
  });
  return hands;
};

const buildTournamentFingerprints = (hands) => new Map(
  buildTourneySessions(hands.filter(isTournamentHand)).map((session) => [
    session.id,
    buildSessionAnalysisInput({
      sessionId: session.id,
      hands: session.hands,
      gameType: 'tournament',
    }).fingerprint,
  ]),
);

export const planAiAnalysesMigration = (cache, canonicalHands) => {
  const tournamentFingerprints = buildTournamentFingerprints(canonicalHands);
  const nextSessionAnalyses = {};

  Object.entries(cache.sessionAnalyses).forEach(([sessionId, reports]) => {
    const expectedFingerprint = tournamentFingerprints.get(sessionId);
    if (!expectedFingerprint) return;
    const matchingReports = reports.filter((report) => report?.fingerprint === expectedFingerprint);
    if (matchingReports.length > 0) nextSessionAnalyses[sessionId] = matchingReports;
  });

  const nextCache = {
    ...cache,
    handAnalyses: cache.handAnalyses,
    sessionAnalyses: nextSessionAnalyses,
    sessionGroupAnalyses: cache.sessionGroupAnalyses.filter((report) => !groupContainsCash(report)),
  };
  const before = reportCount(cache);
  const preserved = reportCount(nextCache);
  return {
    cache: nextCache,
    counts: { preserved, removed: before - preserved },
  };
};

export const listLegacyTxtSources = async (dataDirectory) => {
  const entries = await fs.readdir(dataDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.txt')
    .map((entry) => ({ filename: entry.name, filePath: path.join(dataDirectory, entry.name) }))
    .sort((left, right) => left.filename.localeCompare(right.filename));
};

const createMigrationCounts = () => ({
  total: 0,
  valid: 0,
  added: 0,
  duplicates: 0,
  conflicts: 0,
  invalid: 0,
});

const addCounts = (target, values) => {
  Object.keys(target).forEach((key) => {
    target[key] += Number(values[key] || 0);
  });
};

const summarizePreparedImport = (prepared, preview) => ({
  total: prepared.parsed.validHands.length + prepared.parsed.issues.length,
  valid: prepared.parsed.validHands.length,
  added: preview.counts.added,
  duplicates: preview.counts.duplicates,
  conflicts: preview.counts.conflicts,
  invalid: prepared.parsed.issues.length,
});

const getCanonicalHands = async (repository, extraRecords = []) => {
  const hands = parseCanonicalRecords(await repository.readCanonicalRecords());
  extraRecords.forEach((record) => {
    const parsed = parseSingleRawHand(record.rawText);
    if (parsed.hand) hands.set(parsed.hand.id, parsed.hand);
  });
  return [...hands.values()];
};

const dryRunMigration = async ({ dataDirectory, sources, repository }) => {
  const counts = createMigrationCounts();
  let virtualIndex = await repository.buildHandIndex();
  const recordsToAdd = [];

  for (const source of sources) {
    const content = await fs.readFile(source.filePath, 'utf8');
    const prepared = prepareTextImport({ filename: source.filename, content });
    const preview = await repository.previewCandidates(prepared.parsed.validHands, {
      importId: prepared.importId,
      handIndex: virtualIndex,
    });
    virtualIndex = preview.index;
    recordsToAdd.push(...preview.recordsToAdd);
    addCounts(counts, summarizePreparedImport(prepared, preview));
  }

  const canonicalHands = await getCanonicalHands(repository, recordsToAdd);
  const cachePlan = planAiAnalysesMigration(
    await readAiAnalysesCache(dataDirectory),
    canonicalHands,
  );
  return {
    mode: 'dry-run',
    files: sources.map((source) => source.filename),
    counts,
    sessions: buildMigrationSessionSummary(canonicalHands),
    analyses: cachePlan.counts,
  };
};

const applyMigration = async ({ dataDirectory, sources, repository }) => {
  const counts = createMigrationCounts();
  const importer = createDataImportService({ dataDirectory, repository });

  for (const source of sources) {
    const result = await importer.importFile({
      filePath: source.filePath,
      removeSourceAfterImport: true,
    });
    addCounts(counts, {
      total: result.report.total,
      valid: result.report.total - result.report.invalid,
      added: result.report.added,
      duplicates: result.report.duplicates,
      conflicts: result.report.conflicts,
      invalid: result.report.invalid,
    });
  }

  const canonicalHands = await getCanonicalHands(repository);
  const cachePlan = planAiAnalysesMigration(
    await readAiAnalysesCache(dataDirectory),
    canonicalHands,
  );
  await writeAiAnalysesCache({
    ...cachePlan.cache,
    updatedAt: new Date().toISOString(),
  }, dataDirectory);

  return {
    mode: 'apply',
    files: sources.map((source) => source.filename),
    counts,
    sessions: buildMigrationSessionSummary(canonicalHands),
    analyses: cachePlan.counts,
  };
};

export const runDataMigration = async ({ dataDirectory, mode = 'dry-run' } = {}) => {
  if (!dataDirectory) throw new Error('Migracja wymaga katalogu data.');
  if (!['dry-run', 'apply'].includes(mode)) {
    throw new Error('Migracja obsługuje wyłącznie tryb --dry-run albo --apply.');
  }

  const sources = await listLegacyTxtSources(dataDirectory);
  const repository = createDataRepository({ dataDirectory });
  return mode === 'apply'
    ? applyMigration({ dataDirectory, sources, repository })
    : dryRunMigration({ dataDirectory, sources, repository });
};
