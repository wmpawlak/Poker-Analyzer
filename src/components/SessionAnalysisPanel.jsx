import { useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AlertTriangle, Brain, History, Play } from 'lucide-react';
import { buildSessionAnalysisInput } from '../ai/sessionAnalysisContract.js';
import { analyzeSessionWithAI } from '../store/pokerSlice.js';

const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'nieznana data' : date.toLocaleString('pl-PL');
};

export const SessionAnalysisPanel = ({ sessionId, hands, gameType, onHandClick, accent = 'indigo' }) => {
  const dispatch = useDispatch();
  const {
    defaultAiModel,
    aiModels,
    aiModelsStatus,
    sessionAiAnalyses,
    sessionAnalysisStatusById,
    sessionAnalysisErrorById,
  } = useSelector((state) => state.poker);
  const [selectedReportId, setSelectedReportId] = useState(null);
  const input = useMemo(() => buildSessionAnalysisInput({ sessionId, hands, gameType }), [sessionId, hands, gameType]);
  const history = sessionAiAnalyses[sessionId] || [];
  const latestCurrentReport = [...history].reverse().find((report) => report.fingerprint === input.fingerprint);
  const selectedReport = history.find((report) => report.reportId === selectedReportId);
  const currentReport = selectedReport || latestCurrentReport || history.at(-1) || null;
  const isStale = Boolean(currentReport && currentReport.fingerprint !== input.fingerprint);
  const status = sessionAnalysisStatusById[sessionId] || 'idle';
  const error = sessionAnalysisErrorById[sessionId];
  const errorMessage = typeof error === 'string' ? error : error?.message;
  const errorCode = typeof error === 'object' ? error?.code : undefined;
  const selectedModel = aiModels.find((model) => model.id === defaultAiModel);
  const canAnalyze = selectedModel?.configured === true;
  const modelsLoading = aiModelsStatus === 'idle' || aiModelsStatus === 'loading';
  const availableHandIds = new Set(input.hands.map((hand) => hand.id));
  const accentClasses = accent === 'amber'
    ? 'border-amber-200 bg-amber-50 text-amber-950'
    : 'border-indigo-200 bg-indigo-50 text-indigo-950';

  const triggerAnalysis = () => {
    setSelectedReportId(null);
    dispatch(analyzeSessionWithAI({ sessionId, hands, gameType }));
  };

  return (
    <section data-testid="session-analysis-panel" className={`rounded-xl border p-4 ${accentClasses}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-black"><Brain size={18}/> Analiza AI sesji</div>
          <p className="mt-1 text-xs opacity-75">Jeden raport obejmuje wszystkie {input.hands.length} prawdziwe rozdania wybranej sesji.</p>
        </div>
        {input.hands.length < 30 && (
          <span data-testid="session-analysis-low-sample" className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-amber-900"><AlertTriangle size={13}/> Mała próba: poniżej 30 rąk</span>
        )}
      </div>

      {history.length > 0 && (
        <div className="mt-3 rounded-lg border border-white/80 bg-white/75 p-3">
          <label className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide opacity-65" htmlFor={`session-analysis-history-${sessionId}`}><History size={14}/> Historia raportów ({history.length})</label>
          <select id={`session-analysis-history-${sessionId}`} value={currentReport?.reportId || ''} onChange={(event) => setSelectedReportId(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-bold text-slate-700 outline-none">
            {[...history].reverse().map((report) => (
              <option key={report.reportId} value={report.reportId}>{report.model?.name || 'Nieznany model'} — {formatDate(report.analyzedAt)}{report.fingerprint === input.fingerprint ? ' (aktualny zestaw)' : ' (wcześniejszy zestaw)'}</option>
            ))}
          </select>
        </div>
      )}

      {status === 'loading' ? (
        <div className="mt-4 flex items-center gap-3 rounded-lg bg-white/75 p-4 text-sm font-bold"><span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent"/> Generowanie jednego raportu sesji…</div>
      ) : errorMessage ? (
        <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p>{errorMessage}</p>
          <button type="button" disabled={!canAnalyze} onClick={triggerAnalysis} className="mt-3 rounded-lg bg-red-600 px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300">{errorCode === 'AI_INCOMPLETE_RESPONSE' ? 'Spróbuj ponownie — nowe płatne żądanie' : 'Spróbuj ponownie'}</button>
        </div>
      ) : !currentReport ? (
        <div className="mt-4 rounded-lg border border-dashed border-current/20 bg-white/60 p-4 text-sm">
          <p>Raport nie został jeszcze wygenerowany ręcznie.</p>
          {!canAnalyze && <p className="mt-2 text-xs text-amber-800">{modelsLoading ? 'Sprawdzanie konfiguracji modeli…' : `Model ${selectedModel?.name || defaultAiModel} nie ma skonfigurowanego klucza.`}</p>}
          <button type="button" disabled={!canAnalyze} onClick={triggerAnalysis} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-black text-white shadow-sm disabled:cursor-not-allowed disabled:bg-slate-300"><Brain size={15}/> Analizuj sesję</button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {isStale && <div role="status" className="rounded-lg border border-amber-300 bg-amber-100 p-3 text-xs font-semibold text-amber-900">Ten raport powstał dla wcześniejszego zestawu danych sesji.</div>}
          <div className="rounded-lg bg-white/80 p-3 text-sm text-slate-700"><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{currentReport.model?.name || 'Nieznany model'} · {formatDate(currentReport.analyzedAt)} · styl {currentReport.analysis.profileStyleId}</p><p className="mt-2 leading-relaxed">{currentReport.analysis.sessionSummary}</p></div>
          {currentReport.analysis.keyMistakes?.length > 0 && <div className="rounded-lg bg-white/80 p-3"><h4 className="text-xs font-black uppercase tracking-wide text-slate-700">Powtarzalne błędy</h4><div className="mt-2 space-y-3">{currentReport.analysis.keyMistakes.map((mistake, index) => <article key={`${mistake.title}-${index}`} className="border-l-2 border-red-300 pl-3 text-xs text-slate-700"><p className="font-black">{mistake.title}</p><p className="mt-1">{mistake.description}</p><p className="mt-1 font-semibold text-emerald-800">Korekta: {mistake.correction}</p><div className="mt-2 flex flex-wrap gap-1">{mistake.handIds.map((handId) => <button key={handId} type="button" disabled={!availableHandIds.has(handId)} title={availableHandIds.has(handId) ? `Otwórz rozdanie #${handId}` : 'Rozdanie nie jest już dostępne w aktualnych danych.'} onClick={() => onHandClick?.(handId)} className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-bold text-indigo-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"><Play size={11}/> #{handId}</button>)}</div></article>)}</div></div>}
          {currentReport.analysis.notableHands?.length > 0 && <div className="rounded-lg bg-white/80 p-3"><h4 className="text-xs font-black uppercase tracking-wide text-slate-700">Ważne rozdania</h4><div className="mt-2 space-y-2">{currentReport.analysis.notableHands.map((hand) => <div key={hand.handId} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700"><span>{hand.reason}</span><button type="button" disabled={!availableHandIds.has(hand.handId)} title={availableHandIds.has(hand.handId) ? `Otwórz rozdanie #${hand.handId}` : 'Rozdanie nie jest już dostępne w aktualnych danych.'} onClick={() => onHandClick?.(hand.handId)} className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-bold text-indigo-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"><Play size={11}/> #{hand.handId}</button></div>)}</div></div>}
          <button type="button" disabled={!canAnalyze} onClick={triggerAnalysis} className="w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-black text-indigo-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400">Przeanalizuj ponownie modelem {selectedModel?.name || defaultAiModel}</button>
        </div>
      )}
    </section>
  );
};
