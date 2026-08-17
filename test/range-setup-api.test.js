import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createApiApp } from '../server/app.js';
import { RANGE_HAND_NOTATIONS, RANGE_POSITIONS } from '../server/ranges/rangeSetupRoutes.js';
import {
  DEFAULT_PREFLOP_VERSION_ID,
  DEFAULT_PREFLOP_VERSION_NAME,
  PREFLOP_SETUP_ID,
  RANGE_SETUP_DATABASE_FILENAME,
  createRangeSetupRepository,
} from '../server/ranges/rangeSetupRepository.js';

const createHands = (value = 50) => Object.fromEntries(RANGE_HAND_NOTATIONS.map((notation) => [notation, (
  Object.fromEntries(RANGE_POSITIONS.map((position) => [position, value]))
)]));

const startApi = async (context) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'poker-range-setup-api-'));
  context.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const server = createApiApp({ dataDirectory, logger: { error: () => {}, info: () => {} } }).listen(0);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, dataDirectory };
};

const putJson = (url, body) => fetch(url, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const patchJson = (url, body) => fetch(url, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const postJson = (url, body = {}) => fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

test('migracja istniejącego setupu zachowuje ręce i tworzy wersję Open-raise', async (context) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'poker-range-setup-migration-'));
  context.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const legacyHands = createHands(0);
  legacyHands.AA = { UTG: 100, HJ: 75, BTN: 50, SB: 25 };
  const database = new DatabaseSync(path.join(dataDirectory, RANGE_SETUP_DATABASE_FILENAME));
  database.exec(`
    CREATE TABLE range_setups (
      id TEXT PRIMARY KEY,
      setup_json TEXT NOT NULL CHECK (json_valid(setup_json)),
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1
    );
  `);
  database.prepare('INSERT INTO range_setups (id, setup_json, updated_at, revision) VALUES (?, ?, ?, ?)')
    .run(PREFLOP_SETUP_ID, JSON.stringify({ hands: legacyHands }), '2026-08-17T12:00:00.000Z', 190);
  database.close();

  const repository = createRangeSetupRepository({ dataDirectory, now: () => '2026-08-17T13:00:00.000Z' });
  const setup = repository.getPreflopSetup();
  assert.equal(setup.id, DEFAULT_PREFLOP_VERSION_ID);
  assert.equal(setup.name, DEFAULT_PREFLOP_VERSION_NAME);
  assert.equal(setup.revision, 190);
  assert.deepEqual(setup.hands.AA, legacyHands.AA);
  assert.equal(repository.getActivePreflopVersionId(), DEFAULT_PREFLOP_VERSION_ID);
  assert.deepEqual(repository.listPreflopVersions().map(({ name }) => name), [DEFAULT_PREFLOP_VERSION_NAME]);
});

test('API tworzy domyślną wersję, zapisuje aktywny setup i zwraca listę wersji', async (context) => {
  const { baseUrl, dataDirectory } = await startApi(context);
  const initialResponse = await fetch(`${baseUrl}/api/ranges/preflop`);
  assert.equal(initialResponse.status, 200);
  const initial = await initialResponse.json();
  assert.equal(initial.activeVersionId, DEFAULT_PREFLOP_VERSION_ID);
  assert.equal(initial.versions.length, 1);
  assert.equal(initial.setup.name, DEFAULT_PREFLOP_VERSION_NAME);
  assert.deepEqual(initial.setup.hands.AA, { UTG: 0, HJ: 0, BTN: 0, SB: 0 });

  const hands = createHands();
  hands.AKo.UTG = 0;
  hands.KQs.BTN = 90;
  const saved = await putJson(`${baseUrl}/api/ranges/preflop`, { hands });
  assert.equal(saved.status, 200);
  const savedSetup = (await saved.json()).setup;
  assert.equal(savedSetup.id, DEFAULT_PREFLOP_VERSION_ID);
  assert.equal(savedSetup.revision, 2);
  assert.deepEqual(savedSetup.hands, hands);

  const loaded = await fetch(`${baseUrl}/api/ranges/preflop/versions/${DEFAULT_PREFLOP_VERSION_ID}`);
  assert.equal(loaded.status, 200);
  assert.deepEqual((await loaded.json()).setup.hands, hands);
  assert.equal(await fs.access(path.join(dataDirectory, RANGE_SETUP_DATABASE_FILENAME)).then(() => true, () => false), true);
});

test('API listuje i trwale przełącza aktywną wersję', async (context) => {
  const { baseUrl, dataDirectory } = await startApi(context);
  await fetch(`${baseUrl}/api/ranges/preflop`);
  const secondHands = createHands(100);
  const database = new DatabaseSync(path.join(dataDirectory, RANGE_SETUP_DATABASE_FILENAME));
  database.prepare(`
    INSERT INTO range_setup_versions (id, setup_id, name, setup_json, created_at, updated_at, revision)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'preflop-matrix-v2',
    PREFLOP_SETUP_ID,
    'Testowa wersja',
    JSON.stringify({ hands: secondHands }),
    '2026-08-18T12:00:00.000Z',
    '2026-08-18T12:00:00.000Z',
    1,
  );
  database.close();

  const versionsResponse = await fetch(`${baseUrl}/api/ranges/preflop/versions`);
  const versions = await versionsResponse.json();
  assert.equal(versions.versions.length, 2);
  assert.equal(versions.activeVersionId, DEFAULT_PREFLOP_VERSION_ID);

  const activate = await putJson(`${baseUrl}/api/ranges/preflop/active`, { versionId: 'preflop-matrix-v2' });
  assert.equal(activate.status, 200);
  assert.equal((await activate.json()).activeVersionId, 'preflop-matrix-v2');

  const reloaded = await fetch(`${baseUrl}/api/ranges/preflop`);
  const state = await reloaded.json();
  assert.equal(state.activeVersionId, 'preflop-matrix-v2');
  assert.equal(state.setup.name, 'Testowa wersja');
  assert.deepEqual(state.setup.hands, secondHands);
});

test('API odrzuca nieistniejącą wersję i niepełny setup', async (context) => {
  const { baseUrl } = await startApi(context);
  const missing = await putJson(`${baseUrl}/api/ranges/preflop/active`, { versionId: 'missing-version' });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, 'RANGE_VERSION_NOT_FOUND');

  const response = await putJson(`${baseUrl}/api/ranges/preflop`, {
    hands: { AA: { UTG: 50, HJ: 50, BTN: 50, SB: 50 } },
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'RANGE_SETUP_INVALID');
});

test('API zapisuje nazwę, kopiuje wersję i blokuje usunięcie ostatniej', async (context) => {
  const { baseUrl } = await startApi(context);
  await fetch(`${baseUrl}/api/ranges/preflop`);

  const renamed = await patchJson(`${baseUrl}/api/ranges/preflop/versions/${DEFAULT_PREFLOP_VERSION_ID}`, {
    name: 'Tight open',
  });
  assert.equal(renamed.status, 200);
  assert.equal((await renamed.json()).setup.name, 'Tight open');

  const emptyName = await patchJson(`${baseUrl}/api/ranges/preflop/versions/${DEFAULT_PREFLOP_VERSION_ID}`, { name: '   ' });
  assert.equal(emptyName.status, 400);
  assert.equal((await emptyName.json()).code, 'RANGE_VERSION_INVALID');

  const copied = await postJson(`${baseUrl}/api/ranges/preflop/versions/${DEFAULT_PREFLOP_VERSION_ID}/copy`);
  assert.equal(copied.status, 201);
  const copiedSetup = (await copied.json()).setup;
  assert.notEqual(copiedSetup.id, DEFAULT_PREFLOP_VERSION_ID);
  assert.equal(copiedSetup.name, 'Kopia — Tight open');
  assert.deepEqual(copiedSetup.hands, (await fetch(`${baseUrl}/api/ranges/preflop/versions/${DEFAULT_PREFLOP_VERSION_ID}`).then((response) => response.json())).setup.hands);

  const copiedHands = createHands(100);
  copiedHands.AA.UTG = 75;
  const savedCopy = await putJson(`${baseUrl}/api/ranges/preflop`, { hands: copiedHands });
  assert.equal(savedCopy.status, 200);
  const original = await fetch(`${baseUrl}/api/ranges/preflop/versions/${DEFAULT_PREFLOP_VERSION_ID}`);
  assert.deepEqual((await original.json()).setup.hands.AA, { UTG: 0, HJ: 0, BTN: 0, SB: 0 });

  const deletedCopy = await fetch(`${baseUrl}/api/ranges/preflop/versions/${copiedSetup.id}`, { method: 'DELETE' });
  assert.equal(deletedCopy.status, 200);
  const deleteResult = await deletedCopy.json();
  assert.equal(deleteResult.activeVersionId, DEFAULT_PREFLOP_VERSION_ID);
  assert.equal(deleteResult.versions.length, 1);

  const deletedLast = await fetch(`${baseUrl}/api/ranges/preflop/versions/${DEFAULT_PREFLOP_VERSION_ID}`, { method: 'DELETE' });
  assert.equal(deletedLast.status, 409);
  assert.equal((await deletedLast.json()).code, 'RANGE_VERSION_LAST_CANNOT_DELETE');
});
