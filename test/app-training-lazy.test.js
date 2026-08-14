import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApiApp } from '../server/app.js';

const databasePath = (dataDirectory) => path.join(dataDirectory, 'poker-training-v2.sqlite');
const exists = async (filePath) => fs.access(filePath).then(() => true, () => false);

const startApp = async (t) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'poker-app-training-lazy-'));
  t.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const server = createApiApp({
    dataDirectory,
    logger: { error: () => {}, info: () => {} },
  }).listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    dataDirectory,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
};

test('endpoint nietreningowy nie inicjalizuje bazy treningowej', async (t) => {
  const { dataDirectory, baseUrl } = await startApp(t);
  assert.equal(await exists(databasePath(dataDirectory)), false);

  const response = await fetch(`${baseUrl}/api/ai/models`);
  assert.equal(response.status, 200);
  assert.equal(await exists(databasePath(dataDirectory)), false);
});

test('równoczesne żądania treningowe korzystają z jednej leniwej inicjalizacji', async (t) => {
  const { dataDirectory, baseUrl } = await startApp(t);
  const responses = await Promise.all([
    fetch(`${baseUrl}/api/training/status`),
    fetch(`${baseUrl}/api/training/status`),
  ]);
  assert.deepEqual(responses.map(({ status }) => status), [200, 200]);
  assert.equal(await exists(databasePath(dataDirectory)), true);

  const followUp = await fetch(`${baseUrl}/api/training/status`);
  assert.equal(followUp.status, 200);
});
