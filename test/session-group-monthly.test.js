import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement, useState } from 'react';
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
const { SessionGroupAnalysisView } = await vite.ssrLoadModule('/src/components/SessionGroupAnalysisView.jsx');
const { default: pokerReducer } = await import('../src/store/pokerSlice.js');

const cash = {
  id: 'cash-august', type: 'Cash', tableId: 'August', startTime: Date.parse('2026-08-10T12:00:00Z'),
  dateStr: '2026/08/10', handCount: 10, matchingHandCount: 10, fingerprint: 'cash-fingerprint', totalProfit: 5,
};
const tournament = {
  id: 'tournament-july', type: 'Tournament', tourneyId: 'T-July', tourneyName: 'July Major',
  startTime: Date.parse('2026-07-10T12:00:00Z'), dateStr: '2026/07/10', handCount: 12,
  matchingHandCount: 12, fingerprint: 'tournament-fingerprint', totalProfit: 100,
};
const months = [
  { key: '2026-08', year: 2026, month: 8, sessionCount: 1, handCount: 10, matchingHandCount: 10, cashSessionCount: 1, tournamentSessionCount: 0 },
  { key: '2026-07', year: 2026, month: 7, sessionCount: 1, handCount: 12, matchingHandCount: 12, cashSessionCount: 0, tournamentSessionCount: 1 },
];

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const waitFor = async (predicate, message = 'Warunek nie został spełniony') => {
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

const installFetch = ({ calls, historicalSession = null }) => {
  globalThis.fetch = async (url, options = {}) => {
    const value = String(url);
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: value, method: options.method || 'GET', body });
    if (value.startsWith('/api/session-months')) {
      const params = new URL(`http://local${value}`).searchParams;
      const gameType = params.get('gameType');
      const filteredMonths = gameType === 'cash' ? [months[0]] : gameType === 'tournament' ? [months[1]] : months;
      return jsonResponse({ datasetRevision: 'revision-1', gameType, handRanking: '', dateFrom: params.get('dateFrom') || '', dateTo: params.get('dateTo') || '', availableRanks: [], months: filteredMonths });
    }
    if (value === '/api/session-summaries/query') {
      const known = [cash, tournament, historicalSession].filter(Boolean);
      const sessions = body.sessionIds.map((id) => known.find((session) => session.id === id)).filter(Boolean);
      return jsonResponse({ datasetRevision: 'revision-1', sessions, missingSessionIds: body.sessionIds.filter((id) => !sessions.some((session) => session.id === id)) });
    }
    if (value === '/api/session-groups/preview') {
      return jsonResponse({
        datasetRevision: 'revision-1', activeCategory: 'both', dateRange: { from: '2026-07-10', to: '2026-08-10' },
        sources: body.sessionIds.map((sessionId) => ({ sessionId })), sessionCount: body.sessionIds.length,
        handCount: 22, categoryBreakdown: { cash: { sessionCount: 1, handCount: 10 }, tournament: { sessionCount: 1, handCount: 12 } },
        metrics: { shared: { vpip: { value: 20 }, pfr: { value: 15 }, af: { value: 2 }, wtsd: { value: 25 } } },
      });
    }
    if (value.startsWith('/api/sessions?')) {
      const month = new URL(`http://local${value}`).searchParams.get('month');
      const sessions = month === '2026-08' ? [cash] : month === '2026-07' ? [tournament] : [cash, tournament];
      return jsonResponse({ datasetRevision: 'revision-1', gameType: 'both', handRanking: '', availableRanks: [], sessions });
    }
    throw new Error(`Nieobsłużone żądanie: ${value}`);
  };
};

const mountView = async ({ groupReports = [], initialSelection = [] } = {}) => {
  document.body.innerHTML = '<div id="root"></div>';
  const base = pokerReducer(undefined, { type: '@@init' });
  const store = configureStore({
    reducer: { poker: pokerReducer },
    preloadedState: { poker: {
      ...base,
      dataset: { ...base.dataset, datasetRevision: 'revision-1' },
      sessionGroupAiAnalyses: groupReports,
    } },
  });
  const Harness = () => {
    const [gameType, setGameType] = useState('both');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [selected, setSelected] = useState(initialSelection);
    return createElement('div', null,
      createElement('output', { 'data-testid': 'selected-ids' }, JSON.stringify(selected)),
      createElement('button', { type: 'button', 'data-testid': 'set-date-filter', onClick: () => setDateFrom('2026-09-01') }, 'Ustaw zakres testowy'),
      createElement(SessionGroupAnalysisView, {
        gameType,
        onGameTypeChange: setGameType,
        dateRange: { from: dateFrom, to: dateTo },
        onDateRangeChange: ({ from, to }) => { setDateFrom(from); setDateTo(to); },
        selectedSourceIds: selected,
        onSelectedSourceIdsChange: setSelected,
      }));
  };
  const root = createRoot(document.getElementById('root'));
  await act(() => root.render(createElement(Provider, { store }, createElement(Harness))));
  return { root, store };
};

test('zaznaczenia trwają między miesiącami, liczniki są widoczne, a preview dostaje wszystkie ID', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  installFetch({ calls });
  const { root } = await mountView();
  try {
    await waitFor(() => document.querySelector('[data-month-key="2026-08"]'));
    assert.equal(calls.filter(({ url }) => url.startsWith('/api/sessions?')).length, 0);
    assert.equal(document.querySelectorAll('[role="region"]').length, 0);
    await click(document.querySelector('[data-month-key="2026-08"] button'));
    await waitFor(() => document.body.textContent.includes('Stół August'));
    assert.equal(calls.filter(({ url }) => url.startsWith('/api/sessions?')).length, 1);
    await click(document.querySelector('[aria-label^="Zaznacz sesję: Stół August"]'));
    await click(document.querySelector('[aria-label^="Lipiec 2026"]'));
    await waitFor(() => document.body.textContent.includes('July Major'));
    await click(document.querySelector('[aria-label^="Lipiec 2026"]'));
    assert.equal(document.querySelectorAll('[role="region"]').length, 0);
    assert.equal(document.body.textContent.includes('July Major'), false);
    await click(document.querySelector('[aria-label^="Lipiec 2026"]'));
    await waitFor(() => document.body.textContent.includes('July Major'));
    assert.equal(document.body.textContent.includes('Stół August'), false);
    await click(document.querySelector('[aria-label^="Zaznacz sesję: July Major"]'));
    assert.equal(document.querySelector('[data-testid="selected-ids"]').textContent, '["cash-august","tournament-july"]');
    assert.equal(document.querySelectorAll('[role="region"]').length, 1);
    assert.match(document.querySelector('[data-month-key="2026-08"]').textContent, /Wybrane: 1/);
    assert.match(document.querySelector('[data-month-key="2026-07"]').textContent, /Wybrane: 1/);
    await waitFor(() => calls.some(({ url, body }) => url === '/api/session-groups/preview' && body.sessionIds.length === 2));
  } finally {
    await act(() => root.unmount());
    globalThis.fetch = originalFetch;
  }
});

const installVirtualizedGroupFetch = ({ calls, virtualSessions }) => {
  globalThis.fetch = async (url, options = {}) => {
    const value = String(url);
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: value, method: options.method || 'GET', body });
    if (value.startsWith('/api/session-months')) {
      return jsonResponse({
        datasetRevision: 'revision-1', gameType: 'both', handRanking: '', dateFrom: '', dateTo: '', availableRanks: [],
        months: [{
          key: '2026-08', year: 2026, month: 8, sessionCount: virtualSessions.length,
          handCount: virtualSessions.length * 10, matchingHandCount: virtualSessions.length * 10,
          cashSessionCount: virtualSessions.length, tournamentSessionCount: 0,
        }],
      });
    }
    if (value === '/api/session-groups/preview') {
      return jsonResponse({
        datasetRevision: 'revision-1', activeCategory: 'both', dateRange: { from: '', to: '' },
        sources: body.sessionIds.map((sessionId) => ({ sessionId })), sessionCount: body.sessionIds.length,
        handCount: body.sessionIds.length * 10,
        categoryBreakdown: { cash: { sessionCount: body.sessionIds.length, handCount: body.sessionIds.length * 10 }, tournament: { sessionCount: 0, handCount: 0 } },
        metrics: { shared: { vpip: { value: 20 }, pfr: { value: 15 }, af: { value: 2 }, wtsd: { value: 25 } } },
      });
    }
    if (value === '/api/ai/analyze-session') {
      const session = virtualSessions.find(({ id }) => id === body.sessionId);
      return jsonResponse({
        model: { id: 'test-model', name: 'Test model' }, sessionId: body.sessionId,
        fingerprint: session.fingerprint, datasetRevision: 'revision-1', analysis: { summary: 'Test' },
      });
    }
    if (value.startsWith('/api/sessions?')) {
      return jsonResponse({ datasetRevision: 'revision-1', gameType: 'both', handRanking: '', availableRanks: [], sessions: virtualSessions });
    }
    throw new Error(`NieobsĹ‚uĹĽone ĹĽÄ…danie: ${value}`);
  };
};

test('wirtualna analiza wielu sesji zachowuje wybor, akcje i pelny preview poza DOM', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const virtualSessions = Array.from({ length: 40 }, (_, index) => ({
    id: `group-virtual-${index}`,
    type: 'Cash',
    tableId: `Group ${index}`,
    startTime: Date.parse('2026-08-01T00:00:00Z') + index,
    dateStr: '2026/08/01',
    handCount: 10,
    matchingHandCount: 10,
    fingerprint: `group-fingerprint-${index}`,
    totalProfit: index,
  }));
  installVirtualizedGroupFetch({ calls, virtualSessions });
  const { root } = await mountView();
  try {
    await waitFor(() => document.querySelector('[data-month-key="2026-08"]'));
    await click(document.querySelector('[data-month-key="2026-08"] button'));
    await waitFor(() => document.querySelector('[data-testid="virtual-session-list"]'));
    await act(() => notifyResizeObservers());
    assert.ok(document.querySelectorAll('[role="listitem"]').length < 30);

    const newestArticle = document.querySelector('[data-session-id="group-virtual-39"]');
    await click(newestArticle.querySelector('button'));
    assert.equal(JSON.parse(document.querySelector('[data-testid="selected-ids"]').textContent).includes('group-virtual-39'), true);

    const scrollElement = document.querySelector('[data-testid="session-month-accordion"]');
    scrollElement.scrollTop = 3_900;
    await act(() => scrollElement.dispatchEvent(new dom.window.Event('scroll')));
    await act(() => notifyResizeObservers());
    await waitFor(() => document.querySelector('[data-session-id="group-virtual-0"]'));
    await click(document.querySelector('[data-session-id="group-virtual-0"] button'));
    assert.match(document.querySelector('[data-month-key="2026-08"]').textContent, /Wybrane: 2/);

    scrollElement.scrollTop = 60;
    await act(() => scrollElement.dispatchEvent(new dom.window.Event('scroll')));
    await act(() => notifyResizeObservers());
    await waitFor(() => document.querySelector('[data-session-id="group-virtual-39"]'));
    const remountedArticle = document.querySelector('[data-session-id="group-virtual-39"]');
    assert.match(remountedArticle.querySelector('button').getAttribute('aria-label'), /^Odznacz/);
    await click(remountedArticle.querySelectorAll('button')[2]);
    await waitFor(() => calls.some(({ url, body }) => url === '/api/ai/analyze-session' && body.sessionId === 'group-virtual-39'));

    await click(document.querySelector('[aria-label="Zaznacz widoczne sesje"]'));
    await waitFor(() => JSON.parse(document.querySelector('[data-testid="selected-ids"]').textContent).length === 40);
    assert.ok(document.querySelectorAll('[role="listitem"]').length < 30);
    await waitFor(() => calls.some(({ url, body }) => url === '/api/session-groups/preview' && body.sessionIds.length === 40));
  } finally {
    await act(() => root.unmount());
    globalThis.fetch = originalFetch;
  }
});

test('Zaznacz widoczne nawadnia pełny zakres bez montowania zamkniętych miesięcy, a filtr usuwa tylko niepasujące ID', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  installFetch({ calls });
  const { root } = await mountView();
  try {
    await waitFor(() => document.querySelector('[data-month-key="2026-08"]'));
    assert.equal(calls.filter(({ url }) => url.startsWith('/api/sessions?')).length, 0);
    assert.equal(document.querySelectorAll('[role="region"]').length, 0);
    assert.equal(calls.filter(({ url }) => url.startsWith('/api/sessions?') && !new URL(`http://local${url}`).searchParams.has('month')).length, 0);
    await click(document.querySelector('[aria-label="Zaznacz widoczne sesje"]'));
    await waitFor(() => document.querySelector('[data-testid="selected-ids"]').textContent.includes('tournament-july'));
    assert.equal(calls.filter(({ url }) => url.startsWith('/api/sessions?') && !new URL(`http://local${url}`).searchParams.has('month')).length, 1);
    assert.equal(document.querySelectorAll('[role="region"]').length, 0);
    assert.equal(document.body.textContent.includes('July Major'), false);

    await click([...document.querySelectorAll('[data-testid="session-group-game-type"] button')].find((button) => button.textContent === 'Cash'));
    await waitFor(() => document.querySelector('[data-testid="selected-ids"]').textContent === '["cash-august"]');
    assert.equal(document.querySelector('[data-testid="selected-ids"]').textContent, '["cash-august"]');
    await click(document.querySelector('[data-testid="set-date-filter"]'));
    await waitFor(() => document.querySelector('[data-testid="selected-ids"]').textContent === '[]');
  } finally {
    await act(() => root.unmount());
    globalThis.fetch = originalFetch;
  }
});

test('raport historyczny rozwiązuje niezaładowane źródło lekkim zapytaniem bez pełnej listy', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const historical = { ...tournament, id: 'historical-june', dateStr: '2026/06/01', fingerprint: 'historical-fingerprint' };
  installFetch({ calls, historicalSession: historical });
  const report = {
    reportId: 'historical-report', analyzedAt: '2026-08-01T00:00:00.000Z', model: { name: 'Model historyczny' },
    sources: [{ sourceId: 'tournament:historical-june', type: 'tournament', sessionId: historical.id, sessionFingerprint: historical.fingerprint, metadata: { label: 'Historyczny turniej', handCount: 12 } }],
    analysis: { summary: 'Raport historyczny.' },
  };
  const { root } = await mountView({ groupReports: [report] });
  try {
    await waitFor(() => calls.some(({ url }) => url === '/api/session-summaries/query'));
    await waitFor(() => document.querySelector('[aria-label="Otwórz sesję: Historyczny turniej"]')?.disabled === false);
    assert.equal(calls.filter(({ url }) => url.startsWith('/api/sessions?') && !new URL(`http://local${url}`).searchParams.has('month')).length, 0);
    assert.doesNotMatch(document.body.textContent, /Część źródeł raportu jest nieaktualna/);
  } finally {
    await act(() => root.unmount());
    globalThis.fetch = originalFetch;
  }
});
