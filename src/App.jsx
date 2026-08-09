// src/App.jsx
import { useEffect, useMemo, useState, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  fetchAiModels,
  selectSession,
  selectTourney,
  syncAiAnalyses,
  syncLocalSources,
  uploadHandHistory,
} from './store/pokerSlice.js';
import { usePokerMetrics } from './hooks/usePokerMetrics.js';
import { buildSessionGroupCandidates } from './utils/sessionGroupCandidates.js';

import { Sidebar } from './components/Sidebar.jsx';
import { ProfileView, OpponentsView } from './views/ProfileViews.jsx';
import { SessionGroupAnalysisView } from './components/SessionGroupAnalysisView.jsx';
import { CashView } from './views/CashView.jsx';
import { TournamentsView } from './views/TournamentsView.jsx';
import { CardsView } from './views/CardsView.jsx';
import { WalletView, SourcesView, SettingsView } from './views/MiscViews.jsx';
import { ReplayerModal } from './components/replayer/ReplayerModal.jsx';
import { Upload } from 'lucide-react';

const TAB_LABELS = {
  profile: 'Mój profil',
  'session-group-analysis': 'Analiza wielu sesji',
  opponents: 'Przeciwnicy',
  cash: 'Gry Cash',
  tournaments: 'Turnieje',
  cards: 'Karty startowe',
  wallet: 'Wykresy i zyski',
  sources: 'Wgrane pliki',
  settings: 'Ustawienia AI',
};

export default function App() {
  const dispatch = useDispatch();
  const {
    localSourcesStatus,
    localSourcesError,
    sessions,
    tournaments,
    sessionAiAnalyses,
    sessionGroupAiAnalyses,
    sharedAiAnalysesStatus,
    sharedAiAnalysesError,
  } = useSelector((state) => state.poker);
  
  // Stany UI
  const [activeTab, setActiveTab] = useState('profile'); 
  const [gameTypeFilter, setGameTypeFilter] = useState('both'); 
  const [sessionGroupGameType, setSessionGroupGameType] = useState('both');
  const [sessionGroupDateFrom, setSessionGroupDateFrom] = useState('');
  const [sessionGroupDateTo, setSessionGroupDateTo] = useState('');
  const [sessionGroupSelectedSourceIds, setSessionGroupSelectedSourceIds] = useState([]);
  const [sessionGroupSelectedReportId, setSessionGroupSelectedReportId] = useState(null);
  const [modalHandId, setModalHandId] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  useEffect(() => {
    dispatch(syncLocalSources());
    dispatch(syncAiAnalyses());
    dispatch(fetchAiModels());
  }, [dispatch]);

  // Pobranie przeliczonych metryk z custom hooka
  const {
    activeHands,
    cashHands,
    tournamentHands,
    opponentsMetrics,
  } = usePokerMetrics(gameTypeFilter);

  const sessionGroupCandidateIds = useMemo(() => new Set(
    buildSessionGroupCandidates({
      sessions,
      tournaments,
      sessionAiAnalyses,
      gameType: sessionGroupGameType,
      dateFrom: sessionGroupDateFrom,
      dateTo: sessionGroupDateTo,
    }).candidates.map((candidate) => candidate.sourceId),
  ), [
    sessions,
    tournaments,
    sessionAiAnalyses,
    sessionGroupGameType,
    sessionGroupDateFrom,
    sessionGroupDateTo,
  ]);

  const sessionGroupReportIds = useMemo(() => new Set(
    (Array.isArray(sessionGroupAiAnalyses) ? sessionGroupAiAnalyses : [])
      .map((report) => report?.reportId)
      .filter(Boolean),
  ), [sessionGroupAiAnalyses]);

  useEffect(() => {
    // The selection mirrors the current candidate domain while remaining in App across tab changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSessionGroupSelectedSourceIds((previous) => {
      const next = previous.filter((sourceId) => sessionGroupCandidateIds.has(sourceId));
      return next.length === previous.length ? previous : next;
    });
  }, [sessionGroupCandidateIds]);

  useEffect(() => {
    // The selected report must not point at a report removed from Redux history.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSessionGroupSelectedReportId((previous) => (
      previous && sessionGroupReportIds.has(previous) ? previous : null
    ));
  }, [sessionGroupReportIds]);

  // Drag & Drop
  const handleDragEnter = (e) => { e.preventDefault(); e.stopPropagation(); dragCounter.current += 1; setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); dragCounter.current -= 1; if (dragCounter.current === 0) setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false); dragCounter.current = 0;
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.txt')) {
      const reader = new FileReader();
      reader.onload = (evt) => dispatch(uploadHandHistory({
        filename: file.name,
        content: evt.target.result,
        modifiedAt: new Date(file.lastModified).toISOString(),
      }));
      reader.readAsText(file);
    }
  };

  const openAnalysisSourceSession = ({ type, sessionId }) => {
    if (type === 'tournament') {
      dispatch(selectTourney(sessionId));
      setActiveTab('tournaments');
      return;
    }
    dispatch(selectSession(sessionId));
    setActiveTab('cash');
  };

  return (
    <div className="flex h-screen bg-slate-100 font-sans overflow-hidden" 
         onDragEnter={handleDragEnter} 
         onDragLeave={handleDragLeave} 
         onDragOver={(e) => e.preventDefault()} 
         onDrop={handleDrop}>
      
      {isDragging && (
        <div className="fixed inset-0 z-50 bg-indigo-600/90 backdrop-blur-sm flex flex-col items-center justify-center text-white border-4 border-dashed border-white m-4 rounded-3xl pointer-events-none">
          <Upload size={64} className="mb-4 animate-bounce" />
          <h2 className="text-3xl font-black tracking-wider">Upuść plik .txt tutaj</h2>
        </div>
      )}

      {modalHandId && <ReplayerModal handId={modalHandId} onClose={() => setModalHandId(null)} />}

      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-slate-50">
        <header className="bg-white border-b border-gray-200 px-8 py-5 flex justify-between items-center shadow-sm z-10 shrink-0">
          <div className="flex items-center gap-6">
            <h2 className="text-2xl font-bold text-gray-800">Zakładka: {TAB_LABELS[activeTab] || activeTab}</h2>
            {['profile', 'opponents', 'cards'].includes(activeTab) && (
              <div className="flex bg-slate-100 p-1 rounded-xl border border-gray-200">
                <button onClick={() => setGameTypeFilter('both')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${gameTypeFilter === 'both' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}>Wszystko</button>
                <button onClick={() => setGameTypeFilter('cash')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${gameTypeFilter === 'cash' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}>Cash</button>
                <button onClick={() => setGameTypeFilter('tournament')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${gameTypeFilter === 'tournament' ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}>Turnieje</button>
              </div>
            )}
          </div>
          <label className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 cursor-pointer shadow-md transition-all active:scale-95">
            <Upload size={16} /> Wgraj logi (.txt)
            <input type="file" accept=".txt" onChange={(e) => {
               const file = e.target.files[0];
               if(file){
                 const r = new FileReader();
                 r.onload = (evt) => dispatch(uploadHandHistory({
                   filename: file.name,
                   content: evt.target.result,
                   modifiedAt: new Date(file.lastModified).toISOString(),
                 }));
                 r.readAsText(file);
               }
            }} className="hidden" />
          </label>
        </header>

        {localSourcesStatus === 'loading' && (
          <div role="status" className="bg-indigo-50 border-b border-indigo-100 px-8 py-2 text-sm font-semibold text-indigo-700 flex items-center gap-2">
            <span className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            Wczytywanie i przeliczanie lokalnych historii rozdań…
          </div>
        )}
        {localSourcesStatus === 'failed' && (
          <div role="alert" className="bg-red-50 border-b border-red-100 px-8 py-2 text-sm text-red-700">
            Nie udało się wczytać danych lokalnych: {localSourcesError} Możesz nadal wgrywać pliki ręcznie.
          </div>
        )}
        {sharedAiAnalysesStatus === 'failed' && (
          <div role="alert" className="bg-amber-50 border-b border-amber-200 px-8 py-2 text-sm text-amber-900">
            Raporty AI są zachowane lokalnie, ale nie udało się zapisać ich w repozytoryjnym cache: {sharedAiAnalysesError}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto p-6 scrollbar-thin">
          {activeTab === 'profile' && (
            <ProfileView
              cashHands={cashHands}
              tournamentHands={tournamentHands}
              gameTypeFilter={gameTypeFilter}
            />
          )}
          {activeTab === 'session-group-analysis' && (
            <SessionGroupAnalysisView
              gameType={sessionGroupGameType}
              onGameTypeChange={setSessionGroupGameType}
              dateFrom={sessionGroupDateFrom}
              dateTo={sessionGroupDateTo}
              onDateFromChange={setSessionGroupDateFrom}
              onDateToChange={setSessionGroupDateTo}
              onClearDateRange={() => {
                setSessionGroupDateFrom('');
                setSessionGroupDateTo('');
              }}
              selectedSourceIds={sessionGroupSelectedSourceIds}
              onSelectedSourceIdsChange={setSessionGroupSelectedSourceIds}
              selectedReportId={sessionGroupSelectedReportId}
              onSelectedReportIdChange={setSessionGroupSelectedReportId}
              onHandClick={setModalHandId}
              onOpenSession={openAnalysisSourceSession}
            />
          )}
          {activeTab === 'opponents' && <OpponentsView opponentsMetrics={opponentsMetrics} />}
          {activeTab === 'cash' && <CashView onHandClick={setModalHandId} />}
          {activeTab === 'tournaments' && <TournamentsView onHandClick={setModalHandId} />}
          {activeTab === 'cards' && <CardsView activeHands={activeHands} />}
          {activeTab === 'wallet' && <WalletView />}
          {activeTab === 'sources' && <SourcesView />}
          {activeTab === 'settings' && <SettingsView />}
        </div>
      </main>
    </div>
  );
}
