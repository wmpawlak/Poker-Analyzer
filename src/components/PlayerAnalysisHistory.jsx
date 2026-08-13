import {
  AlertTriangle,
  BarChart3,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Dumbbell,
  ExternalLink,
  History,
  ShieldCheck,
  Sparkles,
  Target,
} from 'lucide-react';

const GAME_TYPE_LABELS = {
  both: 'Wszystko',
  cash: 'Cash',
  tournament: 'Turnieje',
};

const CATEGORY_LABELS = {
  cash: 'Cash',
  tournament: 'Turnieje',
};

const formatDateTime = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Nieznana data'
    : date.toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });
};

const formatRange = (criteria = {}) => {
  if (!criteria.dateFrom && !criteria.dateTo) return 'Cała historia';
  return `${criteria.dateFrom || 'początek'} — ${criteria.dateTo || 'koniec'}`;
};

const formatMetricValue = (metric) => {
  if (!metric || metric.value === null || metric.value === undefined) return '—';
  const value = typeof metric.value === 'number'
    ? metric.value.toLocaleString('pl-PL', { maximumFractionDigits: 2 })
    : String(metric.value);
  return metric.unit ? `${value} ${metric.unit}` : value;
};

const isReportStale = (report, currentDatasetRevision) => Boolean(
  currentDatasetRevision
  && report?.datasetRevision
  && report.datasetRevision !== currentDatasetRevision
);

const findSessionSource = (report, reportId) => (
  (Array.isArray(report?.sources) ? report.sources : [])
    .find((source) => source.reportId === reportId) || null
);

const sourceIsAvailable = (source, sessionAiAnalyses) => Boolean(
  source?.sessionId
  && source?.reportId
  && (sessionAiAnalyses?.[source.sessionId] || [])
    .some((sessionReport) => sessionReport.reportId === source.reportId)
);

const hasLostAllSessionSources = (report, path, sessionReportIds) => (
  Array.isArray(sessionReportIds)
  && sessionReportIds.length === 0
  && (Array.isArray(report?.referenceWarnings) ? report.referenceWarnings : [])
    .some((warning) => warning.path === path && warning.kind === 'sessionReport')
);

const ReferenceWarningSummary = ({ warnings = [] }) => {
  if (!Array.isArray(warnings) || warnings.length === 0) return null;
  const discardedCount = warnings.reduce(
    (total, warning) => total + (Array.isArray(warning?.discardedIds) ? warning.discardedIds.length : 0),
    0,
  );
  return (
    <div data-testid="player-analysis-reference-warnings" role="status" className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <span>Oczyszczono {discardedCount || warnings.length} nieprawidłowych referencji. Treść raportu została zachowana.</span>
    </div>
  );
};

const MissingSourcesWarning = ({ visible }) => {
  if (!visible) return null;
  return (
    <div data-testid="player-analysis-missing-sources-warning" className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-amber-800">
      <AlertTriangle size={13} /> Nie zachowano żadnego źródła sesyjnego dla tej sekcji.
    </div>
  );
};

const ReferenceChips = ({
  report,
  metricIds = [],
  sessionReportIds = [],
  sessionAiAnalyses,
  onOpenSession,
}) => {
  const catalog = report?.snapshot?.metricCatalog || {};
  const normalizedMetricIds = Array.isArray(metricIds) ? metricIds : [];
  const normalizedSessionIds = Array.isArray(sessionReportIds) ? sessionReportIds : [];
  if (normalizedMetricIds.length === 0 && normalizedSessionIds.length === 0) return null;

  return (
    <div data-testid="player-analysis-references" className="mt-3 flex flex-wrap gap-1.5">
      {normalizedMetricIds.map((metricId) => {
        const metric = catalog[metricId];
        return (
          <span key={metricId} title={metricId} className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-bold text-indigo-800">
            <BarChart3 size={11} /> {metric?.label || metricId}: {formatMetricValue(metric)}
          </span>
        );
      })}
      {normalizedSessionIds.map((reportId) => {
        const source = findSessionSource(report, reportId);
        const available = sourceIsAvailable(source, sessionAiAnalyses);
        const label = source
          ? `${CATEGORY_LABELS[source.type] || source.type} · ${source.date || source.sessionId}`
          : `Raport sesji ${reportId}`;
        return (
          <button
            key={reportId}
            type="button"
            disabled={!available}
            title={available ? `Otwórz dokładny raport ${reportId}` : 'Historyczny raport sesji nie jest już dostępny'}
            onClick={() => available && onOpenSession?.(source)}
            className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-800 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500"
          >
            <ExternalLink size={11} /> {label}{available ? '' : ' · niedostępny'}
          </button>
        );
      })}
    </div>
  );
};

const InsightCard = ({ title, children, tone = 'slate', references }) => {
  const tones = {
    emerald: 'border-emerald-200 bg-emerald-50/70',
    red: 'border-red-200 bg-red-50/70',
    indigo: 'border-indigo-200 bg-indigo-50/70',
    amber: 'border-amber-200 bg-amber-50/70',
    slate: 'border-slate-200 bg-slate-50',
  };
  return (
    <article className={`rounded-xl border p-4 ${tones[tone] || tones.slate}`}>
      <h5 className="text-sm font-black text-slate-800">{title}</h5>
      <div className="mt-1 text-sm leading-relaxed text-slate-700">{children}</div>
      {references}
    </article>
  );
};

const PlayerAnalysisReport = ({ report, currentDatasetRevision, sessionAiAnalyses, onOpenSession }) => {
  if (!report) {
    return <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-sm text-slate-500">Wybierz raport z historii.</div>;
  }
  const analysis = report.analysis || {};
  const snapshot = report.snapshot || {};
  const stale = isReportStale(report, currentDatasetRevision);
  const referenceWarnings = Array.isArray(report.referenceWarnings)
    ? report.referenceWarnings
    : [];
  const references = (metricIds, sessionReportIds, sessionPath) => (
    <>
      <ReferenceChips
        report={report}
        metricIds={metricIds}
        sessionReportIds={sessionReportIds}
        sessionAiAnalyses={sessionAiAnalyses}
        onOpenSession={onOpenSession}
      />
      <MissingSourcesWarning
        visible={hasLostAllSessionSources(report, sessionPath, sessionReportIds)}
      />
    </>
  );

  return (
    <article data-testid="selected-player-analysis-report" data-report-id={report.reportId} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <header className="border-b border-slate-100 pb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-indigo-600"><Sparkles size={15} /> Raport statystyk gracza</div>
            <h3 className="mt-2 text-xl font-black text-slate-900">{GAME_TYPE_LABELS[report.criteria?.gameType] || report.criteria?.gameType || 'Wszystko'} · {formatRange(report.criteria)}</h3>
            <p className="mt-1 text-xs text-slate-500">{report.model?.name || 'Nieznany model'} · {formatDateTime(report.analyzedAt)}</p>
          </div>
          {stale && <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-amber-900"><AlertTriangle size={13} /> Dane zmienione</span>}
        </div>
        <ReferenceWarningSummary warnings={referenceWarnings} />
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['Ręce', snapshot.handCount ?? report.handCount, BarChart3],
            ['Sesje', snapshot.sessionCount ?? report.sessionCount, CalendarDays],
            ['Styl', snapshot.profileStyle?.label || snapshot.profileStyleId || analysis.profileStyleId, BrainCircuit],
            ['Wiarygodność', snapshot.reliability?.label || snapshot.reliabilityId || analysis.reliabilityId, ShieldCheck],
          ].map(([label, value, Icon]) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <Icon size={15} className="text-indigo-500" />
              <div className="mt-2 text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</div>
              <div className="mt-1 text-sm font-black text-slate-800">{value ?? '—'}</div>
            </div>
          ))}
        </div>
      </header>

      <div className="mt-5 space-y-6">
        <section>
          <h4 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-700"><BrainCircuit size={17} className="text-indigo-600" /> Podsumowanie</h4>
          <p className="mt-2 text-sm leading-relaxed text-slate-700">{analysis.summary || 'Brak podsumowania w tym historycznym raporcie.'}</p>
          {references(analysis.summaryMetricIds, analysis.summarySessionReportIds, 'summarySessionReportIds')}
        </section>

        {analysis.categoryInsights?.length > 0 && <section>
          <h4 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-700">Wnioski według typu gry</h4>
          <div className="grid gap-3 md:grid-cols-2">
            {analysis.categoryInsights.map((insight, index) => <InsightCard
              key={insight.category}
              title={CATEGORY_LABELS[insight.category] || insight.category}
              tone={insight.category === 'tournament' ? 'amber' : 'indigo'}
              references={references(insight.metricIds, insight.sessionReportIds, `categoryInsights[${index}].sessionReportIds`)}
            >{insight.summary}</InsightCard>)}
          </div>
        </section>}

        <div className="grid gap-5 xl:grid-cols-2">
          <section>
            <h4 className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-emerald-800"><CheckCircle2 size={17} /> Mocne strony</h4>
            <div className="space-y-3">
              {analysis.strengths?.length > 0
                ? analysis.strengths.map((item, index) => <InsightCard key={`${item.title}-${index}`} title={item.title} tone="emerald" references={references(item.metricIds, item.sessionReportIds, `strengths[${index}].sessionReportIds`)}>{item.description}</InsightCard>)
                : <p className="text-sm text-slate-500">Brak wskazanych mocnych stron.</p>}
            </div>
          </section>
          <section>
            <h4 className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-red-800"><Target size={17} /> Leaki</h4>
            <div className="space-y-3">
              {analysis.leaks?.length > 0
                ? analysis.leaks.map((item, index) => <InsightCard key={`${item.title}-${index}`} title={item.title} tone="red" references={references(item.metricIds, item.sessionReportIds, `leaks[${index}].sessionReportIds`)}><p>{item.description}</p><p className="mt-2 font-bold text-emerald-800">Korekta: {item.correction}</p></InsightCard>)
                : <p className="text-sm text-slate-500">Brak wskazanych leaków.</p>}
            </div>
          </section>
        </div>

        {analysis.trainingPriorities?.length > 0 && <section>
          <h4 className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-indigo-800"><Dumbbell size={17} /> Trzy priorytety treningowe</h4>
          <ol className="grid gap-3 lg:grid-cols-3">
            {analysis.trainingPriorities.map((item, index) => <li key={`${item.title}-${index}`}><InsightCard title={`${index + 1}. ${item.title}`} tone="indigo" references={references(item.metricIds, item.sessionReportIds, `trainingPriorities[${index}].sessionReportIds`)}><p>{item.description}</p><p className="mt-2 font-bold text-indigo-800">Ćwiczenie: {item.exercise}</p></InsightCard></li>)}
          </ol>
        </section>}
      </div>
    </article>
  );
};

export const PlayerAnalysisHistory = ({
  reports = [],
  selectedReportId = null,
  currentDatasetRevision = '',
  sessionAiAnalyses = {},
  onSelectReport = () => {},
  onOpenSession = () => {},
}) => {
  const sortedReports = [...(Array.isArray(reports) ? reports : [])]
    .sort((left, right) => String(right.analyzedAt || '').localeCompare(String(left.analyzedAt || '')));
  const selectedReport = sortedReports.find((report) => report.reportId === selectedReportId)
    || sortedReports[0]
    || null;

  if (sortedReports.length === 0) {
    return (
      <section data-testid="player-analysis-history-empty" className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
        <History size={28} className="mx-auto text-slate-400" />
        <h3 className="mt-3 text-base font-black text-slate-800">Brak historycznych analiz</h3>
        <p className="mt-1 text-sm text-slate-500">Pierwszy utworzony raport pojawi się tutaj wraz z zapisanym snapshotem statystyk.</p>
      </section>
    );
  }

  return (
    <section data-testid="player-analysis-history" className="grid items-start gap-4 lg:grid-cols-[minmax(15rem,19rem)_minmax(0,1fr)]">
      <aside className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:sticky lg:top-0">
        <div className="flex items-center justify-between px-2 pb-3">
          <h3 className="flex items-center gap-2 text-sm font-black text-slate-800"><History size={17} /> Historia</h3>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-600">{sortedReports.length}</span>
        </div>
        <div className="max-h-[34rem] space-y-2 overflow-y-auto pr-1 custom-scrollbar">
          {sortedReports.map((report) => {
            const selected = report.reportId === selectedReport?.reportId;
            const snapshot = report.snapshot || {};
            const stale = isReportStale(report, currentDatasetRevision);
            return (
              <button
                key={report.reportId}
                type="button"
                data-testid="player-analysis-card"
                data-report-id={report.reportId}
                aria-pressed={selected}
                onClick={() => onSelectReport(report.reportId)}
                className={`w-full rounded-xl border p-3 text-left transition-colors ${selected ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-100' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-xs font-black text-slate-900">{GAME_TYPE_LABELS[report.criteria?.gameType] || report.criteria?.gameType || 'Wszystko'}</div>
                  <ChevronRight size={15} className={selected ? 'text-indigo-600' : 'text-slate-300'} />
                </div>
                <div className="mt-1 text-[10px] font-semibold text-slate-500">{formatRange(report.criteria)}</div>
                <div className="mt-3 grid grid-cols-2 gap-1 text-[10px]">
                  <span className="rounded bg-slate-100 px-1.5 py-1 font-bold text-slate-700">{snapshot.handCount ?? report.handCount ?? 0} rąk</span>
                  <span className="rounded bg-slate-100 px-1.5 py-1 font-bold text-slate-700">{snapshot.profileStyle?.label || snapshot.profileStyleId || report.analysis?.profileStyleId || '—'}</span>
                  <span className="col-span-2 rounded bg-slate-100 px-1.5 py-1 font-bold text-slate-700">{snapshot.reliability?.label || snapshot.reliabilityId || report.analysis?.reliabilityId || '—'}</span>
                </div>
                <div className="mt-3 text-[10px] text-slate-500">{formatDateTime(report.analyzedAt)}</div>
                <div className="mt-0.5 text-[10px] font-bold text-slate-700">{report.model?.name || 'Nieznany model'}</div>
                {stale && <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-amber-900"><AlertTriangle size={11} /> Dane zmienione</div>}
                {Array.isArray(report.referenceWarnings) && report.referenceWarnings.length > 0 && <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-amber-900"><AlertTriangle size={11} /> Oczyszczone referencje</div>}
              </button>
            );
          })}
        </div>
      </aside>
      <PlayerAnalysisReport
        report={selectedReport}
        currentDatasetRevision={currentDatasetRevision}
        sessionAiAnalyses={sessionAiAnalyses}
        onOpenSession={onOpenSession}
      />
    </section>
  );
};
