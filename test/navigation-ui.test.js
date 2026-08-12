import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

class MemoryStorage {
  getItem() { return null; }
  setItem() {}
  removeItem() {}
}

globalThis.localStorage = new MemoryStorage();

test('sidebar ma osobne zakładki analizy wielu sesji i ćwiczeń', async (context) => {
  const vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false },
  });
  context.after(() => vite.close());

  const { default: pokerReducer } = await vite.ssrLoadModule('/src/store/pokerSlice.js');
  const { Sidebar } = await vite.ssrLoadModule('/src/components/Sidebar.jsx');
  const store = configureStore({ reducer: { poker: pokerReducer } });
  const html = renderToStaticMarkup(createElement(
    Provider,
    { store },
    createElement(Sidebar, { activeTab: 'session-group-analysis', setActiveTab: () => {} }),
  ));

  assert.match(html, /data-testid="nav-session-group-analysis"/);
  assert.match(html, /Analiza wielu sesji/);
  assert.match(html, /data-testid="nav-training"/);
  assert.match(html, /Ćwiczenia/);
  assert.match(html, /bg-indigo-600/);
});
