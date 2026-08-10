import { performance } from 'node:perf_hooks';
import path from 'node:path';
import process from 'node:process';
import { promises as fs } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createDataIndex } from './dataIndex.js';
import { createWalletResponse } from './dataQueries.js';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDirectory = path.join(projectDirectory, 'data');
const cachePath = path.join(dataDirectory, '.cache', 'poker-index-v1.json.gz');
const backupCachePath = `${cachePath}.perf-backup-${process.pid}`;

const milliseconds = (value) => `${value.toFixed(1)} ms`;
const kilobytes = (value) => `${(value / 1024).toFixed(1)} kB`;

const pathExists = async (filePath) => fs.access(filePath).then(() => true).catch(() => false);

const getInitialChunkSize = async () => {
  const assetsDirectory = path.join(projectDirectory, 'dist', 'assets');
  const files = await fs.readdir(assetsDirectory);
  const initialChunk = files.find((fileName) => /^index-[A-Za-z0-9_-]+\.js$/.test(fileName));
  if (!initialChunk) throw new Error('Nie znaleziono początkowego chunku w dist/assets. Najpierw uruchom npm run build.');
  return gzipSync(await fs.readFile(path.join(assetsDirectory, initialChunk))).length;
};

const getBootstrapSize = (snapshot) => Buffer.byteLength(JSON.stringify({
  datasetRevision: snapshot.datasetRevision,
  builtAt: snapshot.builtAt,
  handCount: snapshot.hands.length,
  cashSessionCount: snapshot.sessions.cash.length,
  tournamentSessionCount: snapshot.sessions.tournament.length,
}));

const startIndex = async () => {
  const index = createDataIndex({ dataDirectory, logger: { error: () => {} } });
  const started = performance.now();
  const snapshot = await index.start();
  return { snapshot, elapsed: performance.now() - started };
};

const main = async () => {
  const hadCache = await pathExists(cachePath);
  if (hadCache) await fs.rename(cachePath, backupCachePath);

  let cold;
  try {
    cold = await startIndex();
  } catch (error) {
    if (hadCache && await pathExists(backupCachePath)) await fs.rename(backupCachePath, cachePath);
    throw error;
  }

  if (hadCache && await pathExists(backupCachePath)) await fs.rm(backupCachePath, { force: true });
  const cached = await startIndex();
  const wallet = createWalletResponse(cached.snapshot, {});
  const [bootstrapBytes, initialChunkBytes] = await Promise.all([
    getBootstrapSize(cached.snapshot),
    getInitialChunkSize(),
  ]);

  const metrics = [
    ['zimne indeksowanie', cold.elapsed, 3_000],
    ['start z cache', cached.elapsed, 200],
    ['bootstrap API', bootstrapBytes, 1_000_000],
    ['początkowy JS gzip', initialChunkBytes, 120 * 1024],
    ['punkty wykresu wallet', wallet.timeline.length, 1_200],
  ];

  console.log('Poker data performance');
  console.log(`ręce: ${cached.snapshot.hands.length}, sesje Cash: ${cached.snapshot.sessions.cash.length}, turnieje: ${cached.snapshot.sessions.tournament.length}`);
  console.log(`zimne indeksowanie: ${milliseconds(cold.elapsed)}`);
  console.log(`start z cache: ${milliseconds(cached.elapsed)}`);
  console.log(`bootstrap API: ${kilobytes(bootstrapBytes)}`);
  console.log(`początkowy JS gzip: ${kilobytes(initialChunkBytes)}`);
  console.log(`maks. liczba punktów wykresu: ${wallet.timeline.length}`);

  const failures = metrics.filter(([, actual, limit]) => actual > limit);
  if (failures.length > 0) {
    console.error(`Nie spełniono budżetów: ${failures.map(([label]) => label).join(', ')}.`);
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(`Nie udało się wykonać pomiarów danych: ${error.message}`);
  process.exitCode = 1;
});
