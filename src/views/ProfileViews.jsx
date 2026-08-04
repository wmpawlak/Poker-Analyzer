// src/views/ProfileViews.jsx
import { useState, useMemo } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Filter,
  RotateCcw,
  Search,
  Skull,
  Trophy,
  Users,
} from 'lucide-react';
import { SessionSummary } from '../components/SessionSummary.jsx';
import { buildProfileReport } from '../utils/profileReport.js';

const PROFILE_GAME_TYPE_LABELS = {
  cash: 'Cash',
  tournament: 'Turnieje',
  both: 'Wszystko',
};

const ProfileDateField = ({ label, value, onChange, testId }) => (
  <label className="flex min-w-[9.5rem] flex-1 flex-col gap-1 text-xs font-black uppercase tracking-wide text-slate-500">
    <span>{label}</span>
    <span className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold normal-case tracking-normal text-slate-700 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100">
      <CalendarDays size={16} className="shrink-0 text-slate-400" />
      <input
        data-testid={testId}
        type="date"
        value={value}
        onChange={onChange}
        className="min-w-0 flex-1 bg-transparent outline-none"
      />
    </span>
  </label>
);

export const ProfileView = ({
  cashHands = [],
  tournamentHands = [],
  gameTypeFilter = 'both',
}) => {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const report = useMemo(() => buildProfileReport({
    cashHands,
    tournamentHands,
    gameType: gameTypeFilter,
    dateFrom,
    dateTo,
  }), [cashHands, tournamentHands, gameTypeFilter, dateFrom, dateTo]);

  const selectedGameTypeLabel = PROFILE_GAME_TYPE_LABELS[report.gameType] || 'Wszystko';
  const hasReportHands = report.isValid && report.metrics?.hands > 0;
  const periodLabel = dateFrom || dateTo
    ? `${dateFrom || 'początek historii'} — ${dateTo || 'koniec historii'}`
    : 'cała wczytana historia';

  return (
    <div data-testid="profile-view" className="mx-auto flex max-w-6xl flex-col gap-4 animate-in fade-in duration-300">
      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-xl font-black text-gray-800">Mój profil — Hero</h3>
            <p className="mt-1 text-sm text-gray-500">
              Raport okresowy dla trybu <strong>{selectedGameTypeLabel}</strong>. Początkowo obejmuje całą wczytaną historię.
            </p>
          </div>
          <div className="text-right text-xs font-bold uppercase tracking-wide text-slate-400">
            Zakres: <span className="text-slate-600">{periodLabel}</span>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-end">
          <ProfileDateField
            label="Od"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            testId="profile-date-from"
          />
          <ProfileDateField
            label="Do"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            testId="profile-date-to"
          />
          <button
            type="button"
            data-testid="profile-clear-date-range"
            onClick={() => {
              setDateFrom('');
              setDateTo('');
            }}
            disabled={!dateFrom && !dateTo}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw size={14} /> Wyczyść zakres
          </button>
        </div>
      </section>

      {!report.isValid ? (
        <div data-testid="profile-date-error" role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {report.error}
          <div className="mt-1 font-normal">Raport nie zostanie wyświetlony, dopóki zakres dat nie będzie poprawny.</div>
        </div>
      ) : !hasReportHands ? (
        <div data-testid="profile-empty" className="rounded-2xl border border-gray-200 bg-white p-12 text-center text-gray-500 shadow-sm">
          Brak rozdań w wybranym zakresie dla trybu {selectedGameTypeLabel}.
        </div>
      ) : (
        <SessionSummary
          metrics={report.metrics}
          accent="indigo"
          title="Raport profilu Hero"
          description={`Wspólne statystyki i styl gry z ${report.metrics.hands} rozdań w wybranym zakresie.`}
          resultBreakdown={report.gameType === 'both' ? {
            cash: report.cashMetrics,
            tournament: report.tournamentMetrics,
          } : null}
        />
      )}
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
    setCurrentPage(1);
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
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
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
                onChange={(e) => {
                  setMinHands(Number(e.target.value));
                  setCurrentPage(1);
                }}
                disabled={topToggle !== null}
                className="border border-gray-300 rounded-lg px-2 py-1 w-20 text-sm outline-none disabled:opacity-50"
              />
            </div>

            <div className="h-6 w-px bg-gray-300 mx-2"></div>

            {/* Top 25 Toggles */}
            <button 
              onClick={() => {
                setTopToggle(topToggle === 'best' ? null : 'best');
                setCurrentPage(1);
              }}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-bold transition-colors ${topToggle === 'best' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-white border border-gray-300 text-emerald-700 hover:bg-emerald-50'}`}
            >
              <Trophy size={16} /> Top 25 Dawców
            </button>

            <button 
              onClick={() => {
                setTopToggle(topToggle === 'worst' ? null : 'worst');
                setCurrentPage(1);
              }}
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
