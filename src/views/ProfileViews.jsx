// src/views/ProfileViews.jsx
import React, { useState, useMemo, useEffect } from 'react';
import { Search, Filter, Trophy, Skull, Users, ChevronLeft, ChevronRight } from 'lucide-react';

const MetricCard = ({ title, value, desc, highlight }) => (
  <div className={`p-5 rounded-2xl border ${highlight ? 'bg-indigo-600 text-white border-indigo-700 shadow-lg' : 'bg-white border-gray-200 shadow-sm'}`}>
    <div className={`text-xs font-bold uppercase tracking-wider mb-2 ${highlight ? 'text-indigo-200' : 'text-gray-500'}`}>{title}</div>
    <div className={`text-3xl font-black mb-1 ${highlight ? 'text-white' : 'text-gray-800'}`}>{value}</div>
    <div className={`text-xs ${highlight ? 'text-indigo-200' : 'text-gray-400'}`}>{desc}</div>
  </div>
);

export const ProfileView = ({ heroMetrics }) => {
  if (!heroMetrics) return <div className="text-center p-12 text-gray-500 bg-white rounded-2xl border border-gray-200 max-w-6xl mx-auto">Wgraj pliki z historią rozdań, aby wyliczyć statystyki profilu.</div>;

  return (
    <div className="max-w-6xl mx-auto animate-in fade-in duration-300 flex flex-col gap-6">
      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex justify-between items-center">
        <div>
          <h3 className="text-xl font-black text-gray-800">Statystyki Profilu "Hero"</h3>
          <p className="text-sm text-gray-500 mt-1">Podsumowanie Twojego stylu gry wyliczone na bazie <strong>{heroMetrics.totalHands}</strong> przefiltrowanych rozdań.</p>
        </div>
        <div className="text-right">
           <span className="text-xs font-bold text-gray-400 block mb-1">Wynik całkowity (Profit)</span>
           <span className={`text-3xl font-black ${heroMetrics.totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{heroMetrics.totalProfit >= 0 ? '+' : ''}{heroMetrics.totalProfit}</span>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <MetricCard highlight title="VPIP (Voluntarily Put $ In Pot)" value={`${heroMetrics.vpip}%`} desc="Jak często dobrowolnie dokładasz żetony do puli przed flopem." />
        <MetricCard title="PFR (Pre-Flop Raise)" value={`${heroMetrics.pfr}%`} desc="Jak często agresywnie podbijasz przed flopem." />
        <MetricCard title="AF (Aggression Factor)" value={heroMetrics.af} desc="Stosunek Betów i Podbić do Sprawdzeń (Post-Flop)." />
        <MetricCard title="WTSD (Went To Showdown)" value={`${heroMetrics.wtsd}%`} desc="Jak często docierasz do ostatniego etapu i odkrywasz karty." />
        <MetricCard title="W$SD (Won $ At Showdown)" value={`${heroMetrics.wsd}%`} desc="Skuteczność Showdownu. Jak często wygrywasz pulę." />
        <MetricCard title="Winrate" value={`${heroMetrics.winrate} / 100`} desc="Średni zysk na każde 100 rozegranych rąk w przefiltrowanej próbce." />
      </div>
    </div>
  );
};

export const OpponentsView = ({ opponentsMetrics = [] }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [minHands, setMinHands] = useState(100);
  const [sortBy, setSortBy] = useState('handsPlayed');
  const [sortOrder, setSortOrder] = useState('desc');
  const [topToggle, setTopToggle] = useState(null); // 'best', 'worst', lub null
  
  // Stany paginacji
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50; // Liczba graczy na jednej stronie

  // Resetuj stronę na 1, gdy użytkownik zmienia filtry
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, minHands, sortBy, sortOrder, topToggle]);

  const processedOpponents = useMemo(() => {
    let data = [...opponentsMetrics];

    // Jeśli aktywny jest tryb TOP 25, nadpisuje on standardowe filtry
    if (topToggle === 'best') {
      data.sort((a, b) => b.netExchanged - a.netExchanged);
      return data.slice(0, 25);
    } else if (topToggle === 'worst') {
      data.sort((a, b) => a.netExchanged - b.netExchanged);
      return data.slice(0, 25);
    }

    // 1. Filtrowanie po nazwie i minimalnej liczbie rozdań
    data = data.filter(opp => opp.handsPlayed >= minHands);
    if (searchTerm) {
      data = data.filter(opp => opp.id.toLowerCase().includes(searchTerm.toLowerCase()));
    }

    // 2. Sortowanie
    data.sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];

      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return data;
  }, [opponentsMetrics, searchTerm, minHands, sortBy, sortOrder, topToggle]);

  const handleSort = (field) => {
    if (topToggle) return; // Wyłącz ręczne sortowanie w trybie Top 25
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  const getSortIndicator = (field) => {
    if (topToggle || sortBy !== field) return null;
    return sortOrder === 'asc' ? ' ▲' : ' ▼';
  };

  // Wyliczanie danych dla aktualnej strony
  const totalPages = Math.max(1, Math.ceil(processedOpponents.length / itemsPerPage));
  const paginatedOpponents = processedOpponents.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  return (
    <div className="max-w-6xl mx-auto animate-in fade-in duration-300">
      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm h-[calc(100vh-140px)] flex flex-col">
        
        {/* HEADER & CONTROLS */}
        <div className="border-b border-gray-100 pb-4 mb-4 shrink-0 space-y-4">
          <div>
            <h3 className="text-xl font-black text-gray-800">Baza Przeciwników</h3>
            <p className="text-sm text-gray-500 mt-1">Z kim mierzysz się najczęściej i na kim zarabiasz najwięcej?</p>
          </div>

          <div className="flex flex-wrap items-center gap-4 bg-slate-50 p-3 rounded-xl border border-gray-200">
            {/* Wyszukiwarka */}
            <div className="flex items-center bg-white border border-gray-300 rounded-lg px-3 py-1.5 focus-within:ring-2 ring-indigo-200">
              <Search size={16} className="text-gray-400 mr-2" />
              <input 
                type="text" 
                placeholder="Szukaj gracza..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                disabled={topToggle !== null}
                className="outline-none text-sm bg-transparent w-40 disabled:opacity-50"
              />
            </div>

            {/* Min. rozdań */}
            <div className="flex items-center gap-2">
              <Filter size={16} className="text-gray-400" />
              <span className="text-sm font-bold text-gray-700">Min. rozdań:</span>
              <input 
                type="number" 
                min="1"
                value={minHands}
                onChange={(e) => setMinHands(Number(e.target.value))}
                disabled={topToggle !== null}
                className="border border-gray-300 rounded-lg px-2 py-1 w-20 text-sm outline-none disabled:opacity-50"
              />
            </div>

            <div className="h-6 w-px bg-gray-300 mx-2"></div>

            {/* Top 25 Toggles */}
            <button 
              onClick={() => setTopToggle(topToggle === 'best' ? null : 'best')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-bold transition-colors ${topToggle === 'best' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-white border border-gray-300 text-emerald-700 hover:bg-emerald-50'}`}
            >
              <Trophy size={16} /> Top 25 Dawców
            </button>

            <button 
              onClick={() => setTopToggle(topToggle === 'worst' ? null : 'worst')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-bold transition-colors ${topToggle === 'worst' ? 'bg-red-600 text-white shadow-sm' : 'bg-white border border-gray-300 text-red-700 hover:bg-red-50'}`}
            >
              <Skull size={16} /> Top 25 Oprawców
            </button>
          </div>
        </div>

        {/* TABLE */}
        {processedOpponents.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
            <Users size={48} className="mb-4 opacity-20" />
            <p>Brak przeciwników spełniających kryteria.</p>
          </div>
        ) : (
          <div className="flex-1 border border-gray-200 rounded-xl relative flex flex-col overflow-hidden">
            <div className="flex-1 overflow-auto custom-scrollbar">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-slate-600 font-bold sticky top-0 z-10 shadow-sm select-none">
                  <tr>
                    <th className="px-6 py-4 border-b border-gray-200 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort('id')}>
                      Nazwa Przeciwnika <span className="text-indigo-500">{getSortIndicator('id')}</span>
                    </th>
                    <th className="px-6 py-4 border-b border-gray-200 text-center cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort('handsPlayed')}>
                      Rozdań <span className="text-indigo-500">{getSortIndicator('handsPlayed')}</span>
                    </th>
                    <th className="px-6 py-4 border-b border-gray-200 text-center cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort('heroWins')}>
                      Hero Wygrał <span className="text-indigo-500">{getSortIndicator('heroWins')}</span>
                    </th>
                    <th className="px-6 py-4 border-b border-gray-200 text-center cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort('heroLosses')}>
                      Hero Przegrał <span className="text-indigo-500">{getSortIndicator('heroLosses')}</span>
                    </th>
                    <th className="px-6 py-4 border-b border-gray-200 text-right cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort('netExchanged')}>
                      Twój Zysk <span className="text-indigo-500">{getSortIndicator('netExchanged')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedOpponents.map((opp) => (
                    <tr key={opp.id} className="border-b border-gray-100 hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-3 font-bold text-gray-800">{opp.id}</td>
                      <td className="px-6 py-3 text-center">{opp.handsPlayed}</td>
                      <td className="px-6 py-3 text-center text-green-600 font-semibold">{opp.heroWins}</td>
                      <td className="px-6 py-3 text-center text-red-600 font-semibold">{opp.heroLosses}</td>
                      <td className={`px-6 py-3 text-right font-mono font-black ${opp.netExchanged >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {opp.netExchanged >= 0 ? '+' : ''}{opp.netExchanged.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            {/* PAGINACJA */}
            <div className="bg-slate-50 border-t border-gray-200 px-6 py-3 flex items-center justify-between shrink-0">
               <span className="text-sm font-semibold text-gray-500">
                 Strona {currentPage} z {totalPages} <span className="font-normal">(Łącznie wyników: {processedOpponents.length})</span>
               </span>
               <div className="flex gap-2">
                 <button 
                   onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                   disabled={currentPage === 1}
                   className="p-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
                 >
                   <ChevronLeft size={18} />
                 </button>
                 <button 
                   onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                   disabled={currentPage === totalPages}
                   className="p-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
                 >
                   <ChevronRight size={18} />
                 </button>
               </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};