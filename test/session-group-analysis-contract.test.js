import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_GROUP_ANALYSIS_MAX_BYTES,
  buildSessionGroupAnalysisInput,
  buildSessionGroupAnalysisModelContext,
  sessionGroupAnalysisGeminiResponseSchema,
  sessionGroupAnalysisResponseSchema,
  validateSessionGroupAnalysis,
  validateSessionGroupAnalysisInput,
} from '../src/ai/sessionGroupAnalysisContract.js';
import { buildSessionAnalysisInput } from '../src/ai/sessionAnalysisContract.js';

const timestamp = (day) => new Date(2026, 7, day, 12, 0, 0).getTime();

const makeHand = (id, day, netProfit, extra = {}) => ({
  id,
  timestamp: timestamp(day),
  position: 'BTN',
  blinds: '€0.05/€0.10',
  smallBlind: 0.05,
  bigBlind: 0.1,
  heroStartingStack: 10,
  heroCards: ['As', 'Kd'],
  boardCards: ['Ah', '7c', '2d'],
  outcome: netProfit >= 0 ? 'WON' : 'LOST',
  heroInvestment: 1,
  heroWinnings: Math.max(0, netProfit + 1),
  netProfit,
  handRanking: 'PAIR',
  rawText: `PRIVATE ${id}`,
  streets: [],
  ...extra,
});

const makeCandidate = ({ type, sessionId, day, summary = 'Pierwsze zdanie. Drugie zdanie.' } = {}) => {
  const hands = [
    makeHand(`${sessionId}-1`, day, 1),
    makeHand(`${sessionId}-2`, day, -2),
    makeHand(`${sessionId}-rebuy`, day, 100, { isRebuy: true }),
  ];
  const sessionFingerprint = buildSessionAnalysisInput({ sessionId, gameType: type, hands }).fingerprint;
  const report = {
    reportId: `report-${sessionId}`,
    fingerprint: sessionFingerprint,
    model: { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
    analyzedAt: '2026-08-08T12:00:00.000Z',
    analysis: {
      profileStyleId: 'INSUFFICIENT',
      sessionSummary: summary,
      keyMistakes: [{ title: 'Za szeroki call', description: 'Opis.', correction: 'Fold.', handIds: [`${sessionId}-1`, `${sessionId}-2`] }],
      notableHands: [{ handId: `${sessionId}-2`, reason: 'Swing.' }],
    },
  };
  return {
    sourceId: `${type}:${sessionId}`,
    type,
    sessionId,
    startTime: timestamp(day),
    date: `2026-08-${String(day).padStart(2, '0')} 12:00:00`,
    label: type === 'cash' ? `Stół ${sessionId}` : `Turniej ${sessionId}`,
    tableId: type === 'cash' ? sessionId : undefined,
    tournamentId: type === 'tournament' ? `T-${sessionId}` : undefined,
    tournamentName: type === 'tournament' ? `Turniej ${sessionId}` : undefined,
    hands,
    sessionFingerprint,
    report,
  };
};

const makeAnalysis = (group) => {
  const cash = group.sources.find((source) => source.type === 'cash');
  const tournament = group.sources.find((source) => source.type === 'tournament');
  const ref = (source, handIds = []) => ({ sourceId: source.sourceId, reportId: source.reportId, handIds });
  const sourceRef = ref(cash || tournament, [(cash || tournament).referencedHandIds[0]]);
  return {
    profileStyleId: group.metrics.shared.profileStyleId,
    reliabilityId: group.metrics.shared.reliability.id,
    summary: 'Przekrojowe podsumowanie lokalnych danych.',
    summarySourceRefs: [sourceRef],
    strengths: [{ title: 'Dyscyplina', description: 'Mocna strona.', sourceRefs: [sourceRef] }],
    repeatedMistakes: cash && tournament ? [{
      title: 'Za szerokie calle', description: 'Występują w różnych sesjach.', correction: 'Częściej folduj.',
      sourceRefs: [ref(cash, [cash.referencedHandIds[0]]), ref(tournament, [tournament.referencedHandIds[0]])],
    }] : [],
    trainingPriorities: [
      { title: 'Priorytet 1', description: 'Opis.', sourceRefs: [sourceRef] },
      { title: 'Priorytet 2', description: 'Opis.', sourceRefs: [sourceRef] },
      { title: 'Priorytet 3', description: 'Opis.', sourceRefs: [sourceRef] },
    ],
    categoryInsights: group.sources.reduce((insights, source) => {
      if (insights.some((insight) => insight.category === source.type)) return insights;
      insights.push({
        category: source.type,
        summary: `Podsumowanie ${source.type}.`,
        sourceRefs: [ref(source, [source.referencedHandIds[0]])],
        tendencies: [{ title: 'Tendencja', description: 'Opis.', sourceRefs: [ref(source)] }],
        recommendations: [{ title: 'Zalecenie', description: 'Opis.', sourceRefs: [ref(source)] }],
      });
      return insights;
    }, []),
  };
};

test('kontrakt wielu sesji łączy Cash i Turnieje bez surowych historii, rebuy i wspólnego wyniku', () => {
  const cash = makeCandidate({ type: 'cash', sessionId: 'cash-a', day: 1 });
  const tournament = makeCandidate({ type: 'tournament', sessionId: 'tourney-b', day: 2 });
  const first = buildSessionGroupAnalysisInput({
    sources: [tournament, cash],
    activeCategory: 'both',
    dateRange: { from: '2026-08-01', to: '2026-08-02' },
  });
  const second = buildSessionGroupAnalysisInput({
    sources: [cash, tournament],
    activeCategory: 'both',
    dateRange: { from: '2026-08-01', to: '2026-08-02' },
  });

  assert.equal(first.fingerprint, second.fingerprint);
  assert.deepEqual(first.sources.map((source) => source.sourceId), ['cash:cash-a', 'tournament:tourney-b']);
  assert.equal(first.sources[0].metadata.handCount, 2);
  assert.equal(Object.hasOwn(first.metrics.shared, 'totalProfit'), false);
  assert.equal(Object.hasOwn(first.metrics.shared, 'winrate'), false);
  assert.equal(first.metrics.cash.winrate.unit, 'BB/100');
  assert.equal(first.metrics.tournament.winrate.unit, 'żetony/100');
  assert.equal(JSON.stringify(first).includes('PRIVATE'), false);
  assert.equal(first.sources.some((source) => Object.hasOwn(source, 'hands')), false);
  const modelContext = buildSessionGroupAnalysisModelContext(first);
  assert.equal(Object.hasOwn(modelContext, 'fingerprint'), false);
  assert.equal(Object.hasOwn(modelContext, 'bytes'), false);
  assert.equal(JSON.stringify(modelContext).includes('sessionFingerprint'), false);
  assert.equal(JSON.stringify(modelContext).includes('reportFingerprint'), false);
  assert.equal(JSON.stringify(modelContext).includes('analyzedAt'), false);
  assert.equal(JSON.stringify(modelContext).includes('"model"'), false);
  assert.equal(validateSessionGroupAnalysisInput(first).fingerprint, first.fingerprint);
  assert.throws(() => validateSessionGroupAnalysisInput({
    ...first,
    metrics: { ...first.metrics, shared: { ...first.metrics.shared, totalProfit: 1 } },
  }), /nieprawidłowy zakres/);
  assert.throws(() => validateSessionGroupAnalysisInput({
    ...first,
    metrics: {
      ...first.metrics,
      shared: {
        ...first.metrics.shared,
        vpip: { ...first.metrics.shared.vpip, handHistory: 'nie wolno przekazywać historii' },
      },
    },
  }), /nieprawidłowy zakres/);
  assert.deepEqual(
    sessionGroupAnalysisResponseSchema.properties.strengths.items.properties.sourceRefs.items.required,
    ['sourceId', 'reportId', 'handIds'],
  );
  assert.equal(sessionGroupAnalysisResponseSchema.properties.trainingPriorities.minItems, 3);
  assert.equal(JSON.stringify(sessionGroupAnalysisGeminiResponseSchema).includes('minItems'), false);
  assert.equal(JSON.stringify(sessionGroupAnalysisGeminiResponseSchema).includes('maxItems'), false);
});

test('kontrakt wielu sesji wymaga dwóch unikalnych źródeł, zgodnej kategorii i zakresu dat', () => {
  const cash = makeCandidate({ type: 'cash', sessionId: 'cash-a', day: 1 });
  const tournament = makeCandidate({ type: 'tournament', sessionId: 'tourney-b', day: 2 });

  assert.throws(() => buildSessionGroupAnalysisInput({ sources: [cash], activeCategory: 'cash' }), /co najmniej dwie/);
  assert.throws(() => buildSessionGroupAnalysisInput({ sources: [cash, cash], activeCategory: 'cash' }), /powielonych/);
  assert.throws(() => buildSessionGroupAnalysisInput({
    sources: [cash, { ...cash, sourceId: 'cash:alias' }],
    activeCategory: 'cash',
  }), /niekanoniczny/);
  assert.throws(() => buildSessionGroupAnalysisInput({
    sources: [cash, { ...tournament, report: { ...tournament.report, analysis: { ...tournament.report.analysis, handHistory: 'raw' } } }],
    activeCategory: 'both',
  }), /nieprawidłowy format/);
  assert.throws(() => buildSessionGroupAnalysisInput({ sources: [cash, tournament], activeCategory: 'cash' }), /kategorii/);
  assert.throws(() => buildSessionGroupAnalysisInput({
    sources: [cash, tournament], activeCategory: 'both', dateRange: { from: '2026-08-01', to: '2026-08-01' },
  }), /zakresie dat/);
});

test('kontrakt wielu sesji liczy metryki w stabilnej kolejności źródeł', () => {
  const cashA = makeCandidate({ type: 'cash', sessionId: 'cash-a', day: 1 });
  const cashB = makeCandidate({ type: 'cash', sessionId: 'cash-b', day: 1 });
  cashA.hands[0].netProfit = 1e16;
  cashA.hands[1].netProfit = -1e16;
  cashA.report.analysis.notableHands[0].handId = 'cash-a-1';
  cashB.hands[0].netProfit = 1;
  cashB.hands[1].netProfit = 2;
  [cashA, cashB].forEach((candidate) => {
    const fingerprint = buildSessionAnalysisInput({
      sessionId: candidate.sessionId,
      gameType: candidate.type,
      hands: candidate.hands,
    }).fingerprint;
    candidate.sessionFingerprint = fingerprint;
    candidate.report.fingerprint = fingerprint;
  });

  const first = buildSessionGroupAnalysisInput({ sources: [cashA, cashB], activeCategory: 'cash' });
  const second = buildSessionGroupAnalysisInput({ sources: [cashB, cashA], activeCategory: 'cash' });

  assert.equal(first.metrics.cash.totalProfit, second.metrics.cash.totalProfit);
  assert.equal(first.fingerprint, second.fingerprint);
});

test('kontrakt wielu sesji obsługuje pięć zaznaczonych sesji', () => {
  const sources = [
    makeCandidate({ type: 'tournament', sessionId: 'tourney-a', day: 1 }),
    makeCandidate({ type: 'tournament', sessionId: 'tourney-b', day: 2 }),
    makeCandidate({ type: 'tournament', sessionId: 'tourney-c', day: 3 }),
    makeCandidate({ type: 'tournament', sessionId: 'tourney-d', day: 4 }),
    makeCandidate({ type: 'tournament', sessionId: 'tourney-e', day: 5 }),
  ];

  const group = buildSessionGroupAnalysisInput({
    sources,
    activeCategory: 'tournament',
    dateRange: { from: '2026-08-01', to: '2026-08-05' },
  });

  assert.equal(group.sources.length, 5);
  assert.equal(group.metrics.shared.hands, 10);
  assert.equal(group.metrics.tournament.hands, 10);
});

test('kontrakt wielu sesji odrzuca zbyt duże wejście bez skracania danych', () => {
  const cash = makeCandidate({
    type: 'cash',
    sessionId: 'cash-a',
    day: 1,
    summary: `Pierwsze zdanie. ${'x'.repeat(SESSION_GROUP_ANALYSIS_MAX_BYTES)} Drugie zdanie.`,
  });
  const tournament = makeCandidate({ type: 'tournament', sessionId: 'tourney-b', day: 1 });
  assert.throws(
    () => buildSessionGroupAnalysisInput({ sources: [cash, tournament], activeCategory: 'both' }),
    (error) => error.code === 'AI_SESSION_GROUP_TOO_LARGE',
  );
});

test('walidacja raportu wymaga lokalnego stylu, trzech priorytetów, właściwych źródeł i dwóch sesji dla błędu', () => {
  const cash = makeCandidate({ type: 'cash', sessionId: 'cash-a', day: 1 });
  const tournament = makeCandidate({ type: 'tournament', sessionId: 'tourney-b', day: 2 });
  const group = buildSessionGroupAnalysisInput({ sources: [cash, tournament], activeCategory: 'both' });
  const analysis = makeAnalysis(group);

  assert.deepEqual(validateSessionGroupAnalysis(analysis, group), analysis);
  assert.throws(
    () => validateSessionGroupAnalysis({ ...analysis, profileStyleId: 'TAG' }, group),
    /niezgodne z lokalnymi metrykami/,
  );
  assert.throws(
    () => validateSessionGroupAnalysis({ ...analysis, trainingPriorities: analysis.trainingPriorities.slice(0, 2) }, group),
    /priorytetów/,
  );
  assert.throws(
    () => validateSessionGroupAnalysis({ ...analysis, summarySourceRefs: [] }, group),
    /nie wskazuje raportu źródłowego/,
  );
  assert.throws(
    () => validateSessionGroupAnalysis({
      ...analysis,
      repeatedMistakes: [{ ...analysis.repeatedMistakes[0], sourceRefs: [analysis.repeatedMistakes[0].sourceRefs[0]] }],
    }, group),
    /co najmniej dwóch różnych sesji/,
  );
  assert.throws(
    () => validateSessionGroupAnalysis({
      ...analysis,
      repeatedMistakes: [{ ...analysis.repeatedMistakes[0], correction: undefined }],
    }, group),
    /praktyczną korektę/,
  );
  assert.throws(
    () => validateSessionGroupAnalysis({
      ...analysis,
      categoryInsights: [{ ...analysis.categoryInsights[0], category: 'cash' }],
    }, group),
    /sekcje kategorii/,
  );
  assert.throws(
    () => validateSessionGroupAnalysis({
      ...analysis,
      categoryInsights: analysis.categoryInsights.map((insight) => ({ ...insight, tendencies: [] })),
    }, group),
    /musi zawierać tendencje i zalecenia/,
  );
});
