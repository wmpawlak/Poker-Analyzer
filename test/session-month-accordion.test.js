import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (callback) => callback();
let scrollCalls = 0;
globalThis.HTMLElement.prototype.scrollIntoView = () => { scrollCalls += 1; };

const accordionRect = ({ top = 0, width = 500, height = 0 } = {}) => ({
  bottom: top + height, height, left: 0, right: width, top, width, x: 0, y: top,
  toJSON() { return this; },
});
const resizeObservers = new Set();
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
  if (this === scrollElement) return accordionRect({ height: 600 });
  if (this.matches?.('[data-testid="virtual-session-list"]')) {
    const sections = [...scrollElement.querySelectorAll(':scope > section')];
    const sectionIndex = Math.max(0, sections.indexOf(this.closest('section')));
    return accordionRect({
      top: ((sectionIndex + 1) * 60) - (scrollElement?.scrollTop || 0),
      height: Number.parseFloat(this.style.height) || 0,
    });
  }
  if (this.getAttribute?.('role') === 'listitem') return accordionRect({ height: 104 });
  return originalGetBoundingClientRect.call(this);
};
const notifyResizeObservers = () => resizeObservers.forEach((observer) => {
  [...observer.targets].forEach((target) => observer.notify(target));
});

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
test.after(() => vite.close());
const { SessionMonthAccordion } = await vite.ssrLoadModule('/src/components/SessionMonthAccordion.jsx');

const months = [
  { key: '2026-08', year: 2026, month: 8, sessionCount: 2, handCount: 20, cashSessionCount: 1, tournamentSessionCount: 1 },
  { key: '2026-07', year: 2026, month: 7, sessionCount: 1, handCount: 8, cashSessionCount: 1, tournamentSessionCount: 0 },
];
const successPages = {
  '2026-08': { status: 'succeeded', error: null, items: [{ id: 'august-a' }, { id: 'august-b' }] },
  '2026-07': { status: 'succeeded', error: null, items: [{ id: 'july-a' }] },
};

const card = (session) => createElement('div', { key: session.id, 'data-testid': `card-${session.id}` }, session.id);
const click = async (node) => {
  await act(() => node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  await act(() => notifyResizeObservers());
};
const keyDown = async (node, key) => act(() => node.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true })));

const mount = async (element) => {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById('root'));
  await act(() => root.render(element));
  await act(() => notifyResizeObservers());
  return root;
};

test('akordeon rozwija, zwija i przełącza tylko jeden miesiąc z poprawnym ARIA i fokusem', async () => {
  const Harness = () => {
    const [active, setActive] = useState('2026-08');
    return createElement(SessionMonthAccordion, {
      months,
      activeMonthKey: active,
      pagesByMonth: successPages,
      onMonthToggle: setActive,
      renderSession: card,
      mixed: true,
      selectedCountsByMonth: { '2026-07': 1 },
    });
  };
  const root = await mount(createElement(Harness));
  assert.ok(document.querySelector('[data-testid="card-august-a"]'));
  assert.equal(document.querySelector('[data-testid="card-july-a"]'), null);
  assert.equal(document.querySelectorAll('[role="region"]').length, 1);
  const august = document.querySelector('[aria-label^="Sierpień 2026"]');
  const july = document.querySelector('[aria-label^="Lipiec 2026"]');
  assert.equal(august.getAttribute('aria-expanded'), 'true');
  assert.equal(july.getAttribute('aria-expanded'), 'false');
  assert.ok(august.getAttribute('aria-controls'));
  assert.match(document.body.textContent, /Cash 1 · Turnieje 1/);
  assert.match(document.body.textContent, /Wybrane: 1/);

  await keyDown(july, 'Enter');
  assert.equal(document.querySelector('[data-testid="card-august-a"]'), null);
  assert.ok(document.querySelector('[data-testid="card-july-a"]'));
  assert.equal(document.querySelectorAll('[role="region"]').length, 1);

  july.focus();
  scrollCalls = 0;
  await keyDown(july, ' ');
  assert.equal(document.querySelectorAll('[role="region"]').length, 0);
  assert.equal(document.activeElement, july);
  assert.equal(scrollCalls, 1);

  await click(august);
  assert.ok(document.querySelector('[data-testid="card-august-b"]'));
  await act(() => root.unmount());
});

test('akordeon pokazuje loading, błąd z retry i pusty miesiąc', async () => {
  let retryMonth = null;
  const root = await mount(createElement(SessionMonthAccordion, {
    months,
    activeMonthKey: '2026-08',
    pagesByMonth: {
      ...successPages,
      '2026-08': { status: 'loading', error: null, items: [] },
    },
    renderSession: card,
  }));
  assert.ok(document.querySelector('[aria-label="Wczytywanie miesiąca"]'));
  assert.match(document.body.textContent, /Wczytywanie sesji/);

  await act(() => root.render(createElement(SessionMonthAccordion, {
    months,
    activeMonthKey: '2026-08',
    pagesByMonth: {
      ...successPages,
      '2026-08': { status: 'failed', error: 'Awaria miesiąca', items: [] },
    },
    onRetryMonth: (month) => { retryMonth = month; },
    renderSession: card,
  })));
  await act(() => notifyResizeObservers());
  assert.match(document.querySelector('[role="alert"]').textContent, /Awaria miesiąca/);
  await click(document.querySelector('[aria-label^="Ponów ładowanie"]'));
  assert.equal(retryMonth, '2026-08');

  await act(() => root.render(createElement(SessionMonthAccordion, {
    months,
    activeMonthKey: '2026-08',
    pagesByMonth: { ...successPages, '2026-08': { status: 'succeeded', error: null, items: [] } },
    renderSession: card,
  })));
  assert.match(document.body.textContent, /Brak sesji w tym miesiącu/);
  await act(() => root.unmount());
});

test('otwarcie miesiąca z cache nie wywołuje ponownego ładowania', async () => {
  let loads = 0;
  const root = await mount(createElement(SessionMonthAccordion, {
    months,
    activeMonthKey: '2026-08',
    pagesByMonth: successPages,
    onLoadMonth: () => { loads += 1; },
    renderSession: card,
  }));
  assert.equal(loads, 0);
  await act(() => root.unmount());
});

test('otwarcie niezaładowanego miesiąca uruchamia jedno żądanie', async () => {
  let loads = 0;
  const root = await mount(createElement(SessionMonthAccordion, {
    months,
    activeMonthKey: '2026-08',
    pagesByMonth: {},
    onLoadMonth: (month) => { loads += 1; assert.equal(month, '2026-08'); },
    renderSession: card,
  }));
  assert.equal(loads, 1);
  await act(() => root.unmount());
});

test('renderuje tradycyjnie 30 sesji, a od 31 uzywa wirtualnej listy', async () => {
  const thirty = Array.from({ length: 30 }, (_, index) => ({ id: `regular-${index}` }));
  const thirtyOne = Array.from({ length: 31 }, (_, index) => ({ id: `virtual-${index}` }));
  const root = await mount(createElement(SessionMonthAccordion, {
    months: [months[0]],
    activeMonthKey: '2026-08',
    pagesByMonth: { '2026-08': { status: 'succeeded', error: null, items: thirty } },
    renderSession: card,
  }));
  assert.equal(document.querySelector('[data-testid="virtual-session-list"]'), null);
  assert.equal(document.querySelectorAll('[data-testid^="card-regular-"]').length, 30);

  await act(() => root.render(createElement(SessionMonthAccordion, {
    months: [months[0]],
    activeMonthKey: '2026-08',
    pagesByMonth: { '2026-08': { status: 'succeeded', error: null, items: thirtyOne } },
    renderSession: card,
  })));
  await act(() => notifyResizeObservers());
  assert.ok(document.querySelector('[role="list"][aria-label^="Sesje: Sierpień 2026"]'));
  const mountedVirtualCards = document.querySelectorAll('[role="listitem"]').length;
  assert.ok(mountedVirtualCards > 0);
  assert.ok(mountedVirtualCards < 30, `Zamontowano ${mountedVirtualCards} kart`);
  assert.equal(document.querySelectorAll('[role="region"]').length, 1);
  await act(() => root.unmount());
});

test('zwija i przelacza wirtualizowane miesiace bez pozostawiania poprzednich kart', async () => {
  const virtualPages = Object.fromEntries(months.map((month) => [month.key, {
    status: 'succeeded',
    error: null,
    items: Array.from({ length: 40 }, (_, index) => ({ id: `${month.key}-${index}` })),
  }]));
  const Harness = () => {
    const [active, setActive] = useState('2026-08');
    return createElement(SessionMonthAccordion, {
      months,
      activeMonthKey: active,
      pagesByMonth: virtualPages,
      onMonthToggle: setActive,
      renderSession: card,
    });
  };
  const root = await mount(createElement(Harness));
  assert.ok(document.querySelector('[data-testid="card-2026-08-0"]'));

  const july = document.querySelector('[aria-label^="Lipiec 2026"]');
  await click(july);
  assert.equal(document.querySelector('[data-testid^="card-2026-08-"]'), null);
  assert.ok(document.querySelector('[data-testid="card-2026-07-0"]'));
  assert.equal(document.querySelectorAll('[role="region"]').length, 1);

  july.focus();
  await click(july);
  assert.equal(document.querySelectorAll('[role="listitem"]').length, 0);
  assert.equal(document.querySelectorAll('[role="region"]').length, 0);
  assert.equal(document.activeElement, july);
  await act(() => root.unmount());
});
