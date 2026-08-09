import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import { loadConfigFromFile } from 'vite';

test('Vite nie przeładowuje strony po zapisie wspólnego cache raportów AI', async () => {
  const loaded = await loadConfigFromFile(
    { command: 'serve', mode: 'development' },
    undefined,
    process.cwd(),
  );
  const ignored = loaded?.config?.server?.watch?.ignored;

  assert.ok(Array.isArray(ignored));
  assert.ok(ignored.includes('**/data/poker-ai-analyses-v1.json'));
  assert.ok(ignored.includes('**/data/poker-ai-analyses-v1.json.*.tmp'));
});
