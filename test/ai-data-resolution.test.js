import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createApiApp } from '../server/app.js';
import { createDataImportService } from '../server/dataImportService.js';
import { createDataIndex } from '../server/dataIndex.js';
import { writeAiAnalysesCache } from '../server/aiAnalysesCache.js';
import { resolveSessionGroupAnalysisData } from '../server/ai/dataResolver.js';
import { buildSessionAnalysisInput } from '../src/ai/sessionAnalysisContract.js';
import { makeHand } from './helpers/pokerHands.js';

const jsonResponse = (body) => new Response(JSON.stringify(body), {
  headers: { 'Content-Type': 'application/json' },
});

const handAnalysis = {
  heroResult: { outcome: 'FOLDED' },
  preflop: '', flop: '', turn: '', river: '', summary: 'Hero spasował.',
};

const sessionReportFor = (input) => ({
  reportId: `report-${input.sessionId}`,
  model: { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
  analyzedAt: '2026-08-10T12:00:00.000Z',
  fingerprint: input.fingerprint,
  analysis: {
    profileStyleId: input.profileStyleId,
    sessionSummary: 'Próba jest mała. Wnioski są ostrożne.',
    keyMistakes: [],
    notableHands: [{ handId: input.largestSwingHandId, reason: 'Największy swing.' }],
  },
});

test('AI rozwiązuje handId i sessionIds z kanonicznego indeksu oraz blokuje starą rewizję bez wywołania dostawcy', async (t) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'poker-analyzer-ai-resolution-'));
  t.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const importer = createDataImportService({ dataDirectory });
  await importer.importText({
    filename: 'seed.txt',
    content: [
      makeHand({ id: '7301', table: 'A', date: '2026/08/01 12:00:00' }),
      makeHand({ id: '7302', table: 'B', date: '2026/08/01 12:00:01' }),
    ].join('\n\n'),
  });
  const dataIndex = createDataIndex({ dataDirectory, logger: { error: () => {} } });
  const snapshot = await dataIndex.start();
  const allSessions = [...snapshot.sessions.cash, ...snapshot.sessions.tournament];
  const sessionInputs = allSessions.map((session) => buildSessionAnalysisInput({
    sessionId: session.id,
    hands: session.hands,
    gameType: session.type === 'Cash' ? 'cash' : 'tournament',
  }));
  await writeAiAnalysesCache({
    version: 1,
    updatedAt: null,
    handAnalyses: {},
    sessionAnalyses: Object.fromEntries(sessionInputs.map((input) => [input.sessionId, [sessionReportFor(input)]])),
    sessionGroupAnalyses: [],
  }, dataDirectory);

  const resolvedGroup = await resolveSessionGroupAnalysisData({
    dataIndex,
    dataDirectory,
    sessionIds: sessionInputs.map((input) => input.sessionId),
    datasetRevision: snapshot.datasetRevision,
  });
  assert.equal(resolvedGroup.group.sources.length, 2);
  assert.equal(JSON.stringify(resolvedGroup.group).includes('rawText'), false);
  const firstSource = resolvedGroup.group.sources[0];
  const sourceRef = {
    sourceId: firstSource.sourceId,
    reportId: firstSource.reportId,
    handIds: [firstSource.referencedHandIds[0]],
  };
  const groupAnalysis = {
    profileStyleId: resolvedGroup.group.metrics.shared.profileStyleId,
    reliabilityId: resolvedGroup.group.metrics.shared.reliability.id,
    summary: 'Podsumowanie wybranych sesji na podstawie bieżących danych.',
    summarySourceRefs: [sourceRef],
    strengths: [{ title: 'Dyscyplina', description: 'Spójna gra.', sourceRefs: [sourceRef] }],
    repeatedMistakes: [],
    trainingPriorities: [
      { title: 'Priorytet 1', description: 'Opis.', sourceRefs: [sourceRef] },
      { title: 'Priorytet 2', description: 'Opis.', sourceRefs: [sourceRef] },
      { title: 'Priorytet 3', description: 'Opis.', sourceRefs: [sourceRef] },
    ],
    categoryInsights: [{
      category: 'cash',
      summary: 'Wnioski dla Cash.',
      sourceRefs: [sourceRef],
      tendencies: [{ title: 'Tendencja', description: 'Opis.', sourceRefs: [sourceRef] }],
      recommendations: [{ title: 'Zalecenie', description: 'Opis.', sourceRefs: [sourceRef] }],
    }],
  };

  let providerCalls = 0;
  let providerInput = '';
  const server = createApiApp({
    dataDirectory,
    environment: { OPENAI_API_KEY: 'test' },
    logger: { error: () => {} },
    fetchImpl: async (_url, options) => {
      providerCalls += 1;
      providerInput = options.body;
      return jsonResponse({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(providerCalls === 1 ? handAnalysis : groupAnalysis) }] }],
      });
    },
  }).listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const success = await fetch(`${baseUrl}/api/ai/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelId: 'gpt-5.6-terra', handId: '7301', datasetRevision: snapshot.datasetRevision,
    }),
  });
  const successBody = await success.json();
  assert.equal(success.status, 200);
  assert.equal(successBody.datasetRevision, snapshot.datasetRevision);
  assert.equal(successBody.analysis.heroResult.handId, '7301');
  assert.match(providerInput, /CoinPoker Hand #7301/);

  const groupResponse = await fetch(`${baseUrl}/api/ai/analyze-session-group`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelId: 'gpt-5.6-terra',
      sessionIds: sessionInputs.map((input) => input.sessionId),
      datasetRevision: snapshot.datasetRevision,
    }),
  });
  const groupBody = await groupResponse.json();
  assert.equal(groupResponse.status, 200);
  assert.equal(groupBody.activeCategory, 'cash');
  assert.equal(groupBody.sessionCount, 2);
  assert.equal(groupBody.handCount, 2);
  assert.deepEqual(groupBody.categoryBreakdown.cash, { sessionCount: 2, handCount: 2 });
  assert.equal(groupBody.sources.length, 2);
  assert.equal(JSON.stringify(groupBody.sources).includes('rawText'), false);
  assert.equal(JSON.stringify(groupBody.sources).includes('sessionSummary'), false);

  const stale = await fetch(`${baseUrl}/api/ai/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'gpt-5.6-terra', handId: '7301', datasetRevision: 'stale' }),
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'DATASET_REVISION_MISMATCH');
  assert.equal(providerCalls, 2);
});
