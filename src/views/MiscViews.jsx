// src/views/MiscViews.jsx
import React, { useState, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { toggleSource, removeSource, setApiKey, verifyApiKey } from '../store/pokerSlice.js';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Filter, LayoutDashboard, Trophy, FileCode2, Trash2, Key, CheckCircle, AlertTriangle } from 'lucide-react';
// --- WIDOK PORTFELA ---
export const WalletView = () => {
  const { sessions } = useSelector((state) => state.poker);
  const [walletDateFrom, setWalletDateFrom] = useState('');
  const [walletDateTo, setWalletDateTo] = useState('');

  const walletData = useMemo(() => {
    let handsToProcess = [...sessions].sort((a, b) => a.startTime - b.startTime).flatMap(s => s.hands);
    if (walletDateFrom) handsToProcess = handsToProcess.filter(h => h.timestamp >= new Date(walletDateFrom).getTime());
    if (walletDateTo) handsToProcess = handsToProcess.filter(h => h.timestamp <= new Date(walletDateTo).getTime() + 86400000);

    let runningTotal = 0; let timeline = []; let posWinsMap = {}; let posLossesMap = {}; 
    handsToProcess.forEach((hand, idx) => {
      runningTotal += hand.netProfit;
      timeline.push({ handIndex: idx + 1, profit: parseFloat(runningTotal.toFixed(2)), date: hand.dateStr });
      
      const pos = hand.position || 'UNKNOWN';
      if (pos !== 'UNKNOWN') {
        if (posWinsMap[pos] === undefined) posWinsMap[pos] = 0;
        if (posLossesMap[pos] === undefined) posLossesMap[pos] = 0;
        if (hand.outcome === 'WON') posWinsMap[pos] += 1; else posLossesMap[pos] += 1;
      }
    });

    // Ustalona kolejność wyświetlania na liście
    const displayOrder = ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'HJ', 'CO'];
    
    let positionFrequencyData = [];
    Object.keys(posWinsMap).forEach(pos => {
       const w = posWinsMap[pos];
       const l = posLossesMap[pos];
       positionFrequencyData.push({ position: pos, wins: w, losses: l, total: w + l });
    });

    positionFrequencyData.sort((a, b) => {
       let idxA = displayOrder.indexOf(a.position);
       let idxB = displayOrder.indexOf(b.position);
       if (idxA === -1) idxA = 99;
       if (idxB === -1) idxB = 99;
       return idxA - idxB;
    });

    // Najwyższa wartość do wyliczenia relatywnej szerokości całej linii
    const maxPosHands = Math.max(...positionFrequencyData.map(d => d.total), 1);

    return { timeline, positionFrequencyData, maxPosHands, totalHands: handsToProcess.length, totalProfit: runningTotal };
  }, [sessions, walletDateFrom, walletDateTo]);

  if (sessions.length === 0) return <div className="text-center p-12 text-gray-500">Brak aktywnych danych z gier Cash do analizy.</div>;

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6 animate-in fade-in duration-300">
      <div className="flex items-center gap-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
        <Filter className="text-gray-400" size={20}/>
        <span className="font-bold text-gray-700">Filtruj daty:</span>
        <input type="date" value={walletDateFrom} onChange={e => setWalletDateFrom(e.target.value)} className="border p-2 rounded text-sm outline-none focus:ring-2 focus:ring-indigo-500"/>
        <span className="text-gray-400">-</span>
        <input type="date" value={walletDateTo} onChange={e => setWalletDateTo(e.target.value)} className="border p-2 rounded text-sm outline-none focus:ring-2 focus:ring-indigo-500"/>
        {(walletDateFrom || walletDateTo) && (<button onClick={()=>{setWalletDateFrom('');setWalletDateTo('');}} className="text-sm text-indigo-600 font-bold hover:underline">Resetuj</button>)}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
          <div className="text-sm font-semibold text-gray-500 mb-1">Wynik (Tylko Cash)</div>
          <div className={`text-3xl font-black ${walletData.totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{walletData.totalProfit >= 0 ? '+' : ''}₮{walletData.totalProfit.toFixed(2)}</div>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
          <div className="text-sm font-semibold text-gray-500 mb-1">Rozegranych Rozdań Cash</div>
          <div className="text-3xl font-black text-gray-800">{walletData.totalHands}</div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex flex-col h-96">
          <h3 className="text-lg font-bold text-gray-800 mb-4 shrink-0">Wykres zysków w czasie (Cash)</h3>
          <div className="flex-1 w-full relative">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={walletData.timeline}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="handIndex" stroke="#9ca3af" fontSize={11} minTickGap={30} />
                <YAxis stroke="#9ca3af" fontSize={11} domain={['auto', 'auto']} />
                <Tooltip />
                <ReferenceLine y={0} stroke="#111827" strokeWidth={2} opacity={0.3} />
                <Line type="monotone" dataKey="profit" stroke="#4f46e5" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        
        {/* NOWY, NIESTANDARDOWY WIDOK POZYCJI */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex flex-col h-96">
          <h3 className="text-lg font-bold text-gray-800 mb-6 shrink-0">Skuteczność wg. Pozycji (Cash)</h3>
          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar flex flex-col gap-3">
            {walletData.positionFrequencyData.map(item => {
               // Relatywna długość całego paska względem najczęstszej pozycji (częstotliwość występowania)
               const widthPercent = (item.total / walletData.maxPosHands) * 100;
               // Stosunek wygranych wewnątrz konkretnego paska
               const winPercent = item.total > 0 ? (item.wins / item.total) * 100 : 0;
               
               return (
                 <div key={item.position} className="flex items-center gap-4">
                    <div className="w-12 text-right font-black text-gray-700 text-sm shrink-0">{item.position}</div>
                    
                    <div className="flex-1 flex items-center bg-slate-50 rounded-lg">
                        <div 
                          className="h-8 rounded-lg flex overflow-hidden shadow-inner border border-gray-200 relative" 
                          style={{ width: `${widthPercent}%`, minWidth: '130px' }} // min-width zapobiega ucinaniu tekstu przy małej próbce
                        >
                           <div className="bg-emerald-500 h-full transition-all" style={{ width: `${winPercent}%` }} />
                           <div className="bg-rose-500 h-full transition-all" style={{ width: `${100 - winPercent}%` }} />
                           
                           <div className="absolute inset-0 flex items-center px-3 text-[11px] font-black text-white drop-shadow-md z-10 whitespace-nowrap">
                              {item.wins} W / {item.total} ({winPercent.toFixed(1)}%)
                           </div>
                        </div>
                    </div>
                 </div>
               )
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

// --- WIDOK ŹRÓDEŁ ---
const SourceItem = ({ src, dispatch }) => (
  <div className={`p-4 rounded-xl border flex items-center justify-between transition-colors ${src.enabled ? 'bg-white border-gray-200 shadow-sm' : 'bg-gray-50 border-gray-200 opacity-60'}`}>
    <div className="flex items-center gap-3">
      <FileCode2 className={src.enabled ? 'text-indigo-500' : 'text-gray-400'} size={24}/>
      <div className="flex flex-col">
        <span className="font-bold text-gray-800 text-sm truncate max-w-[150px] sm:max-w-xs">{src.filename}</span>
        <span className="text-xs text-gray-500">{new Date(src.dateAdded).toLocaleDateString()} {new Date(src.dateAdded).toLocaleTimeString()}</span>
      </div>
    </div>
    <div className="flex items-center gap-2">
      <button onClick={() => dispatch(toggleSource(src.id))} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-sm ${src.enabled ? 'bg-amber-50 text-amber-600 hover:bg-amber-100 border border-amber-200' : 'bg-green-50 text-green-600 hover:bg-green-100 border border-green-200'}`}>{src.enabled ? 'Wyłącz' : 'Włącz'}</button>
      <button onClick={() => dispatch(removeSource(src.id))} className="p-1.5 bg-red-50 text-red-500 hover:bg-red-100 hover:text-red-600 rounded-lg transition-colors border border-red-100 shadow-sm"><Trash2 size={16}/></button>
    </div>
  </div>
);

export const SourcesView = () => {
  const dispatch = useDispatch();
  const sources = useSelector(state => state.poker.sources);

  return (
    <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in duration-300">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex flex-col h-[calc(100vh-140px)]">
        <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-indigo-900 border-b pb-4"><LayoutDashboard className="text-indigo-600"/> Wgrane Pliki (Gry Cash)</h3>
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 flex flex-col gap-3">
          {sources.filter(s => s.type === 'Cash').length === 0 ? <div className="text-center p-8 text-gray-400 italic">Brak plików Cash w bazie.</div> : sources.filter(s => s.type === 'Cash').map(src => <SourceItem key={src.id} src={src} dispatch={dispatch} />)}
        </div>
      </div>
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex flex-col h-[calc(100vh-140px)]">
        <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-amber-900 border-b pb-4"><Trophy className="text-amber-600"/> Wgrane Pliki (Turnieje)</h3>
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 flex flex-col gap-3">
          {sources.filter(s => s.type === 'Tournament').length === 0 ? <div className="text-center p-8 text-gray-400 italic">Brak plików turniejowych w bazie.</div> : sources.filter(s => s.type === 'Tournament').map(src => <SourceItem key={src.id} src={src} dispatch={dispatch} />)}
        </div>
      </div>
    </div>
  );
};

// --- WIDOK USTAWIEŃ ---
export const SettingsView = () => {
  const dispatch = useDispatch();
  const { apiKey, apiStatus } = useSelector(state => state.poker);

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-6 animate-in fade-in duration-300">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200">
        <h3 className="text-xl font-bold mb-6 flex items-center gap-2 border-b pb-4"><Key className="text-indigo-600"/> Konfiguracja Gemini AI</h3>
        <div className="flex flex-col gap-4 max-w-2xl">
          <p className="text-sm text-gray-600">Wklej swój osobisty klucz API, aby umożliwić analizę rozdań przez asystenta AI.</p>
          <div className="flex items-center gap-3">
            <input type="password" placeholder="AIzaSyA..." value={apiKey} onChange={(e) => dispatch(setApiKey(e.target.value))} className="flex-1 border border-gray-300 rounded-xl px-4 py-3 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all font-mono text-sm" />
            <button onClick={() => dispatch(verifyApiKey(apiKey))} disabled={!apiKey || apiStatus === 'testing'} className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white px-6 py-3 rounded-xl font-bold shadow-md transition-all flex items-center gap-2">
              {apiStatus === 'testing' ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"/> : 'Testuj Połączenie'}
            </button>
          </div>
          {apiStatus === 'valid' && <div className="flex items-center gap-2 text-green-600 bg-green-50 p-3 rounded-lg border border-green-200 font-semibold text-sm"><CheckCircle size={18} /> Połączono pomyślnie! Trener AI jest gotowy do analizy rozdań.</div>}
          {apiStatus === 'invalid' && <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg border border-red-200 font-semibold text-sm"><AlertTriangle size={18} /> Odmowa dostępu. Klucz jest nieprawidłowy.</div>}
        </div>
      </div>
    </div>
  );
};