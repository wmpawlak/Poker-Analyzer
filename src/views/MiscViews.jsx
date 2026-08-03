// src/views/MiscViews.jsx
import { useState, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  LOCAL_SOURCE_ORIGIN,
  fetchAiModels,
  removeSource,
  setDefaultAiModel,
  syncLocalSources,
  toggleSource,
} from '../store/pokerSlice.js';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  AlertTriangle,
  CheckCircle,
  Filter,
  LayoutDashboard,
  Trophy,
  FileCode2,
  Trash2,
  Key,
  RefreshCw,
} from 'lucide-react';

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
const formatFileSize = (size) => {
  if (!Number.isFinite(size) || size < 0) return 'Rozmiar nieznany';
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 ** 2).toFixed(1)} MB`;
};

const formatModifiedAt = (modifiedAt) => {
  const date = new Date(modifiedAt);
  return Number.isNaN(date.getTime()) ? 'Data nieznana' : date.toLocaleString('pl-PL');
};

const SourceItem = ({ src, dispatch }) => {
  const isLocal = src.origin === LOCAL_SOURCE_ORIGIN;

  return (
    <div className={`p-4 rounded-xl border flex items-center justify-between gap-3 transition-colors ${src.enabled ? 'bg-white border-gray-200 shadow-sm' : 'bg-gray-50 border-gray-200 opacity-60'}`}>
      <div className="flex items-center gap-3 min-w-0">
        <FileCode2 className={src.enabled ? 'text-indigo-500 shrink-0' : 'text-gray-400 shrink-0'} size={24}/>
        <div className="flex flex-col min-w-0">
          <span className="font-bold text-gray-800 text-sm truncate" title={src.filename}>{src.filename}</span>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${isLocal ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>
              {isLocal ? 'Lokalny' : 'Wgrany ręcznie'}
            </span>
            <span className="text-xs text-gray-500">{formatFileSize(src.size)}</span>
          </div>
          <span className="text-[11px] text-gray-500 mt-1">Zmodyfikowano: {formatModifiedAt(src.modifiedAt || src.dateAdded)}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button onClick={() => dispatch(toggleSource(src.id))} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-sm ${src.enabled ? 'bg-amber-50 text-amber-600 hover:bg-amber-100 border border-amber-200' : 'bg-green-50 text-green-600 hover:bg-green-100 border border-green-200'}`}>{src.enabled ? 'Wyłącz' : 'Włącz'}</button>
        {!isLocal && (
          <button
            type="button"
            aria-label={`Usuń ${src.filename}`}
            onClick={() => dispatch(removeSource(src.id))}
            className="p-1.5 bg-red-50 text-red-500 hover:bg-red-100 hover:text-red-600 rounded-lg transition-colors border border-red-100 shadow-sm"
          >
            <Trash2 size={16}/>
          </button>
        )}
      </div>
    </div>
  );
};

export const SourcesView = () => {
  const dispatch = useDispatch();
  const { sources, localSourcesStatus, localSourcesError } = useSelector(state => state.poker);
  const cashSources = sources.filter((source) => source.type === 'Cash');
  const tournamentSources = sources.filter((source) => source.type === 'Tournament');
  const isLoading = localSourcesStatus === 'loading';

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-4 animate-in fade-in duration-300">
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-gray-800">Lokalny katalog danych</h3>
          <p className="text-xs text-gray-500 mt-1">Pliki z katalogu data mają pierwszeństwo przed plikami wgranymi ręcznie.</p>
        </div>
        <button
          type="button"
          onClick={() => dispatch(syncLocalSources())}
          disabled={isLoading}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors"
        >
          <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''}/>
          {isLoading ? 'Odświeżanie…' : 'Odśwież dane lokalne'}
        </button>
      </div>

      {localSourcesStatus === 'failed' && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
          Nie udało się odświeżyć danych lokalnych: {localSourcesError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex flex-col h-[calc(100vh-240px)] min-h-80">
          <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-indigo-900 border-b pb-4"><LayoutDashboard className="text-indigo-600"/> Pliki gier Cash</h3>
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 flex flex-col gap-3">
            {cashSources.length === 0 ? <div className="text-center p-8 text-gray-400 italic">Brak plików Cash w bazie.</div> : cashSources.map(src => <SourceItem key={src.id} src={src} dispatch={dispatch} />)}
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex flex-col h-[calc(100vh-240px)] min-h-80">
          <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-amber-900 border-b pb-4"><Trophy className="text-amber-600"/> Pliki turniejowe</h3>
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 flex flex-col gap-3">
            {tournamentSources.length === 0 ? <div className="text-center p-8 text-gray-400 italic">Brak plików turniejowych w bazie.</div> : tournamentSources.map(src => <SourceItem key={src.id} src={src} dispatch={dispatch} />)}
          </div>
        </div>
      </div>
    </div>
  );
};

// --- WIDOK USTAWIEŃ ---
export const SettingsView = () => {
  const dispatch = useDispatch();
  const {
    aiModels,
    aiModelsError,
    aiModelsStatus,
    defaultAiModel,
  } = useSelector((state) => state.poker);
  const isLoading = aiModelsStatus === 'loading';

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-6 animate-in fade-in duration-300">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
          <h3 className="text-xl font-bold flex items-center gap-2"><Key className="text-indigo-600"/> Konfiguracja Trenera AI</h3>
          <button
            type="button"
            onClick={() => dispatch(fetchAiModels())}
            disabled={isLoading}
            className="px-3 py-2 rounded-lg border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''}/>
            Odśwież status
          </button>
        </div>
        <div className="flex flex-col gap-5 max-w-2xl">
          <p className="text-sm text-gray-600">
            Klucze dostawców są odczytywane wyłącznie przez lokalny serwer z pliku <code>.env.local</code>.
            Nie są zapisywane w przeglądarce ani wysyłane do interfejsu.
          </p>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-bold text-gray-800 mb-2">Domyślny model analizy</legend>
            {isLoading && (
              <div role="status" className="text-sm text-indigo-600 flex items-center gap-2">
                <RefreshCw size={16} className="animate-spin"/> Pobieranie konfiguracji modeli…
              </div>
            )}
            {aiModels.map((model) => {
              const isSelected = defaultAiModel === model.id;
              return (
                <label
                  key={model.id}
                  className={`flex items-center justify-between gap-4 rounded-xl border p-4 transition-colors ${
                    model.configured
                      ? 'cursor-pointer hover:border-indigo-300 bg-white'
                      : 'cursor-not-allowed bg-gray-50 text-gray-400'
                  } ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-100' : 'border-gray-200'}`}
                >
                  <span className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="default-ai-model"
                      value={model.id}
                      checked={isSelected}
                      disabled={!model.configured}
                      onChange={() => dispatch(setDefaultAiModel(model.id))}
                      className="w-4 h-4 accent-indigo-600"
                    />
                    <span>
                      <span className="block text-sm font-bold text-gray-800">{model.name}</span>
                      <span className="block text-xs mt-1">{model.id}</span>
                    </span>
                  </span>
                  <span className={`text-xs font-bold flex items-center gap-1.5 ${model.configured ? 'text-green-600' : 'text-gray-400'}`}>
                    {model.configured ? <CheckCircle size={16}/> : <AlertTriangle size={16}/>}
                    {model.configured ? 'Skonfigurowany' : 'Brak klucza'}
                  </span>
                </label>
              );
            })}
          </fieldset>

          {aiModelsStatus === 'failed' && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-start gap-2">
              <AlertTriangle size={18} className="shrink-0 mt-0.5"/>
              {aiModelsError}
            </div>
          )}

          <p className="text-xs text-gray-500">
            Aplikacja zapamiętuje w przeglądarce wyłącznie identyfikator wybranego modelu.
            Model bez odpowiedniego klucza pozostaje widoczny, ale nie można go użyć.
          </p>
        </div>
      </div>
    </div>
  );
};
