import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { configureStore } from '@reduxjs/toolkit';
import { createServer } from 'vite';
import { createLargeSessionMonthFixture } from './fixtures/sessionMonthCatalog.js';

class MemoryStorage {
  getItem() { return null; }
  setItem() {}
  removeItem() {}
}
globalThis.localStorage = new MemoryStorage();

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (callback) => callback();
globalThis.cancelAnimationFrame = () => {};
globalThis.HTMLElement.prototype.scrollIntoView = () => {};

const resizeObservers = new Set();
const virtualRect = ({ top = 0, width = 600, height = 0 } = {}) => ({
  bottom: top + height, height, left: 0, right: width, top, width, x: 0, y: top,
  toJSON() { return this; },
});
class MockResizeObserver {
  constructor(callback) {
    this.callback = callback;
    this.targets = new Set();
    resizeObservers.add(this);
  }
  observe(target) {
    this.targets.add(target);
    this.notify(target);
  }
  notify(target) {
    const bounds = target.getBoundingClientRect();
    this.callback([{
      target,
      contentRect: bounds,
      borderBoxSize: [{ blockSize: bounds.height, inlineSize: bounds.width }],
    }]);
  }
  unobserve(target) { this.targets.delete(target); }
  disconnect() {
    this.targets.clear();
    resizeObservers.delete(this);
  }
}
globalThis.ResizeObserver = MockResizeObserver;
dom.window.ResizeObserver = MockResizeObserver;

const originalGetBoundingClientRect = globalThis.HTMLElement.prototype.getBoundingClientRect;
globalThis.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
  const scrollElement = document.querySelector('[data-testid="session-month-accordion"]');
  if (this === scrollElement) return virtualRect({ height: 720 });
  if (this.matches?.('[data-testid="virtual-session-list"]')) {
    const sections = [...scrollElement.querySelectorAll(':scope > section')];
    const sectionIndex = Math.max(0, sections.indexOf(this.closest('section')));
    return virtualRect({
      top: ((sectionIndex + 1) * 60) - (scrollElement?.scrollTop || 0),
      height: Number.parseFloat(this.style.height) || 0,
    });
  }
  if (this.getAttribute?.('role') === 'listitem') return virtualRect({ height: 104 });
  return originalGetBoundingClientRect.call(this);
};

const notifyResizeObservers = () => resizeObservers.forEach((observer) => {
  [...observer.targets].forEach((target) => observer.notify(target));
});

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
test.after(() => {
  globalThis.HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  return vite.close();
});
const { SessionMonthAccordion } = await vite.ssrLoadModule('/src/components/SessionMonthAccordion.jsx');
const pokerModule = await import('../src/store/pokerSlice.js');
const {
  createSessionMonthsQueryKey,
  fetchAllSessionsForQuery,
  fetchSessionMonth,
  fetchSessionMonths,
  default: pokerReducer,
} = pokerModule;

const jsonResponse = (body) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

const waitFor = async (predicate, message = 'Warunek testu strukturalnego nie zostal spelniony') => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  assert.fail(message);
};

const click = async (node) => {
  await act(() => node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  await act(() => notifyResizeObservers());
};

test('katalog 12 x 100 pozostawia w DOM tylko widoczny fragment aktywnego miesiaca', async () => {
  const fixture = createLargeSessionMonthFixture();
  assert.equal(fixture.sessions.length, 1_200);
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    calls.push(value);
    if (value.startsWith('/api/session-months')) {
      return jsonResponse({
        datasetRevision: fixture.datasetRevision,
        gameType: 'cash', handRanking: '', dateFrom: '', dateTo: '', availableRanks: [], months: fixture.months,
      });
    }
    const month = new URL(`http://local${value}`).searchParams.get('month');
    return jsonResponse({
      datasetRevision: fixture.datasetRevision,
      gameType: 'cash', handRanking: '', availableRanks: [],
      sessions: month ? fixture.sessionsByMonth[month] : fixture.sessions,
    });
  };

  const store = configureStore({ reducer: { poker: pokerReducer } });
  const query = { gameType: 'cash', handRanking: '', dateFrom: '', dateTo: '' };
  const queryKey = createSessionMonthsQueryKey(query);
  const CatalogHarness = () => {
    const [activeMonthKey, setActiveMonthKey] = useState(null);
    const state = useSyncExternalStore(store.subscribe, store.getState, store.getState).poker;
    return createElement(SessionMonthAccordion, {
      months: state.sessionMonthIndexes[queryKey]?.months || [],
      activeMonthKey,
      pagesByMonth: state.sessionMonthPages[queryKey] || {},
      onMonthToggle: setActiveMonthKey,
      onLoadMonth: (month) => { void store.dispatch(fetchSessionMonth({ ...query, month })); },
      onRetryMonth: (month) => { void store.dispatch(fetchSessionMonth({ ...query, month })); },
      renderSession: (session) => createElement('button', {
        key: session.id,
        type: 'button',
        'data-session-id': session.id,
        'data-testid': 'large-session-card',
      }, session.id),
    });
  };

  const root = createRoot(document.getElementById('root'));
  try {
    await act(() => store.dispatch(fetchSessionMonths(query)));
    await act(() => root.render(createElement(CatalogHarness)));
    assert.equal(calls.length, 1);
    assert.equal(document.querySelectorAll('[role="region"]').length, 0);
    assert.equal(document.querySelectorAll('[data-testid="large-session-card"]').length, 0);

    const newestMonth = fixture.months[0].key;
    await click(document.querySelector(`[data-month-key="${newestMonth}"] > div > button`));
    await waitFor(() => store.getState().poker.sessionMonthPages[queryKey]?.[newestMonth]?.status === 'succeeded');
    await waitFor(() => document.querySelector('[data-testid="virtual-session-list"]'));
    await act(() => notifyResizeObservers());
    await waitFor(() => document.querySelectorAll('[data-testid="large-session-card"]').length > 0);

    assert.equal(calls.length, 2);
    assert.equal(Object.keys(store.getState().poker.sessionSummariesById).length, 100);
    assert.equal(document.querySelectorAll('[role="region"]').length, 1);
    assert.equal(document.querySelectorAll('[role="list"]').length, 1);
    assert.equal(document.querySelectorAll('[role="listitem"]').length, document.querySelectorAll('[data-testid="large-session-card"]').length);
    assert.match(document.querySelector('[role="list"]').getAttribute('aria-label'), /100 sesji/);
    assert.equal(document.querySelector('[role="list"]').tabIndex, 0);
    document.querySelector('[role="list"]').focus();
    assert.equal(document.activeElement, document.querySelector('[role="list"]'));

    const initialMountedCount = document.querySelectorAll('[data-testid="large-session-card"]').length;
    assert.ok(initialMountedCount > 0 && initialMountedCount < 30);
    const firstSessionId = fixture.sessionsByMonth[newestMonth][0].id;
    const lastSessionId = fixture.sessionsByMonth[newestMonth].at(-1).id;
    const firstCard = document.querySelector(`[data-session-id="${firstSessionId}"]`);
    assert.ok(firstCard);
    firstCard.focus();
    await click(firstCard);
    assert.equal(document.activeElement, firstCard);

    const scrollElement = document.querySelector('[data-testid="session-month-accordion"]');
    scrollElement.scrollTop = 5_000;
    await act(() => scrollElement.dispatchEvent(new dom.window.Event('scroll')));
    await act(() => notifyResizeObservers());
    await waitFor(() => document.querySelectorAll('[data-testid="large-session-card"]').length >= 15);
    const middleMountedCount = document.querySelectorAll('[data-testid="large-session-card"]').length;
    assert.ok(middleMountedCount >= 15 && middleMountedCount <= 25);

    scrollElement.scrollTop = 10_000;
    await act(() => scrollElement.dispatchEvent(new dom.window.Event('scroll')));
    await act(() => notifyResizeObservers());
    await waitFor(() => document.querySelector(`[data-session-id="${lastSessionId}"]`));
    assert.equal(document.querySelector(`[data-session-id="${firstSessionId}"]`), null);
    assert.ok(document.querySelectorAll('[data-testid="large-session-card"]').length < 30);

    const secondMonth = fixture.months[1].key;
    await click(document.querySelector(`[data-month-key="${secondMonth}"] > div > button`));
    await waitFor(() => store.getState().poker.sessionMonthPages[queryKey]?.[secondMonth]?.status === 'succeeded');
    await waitFor(() => document.querySelector('[data-testid="virtual-session-list"]'));
    await act(() => notifyResizeObservers());
    await waitFor(() => document.querySelectorAll('[data-testid="large-session-card"]').length > 0);
    assert.equal(calls.length, 3);
    assert.equal(document.querySelectorAll('[role="region"]').length, 1);
    assert.equal(document.querySelector(`[data-session-id="${lastSessionId}"]`), null);
    assert.ok(document.querySelectorAll('[data-testid="large-session-card"]').length < 30);

    const secondHeader = document.querySelector(`[data-month-key="${secondMonth}"] > div > button`);
    secondHeader.focus();
    await click(secondHeader);
    assert.equal(document.querySelectorAll('[role="region"]').length, 0);
    assert.equal(document.querySelectorAll('[data-testid="large-session-card"]').length, 0);
    assert.equal(document.activeElement, secondHeader);

    await act(() => store.dispatch(fetchAllSessionsForQuery(query)));
    assert.equal(Object.keys(store.getState().poker.sessionSummariesById).length, 1_200);
    assert.equal(document.querySelectorAll('[role="region"]').length, 0);
    assert.equal(document.querySelectorAll('[data-testid="large-session-card"]').length, 0);
    assert.equal(calls.length, 4);

    await click(secondHeader);
    await waitFor(() => document.querySelector('[data-testid="virtual-session-list"]'));
    await act(() => notifyResizeObservers());
    await waitFor(() => document.querySelectorAll('[data-testid="large-session-card"]').length > 0);
    assert.equal(calls.length, 4);
    assert.ok(document.querySelectorAll('[data-testid="large-session-card"]').length < 30);
  } finally {
    await act(() => root.unmount());
    globalThis.fetch = originalFetch;
  }
});
