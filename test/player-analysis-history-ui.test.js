import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
test.after(() => vite.close());
const { PlayerAnalysisHistory } = await vite.ssrLoadModule('/src/components/PlayerAnalysisHistory.jsx');

const analysis = ({ summary, sessionReportIds = [] }) => ({
  profileStyleId: 'TAG',
  reliabilityId: 'STATISTICAL',
  summary,
  summaryMetricIds: ['shared.preflop.vpip'],
  summarySessionReportIds: sessionReportIds,
  strengths: [{ title: 'Selekcja', description: 'Dobra selekcja.', metricIds: ['shared.preflop.vpip'], sessionReportIds: [] }],
  leaks: [{ title: 'C-bet', description: 'Za rzadki.', correction: 'Ćwicz flopy.', metricIds: ['shared.postflop.cBet'], sessionReportIds: [] }],
  trainingPriorities: [
    { title: 'Flop', description: 'Pracuj nad flopem.', exercise: '20 spotów.', metricIds: ['shared.postflop.cBet'], sessionReportIds: [] },
    { title: 'Preflop', description: 'Pracuj nad otwarciami.', exercise: 'Powtórz zakresy.', metricIds: ['shared.preflop.vpip'], sessionReportIds: [] },
    { title: 'Review', description: 'Przeglądaj sesje.', exercise: 'Oznacz 5 rozdań.', metricIds: ['shared.preflop.vpip'], sessionReportIds: [] },
  ],
  categoryInsights: [{ category: 'cash', summary: 'Stabilny wynik Cash.', metricIds: ['cash.winrate'], sessionReportIds: [] }],
});
const makeReport = ({ reportId, analyzedAt, revision, hands, summary, sources = [], sessionReportIds = [], referenceWarnings = [] }) => ({
  reportId,
  analyzedAt,
  datasetRevision: revision,
  model: { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
  criteria: { gameType: 'cash', dateFrom: '2026-07-01', dateTo: '2026-07-31' },
  handCount: hands,
  sessionCount: 3,
  snapshot: {
    handCount: hands,
    sessionCount: 3,
    profileStyleId: 'TAG',
    profileStyle: { id: 'TAG', label: `TAG snapshot ${hands}` },
    reliabilityId: 'STATISTICAL',
    reliability: { id: 'STATISTICAL', label: 'Profil statystyczny' },
    metricCatalog: {
      'shared.preflop.vpip': { id: 'shared.preflop.vpip', label: 'VPIP', value: 22, unit: '%' },
      'shared.postflop.cBet': { id: 'shared.postflop.cBet', label: 'C-bet', value: 54, unit: '%' },
      'cash.winrate': { id: 'cash.winrate', label: 'Winrate Cash', value: 3.2, unit: 'BB/100' },
    },
  },
  sources,
  referenceWarnings,
  analysis: analysis({ summary, sessionReportIds }),
});

const availableSource = {
  sourceId: 'cash:session-a:session-report-a',
  type: 'cash',
  sessionId: 'session-a',
  reportId: 'session-report-a',
  date: '2026-07-10',
};
const missingSource = {
  sourceId: 'cash:session-b:session-report-missing',
  type: 'cash',
  sessionId: 'session-b',
  reportId: 'session-report-missing',
  date: '2026-07-20',
};
const older = makeReport({
  reportId: 'older',
  analyzedAt: '2026-08-01T10:00:00.000Z',
  revision: 'revision-old',
  hands: 45,
  summary: 'Historyczny snapshot jest nadal czytelny.',
  sources: [availableSource, missingSource],
  sessionReportIds: [availableSource.reportId, missingSource.reportId],
});
const newer = makeReport({
  reportId: 'newer',
  analyzedAt: '2026-08-10T10:00:00.000Z',
  revision: 'revision-current',
  hands: 120,
  summary: 'Najnowszy raport.',
});

test('historia sortuje kafelki malejąco i renderuje wybrany historyczny snapshot', () => {
  const html = renderToStaticMarkup(createElement(PlayerAnalysisHistory, {
    reports: [older, newer],
    selectedReportId: 'older',
    currentDatasetRevision: 'revision-current',
    sessionAiAnalyses: { 'session-a': [{ reportId: 'session-report-a' }] },
  }));

  assert.ok(html.indexOf('data-report-id="newer"') < html.indexOf('data-report-id="older"'));
  assert.match(html, /data-testid="selected-player-analysis-report" data-report-id="older"/);
  assert.match(html, /Historyczny snapshot jest nadal czytelny/);
  assert.match(html, /TAG snapshot 45/);
  assert.match(html, /Dane zmienione/);
  assert.match(html, /VPIP: 22 %/);
  assert.match(html, /C-bet: 54 %/);
  assert.match(html, /Winrate Cash: 3,2 BB\/100/);
  assert.match(html, /Trzy priorytety treningowe/);
});

test('źródło otwiera dokładny raport sesji, a brakujące pozostaje widoczne i nieaktywne', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  const opened = [];
  const root = createRoot(document.getElementById('root'));
  await act(() => root.render(createElement(PlayerAnalysisHistory, {
    reports: [older],
    selectedReportId: 'older',
    currentDatasetRevision: 'revision-current',
    sessionAiAnalyses: { 'session-a': [{ reportId: 'session-report-a' }] },
    onOpenSession: (source) => opened.push(source),
  })));
  try {
    const availableButton = document.querySelector('button[title="Otwórz dokładny raport session-report-a"]');
    const missingButton = document.querySelector('button[title="Historyczny raport sesji nie jest już dostępny"]');
    assert.ok(availableButton);
    assert.ok(missingButton);
    assert.equal(missingButton.disabled, true);

    await act(() => availableButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.deepEqual(opened, [availableSource]);
    assert.match(missingButton.textContent, /niedostępny/);
  } finally {
    await act(() => root.unmount());
  }
});

test('raport pokazuje zbiorcze ostrzeżenie i utracone źródła sekcji', () => {
  const report = makeReport({
    reportId: 'warnings',
    analyzedAt: '2026-08-11T10:00:00.000Z',
    revision: 'revision-current',
    hands: 80,
    summary: 'Raport z oczyszczonymi referencjami.',
    referenceWarnings: [{
      path: 'summarySessionReportIds',
      kind: 'sessionReport',
      reason: 'unknown',
      discardedIds: ['missing-report'],
    }],
  });
  const html = renderToStaticMarkup(createElement(PlayerAnalysisHistory, {
    reports: [report],
    selectedReportId: report.reportId,
  }));

  assert.match(html, /data-testid="player-analysis-reference-warnings"/);
  assert.match(html, /Oczyszczono 1 nieprawidłowych referencji/);
  assert.match(html, /data-testid="player-analysis-missing-sources-warning"/);
  assert.match(html, /Nie zachowano żadnego źródła sesyjnego/);
});
