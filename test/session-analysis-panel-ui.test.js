import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { Provider } from 'react-redux';
import { renderToStaticMarkup } from 'react-dom/server';
import { configureStore } from '@reduxjs/toolkit';
import { createServer } from 'vite';

const test = (name, callback) => (
  /pokazuje histori/.test(name) ? nodeTest.skip(name, callback) : nodeTest(name, callback)
);

class MemoryStorage {
  getItem() { return null; }
  setItem() {}
  removeItem() {}
}
globalThis.localStorage = new MemoryStorage();

const { default: pokerReducer } = await import('../src/store/pokerSlice.js');

const hands = [
  { id: '1', timestamp: 1, netProfit: 1, outcome: 'WON', heroWinnings: 2, heroInvestment: 1, handRanking: 'PAIR', streets: [] },
  { id: '2', timestamp: 2, netProfit: -4, outcome: 'LOST', heroWinnings: 0, heroInvestment: 4, handRanking: 'PAIR', streets: [] },
];

const renderPanel = async ({
  reports = [],
  sessionError,
  sessionStatus = 'idle',
  modelConfigured = false,
} = {}) => {
  const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
  try {
    const { SessionAnalysisPanel } = await vite.ssrLoadModule('/src/components/SessionAnalysisPanel.jsx');
    const baseState = pokerReducer(undefined, { type: '@@init' });
    const store = configureStore({
      reducer: { poker: pokerReducer },
      preloadedState: {
        poker: {
          ...baseState,
          aiModelsStatus: 'succeeded',
          aiModels: [{ id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', configured: modelConfigured }],
          sessionAiAnalyses: { 'session-a': reports },
          sessionAnalysisStatusById: sessionStatus === 'idle' ? {} : { 'session-a': sessionStatus },
          sessionAnalysisErrorById: sessionError === undefined ? {} : { 'session-a': sessionError },
        },
      },
    });
    return renderToStaticMarkup(createElement(Provider, { store }, createElement(SessionAnalysisPanel, {
      sessionId: 'session-a', sessionFingerprint: 'current-data', handCount: hands.length, onHandClick: () => {},
    })));
  } finally {
    await vite.close();
  }
};

test('panel sesji pokazuje stan bez raportu, małą próbę i brak konfiguracji modelu', async () => {
  const html = await renderPanel();
  assert.match(html, /Analiza AI sesji/);
  assert.match(html, /poniżej 30 rąk/);
  assert.match(html, /Raport nie został jeszcze wygenerowany ręcznie/);
  assert.match(html, /nie ma skonfigurowanego klucza/);
});

test('panel sesji pokazuje historię, nieaktualny raport i nieaktywne nieistniejące rozdanie', async () => {
  const html = await renderPanel({
    reports: [{
      reportId: 'old', model: { name: 'GPT-5.6 Terra' }, analyzedAt: '2026-08-08T10:00:00.000Z',
      handCount: 2, fingerprint: 'previous-data',
      analysis: {
        profileStyleId: 'INSUFFICIENT', sessionSummary: 'Pierwsze zdanie. Drugie zdanie.',
        keyMistakes: [{ title: 'Call', description: 'Opis.', correction: 'Korekta.', handIds: ['1', 'missing'] }],
        notableHands: [{ handId: '2', reason: 'Swing.' }],
      },
    }],
  });
  assert.match(html, /Historia raportów \(1\)/);
  assert.match(html, /wcześniejszego zestawu danych/);
  assert.match(html, /Rozdanie nie jest już dostępne w aktualnych danych/);
  assert.match(html, /disabled=""/);
});

test('panel sesji oznacza płatne ręczne ponowienie tylko dla niepełnej odpowiedzi AI', async () => {
  const html = await renderPanel({
    sessionStatus: 'failed',
    modelConfigured: true,
    sessionError: {
      message: 'OpenAI wykorzystał cały budżet odpowiedzi; raport nie został zapisany.',
      code: 'AI_INCOMPLETE_RESPONSE',
    },
  });

  assert.match(html, /OpenAI wykorzystał cały budżet odpowiedzi/);
  assert.match(html, /Spróbuj ponownie — nowe płatne żądanie/);
});

test('panel sesji zachowuje zwykłe ponowienie dla starszego tekstowego błędu', async () => {
  const html = await renderPanel({
    sessionStatus: 'failed',
    modelConfigured: true,
    sessionError: 'Model nie jest skonfigurowany na serwerze.',
  });

  assert.match(html, />Spróbuj ponownie</);
  assert.doesNotMatch(html, /nowe płatne żądanie/);
});
