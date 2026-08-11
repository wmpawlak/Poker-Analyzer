// src/views/ProfileViews.jsx
import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  BarChart3,
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  Database,
  Filter,
  ShieldCheck,
  Search,
  Sparkles,
  Skull,
  Trophy,
  Users,
} from 'lucide-react';
import { DateRangePicker } from '../components/DateRangePicker.jsx';
import { PlayerAnalysisHistory } from '../components/PlayerAnalysisHistory.jsx';
import { SessionSummary } from '../components/SessionSummary.jsx';
import {
  analyzePlayerWithAI,
  fetchOpponents,
  fetchPlayerAnalysisPreview,
  fetchProfile,
  setDataFilters,
  setDateRange,
  setPlayerAnalysisReportSelection,
} from '../store/pokerSlice.js';

const PROFILE_GAME_TYPE_LABELS = {
  cash: 'Cash',
  tournament: 'Turnieje',
  both: 'Wszystko',
};

export const ProfileView = ({
  report = null,
  gameTypeFilter = 'both',
  dateFrom = '',
  dateTo = '',
  onDateRangeChange = () => {},
  onGameTypeChange = () => {},
  isLoading = false,
  error = null,
  analysisPreview = null,
  analysisPreviewStatus = 'idle',
  analysisPreviewError = null,
  aiModels = [],
  defaultAiModel = '',
  analysisStatus = 'idle',
  analysisError = null,
  analysisCount = 0,
  playerAnalyses = [],
  selectedPlayerAnalysisReportId = null,
  currentDatasetRevision = '',
  sessionAiAnalyses = {},
  onAnalyze = () => {},
  onSelectPlayerAnalysis = () => {},
  onOpenSession = () => {},
  defaultSubtab = 'statistics',
}) => {
  const [activeSubtab, setActiveSubtab] = useState(defaultSubtab);
  const selectedGameTypeLabel = PROFILE_GAME_TYPE_LABELS[report?.gameType || gameTypeFilter] || 'Wszystko';
  const hasReportHands = report?.isValid && report.metrics?.hands > 0;
  const periodLabel = dateFrom || dateTo
    ? `${dateFrom || 'początek historii'} — ${dateTo || 'koniec historii'}`
    : 'cała wczytana historia';
  const selectedModel = aiModels.find((model) => model.id === defaultAiModel) || null;
  const modelConfigured = Boolean(selectedModel?.configured);
  const previewReady = analysisPreviewStatus === 'succeeded' && analysisPreview;
  const analysisLoading = analysisStatus === 'loading';
  const analyzeDisabled = analysisLoading
    || !previewReady
    || !analysisPreview?.canAnalyze
    || !modelConfigured;
  const previewErrorMessage = analysisPreviewError?.message || analysisPreviewError;
  const analysisErrorMessage = analysisError?.message || analysisError;
  const coverage = analysisPreview?.sessionEvidence?.coverage;

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

        <div data-testid="profile-controls" className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 lg:grid-cols-[auto_minmax(18rem,1fr)] lg:items-end">
          <div>
            <div className="mb-1 text-xs font-black uppercase tracking-wide text-slate-500">Typ gry</div>
            <div className="flex w-full rounded-xl border border-slate-200 bg-white p-1 sm:w-fit">
              {Object.entries(PROFILE_GAME_TYPE_LABELS).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onGameTypeChange(value)}
                  aria-pressed={gameTypeFilter === value}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-black transition-colors sm:flex-none ${gameTypeFilter === value ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="w-full lg:justify-self-end lg:max-w-xl" data-testid="profile-date-range">
            <DateRangePicker
              value={{ from: dateFrom, to: dateTo }}
              onChange={onDateRangeChange}
              label="Zakres dat profilu"
            />
          </div>
        </div>

        <div role="tablist" aria-label="Sekcje profilu" className="mt-4 flex gap-1 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            role="tab"
            aria-selected={activeSubtab === 'statistics'}
            onClick={() => setActiveSubtab('statistics')}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-black transition-colors ${activeSubtab === 'statistics' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <BarChart3 size={17} /> Statystyki
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeSubtab === 'analysis'}
            onClick={() => setActiveSubtab('analysis')}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-black transition-colors ${activeSubtab === 'analysis' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <Sparkles size={17} /> Analizy AI
          </button>
        </div>
      </section>

      {activeSubtab === 'statistics' && (error ? (
        <div data-testid="profile-date-error" role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {error}
        </div>
      ) : isLoading && !report ? (
        <div role="status" className="rounded-2xl border border-indigo-100 bg-indigo-50 p-8 text-center text-sm font-semibold text-indigo-700">
          Pobieranie raportu profilu…
        </div>
      ) : report && !report.isValid ? (
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
      ))}

      {activeSubtab === 'analysis' && (
        <>
        <section data-testid="player-analysis-create" role="tabpanel" className="rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-lg font-black text-slate-800"><BrainCircuit size={21} className="text-indigo-600" /> Nowa analiza statystyk gracza</h3>
              <p className="mt-1 text-sm text-slate-500">Jedno uruchomienie tworzy osobny raport historyczny i wykonuje jedno płatne żądanie AI.</p>
            </div>
            {analysisCount > 0 && <div className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-black text-indigo-700">Raporty: {analysisCount}</div>}
          </div>

          {analysisPreviewStatus === 'loading' ? (
            <div role="status" className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50 p-5 text-sm font-bold text-indigo-700">Przeliczanie kanonicznych statystyk…</div>
          ) : previewErrorMessage ? (
            <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{previewErrorMessage}</div>
          ) : previewReady ? (
            <>
              <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
                {[
                  { label: 'Ręce', value: analysisPreview.handCount, icon: Database },
                  { label: 'Sesje', value: analysisPreview.sessionCount, icon: BarChart3 },
                  { label: 'Styl', value: analysisPreview.profileStyle?.label || analysisPreview.profileStyleId, icon: BrainCircuit },
                  { label: 'Wiarygodność', value: analysisPreview.reliability?.label || analysisPreview.reliabilityId, icon: ShieldCheck },
                  { label: 'Raporty sesji', value: `${coverage?.usedReports || 0} z ${coverage?.availableReports || 0}`, icon: Sparkles },
                ].map(({ label, value, icon: Icon }) => (
                  <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <Icon size={16} className="mb-2 text-indigo-500" />
                    <div className="text-[11px] font-black uppercase tracking-wide text-slate-400">{label}</div>
                    <div className="mt-1 break-words text-sm font-black text-slate-800">{value}</div>
                  </div>
                ))}
              </div>
              {analysisPreview.warning && (
                <div role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">{analysisPreview.warning}</div>
              )}
            </>
          ) : null}

          <div className="mt-5 flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-wide text-slate-400">Używany model</div>
              <div className="mt-1 text-sm font-black text-slate-800">{selectedModel?.name || 'Brak wybranego modelu'}</div>
              {!modelConfigured && <div className="mt-1 text-xs font-semibold text-red-600">Model nie jest skonfigurowany na serwerze.</div>}
            </div>
            <button
              type="button"
              onClick={onAnalyze}
              disabled={analyzeDisabled}
              className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-black text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {analysisLoading
                ? 'Tworzenie raportu…'
                : analysisErrorMessage
                  ? 'Spróbuj ponownie — nowe płatne żądanie'
                  : 'Utwórz analizę AI — jedno płatne żądanie'}
            </button>
          </div>

          {analysisErrorMessage && (
            <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <strong>Nie udało się utworzyć raportu.</strong> {analysisErrorMessage} Ponowienie uruchomi nowe płatne żądanie.
            </div>
          )}
          {analysisStatus === 'succeeded' && !analysisErrorMessage && (
            <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">Nowy raport został zapisany i automatycznie wybrany.</div>
          )}
        </section>
        <PlayerAnalysisHistory
          reports={playerAnalyses}
          selectedReportId={selectedPlayerAnalysisReportId}
          currentDatasetRevision={currentDatasetRevision}
          sessionAiAnalyses={sessionAiAnalyses}
          onSelectReport={onSelectPlayerAnalysis}
          onOpenSession={onOpenSession}
        />
        </>
      )}
    </div>
  );
};

export const ProfileDataView = ({ onOpenSession = () => {} }) => {
  const dispatch = useDispatch();
  const gameTypeFilter = useSelector((state) => state.poker.filters.gameType);
  const dateRange = useSelector((state) => state.poker.filters.dateRanges.profile);
  const { from: dateFrom, to: dateTo } = dateRange;
  const profile = useSelector((state) => state.poker.aggregates.profile);
  const analysisPreview = useSelector((state) => state.poker.playerAnalysisPreview);
  const aiModels = useSelector((state) => state.poker.aiModels);
  const defaultAiModel = useSelector((state) => state.poker.defaultAiModel);
  const analysisStatus = useSelector((state) => state.poker.playerAnalysisStatus);
  const analysisError = useSelector((state) => state.poker.playerAnalysisError);
  const analysisCount = useSelector((state) => state.poker.playerAiAnalyses.length);
  const playerAnalyses = useSelector((state) => state.poker.playerAiAnalyses);
  const selectedPlayerAnalysisReportId = useSelector((state) => state.poker.selectedPlayerAnalysisReportId);
  const currentDatasetRevision = useSelector((state) => state.poker.dataset.datasetRevision);
  const sessionAiAnalyses = useSelector((state) => state.poker.sessionAiAnalyses);

  useEffect(() => {
    dispatch(fetchProfile({ gameType: gameTypeFilter, dateFrom, dateTo }));
  }, [dateFrom, dateTo, dispatch, gameTypeFilter]);

  useEffect(() => {
    const request = dispatch(fetchPlayerAnalysisPreview({
      gameType: gameTypeFilter,
      dateFrom,
      dateTo,
    }));
    return () => request.abort();
  }, [dateFrom, dateTo, dispatch, gameTypeFilter]);

  return (
    <ProfileView
      report={profile.data}
      gameTypeFilter={gameTypeFilter}
      dateFrom={dateFrom}
      dateTo={dateTo}
      isLoading={profile.status === 'loading'}
      error={profile.status === 'failed' ? profile.error : null}
      analysisPreview={analysisPreview.data}
      analysisPreviewStatus={analysisPreview.status}
      analysisPreviewError={analysisPreview.error}
      aiModels={aiModels}
      defaultAiModel={defaultAiModel}
      analysisStatus={analysisStatus}
      analysisError={analysisError}
      analysisCount={analysisCount}
      playerAnalyses={playerAnalyses}
      selectedPlayerAnalysisReportId={selectedPlayerAnalysisReportId}
      currentDatasetRevision={currentDatasetRevision}
      sessionAiAnalyses={sessionAiAnalyses}
      onGameTypeChange={(gameType) => dispatch(setDataFilters({ gameType }))}
      onDateRangeChange={(range) => dispatch(setDateRange({ view: 'profile', ...range }))}
      onAnalyze={() => dispatch(analyzePlayerWithAI({
        gameType: gameTypeFilter,
        dateFrom,
        dateTo,
        modelId: defaultAiModel,
      }))}
      onSelectPlayerAnalysis={(reportId) => dispatch(setPlayerAnalysisReportSelection(reportId))}
      onOpenSession={onOpenSession}
    />
  );
};

export const OpponentsView = ({
  opponentsMetrics = [],
  total = opponentsMetrics.length,
  hasNextPage = false,
  isLoading = false,
  error = null,
  dateRange = { from: '', to: '' },
  onDateRangeChange = () => {},
  onLoadMore = () => {},
}) => {
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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-xl font-black text-gray-800">Baza Przeciwników</h3>
              <p className="text-sm text-gray-500 mt-1">Z kim mierzysz się najczęściej i na kim zarabiasz najwięcej?</p>
            </div>
            <div className="w-full sm:max-w-sm" data-testid="opponents-date-range">
              <DateRangePicker
                value={dateRange}
                onChange={(range) => {
                  setCurrentPage(1);
                  onDateRangeChange(range);
                }}
                label="Zakres dat przeciwników"
              />
            </div>
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
        {error ? (
          <div role="alert" className="flex-1 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        ) : isLoading && opponentsMetrics.length === 0 ? (
          <div role="status" className="flex-1 flex items-center justify-center text-gray-400">Pobieranie przeciwników…</div>
        ) : processedOpponents.length === 0 ? (
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
                 Strona {currentPage} z {totalPages} <span className="font-normal">(wczytano: {opponentsMetrics.length} z {total})</span>
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
            {hasNextPage && (
              <button
                type="button"
                onClick={onLoadMore}
                disabled={isLoading}
                className="mx-6 mb-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-700 transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading ? 'Pobieranie…' : 'Pobierz kolejnych 100 przeciwników'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export const OpponentsDataView = () => {
  const dispatch = useDispatch();
  const gameType = useSelector((state) => state.poker.filters.gameType);
  const dateRange = useSelector((state) => state.poker.filters.dateRanges.opponents);
  const { from: dateFrom, to: dateTo } = dateRange;
  const opponents = useSelector((state) => state.poker.aggregates.opponents);

  useEffect(() => {
    dispatch(fetchOpponents({ gameType, dateFrom, dateTo }));
  }, [dateFrom, dateTo, dispatch, gameType]);

  return (
    <OpponentsView
      opponentsMetrics={opponents.items}
      total={opponents.total}
      hasNextPage={Boolean(opponents.nextCursor)}
      isLoading={opponents.status === 'loading'}
      error={opponents.status === 'failed' ? opponents.error : null}
      dateRange={dateRange}
      onDateRangeChange={(range) => dispatch(setDateRange({ view: 'opponents', ...range }))}
      onLoadMore={() => dispatch(fetchOpponents({
        gameType,
        dateFrom,
        dateTo,
        cursor: opponents.nextCursor,
      }))}
    />
  );
};
