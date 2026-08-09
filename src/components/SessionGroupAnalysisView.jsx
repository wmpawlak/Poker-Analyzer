import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  AlertTriangle,
  Brain,
  CalendarDays,
  CheckSquare,
  Clock3,
  History,
  LoaderCircle,
  Play,
  RotateCcw,
  Square,
} from 'lucide-react';
import { analyzeSessionGroupWithAI, analyzeSessionWithAI } from '../store/pokerSlice.js';
import { buildSessionGroupAnalysisInput } from '../ai/sessionGroupAnalysisContract.js';
import {
  buildSessionGroupCandidates,
  buildVisibleSessionGroupCandidates,
  buildSessionGroupSourceAvailability,
  isSessionGroupReportCurrent,
} from '../utils/sessionGroupCandidates.js';
import { calculateSessionMetrics } from '../utils/sessionMetrics.js';
import { SessionSummary } from './SessionSummary.jsx';

const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'nieznana data' : date.toLocaleString('pl-PL');
};

const formatSessionDate = (candidate) => candidate?.date || formatDate(candidate?.startTime);

const sourceLabel = (source) => source?.metadata?.label || source?.label || source?.sessionId || 'Nieznana sesja';
const EMPTY_HISTORY = [];

// A malformed historical hand must not unmount the whole selection view. The
// stricter group-input builder reports the actionable validation error; this
// calculation only drives the local visual preview.
const safelyCalculateSessionMetrics = (hands, gameType) => {
  try {
    return calculateSessionMetrics(hands, gameType);
  } catch {
    return null;
  }
};

const formatCompactNumber = (value, maximumFractionDigits = 1) => Number(value).toLocaleString('pl-PL', {
  maximumFractionDigits,
});

const formatCompactPercentage = (metric) => Number.isFinite(metric?.value)
  ? `${formatCompactNumber(metric.value, 1)}%`
  : metric?.value || '—';

const formatCompactResult = (metrics, gameType) => {
  const value = Number(metrics?.totalProfit) || 0;
  const sign = value > 0 ? '+' : '';
  const unit = gameType === 'cash' ? 'zł' : 'żetonów';
  return `${sign}${formatCompactNumber(value, 2)} ${unit}`;
};

const CompactMetric = ({ label, value, detail, accent = 'indigo' }) => (
  <div className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
    <p className="truncate text-[10px] font-black uppercase tracking-wide text-slate-500" title={label}>{label}</p>
    <p className={`mt-1 truncate font-mono text-base font-black ${accent === 'amber' ? 'text-amber-700' : 'text-indigo-700'}`} title={String(value)}>{value}</p>
    {detail ? <p className="mt-0.5 truncate text-[10px] font-semibold text-slate-400" title={detail}>{detail}</p> : null}
  </div>
);

const CompactMetricsBar = ({ sessionCount, metrics, cashCount, cashMetrics, tournamentCount, tournamentMetrics }) => (
  <section data-testid="session-group-compact-preview" className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="text-sm font-black text-indigo-950">Podgląd lokalnych metryk</h3>
        <p className="mt-0.5 text-[11px] text-indigo-800">Pełny profil jest liczony lokalnie i otwierany dopiero na żądanie.</p>
      </div>
      <span className="rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-indigo-800">{sessionCount} sesji · {metrics?.hands || 0} rozdań</span>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
      <CompactMetric label="Wiarygodność" value={metrics?.playerProfile?.reliability?.label || '—'} />
      <CompactMetric label="VPIP" value={formatCompactPercentage(metrics?.preflop?.vpip)} />
      <CompactMetric label="PFR" value={formatCompactPercentage(metrics?.preflop?.pfr)} />
      <CompactMetric label="3-bet" value={formatCompactPercentage(metrics?.preflop?.threeBet)} />
      <CompactMetric label="Cash" value={`${cashCount} sesje · ${cashMetrics?.hands || 0} rąk`} detail={cashCount > 0 ? `Wynik: ${formatCompactResult(cashMetrics, 'cash')}` : 'brak sesji'} accent="indigo" />
      <CompactMetric label="Turnieje" value={`${tournamentCount} sesje · ${tournamentMetrics?.hands || 0} rąk`} detail={tournamentCount > 0 ? `Wynik: ${formatCompactResult(tournamentMetrics, 'tournament')}` : 'brak sesji'} accent="amber" />
    </div>
  </section>
);

const SourceReferences = ({ sourceRefs = [], report, currentSourceMap, onHandClick, onOpenSession }) => {
  const reportSources = new Map((report?.sources || []).map((source) => [source.sourceId, source]));
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {sourceRefs.map((reference) => {
        const snapshot = reportSources.get(reference.sourceId);
        const current = currentSourceMap.get(reference.sourceId);
        const sourceAvailable = Boolean(current && snapshot?.sessionId && snapshot?.type);
        const handIds = Array.isArray(reference.handIds) ? reference.handIds : [];
        return (
          <span key={`${reference.sourceId}:${reference.reportId}`} className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              disabled={!sourceAvailable}
              title={sourceAvailable ? `Otwórz ${sourceLabel(snapshot)}` : 'Sesja źródłowa nie jest już dostępna w aktualnych danych.'}
              onClick={() => onOpenSession?.({
                type: snapshot?.type,
                sessionId: snapshot?.sessionId,
              })}
              className="rounded px-1.5 py-1 text-[10px] font-black text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:text-slate-400"
            >
              {sourceLabel(snapshot)}
            </button>
            {handIds.map((handId) => {
              const handAvailable = sourceAvailable && Boolean(current?.hands?.some((hand) => String(hand.id) === String(handId)));
              return (
                <button
                  key={handId}
                  type="button"
                  disabled={!handAvailable}
                  title={handAvailable ? `Otwórz rozdanie #${handId}` : 'Rozdanie nie jest już dostępne w aktualnych danych.'}
                  onClick={() => onHandClick?.(handId)}
                  className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-1.5 py-1 text-[10px] font-bold text-indigo-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <Play size={10}/> #{handId}
                </button>
              );
            })}
          </span>
        );
      })}
    </div>
  );
};

const FindingList = ({ title, findings = [], report, currentSourceMap, onHandClick, onOpenSession, correction = false, accent = 'indigo' }) => {
  if (!Array.isArray(findings) || findings.length === 0) return null;
  const accentClass = accent === 'amber' ? 'border-amber-300' : 'border-indigo-300';
  return (
    <section className="rounded-xl bg-white/80 p-3">
      <h4 className="text-xs font-black uppercase tracking-wide text-slate-700">{title}</h4>
      <div className="mt-2 space-y-3">
        {findings.map((finding, index) => (
          <article key={`${finding.title}-${index}`} className={`border-l-2 pl-3 text-xs text-slate-700 ${accentClass}`}>
            <p className="font-black">{finding.title}</p>
            <p className="mt-1 leading-relaxed">{finding.description}</p>
            {correction && <p className="mt-1 font-semibold text-emerald-800">Korekta: {finding.correction}</p>}
            <SourceReferences
              sourceRefs={finding.sourceRefs}
              report={report}
              currentSourceMap={currentSourceMap}
              onHandClick={onHandClick}
              onOpenSession={onOpenSession}
            />
          </article>
        ))}
      </div>
    </section>
  );
};

const CategoryInsights = ({ insights = [], report, currentSourceMap, onHandClick, onOpenSession }) => {
  if (!Array.isArray(insights) || insights.length === 0) return null;
  return (
    <div className="space-y-3">
      {insights.map((insight) => {
        const isTournament = insight.category === 'tournament';
        const accent = isTournament ? 'amber' : 'indigo';
        const heading = isTournament ? 'Turnieje' : 'Cash';
        return (
          <section key={insight.category} className={`rounded-xl border p-3 ${isTournament ? 'border-amber-200 bg-amber-50' : 'border-indigo-200 bg-indigo-50'}`}>
            <h4 className="text-xs font-black uppercase tracking-wide text-slate-800">{heading}</h4>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">{insight.summary}</p>
            <SourceReferences
              sourceRefs={insight.sourceRefs}
              report={report}
              currentSourceMap={currentSourceMap}
              onHandClick={onHandClick}
              onOpenSession={onOpenSession}
            />
            <div className="mt-3 space-y-3">
              <FindingList
                title="Charakterystyczne tendencje"
                findings={insight.tendencies}
                report={report}
                currentSourceMap={currentSourceMap}
                onHandClick={onHandClick}
                onOpenSession={onOpenSession}
                accent={accent}
              />
              <FindingList
                title="Zalecenia"
                findings={insight.recommendations}
                report={report}
                currentSourceMap={currentSourceMap}
                onHandClick={onHandClick}
                onOpenSession={onOpenSession}
                accent={accent}
              />
            </div>
          </section>
        );
      })}
    </div>
  );
};

const GroupAnalysisReport = ({ report, stale, currentSourceMap, onHandClick, onOpenSession }) => {
  const analysis = report?.analysis;
  if (!analysis) return null;
  return (
    <div className="mt-4 space-y-3" data-testid="session-group-analysis-report">
      {stale && <div role="status" className="rounded-lg border border-amber-300 bg-amber-100 p-3 text-xs font-semibold text-amber-900">Ten raport opiera się na wcześniejszych lub niedostępnych raportach źródłowych.</div>}
      <div className="rounded-lg bg-white/80 p-3 text-sm text-slate-700">
        <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{report.model?.name || 'Nieznany model'} · {formatDate(report.analyzedAt)} · styl {analysis.profileStyleId}</p>
        <p className="mt-2 leading-relaxed">{analysis.summary}</p>
        <p className="mt-2 text-xs font-semibold text-slate-500">Wiarygodność lokalnego profilu: {analysis.reliabilityId || 'brak'}</p>
        <SourceReferences
          sourceRefs={analysis.summarySourceRefs}
          report={report}
          currentSourceMap={currentSourceMap}
          onHandClick={onHandClick}
          onOpenSession={onOpenSession}
        />
      </div>
      <FindingList title="Mocne strony" findings={analysis.strengths} report={report} currentSourceMap={currentSourceMap} onHandClick={onHandClick} onOpenSession={onOpenSession}/>
      <FindingList title="Powtarzalne błędy" findings={analysis.repeatedMistakes} report={report} currentSourceMap={currentSourceMap} onHandClick={onHandClick} onOpenSession={onOpenSession} correction accent="amber"/>
      <FindingList title="Trzy priorytety treningowe" findings={analysis.trainingPriorities} report={report} currentSourceMap={currentSourceMap} onHandClick={onHandClick} onOpenSession={onOpenSession}/>
      <CategoryInsights insights={analysis.categoryInsights} report={report} currentSourceMap={currentSourceMap} onHandClick={onHandClick} onOpenSession={onOpenSession}/>
    </div>
  );
};

export const SessionGroupAnalysisView = ({
  gameType = 'both',
  onGameTypeChange,
  dateFrom = '',
  dateTo = '',
  onDateFromChange,
  onDateToChange,
  onClearDateRange,
  onHandClick,
  onOpenSession,
  selectedSourceIds = [],
  onSelectedSourceIdsChange,
  selectedReportId = null,
  onSelectedReportIdChange,
}) => {
  const dispatch = useDispatch();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const {
    sessions,
    tournaments,
    sessionAiAnalyses,
    sessionAnalysisStatusById,
    sessionAnalysisErrorById,
    sessionGroupAiAnalyses,
    sessionGroupAnalysisStatus,
    sessionGroupAnalysisError,
    defaultAiModel,
    aiModels,
    aiModelsStatus,
  } = useSelector((state) => state.poker);
  const candidateResult = useMemo(() => buildSessionGroupCandidates({
    sessions,
    tournaments,
    sessionAiAnalyses,
    gameType,
    dateFrom,
    dateTo,
  }), [sessions, tournaments, sessionAiAnalyses, gameType, dateFrom, dateTo]);
  const allCandidateResult = useMemo(() => buildSessionGroupCandidates({
    sessions,
    tournaments,
    sessionAiAnalyses,
    gameType: 'both',
  }), [sessions, tournaments, sessionAiAnalyses]);
  const visibleCandidateResult = useMemo(() => buildVisibleSessionGroupCandidates({
    sessions,
    tournaments,
    sessionAiAnalyses,
    gameType,
    dateFrom,
    dateTo,
  }), [sessions, tournaments, sessionAiAnalyses, gameType, dateFrom, dateTo]);
  const candidates = candidateResult.candidates;
  const visibleCandidates = visibleCandidateResult.candidates;
  const deferredSelectedSourceIds = useDeferredValue(selectedSourceIds);
  const currentSourceMap = useMemo(
    () => buildSessionGroupSourceAvailability({ sessions, tournaments }),
    [sessions, tournaments],
  );
  const selectedCandidates = useMemo(
    () => candidates.filter((candidate) => selectedSourceIds.includes(candidate.sourceId)),
    [candidates, selectedSourceIds],
  );
  const deferredSelectedCandidates = useMemo(
    () => candidates.filter((candidate) => deferredSelectedSourceIds.includes(candidate.sourceId)),
    [candidates, deferredSelectedSourceIds],
  );
  const groupPreview = useMemo(() => {
    if (deferredSelectedCandidates.length < 2 || !candidateResult.dateRange.valid) return { group: null, error: null };
    try {
      return {
        group: buildSessionGroupAnalysisInput({
          sources: deferredSelectedCandidates,
          activeCategory: candidateResult.gameType,
          dateRange: { from: dateFrom, to: dateTo },
        }),
        error: null,
      };
    } catch (error) {
      return { group: null, error: error.message || 'Nie udało się przygotować danych analizy.' };
    }
  }, [candidateResult.dateRange.valid, candidateResult.gameType, dateFrom, dateTo, deferredSelectedCandidates]);
  const selectedHands = useMemo(
    () => deferredSelectedCandidates.flatMap((candidate) => candidate.hands).filter((hand) => !hand.isRebuy),
    [deferredSelectedCandidates],
  );
  const cashHands = useMemo(
    () => deferredSelectedCandidates.filter((candidate) => candidate.type === 'cash').flatMap((candidate) => candidate.hands),
    [deferredSelectedCandidates],
  );
  const tournamentHands = useMemo(
    () => deferredSelectedCandidates.filter((candidate) => candidate.type === 'tournament').flatMap((candidate) => candidate.hands),
    [deferredSelectedCandidates],
  );
  const previewMetrics = useMemo(() => (
    selectedHands.length > 0
      ? safelyCalculateSessionMetrics(selectedHands, candidateResult.gameType === 'both' ? 'mixed' : candidateResult.gameType)
      : null
  ), [candidateResult.gameType, selectedHands]);
  const cashMetrics = useMemo(() => safelyCalculateSessionMetrics(cashHands, 'cash'), [cashHands]);
  const tournamentMetrics = useMemo(() => safelyCalculateSessionMetrics(tournamentHands, 'tournament'), [tournamentHands]);
  const history = Array.isArray(sessionGroupAiAnalyses) ? sessionGroupAiAnalyses : EMPTY_HISTORY;
  const latestCurrentReport = useMemo(() => (
    groupPreview.group
      ? [...history].reverse().find((report) => report.fingerprint === groupPreview.group.fingerprint) || null
      : null
  ), [groupPreview.group, history]);
  useEffect(() => {
    if (sessionGroupAnalysisStatus !== 'succeeded' || selectedReportId != null || !latestCurrentReport) return;
    onSelectedReportIdChange?.(latestCurrentReport.reportId);
  }, [latestCurrentReport, onSelectedReportIdChange, selectedReportId, sessionGroupAnalysisStatus]);
  const selectedHistoryReport = history.find((report) => report.reportId === selectedReportId) || null;
  const currentReport = selectedHistoryReport || latestCurrentReport || history.at(-1) || null;
  const isStale = Boolean(
    currentReport
      && (!groupPreview.group
        || currentReport.fingerprint !== groupPreview.group.fingerprint
        || !isSessionGroupReportCurrent(currentReport, allCandidateResult.candidates)),
  );
  const selectedModel = aiModels.find((model) => model.id === defaultAiModel);
  const canUseModel = selectedModel?.configured === true;
  const metricsPending = deferredSelectedSourceIds !== selectedSourceIds;
  const canAnalyze = canUseModel && selectedCandidates.length >= 2 && !metricsPending && candidateResult.dateRange.valid && Boolean(groupPreview.group) && !groupPreview.error && sessionGroupAnalysisStatus !== 'loading';
  const errorMessage = typeof sessionGroupAnalysisError === 'string'
    ? sessionGroupAnalysisError
    : sessionGroupAnalysisError?.message;
  const errorCode = typeof sessionGroupAnalysisError === 'object' ? sessionGroupAnalysisError?.code : undefined;
  const deferredCashCount = deferredSelectedCandidates.filter((candidate) => candidate.type === 'cash').length;
  const deferredTournamentCount = deferredSelectedCandidates.filter((candidate) => candidate.type === 'tournament').length;

  const toggleSource = (sourceId) => {
    const nextSelection = selectedSourceIds.includes(sourceId)
      ? selectedSourceIds.filter((candidateId) => candidateId !== sourceId)
      : [...selectedSourceIds, sourceId];
    onSelectedSourceIdsChange?.(nextSelection);
  };
  const selectVisible = () => onSelectedSourceIdsChange?.(candidates.map((candidate) => candidate.sourceId));
  const clearSelection = () => onSelectedSourceIdsChange?.([]);
  const triggerAnalysis = () => {
    if (!groupPreview.group) return;
    onSelectedReportIdChange?.(null);
    dispatch(analyzeSessionGroupWithAI({
      sourceIds: deferredSelectedCandidates.map((candidate) => candidate.sourceId),
      activeCategory: groupPreview.group.activeCategory,
      dateRange: groupPreview.group.dateRange,
    }));
  };
  const triggerSessionAnalysis = (candidate) => {
    dispatch(analyzeSessionWithAI({
      sessionId: candidate.sessionId,
      hands: candidate.hands,
      gameType: candidate.type,
    }));
  };

  return (
    <div data-testid="session-group-analysis-view" className="mx-auto w-full max-w-7xl animate-in fade-in duration-300">
      <div data-testid="session-group-analysis-workspace" className="grid items-start gap-4 lg:grid-cols-[minmax(20rem,0.85fr)_minmax(0,1.35fr)]">
        <div data-testid="session-group-analysis-selector" className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <section className="shrink-0 border-b border-gray-200 bg-white p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <Brain size={19} className="text-indigo-600"/>
          <h3 className="text-xl font-black text-slate-800">Analiza wielu sesji</h3>
        </div>
        <div data-testid="session-group-game-type" className="mt-4 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 sm:w-fit">
          {[
            ['both', 'Wszystko'],
            ['cash', 'Cash'],
            ['tournament', 'Turnieje'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => onGameTypeChange?.(value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-black transition-colors ${gameType === value ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:bg-white/70'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-end">
          <label className="flex min-w-[9.5rem] flex-1 flex-col gap-1 text-xs font-black uppercase tracking-wide text-slate-500">
            <span>Od</span>
            <span className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold normal-case tracking-normal text-slate-700">
              <CalendarDays size={16} className="shrink-0 text-slate-400"/>
              <input data-testid="session-group-date-from" type="date" value={dateFrom} onChange={(event) => onDateFromChange?.(event.target.value)} className="min-w-0 flex-1 bg-transparent outline-none"/>
            </span>
          </label>
          <label className="flex min-w-[9.5rem] flex-1 flex-col gap-1 text-xs font-black uppercase tracking-wide text-slate-500">
            <span>Do</span>
            <span className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold normal-case tracking-normal text-slate-700">
              <CalendarDays size={16} className="shrink-0 text-slate-400"/>
              <input data-testid="session-group-date-to" type="date" value={dateTo} onChange={(event) => onDateToChange?.(event.target.value)} className="min-w-0 flex-1 bg-transparent outline-none"/>
            </span>
          </label>
          <button type="button" aria-label="Wyczyść zakres dat" title="Wyczyść zakres dat" disabled={!dateFrom && !dateTo} onClick={onClearDateRange} className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw size={14}/></button>
        </div>
        {!candidateResult.dateRange.valid && <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{candidateResult.dateRange.error}</div>}
      </section>

      <section data-testid="session-group-analysis-action" className="border-b border-indigo-100 bg-indigo-50 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="session-group-analyze-selected"
            disabled={!canAnalyze}
            onClick={triggerAnalysis}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-black text-white shadow-sm disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {sessionGroupAnalysisStatus === 'loading' ? (
              <><LoaderCircle size={15} className="animate-spin"/> Generowanie raportu…</>
            ) : (
              <><Brain size={15}/>{errorMessage ? (errorCode === 'AI_INCOMPLETE_RESPONSE' ? 'Spróbuj ponownie — nowe płatne żądanie' : 'Spróbuj ponownie') : 'Analizuj wybrane sesje'}</>
            )}
          </button>
          {selectedCandidates.length > 0 && <span className="text-[11px] font-bold text-indigo-800">Wybrano: {selectedCandidates.length}</span>}
        </div>
        {groupPreview.error && <p role="alert" className="mt-2 text-xs font-semibold text-red-700">{groupPreview.error}</p>}
        {!canUseModel && <p className="mt-2 text-xs font-semibold text-amber-800">{aiModelsStatus === 'idle' || aiModelsStatus === 'loading' ? 'Sprawdzanie konfiguracji modeli…' : `Model ${selectedModel?.name || defaultAiModel} nie ma skonfigurowanego klucza.`}</p>}
        {errorMessage && <p role="alert" className="mt-2 text-xs font-semibold text-red-700">{errorMessage}</p>}
      </section>

      <section>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
          <span className="text-xs font-black uppercase tracking-wide text-slate-500">Sesje</span>
          <span className="flex items-center gap-1">
            <button type="button" aria-label="Zaznacz widoczne sesje" title="Zaznacz widoczne sesje" disabled={candidates.length === 0} onClick={selectVisible} className="inline-flex size-7 items-center justify-center rounded-md text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40"><CheckSquare size={16}/></button>
            <button type="button" aria-label="Wyczyść wybór sesji" title="Wyczyść wybór sesji" disabled={selectedCandidates.length === 0} onClick={clearSelection} className="inline-flex size-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw size={15}/></button>
          </span>
        </div>
        {visibleCandidates.length === 0 ? (
          <div className="flex min-h-[10rem] items-center justify-center p-8 text-center text-sm text-slate-500">Brak sesji z prawdziwymi rozdaniami w bieżącej kategorii i zakresie dat.</div>
        ) : (
          <div data-testid="session-group-analysis-session-list" className="divide-y divide-slate-100">
            {visibleCandidates.map((candidate) => {
              const isSelected = selectedSourceIds.includes(candidate.sourceId);
              const isTournament = candidate.type === 'tournament';
              const sessionAnalysisStatus = sessionAnalysisStatusById[candidate.sessionId] || 'idle';
              const sessionAnalysisError = sessionAnalysisErrorById[candidate.sessionId];
              const sessionAnalysisErrorMessage = typeof sessionAnalysisError === 'string' ? sessionAnalysisError : sessionAnalysisError?.message;
              const sessionAnalysisErrorCode = typeof sessionAnalysisError === 'object' ? sessionAnalysisError?.code : undefined;
              return candidate.status === 'current' ? (
                <div key={candidate.sourceId} className="flex items-start gap-2.5 px-3 py-2 hover:bg-slate-50">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isSelected}
                    aria-label={`${isSelected ? 'Odznacz' : 'Zaznacz'} ${candidate.label}`}
                    onClick={() => toggleSource(candidate.sourceId)}
                    className={`mt-0.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${isSelected ? (isTournament ? 'text-amber-600' : 'text-indigo-600') : 'text-slate-400'}`}
                  >
                    {isSelected ? <CheckSquare size={17}/> : <Square size={17}/>}
                  </button>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-xs font-black text-slate-800">{candidate.label}</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide ${isTournament ? 'bg-amber-100 text-amber-800' : 'bg-indigo-100 text-indigo-700'}`}>{isTournament ? 'Turniej' : 'Cash'}</span>
                      <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-black text-emerald-800">Raport aktualny</span>
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                      <span>{formatSessionDate(candidate)}</span><span>{candidate.handCount} rozdań</span><span>{candidate.reportModel?.name || 'Nieznany model'}</span><span className="inline-flex items-center gap-1"><Clock3 size={12}/>{formatDate(candidate.reportAnalyzedAt)}</span>
                    </span>
                  </span>
                </div>
              ) : (
                <div key={candidate.sourceId} data-testid={`session-group-row-${candidate.status}`} className="flex items-start gap-2.5 px-3 py-2">
                  <span className="mt-0.5 text-slate-300"><Square size={17}/></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-xs font-black text-slate-800">{candidate.label}</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide ${isTournament ? 'bg-amber-100 text-amber-800' : 'bg-indigo-100 text-indigo-700'}`}>{isTournament ? 'Turniej' : 'Cash'}</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-black ${candidate.status === 'stale' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-600'}`}>{candidate.status === 'stale' ? 'Analiza nieaktualna' : 'Brak raportu'}</span>
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                      <span>{formatSessionDate(candidate)}</span><span>{candidate.handCount} rozdań</span>
                    </span>
                    {sessionAnalysisErrorMessage ? <span role="alert" className="mt-1 block text-[11px] font-semibold text-red-700">{sessionAnalysisErrorMessage}</span> : null}
                  </span>
                  {sessionAnalysisStatus === 'loading' ? (
                    <span data-testid="session-group-row-loading" className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center text-indigo-700" title="Analizowanie…"><LoaderCircle size={15} className="animate-spin"/></span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`${candidate.status === 'stale' ? 'Analizuj ponownie' : 'Analizuj sesję'}: ${candidate.label}${sessionAnalysisErrorCode === 'AI_INCOMPLETE_RESPONSE' ? ' — nowe płatne żądanie' : ''}`}
                      title={candidate.status === 'stale' ? 'Analizuj ponownie' : 'Analizuj sesję'}
                      disabled={!canUseModel}
                      onClick={() => triggerSessionAnalysis(candidate)}
                      className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Brain size={14}/>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

        </div>

        <section data-testid="session-group-analysis-preview" className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="shrink-0 border-b border-slate-100 px-4 py-3 sm:px-5">
            <h3 className="text-sm font-black text-slate-800">Podgląd i raport analizy</h3>
            <p className="mt-0.5 text-xs text-slate-500">Lokalne metryki są oddzielone od raportu AI i nie wysyłają historii rozdań.</p>
            {history.length > 0 && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                <label className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-slate-500" htmlFor="session-group-analysis-history"><History size={14}/> Historia raportów ({history.length})</label>
                <select id="session-group-analysis-history" value={currentReport?.reportId || ''} onChange={(event) => onSelectedReportIdChange?.(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-bold text-slate-700 outline-none">
                  {[...history].reverse().map((report) => (
                    <option key={report.reportId} value={report.reportId}>{report.model?.name || 'Nieznany model'} — {formatDate(report.analyzedAt)} · {report.sessionCount || report.sources?.length || 0} sesje</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="space-y-3 p-4 sm:p-5">
      {selectedCandidates.length < 2 && (
        <div data-testid="session-group-analysis-empty-preview" className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
          <p className="text-sm font-black text-slate-700">Wybierz co najmniej dwie sesje</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">Tutaj pojawi się kompaktowy podgląd metryk, raport i historia po wybraniu sesji z lewej kolumny.</p>
        </div>
      )}

      {selectedCandidates.length >= 2 && previewMetrics && (
        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <CompactMetricsBar
            sessionCount={deferredSelectedCandidates.length}
            metrics={previewMetrics}
            cashCount={deferredCashCount}
            cashMetrics={cashMetrics}
            tournamentCount={deferredTournamentCount}
            tournamentMetrics={tournamentMetrics}
          />
          <button
            type="button"
            data-testid="session-group-toggle-profile"
            onClick={() => setIsProfileOpen((open) => !open)}
            className="m-3 w-[calc(100%-1.5rem)] rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-xs font-black text-slate-700 transition-colors hover:bg-slate-50"
          >
            {isProfileOpen ? 'Ukryj pełny profil lokalny' : 'Pokaż pełny profil lokalny'}
          </button>
          {isProfileOpen && (
            <>
          <div className="px-4 py-3 text-sm font-black text-slate-700 sm:px-5">
            Lokalny profil wybranych sesji ({previewMetrics.hands} rozdań)
          </div>
          <div data-testid="session-group-full-profile" className="max-h-[40vh] overflow-y-auto overscroll-contain border-t border-slate-100 custom-scrollbar">
            <SessionSummary
              metrics={previewMetrics}
              title="Lokalny profil wybranych sesji"
              description="Metryki są liczone lokalnie ze wszystkich prawdziwych rąk wybranych sesji; do AI nie trafiają surowe historie rozdań."
              resultBreakdown={candidateResult.gameType === 'both' ? { cash: cashMetrics, tournament: tournamentMetrics } : null}
            />
          </div>
            </>
          )}
        </section>
      )}
      {selectedCandidates.length >= 2 && !previewMetrics && metricsPending && (
        <div role="status" className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm font-semibold text-indigo-900">Obliczanie lokalnego podglądu…</div>
      )}

      {history.length > 0 && (
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <GroupAnalysisReport report={currentReport} stale={isStale} currentSourceMap={currentSourceMap} onHandClick={onHandClick} onOpenSession={onOpenSession}/>
        </section>
      )}

      {selectedCandidates.length > 0 && selectedCandidates.length < 2 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900"><AlertTriangle size={15}/> Jedna sesja nie wystarcza do przekrojowych wniosków.</div>
      )}
          </div>
        </section>
      </div>
    </div>
  );
};
