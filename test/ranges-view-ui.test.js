import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const ranks = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const notations = ranks.flatMap((rowRank, rowIndex) => ranks.map((columnRank, columnIndex) => (
  rowIndex === columnIndex ? `${rowRank}${columnRank}` : rowIndex < columnIndex ? `${rowRank}${columnRank}s` : `${columnRank}${rowRank}o`
)));
const createHands = () => Object.fromEntries(notations.map((notation) => [notation, {
  UTG: 0, HJ: 0, BTN: 0, SB: 0,
}]));

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
test.after(() => vite.close());
const { RangesView } = await vite.ssrLoadModule('/src/views/RangesView.jsx');

const mountRangesView = async (api) => {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById('root'));
  await act(async () => {
    root.render(createElement(RangesView, { api }));
    await Promise.resolve();
  });
  return root;
};

const setRangeValue = async (input, value) => {
  const valueSetter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  valueSetter.call(input, String(value));
  await act(() => input.dispatchEvent(new dom.window.Event('input', { bubbles: true })));
};

test('widok renderuje pełną macierz 169 prawidłowo oznaczonych rąk', async () => {
  const root = await mountRangesView({ getPreflopSetup: async () => ({ setup: null }), savePreflopSetup: async () => ({}) });
  try {
    const hands = [...document.querySelectorAll('[data-testid^="range-hand-"]')];
    assert.equal(hands.length, 169);
    assert.equal(document.querySelector('[data-testid="range-hand-AA"]').textContent.includes('AA'), true);
    assert.equal(document.querySelector('[data-testid="range-hand-AKs"]').textContent.includes('AKs'), true);
    assert.equal(document.querySelector('[data-testid="range-hand-AKo"]').textContent.includes('AKo'), true);
    assert.equal(document.querySelector('[data-testid="range-hand-22"]').textContent.includes('22'), true);
    assert.equal(document.querySelector('[data-testid="selected-range-hand"]').textContent, 'AA');
    assert.equal(document.querySelector('[data-testid="range-page-title"]').textContent, 'Matryca 169 rąk');
    assert.deepEqual(
      [...document.querySelectorAll('[data-testid^="range-legend-"]')].map((node) => node.textContent.trim()),
      ['Fold', 'Call', 'Raise'],
    );
    assert.equal(document.querySelector('[data-testid="range-hand-AA"] span').style.fontSize, '9px');
    assert.equal(document.querySelector('[data-testid="range-hand-AA"] > span:last-child').style.fontSize, '21px');
    assert.equal(document.querySelector('[data-testid="range-color-legend"]').textContent.includes('UTG'), false);
    assert.equal(document.querySelector('[data-testid="download-range-image"]')?.getAttribute('title'), 'Pobierz PNG w wysokiej rozdzielczości');
  } finally {
    await act(() => root.unmount());
  }
});

test('eksport matrycy zawiera nazwÄ™ wersji, legendÄ™ kolorĂłw i biaĹ‚e tĹ‚o', async () => {
  const hands = createHands();
  const api = {
    getPreflopSetup: async () => ({
      setup: { id: 'v1', name: 'Tight', hands },
      versions: [{ id: 'v1', name: 'Tight' }],
      activeVersionId: 'v1',
    }),
    savePreflopSetup: async () => ({}),
  };
  const originalImage = globalThis.Image;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const originalGetContext = dom.window.HTMLCanvasElement.prototype.getContext;
  const originalToBlob = dom.window.HTMLCanvasElement.prototype.toBlob;
  const originalAnchorClick = dom.window.HTMLAnchorElement.prototype.click;
  const capturedBlobs = [];
  globalThis.Image = class {
    set src(value) {
      this.url = value;
      queueMicrotask(() => this.onload?.());
    }
  };
  URL.createObjectURL = (blob) => {
    capturedBlobs.push(blob);
    return 'blob:test-range-export';
  };
  URL.revokeObjectURL = () => {};
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage: () => {} });
  dom.window.HTMLCanvasElement.prototype.toBlob = (callback) => callback(new Blob(['png'], { type: 'image/png' }));
  dom.window.HTMLAnchorElement.prototype.click = () => {};
  const root = await mountRangesView(api);
  try {
    await act(async () => {
      document.querySelector('[data-testid="download-range-image"]')
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    const svg = await capturedBlobs[0].text();
    assert.match(svg, /Matryca zakresów preflop — Tight/);
    assert.match(svg, />Fold</);
    assert.match(svg, />Call</);
    assert.match(svg, />Raise</);
    assert.match(svg, /\.position \{[^}]*26px/);
    assert.match(svg, /\.hand \{[^}]*60px/);
    assert.match(svg, /fill="#ffffff"/);
    assert.equal(svg.includes('fill="#020617"'), false);
  } finally {
    await act(() => root.unmount());
    globalThis.Image = originalImage;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    dom.window.HTMLCanvasElement.prototype.getContext = originalGetContext;
    dom.window.HTMLCanvasElement.prototype.toBlob = originalToBlob;
    dom.window.HTMLAnchorElement.prototype.click = originalAnchorClick;
  }
});

test('dropdown przeĹ‚Ä…cza wersjÄ™ i wczytuje jej macierz', async () => {
  const firstHands = createHands();
  const secondHands = createHands();
  firstHands.AA.UTG = 100;
  secondHands.KQs.BTN = 90;
  const versions = [
    { id: 'v1', name: 'Open-raise' },
    { id: 'v2', name: 'Tight' },
  ];
  const api = {
    getPreflopSetup: async () => ({
      setup: { id: 'v1', name: 'Open-raise', hands: firstHands },
      versions,
      activeVersionId: 'v1',
    }),
    activatePreflopVersion: async (versionId) => ({
      setup: { id: versionId, name: 'Tight', hands: secondHands },
      versions,
      activeVersionId: versionId,
    }),
    savePreflopSetup: async () => ({}),
  };
  const root = await mountRangesView(api);
  try {
    const select = document.querySelector('[data-testid="range-version-select"]');
    assert.equal(select.value, 'v1');
    const valueSetter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set;
    valueSetter.call(select, 'v2');
    await act(async () => {
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    assert.equal(document.querySelector('[data-testid="range-version-name"]').value, 'Tight');
    assert.equal(document.querySelector('[data-testid="range-page-title"]').textContent, 'Tight');
    await act(() => document.querySelector('[data-testid="range-hand-KQs"]')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.equal(document.querySelector('[data-testid="range-slider-BTN"]').value, '90');
  } finally {
    await act(() => root.unmount());
  }
});

test('nazwa wersji, kopiowanie i usuwanie dziaĹ‚ajÄ… bezpiecznie w UI', async () => {
  const hands = createHands();
  const versions = [
    { id: 'v1', name: 'Open-raise' },
    { id: 'v2', name: 'Tight' },
  ];
  const calls = { rename: [], copy: [], delete: [] };
  const api = {
    getPreflopSetup: async () => ({ setup: { id: 'v1', name: 'Open-raise', hands }, versions, activeVersionId: 'v1' }),
    renamePreflopVersion: async (versionId, name) => {
      calls.rename.push([versionId, name]);
      return { setup: { id: versionId, name, hands } };
    },
    copyPreflopVersion: async (versionId) => {
      calls.copy.push(versionId);
      return {
        setup: { id: 'v3', name: 'Kopia — Open-raise', hands },
        versions: [...versions, { id: 'v3', name: 'Kopia — Open-raise' }],
        activeVersionId: 'v3',
      };
    },
    deletePreflopVersion: async (versionId) => {
      calls.delete.push(versionId);
      return {
        setup: { id: 'v1', name: 'Open-raise', hands },
        versions: [{ id: 'v1', name: 'Open-raise' }],
        activeVersionId: 'v1',
      };
    },
    savePreflopSetup: async () => ({}),
  };
  const originalConfirm = window.confirm;
  window.confirm = () => true;
  const root = await mountRangesView(api);
  try {
    const nameInput = document.querySelector('[data-testid="range-version-name"]');
    nameInput.value = 'Loose';
    await act(async () => {
      nameInput.dispatchEvent(new dom.window.Event('focusout', { bubbles: true }));
      await Promise.resolve();
    });
    assert.deepEqual(calls.rename, [['v1', 'Loose']]);

    await act(async () => {
      document.querySelector('[data-testid="copy-range-version"]')
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    assert.deepEqual(calls.copy, ['v1']);
    assert.equal(document.querySelector('[data-testid="range-version-select"]').value, 'v3');

    await act(async () => {
      document.querySelector('[data-testid="delete-range-version"]')
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    assert.deepEqual(calls.delete, ['v3']);
    assert.equal(document.querySelector('[data-testid="range-version-select"]').value, 'v1');
    assert.equal(document.querySelector('[data-testid="delete-range-version"]').disabled, true);
  } finally {
    window.confirm = originalConfirm;
    await act(() => root.unmount());
  }
});

test('kliknięcie ręki kieruje suwaki do wybranego kafelka', async () => {
  const root = await mountRangesView({ getPreflopSetup: async () => ({ setup: null }), savePreflopSetup: async () => ({}) });
  try {
    const aaUmgColor = document.querySelector('[data-testid="range-hand-AA"] span').style.backgroundColor;
    await act(() => document.querySelector('[data-testid="range-hand-AKo"]')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.equal(document.querySelector('[data-testid="selected-range-hand"]').textContent, 'AKo');
    await setRangeValue(document.querySelector('[data-testid="range-slider-UTG"]'), 0);
    assert.notEqual(document.querySelector('[data-testid="range-hand-AKo"] span').style.backgroundColor, 'rgb(234, 179, 8)');
    assert.equal(document.querySelector('[data-testid="range-hand-AA"] span').style.backgroundColor, aaUmgColor);
  } finally {
    await act(() => root.unmount());
  }
});

test('Domyślne resetuje całą macierz, a Zapisz wysyła pełny setup do API', async () => {
  const saveCalls = [];
  const api = {
    getPreflopSetup: async () => ({ setup: null }),
    savePreflopSetup: async (hands) => {
      saveCalls.push(hands);
      return { setup: { hands } };
    },
  };
  const root = await mountRangesView(api);
  try {
    await setRangeValue(document.querySelector('[data-testid="range-slider-UTG"]'), 0);
    await act(() => document.querySelector('[data-testid="range-actions-menu"]')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.equal(document.querySelector('[data-testid="reset-range-setup"]')?.textContent, 'Domyślne');
    await act(() => document.querySelector('[data-testid="reset-range-setup"]')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.equal(document.querySelector('[data-testid="range-slider-UTG"]').value, '0');
    await act(async () => {
      document.querySelector('[data-testid="save-range-setup"]')
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    assert.equal(saveCalls.length, 1);
    assert.equal(Object.keys(saveCalls[0]).length, 169);
    assert.deepEqual(saveCalls[0].AA, { UTG: 0, HJ: 0, BTN: 0, SB: 0 });
    assert.match(document.body.textContent, /Zapisano macierz zakresów w bazie danych/);
  } finally {
    await act(() => root.unmount());
  }
});

test('ikonowe akcje ustawiają cztery pozycje wybranego kafelka na Fold, Call lub Raise', async () => {
  const root = await mountRangesView({ getPreflopSetup: async () => ({ setup: null }), savePreflopSetup: async () => ({}) });
  try {
    await setRangeValue(document.querySelector('[data-testid="range-slider-UTG"]'), 31);
    await act(() => document.querySelector('[data-testid="set-hand-call"]')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.equal(document.querySelector('[data-testid="range-slider-UTG"]').value, '50');
    assert.equal(document.querySelector('[data-testid="range-slider-SB"]').value, '50');

    await act(() => document.querySelector('[data-testid="range-hand-AKo"]')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.equal(document.querySelector('[data-testid="range-slider-SB"]').value, '0');

    await act(() => document.querySelector('[data-testid="set-hand-raise"]')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.equal(document.querySelector('[data-testid="range-slider-HJ"]').value, '100');

    await act(() => document.querySelector('[data-testid="set-hand-fold"]')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.equal(document.querySelector('[data-testid="range-slider-BTN"]').value, '0');
  } finally {
    await act(() => root.unmount());
  }
});

test('widok ładuje poprzednio zapisane wartości z API', async () => {
  const hands = createHands();
  hands.KQs.BTN = 90;
  const root = await mountRangesView({
    getPreflopSetup: async () => ({ setup: { hands } }),
    savePreflopSetup: async () => ({}),
  });
  try {
    await act(() => document.querySelector('[data-testid="range-hand-KQs"]')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.equal(document.querySelector('[data-testid="range-slider-BTN"]').value, '90');
  } finally {
    await act(() => root.unmount());
  }
});
