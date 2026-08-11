import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createServer } from 'vite';
import { getDateRangePresets } from '../src/utils/dateRangePresets.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test('presety zakresu dat są liczone lokalnie i obejmują wymagane okresy', () => {
  const presets = getDateRangePresets(new Date(2026, 7, 11));
  assert.deepEqual(presets.map(({ id }) => id), ['all', '7-days', '30-days', '90-days', 'current-month', 'current-year']);
  assert.deepEqual(presets.find(({ id }) => id === 'all').range, { from: '', to: '' });
  assert.deepEqual(presets.find(({ id }) => id === '7-days').range, { from: '2026-08-05', to: '2026-08-11' });
  assert.deepEqual(presets.find(({ id }) => id === 'current-month').range, { from: '2026-08-01', to: '2026-08-11' });
  assert.deepEqual(presets.find(({ id }) => id === 'current-year').range, { from: '2026-01-01', to: '2026-08-11' });
});

test('pierwszy dzień pozostaje lokalnym szkicem, a Escape anuluje niepełny wybór', async (context) => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/', pretendToBeVisual: true,
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;

  const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
  context.after(async () => {
    await vite.close();
    dom.window.close();
  });
  const { DateRangePicker } = await vite.ssrLoadModule('/src/components/DateRangePicker.jsx');
  const changes = [];
  const root = createRoot(document.getElementById('root'));
  context.after(() => act(() => root.unmount()));
  await act(async () => root.render(createElement(DateRangePicker, {
    value: { from: '', to: '' },
    onChange: (range) => changes.push(range),
    today: new Date(2026, 7, 11),
  })));

  const click = async (node) => act(async () => node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  const trigger = document.querySelector('[data-testid="date-range-picker"] > button');
  await click(trigger);
  const firstDay = [...document.querySelectorAll('.rdp-day_button')].find((node) => node.getAttribute('aria-label')?.includes('10 sierpnia 2026'));
  const secondDay = [...document.querySelectorAll('.rdp-day_button')].find((node) => node.getAttribute('aria-label')?.includes('11 sierpnia 2026'));
  const futureDay = [...document.querySelectorAll('.rdp-day_button')].find((node) => node.getAttribute('aria-label')?.includes('12 sierpnia 2026'));
  assert.ok(firstDay, 'kalendarz powinien używać polskich etykiet dni');
  assert.ok(secondDay);
  assert.equal(futureDay.disabled, true);
  await click(firstDay);
  assert.equal(changes.length, 0);
  assert.match(document.body.textContent, /Wybierz datę końcową zakresu/);

  await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(changes.length, 0);
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(document.activeElement, trigger);

  await click(trigger);
  await click([...document.querySelectorAll('.rdp-day_button')].find((node) => node.getAttribute('aria-label')?.includes('10 sierpnia 2026')));
  await click([...document.querySelectorAll('.rdp-day_button')].find((node) => node.getAttribute('aria-label')?.includes('11 sierpnia 2026')));
  assert.deepEqual(changes, [{ from: '2026-08-10', to: '2026-08-11' }]);
  assert.equal(document.querySelector('[role="dialog"]'), null);

  await click(trigger);
  await click([...document.querySelectorAll('button')].find((node) => node.textContent === '30 dni'));
  assert.deepEqual(changes.at(-1), { from: '2026-07-13', to: '2026-08-11' });
  await click(trigger);
  await click([...document.querySelectorAll('button')].find((node) => node.textContent.includes('Wyczyść')));
  assert.deepEqual(changes.at(-1), { from: '', to: '' });
});
