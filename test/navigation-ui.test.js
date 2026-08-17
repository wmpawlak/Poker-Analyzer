import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, Fragment, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

class MemoryStorage {
  getItem() { return null; }
  setItem() {}
  removeItem() {}
}

globalThis.localStorage = new MemoryStorage();

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
  assert.match(html, /data-testid="nav-ranges"/);
  assert.match(html, /Zakresy/);
  assert.match(html, /bg-indigo-600/);
});

test('kliknięcie Zakresy zmienia aktywną zakładkę na ranges', async (context) => {
  const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
  context.after(() => vite.close());
  const { Sidebar } = await vite.ssrLoadModule('/src/components/Sidebar.jsx');

  const NavigationHarness = () => {
    const [activeTab, setActiveTab] = useState('profile');
    return createElement(Fragment, null,
      createElement(Sidebar, { activeTab, setActiveTab }),
      createElement('output', { 'data-testid': 'active-tab' }, activeTab),
    );
  };

  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById('root'));
  await act(() => root.render(createElement(NavigationHarness)));
  try {
    await act(() => document.querySelector('[data-testid="nav-ranges"]')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.equal(document.querySelector('[data-testid="active-tab"]').textContent, 'ranges');
  } finally {
    await act(() => root.unmount());
  }
});
