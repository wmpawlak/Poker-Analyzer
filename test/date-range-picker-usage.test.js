import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const sourcePath = (relativePath) => fileURLToPath(new URL(`../src/${relativePath}`, import.meta.url));

test('wszystkie widoki używają wspólnego pickera bez natywnych pól dat', async () => {
  const sources = await Promise.all([
    'views/ProfileViews.jsx',
    'components/SessionGroupAnalysisView.jsx',
    'views/CardsView.jsx',
    'views/WalletView.jsx',
  ].map((path) => readFile(sourcePath(path), 'utf8')));
  const combined = sources.join('\n');

  assert.doesNotMatch(combined, /type\s*=\s*["']date["']/i);
  assert.match(sources[0], /data-testid="profile-date-range"/);
  assert.match(sources[0], /data-testid="opponents-date-range"/);
  assert.match(sources[1], /data-testid="session-group-date-range"/);
  assert.match(sources[2], /data-testid="cards-date-range"/);
  assert.match(sources[3], /data-testid="wallet-date-range"/);
  sources.forEach((source) => assert.match(source, /DateRangePicker/));
});
