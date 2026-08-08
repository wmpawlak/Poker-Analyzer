import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { calculateSessionMetrics } from '../src/utils/sessionMetrics.js';

test('SessionSummary renderuje trzy grupy, profil i dostępne opisy metryk', async (context) => {
  const vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false },
  });
  context.after(() => vite.close());

  const { SessionSummary } = await vite.ssrLoadModule('/src/components/SessionSummary.jsx');
  const metrics = calculateSessionMetrics([], 'tournament');
  const html = renderToStaticMarkup(createElement(SessionSummary, {
    metrics,
    accent: 'amber',
  }));

  assert.match(html, /Podsumowanie sesji/);
  assert.match(html, /aria-label="Preflop"/);
  assert.match(html, /aria-label="Postflop"/);
  assert.match(html, /aria-label="Wynik"/);
  assert.match(html, /Za mała próba/);
  assert.match(html, /RFI BTN\/SB HU/);
  assert.match(html, /AFq River/);
  assert.match(html, /W\$SD/);
  assert.match(html, /role="tooltip"/);
  assert.match(html, /aria-describedby=/);
  assert.match(html, /Wzór:/);
  assert.match(html, /Próba:/);
});
