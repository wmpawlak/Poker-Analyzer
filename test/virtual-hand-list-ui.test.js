import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const hand = (id) => ({
  id,
  outcome: 'WON',
  netProfit: 10,
  heroCards: [],
  boardCards: [],
  handRanking: 'PAIR',
  position: 'BTN',
  dateStr: '2026/08/12',
  timeStr: '12:00:00',
});

test('lista rąk jest w naturalnym przepływie i ma dolny sentinel paginacji', async (context) => {
  const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
  context.after(() => vite.close());
  const { VirtualHandList } = await vite.ssrLoadModule('/src/components/VirtualHandList.jsx');
  const html = renderToStaticMarkup(createElement(VirtualHandList, {
    hands: [hand('first'), hand('second')],
    hasNextPage: true,
    onHandClick: () => {},
    onLoadMore: () => {},
  }));

  assert.match(html, /data-testid="virtual-hand-list"/);
  assert.match(html, /data-testid="hand-list-load-more"/);
  assert.equal((html.match(/PAIR/g) || []).length, 2);
  assert.doesNotMatch(html, /overflow-y-auto/);
  assert.doesNotMatch(html, /position:absolute/);
});
