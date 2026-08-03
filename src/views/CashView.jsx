// src/views/CashView.jsx
import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { selectSession } from '../store/pokerSlice.js';
import { HandCollectionTabs } from '../components/HandCollectionTabs.jsx';
import { HandTile } from '../components/HandTile.jsx';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Filter } from 'lucide-react';
import { getAvailableHandRanks, getFilteredSessions, getSelectedEntityId, getVisibleHands } from '../utils/handFilters.js';
import { getAnalyzedHands, getSavedHands, sortHands } from '../utils/handCollections.js';

export const CashView = ({ onHandClick }) => {
  const dispatch = useDispatch();
  const {
    aiAnalyses,
    rawHands,
    savedHandIds,
    sessions,
    selectedSessionId,
  } = useSelector(state => state.poker);

  const [collectionMode, setCollectionMode] = useState('session');
  const [handsFilterRank, setHandsFilterRank] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [sortOrder, setSortOrder] = useState('desc');
  const [handsSortBy, setHandsSortBy] = useState('date');
  const [handsSortOrder, setHandsSortOrder] = useState('desc');

  const availableRanks = useMemo(() => getAvailableHandRanks(sessions), [sessions]);
  const cashHands = useMemo(
    () => rawHands.filter((hand) => !hand.isTournament && !hand.isRebuy),
    [rawHands],
  );
  const analyzedCashHands = useMemo(
    () => getAnalyzedHands(cashHands, aiAnalyses),
    [aiAnalyses, cashHands],
  );
  const savedCashHands = useMemo(
    () => getSavedHands(cashHands, savedHandIds),
    [cashHands, savedHandIds],
  );

  const filteredSessions = useMemo(() => {
    return getFilteredSessions(sessions, handsFilterRank);
  }, [sessions, handsFilterRank]);

  const sortedSessions = [...filteredSessions].sort((a, b) => {
    let valA = sortBy === 'date' ? a.startTime : a.totalProfit;
    let valB = sortBy === 'date' ? b.startTime : b.totalProfit;
    return sortOrder === 'desc' ? valB - valA : valA - valB;
  });

  useEffect(() => {
    const nextSessionId = getSelectedEntityId(sortedSessions, selectedSessionId);
    if (nextSessionId !== selectedSessionId) dispatch(selectSession(nextSessionId));
  }, [dispatch, selectedSessionId, sortedSessions]);

  const currentSession = sortedSessions.find(s => s.id === selectedSessionId);

  const visibleHands = useMemo(() => {
    if (!currentSession) return [];
    const hands = getVisibleHands(currentSession, handsFilterRank);
    return sortHands(hands, handsSortBy, handsSortOrder);
  }, [currentSession, handsFilterRank, handsSortBy, handsSortOrder]);

  const collectionHands = useMemo(() => {
    const source = collectionMode === 'analyzed' ? analyzedCashHands : savedCashHands;
    const filtered = handsFilterRank
      ? source.filter((hand) => hand.handRanking === handsFilterRank)
      : source;
    return sortHands(filtered, handsSortBy, handsSortOrder);
  }, [
    analyzedCashHands,
    collectionMode,
    handsFilterRank,
    handsSortBy,
    handsSortOrder,
    savedCashHands,
  ]);
  const isCollectionView = collectionMode !== 'session';
  const collectionTitle = collectionMode === 'analyzed' ? 'Rozdania z analizą' : 'Zapisane ręce';
  const collectionDescription = collectionMode === 'analyzed'
    ? 'Wszystkie przeanalizowane rozdania Cash ze wszystkich sesji.'
    : 'Wszystkie zapisane rozdania Cash ze wszystkich sesji.';

  return (
    <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in duration-300 h-[calc(100vh-140px)]">
      {/* LEWA KOLUMNA: Lista Sesji */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200 flex flex-col gap-4 h-full">
        <HandCollectionTabs
          mode={collectionMode}
          onChange={setCollectionMode}
          analyzedCount={analyzedCashHands.length}
          savedCount={savedCashHands.length}
        />
        <div className="relative shrink-0">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18}/>
          <select value={handsFilterRank} onChange={(e) => setHandsFilterRank(e.target.value)} className="w-full bg-slate-50 border border-gray-200 rounded-xl py-2.5 pl-10 pr-4 outline-none text-sm font-semibold text-gray-700 cursor-pointer">
            <option value="">Wszystkie układy...</option>
            {availableRanks.map(rank => <option key={rank.id} value={rank.id}>{rank.label}</option>)}
          </select>
        </div>
        {filteredSessions.length === 0 ? <div className="text-center p-8 text-gray-400">Brak sesji Cash. Wgraj pliki.</div> : (
          <>
            <div className="flex justify-between items-center bg-slate-50 p-2.5 rounded-lg text-xs gap-2 border border-gray-100 shrink-0">
              <div className="text-gray-500">Sortuj sesje: <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="bg-transparent font-bold"><option value="date">Datą</option><option value="profit">Wynikiem</option></select></div>
              <div className="text-gray-500">Kolejność: <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="bg-transparent font-bold"><option value="desc">Malejąco</option><option value="asc">Rosnąco</option></select></div>
            </div>
            <div className="flex-1 overflow-y-auto flex flex-col gap-2.5 pr-2 custom-scrollbar">
              {sortedSessions.map((session) => (
                <button key={session.id} onClick={() => { setCollectionMode('session'); dispatch(selectSession(session.id)); }} className={`w-full text-left p-4 rounded-xl border transition-all flex flex-col ${collectionMode === 'session' && selectedSessionId === session.id ? 'border-indigo-600 bg-indigo-50 shadow-md ring-2 ring-indigo-100' : 'border-gray-200 hover:bg-slate-50'}`}>
                  <div className="flex justify-between items-center font-semibold text-sm w-full">
                    <span className="text-gray-900 truncate" title={`Stół: ${session.tableId}`}>Stół #{session.tableId} <span className="text-gray-400 text-xs font-normal ml-2">({session.dateStr})</span></span>
                    <span className={`font-mono text-base tracking-tight shrink-0 ml-2 ${session.totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{session.totalProfit >= 0 ? '+' : ''}₮{session.totalProfit.toFixed(2)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between w-full">
                    <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Rozdania: {session.hands.filter(h => !h.isRebuy).length}</span>
                    {handsFilterRank && <span className="text-[10px] text-indigo-600 font-bold bg-indigo-100/50 px-2 py-0.5 rounded shadow-sm">Pasujące ręce: {session.hands.filter(h => h.handRanking === handsFilterRank).length}</span>}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* PRAWA KOLUMNA: Wykres i Ręce */}
      <div className="lg:col-span-2 flex flex-col gap-6 h-full overflow-y-auto pr-2 custom-scrollbar">
        {isCollectionView ? (
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200 flex-1 flex flex-col min-h-0">
            <div className="flex flex-wrap justify-between items-center gap-3 border-b border-gray-100 pb-3 mb-4 shrink-0">
              <div>
                <h3 className="text-base font-bold text-gray-800">{collectionTitle}</h3>
                <p className="text-xs text-gray-500 mt-1">{collectionDescription}</p>
              </div>
              <div className="flex bg-slate-50 p-2 rounded-xl text-xs gap-3 border border-gray-200">
                <div className="text-gray-500">Sortuj: <select value={handsSortBy} onChange={(e) => setHandsSortBy(e.target.value)} className="bg-transparent font-bold cursor-pointer outline-none"><option value="date">Datą</option><option value="profit">Wynikiem</option></select></div>
                <div className="text-gray-500">Kolejność: <select value={handsSortOrder} onChange={(e) => setHandsSortOrder(e.target.value)} className="bg-transparent font-bold cursor-pointer outline-none"><option value="desc">Malejąco</option><option value="asc">Rosnąco</option></select></div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto flex flex-col pr-2 custom-scrollbar">
              {collectionHands.length > 0
                ? collectionHands.map((hand) => <HandTile key={hand.id} hand={hand} onClick={onHandClick} />)
                : <div className="text-gray-400 text-center mt-10">Brak rozdań w tej kolekcji.</div>}
            </div>
          </div>
        ) : currentSession ? (
          <>
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200 shrink-0">
              <h3 className="text-base font-bold mb-4 text-gray-800">Wykres portfela (Stół #{currentSession.tableId})</h3>
              <div className="w-full h-80">
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={currentSession.chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                    <XAxis dataKey="handIndex" stroke="#9ca3af" fontSize={11} minTickGap={20} />
                    <YAxis stroke="#9ca3af" fontSize={11} domain={['auto', 'auto']} />
                    <Tooltip />
                    <ReferenceLine y={0} stroke="#111827" strokeWidth={2} opacity={0.4} />
                    <Line type="monotone" dataKey="profit" stroke="#4f46e5" strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200 flex-1 flex flex-col">
              <div className="flex justify-between items-center border-b border-gray-100 pb-3 mb-4 shrink-0">
                <h3 className="text-base font-bold text-gray-800">Rozegrane Ręce</h3>
                <div className="flex bg-slate-50 p-2 rounded-xl text-xs gap-3 border border-gray-200">
                  <div className="text-gray-500">Sortuj: <select value={handsSortBy} onChange={(e) => setHandsSortBy(e.target.value)} className="bg-transparent font-bold cursor-pointer outline-none"><option value="date">Datą</option><option value="profit">Wynikiem</option></select></div>
                  <div className="text-gray-500">Kolejność: <select value={handsSortOrder} onChange={(e) => setHandsSortOrder(e.target.value)} className="bg-transparent font-bold cursor-pointer outline-none"><option value="desc">Malejąco</option><option value="asc">Rosnąco</option></select></div>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto flex flex-col pr-2 custom-scrollbar">
                {visibleHands.length > 0 ? visibleHands.map((hand) => <HandTile key={hand.id} hand={hand} onClick={onHandClick} />) : <div className="text-gray-400 text-center mt-10">Brak rozdań.</div>}
              </div>
            </div>
          </>
        ) : <div className="bg-white h-full rounded-2xl shadow-sm border border-gray-200 flex items-center justify-center text-gray-400">Wybierz sesję Cash po lewej stronie.</div>}
      </div>
    </div>
  );
};
