// src/components/replayer/ReplayerModal.jsx
import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  analyzeHandWithAI,
  fetchHandAnalysisHistory,
  fetchOpenedHand,
  selectHand,
  toggleSavedHand,
} from '../../store/pokerSlice.js';
import { getAnalysisHistory } from '../../utils/handCollections.js';
import { CardIcon } from '../CardIcon.jsx';
import {
  AlertTriangle,
  Brain,
  CheckCircle,
  FileText,
  History,
  Lightbulb,
  Save,
  X,
} from 'lucide-react';

export const ReplayerModal = ({ handId, onClose }) => {
  const dispatch = useDispatch();
  const openedHandsById = useSelector((state) => state.poker.openedHandsById);
  const openedHandStatusById = useSelector((state) => state.poker.openedHandStatusById);
  const openedHandErrorById = useSelector((state) => state.poker.openedHandErrorById);
  const handAnalysisHistoryStatusById = useSelector((state) => state.poker.handAnalysisHistoryStatusById);
  const handAnalysisHistoryErrorById = useSelector((state) => state.poker.handAnalysisHistoryErrorById);
  const aiAnalyses = useSelector((state) => state.poker.aiAnalyses);
  const loadingAI = useSelector((state) => state.poker.loadingAI);
  const errorAI = useSelector((state) => state.poker.errorAI);
  const defaultAiModel = useSelector((state) => state.poker.defaultAiModel);
  const aiModels = useSelector((state) => state.poker.aiModels);
  const aiModelsStatus = useSelector((state) => state.poker.aiModelsStatus);
  const savedHandIds = useSelector((state) => state.poker.savedHandIds);
  const datasetRevision = useSelector((state) => state.poker.dataset.datasetRevision);
  
  const [modalRightTab, setModalRightTab] = useState('ai');
  const [showAIComments, setShowAIComments] = useState(true);
  const [selectedReportId, setSelectedReportId] = useState(null);

  const modalHand = openedHandsById[String(handId)];
  const handStatus = openedHandStatusById[String(handId)] || 'idle';
  const handError = openedHandErrorById[String(handId)];
  const analysisHistoryStatus = handAnalysisHistoryStatusById[String(handId)] || 'idle';
  const analysisHistoryError = handAnalysisHistoryErrorById[String(handId)];
  const analysisHistory = modalHand ? getAnalysisHistory(aiAnalyses[modalHand.id]) : [];
  const currentReport = analysisHistory.find((report) => report.reportId === selectedReportId)
    || analysisHistory.at(-1);
  const currentAnalysis = currentReport?.analysis;
  const isAnalysisStale = Boolean(
    currentReport?.datasetRevision
    && datasetRevision
    && currentReport.datasetRevision !== datasetRevision,
  );
  const isHandSaved = modalHand ? savedHandIds.includes(String(modalHand.id)) : false;
  const selectedModel = aiModels.find((model) => model.id === defaultAiModel);
  const canAnalyze = selectedModel?.configured === true;
  const selectedModelName = selectedModel?.name || defaultAiModel;
  const modelsAreLoading = aiModelsStatus === 'idle' || aiModelsStatus === 'loading';
  const handRankingTooltip = modalHand?.handRankingSource === 'VISIBLE_CARDS'
    ? 'Układ wyliczony lokalnie na podstawie widocznych kart.'
    : undefined;

  useEffect(() => {
    if (!modalHand && handStatus === 'idle') dispatch(fetchOpenedHand({ handId }));
  }, [dispatch, handId, handStatus, modalHand]);

  useEffect(() => {
    if (handId) dispatch(fetchHandAnalysisHistory({ handId }));
  }, [dispatch, handId]);

  if (!modalHand) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
        <div className="rounded-2xl bg-white p-6 text-sm font-semibold text-slate-600 shadow-2xl" onClick={(event) => event.stopPropagation()}>
          {handStatus === 'failed' ? (
            <div className="space-y-3 text-center">
              <p className="text-red-700">{handError}</p>
              <button type="button" onClick={onClose} className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-black text-white">Zamknij</button>
            </div>
          ) : 'Pobieranie szczegółów rozdania…'}
        </div>
      </div>
    );
  }

  const formatTextWithCards = (text) => {
    if (!text || typeof text !== 'string') return text;
    const parts = text.split(/\[(.*?)\]/);
    return parts.map((part, index) => {
      if (index % 2 === 1) {
        const cards = part.split(' ').filter(Boolean);
        if (cards.length > 0 && cards.every(c => /^[2-9TJQKA][cdhs]$/i.test(c))) {
          return (
            <span key={index} className="inline-flex items-center gap-0.5 mx-1 align-middle scale-90 -translate-y-[2px]">
              {cards.map((c, i) => <CardIcon key={i} cardStr={c} />)}
            </span>
          );
        }
        return `[${part}]`;
      }
      return part;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-6xl h-[90vh] flex flex-col md:flex-row overflow-hidden shadow-2xl animate-in fade-in zoom-in-95" onClick={e => e.stopPropagation()}>
        
        {/* LEWA KOLUMNA: ODTWARZACZ */}
        <div className="w-full md:w-3/5 p-0 overflow-y-auto border-r border-gray-200 bg-slate-900 flex flex-col custom-scrollbar">
          <div className="sticky top-0 bg-slate-900/95 backdrop-blur z-10 p-5 border-b border-slate-800 flex justify-between items-center shadow-md">
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-3">Replayer Rozdania</h2>
              <span className="text-xs text-slate-400 font-mono">ID: #{modalHand.id} {modalHand.isTournament && "(Turniej)"}</span>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full transition-colors"><X size={24} className="text-slate-400" /></button>
          </div>

          <div className="p-5 flex flex-col gap-5">
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex justify-between items-center shadow-inner">
               <div className="flex flex-col"><span className="text-xs text-slate-400 font-semibold mb-1">Karty Hero ({modalHand.position})</span><div className="flex gap-1">{(modalHand.heroCards || []).map((c,i) => <CardIcon key={i} cardStr={c} />)}</div></div>
               <div className="flex flex-col items-center"><span className="text-xs text-slate-400 font-semibold mb-1">Stół</span><div className="flex gap-1">{(modalHand.boardCards || []).length > 0 ? (modalHand.boardCards || []).map((c,i) => <CardIcon key={i} cardStr={c} />) : <span className="text-sm text-slate-500">-</span>}</div></div>
               <div className="flex flex-col text-right">
                 <span className="text-xs text-slate-400 font-semibold mb-1" title={handRankingTooltip}>Wynik ({modalHand.handRanking})</span>
                 <span className={`text-2xl font-black ${modalHand.netProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {modalHand.netProfit >= 0 ? `+${modalHand.isTournament ? '' : '₮'}${Math.abs(modalHand.netProfit).toLocaleString('en-US', {maximumFractionDigits: 2})}` : `-${modalHand.isTournament ? '' : '₮'}${Math.abs(modalHand.netProfit).toLocaleString('en-US', {maximumFractionDigits: 2})}`}
                 </span>
               </div>
            </div>

            {(modalHand.streets || []).map((street, idx) => {
              let aiKey = street.name === 'PRE-FLOP' ? 'preflop' : street.name.toLowerCase();
              const aiComment = currentAnalysis && typeof currentAnalysis === 'object' && currentAnalysis[aiKey];
              return (
                <div key={idx} className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-lg">
                  <div className="bg-slate-950/50 px-4 py-3 flex justify-between items-center border-b border-slate-700"><span className="font-bold text-slate-200 tracking-wider text-sm">{street.name}</span><div className="flex gap-1">{(street.cards || []).map((c, i) => <CardIcon key={i} cardStr={c} />)}</div></div>
                  <div className="flex flex-col text-xs font-mono">
                    {(street.lines || []).map((line, lIdx) => {
                      const isHero = line.startsWith('Hero:');
                      const parts = line.split(':');
                      if (parts.length < 2) return <div key={lIdx} className="text-gray-400 px-3 py-1.5 flex items-center flex-wrap gap-1">{formatTextWithCards(line)}</div>;
                      const name = parts[0]; const actionStr = parts.slice(1).join(':').trim();
                      let actionColor = "text-slate-300";
                      if (actionStr.includes('folds')) actionColor = "text-red-400 opacity-60"; else if (actionStr.includes('calls') || actionStr.includes('checks')) actionColor = "text-green-400"; else if (actionStr.includes('raises') || actionStr.includes('bets') || actionStr.includes('ALLIN')) actionColor = "text-orange-400 font-bold";
                      return (
                        <div key={lIdx} className={`flex justify-between items-center px-3 py-2 border-b border-slate-700/50 last:border-0 ${isHero ? 'bg-indigo-900/30' : ''}`}><span className={`font-semibold ${isHero ? 'text-indigo-300' : 'text-slate-400'}`}>{name}</span><span className={`flex items-center flex-wrap gap-1 ${actionColor}`}>{formatTextWithCards(actionStr)}</span></div>
                      );
                    })}
                  </div>
                  {showAIComments && aiComment && aiComment !== 'null' && (
                    <div className="bg-indigo-900/40 border-t border-indigo-500/30 p-4 flex gap-3 animate-in slide-in-from-top-2 duration-300"><Lightbulb className="text-indigo-400 shrink-0 mt-0.5" size={18} /><div className="text-sm text-indigo-100 font-sans leading-relaxed">{formatTextWithCards(aiComment)}</div></div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* PRAWA KOLUMNA: TRENER AI & TEKST */}
        <div className="w-full md:w-2/5 p-6 bg-slate-50 flex flex-col relative h-full">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-4 mb-4 shrink-0">
            <div className="flex gap-4">
              <button onClick={() => setModalRightTab('ai')} className={`text-base font-bold flex items-center gap-1.5 transition-colors ${modalRightTab === 'ai' ? 'text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}><Brain size={18}/> AI Coach</button>
              <button onClick={() => setModalRightTab('raw')} className={`text-base font-bold flex items-center gap-1.5 transition-colors ${modalRightTab === 'raw' ? 'text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}><FileText size={18}/> Tekst Źródłowy</button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label={isHandSaved ? 'Usuń rękę z zapisanych' : 'Zapisz rękę'}
                title={isHandSaved ? 'Usuń z zapisanych rąk' : 'Zapisz rękę'}
                onClick={() => dispatch(toggleSavedHand(modalHand.id))}
                className={`p-2 rounded-lg border transition-colors ${
                  isHandSaved
                    ? 'border-emerald-300 bg-emerald-100 text-emerald-700'
                    : 'border-gray-200 bg-white text-gray-500 hover:border-indigo-300 hover:text-indigo-600'
                }`}
              >
                <Save size={17}/>
              </button>
              {modalRightTab === 'ai' && (
                <label className="flex items-center gap-2 text-xs font-bold text-gray-600 cursor-pointer select-none">
                  <input type="checkbox" checked={showAIComments} onChange={(e) => setShowAIComments(e.target.checked)} className="rounded text-indigo-600 accent-indigo-600 w-4 h-4 cursor-pointer" />
                  Pokaż Analizę
                </label>
              )}
            </div>
          </div>

          {modalRightTab === 'ai' && (
            <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 shrink-0">
              <label htmlFor="analysis-history" className="mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-gray-500">
                <History size={15} className="text-indigo-500"/>
                Historia analiz ({analysisHistory.length})
              </label>
              <select
                id="analysis-history"
                value={currentReport?.reportId || ''}
                disabled={analysisHistory.length === 0}
                onChange={(event) => setSelectedReportId(event.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-slate-50 px-3 py-2.5 text-xs font-bold text-gray-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:text-gray-400"
              >
                {analysisHistory.length === 0 ? (
                  <option value="">Brak analiz tego rozdania</option>
                ) : (
                  [...analysisHistory].reverse().map((report) => (
                    <option key={report.reportId} value={report.reportId}>
                      {report.model?.name || 'Nieznany model'} — {new Date(report.analyzedAt).toLocaleString('pl-PL')}
                    </option>
                  ))
                )}
              </select>
              <p className="mt-2 text-[11px] text-gray-500">
                {analysisHistoryStatus === 'loading'
                  ? 'Odzyskiwanie zapisanej historii analiz…'
                  : <>Nowa analiza zostanie wykonana modelem <strong>{selectedModelName}</strong> i dopisana do historii.</>}
              </p>
              {analysisHistoryStatus === 'failed' && <p role="alert" className="mt-2 text-[11px] font-semibold text-red-700">{analysisHistoryError}</p>}
              {isAnalysisStale && <p role="status" className="mt-2 text-[11px] font-semibold text-amber-800">Ten raport dotyczy wcześniejszej rewizji datasetu.</p>}
            </div>
          )}
          
          {modalRightTab === 'raw' ? (
             <div className="flex-1 bg-slate-900 rounded-xl p-5 overflow-y-auto custom-scrollbar shadow-inner"><pre className="text-xs text-emerald-400 font-mono whitespace-pre-wrap leading-relaxed">{modalHand.rawText}</pre></div>
          ) : (
            <>
              {loadingAI ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center"><div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div><p className="text-indigo-600 font-semibold animate-pulse">Piszę komentarze...</p></div>
              ) : errorAI ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-red-50 border border-red-200 rounded-xl"><AlertTriangle size={40} className="text-red-400 mb-4" /><p className="text-xs text-red-600 mb-4">{typeof errorAI === 'string' ? errorAI : errorAI.message}</p>{errorAI?.code === 'DATASET_REVISION_MISMATCH' && <p className="mb-4 text-xs font-semibold text-amber-800">Dataset został odświeżony. Ponów działanie ręcznie.</p>}<button disabled={!canAnalyze} onClick={() => { setSelectedReportId(null); dispatch(selectHand(modalHand.id)); dispatch(analyzeHandWithAI({ handId: modalHand.id })); }} className="bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-xs font-bold">Spróbuj Ponownie</button></div>
              ) : !currentAnalysis ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-indigo-200 rounded-xl bg-indigo-50/50">
                  <Brain size={48} className="text-indigo-300 mb-4" />
                  <p className="text-sm text-gray-600 mb-2">Kliknij, aby wygenerować komentarze krok-po-kroku do tego rozdania.</p>
                  {!canAnalyze && (
                    <p className="text-xs text-amber-700 mb-5">
                      {modelsAreLoading ? 'Trwa sprawdzanie konfiguracji modeli…' : `Model ${selectedModelName} nie ma skonfigurowanego klucza.`}
                    </p>
                  )}
                  <button disabled={!canAnalyze} onClick={() => { setSelectedReportId(null); dispatch(selectHand(modalHand.id)); dispatch(analyzeHandWithAI({ handId: modalHand.id })); setShowAIComments(true); }} className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold px-6 py-3 rounded-xl shadow-lg transition-all active:scale-95 w-full">Analizuj Rozdanie</button>
                </div>
              ) : currentAnalysis && showAIComments ? (
                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar flex flex-col h-full animate-in fade-in duration-300">
                  {typeof currentAnalysis === 'string' ? (<div className="prose prose-sm prose-indigo leading-relaxed text-gray-700">{formatTextWithCards(currentAnalysis)}</div>) : (
                    <>
                      <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex-1">
                        <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2 border-b pb-2"><CheckCircle size={18} className="text-green-500"/> Ogólne Wnioski</h4>
                        <div className="text-sm text-gray-700 leading-relaxed font-medium">{formatTextWithCards(currentAnalysis.summary)}</div>
                        <div className="mt-6 p-4 bg-indigo-50 rounded-lg border border-indigo-100 flex gap-3"><Lightbulb className="text-indigo-400 shrink-0 mt-0.5" size={18}/><p className="text-xs text-indigo-800">Szczegółowe uwagi trenera do Twoich zagrań zostały przypięte do konkretnych akcji (Pre-flop, Flop itd.) po lewej stronie.</p></div>
                      </div>
                      <div className="mt-4 shrink-0">
                        {!canAnalyze && (
                          <p className="text-xs text-amber-700 text-center mb-2">
                            {modelsAreLoading ? 'Trwa sprawdzanie konfiguracji modeli…' : `Model ${selectedModelName} nie ma skonfigurowanego klucza.`}
                          </p>
                        )}
                        <button disabled={!canAnalyze} onClick={() => { setSelectedReportId(null); dispatch(selectHand(modalHand.id)); dispatch(analyzeHandWithAI({ handId: modalHand.id })); }} className="text-xs font-bold text-indigo-600 hover:text-indigo-800 disabled:text-gray-400 disabled:bg-gray-100 disabled:cursor-not-allowed w-full text-center p-3 border border-indigo-200 rounded-lg bg-indigo-50 transition-colors">Przeanalizuj ponownie modelem {selectedModelName}</button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border border-gray-200 rounded-xl bg-white shadow-sm"><Brain size={40} className="text-gray-300 mb-4" /><p className="text-sm text-gray-500">Analiza AI jest obecnie ukryta.</p><p className="text-xs text-gray-400 mt-2">Użyj przełącznika w prawym górnym rogu, aby ją wyświetlić.</p></div>
              )}
            </>
          )}
        </div>

      </div>
    </div>
  );
};
