import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
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
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.localStorage = new MemoryStorage();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
test.after(() => vite.close());
const { default: pokerReducer } = await vite.ssrLoadModule('/src/store/pokerSlice.js');
const { SettingsView, TrainingCollectionSettings } = await vite.ssrLoadModule('/src/views/SettingsView.jsx');

const emptyPool = (active = 0) => ({ current: active, active, ready: active, pending: 0, review: 0 });
const pools = {
  preflop_selection: { cash: emptyPool(100), tournament: emptyPool(80) },
  preflop_vs_reraise: { cash: emptyPool(70), tournament: emptyPool(50) },
  cbet_barrels: { cash: emptyPool(60), tournament: emptyPool(40) },
  turn_river: { cash: emptyPool(30), tournament: emptyPool(20) },
};

const status = {
  version: 1,
  revision: 7,
  scanState: {
    lastScannedAt: '2026-08-12T10:00:00.000Z',
    datasetRevision: 'dataset-revision-7',
    lastResult: { new: 3, spotsAdded: 8 },
  },
  pools,
  queue: { pending: 5, reanalysis: 2, rejectedHands: 1 },
  refreshEstimate: { candidateCount: 5, estimatedRequests: 1, batchSize: 20, includeReview: false, groups: {} },
  refreshJob: null,
  counts: { spots: 12, answerKeys: 5, refreshJobs: 1, sessions: 2, attempts: 10 },
  lastUsedModel: 'gemini-2.5-flash',
  models: [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', configured: false },
    { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', configured: true },
    { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', configured: true },
  ],
};

const runningJob = {
  id: 'training-refresh-1', status: 'running', modelId: 'gpt-5.6-terra',
  contractVersion: 1, batchSize: 20, includeReview: false,
  candidateCount: 5, estimatedRequests: 1, attemptedRequests: 1,
  successfulRequests: 0, processedSpotCount: 5, savedKeyCount: 0,
  readyKeyCount: 0, reviewKeyCount: 0, invalidKeyCount: 0,
  progress: 1, errors: [],
};

test('panel pokazuje rewizję, pule 100+100, kolejki i możliwość wznowienia zadania', () => {
  const html = renderToStaticMarkup(createElement(TrainingCollectionSettings, {
    status: { ...status, refreshJob: { ...runningJob, status: 'stopped', processedSpotCount: 2, progress: 0.4 } },
    selectedModel: status.models[1],
    includeReview: true,
    confirmation: { estimate: status.refreshEstimate },
    rebuildWarning: true,
    busy: '',
    onIncludeReviewChange: () => {}, onScan: () => {}, onConfirm: () => {},
    onCancelConfirmation: () => {}, onStop: () => {}, onResume: () => {},
    resetConfirmation: { scope: 'all' }, onRequestReset: () => {}, onCancelReset: () => {}, onConfirmReset: () => {},
  }));
  assert.match(html, /dataset-revision-7/);
  assert.match(html, /100 \/ 100/);
  assert.match(html, /80 \/ 100/);
  assert.match(html, /Kolejka AI/);
  assert.match(html, /Ponowna analiza/);
  assert.match(html, /Odrzucone rozdania/);
  assert.match(html, /Gemini 2.5 Flash|gemini-2.5-flash/);
  assert.match(html, /data-testid="resume-training-refresh"/);
  assert.match(html, /data-testid="training-refresh-resume-required"/);
  assert.match(html, /data-testid="scan-training-collection"[^>]*disabled/);
  assert.match(html, /data-testid="request-training-selection-rebuild"/);
  assert.match(html, /data-testid="training-selection-rebuild-warning"/);
  assert.match(html, /Estymacja: 5 spotów \/ 1 żądań/);
  assert.equal((html.match(/<option/g) || []).length, 8);
  assert.ok(html.includes('data-testid="training-reset-settings"'));
  assert.ok(html.includes('data-testid="reset-training-answer-keys"'));
  assert.ok(html.includes('data-testid="reset-training-all"'));
  assert.ok(html.includes('data-testid="training-reset-confirmation"'));
  assert.equal(html.includes('include-training-reanalysis'), false);
});

test('Ustawienia wykonują skan przed pokazaniem potwierdzenia i dopiero potem uruchamiają AI', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  const calls = [];
  const scannedStatus = {
    ...status,
    revision: 8,
    scanState: { ...status.scanState, lastResult: { new: 2, spotsAdded: 5 } },
  };
  const trainingApi = {
    getTrainingStatus: async (options) => { calls.push(['status', options]); return status; },
    scanTrainingCollection: async (payload) => {
      calls.push(['scan', payload]);
      return { scan: scannedStatus.scanState.lastResult, status: scannedStatus };
    },
    startTrainingRefresh: async (payload) => { calls.push(['start', payload]); return { job: runningJob }; },
    getTrainingRefreshJob: async () => ({ job: { ...runningJob, status: 'completed' } }),
    stopTrainingRefresh: async (jobId) => { calls.push(['stop', jobId]); return { job: { ...runningJob, status: 'stop_requested' } }; },
    resumeTrainingRefresh: async (jobId) => { calls.push(['resume', jobId]); return { job: runningJob }; },
    resetTrainingCollection: async (payload) => { calls.push(['reset', payload]); return { status }; },
  };
  const store = configureStore({ reducer: { poker: pokerReducer } });
  const root = createRoot(document.getElementById('root'));
  await act(async () => {
    root.render(createElement(Provider, { store }, createElement(SettingsView, { trainingApi })));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  try {
    assert.ok(document.querySelector('[data-testid="training-collection-settings"]'));
    assert.equal(calls.some(([name]) => name === 'start'), false);

    await act(async () => {
      document.querySelector('[data-testid="scan-training-collection"]')
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.deepEqual(calls.find(([name]) => name === 'scan'), ['scan', { rebuildSelection: false, sampleSize: 100 }]);
    assert.ok(document.querySelector('[data-testid="training-refresh-confirmation"]'));
    assert.match(document.body.textContent, /maksymalnie 1 żądaniach/);
    assert.equal(calls.some(([name]) => name === 'start'), false);

    await act(async () => {
      document.querySelector('[data-testid="confirm-training-refresh"]')
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.deepEqual(calls.find(([name]) => name === 'start'), ['start', {
      modelId: 'gpt-5.6-terra', sampleSize: 100, confirmed: true,
    }]);
    assert.ok(document.querySelector('[data-testid="training-refresh-job"]'));
    assert.ok(document.querySelector('[data-testid="stop-training-refresh"]'));
  } finally {
    await act(() => root.unmount());
  }
});
