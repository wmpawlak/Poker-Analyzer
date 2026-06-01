// src/views/TournamentsView.jsx
import React, { useState, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { selectTourney } from '../store/pokerSlice.js';
import { HandTile } from '../components/HandTile.jsx';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Filter } from 'lucide-react';

export const TournamentsView = ({ onHandClick }) => {
  const dispatch = useDispatch();
  const { tournaments, selectedTourneyId } = useSelector(state => state.poker);

  const [tourneyFilterRank, setTourneyFilterRank] = useState('');
  const [tourneySortBy, setTourneySortBy] = useState('date');
  const [tourneySortOrder, setTourneySortOrder] = useState('desc');
  const [tourneyHandsSortBy, setTourneyHandsSortBy] = useState('date');
  const [tourneyHandsSortOrder, setTourneyHandsSortOrder] = useState('desc');

  const availableRanks = useMemo(() => {
    const ranks = new Set();
    tournaments.flatMap(s => s.hands).forEach(h => { if (h.handRanking && h.handRanking !== 'UNKNOWN' && !h.isRebuy) ranks.add(h.handRanking); });
    return [...ranks].sort();
  }, [tournaments]);

  const filteredTournaments = useMemo(() => {
    if (!tourneyFilterRank) return tournaments;
    return tournaments.filter(t => t.hands.some(h => h.handRanking === tourneyFilterRank));
  }, [tournaments, tourneyFilterRank]);

  const sortedTournaments = [...filteredTournaments].sort((a, b) => {
    let valA = tourneySortBy === 'date' ? a.startTime : a.totalProfit;
    let valB = tourneySortBy === 'date' ? b.startTime : b.totalProfit;
    return tourneySortOrder === 'desc' ? valB - valA : valA - valB;
  });

  const currentTourney = tournaments.find(t => t.id === selectedTourneyId);
  const visibleTourneyHands = useMemo(() => {
    if (!currentTourney) return [];
    let hands = tourneyFilterRank ? currentTourney.hands.filter(h => h.handRanking === tourneyFilterRank) : [...currentTourney.hands];
    return hands.sort((a, b) => {
      let valA = tourneyHandsSortBy === 'date' ? a.timestamp : a.netProfit;
      let valB = tourneyHandsSortBy === 'date' ? b.timestamp : b.netProfit;
      return tourneyHandsSortOrder === 'desc' ? valB - valA : valA - valB;
    });
  }, [currentTourney, tourneyFilterRank, tourneyHandsSortBy, tourneyHandsSortOrder]);

  return (
    <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in duration-300 h-[calc(100vh-140px)]">
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200 flex flex-col gap-4 h-full">
        <div className="relative shrink-0">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18}/>
          <select value={tourneyFilterRank} onChange={(e) => setTourneyFilterRank(e.target.value)} className="w-full bg-slate-50 border border-gray-200 rounded-xl py-2.5 pl-10 pr-4 outline-none text-sm font-semibold text-gray-700 cursor-pointer">
            <option value="">Wszystkie układy...</option>
            {availableRanks.map(rank => <option key={rank} value={rank}>{rank}</option>)}
          </select>
        </div>
        {filteredTournaments.length === 0 ? <div className="text-center p-8 text-gray-400">Brak Turniejów. Wgraj logi.</div> : (
          <>
            <div className="flex justify-between items-center bg-slate-50 p-2.5 rounded-lg text-xs gap-2 border border-gray-100 shrink-0">
              <div className="text-gray-500">Sortuj: <select value={tourneySortBy} onChange={(e) => setTourneySortBy(e.target.value)} className="bg-transparent font-bold"><option value="date">Datą</option><option value="profit">Wynikiem</option></select></div>
              <div className="text-gray-500">Kolej: <select value={tourneySortOrder} onChange={(e) => setTourneySortOrder(e.target.value)} className="bg-transparent font-bold"><option value="desc">Malejąco</option><option value="asc">Rosnąco</option></select></div>
            </div>
            <div className="flex-1 overflow-y-auto flex flex-col gap-2.5 pr-2 custom-scrollbar">
              {sortedTournaments.map((tourney) => (
                <button key={tourney.id} onClick={() => dispatch(selectTourney(tourney.id))} className={`w-full text-left p-4 rounded-xl border transition-all flex flex-col ${selectedTourneyId === tourney.id ? 'border-amber-600 bg-amber-50 shadow-md ring-2 ring-amber-100' : 'border-gray-200 hover:bg-slate-50'}`}>
                  <div className="flex justify-between items-center font-semibold text-sm w-full">
                    <span className="text-gray-900 truncate max-w-[180px]" title={tourney.tourneyName}>{tourney.tourneyName}<span className="text-gray-400 text-xs font-normal ml-2">#{tourney.tourneyId}</span></span>
                    <span className={`font-mono text-base tracking-tight shrink-0 ml-2 ${tourney.totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{tourney.totalProfit >= 0 ? '+' : ''}{tourney.totalProfit.toLocaleString('en-US', {maximumFractionDigits: 2})}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between w-full">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Rozdania: {tourney.hands.filter(h => !h.isRebuy).length}</span>
                      {tourney.rebuys > 0 && <span className="text-[9px] uppercase font-black text-red-600 bg-red-100 px-1.5 py-0.5 rounded shadow-sm">Rebuy: {tourney.rebuys}</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="lg:col-span-2 flex flex-col gap-6 h-full overflow-y-auto pr-2 custom-scrollbar">
        {currentTourney ? (
          <>
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200 shrink-0">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-base font-bold text-gray-800 truncate" title={currentTourney.tourneyName}>Wykres Stacka: {currentTourney.tourneyName}</h3>
                {currentTourney.rebuys > 0 && <span className="bg-red-500 text-white text-xs px-2 py-1 rounded font-bold shadow-sm animate-pulse">REBUY x{currentTourney.rebuys}</span>}
              </div>
              <div className="w-full h-80">
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={currentTourney.chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                    <XAxis dataKey="handIndex" stroke="#9ca3af" fontSize={11} minTickGap={20} />
                    <YAxis stroke="#9ca3af" fontSize={11} domain={['auto', 'auto']} />
                    <Tooltip formatter={(value) => [`${value.toLocaleString()} żetonów`, 'Stack']} />
                    <Line type="monotone" dataKey="stack" stroke="#f59e0b" strokeWidth={2.5} dot={(props) => props.payload.isRebuy ? <circle cx={props.cx} cy={props.cy} r={5} fill="#ef4444" stroke="#fff" strokeWidth={2} /> : null} activeDot={{r: 6}} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200 flex-1 flex flex-col">
              <div className="flex justify-between items-center border-b border-gray-100 pb-3 mb-4 shrink-0">
                <h3 className="text-base font-bold text-gray-800">Rozegrane Ręce Turniejowe</h3>
                <div className="flex bg-slate-50 p-2 rounded-xl text-xs gap-3 border border-gray-200">
                  <div className="text-gray-500">Sortuj: <select value={tourneyHandsSortBy} onChange={(e) => setTourneyHandsSortBy(e.target.value)} className="bg-transparent font-bold cursor-pointer outline-none"><option value="date">Datą</option><option value="profit">Wynikiem</option></select></div>
                  <div className="text-gray-500">Kolej: <select value={tourneyHandsSortOrder} onChange={(e) => setTourneyHandsSortOrder(e.target.value)} className="bg-transparent font-bold cursor-pointer outline-none"><option value="desc">Malejąco</option><option value="asc">Rosnąco</option></select></div>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto flex flex-col pr-2 custom-scrollbar">
                {visibleTourneyHands.length > 0 ? visibleTourneyHands.map((hand) => <HandTile key={hand.id} hand={hand} onClick={onHandClick} />) : <div className="text-gray-400 text-center mt-10">Brak rozdań.</div>}
              </div>
            </div>
          </>
        ) : <div className="bg-white h-full rounded-2xl shadow-sm border border-gray-200 flex items-center justify-center text-gray-400">Wybierz turniej po lewej stronie.</div>}
      </div>
    </div>
  );
};