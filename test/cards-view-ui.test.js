import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { Provider } from 'react-redux';
import { renderToStaticMarkup } from 'react-dom/server';
import { configureStore } from '@reduxjs/toolkit';
import { createServer } from 'vite';

class MemoryStorage {
  getItem() { return null; }
  setItem() {}
  removeItem() {}
}
globalThis.localStorage = new MemoryStorage();

const { default: pokerReducer } = await import('../src/store/pokerSlice.js');

test('widok kart nie dziedziczy dat profilu i pokazuje metadane kompletności', async (context) => {
  const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
  context.after(() => vite.close());
  const base = pokerReducer(undefined, { type: '@@init' });
  const store = configureStore({
    reducer: { poker: pokerReducer },
    preloadedState: { poker: {
      ...base,
      filters: { ...base.filters, dateFrom: '2026-01-01', dateTo: '2026-01-31', cardsDateFrom: '', cardsDateTo: '' },
      aggregates: {
        ...base.aggregates,
        cards: {
          ...base.aggregates.cards,
          status: 'succeeded',
          data: {
            hands: [], indexedHandCount: 18_032, populatedClassCount: 169,
            excludedByReason: { unsupportedVariant: 7, invalidHeroCards: 2 },
          },
        },
      },
    } },
  });
  const { CardsView } = await vite.ssrLoadModule('/src/views/CardsView.jsx');
  const html = renderToStaticMarkup(createElement(Provider, { store }, createElement(CardsView)));

  assert.match(html, /Zakres kart:.*cała historia/);
  assert.match(html, /aria-label="Zakres dat kart startowych"/);
  assert.match(html, /Zindeksowane:.*18,?032/);
  assert.match(html, /Klasy:.*169\/169/);
  assert.match(html, /Pominięto warianty poza NLH i NLH BombPot:.*7/);
});
