import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createApiApp } from '../server/app.js';
import { resolveLocalSourcePath } from '../server/localSources.js';

test('lokalne API listuje i odczytuje wyłącznie pliki tekstowe', async (t) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'poker-analyzer-data-'));
  await fs.writeFile(path.join(dataDirectory, 'Cash history.txt'), 'CoinPoker Hand #1', 'utf8');
  await fs.writeFile(path.join(dataDirectory, 'ignored.json'), '{}', 'utf8');
  await fs.mkdir(path.join(dataDirectory, 'nested'));
  await fs.writeFile(path.join(dataDirectory, 'nested', 'hidden.txt'), 'hidden', 'utf8');

  const server = createApiApp({ dataDirectory }).listen(0);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dataDirectory, { recursive: true, force: true });
  });
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const listResponse = await fetch(`${baseUrl}/api/local-sources`);
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.deepEqual(list.sources.map(({ filename }) => filename), ['Cash history.txt']);
  assert.equal(typeof list.sources[0].size, 'number');
  assert.equal(typeof list.sources[0].modifiedAt, 'string');

  const contentResponse = await fetch(`${baseUrl}/api/local-sources/${encodeURIComponent('Cash history.txt')}/content`);
  assert.equal(contentResponse.status, 200);
  assert.equal(await contentResponse.text(), 'CoinPoker Hand #1');

  const wrongExtensionResponse = await fetch(`${baseUrl}/api/local-sources/${encodeURIComponent('ignored.json')}/content`);
  assert.equal(wrongExtensionResponse.status, 400);

  const traversalResponse = await fetch(`${baseUrl}/api/local-sources/${encodeURIComponent('../secret.txt')}/content`);
  assert.equal(traversalResponse.status, 400);
});

test('walidacja ścieżki blokuje wyjście poza katalog data', () => {
  assert.throws(
    () => resolveLocalSourcePath('../secret.txt', path.resolve('data')),
    /Nieprawidłowa nazwa pliku/,
  );
});
