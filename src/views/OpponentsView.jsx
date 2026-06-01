// src/views/OpponentsView.jsx
import React, { useState, useMemo } from 'react';

export const OpponentsView = ({ opponentsMetrics }) => {
  const [sortBy, setSortBy] = useState('handsPlayed');
  const [sortOrder, setSortOrder] = useState('desc');

  // Logika sortowania tabeli
  const sortedOpponents = useMemo(() => {
    return [...opponentsMetrics].sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];
      
      // Jeśli wartości to liczby, porównujemy normalnie
      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortOrder === 'desc' ? valB - valA : valA - valB;
      }
      return 0;
    });
  }, [opponentsMetrics, sortBy, sortOrder]);

  const toggleSort = (key) => {
    if (sortBy === key) {
      setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(key);
      setSortOrder('desc');
    }
  };

  return (
    <div className="max-w-6xl mx-auto animate-in fade-in duration-300">
      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm h-[calc(100vh-140px)] flex flex-col">
        <div className="border-b border-gray-100 pb-4 mb-4 shrink-0 flex justify-between items-center">
          <div>
            <h3 className="text-xl font-black text-gray-800">Baza Przeciwników</h3>
            <p className="text-sm text-gray-500 mt-1">
              Lista graczy zidentyfikowanych w logach (ID: {opponentsMetrics.length} unikalnych osób).
            </p>
          </div>
          <div className="bg-slate-100 p-1 rounded-lg border text-xs">
            <span className="font-bold px-2">Sortuj po:</span>
            <select 
              value={sortBy} 
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-transparent font-bold text-indigo-700 cursor-pointer outline-none"
            >
              <option value="handsPlayed">Liczba rozdań</option>
              <option value="heroWins">Wygrane Hero</option>
              <option value="heroLosses">Przegrane Hero</option>
              <option value="netExchanged">Łączny Zysk (Net)</option>
            </select>
          </div>
        </div>
        
        {opponentsMetrics.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">Brak danych o przeciwnikach. Wgraj pliki `.txt`.</div>
        ) : (
          <div className="flex-1 overflow-auto custom-scrollbar border border-gray-200 rounded-xl">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-600 font-bold sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-6 py-4 border-b border-gray-200">ID Przeciwnika</th>
                  <th className="px-6 py-4 border-b border-gray-200 text-center cursor-pointer hover:bg-slate-100" onClick={() => toggleSort('handsPlayed')}>Rozdania</th>
                  <th className="px-6 py-4 border-b border-gray-200 text-center cursor-pointer hover:bg-slate-100" onClick={() => toggleSort('showdowns')}>Showdowny</th>
                  <th className="px-6 py-4 border-b border-gray-200 text-center text-green-600">Wygrane Hero</th>
                  <th className="px-6 py-4 border-b border-gray-200 text-center text-red-600">Przegrane Hero</th>
                  <th className="px-6 py-4 border-b border-gray-200 text-right cursor-pointer hover:bg-slate-100" onClick={() => toggleSort('netExchanged')}>Bilans (Net)</th>
                </tr>
              </thead>
              <tbody>
                {sortedOpponents.map((opp) => (
                  <tr key={opp.id} className="border-b border-gray-100 hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-3 font-bold text-gray-800 font-mono">{opp.id}</td>
                    <td className="px-6 py-3 text-center">{opp.handsPlayed}</td>
                    <td className="px-6 py-3 text-center">{opp.showdowns}</td>
                    <td className="px-6 py-3 text-center font-semibold">{opp.heroWins}</td>
                    <td className="px-6 py-3 text-center font-semibold">{opp.heroLosses}</td>
                    <td className={`px-6 py-3 text-right font-mono font-black ${opp.netExchanged >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {opp.netExchanged >= 0 ? '+' : ''}{opp.netExchanged.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};