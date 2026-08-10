import { useEffect, useMemo, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Brain,
  CalendarDays,
  CheckSquare,
  CheckCircle2,
  Clock3,
  CircleAlert,
  LoaderCircle,
  Play,
  RotateCcw,
  Square,
} from 'lucide-react';
import {
  analyzeSessionGroupWithAI,
  analyzeSessionWithAI,
  clearSessionGroupPreview,
  fetchSessionGroupPreview,
  fetchSessions,
} from '../store/pokerSlice.js';

const typeOf = (session) => session.type === 'Cash' ? 'cash' : 'tournament';
const labelOf = (session) => typeOf(session) === 'cash'
  ? `Stół ${session.tableId || 'bez nazwy'}`
  : session.tourneyName || `Turniej ${session.tourneyId || 'bez nazwy'}`;

const isInRange = (session, dateFrom, dateTo) => {
  const timestamp = Number(session.startTime);
  if (!Number.isFinite(timestamp)) return false;
  if (dateFrom && timestamp < new Date(`${dateFrom}T00:00:00`).getTime()) return false;
  if (dateTo && timestamp > new Date(`${dateTo}T23:59:59.999`).getTime()) return false;
  return true;
};

const isCurrentReport = (report, session, datasetRevision) => (
  report?.fingerprint === session.fingerprint
  && (!datasetRevision || !report.datasetRevision || report.datasetRevision === datasetRevision)
);

const DateField = ({ label, value, onChange, testId }) => (
  <label className="flex min-w-[9.5rem] flex-1 flex-col gap-1 text-xs font-black uppercase tracking-wide text-slate-500">
    <span>{label}</span>
    <span className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold normal-case tracking-normal text-slate-700">
      <CalendarDays size={16} className="shrink-0 text-slate-400"/>
      <input data-testid={testId} type="date" value={value} onChange={(event) => onChange(event.target.value)} className="min-w-0 flex-1 bg-transparent outline-none"/>
    </span>
  </label>
);

const metricValue = (metric) => {
  const value = metric?.value;
  return typeof value === 'number' ? value.toLocaleString('pl-PL', { maximumFractionDigits: 1 }) : (value || '—');
};

const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'nieznana data' : date.toLocaleString('pl-PL');
};

const sourceLabel = (source) => source?.metadata?.label || source?.label || source?.sessionId || 'Nieznana sesja';

const reportSourcesById = (report) => new Map(
  (Array.isArray(report?.sources) ? report.sources : [])
    .filter((source) => source?.sourceId)
    .map((source) => [String(source.sourceId), source]),
);

const sourceIsAvailable = (source, candidatesById) => {
  const candidate = candidatesById.get(String(source?.sessionId));
  return Boolean(candidate
    && (candidate.gameType || typeOf(candidate)) === source?.type
    && candidate.fingerprint === source?.sessionFingerprint);
};

const SourceReferences = ({ sourceRefs, report, candidatesById, onHandClick, onOpenSession }) => {
  const sources = reportSourcesById(report);
  const references = Array.isArray(sourceRefs) ? sourceRefs : [];
  if (references.length === 0) return null;
  return <div className="mt-2 flex flex-wrap gap-1.5" data-testid="session-group-source-references">
    {references.map((reference, index) => {
      const source = sources.get(String(reference?.sourceId));
      const available = sourceIsAvailable(source, candidatesById);
      const handIds = Array.isArray(reference?.handIds) ? reference.handIds.filter(Boolean) : [];
      return <span key={`${reference?.sourceId || 'missing'}:${reference?.reportId || index}`} className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
        <button
          type="button"
          disabled={!available}
          title={available ? `Otwórz ${sourceLabel(source)}` : 'Sesja źródłowa nie jest już dostępna w aktualnych danych.'}
          aria-label={available ? `Otwórz sesję: ${sourceLabel(source)}` : `Niedostępna sesja: ${sourceLabel(source)}`}
          onClick={() => onOpenSession({ type: source?.type, sessionId: source?.sessionId })}
          className="rounded px-1.5 py-1 text-[10px] font-black text-slate-700 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          {sourceLabel(source)}
        </button>
        {handIds.map((handId) => <button
          key={handId}
          type="button"
          disabled={!available}
          title={available ? `Otwórz rozdanie #${handId}` : 'Rozdanie nie jest dostępne, bo sesja źródłowa nie istnieje lub zmieniła się.'}
          aria-label={available ? `Otwórz rozdanie #${handId}` : `Niedostępne rozdanie #${handId}`}
          onClick={() => onHandClick?.(String(handId))}
          className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-1.5 py-1 text-[10px] font-bold text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
        ><Play size={10}/> #{handId}</button>)}
      </span>;
    })}
  </div>;
};

const FindingList = ({ title, findings, report, candidatesById, onHandClick, onOpenSession, correction = false, accent = 'indigo' }) => {
  if (!Array.isArray(findings) || findings.length === 0) return null;
  return <section className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
    <h4 className="text-xs font-black uppercase tracking-wide text-slate-700">{title}</h4>
    <div className="mt-2 space-y-3">
      {findings.map((finding, index) => <article key={`${finding?.title || title}-${index}`} className={`border-l-2 pl-3 text-xs text-slate-700 ${accent === 'amber' ? 'border-amber-300' : 'border-indigo-300'}`}>
        <p className="font-black">{finding?.title || 'Wniosek'}</p>
        {finding?.description && <p className="mt-1 leading-relaxed">{finding.description}</p>}
        {correction && finding?.correction && <p className="mt-1 font-semibold text-emerald-800">Korekta: {finding.correction}</p>}
        <SourceReferences sourceRefs={finding?.sourceRefs} report={report} candidatesById={candidatesById} onHandClick={onHandClick} onOpenSession={onOpenSession}/>
      </article>)}
    </div>
  </section>;
};

const ReportSources = ({ report, candidatesById, onOpenSession }) => {
  const sources = Array.isArray(report?.sources) ? report.sources : [];
  if (sources.length === 0) return <p className="text-xs text-slate-500">Ten historyczny raport nie zawiera listy źródeł.</p>;
  return <section className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
    <h4 className="text-xs font-black uppercase tracking-wide text-slate-700">Źródła raportu</h4>
    <div className="mt-2 flex flex-wrap gap-2">
      {sources.map((source) => {
        const available = sourceIsAvailable(source, candidatesById);
        return <button key={source.sourceId} type="button" disabled={!available}
          title={available ? `Otwórz ${sourceLabel(source)}` : 'Sesja źródłowa nie jest już dostępna w aktualnych danych.'}
          aria-label={available ? `Otwórz sesję: ${sourceLabel(source)}` : `Niedostępna sesja: ${sourceLabel(source)}`}
          onClick={() => onOpenSession({ type: source.type, sessionId: source.sessionId })}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-left text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:text-slate-400">
          {sourceLabel(source)} <span className="font-normal text-slate-500">· {source.metadata?.handCount || 0} rąk</span>
        </button>;
      })}
    </div>
  </section>;
};

const CategoryInsights = ({ insights, report, candidatesById, onHandClick, onOpenSession }) => {
  if (!Array.isArray(insights) || insights.length === 0) return null;
  return <section className="space-y-3">
    <h4 className="text-xs font-black uppercase tracking-wide text-slate-500">Wnioski Cash / Turnieje</h4>
    {insights.map((insight) => {
      const isTournament = insight?.category === 'tournament';
      const category = isTournament ? 'Turnieje' : 'Cash';
      return <section key={insight?.category || category} className={`rounded-xl border p-3 ${isTournament ? 'border-amber-200 bg-amber-50' : 'border-indigo-200 bg-indigo-50'}`}>
        <h5 className="text-sm font-black text-slate-800">{category}</h5>
        {insight?.summary && <p className="mt-2 text-sm leading-relaxed text-slate-700">{insight.summary}</p>}
        <SourceReferences sourceRefs={insight?.sourceRefs} report={report} candidatesById={candidatesById} onHandClick={onHandClick} onOpenSession={onOpenSession}/>
        <div className="mt-3 space-y-3">
          <FindingList title="Tendencje" findings={insight?.tendencies} report={report} candidatesById={candidatesById} onHandClick={onHandClick} onOpenSession={onOpenSession} accent={isTournament ? 'amber' : 'indigo'}/>
          <FindingList title="Rekomendacje" findings={insight?.recommendations} report={report} candidatesById={candidatesById} onHandClick={onHandClick} onOpenSession={onOpenSession} accent={isTournament ? 'amber' : 'indigo'}/>
        </div>
      </section>;
    })}
  </section>;
};

const GroupAnalysisReport = ({ report, stale, candidatesById, onHandClick, onOpenSession }) => {
  const analysis = report?.analysis;
  if (!analysis || typeof analysis !== 'object') return <p className="text-sm text-slate-500">Raport historyczny nie zawiera treści analizy.</p>;
  return <article data-testid="session-group-analysis-report" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-center gap-2 text-xs font-black text-slate-700"><CheckCircle2 size={15} className="text-emerald-600"/> {report.model?.name || 'Raport AI'} <span className="font-medium text-slate-500">Â· {formatDate(report.analyzedAt)}</span></div>
    {stale && <p role="status" className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-100 p-3 text-xs font-semibold text-amber-900"><CircleAlert size={15}/> Część źródeł raportu jest nieaktualna lub niedostępna. Nadal możesz odczytać zachowaną treść.</p>}
    <section className="rounded-xl bg-slate-50 p-3"><h4 className="text-xs font-black uppercase tracking-wide text-slate-500">Podsumowanie sesji</h4><p className="mt-2 text-sm leading-relaxed text-slate-700">{analysis.summary || analysis.sessionSummary || 'Raport nie zawiera podsumowania.'}</p><SourceReferences sourceRefs={analysis.summarySourceRefs} report={report} candidatesById={candidatesById} onHandClick={onHandClick} onOpenSession={onOpenSession}/></section>
    <FindingList title="Mocne strony" findings={analysis.strengths} report={report} candidatesById={candidatesById} onHandClick={onHandClick} onOpenSession={onOpenSession}/>
    <FindingList title="Powtarzalne błędy i korekty" findings={analysis.repeatedMistakes} report={report} candidatesById={candidatesById} onHandClick={onHandClick} onOpenSession={onOpenSession} correction accent="amber"/>
    <FindingList title="Trzy priorytety treningowe" findings={analysis.trainingPriorities} report={report} candidatesById={candidatesById} onHandClick={onHandClick} onOpenSession={onOpenSession}/>
    <CategoryInsights insights={analysis.categoryInsights} report={report} candidatesById={candidatesById} onHandClick={onHandClick} onOpenSession={onOpenSession}/>
    <ReportSources report={report} candidatesById={candidatesById} onOpenSession={onOpenSession}/>
  </article>;
};

const SessionGroupMetricsPreview = ({ preview }) => {
  const breakdown = preview.categoryBreakdown || {};
  const metrics = preview.metrics || {};
  return (
    <section data-testid="session-group-metrics-preview" className="rounded-xl border border-indigo-100 bg-indigo-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-black text-indigo-950">Metryki wybranych sesji</p>
          <p className="mt-1 text-xs text-indigo-800">{preview.sessionCount} sesje · {preview.handCount} rąk · {preview.dateRange?.from || '—'} — {preview.dateRange?.to || '—'}</p>
        </div>
        <span className="rounded-full bg-white/80 px-2 py-1 text-[10px] font-black uppercase text-indigo-800">{preview.activeCategory === 'both' ? 'Cash + Turnieje' : preview.activeCategory}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {[['VPIP', metrics.shared?.vpip], ['PFR', metrics.shared?.pfr], ['AF', metrics.shared?.af], ['WTSD', metrics.shared?.wtsd]].map(([label, metric]) => <div key={label} className="rounded-lg bg-white/80 p-2"><p className="text-[10px] font-black uppercase text-slate-500">{label}</p><p className="mt-1 font-black text-slate-800">{metricValue(metric)}</p></div>)}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-indigo-900">
        <span className="rounded-md bg-white/70 px-2 py-1">Cash: {breakdown.cash?.sessionCount || 0} sesje / {breakdown.cash?.handCount || 0} rąk</span>
        <span className="rounded-md bg-white/70 px-2 py-1">Turnieje: {breakdown.tournament?.sessionCount || 0} sesje / {breakdown.tournament?.handCount || 0} rąk</span>
      </div>
    </section>
  );
};

export const SessionGroupAnalysisView = ({
  gameType = 'both',
  onGameTypeChange = () => {},
  dateFrom = '',
  dateTo = '',
  onDateFromChange = () => {},
  onDateToChange = () => {},
  onClearDateRange = () => {},
  selectedSourceIds = [],
  onSelectedSourceIdsChange = () => {},
  selectedReportId = null,
  onSelectedReportIdChange = () => {},
  onHandClick = () => {},
  onOpenSession = () => {},
}) => {
  const dispatch = useDispatch();
  const datasetRevision = useSelector((state) => state.poker.dataset.datasetRevision);
  const cashPage = useSelector((state) => state.poker.currentPages.cash);
  const tournamentPage = useSelector((state) => state.poker.currentPages.tournament);
  const reportsBySession = useSelector((state) => state.poker.sessionAiAnalyses);
  const groupReports = useSelector((state) => state.poker.sessionGroupAiAnalyses);
  const sessionGroupPreview = useSelector((state) => state.poker.sessionGroupPreview);
  const groupStatus = useSelector((state) => state.poker.sessionGroupAnalysisStatus);
  const groupError = useSelector((state) => state.poker.sessionGroupAnalysisError);
  const sessionStatusById = useSelector((state) => state.poker.sessionAnalysisStatusById);
  const sessionErrorById = useSelector((state) => state.poker.sessionAnalysisErrorById);
  const previewRequestRef = useRef(null);

  useEffect(() => {
    if (cashPage.status !== 'loading' && (!cashPage.datasetRevision || cashPage.datasetRevision !== datasetRevision)) dispatch(fetchSessions({ gameType: 'cash' }));
    if (tournamentPage.status !== 'loading' && (!tournamentPage.datasetRevision || tournamentPage.datasetRevision !== datasetRevision)) dispatch(fetchSessions({ gameType: 'tournament' }));
  }, [cashPage.datasetRevision, cashPage.status, datasetRevision, dispatch, tournamentPage.datasetRevision, tournamentPage.status]);

  const candidates = useMemo(() => [
    ...(cashPage.items || []),
    ...(tournamentPage.items || []),
  ].filter((session) => {
    const type = typeOf(session);
    return (gameType === 'both' || type === gameType) && isInRange(session, dateFrom, dateTo);
  }).map((session) => {
    const reports = Array.isArray(reportsBySession[session.id]) ? reportsBySession[session.id] : [];
    const currentReport = [...reports].reverse().find((report) => isCurrentReport(report, session, datasetRevision)) || null;
    return { ...session, gameType: typeOf(session), currentReport };
  }).sort((left, right) => Number(right.startTime) - Number(left.startTime)), [cashPage.items, datasetRevision, dateFrom, dateTo, gameType, reportsBySession, tournamentPage.items]);

  const selectedIds = [...new Set(selectedSourceIds.map(String))].filter((id) => candidates.some((candidate) => candidate.id === id));
  const selectedCandidates = candidates.filter((candidate) => selectedIds.includes(candidate.id));
  const candidatesById = useMemo(() => new Map([
    ...(cashPage.items || []),
    ...(tournamentPage.items || []),
  ].map((session) => [String(session.id), session])), [cashPage.items, tournamentPage.items]);
  const selectedIdsKey = JSON.stringify([...selectedIds].sort());
  const previewForSelection = (() => {
    const preview = sessionGroupPreview.data;
    if (sessionGroupPreview.status !== 'succeeded'
      || preview?.datasetRevision !== datasetRevision
      || !Array.isArray(preview?.sources)) return null;
    const previewIds = new Set(preview.sources.map((source) => String(source.sessionId)));
    return previewIds.size === selectedIds.length && selectedIds.every((id) => previewIds.has(id))
      ? preview
      : null;
  })();

  useEffect(() => {
    const requestSessionIds = JSON.parse(selectedIdsKey);
    if (!datasetRevision || requestSessionIds.length === 0) {
      previewRequestRef.current?.abort();
      previewRequestRef.current = null;
      dispatch(clearSessionGroupPreview());
      return undefined;
    }
    const timeoutId = setTimeout(() => {
      previewRequestRef.current = dispatch(fetchSessionGroupPreview({ sessionIds: requestSessionIds }));
    }, 300);
    return () => {
      clearTimeout(timeoutId);
      previewRequestRef.current?.abort();
      previewRequestRef.current = null;
    };
  }, [datasetRevision, dispatch, selectedIdsKey]);

  const canAnalyzeGroup = selectedCandidates.length >= 2 && selectedCandidates.every((candidate) => candidate.currentReport);
  const visibleReports = [...groupReports].sort((left, right) => String(right.analyzedAt || '').localeCompare(String(left.analyzedAt || '')));
  const activeReport = visibleReports.find((report) => report.reportId === selectedReportId) || visibleReports[0] || null;
  const activeReportStale = Boolean(activeReport) && (() => {
    const sources = Array.isArray(activeReport.sources) ? activeReport.sources : [];
    // Dataset revisions are global; a new, unrelated hand must not invalidate
    // a report. A report is stale only when one of its concrete sources changed
    // or disappeared. Legacy reports have no source snapshot, but stay readable.
    return sources.length > 0 && sources.some((source) => !sourceIsAvailable(source, candidatesById));
  })();

  const toggleSession = (sessionId) => {
    const next = selectedIds.includes(sessionId)
      ? selectedIds.filter((id) => id !== sessionId)
      : [...selectedIds, sessionId];
    onSelectedSourceIdsChange(next);
  };

  const selectVisible = () => onSelectedSourceIdsChange(candidates.map((candidate) => candidate.id));

  return (
    <div data-testid="session-group-analysis-view" className="mx-auto w-full max-w-7xl animate-in fade-in duration-300">
      <div data-testid="session-group-analysis-workspace" className="grid items-start gap-4 lg:grid-cols-[minmax(20rem,0.85fr)_minmax(0,1.35fr)]">
        <div data-testid="session-group-analysis-selector" className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <section className="border-b border-gray-200 p-4 sm:p-5">
            <div className="flex items-center gap-2"><Brain size={19} className="text-indigo-600"/><h3 className="text-xl font-black text-slate-800">Analiza wielu sesji</h3></div>
            <div data-testid="session-group-game-type" className="mt-4 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 sm:w-fit">
              {[['both', 'Wszystko'], ['cash', 'Cash'], ['tournament', 'Turnieje']].map(([value, label]) => <button key={value} type="button" onClick={() => onGameTypeChange(value)} className={`rounded-lg px-3 py-1.5 text-xs font-black transition-colors ${gameType === value ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:bg-white/70'}`}>{label}</button>)}
            </div>
            <div className="mt-4 flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-end">
              <DateField label="Od" value={dateFrom} onChange={onDateFromChange} testId="session-group-date-from"/>
              <DateField label="Do" value={dateTo} onChange={onDateToChange} testId="session-group-date-to"/>
              <button type="button" aria-label="Wyczyść zakres dat" title="Wyczyść zakres dat" disabled={!dateFrom && !dateTo} onClick={onClearDateRange} className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw size={14}/></button>
            </div>
          </section>
          <section data-testid="session-group-analysis-action" className="border-b border-indigo-100 bg-indigo-50 px-4 py-3">
            <button type="button" data-testid="session-group-analyze-selected" aria-label={groupStatus === 'loading' ? 'Generowanie raportu wielu sesji' : 'Uruchom analizę wybranych sesji'} title={groupStatus === 'loading' ? 'Generowanie raportu' : 'Uruchom analizę wybranych sesji'} disabled={!canAnalyzeGroup || groupStatus === 'loading'} onClick={() => {
              onSelectedReportIdChange(null);
              dispatch(analyzeSessionGroupWithAI({ sessionIds: selectedIds }));
            }} className="inline-flex size-9 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300">
              {groupStatus === 'loading' ? <LoaderCircle size={17} className="animate-spin"/> : <Brain size={17}/>}<span className="sr-only">{groupStatus === 'loading' ? 'Generowanie raportu' : 'Analizuj wybrane sesje'}</span>
            </button>
            {!canAnalyzeGroup && selectedCandidates.length >= 2 && <p className="mt-2 text-xs text-indigo-800">Najpierw uruchom aktualny raport AI dla każdej wybranej sesji.</p>}
          </section>
          <section data-testid="session-group-analysis-session-list" className="max-h-[calc(100vh-25rem)] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5"><span className="text-xs font-black uppercase tracking-wide text-slate-500">Sesje</span><span className="flex items-center gap-1"><button type="button" aria-label="Zaznacz widoczne sesje" title="Zaznacz widoczne sesje" disabled={candidates.length === 0} onClick={selectVisible} className="inline-flex size-7 items-center justify-center rounded-md text-indigo-700 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"><CheckSquare size={16}/></button><button type="button" aria-label="Wyczyść wybór sesji" title="Wyczyść wybór sesji" disabled={selectedIds.length === 0} onClick={() => onSelectedSourceIdsChange([])} className="inline-flex size-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw size={15}/></button></span></div>
            {(cashPage.status === 'loading' || tournamentPage.status === 'loading') && candidates.length === 0 && <p className="p-6 text-center text-sm text-slate-500">Pobieranie list sesji…</p>}
            {candidates.length === 0 && cashPage.status !== 'loading' && tournamentPage.status !== 'loading' && <p className="p-8 text-center text-sm text-slate-500">Brak sesji z prawdziwymi rozdaniami w bieżącej kategorii i zakresie dat.</p>}
            <div className="space-y-2 p-3">{candidates.map((candidate) => {
              const selected = selectedIds.includes(candidate.id);
              const analyzing = sessionStatusById[candidate.id] === 'loading';
              return <article key={candidate.id} className={`rounded-xl border p-3 ${selected ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-white'}`}><div className="flex items-start gap-2"><button type="button" aria-label={`${selected ? 'Odznacz' : 'Zaznacz'} sesję: ${labelOf(candidate)}`} title={selected ? 'Odznacz sesję' : 'Zaznacz sesję'} onClick={() => toggleSession(candidate.id)} className="mt-0.5 rounded text-slate-400 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">{selected ? <CheckSquare size={18} className="text-indigo-600"/> : <Square size={18}/>}</button><button type="button" onClick={() => onOpenSession({ type: candidate.gameType, sessionId: candidate.id })} className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"><p className="truncate text-sm font-black text-slate-800">{labelOf(candidate)}</p><p className="mt-0.5 text-xs text-slate-500">{candidate.handCount} rąk · {candidate.dateStr}</p></button></div><div className="mt-2 flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-[10px] font-black ${candidate.currentReport ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{candidate.currentReport ? 'raport aktualny' : 'brak aktualnego raportu'}</span><button type="button" aria-label={`${analyzing ? 'Analizowanie sesji' : candidate.currentReport ? 'Analizuj ponownie' : 'Analizuj sesję'}: ${labelOf(candidate)}`} title={analyzing ? 'Analizowanie sesji' : candidate.currentReport ? 'Analizuj ponownie' : 'Analizuj sesję'} disabled={analyzing} onClick={() => dispatch(analyzeSessionWithAI({ sessionId: candidate.id }))} className="inline-flex size-7 items-center justify-center rounded-md border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">{analyzing ? <LoaderCircle size={14} className="animate-spin"/> : <Brain size={14}/>}</button></div>{sessionErrorById[candidate.id] && <p role="alert" className="mt-2 text-xs text-red-700">{sessionErrorById[candidate.id]?.message || sessionErrorById[candidate.id]}</p>}</article>;
            })}</div>
          </section>
        </div>

        <section data-testid="session-group-analysis-preview" className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 sm:px-5"><h3 className="text-sm font-black text-slate-800">Podgląd i raport analizy</h3><p className="mt-0.5 text-xs text-slate-500">Do serwera trafiają tylko ID sesji i rewzja datasetu; raport jest budowany z aktualnych danych kanonicznych.</p>{visibleReports.length > 0 && <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5"><label className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-slate-500"><Clock3 size={14}/> Historia raportów ({visibleReports.length})</label><select aria-label="Historia raportów analizy wielu sesji" value={activeReport?.reportId || ''} onChange={(event) => onSelectedReportIdChange(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-bold text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">{visibleReports.map((report) => <option key={report.reportId} value={report.reportId}>{report.model?.name || 'Model AI'} · {report.sessionCount || report.sessionIds?.length || 0} sesje</option>)}</select></div>}</div>
          <div className="space-y-3 p-4 sm:p-5">
            {sessionGroupPreview.status === 'loading' && <div data-testid="session-group-preview-loading" role="status" className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-sm font-semibold text-indigo-800">Aktualizowanie metryk wybranych sesji…</div>}
            {sessionGroupPreview.status === 'failed' && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{sessionGroupPreview.error?.message || sessionGroupPreview.error}</div>}
            {previewForSelection && <SessionGroupMetricsPreview preview={previewForSelection}/>}
            {groupError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{groupError?.message || groupError}</div>}
            {selectedCandidates.length < 2 && <div data-testid="session-group-analysis-empty-preview" className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center"><p className="text-sm font-black text-slate-700">Wybierz co najmniej dwie sesje</p><p className="mt-1 text-xs leading-relaxed text-slate-500">Każda wybrana sesja potrzebuje aktualnego raportu AI.</p></div>}
            {selectedCandidates.length >= 2 && <div data-testid="session-group-compact-preview" className="rounded-xl border border-indigo-100 bg-indigo-50 p-4"><p className="text-sm font-black text-indigo-950">Wybrano {selectedCandidates.length} sesje</p><p className="mt-1 text-xs text-indigo-800">{canAnalyzeGroup ? 'Wszystkie raporty źródłowe są aktualne.' : 'Analiza zbiorcza odblokuje się po przygotowaniu raportów źródłowych.'}</p></div>}
            {activeReport && <GroupAnalysisReport report={activeReport} stale={activeReportStale} candidatesById={candidatesById} onHandClick={onHandClick} onOpenSession={onOpenSession}/>}
          </div>
        </section>
      </div>
    </div>
  );
};
