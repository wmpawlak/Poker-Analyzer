// src/views/MiscViews.jsx
import React, { useState, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { toggleSource, removeSource, setApiKey, verifyApiKey } from '../store/pokerSlice.js';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Filter, LayoutDashboard, Trophy, FileCode2, Trash2, Key, CheckCircle, AlertTriangle } from 'lucide-react';

// --- WIDOK PORTFELA ---
export const WalletView = () => {
  const { sessions } = useSelector((state) => state.poker);
  const [walletDateFrom, setWalletDateFrom] = useState('');
  const [walletDateTo, setWalletDateTo] = useState('');
  const [onlyFlop, setOnlyFlop] = useState(false);

  const walletData = useMemo(() => {
    let handsToProcess = [...sessions].sort((a, b) => a.startTime - b.startTime).flatMap(s => s.hands);
    if (walletDateFrom) handsToProcess = handsToProcess.filter(h => h.timestamp >= new Date(walletDateFrom).getTime());
    if (walletDateTo) handsToProcess = handsToProcess.filter(h => h.timestamp <= new Date(walletDateTo).getTime() + 86400000);
    
    if (onlyFlop) {
        handsToProcess = handsToProcess.filter(h => h.streets && h.streets.some(s => s.name === 'FLOP'));
    }

    let runningTotal = 0; let timeline = []; let posWinsMap = {}; 
    handsToProcess.forEach((hand, idx) => {
      runningTotal += hand.netProfit;
      timeline.push({ handIndex: idx + 1, profit: parseFloat(runningTotal.toFixed(2)), date: hand.dateStr });
      
      const pos = hand.position || 'UNKNOWN';
      if (pos !== 'UNKNOWN') {
        if (!posWinsMap[pos]) posWinsMap[pos] = { wins: 0, total: 0 };
        posWinsMap[pos].total += 1;
        if (hand.outcome === 'WON') posWinsMap[pos].wins += 1;
      }
    });

    const displayOrder = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];
    let positionFrequencyData = Object.keys(posWinsMap).map(pos => ({
       position: pos, 
       wins: posWinsMap[pos].wins, 
       total: posWinsMap[pos].total 
    })).sort((a, b) => (displayOrder.indexOf(a.position) > -1 ? displayOrder.indexOf(a.position) : 99) - (displayOrder.indexOf(b.position) > -1 ? displayOrder.indexOf(b.position) : 99));

    const maxPosHands = Math.max(...positionFrequencyData.map(d => d.total), 1);
    return { timeline, positionFrequencyData, maxPosHands, totalHands: handsToProcess.length, totalProfit: runningTotal };
  }, [sessions, walletDateFrom, walletDateTo, onlyFlop]);

  const getWinRateColor = (winRate) => {
    if (winRate >= 60) return 'bg-emerald-500 border-emerald-600';
    if (winRate >= 50) return 'bg-yellow-400 border-yellow-500 text-black';
    return 'bg-red-500 border-red-600';
  };

  if (sessions.length === 0) return <div className="text-center p-12 text-gray-500">Brak aktywnych danych z gier Cash do analizy.</div>;

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-center gap-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
        <Filter className="text-gray-400" size={20}/>
        <span className="font-bold text-gray-700">Filtry:</span>
        <input type="date" value={walletDateFrom} onChange={e => setWalletDateFrom(e.target.value)} className="border p-2 rounded text-sm"/>
        <input type="date" value={walletDateTo} onChange={e => setWalletDateTo(e.target.value)} className="border p-2 rounded text-sm"/>
        <button onClick={() => setOnlyFlop(!onlyFlop)} className={`px-4 py-2 rounded-lg text-sm font-bold border transition-all ${onlyFlop ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-white text-gray-600 border-gray-300'}`}>
            {onlyFlop ? '✓ Tylko ręce z flopem' : 'Pokaż wszystkie ręce'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Wykres zysków */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex flex-col h-96">
          <h3 className="text-lg font-bold text-gray-800 mb-4 shrink-0">Wykres zysków w czasie (Cash)</h3>
          <div className="flex-1 w-full relative">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={walletData.timeline}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="handIndex" stroke="#9ca3af" fontSize={11} minTickGap={30} />
                <YAxis stroke="#9ca3af" fontSize={11} domain={['auto', 'auto']} />
                <Tooltip />
                <Line type="monotone" dataKey="profit" stroke="#4f46e5" strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Skuteczność wg pozycji */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex flex-col h-96">
          <h3 className="text-lg font-bold text-gray-800 mb-6 shrink-0">Skuteczność wg. Pozycji {onlyFlop ? '(Tylko Flopy)' : '(Cash)'}</h3>
          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar flex flex-col gap-3">
            {walletData.positionFrequencyData.map(item => {
               const widthPercent = (item.total / walletData.maxPosHands) * 100;
               const winPercent = item.total > 0 ? (item.wins / item.total) * 100 : 0;
               return (
                 <div key={item.position} className="flex items-center gap-4">
                    <div className={`w-16 h-10 flex items-center justify-center font-black rounded-lg border shadow-sm text-xs text-white ${getWinRateColor(winPercent)}`}>
                      {item.position}
                    </div>
                    <div className="flex-1 flex items-center bg-slate-50 rounded-lg">
                        <div className="h-8 rounded-lg flex overflow-hidden shadow-inner border border-gray-200 relative" style={{ width: `${widthPercent}%`, minWidth: '140px' }}>
                           <div className="bg-emerald-500 h-full" style={{ width: `${winPercent}%` }} />
                           <div className="bg-rose-500 h-full" style={{ width: `${100 - winPercent}%` }} />
                           <div className="absolute inset-0 flex items-center px-3 text-[11px] font-black text-white z-10">{item.wins} W / {item.total} ({winPercent.toFixed(1)}%)</div>
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