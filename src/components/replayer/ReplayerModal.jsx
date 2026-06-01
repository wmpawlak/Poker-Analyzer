// src/components/replayer/ReplayerModal.jsx
import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { selectHand, analyzeHandWithAI } from '../../store/pokerSlice.js';
import { CardIcon } from '../CardIcon.jsx';
import { X, Brain, FileText, Key, AlertTriangle, CheckCircle, Lightbulb } from 'lucide-react';

export const ReplayerModal = ({ handId, onClose }) => {
  const dispatch = useDispatch();
  const { rawHands, aiAnalyses, apiKey, loadingAI, errorAI } = useSelector((state) => state.poker);
  
  const [modalRightTab, setModalRightTab] = useState('ai');
  const [showAIComments, setShowAIComments] = useState(true);

  const modalHand = rawHands.find(h => h.id === handId);
  const currentAnalysis = modalHand ? aiAnalyses[modalHand.id] : null;

  if (!modalHand) return null;

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
                 <span className="text-xs text-slate-400 font-semibold mb-1">Wynik ({modalHand.handRanking})</span>
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
          <div className="flex items-center justify-between border-b border-gray-200 pb-4 mb-4 shrink-0">
            <div className="flex gap-4">
              <button onClick={() => setModalRightTab('ai')} className={`text-base font-bold flex items-center gap-1.5 transition-colors ${modalRightTab === 'ai' ? 'text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}><Brain size={18}/> AI Coach</button>
              <button onClick={() => setModalRightTab('raw')} className={`text-base font-bold flex items-center gap-1.5 transition-colors ${modalRightTab === 'raw' ? 'text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}><FileText size={18}/> Tekst Źródłowy</button>
            </div>
            {modalRightTab === 'ai' && (<label className="flex items-center gap-2 text-xs font-bold text-gray-600 cursor-pointer select-none"><input type="checkbox" checked={showAIComments} onChange={(e) => setShowAIComments(e.target.checked)} className="rounded text-indigo-600 accent-indigo-600 w-4 h-4 cursor-pointer" /> Pokaż Analizę</label>)}
          </div>
          
          {modalRightTab === 'raw' ? (
             <div className="flex-1 bg-slate-900 rounded-xl p-5 overflow-y-auto custom-scrollbar shadow-inner"><pre className="text-xs text-emerald-400 font-mono whitespace-pre-wrap leading-relaxed">{modalHand.rawText}</pre></div>
          ) : (
            <>
              {!apiKey ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-white border border-gray-200 rounded-xl shadow-sm"><Key size={40} className="text-gray-300 mb-4" /><p className="text-sm text-gray-500 mb-4">Skonfiguruj klucz API w ustawieniach, aby włączyć Trenera AI.</p></div>
              ) : !currentAnalysis && !loadingAI ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-indigo-200 rounded-xl bg-indigo-50/50"><Brain size={48} className="text-indigo-300 mb-4" /><p className="text-sm text-gray-600 mb-6">Kliknij, aby wygenerować komentarze krok-po-kroku do tego rozdania.</p><button onClick={() => { dispatch(selectHand(modalHand.id)); dispatch(analyzeHandWithAI({ handText: modalHand.rawText, apiKey })); setShowAIComments(true); }} className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-3 rounded-xl shadow-lg transition-all active:scale-95 w-full">Analizuj Rozdanie</button></div>
              ) : loadingAI ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center"><div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div><p className="text-indigo-600 font-semibold animate-pulse">Piszę komentarze...</p></div>
              ) : errorAI ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-red-50 border border-red-200 rounded-xl"><AlertTriangle size={40} className="text-red-400 mb-4" /><p className="text-xs text-red-600 mb-4">{errorAI}</p><button onClick={() => { dispatch(selectHand(modalHand.id)); dispatch(analyzeHandWithAI({ handText: modalHand.rawText, apiKey })); }} className="bg-red-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-red-700">Spróbuj Ponownie</button></div>
              ) : currentAnalysis && showAIComments ? (
                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar flex flex-col h-full animate-in fade-in duration-300">
                  {typeof currentAnalysis === 'string' ? (<div className="prose prose-sm prose-indigo leading-relaxed text-gray-700">{formatTextWithCards(currentAnalysis)}</div>) : (
                    <>
                      <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex-1">
                        <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2 border-b pb-2"><CheckCircle size={18} className="text-green-500"/> Ogólne Wnioski</h4>
                        <div className="text-sm text-gray-700 leading-relaxed font-medium">{formatTextWithCards(currentAnalysis.summary)}</div>
                        <div className="mt-6 p-4 bg-indigo-50 rounded-lg border border-indigo-100 flex gap-3"><Lightbulb className="text-indigo-400 shrink-0 mt-0.5" size={18}/><p className="text-xs text-indigo-800">Szczegółowe uwagi trenera do Twoich zagrań zostały przypięte do konkretnych akcji (Pre-flop, Flop itd.) po lewej stronie.</p></div>
                      </div>
                      <div className="mt-4 shrink-0"><button onClick={() => { dispatch(selectHand(modalHand.id)); dispatch(analyzeHandWithAI({ handText: modalHand.rawText, apiKey })); }} className="text-xs font-bold text-indigo-600 hover:text-indigo-800 w-full text-center p-3 border border-indigo-200 rounded-lg bg-indigo-50 transition-colors">Przeanalizuj ponownie</button></div>
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