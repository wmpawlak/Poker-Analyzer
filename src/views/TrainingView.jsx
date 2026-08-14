import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpen,
  Brain,
  CheckCircle2,
  CircleDot,
  Clock3,
  Dumbbell,
  Eye,
  Grid,
  History,
  Info,
  RotateCcw,
  Target,
  Trophy,
  X,
  XCircle,
} from 'lucide-react';
import { CardIcon } from '../components/CardIcon.jsx';
import { EQUITY_MODES, EXERCISE_TYPES } from '../training/trainingTypes.js';
import { EQUITY_BUCKETS } from '../parser/equityCalculator.js';
import * as defaultTrainingApi from '../training/trainingApi.js';

export const ACTIVE_TRAINING_SESSION_KEY = 'poker_active_training_session_v1';

const EXERCISE_CATALOG = [
  {
    id: EXERCISE_TYPES.PREFLOP_SELECTION,
    title: 'Selekcja preflop',
    description: 'Dobierz fold, call lub raise do pozycji, stacka i akcji przed Tobą.',
    target: 200,
  },
  {
    id: EXERCISE_TYPES.PREFLOP_VS_RERAISE,
    title: 'Przeciw 3-betom i reshove’om',
    description: 'Ćwicz odpowiedzi na ponowne podbicie z widocznymi pot odds i stackiem efektywnym.',
    target: 100,
  },
  {
    id: EXERCISE_TYPES.CBET_BARRELS,
    title: 'C-bet i kolejne baryłki',
    description: 'Wybierz check, mały bet lub duży bet. Turn jest kontynuacją prawdziwej linii.',
    target: 100,
  },
  {
    id: EXERCISE_TYPES.TURN_RIVER,
    title: 'Decyzje turn/river',
    description: 'Rozpoznawaj value, bluff, bluff-catcher, check i fold.',
    target: 100,
  },
  {
    id: EXERCISE_TYPES.EQUITY_POT_ODDS,
    title: 'Equity i pot odds',
    description: 'Wybierz poziom: znana ręka, zakres, terminalne pot odds albo mixed.',
    target: 100,
  },
];

const GAME_OPTIONS = [
  { id: 'both', label: 'Cash + Turnieje' },
  { id: 'cash', label: 'Cash' },
  { id: 'tournament', label: 'Turnieje' },
];
const SESSION_SIZES = [10, 20, 50, 100, 'all'];
const EQUITY_MODE_OPTIONS = [
  [EQUITY_MODES.KNOWN_HAND, 'Znana ręka'],
  [EQUITY_MODES.RANGE, 'Zakres'],
  [EQUITY_MODES.POT_ODDS, 'Pot odds'],
  [EQUITY_MODES.MIXED, 'Mixed'],
];

const ACTION_LABELS = {
  fold: 'Fold',
  call: 'Call',
  raise: 'Raise',
  check: 'Check',
  bet: 'Bet',
  small_bet: 'Mały bet (do 40% puli)',
  large_bet: 'Duży bet (powyżej 40% puli)',
  value_bet: 'Value bet',
  bluff: 'Bluff',
  bluff_catcher: 'Bluff-catcher',
  preflop_selection: 'Selekcja preflop',
  preflop_vs_reraise: 'Przeciw ponownemu podbiciu',
  cbet_barrels: 'C-bet i baryłki',
  turn_river: 'Turn / river',
  equity_pot_odds: 'Equity i pot odds',
  open_vs_3bet: 'Open przeciw 3-betowi',
  raise_vs_reshove: 'Raise przeciw reshove’owi',
  small_blind: 'wpłaca SB',
  big_blind: 'wpłaca BB',
  ante: 'wpłaca ante',
  straddle: 'wpłaca straddle',
  auto_big_blind: 'wpłaca auto-BB',
  small_big_blind: 'wpłaca SB + BB',
  return: 'otrzymuje zwrot',
};

const GRADE_META = {
  correct: { label: 'Poprawna', icon: CheckCircle2, classes: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  acceptable: { label: 'Dopuszczalna', icon: CircleDot, classes: 'border-amber-200 bg-amber-50 text-amber-900' },
  incorrect: { label: 'Błąd', icon: XCircle, classes: 'border-rose-200 bg-rose-50 text-rose-800' },
};

const HISTORICAL_DECISION_META = {
  correct: { label: 'Dobra decyzja', classes: 'text-emerald-800' },
  acceptable: { label: 'Dopuszczalna decyzja', classes: 'text-amber-900' },
  incorrect: { label: 'Błędna decyzja', classes: 'text-rose-800' },
};

const asNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const formatAmount = (value) => asNumber(value).toLocaleString('pl-PL', { maximumFractionDigits: 2 });
const formatPercent = (value) => `${(asNumber(value) * 100).toLocaleString('pl-PL', { maximumFractionDigits: 1 })}%`;
const formatRangeHandClass = (value) => {
  const notation = String(value || '').trim();
  const match = notation.match(/^([2-9TJQKA])([2-9TJQKA])([so]?)$/i);
  if (!match) return notation;
  return `${match[1].toUpperCase()}${match[2].toUpperCase()}${match[3].toLowerCase()}`;
};
const RANGE_MATRIX_RANKS = Object.freeze(['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']);
const RANGE_MATRIX_GRID_TEMPLATE = `repeat(${RANGE_MATRIX_RANKS.length}, minmax(0, 1fr))`;
const getRangeMatrixHandClass = (rowRank, columnRank, row, column) => {
  if (row === column) return `${rowRank}${columnRank}`;
  return row < column ? `${rowRank}${columnRank}s` : `${columnRank}${rowRank}o`;
};
const getRangeMatrixCells = (modelRange) => {
  const weightsByHandClass = new Map();
  modelRange.forEach(({ handClass, weight }) => {
    const normalizedHandClass = formatRangeHandClass(handClass);
    const normalizedWeight = Math.max(0, Math.min(1, asNumber(weight)));
    weightsByHandClass.set(
      normalizedHandClass,
      Math.max(weightsByHandClass.get(normalizedHandClass) || 0, normalizedWeight),
    );
  });
  return RANGE_MATRIX_RANKS.flatMap((rowRank, row) => RANGE_MATRIX_RANKS.map((columnRank, column) => {
    const handClass = getRangeMatrixHandClass(rowRank, columnRank, row, column);
    return { handClass, row, column, weight: weightsByHandClass.get(handClass) || 0 };
  }));
};
const rangeMatrixCellClasses = (weight) => {
  if (weight >= 0.9) return 'border-emerald-600 bg-emerald-600 text-white';
  if (weight >= 0.65) return 'border-emerald-400 bg-emerald-300 text-emerald-950';
  if (weight >= 0.4) return 'border-emerald-300 bg-emerald-100 text-emerald-900';
  if (weight > 0) return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  return 'border-slate-200 bg-slate-50 text-slate-400';
};
const actionLabel = (value) => ACTION_LABELS[value] || String(value || '—').replaceAll('_', ' ');
const LEGACY_EQUITY_BUCKET_LABELS = Object.freeze({
  equity_0_10: '0–10%', equity_10_20: '10–20%', equity_20_30: '20–30%', equity_30_40: '30–40%',
  equity_40_50: '40–50%', equity_50_60: '50–60%', equity_60_70: '60–70%', equity_70_80: '70–80%',
  equity_80_90: '80–90%', equity_90_100: '90–100%',
});
const equityBucketLabel = (value) => EQUITY_BUCKETS.find(({ id }) => id === value)?.label
  || LEGACY_EQUITY_BUCKET_LABELS[value]
  || actionLabel(value);

const getEquityCoverageMessage = (question) => {
  if (!question || question.exerciseType === EXERCISE_TYPES.EQUITY_POT_ODDS
    || question.equityMode || question.question?.equityMode) return null;
  const state = question.question || {};
  const opponentsInHand = Number(state.context?.opponentsInHand);
  const hasCall = asNumber(state.toCall) > 0
    && (!Array.isArray(state.legalActions) || state.legalActions.includes('call'));
  if (opponentsInHand === 1 && hasCall) {
    return question.equitySupplementAvailable === true
      ? null
      : 'Analiza equity względem zakresu nie jest jeszcze dostępna. Możesz normalnie rozwiązać to pytanie.';
  }
  return 'Osobna ocena equity nie dotyczy tego typu pytania.';
};

const getPoolCount = (status, exerciseType, gameType, equityMode = null) => {
  const pools = status?.pools?.[exerciseType];
  if (!pools) return 0;
  const count = (pool) => equityMode && pool?.modeCounts
    ? equityMode === EQUITY_MODES.MIXED
      ? Object.values(pool.modeCounts).reduce((sum, value) => sum + (Number(value) || 0), 0)
      : pool.modeCounts[equityMode] || 0
    : pool?.active || 0;
  if (gameType === 'both') return count(pools.cash) + count(pools.tournament);
  return count(pools[gameType]);
};

const getEquityActivationCount = (status, gameType, equityMode) => {
  const pools = status?.equityActivation?.pools || {};
  const count = (pool) => equityMode === EQUITY_MODES.MIXED
    ? Object.values(pool?.candidateModeCounts || {}).reduce((sum, value) => sum + asNumber(value), 0)
    : asNumber(pool?.candidateModeCounts?.[equityMode]);
  if (gameType === 'both') return count(pools.cash) + count(pools.tournament);
  return count(pools[gameType]);
};

const getEquityModeUnavailableReason = (status, gameType, equityMode) => {
  const activation = status?.equityActivation || {};
  if (activation.needsActivation && getEquityActivationCount(status, gameType, equityMode) > 0) {
    return 'Analizy dla tego poziomu są gotowe, ale wymagają lokalnej aktywacji ćwiczeń equity.';
  }
  return 'Brak aktywnych spotów tego poziomu dla wybranego formatu.';
};

const getStorage = () => globalThis.localStorage || {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
};

const QuestionFact = ({ label, value, emphasized = false }) => (
  <div className={`rounded-xl border px-3 py-2 ${emphasized ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200 bg-white'}`}>
    <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</div>
    <div className={`mt-1 text-sm font-black ${emphasized ? 'text-indigo-800' : 'text-slate-800'}`}>{value}</div>
  </div>
);

export const PotOddsInfo = ({ pot, toCall }) => {
  const [open, setOpen] = useState(false);
  const potBefore = asNumber(pot);
  const callAmount = asNumber(toCall);
  const potAfterCall = potBefore + callAmount;
  const requiredEquity = potAfterCall > 0 ? callAmount / potAfterCall : 0;

  if (callAmount <= 0) return null;

  return (
    <span className="relative ml-1 inline-flex align-middle">
      <button
        type="button"
        data-testid="pot-odds-info"
        aria-label="Jak obliczono pot odds"
        aria-expanded={open}
        aria-describedby={open ? 'pot-odds-tooltip' : undefined}
        onClick={() => setOpen((current) => !current)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="rounded-full text-slate-400 transition-colors hover:text-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-300"
      >
        <Info size={14} aria-hidden="true"/>
      </button>
      <span className="sr-only">Pot odds: pula przed decyzją, kwota calla, pula po callu i wymagane equity.</span>
      {open && (
        <span
          id="pot-odds-tooltip"
          role="tooltip"
          className="absolute bottom-full left-1/2 z-20 mb-3 w-72 -translate-x-1/2 rounded-xl border border-indigo-200 bg-white p-3 text-left text-xs text-slate-700 shadow-xl"
        >
          <span className="mb-2 block text-[10px] font-black uppercase tracking-wider text-indigo-700">Jak liczymy pot odds</span>
          <ol className="list-decimal space-y-1 pl-4 leading-relaxed">
            <li>Pula przed Twoją decyzją: <strong>{formatAmount(potBefore)}</strong>.</li>
            <li>Do sprawdzenia: <strong>{formatAmount(callAmount)}</strong>.</li>
            <li>Pula po callu: <strong>{formatAmount(potBefore)} + {formatAmount(callAmount)} = {formatAmount(potAfterCall)}</strong>.</li>
            <li><strong>{formatAmount(callAmount)} / {formatAmount(potAfterCall)} = {formatPercent(requiredEquity)}</strong>.</li>
          </ol>
          <span className="mt-2 block border-t border-slate-100 pt-2 leading-relaxed text-slate-500">
            To minimalne equity dla samego calla, przed rake i wpływem dalszej gry.
          </span>
        </span>
      )}
    </span>
  );
};

const Cards = ({ cards, empty = '—' }) => (
  <div className="flex min-h-8 items-center gap-1">
    {cards?.length ? cards.map((card, index) => <CardIcon key={`${card}-${index}`} cardStr={card}/>) : <span className="text-sm text-slate-400">{empty}</span>}
  </div>
);

const PriorActions = ({ actions }) => (
  <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
    {(actions || []).length === 0 && <p className="p-3 text-sm text-slate-500">Brak wcześniejszych akcji.</p>}
    {(actions || []).map((action, index) => (
      <div key={`${action.street}-${action.actor}-${index}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
        <span className="font-bold text-slate-700">
          {action.actor} <span className="font-medium text-slate-500">({action.street})</span>
        </span>
        <span className={`font-bold ${action.forced ? 'text-slate-500' : ['bet', 'raise'].includes(action.type) ? 'text-orange-600' : 'text-indigo-700'}`}>
          {actionLabel(action.type)}
          {asNumber(action.amount) > 0 ? ` ${formatAmount(action.amount)}` : ''}
          {action.type === 'raise' && asNumber(action.toAmount) > 0 ? ` do ${formatAmount(action.toAmount)}` : ''}
          {action.allIn ? ' · all-in' : ''}
        </span>
      </div>
    ))}
  </div>
);

const PlayerStacks = ({ players, bigBlind }) => (
  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
    <table className="w-full text-left text-xs">
      <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-400">
        <tr><th className="px-3 py-2">Gracz</th><th className="px-3 py-2">Pozycja</th><th className="px-3 py-2 text-right">Stack</th><th className="px-3 py-2 text-right">Status</th></tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {(players || []).map((player) => (
          <tr key={player.playerId} className={player.playerId === 'Hero' ? 'bg-indigo-50/60' : ''}>
            <td className="px-3 py-2 font-bold text-slate-700">{player.playerId}</td>
            <td className="px-3 py-2 text-slate-500">{player.position}</td>
            <td className="px-3 py-2 text-right font-mono font-bold text-slate-700">
              {formatAmount(player.stack)}{bigBlind > 0 ? ` · ${formatAmount(player.stack / bigBlind)} BB` : ''}
            </td>
            <td className="px-3 py-2 text-right text-slate-500">{player.folded ? 'fold' : player.allIn ? 'all-in' : 'w grze'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const ModelRangeMatrixModal = ({ isOpen, cells, onClose }) => {
  useEffect(() => {
    if (!isOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  const inRangeCount = cells.filter(({ weight }) => weight > 0).length;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
      onClick={(event) => { if (event.currentTarget === event.target) onClose(); }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="equity-range-matrix-title"
        data-testid="equity-range-matrix-modal"
        className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 p-4">
          <div>
            <h3 id="equity-range-matrix-title" className="font-black text-slate-900">Założony zakres modelu</h3>
            <p className="mt-1 text-xs text-slate-600">{inRangeCount} klas rąk. Im ciemniejsza zieleń, tym większa część klasy należy do zakresu.</p>
          </div>
          <button
            type="button"
            data-testid="close-equity-range-matrix"
            aria-label="Zamknij macierz zakresu modelu"
            title="Zamknij"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
          >
            <X size={20} aria-hidden="true"/>
          </button>
        </header>
        <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-600">
          <span className="size-3 rounded-sm border border-emerald-600 bg-emerald-600" aria-hidden="true"/>
          <span>Ręka w zakresie</span>
          <span className="ml-3 size-3 rounded-sm border border-slate-200 bg-white" aria-hidden="true"/>
          <span>Poza zakresem</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div
            role="grid"
            aria-label="Macierz zakresu modelu"
            data-testid="equity-range-matrix"
            className="mx-auto grid w-full max-w-xl gap-1"
            style={{ gridTemplateColumns: RANGE_MATRIX_GRID_TEMPLATE }}
          >
            {cells.map(({ handClass, row, column, weight }) => {
              const weightPercent = Math.round(weight * 100);
              const included = weight > 0;
              return (
                <div
                  key={handClass}
                  role="gridcell"
                  data-testid="equity-range-matrix-cell"
                  data-hand-class={handClass}
                  data-row={row}
                  data-column={column}
                  data-range-weight={weightPercent}
                  aria-label={included ? `${handClass}: ${weightPercent}% zakresu modelu` : `${handClass}: poza zakresem modelu`}
                  title={included ? `${handClass} · ${weightPercent}%` : `${handClass} · poza zakresem`}
                  className={`flex aspect-square flex-col items-center justify-center rounded-md border p-1 text-center leading-none ${rangeMatrixCellClasses(weight)}`}
                >
                  <span className="text-xs font-black">{handClass}</span>
                  {included && <span className="mt-0.5 text-[10px] font-bold opacity-80">{weightPercent}%</span>}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
};

export const TrainingQuestion = ({
  question,
  selectedAnswer,
  selectedEquityBucket = '',
  onSelectEquityBucket = () => {},
  equityStep = 2,
  onAdvanceEquity = () => {},
  onBackEquity = () => {},
  onSelectAnswer,
  onSubmit,
  submitting = false,
  feedback = null,
  readOnly = false,
}) => {
  const [rangeMatrixSpotVersionId, setRangeMatrixSpotVersionId] = useState(null);
  const state = question.question || {};
  const bigBlind = asNumber(state.blinds?.bigBlind);
  const equityCoverageMessage = getEquityCoverageMessage(question);
  const equityMode = question.equityMode || state.equityMode;
  const equityAnswerOptions = question.equityAnswerOptions || [];
  const hasTwoStepEquity = [EQUITY_MODES.RANGE, EQUITY_MODES.POT_ODDS].includes(equityMode)
    && equityAnswerOptions.length > 0;
  const actionOptions = question.actionAnswerOptions?.length
    ? question.actionAnswerOptions
    : question.answerOptions;
  const modelRange = question.opponentRange || question.equitySupplement?.range || [];
  const rangeMatrixCells = getRangeMatrixCells(modelRange);
  const isRangeMatrixOpen = rangeMatrixSpotVersionId === question.spotVersionId;

  return (
    <section data-testid="training-question" data-spot-version-id={question.spotVersionId} className="space-y-5">
      {question.usesHistoricalLine && (
        <div role="note" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
          {question.continuationNotice || 'Ten etap jest kontynuacją historycznej linii, a nie symulacją poprzedniej odpowiedzi.'}
        </div>
      )}

      {state.equityMode === 'known_hand' && state.knownOpponentCards?.length === 2 && (
        <div role="note" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="font-black">Znana ręka rywala — tylko do ćwiczenia equity</div>
          <div className="mt-2"><Cards cards={state.knownOpponentCards}/></div>
          <p className="mt-2 text-xs font-semibold">{state.equityWarning || 'Karty rywala zostały ujawnione później w showdownie i nie były dostępne w momencie decyzji.'}</p>
        </div>
      )}

      {hasTwoStepEquity && (
        <div data-testid="equity-range-assumption" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-950">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="font-black">Założony zakres modelu</h4>
              <p className="mt-1 text-xs text-emerald-800">To jawne założenie trenera, używane wyłącznie do dodatkowej oceny equity.</p>
            </div>
            {modelRange.length > 0 && <button
              type="button"
              data-testid="open-equity-range-matrix"
              aria-haspopup="dialog"
              aria-label="Otwórz zakres modelu jako macierz rąk startowych"
              onClick={() => setRangeMatrixSpotVersionId(question.spotVersionId)}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-white px-4 py-2.5 text-xs font-black text-emerald-900 shadow-sm transition-colors hover:border-emerald-400 hover:bg-emerald-100"
            >
              <Grid size={16} aria-hidden="true"/> Macierz zakresu
            </button>}
          </div>
          {modelRange.length === 0 && <p className="mt-3 text-xs text-emerald-800">Brak danych zakresu.</p>}
        </div>
      )}
      <ModelRangeMatrixModal
        isOpen={isRangeMatrixOpen}
        cells={rangeMatrixCells}
        onClose={() => setRangeMatrixSpotVersionId(null)}
      />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-2xl border border-slate-200 bg-slate-900 p-5 text-white shadow-sm">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300">Karty Hero · {state.heroPosition}</div>
              <div className="mt-2"><Cards cards={state.heroCards}/></div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Board do {String(question.street || '').toLowerCase()}</div>
              <div className="mt-2"><Cards cards={state.board}/></div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl bg-slate-800 p-3"><div className="text-[10px] uppercase text-slate-400">Pula</div><div className="mt-1 font-black">{formatAmount(state.pot)}</div></div>
            <div className="rounded-xl bg-slate-800 p-3"><div className="text-[10px] uppercase text-slate-400">Do sprawdzenia</div><div className="mt-1 font-black">{formatAmount(state.toCall)}</div></div>
            <div className="rounded-xl bg-slate-800 p-3">
              <div className="flex items-center text-[10px] uppercase text-slate-400">Pot odds <PotOddsInfo pot={state.pot} toCall={state.toCall}/></div>
              <div className="mt-1 font-black">{asNumber(state.toCall) > 0 ? formatPercent(state.potOdds) : '—'}</div>
            </div>
            <div className="rounded-xl bg-slate-800 p-3"><div className="text-[10px] uppercase text-slate-400">Efektywny stack</div><div className="mt-1 font-black">{formatAmount(state.effectiveStackBb)} BB</div></div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 content-start">
          <QuestionFact label="Format" value={question.gameType === 'tournament' ? 'Turniej' : 'Cash'}/>
          <QuestionFact label="Ulica" value={question.street}/>
          <QuestionFact label="Blindy" value={`${formatAmount(state.blinds?.smallBlind)} / ${formatAmount(state.blinds?.bigBlind)}${asNumber(state.blinds?.ante) > 0 ? ` · ante ${formatAmount(state.blinds.ante)}` : ''}`}/>
          <QuestionFact label="Graczy w rozdaniu" value={state.context?.opponentsInHand + 1 || '—'}/>
          {question.scenario && <QuestionFact label="Scenariusz" value={actionLabel(question.scenario)} emphasized/>}
          {question.sequenceLength > 1 && <QuestionFact label="Etap epizodu" value={`${question.sequenceIndex} z ${question.sequenceLength}`} emphasized/>}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div>
          <h4 className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">Stacki przed decyzją</h4>
          <PlayerStacks players={state.players} bigBlind={bigBlind}/>
        </div>
        <div>
          <h4 className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">Wcześniejsze akcje</h4>
          <PriorActions actions={state.priorActions}/>
        </div>
      </div>

      {equityCoverageMessage && (
        <div data-testid="equity-coverage-message" role="note" className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700">
          <Info size={17} className="mt-0.5 shrink-0 text-indigo-500" aria-hidden="true"/>
          <span>{equityCoverageMessage}</span>
        </div>
      )}

      {hasTwoStepEquity && equityStep === 1 && !readOnly && (
        <fieldset data-testid="equity-bucket-step" className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-5">
          <legend className="px-2 text-base font-black text-slate-800">Jakie jest equity?</legend>
          <p className="mb-4 text-xs text-slate-500">Najpierw zablokuj ocenę equity, a dopiero potem wybierz decyzję strategiczną.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {equityAnswerOptions.map((option) => {
              const selected = selectedEquityBucket === option.id;
              return <button type="button" key={option.id} data-equity-bucket-id={option.id} onClick={() => onSelectEquityBucket(option.id)} className={`rounded-xl border px-4 py-4 text-left transition-all ${selected ? 'border-emerald-600 bg-emerald-700 text-white shadow-md' : 'border-emerald-200 bg-white text-slate-700 hover:border-emerald-400 hover:bg-emerald-50'}`}>
                <span className="block text-sm font-black">{option.label || equityBucketLabel(option.id)}</span>
              </button>;
            })}
          </div>
          <button type="button" data-testid="advance-equity-answer" onClick={onAdvanceEquity} disabled={!selectedEquityBucket} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40">
            Dalej <ArrowRight size={16}/>
          </button>
        </fieldset>
      )}
      {(!hasTwoStepEquity || equityStep === 2 || readOnly) && <fieldset className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5">
        <legend className="px-2 text-base font-black text-slate-800">{readOnly ? 'Zapisana decyzja' : 'Jaka jest najlepsza decyzja?'}</legend>
        <p className="mb-4 text-xs text-slate-500">Wybierz jedną odpowiedź. Uzasadnienie i zakresy zobaczysz dopiero po zapisaniu decyzji.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(hasTwoStepEquity ? actionOptions : question.answerOptions || []).map((option) => {
            const selected = selectedAnswer === option.id;
            const displayedKey = feedback?.actionAnswerKey || feedback?.answerKey;
            const preferred = displayedKey?.preferredAnswer === option.id;
            const acceptable = displayedKey?.acceptableAlternatives?.includes(option.id);
            return (
              <button
                type="button"
                key={option.id}
                data-answer-id={option.id}
                disabled={Boolean(feedback) || readOnly || submitting}
                onClick={() => onSelectAnswer(option.id)}
                className={`rounded-xl border px-4 py-4 text-left transition-all disabled:cursor-default ${
                  preferred ? 'border-emerald-400 bg-emerald-100 text-emerald-900'
                    : acceptable ? 'border-amber-300 bg-amber-100 text-amber-900'
                      : selected ? 'border-indigo-500 bg-indigo-600 text-white shadow-md'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50'
                }`}
              >
                <span className="block text-sm font-black">{option.label || actionLabel(option.id)}</span>
                {option.category && <span className="mt-1 block text-[10px] font-bold uppercase opacity-70">Akcja: {actionLabel(option.action)}</span>}
              </button>
            );
          })}
        </div>
        {!feedback && !readOnly && (
          <button
            type="button"
            data-testid="submit-training-answer"
            onClick={onSubmit}
            disabled={!selectedAnswer || submitting}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? <><RotateCcw size={16} className="animate-spin"/> Zapisywanie odpowiedzi…</> : <><CheckCircle2 size={16}/> Zatwierdź odpowiedź</>}
          </button>
        )}
        {hasTwoStepEquity && !readOnly && <button type="button" data-testid="back-equity-answer" onClick={onBackEquity} className="mt-4 ml-2 inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-black text-slate-700">
          <ArrowLeft size={16}/> Zmień equity
        </button>}
      </fieldset>}
    </section>
  );
};

export const TrainingFeedback = ({
  feedback,
}) => {
  const meta = GRADE_META[feedback.grade] || GRADE_META.incorrect;
  const GradeIcon = meta.icon;
  const key = feedback.answerKey || {};
  const actionKey = feedback.actionAnswerKey || key;
  const sizing = actionKey.suggestedSizing;
  const [resultVisible, setResultVisible] = useState(false);
  const historicalResult = feedback.historicalResult;
  const historicalDecision = feedback.historicalDecision;
  const historicalSummary = String(feedback.historicalSummary || '').trim();
  const hasHistoricalDetails = Boolean(historicalResult?.outcome || historicalDecision?.grade || historicalSummary);
  const outcomeLabel = {
    WON: 'Hero wygrał rozdanie',
    LOST: 'Hero przegrał rozdanie',
    FOLDED: 'Hero spasował',
  }[historicalResult?.outcome] || null;
  const historicalMeta = HISTORICAL_DECISION_META[historicalDecision?.grade];
  return (
    <section data-testid="training-feedback" aria-live="polite" className="mt-5 space-y-4">
      <div className={`flex items-center gap-3 rounded-2xl border p-4 ${meta.classes}`}>
        <GradeIcon size={26}/>
        <div><div className="text-lg font-black">{meta.label}</div><div className="text-xs font-semibold">{feedback.actionGrade ? 'Ocena akcji' : feedback.equity ? 'Wynik referencyjny' : 'Preferowana odpowiedź'}: {feedback.actionGrade ? actionLabel(actionKey.preferredAnswer) : feedback.equity ? equityBucketLabel(feedback.correctEquityBucket) : actionLabel(actionKey.preferredAnswer)}</div></div>
      </div>
      {feedback.equity && <div data-testid="equity-feedback" className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 text-sm text-indigo-950">
        <h4 className="font-black">Wynik lokalnego kalkulatora equity</h4>
        {feedback.equityGrade && <p className="mt-1 text-xs font-black">Ocena equity: {GRADE_META[feedback.equityGrade]?.label || feedback.equityGrade}</p>}
        <p className="mt-2 text-2xl font-black">{formatPercent(feedback.equity.equity)} <span className="text-sm font-bold">({equityBucketLabel(feedback.correctEquityBucket)})</span></p>
        <div className="mt-3 grid gap-2 text-xs font-semibold sm:grid-cols-2 lg:grid-cols-4">
          <div>Wygrane: <strong>{feedback.equity.wins}</strong></div>
          <div>Remisy: <strong>{feedback.equity.ties}</strong></div>
          <div>Przegrane: <strong>{feedback.equity.losses}</strong></div>
          <div>Twoja odpowiedź: <strong>{equityBucketLabel(feedback.equityBucket)}</strong></div>
        </div>
        <p className="mt-3 text-xs">Metoda: <strong>{feedback.equity.method === 'enumeration' ? 'pełna enumeracja' : 'symulacja'}</strong>. Dokładność: <strong>{feedback.equity.method === 'enumeration' ? `${feedback.equity.samples.toLocaleString('pl-PL')} układów` : `${feedback.equity.samples.toLocaleString('pl-PL')} prób, ±${formatPercent(feedback.equity.marginOfError)}`}</strong>.</p>
        {feedback.requiredEquity !== undefined && <p data-testid="equity-threshold-feedback" className="mt-2 text-xs">Wymagany próg pot odds: <strong>{formatPercent(feedback.requiredEquity)}</strong>. Różnica: <strong>{formatPercent(feedback.equityDifference)}</strong>.</p>}
        {feedback.actionGrade && <p className="mt-2 text-xs">Ocena akcji: <strong>{GRADE_META[feedback.actionGrade]?.label || feedback.actionGrade}</strong>. Rekomendacja strategiczna: <strong>{actionLabel(actionKey.preferredAnswer)}</strong>.</p>}
      </div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h4 className="flex items-center gap-2 font-black text-slate-800"><Brain size={18} className="text-indigo-600"/> Uzasadnienie trenera</h4>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">{actionKey.rationale || key.rationale}</p>
          <dl className="mt-4 space-y-3 text-sm">
            <div><dt className="text-xs font-black uppercase text-slate-400">Blockery i equity</dt><dd className="mt-1 text-slate-700">{actionKey.blockersEquity || key.blockersEquity}</dd></div>
            <div><dt className="text-xs font-black uppercase text-slate-400">Przewidywany zakres rywala</dt><dd className="mt-1 text-slate-700">{actionKey.opponentRange || key.opponentRange}</dd></div>
            <div><dt className="text-xs font-black uppercase text-slate-400">Dopuszczalne alternatywy</dt><dd className="mt-1 font-bold text-slate-700">{actionKey.acceptableAlternatives?.length ? actionKey.acceptableAlternatives.map(actionLabel).join(', ') : 'Brak'}</dd></div>
            {sizing && <div><dt className="text-xs font-black uppercase text-slate-400">Sugerowany sizing</dt><dd className="mt-1 font-bold text-slate-700">{actionLabel(sizing.action)}{sizing.potRatio > 0 ? ` · ${formatPercent(sizing.potRatio)} puli` : ''}{sizing.raiseToBb > 0 ? ` · do ${formatAmount(sizing.raiseToBb)} BB` : ''}</dd></div>}
          </dl>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <h4 className="flex items-center gap-2 font-black text-slate-800"><History size={18} className="text-slate-500"/> Co wydarzyło się w rozdaniu</h4>
          <p className="mt-2 text-xs text-slate-500">Rzeczywisty wynik nie jest wyznacznikiem jakości decyzji.</p>
          <p className="mt-4 rounded-xl bg-white p-4 text-sm font-black text-slate-800">
            {actionLabel(feedback.historicalAction?.type)}
            {asNumber(feedback.historicalAction?.amount) > 0 ? ` ${formatAmount(feedback.historicalAction.amount)}` : ''}
            {feedback.historicalAction?.allIn ? ' · all-in' : ''}
          </p>
          {resultVisible && hasHistoricalDetails && (
            <div data-testid="training-historical-result" className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
              {outcomeLabel && <p><strong>{outcomeLabel}.</strong>{historicalResult.sawShowdown ? ' Rozdanie doszło do showdownu.' : ''}</p>}
              {historicalResult?.outcome && <p>Wynik netto: <strong className={asNumber(historicalResult.netProfit) >= 0 ? 'text-emerald-700' : 'text-rose-700'}>{asNumber(historicalResult.netProfit) > 0 ? '+' : ''}{formatAmount(historicalResult.netProfit)}</strong>.</p>}
              {historicalDecision && <p className={historicalMeta?.classes}><strong>Strategicznie: {historicalMeta?.label}.</strong> {historicalDecision.comment}</p>}
              {historicalSummary && <p className="border-t border-slate-100 pt-3 leading-relaxed"><strong>Podsumowanie analizy:</strong> {historicalSummary}</p>}
            </div>
          )}
          {hasHistoricalDetails && !resultVisible && <button
            type="button"
            data-testid="show-training-result"
            onClick={() => setResultVisible(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-black text-rose-800 hover:bg-rose-100"
          >
            <Eye size={15}/> Pokaż wynik
          </button>}
        </div>
      </div>
    </section>
  );
};

export const TrainingNavigation = ({
  canGoPrevious = false,
  canGoNext = false,
  onPrevious,
  onNext,
  nextLoading = false,
  nextIsSummary = false,
}) => {
  if (!canGoPrevious && !canGoNext) return null;
  return (
    <nav data-testid="training-navigation" aria-label="Nawigacja między pytaniami" className="sticky bottom-3 z-10 mt-6 rounded-2xl border border-indigo-100 bg-white/95 p-3 shadow-lg backdrop-blur">
      <div className="flex flex-wrap gap-3">
        {canGoPrevious && <button
          type="button"
          data-testid="previous-training-question"
          aria-label="Poprzednie pytanie"
          title="Poprzednie pytanie"
          onClick={onPrevious}
          disabled={nextLoading}
          className="inline-flex min-h-12 w-full flex-1 items-center justify-center gap-2 rounded-xl border-2 border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50 disabled:cursor-wait disabled:opacity-50"
        >
          <ArrowLeft size={20} strokeWidth={2.5}/>
          <span>Poprzednie</span>
        </button>}
        {canGoNext && <button
          type="button"
          data-testid="next-training-question"
          aria-label={nextIsSummary ? 'Zobacz podsumowanie' : 'Następne pytanie'}
          title={nextIsSummary ? 'Zobacz podsumowanie' : 'Następne pytanie'}
          onClick={onNext}
          disabled={nextLoading}
          className="inline-flex min-h-12 w-full flex-1 items-center justify-center gap-2 rounded-xl border-2 border-indigo-500 bg-indigo-600 px-5 py-3 text-sm font-black text-white shadow-sm transition-colors hover:border-indigo-400 hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-60"
        >
          {nextLoading ? <RotateCcw size={20} className="animate-spin"/> : nextIsSummary ? <Trophy size={20}/> : <ArrowRight size={20} strokeWidth={2.5}/>}
          <span>{nextLoading ? 'Ładowanie…' : nextIsSummary ? 'Podsumowanie' : 'Następne'}</span>
        </button>}
      </div>
    </nav>
  );
};

export const TrainingSetup = ({
  status,
  exerciseType,
  gameType,
  sessionSize,
  equityMode,
  onExerciseTypeChange,
  onGameTypeChange,
  onSessionSizeChange,
  onEquityModeChange,
  onStart,
  onActivateEquity,
  loading = false,
}) => {
  const isEquityExercise = exerciseType === EXERCISE_TYPES.EQUITY_POT_ODDS;
  const available = getPoolCount(status, exerciseType, gameType, isEquityExercise ? equityMode : null);
  const equityActivation = status?.equityActivation || {};
  const hasEquityActivationCandidates = asNumber(equityActivation.candidateCount) > 0;
  const needsEquityActivation = hasEquityActivationCandidates && equityActivation.needsActivation === true;
  const noActiveEquitySpots = asNumber(equityActivation.activeCount) === 0;
  const showEquityActivation = isEquityExercise && needsEquityActivation;
  const selectedModeUnavailableReason = isEquityExercise && available === 0
    ? getEquityModeUnavailableReason(status, gameType, equityMode)
    : null;
  return (
    <section data-testid="training-setup" className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {EXERCISE_CATALOG.map((exercise) => {
          const selected = exerciseType === exercise.id;
          const count = getPoolCount(status, exercise.id, gameType, exercise.id === EXERCISE_TYPES.EQUITY_POT_ODDS ? equityMode : null);
          return (
            <button type="button" key={exercise.id} onClick={() => onExerciseTypeChange(exercise.id)} className={`rounded-2xl border p-5 text-left transition-all ${selected ? 'border-indigo-500 bg-indigo-600 text-white shadow-lg' : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300'}`}>
              <div className="flex items-start justify-between gap-3"><Target size={21}/><span className={`rounded-full px-2 py-1 text-[10px] font-black ${selected ? 'bg-white/20' : 'bg-slate-100'}`}>{count} gotowych</span></div>
              <h3 className="mt-4 text-base font-black">{exercise.title}</h3>
              <p className={`mt-2 text-xs leading-relaxed ${selected ? 'text-indigo-100' : 'text-slate-500'}`}>{exercise.description}</p>
              <p className={`mt-3 text-[10px] font-black uppercase ${selected ? 'text-indigo-200' : 'text-indigo-600'}`}>Cel postępu: {exercise.target} decyzji</p>
            </button>
          );
        })}
      </div>

      <div className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-6 lg:grid-cols-2">
        <fieldset>
          <legend className="mb-3 text-sm font-black text-slate-800">Format rozdań</legend>
          <div className="flex flex-wrap gap-2">
            {GAME_OPTIONS.map((option) => <button type="button" key={option.id} onClick={() => onGameTypeChange(option.id)} className={`rounded-xl px-4 py-2.5 text-xs font-black ${gameType === option.id ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>{option.label}</button>)}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-3 text-sm font-black text-slate-800">Rozmiar sesji</legend>
          <div className="flex flex-wrap gap-2">
            {SESSION_SIZES.map((size) => <button type="button" key={size} onClick={() => onSessionSizeChange(size)} className={`rounded-xl px-4 py-2.5 text-xs font-black ${sessionSize === size ? 'bg-indigo-600 text-white' : 'border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>{size === 'all' ? 'Cała pula' : size}</button>)}
          </div>
        </fieldset>
      </div>

      {isEquityExercise && <fieldset className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5"><legend className="mb-3 text-sm font-black text-emerald-950">Poziom equity</legend><div className="flex flex-wrap gap-2">{EQUITY_MODE_OPTIONS.map(([mode, label]) => { const modeAvailable = getPoolCount(status, EXERCISE_TYPES.EQUITY_POT_ODDS, gameType, mode) > 0; const disabled = !modeAvailable; return <button type="button" key={mode} disabled={disabled} title={disabled ? getEquityModeUnavailableReason(status, gameType, mode) : undefined} onClick={() => onEquityModeChange(mode)} className={`rounded-xl px-4 py-2.5 text-xs font-black disabled:cursor-not-allowed ${equityMode === mode ? 'bg-emerald-700 text-white disabled:opacity-60' : disabled ? 'border border-emerald-200 bg-emerald-50 text-emerald-800 disabled:opacity-50' : 'border border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-100'}`}>{label}</button>; })}</div><p className="mt-2 text-xs text-emerald-800">Zakres i pot odds korzystają wyłącznie z aktualnie dostępnych suplementów equity. Mixed łączy wszystkie aktywne poziomy.</p>{selectedModeUnavailableReason && !showEquityActivation && <p data-testid="equity-mode-unavailable" className="mt-3 text-xs font-bold text-emerald-900">{selectedModeUnavailableReason}</p>}</fieldset>}

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-indigo-100 bg-indigo-50 p-5">
        {showEquityActivation ? <div data-testid="equity-activation-required" className="max-w-2xl"><div className="text-sm font-black text-indigo-900">{noActiveEquitySpots ? 'Analizy equity są gotowe — aktywuj ćwiczenia' : 'Są nowe analizy equity — zaktualizuj pulę ćwiczeń'}</div><div className="mt-1 text-xs text-indigo-700">To lokalna i bezpłatna operacja: nie wywoła AI oraz nie zmieni starszych ćwiczeń.</div></div> : <div><div className="text-sm font-black text-indigo-900">Dostępna pula: {available} spotów</div><div className="mt-1 text-xs text-indigo-700">Sesja użyje maksymalnie wybranej liczby dostępnych pytań.</div></div>}
        {showEquityActivation ? <button type="button" data-testid="activate-equity-training-from-setup" disabled={loading || typeof onActivateEquity !== 'function'} onClick={onActivateEquity} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black text-white shadow-md hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40">{loading ? <><RotateCcw size={17} className="animate-spin"/> Aktywowanie…</> : <><Dumbbell size={17}/> Aktywuj ćwiczenia equity</>}</button> : <button type="button" data-testid="start-training-session" disabled={available === 0 || loading} onClick={onStart} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-black text-white shadow-md hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40">
          {loading ? <><RotateCcw size={17} className="animate-spin"/> Tworzenie sesji…</> : <><Dumbbell size={17}/> Rozpocznij ćwiczenie</>}
        </button>}
      </div>
    </section>
  );
};

const ScoreCards = ({ score = {} }) => (
  <div className="grid gap-3 sm:grid-cols-3">
    {Object.entries(GRADE_META).map(([grade, meta]) => {
      const Icon = meta.icon;
      return <div key={grade} className={`rounded-2xl border p-4 ${meta.classes}`}><Icon size={20}/><div className="mt-2 text-2xl font-black">{score[grade] || 0}</div><div className="text-xs font-bold">{meta.label}</div></div>;
    })}
  </div>
);

const StatsGroups = ({ stats }) => {
  const rows = [
    ['Pozycja', stats?.byPosition],
    ['Stack', stats?.byStack],
    ['Tryb', stats?.byExerciseType],
    ...(stats?.equity?.total ? [['Equity', { equity: stats.equity }]] : []),
    ...(stats?.action?.total ? [['Akcja w trybie equity', { action: stats.action }]] : []),
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {rows.map(([title, group]) => (
        <div key={title} className="rounded-2xl border border-slate-200 bg-white p-4">
          <h4 className="mb-3 text-xs font-black uppercase tracking-wider text-slate-500">{title}</h4>
          <div className="space-y-2">
            {Object.entries(group || {}).map(([name, value]) => (
              <div key={name} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                <span className="font-bold text-slate-700">{actionLabel(name)}</span>
                <span className="text-right text-slate-500">{value.correct}/{value.total} · {Math.round(value.acceptedRate * 100)}%</span>
              </div>
            ))}
            {Object.keys(group || {}).length === 0 && <p className="text-xs text-slate-400">Brak prób.</p>}
          </div>
        </div>
      ))}
    </div>
  );
};

export const TrainingSummary = ({ session, stats, onNewSession, onShowHistory }) => (
  <section data-testid="training-summary" className="mx-auto max-w-5xl space-y-6">
    <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-600 to-violet-700 p-7 text-white shadow-lg">
      <Trophy size={34} className="text-amber-300"/>
      <h3 className="mt-4 text-2xl font-black">Sesja zakończona</h3>
      <p className="mt-2 text-sm text-indigo-100">Odpowiedziano na {session?.answeredCount || 0} z {session?.targetSize || 0} pytań.</p>
    </div>
    <ScoreCards score={session?.score}/>
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-lg font-black text-slate-800"><BarChart3 size={20} className="text-indigo-600"/> Wyniki łączne według pozycji, stacka i trybu</h3>
      <StatsGroups stats={stats}/>
    </div>
    <div className="flex flex-wrap gap-3">
      <button type="button" onClick={onNewSession} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-black text-white"><RotateCcw size={16}/> Nowa sesja</button>
      <button type="button" onClick={onShowHistory} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700"><History size={16}/> Historia odpowiedzi</button>
    </div>
  </section>
);

const TrainingHistory = ({ history, stats, reanalysisCount }) => (
  <section data-testid="training-history" className="space-y-6">
    <div className="grid gap-4 md:grid-cols-3">
      <QuestionFact label="Wszystkie próby" value={stats?.total?.total || 0}/>
      <QuestionFact label="Preferowane odpowiedzi" value={`${Math.round((stats?.total?.preferredRate || 0) * 100)}%`}/>
      <QuestionFact label="Ponowna analiza" value={`${reanalysisCount || 0} spotów`} emphasized={reanalysisCount > 0}/>
    </div>
    <StatsGroups stats={stats}/>
    <div className="rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 p-4"><h3 className="font-black text-slate-800">Ostatnie odpowiedzi</h3></div>
      <div className="divide-y divide-slate-100">
        {(history?.attempts || []).map((attempt) => {
          const meta = GRADE_META[attempt.grade] || GRADE_META.incorrect;
          return <div key={attempt.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm"><div><div className="font-black text-slate-800">{actionLabel(attempt.exerciseType)} · {attempt.heroPosition}</div><div className="mt-1 text-xs text-slate-500">Twoja odpowiedź: {actionLabel(attempt.answer)} · preferowana: {actionLabel(attempt.preferredAnswer)}</div></div><span className={`rounded-full border px-3 py-1 text-xs font-black ${meta.classes}`}>{meta.label}</span></div>;
        })}
        {(history?.attempts || []).length === 0 && <p className="p-6 text-center text-sm text-slate-500">Historia jest jeszcze pusta.</p>}
      </div>
    </div>
  </section>
);

export const TrainingView = ({ api = defaultTrainingApi }) => {
  const [screen, setScreen] = useState('setup');
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState({ attempts: [], sessions: [] });
  const [stats, setStats] = useState(null);
  const [session, setSession] = useState(null);
  const [question, setQuestion] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [selectedEquityBucket, setSelectedEquityBucket] = useState('');
  const [equityStep, setEquityStep] = useState(2);
  const [exerciseType, setExerciseType] = useState(EXERCISE_TYPES.PREFLOP_SELECTION);
  const [gameType, setGameType] = useState('both');
  const [sessionSize, setSessionSize] = useState(20);
  const [equityMode, setEquityMode] = useState(EQUITY_MODES.KNOWN_HAND);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [answeredQuestions, setAnsweredQuestions] = useState([]);
  const [reviewIndex, setReviewIndex] = useState(null);

  useEffect(() => {
    let mounted = true;
    const restore = async () => {
      setLoading(true);
      try {
        const [nextStatus, nextHistory, nextStats] = await Promise.all([
          api.getTrainingStatus(), api.getTrainingHistory(), api.getTrainingStats(),
        ]);
        if (!mounted) return;
        setStatus(nextStatus);
        setHistory(nextHistory);
        setStats(nextStats);
        const activeSessionId = getStorage().getItem(ACTIVE_TRAINING_SESSION_KEY);
        if (activeSessionId) {
          try {
            const restored = await api.createTrainingSession({ resumeSessionId: activeSessionId });
            if (!mounted) return;
            let restoredReviews = { reviews: [] };
            if (typeof api.getTrainingSessionReviews === 'function') {
              try {
                restoredReviews = await api.getTrainingSessionReviews(restored.session.id);
              } catch {
                restoredReviews = { reviews: [] };
              }
            }
            if (!mounted) return;
            setAnsweredQuestions(Array.isArray(restoredReviews.reviews) ? restoredReviews.reviews : []);
            setReviewIndex(null);
            setSession(restored.session);
            if (restored.session.status === 'completed') {
              setScreen('summary');
            } else {
              const next = await api.getNextTrainingQuestion(restored.session.id);
              if (!mounted) return;
              setSession(next.session);
              setQuestion(next.question);
              setScreen(next.question ? 'session' : 'summary');
            }
          } catch (restoreError) {
            getStorage().removeItem(ACTIVE_TRAINING_SESSION_KEY);
            if (!['TRAINING_SESSION_NOT_FOUND', 'TRAINING_SESSION_ABANDONED'].includes(restoreError.code)) throw restoreError;
          }
        }
      } catch (loadError) {
        if (mounted) setError(loadError.message || 'Nie udało się wczytać ćwiczeń.');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void restore();
    return () => { mounted = false; };
  }, [api]);

  const reviewedQuestion = Number.isInteger(reviewIndex) ? answeredQuestions[reviewIndex] : null;
  const isReview = Boolean(reviewedQuestion);
  const displayedQuestion = reviewedQuestion?.question || question;
  const displayedFeedback = reviewedQuestion?.feedback || feedback;
  const displayedAnswer = reviewedQuestion?.answer || selectedAnswer;
  const displayedEquityBucket = reviewedQuestion?.equityBucket || selectedEquityBucket;
  const previousReviewIndex = feedback ? answeredQuestions.length - 2 : answeredQuestions.length - 1;

  const refreshHistory = async () => {
    const [nextHistory, nextStats, nextStatus] = await Promise.all([
      api.getTrainingHistory(), api.getTrainingStats(), api.getTrainingStatus(),
    ]);
    setHistory(nextHistory);
    setStats(nextStats);
    setStatus(nextStatus);
  };

  const scrollTrainingToTop = () => {
    const browserWindow = globalThis.window;
    if (!browserWindow?.scrollTo) return;
    const reducedMotion = browserWindow.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    try {
      browserWindow.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
    } catch {
      // Niektóre środowiska testowe nie implementują scrollTo.
    }
  };

  const loadNext = async (sessionId, { scrollToTop = false } = {}) => {
    const next = await api.getNextTrainingQuestion(sessionId);
    setSession(next.session);
    setQuestion(next.question);
    setFeedback(null);
    setSelectedAnswer('');
    setSelectedEquityBucket('');
    setEquityStep(next.question?.equityAnswerOptions?.length ? 1 : 2);
    setReviewIndex(null);
    if (!next.question) setScreen('summary');
    if (next.question && scrollToTop) {
      if (typeof globalThis.requestAnimationFrame === 'function') globalThis.requestAnimationFrame(scrollTrainingToTop);
      else globalThis.setTimeout(scrollTrainingToTop, 0);
    }
  };

  const startSession = async () => {
    setLoading(true);
    setError('');
    setAnsweredQuestions([]);
    setReviewIndex(null);
    try {
      const created = await api.createTrainingSession({ exerciseType, gameType, size: sessionSize, ...(exerciseType === EXERCISE_TYPES.EQUITY_POT_ODDS ? { equityMode } : {}) });
      setSession(created.session);
      getStorage().setItem(ACTIVE_TRAINING_SESSION_KEY, created.session.id);
      setScreen('session');
      await loadNext(created.session.id);
    } catch (startError) {
      setError(startError.message || 'Nie udało się rozpocząć sesji.');
    } finally {
      setLoading(false);
    }
  };

  const activateEquityTraining = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      await api.activateEquityTraining();
      setStatus(await api.getTrainingStatus());
    } catch (activationError) {
      setError(activationError.message || 'Nie udało się aktywować ćwiczeń equity.');
    } finally {
      setLoading(false);
    }
  };

  const submitAnswer = async () => {
    const isTwoStep = question?.equityAnswerOptions?.length > 0
      && [EQUITY_MODES.RANGE, EQUITY_MODES.POT_ODDS].includes(question.equityMode || question.question?.equityMode);
    if (!selectedAnswer || !question || !session || (isTwoStep && !selectedEquityBucket)) return;
    setLoading(true);
    setError('');
    try {
      const result = await api.submitTrainingAnswer(session.id, {
        spotVersionId: question.spotVersionId,
        answer: selectedAnswer,
        ...(isTwoStep ? { equityBucket: selectedEquityBucket } : {}),
      });
      setSession(result.session);
      setFeedback(result.feedback);
      setEquityStep(2);
      setAnsweredQuestions((current) => [
        ...current.filter(({ spotVersionId }) => spotVersionId !== question.spotVersionId),
        {
          spotVersionId: question.spotVersionId,
          answer: selectedAnswer,
          question,
          feedback: result.feedback,
        },
      ]);
      setReviewIndex(null);
      getStorage().setItem(ACTIVE_TRAINING_SESSION_KEY, result.session.id);
    } catch (answerError) {
      setError(answerError.message || 'Nie udało się zapisać odpowiedzi.');
    } finally {
      setLoading(false);
    }
  };

  const continueSession = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      if (session.status === 'completed') {
        getStorage().removeItem(ACTIVE_TRAINING_SESSION_KEY);
        await refreshHistory();
        setScreen('summary');
      } else {
        await loadNext(session.id, { scrollToTop: true });
      }
    } catch (nextError) {
      setError(nextError.message || 'Nie udało się przejść do następnego pytania.');
    } finally {
      setLoading(false);
    }
  };

  const canGoPrevious = isReview
    ? reviewIndex > 0
    : previousReviewIndex >= 0;
  const canGoNext = isReview
    ? reviewIndex < answeredQuestions.length - 1 || Boolean(question)
    : Boolean(feedback);
  const displayedQuestionNumber = session
    ? isReview
      ? reviewIndex + 1
      : Math.min(session.answeredCount + (feedback ? 0 : 1), session.targetSize)
    : 0;

  const goPrevious = () => {
    if (loading) return;
    if (isReview) {
      if (reviewIndex > 0) setReviewIndex(reviewIndex - 1);
      return;
    }
    if (previousReviewIndex >= 0) setReviewIndex(previousReviewIndex);
  };

  const goNext = () => {
    if (loading) return;
    if (isReview) {
      if (reviewIndex < answeredQuestions.length - 1) {
        setReviewIndex(reviewIndex + 1);
      } else if (reviewedQuestion?.spotVersionId === question?.spotVersionId && feedback) {
        void continueSession();
      } else {
        setReviewIndex(null);
      }
      return;
    }
    void continueSession();
  };

  const advanceEquity = () => {
    if (selectedEquityBucket) setEquityStep(2);
  };

  const backEquity = () => {
    if (!feedback && !isReview) setEquityStep(1);
  };

  const abandonSession = async () => {
    if (!session || session.status !== 'active') return;
    const accepted = typeof globalThis.confirm !== 'function'
      || globalThis.confirm('Przerwać sesję? Wykonane odpowiedzi zostaną zachowane w historii.');
    if (!accepted) return;
    setLoading(true);
    setError('');
    try {
      await api.abandonTrainingSession(session.id);
      getStorage().removeItem(ACTIVE_TRAINING_SESSION_KEY);
      await refreshHistory();
      setSession(null);
      setQuestion(null);
      setFeedback(null);
      setSelectedAnswer('');
      setSelectedEquityBucket('');
      setEquityStep(2);
      setAnsweredQuestions([]);
      setReviewIndex(null);
      setScreen('setup');
    } catch (abandonError) {
      setError(abandonError.message || 'Nie udało się przerwać sesji.');
    } finally {
      setLoading(false);
    }
  };

  const showHistory = async () => {
    setLoading(true);
    setError('');
    try {
      await refreshHistory();
      setScreen('history');
    } catch (historyError) {
      setError(historyError.message || 'Nie udało się odświeżyć historii.');
    } finally {
      setLoading(false);
    }
  };

  const newSession = () => {
    getStorage().removeItem(ACTIVE_TRAINING_SESSION_KEY);
    setSession(null);
    setQuestion(null);
    setFeedback(null);
    setSelectedAnswer('');
    setSelectedEquityBucket('');
    setEquityStep(2);
    setAnsweredQuestions([]);
    setReviewIndex(null);
    setScreen('setup');
  };

  if (loading && !status) {
    return <div role="status" className="mx-auto max-w-6xl rounded-2xl border border-indigo-100 bg-indigo-50 p-8 text-center text-sm font-black text-indigo-700"><RotateCcw className="mx-auto mb-3 animate-spin"/> Ładowanie modułu ćwiczeń…</div>;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div><h2 className="flex items-center gap-2 text-xl font-black text-slate-800"><Dumbbell className="text-indigo-600"/> Ćwiczenia na prawdziwych rozdaniach</h2><p className="mt-1 text-xs text-slate-500">Klucz i dalszy przebieg rozdania pozostają ukryte do zapisania odpowiedzi.</p></div>
        <div className="flex gap-2">
          {session?.status === 'active' && screen !== 'session' && <button type="button" onClick={() => setScreen('session')} className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white">Wróć do sesji</button>}
          <button type="button" onClick={showHistory} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black ${screen === 'history' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-slate-50 text-slate-600'}`}><BookOpen size={15}/> Historia i statystyki</button>
          {screen === 'history' && <button type="button" onClick={() => setScreen(session?.status === 'active' ? 'session' : 'setup')} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600">Wróć</button>}
        </div>
      </div>

      {status?.queue?.reanalysis > 0 && <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle size={18}/><strong>Ponowna analiza:</strong> {status.queue.reanalysis} spotów nie jest automatycznie ocenianych.</div>}
      {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><AlertTriangle size={18} className="mt-0.5 shrink-0"/>{error}</div>}

      {screen === 'setup' && <TrainingSetup status={status} exerciseType={exerciseType} gameType={gameType} sessionSize={sessionSize} equityMode={equityMode} onExerciseTypeChange={setExerciseType} onGameTypeChange={setGameType} onSessionSizeChange={setSessionSize} onEquityModeChange={setEquityMode} onStart={startSession} onActivateEquity={activateEquityTraining} loading={loading}/>}
      {screen === 'session' && session && displayedQuestion && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:p-7">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
             <div><div className="text-xs font-black uppercase tracking-wider text-indigo-600">{EXERCISE_CATALOG.find(({ id }) => id === session.exerciseType)?.title}</div><div className="mt-1 text-sm text-slate-500">Pytanie {displayedQuestionNumber} z {session.targetSize}</div></div>
             <div className="flex flex-wrap items-center gap-2"><div className="flex items-center gap-2 text-xs font-bold text-slate-500"><Clock3 size={15}/> Sesja jest zapisywana po każdej odpowiedzi</div><button type="button" data-testid="abandon-training-session" disabled={loading} onClick={abandonSession} className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-black text-rose-700 disabled:opacity-40">Przerwij sesję</button></div>
           </div>
           <TrainingQuestion question={displayedQuestion} selectedAnswer={displayedAnswer} selectedEquityBucket={displayedEquityBucket} onSelectEquityBucket={setSelectedEquityBucket} equityStep={isReview ? 2 : equityStep} onAdvanceEquity={advanceEquity} onBackEquity={backEquity} onSelectAnswer={setSelectedAnswer} onSubmit={submitAnswer} submitting={loading} feedback={displayedFeedback} readOnly={isReview}/>
           {displayedFeedback && <TrainingFeedback feedback={displayedFeedback}/>}
           <TrainingNavigation
             canGoPrevious={canGoPrevious}
             canGoNext={canGoNext}
             onPrevious={goPrevious}
             onNext={goNext}
             nextLoading={loading}
             nextIsSummary={session.status === 'completed' && (!isReview || reviewIndex === answeredQuestions.length - 1)}
           />
        </div>
      )}
      {screen === 'summary' && session && <TrainingSummary session={session} stats={stats} onNewSession={newSession} onShowHistory={showHistory}/>} 
      {screen === 'history' && <TrainingHistory history={history} stats={stats} reanalysisCount={status?.queue?.reanalysis}/>} 
    </div>
  );
};
