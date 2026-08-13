import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlayerAnalysisGeminiResponseSchema,
  buildPlayerAnalysisInput,
  buildPlayerAnalysisModelContext,
  buildPlayerAnalysisPrompt,
  buildPlayerAnalysisResponseSchema,
  createPlayerAnalysisFingerprint,
  normalizePlayerAnalysisReferences,
  playerAnalysisGeminiResponseSchema,
  playerAnalysisResponseSchema,
  validatePlayerAnalysis,
  validatePlayerAnalysisInput,
} from '../src/ai/playerAnalysisContract.js';
import { buildPlayerAnalysisData } from '../src/ai/playerAnalysisData.js';
import { buildSessionAnalysisInput } from '../src/ai/sessionAnalysisContract.js';

const timestamp = (index) => new Date(2026, 7, 1, 0, 0, index).getTime();

const makeHand = (index, isTournament = false) => ({
  id: `hand-${index}`,
  sessionId: `session-${Math.floor(index / 5)}`,
  timestamp: timestamp(index),
  isTournament,
  netProfit: isTournament ? index : index / 100,
  bigBlind: 0.1,
  heroVPIP: index % 2 === 0,
  heroPFR: index % 3 === 0,
  heroSawFlop: false,
  sawShowdown: false,
});

const buildInput = (gameType = 'both') => {
  const hands = Array.from({ length: 30 }, (_, index) => makeHand(
    index + 1,
    gameType === 'tournament' || (gameType === 'both' && index >= 15),
  ));
  return buildPlayerAnalysisInput(buildPlayerAnalysisData({ hands, gameType }));
};

const refs = (metricId) => ({ metricIds: [metricId], sessionReportIds: [] });

const makeAnalysis = (input) => ({
  profileStyleId: input.profileStyleId,
  reliabilityId: input.reliabilityId,
  summary: 'Profil pokazuje tendencje wymagające dalszej obserwacji.',
  summaryMetricIds: ['shared.preflop.vpip'],
  summarySessionReportIds: [],
  strengths: [{
    title: 'Selekcja wejść',
    description: 'Częstotliwość wejść tworzy punkt odniesienia.',
    ...refs('shared.preflop.vpip'),
  }],
  leaks: [{
    title: 'Niska agresja',
    description: 'Relacja VPIP do PFR sugeruje zbyt pasywne wejścia.',
    correction: 'Ogranicz calle i częściej wybieraj raise z górą zakresu.',
    ...refs('shared.preflop.pfr'),
  }],
  trainingPriorities: [1, 2, 3].map((number) => ({
    title: `Priorytet ${number}`,
    description: `Opis priorytetu ${number}.`,
    exercise: `Ćwiczenie ${number}.`,
    ...refs('shared.preflop.vpip'),
  })),
  categoryInsights: (input.criteria.gameType === 'both'
    ? ['cash', 'tournament']
    : [input.criteria.gameType]).map((category) => ({
    category,
    summary: `Osobne podsumowanie ${category}.`,
    ...refs(`${category}.winrate`),
  })),
});

test('kontrakt tworzy stabilny fingerprint bez wspólnego wyniku ekonomicznego', () => {
  const first = buildInput('both');
  const second = buildInput('both');

  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(createPlayerAnalysisFingerprint(first), first.fingerprint);
  assert.equal(validatePlayerAnalysisInput(first).fingerprint, first.fingerprint);
  assert.equal(Object.hasOwn(first.metrics.shared, 'totalProfit'), false);
  assert.equal(Object.hasOwn(first.metrics.shared, 'winrate'), false);
  assert.equal(first.metrics.cash.winrate.unit, 'BB/100');
  assert.equal(first.metrics.tournament.winrate.unit, 'żetony/100');
  assert.equal(Object.hasOwn(first.metricCatalog, 'shared.totalProfit'), false);

  const changed = buildPlayerAnalysisInput({
    ...first,
    fingerprint: undefined,
    metricCatalog: {
      ...first.metricCatalog,
      'shared.preflop.vpip': {
        ...first.metricCatalog['shared.preflop.vpip'],
        value: 99,
      },
    },
  });
  assert.notEqual(changed.fingerprint, first.fingerprint);
  assert.throws(
    () => validatePlayerAnalysisInput({ ...changed, fingerprint: first.fingerprint }),
    /Odcisk analizy gracza/,
  );
});

test('prompt przekazuje wyłącznie metryki i skróty źródeł oraz jasno wymaga referencji', () => {
  const input = buildInput('cash');
  const context = buildPlayerAnalysisModelContext(input);
  const prompt = buildPlayerAnalysisPrompt(input);

  assert.equal(Object.hasOwn(context, 'fingerprint'), false);
  assert.equal(Object.hasOwn(context, 'bytes'), false);
  assert.equal(JSON.stringify(context).includes('rawText'), false);
  assert.match(prompt, /Każdy wniosek/);
  assert.match(prompt, /metricIds/);
  assert.match(prompt, /sessionReportIds są opcjonalne/);
  assert.match(prompt, /Dozwolone metricIds to wyłącznie/);
  assert.match(prompt, /Nie powtarzaj tego samego metricId/);
  assert.match(prompt, /powtarzalnymi wzorcami znalezionymi/);
});

test('walidator przyjmuje kompletny raport z opcjonalnie pustymi źródłami sesji', () => {
  const input = buildInput('both');
  const analysis = makeAnalysis(input);

  assert.deepEqual(validatePlayerAnalysis(analysis, input), analysis);
  assert.equal(analysis.trainingPriorities.length, 3);
  assert.deepEqual(analysis.categoryInsights.map(({ category }) => category), ['cash', 'tournament']);
});

test('normalizator zachowuje kolejność poprawnych referencji i raportuje odrzucone ID', () => {
  const input = buildInput('both');
  const metricIds = Object.keys(input.metricCatalog);
  const analysis = makeAnalysis(input);
  analysis.summaryMetricIds = [
    metricIds[0], '', 'unknown.metric', metricIds[0], ...metricIds.slice(1, 7),
  ];
  analysis.summarySessionReportIds = [null, 'unknown-report'];
  analysis.categoryInsights[0].metricIds = ['tournament.winrate'];

  const normalized = normalizePlayerAnalysisReferences(analysis, input);

  assert.deepEqual(normalized.analysis.summaryMetricIds, metricIds.slice(0, 5));
  assert.deepEqual(normalized.analysis.summarySessionReportIds, []);
  assert.deepEqual(normalized.analysis.categoryInsights[0].metricIds, []);
  assert.deepEqual(
    normalized.referenceWarnings.map(({ path, kind, reason }) => ({ path, kind, reason })),
    [
      { path: 'summaryMetricIds', kind: 'metric', reason: 'missing' },
      { path: 'summaryMetricIds', kind: 'metric', reason: 'unknown' },
      { path: 'summaryMetricIds', kind: 'metric', reason: 'duplicate' },
      { path: 'summaryMetricIds', kind: 'metric', reason: 'limit' },
      { path: 'summarySessionReportIds', kind: 'sessionReport', reason: 'missing' },
      { path: 'summarySessionReportIds', kind: 'sessionReport', reason: 'unknown' },
      { path: 'categoryInsights[0].metricIds', kind: 'metric', reason: 'wrongCategory' },
    ],
  );
  assert.doesNotThrow(() => validatePlayerAnalysis(normalized.analysis, input));
});

test('walidator przyjmuje istniejący reportId, a kontekst modelu pomija fingerprint sesji', () => {
  const hands = Array.from({ length: 30 }, (_, index) => ({
    ...makeHand(index + 1),
    sessionId: 'evidence-session',
  }));
  const session = { id: 'evidence-session', type: 'Cash', hands };
  const sessionInput = buildSessionAnalysisInput({
    sessionId: session.id,
    gameType: 'cash',
    hands,
  });
  const report = {
    reportId: 'evidence-report',
    fingerprint: sessionInput.fingerprint,
    analyzedAt: '2026-08-10T12:00:00.000Z',
    model: { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
    analysis: {
      profileStyleId: sessionInput.profileStyleId,
      sessionSummary: 'Pierwsze zdanie. Drugie zdanie.',
      keyMistakes: [],
      notableHands: [{ handId: sessionInput.largestSwingHandId, reason: 'Największy swing.' }],
    },
  };
  const input = buildPlayerAnalysisInput(buildPlayerAnalysisData({
    hands,
    sessions: [session],
    sessionAnalyses: { [session.id]: [report] },
    gameType: 'cash',
  }));
  const analysis = {
    ...makeAnalysis(input),
    summarySessionReportIds: [report.reportId],
  };
  const context = buildPlayerAnalysisModelContext(input);

  assert.deepEqual(validatePlayerAnalysis(analysis, input), analysis);
  assert.equal(input.sessionEvidence.coverage.usedReports, 1);
  assert.equal(context.sessionEvidence.reports[0].reportId, report.reportId);
  assert.equal(JSON.stringify(context).includes('sessionFingerprint'), false);
  assert.equal(JSON.stringify(context).includes(sessionInput.fingerprint), false);
});

test('walidator odrzuca obce metryki, źródła, styl, wiarygodność i niepełny raport', () => {
  const input = buildInput('cash');
  const analysis = makeAnalysis(input);

  assert.throws(
    () => validatePlayerAnalysis({ ...analysis, profileStyleId: 'TAG' }, input),
    /niezgodne z lokalnymi metrykami/,
  );
  assert.throws(
    () => validatePlayerAnalysis({ ...analysis, reliabilityId: 'STATISTICAL' }, input),
    /niezgodne z lokalnymi metrykami/,
  );
  assert.throws(
    () => validatePlayerAnalysis({ ...analysis, summaryMetricIds: ['invented.metric'] }, input),
    /obcą, powieloną albo brakującą metrykę/,
  );
  assert.throws(
    () => validatePlayerAnalysis({ ...analysis, summaryMetricIds: ['shared.totalProfit'] }, input),
    /obcą, powieloną albo brakującą metrykę/,
  );
  assert.throws(
    () => validatePlayerAnalysis({ ...analysis, summarySessionReportIds: ['foreign-report'] }, input),
    /obcy albo powielony raport sesji/,
  );
  assert.throws(
    () => validatePlayerAnalysis({
      ...analysis,
      trainingPriorities: analysis.trainingPriorities.slice(0, 2),
    }, input),
    /dokładnie trzy/,
  );
  const { leaks, ...incomplete } = analysis;
  void leaks;
  assert.throws(() => validatePlayerAnalysis(incomplete, input), /kompletnego raportu/);
});

test('sekcje kategorii nie mogą mieszać metryk Cash i Turniejów', () => {
  const input = buildInput('both');
  const analysis = makeAnalysis(input);
  const mixed = {
    ...analysis,
    categoryInsights: analysis.categoryInsights.map((insight) => (
      insight.category === 'cash'
        ? { ...insight, metricIds: ['tournament.winrate'] }
        : insight
    )),
  };

  assert.throws(() => validatePlayerAnalysis(mixed, input), /metrykę innego typu gry/);
  assert.throws(
    () => validatePlayerAnalysis({ ...analysis, categoryInsights: [analysis.categoryInsights[0]] }, input),
    /sekcje Cash\/Turnieje/,
  );
});

test('schemat ma wymagane limity, a wariant Gemini pozostawia je walidatorowi serwera', () => {
  assert.equal(playerAnalysisResponseSchema.properties.strengths.maxItems, 5);
  assert.equal(playerAnalysisResponseSchema.properties.leaks.maxItems, 5);
  assert.equal(playerAnalysisResponseSchema.properties.trainingPriorities.minItems, 3);
  assert.equal(playerAnalysisResponseSchema.properties.trainingPriorities.maxItems, 3);
  assert.equal(JSON.stringify(playerAnalysisGeminiResponseSchema).includes('minItems'), false);
  assert.equal(JSON.stringify(playerAnalysisGeminiResponseSchema).includes('maxItems'), false);
});

test('dynamiczny schemat ogranicza metryki i raporty do bieżącego wejścia oraz używa $defs', () => {
  const input = buildInput('cash');
  const reportIds = ['session-report-1', 'session-report-2'];
  const schemaInput = {
    ...input,
    sessionEvidence: {
      ...input.sessionEvidence,
      reports: reportIds.map((reportId) => ({ reportId })),
    },
  };
  const schema = buildPlayerAnalysisResponseSchema(schemaInput);
  const geminiSchema = buildPlayerAnalysisGeminiResponseSchema(schemaInput);

  assert.deepEqual(schema.$defs.metricIds.items.enum, Object.keys(input.metricCatalog));
  assert.deepEqual(schema.$defs.sessionReportIds.items.enum, reportIds);
  assert.equal(schema.properties.summaryMetricIds.$ref, '#/$defs/metricIds');
  assert.equal(schema.properties.strengths.items.$ref, '#/$defs/finding');
  assert.equal(schema.properties.categoryInsights.minItems, 1);
  assert.equal(schema.properties.categoryInsights.maxItems, 1);
  assert.equal(geminiSchema.$defs.metricIds.items.enum.length, Object.keys(input.metricCatalog).length);
  assert.equal(geminiSchema.$defs.metricIds.minItems, 1);
  assert.equal(geminiSchema.properties.trainingPriorities.maxItems, 3);

  const noReportsSchema = buildPlayerAnalysisResponseSchema(input);
  assert.equal(noReportsSchema.$defs.sessionReportIds.maxItems, 0);
  assert.equal(noReportsSchema.$defs.sessionReportIds.items.enum.length, 1);
});

test('kontrakt odrzuca próbę dodania wspólnego wyniku ekonomicznego do wejścia', () => {
  const input = buildInput('both');
  assert.throws(
    () => buildPlayerAnalysisInput({
      ...input,
      fingerprint: undefined,
      metrics: {
        ...input.metrics,
        shared: { ...input.metrics.shared, totalProfit: 123 },
      },
    }),
    /wspólnego wyniku Cash i Turniejów/,
  );
});
