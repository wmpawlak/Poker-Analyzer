import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { createServer } from 'vite';

class MemoryStorage {
  getItem() { return null; }
  setItem() {}
  removeItem() {}
}

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.localStorage = new MemoryStorage();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (callback) => callback();
globalThis.cancelAnimationFrame = () => {};
dom.window.requestAnimationFrame = globalThis.requestAnimationFrame;
dom.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
globalThis.HTMLElement.prototype.scrollIntoView = () => {};

const resizeObservers = new Set();
const virtualRect = ({ top = 0, width = 500, height = 0 } = {}) => ({
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
    this.callback([{ target, contentRect: bounds, borderBoxSize: [{ blockSize: bounds.height, inlineSize: bounds.width }] }]);
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
  if (this === scrollElement) return virtualRect({ height: 600 });
  if (this.matches?.('[data-testid="virtual-session-list"]')) {
    return virtualRect({ top: 60 - (scrollElement?.scrollTop || 0), height: Number.parseFloat(this.style.height) || 0 });
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
const { SessionBrowserView } = await vite.ssrLoadModule('/src/components/SessionBrowserView.jsx');
const { default: pokerReducer, selectSession } = await import('../src/store/pokerSlice.js');

const makeSession = ({ id, dateStr, startTime, totalProfit, fingerprint = `fingerprint-${id}` }) => ({
  id,
  type: 'Cash',
  tableId: id,
  tourneyId: '',
  tourneyName: '',
  startTime,
  lastTimestamp: startTime,
  dateStr,
  totalProfit,
  fingerprint,
  handCount: 2,
  matchingHandCount: 2,
  rebuys: 0,
  startStack: null,
  mergedFromSessionIds: [],
});

const augustA = makeSession({ id: 'august-a', dateStr: '2026/08/20', startTime: 200, totalProfit: 1 });
const augustB = makeSession({ id: 'august-b', dateStr: '2026/08/10', startTime: 100, totalProfit: 20 });
const july = makeSession({ id: 'july', dateStr: '2026/07/05', startTime: 50, totalProfit: -2 });
const descriptors = [
  { key: '2026-08', year: 2026, month: 8, sessionCount: 2, handCount: 4, matchingHandCount: 4, cashSessionCount: 2, tournamentSessionCount: 0 },
  { key: '2026-07', year: 2026, month: 7, sessionCount: 1, handCount: 2, matchingHandCount: 2, cashSessionCount: 1, tournamentSessionCount: 0 },
];

const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const waitFor = async (predicate, message = 'Warunek nie został spełniony') => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (predicate()) return;
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  assert.fail(message);
};

const click = async (node) => {
  await act(() => node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  await act(() => notifyResizeObservers());
};
const change = async (node, value) => {
  await act(() => {
    node.value = value;
    node.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  await act(() => notifyResizeObservers());
};

const mountBrowser = async ({ gameType = 'cash', selectedSessionId = null, selectedTourneyId = null, sessionAiAnalyses = {} } = {}) => {
  document.body.innerHTML = '<div id="root"></div>';
  const base = pokerReducer(undefined, { type: '@@init' });
  const store = configureStore({
    reducer: { poker: pokerReducer },
    preloadedState: {
      poker: {
        ...base,
        dataset: { ...base.dataset, datasetRevision: 'revision-1' },
        selectedSessionId,
        selectedTourneyId,
        sessionAiAnalyses,
      },
    },
  });
  const root = createRoot(document.getElementById('root'));
  await act(() => root.render(createElement(Provider, { store }, createElement(SessionBrowserView, {
    gameType,
    onHandClick: () => {},
  }))));
  return { root, store };
};

const installApiMock = ({ calls, directSession = null }) => {
  globalThis.fetch = async (url, options = {}) => {
    const value = String(url);
    calls.push({ url: value, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    if (value.startsWith('/api/session-months')) {
      return response({
        datasetRevision: 'revision-1', gameType: 'cash', handRanking: '', dateFrom: '', dateTo: '',
        availableRanks: [{ id: 'PAIR', count: 6 }], months: descriptors,
      });
    }
    if (value === '/api/session-summaries/query') {
      return response({ datasetRevision: 'revision-1', sessions: directSession ? [directSession] : [], missingSessionIds: directSession ? [] : ['missing'] });
    }
    if (/^\/api\/sessions\/[^/]+\/hands/.test(value)) {
      const sessionId = decodeURIComponent(value.split('/')[3]);
      return response({ datasetRevision: 'revision-1', sessionId, handRanking: '', sortBy: 'date', sortOrder: 'desc', hands: [], total: 0, nextCursor: null });
    }
    if (/^\/api\/sessions\/[^/?]+$/.test(value)) {
      const sessionId = decodeURIComponent(value.split('/')[3]);
      const found = [augustA, augustB, july, directSession].find((item) => item?.id === sessionId);
      return response({ datasetRevision: 'revision-1', session: found ? { ...found, metrics: null, chartData: [] } : null });
    }
    if (value.startsWith('/api/sessions?')) {
      const month = new URL(`http://local${value}`).searchParams.get('month');
      const sessions = month === '2026-08'
        ? [augustA, augustB]
        : month === '2026-07' ? [july] : [augustA, augustB, july];
      return response({ datasetRevision: 'revision-1', gameType: 'cash', handRanking: '', availableRanks: [], sessions });
    }
    throw new Error(`Nieobsłużone żądanie testowe: ${value}`);
  };
};

test('pierwszy render pobiera tylko indeks, a miesiące ładuje po rozwinięciu i zachowuje w cache', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  installApiMock({ calls });
  const { root } = await mountBrowser();
  try {
    await waitFor(() => document.querySelector('[data-month-key="2026-08"]'));
    assert.equal(calls.filter(({ url }) => url.startsWith('/api/session-months')).length, 1);
    assert.equal(calls.filter(({ url }) => url.startsWith('/api/sessions?')).length, 0);
    assert.equal(document.querySelectorAll('[role="region"]').length, 0);
    await click(document.querySelector('[data-month-key="2026-08"] button'));
    await waitFor(() => document.body.textContent.includes('Stół #august-a'));
    const listRequests = calls.filter(({ url }) => url.startsWith('/api/sessions?'));
    assert.equal(listRequests.length, 1);
    assert.equal(new URL(`http://local${listRequests[0].url}`).searchParams.get('month'), '2026-08');
    assert.equal(calls.some(({ url }) => url === '/api/sessions?gameType=cash'), false);
    assert.match(document.body.textContent, /Sortuj sesje w miesiącu/);
    assert.equal(document.querySelectorAll('[role="region"]').length, 1);

    await click(document.querySelector('[aria-label^="Lipiec 2026"]'));
    await waitFor(() => document.body.textContent.includes('Stół #july'));
    assert.equal(document.body.textContent.includes('Stół #august-a'), false);
    assert.equal(document.querySelectorAll('[role="region"]').length, 1);

    const julyHeader = document.querySelector('[aria-label^="Lipiec 2026"]');
    await click(julyHeader);
    assert.equal(document.querySelectorAll('[role="region"]').length, 0);
    await click(julyHeader);
    await waitFor(() => document.body.textContent.includes('Stół #july'));
    assert.equal(calls.filter(({ url }) => url.startsWith('/api/sessions?') && new URL(`http://local${url}`).searchParams.get('month') === '2026-07').length, 1);

    await click(document.querySelector('[aria-label^="Sierpień 2026"]'));
    await waitFor(() => document.body.textContent.includes('Stół #august-a'));
    const sessionSort = [...document.querySelectorAll('select')].find((select) => select.parentElement?.textContent.includes('Sortuj sesje w miesiącu'));
    await change(sessionSort, 'profit');
    await waitFor(() => document.querySelector('[role="region"]'));
    const regionText = document.querySelector('[role="region"]').textContent;
    assert.ok(regionText.indexOf('Stół #august-b') < regionText.indexOf('Stół #august-a'));
    assert.equal(calls.filter(({ url }) => url.startsWith('/api/sessions?') && new URL(`http://local${url}`).searchParams.get('month') === '2026-08').length, 1);
  } finally {
    await act(() => root.unmount());
    globalThis.fetch = originalFetch;
  }
});

test('filtr raportu sesji odświeża indeks z parametrem API bez pełnego pobrania sesji', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  installApiMock({ calls });
  const { root } = await mountBrowser();
  try {
    await waitFor(() => document.querySelector('[data-month-key="2026-08"]'));
    assert.equal(calls.filter(({ url }) => url.startsWith('/api/sessions?')).length, 0);
    await click(document.querySelector('[data-month-key="2026-08"] button'));
    await waitFor(() => document.body.textContent.includes('Stół #august-a'));
    const fullRequests = () => calls.filter(({ url }) => {
      if (!url.startsWith('/api/sessions?')) return false;
      return !new URL(`http://local${url}`).searchParams.has('month');
    });
    assert.equal(fullRequests().length, 0);
    const reportSelect = [...document.querySelectorAll('select')].find((select) => select.closest('label')?.textContent.includes('Raport sesji'));
    await change(reportSelect, 'has');
    await waitFor(() => calls.filter(({ url }) => new URL(`http://local${url}`).searchParams.get('sessionAnalysis') === 'has').length === 1);
    assert.equal(document.querySelectorAll('[role="region"]').length, 0);
    assert.equal(fullRequests().length, 0);
  } finally {
    await act(() => root.unmount());
    globalThis.fetch = originalFetch;
  }
});

test('bezpośredni wybór rozwiązuje lekkie ID, ale pozostawia miesiące zwinięte do kliknięcia', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  installApiMock({ calls, directSession: july });
  const { root, store } = await mountBrowser({ selectedSessionId: july.id });
  try {
    await waitFor(() => calls.some(({ url }) => url === '/api/session-summaries/query'));
    assert.equal(store.getState().poker.selectedSessionId, july.id);
    assert.equal(document.querySelector('[aria-label^="Lipiec 2026"]').getAttribute('aria-expanded'), 'false');
    assert.equal(document.querySelectorAll('[role="region"]').length, 0);
    assert.equal(calls.filter(({ url }) => url === '/api/session-summaries/query').length, 1);
    assert.equal(calls.filter(({ url }) => url.startsWith('/api/sessions?')).length, 0);
    assert.equal(calls.some(({ url }) => url.startsWith(`/api/sessions/${july.id}/hands`)), true);

    await click(document.querySelector('[aria-label^="Lipiec 2026"]'));
    await waitFor(() => document.body.textContent.includes('Stół #july'));
    assert.equal(document.querySelector('[aria-label^="Lipiec 2026"]').getAttribute('aria-expanded'), 'true');
    store.dispatch(selectSession(july.id));
    await click(document.querySelector('[aria-label^="Lipiec 2026"]'));
    assert.equal(store.getState().poker.selectedSessionId, july.id);
    assert.match(document.body.textContent, /Wybierz sesję Cash|Rozegrane ręce/);
  } finally {
    await act(() => root.unmount());
    globalThis.fetch = originalFetch;
  }
});

const installVirtualizedApiMock = ({ calls, gameType, virtualSessions }) => {
  globalThis.fetch = async (url, options = {}) => {
    const value = String(url);
    calls.push({ url: value, method: options.method || 'GET' });
    if (value.startsWith('/api/session-months')) {
      return response({
        datasetRevision: 'revision-1', gameType, handRanking: '', dateFrom: '', dateTo: '', availableRanks: [],
        months: [{
          key: '2026-08', year: 2026, month: 8, sessionCount: virtualSessions.length,
          handCount: virtualSessions.length * 2, matchingHandCount: virtualSessions.length * 2,
          cashSessionCount: gameType === 'cash' ? virtualSessions.length : 0,
          tournamentSessionCount: gameType === 'tournament' ? virtualSessions.length : 0,
        }],
      });
    }
    if (/^\/api\/sessions\/[^/]+\/hands/.test(value)) {
      const sessionId = decodeURIComponent(value.split('/')[3]);
      return response({ datasetRevision: 'revision-1', sessionId, handRanking: '', sortBy: 'date', sortOrder: 'desc', hands: [], total: 0, nextCursor: null });
    }
    if (/^\/api\/sessions\/[^/?]+$/.test(value)) {
      const sessionId = decodeURIComponent(value.split('/')[3]);
      const found = virtualSessions.find((session) => session.id === sessionId);
      return response({ datasetRevision: 'revision-1', session: found ? { ...found, metrics: null, chartData: [{ hand: 1, value: 0 }] } : null });
    }
    if (value.startsWith('/api/sessions?')) {
      return response({ datasetRevision: 'revision-1', gameType, handRanking: '', availableRanks: [], sessions: virtualSessions });
    }
    throw new Error(`NieobsĹ‚uĹĽone ĹĽÄ…danie testowe: ${value}`);
  };
};

test('wirtualne listy Cash i Turniejow zachowuja pobieranie, wybor spoza viewportu i sortowanie', async (context) => {
  for (const gameType of ['cash', 'tournament']) {
    await context.test(gameType, async () => {
      const originalFetch = globalThis.fetch;
      const calls = [];
      const virtualSessions = Array.from({ length: 40 }, (_, index) => ({
        ...makeSession({
          id: `${gameType}-virtual-${index}`,
          dateStr: '2026/08/10',
          startTime: index + 1,
          totalProfit: -index,
        }),
        type: gameType === 'cash' ? 'Cash' : 'Tournament',
        tableId: gameType === 'cash' ? `V${index}` : '',
        tourneyId: gameType === 'tournament' ? `T${index}` : '',
        tourneyName: gameType === 'tournament' ? `Virtual ${index}` : '',
      }));
      installVirtualizedApiMock({ calls, gameType, virtualSessions });
      const { root, store } = await mountBrowser({ gameType });
      const label = (index) => (gameType === 'cash' ? `V${index}` : `Virtual ${index}`);
      try {
        await waitFor(() => document.querySelector('[data-month-key="2026-08"]'));
        await click(document.querySelector('[data-month-key="2026-08"] button'));
        await waitFor(() => document.querySelector('[data-testid="virtual-session-list"]'));
        await waitFor(() => document.querySelector('[role="listitem"]')?.textContent.includes(label(39)));

        const selectedKey = gameType === 'cash' ? 'selectedSessionId' : 'selectedTourneyId';
        assert.equal(store.getState().poker[selectedKey], `${gameType}-virtual-39`);
        assert.equal(calls.filter(({ url }) => url.startsWith('/api/sessions?')).length, 1);
        assert.ok(calls.some(({ url }) => url === `/api/sessions/${gameType}-virtual-39`));
        assert.ok(calls.some(({ url }) => url.startsWith(`/api/sessions/${gameType}-virtual-39/hands`)));
        assert.ok(document.querySelectorAll('[role="listitem"]').length < 30);

        const scrollElement = document.querySelector('[data-testid="session-month-accordion"]');
        scrollElement.scrollTop = 3_900;
        await act(() => scrollElement.dispatchEvent(new dom.window.Event('scroll')));
        await act(() => notifyResizeObservers());
        await waitFor(() => [...document.querySelectorAll('[role="listitem"]')].some((item) => item.textContent.includes(label(0))));
        const lastCard = [...document.querySelectorAll('[role="listitem"]')]
          .find((item) => item.textContent.includes(label(0)))?.firstElementChild;
        await click(lastCard);
        await waitFor(() => store.getState().poker[selectedKey] === `${gameType}-virtual-0`);
        assert.ok(calls.some(({ url }) => url === `/api/sessions/${gameType}-virtual-0`));
        assert.ok(calls.some(({ url }) => url.startsWith(`/api/sessions/${gameType}-virtual-0/hands`)));

        const sessionSort = [...document.querySelectorAll('select')]
          .find((select) => select.parentElement?.textContent.includes('Sortuj sesje w miesiącu'));
        await change(sessionSort, 'profit');
        await act(() => scrollElement.dispatchEvent(new dom.window.Event('scroll')));
        await act(() => notifyResizeObservers());
        await waitFor(() => document.querySelector('[role="listitem"]')?.textContent.includes(label(0)));
        assert.ok(scrollElement.scrollTop <= 60);
        assert.ok(document.querySelectorAll('[role="listitem"]').length < 30);
        assert.equal(calls.filter(({ url }) => url.startsWith('/api/sessions?')).length, 1);
      } finally {
        await act(() => root.unmount());
        globalThis.fetch = originalFetch;
      }
    });
  }
});
