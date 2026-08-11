import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement, useRef } from 'react';
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
globalThis.cancelAnimationFrame = () => {};
dom.window.requestAnimationFrame = globalThis.requestAnimationFrame;
dom.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;

const itemHeights = new Map();
const resizeObservers = new Set();
const rect = ({ top = 0, width = 500, height = 0 } = {}) => ({
  bottom: top + height,
  height,
  left: 0,
  right: width,
  top,
  width,
  x: 0,
  y: top,
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

  unobserve(target) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
    resizeObservers.delete(this);
  }

  notify(target) {
    const bounds = target.getBoundingClientRect();
    this.callback([{
      target,
      contentRect: bounds,
      borderBoxSize: [{ blockSize: bounds.height, inlineSize: bounds.width }],
    }]);
  }
}

globalThis.ResizeObserver = MockResizeObserver;
dom.window.ResizeObserver = MockResizeObserver;

const originalRect = globalThis.HTMLElement.prototype.getBoundingClientRect;
globalThis.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
  const scrollElement = document.querySelector('[data-testid="virtual-session-scroll"]');
  if (this === scrollElement) return rect({ height: 600 });
  if (this.matches?.('[data-testid="virtual-session-list"]')) {
    return rect({
      top: 80 - (scrollElement?.scrollTop || 0),
      height: Number.parseFloat(this.style.height) || 0,
    });
  }
  if (this.getAttribute?.('role') === 'listitem') {
    const sessionId = this.querySelector('[data-session-id]')?.getAttribute('data-session-id');
    return rect({ height: itemHeights.get(sessionId) || 104 });
  }
  return originalRect.call(this);
};

const notifyResizeObservers = () => {
  resizeObservers.forEach((observer) => {
    [...observer.targets].forEach((target) => observer.notify(target));
  });
};

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
test.after(() => {
  globalThis.HTMLElement.prototype.getBoundingClientRect = originalRect;
  return vite.close();
});
const { VirtualSessionList } = await vite.ssrLoadModule('/src/components/VirtualSessionList.jsx');

const sessions = Array.from({ length: 100 }, (_, index) => ({ id: `session-${index}` }));
const renderSession = (session) => createElement(
  'div',
  { 'data-session-id': session.id, 'data-testid': `session-card-${session.id}` },
  session.id,
);

const Harness = ({ items, resetKey }) => {
  const scrollElementRef = useRef(null);
  return createElement('div', {
    ref: scrollElementRef,
    'data-testid': 'virtual-session-scroll',
    style: { height: '600px', overflowY: 'auto' },
  }, createElement('div', { style: { height: '80px' } }), createElement(VirtualSessionList, {
    sessions: items,
    renderSession,
    scrollElementRef,
    ariaLabel: 'Sesje testowe',
    resetKey,
  }));
};

const mount = async (items = sessions, resetKey = 'first') => {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById('root'));
  await act(() => root.render(createElement(Harness, { items, resetKey })));
  await act(() => notifyResizeObservers());
  return root;
};

const scrollTo = async (scrollTop) => {
  const scrollElement = document.querySelector('[data-testid="virtual-session-scroll"]');
  scrollElement.scrollTop = scrollTop;
  await act(() => scrollElement.dispatchEvent(new dom.window.Event('scroll')));
  await act(() => notifyResizeObservers());
};

const translateY = (node) => Number.parseFloat(/translateY\(([-\d.]+)px\)/.exec(node.style.transform)?.[1]);

test('montuje tylko widoczny fragment 100 sesji i przewija do konca', async () => {
  itemHeights.clear();
  const root = await mount();
  try {
    const initiallyMounted = document.querySelectorAll('[role="listitem"]');
    assert.ok(initiallyMounted.length > 0);
    assert.ok(initiallyMounted.length < 30);
    assert.ok(document.querySelector('[data-testid="session-card-session-0"]'));

    await scrollTo(9_900);
    assert.ok(document.querySelector('[data-testid="session-card-session-99"]'));
    assert.equal(document.querySelector('[data-testid="session-card-session-0"]'), null);
    assert.ok(document.querySelectorAll('[role="listitem"]').length < 30);
  } finally {
    await act(() => root.unmount());
  }
});

test('mierzy zmienna wysokosc i resetKey usuwa pomiary poprzedniej listy', async () => {
  itemHeights.clear();
  itemHeights.set('session-0', 180);
  const root = await mount();
  try {
    itemHeights.set('session-0', 180);
    await act(() => notifyResizeObservers());
    const first = document.querySelector('[data-testid="session-card-session-0"]').closest('[role="listitem"]');
    const second = document.querySelector('[data-testid="session-card-session-1"]').closest('[role="listitem"]');
    assert.ok(translateY(second) >= translateY(first) + 180);

    itemHeights.set('session-0', 90);
    await act(() => root.render(createElement(Harness, { items: sessions, resetKey: 'second' })));
    const resetFirst = document.querySelector('[data-testid="session-card-session-0"]').closest('[role="listitem"]');
    const resetSecond = document.querySelector('[data-testid="session-card-session-1"]').closest('[role="listitem"]');
    assert.equal(translateY(resetSecond) - translateY(resetFirst), 104);
  } finally {
    await act(() => root.unmount());
  }
});

test('klucze sesji pozostaja stabilne po zmianie kolejnosci', async () => {
  itemHeights.clear();
  const root = await mount();
  try {
    const firstNode = document.querySelector('[data-testid="session-card-session-0"]');
    const secondNode = document.querySelector('[data-testid="session-card-session-1"]');
    const reordered = [sessions[1], sessions[0], ...sessions.slice(2)];
    await act(() => root.render(createElement(Harness, { items: reordered, resetKey: 'reordered' })));
    assert.equal(document.querySelector('[data-testid="session-card-session-0"]'), firstNode);
    assert.equal(document.querySelector('[data-testid="session-card-session-1"]'), secondNode);
  } finally {
    await act(() => root.unmount());
  }
});
