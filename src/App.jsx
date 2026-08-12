// src/App.jsx
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  fetchAiModels,
  refreshDataStatus,
  refreshDataset,
  refreshImportCenter,
  selectSession,
  selectTourney,
  setDataFilters,
  setDateRange,
  setSessionAnalysisReportSelection,
  setSessionGroupReportSelection,
  setSessionGroupSelection,
  syncAiAnalyses,
  uploadImport,
} from './store/pokerSlice.js';

import { Sidebar } from './components/Sidebar.jsx';
import { Upload } from 'lucide-react';

const lazyExport = (loader, exportName) => lazy(() => loader().then((module) => ({ default: module[exportName] })));
const ProfileDataView = lazyExport(() => import('./views/ProfileViews.jsx'), 'ProfileDataView');
const OpponentsDataView = lazyExport(() => import('./views/ProfileViews.jsx'), 'OpponentsDataView');
const SessionGroupAnalysisView = lazyExport(() => import('./components/SessionGroupAnalysisView.jsx'), 'SessionGroupAnalysisView');
const CashView = lazyExport(() => import('./views/CashView.jsx'), 'CashView');
const TournamentsView = lazyExport(() => import('./views/TournamentsView.jsx'), 'TournamentsView');
const CardsView = lazyExport(() => import('./views/CardsView.jsx'), 'CardsView');
const WalletView = lazyExport(() => import('./views/WalletView.jsx'), 'WalletView');
const SourcesView = lazyExport(() => import('./views/SourcesView.jsx'), 'SourcesView');
const SettingsView = lazyExport(() => import('./views/SettingsView.jsx'), 'SettingsView');
const TrainingView = lazyExport(() => import('./views/TrainingView.jsx'), 'TrainingView');
const ReplayerModal = lazyExport(() => import('./components/replayer/ReplayerModal.jsx'), 'ReplayerModal');

const TabLoading = () => <div role="status" className="rounded-2xl border border-indigo-100 bg-indigo-50 p-8 text-center text-sm font-semibold text-indigo-700">Ładowanie widoku…</div>;

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
  training: 'Ćwiczenia',
};

export default function App() {
  const dispatch = useDispatch();
  const datasetStatus = useSelector((state) => state.poker.dataset.status);
  const datasetError = useSelector((state) => state.poker.dataset.error);
  const datasetRefreshNotice = useSelector((state) => state.poker.datasetRefreshNotice);
  const sharedAiAnalysesStatus = useSelector((state) => state.poker.sharedAiAnalysesStatus);
  const sharedAiAnalysesError = useSelector((state) => state.poker.sharedAiAnalysesError);
  const gameTypeFilter = useSelector((state) => state.poker.filters.gameType);
  const sessionGroupGameType = useSelector((state) => state.poker.filters.sessionGroupGameType);
  const sessionGroupDateRange = useSelector((state) => state.poker.filters.dateRanges.sessionGroup);
  const sessionGroupSelectedSourceIds = useSelector((state) => state.poker.sessionGroupSelection.sourceIds);
  const sessionGroupSelectedReportId = useSelector((state) => state.poker.sessionGroupSelection.reportId);
  
  // Stany UI
  const [activeTab, setActiveTab] = useState('profile'); 
  const [modalHandId, setModalHandId] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  useEffect(() => {
    dispatch(refreshDataset());
    dispatch(refreshDataStatus());
    dispatch(refreshImportCenter());
    dispatch(syncAiAnalyses());
    dispatch(fetchAiModels());
  }, [dispatch]);

  const queueUpload = (file) => {
    if (!file || !/\.txt$/i.test(file.name)) return;
    dispatch(uploadImport({ file }));
    setActiveTab('sources');
  };

  // Drag & Drop
  const handleDragEnter = (e) => { e.preventDefault(); e.stopPropagation(); dragCounter.current += 1; setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); dragCounter.current -= 1; if (dragCounter.current === 0) setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false); dragCounter.current = 0;
    const file = e.dataTransfer.files[0];
    queueUpload(file);
  };

  const openAnalysisSourceSession = ({ type, sessionId, reportId = null }) => {
    if (type === 'tournament') {
      dispatch(selectTourney(sessionId));
      if (reportId) dispatch(setSessionAnalysisReportSelection({ sessionId, reportId }));
      setActiveTab('tournaments');
      return;
    }
    dispatch(selectSession(sessionId));
    if (reportId) dispatch(setSessionAnalysisReportSelection({ sessionId, reportId }));
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

      {modalHandId && <Suspense fallback={null}><ReplayerModal handId={modalHandId} onClose={() => setModalHandId(null)} /></Suspense>}

      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-slate-50">
        <header className="bg-white border-b border-gray-200 px-8 py-5 flex justify-between items-center shadow-sm z-10 shrink-0">
          <div className="flex items-center gap-6">
            <h2 className="text-2xl font-bold text-gray-800">Zakładka: {TAB_LABELS[activeTab] || activeTab}</h2>
            {['opponents', 'cards'].includes(activeTab) && (
              <div className="flex bg-slate-100 p-1 rounded-xl border border-gray-200">
                <button onClick={() => dispatch(setDataFilters({ gameType: 'both' }))} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${gameTypeFilter === 'both' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}>Wszystko</button>
                <button onClick={() => dispatch(setDataFilters({ gameType: 'cash' }))} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${gameTypeFilter === 'cash' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}>Cash</button>
                <button onClick={() => dispatch(setDataFilters({ gameType: 'tournament' }))} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${gameTypeFilter === 'tournament' ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}>Turnieje</button>
              </div>
            )}
          </div>
          <label className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 cursor-pointer shadow-md transition-all active:scale-95">
            <Upload size={16} /> Wgraj logi (.txt)
            <input type="file" accept=".txt" onChange={(e) => {
               queueUpload(e.target.files[0]);
               e.target.value = '';
            }} className="hidden" />
          </label>
        </header>

        {datasetStatus === 'loading' && (
          <div role="status" className="bg-indigo-50 border-b border-indigo-100 px-8 py-2 text-sm font-semibold text-indigo-700 flex items-center gap-2">
            <span className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            Odczytywanie aktualnej rewizji datasetu…
          </div>
        )}
        {datasetStatus === 'failed' && (
          <div role="alert" className="bg-red-50 border-b border-red-100 px-8 py-2 text-sm text-red-700">
            Nie udało się odczytać datasetu: {datasetError}
          </div>
        )}
        {datasetRefreshNotice && (
          <div role="status" className="bg-amber-50 border-b border-amber-200 px-8 py-2 text-sm text-amber-900">
            {datasetRefreshNotice}
          </div>
        )}
        {sharedAiAnalysesStatus === 'failed' && (
          <div role="alert" className="bg-amber-50 border-b border-amber-200 px-8 py-2 text-sm text-amber-900">
            Raporty AI są zachowane lokalnie, ale nie udało się zapisać ich w repozytoryjnym cache: {sharedAiAnalysesError}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto p-6 scrollbar-thin">
          <Suspense fallback={<TabLoading/>}>
            {activeTab === 'profile' && <ProfileDataView onOpenSession={openAnalysisSourceSession}/>}
            {activeTab === 'session-group-analysis' && (
              <SessionGroupAnalysisView
                gameType={sessionGroupGameType}
                onGameTypeChange={(value) => dispatch(setDataFilters({ sessionGroupGameType: value }))}
                dateRange={sessionGroupDateRange}
                onDateRangeChange={(range) => dispatch(setDateRange({ view: 'sessionGroup', ...range }))}
                selectedSourceIds={sessionGroupSelectedSourceIds}
                onSelectedSourceIdsChange={(sourceIds) => dispatch(setSessionGroupSelection(sourceIds))}
                selectedReportId={sessionGroupSelectedReportId}
                onSelectedReportIdChange={(reportId) => dispatch(setSessionGroupReportSelection(reportId))}
                onHandClick={setModalHandId}
                onOpenSession={openAnalysisSourceSession}
              />
            )}
            {activeTab === 'opponents' && <OpponentsDataView/>}
            {activeTab === 'cash' && <CashView onHandClick={setModalHandId} />}
            {activeTab === 'tournaments' && <TournamentsView onHandClick={setModalHandId} />}
            {activeTab === 'cards' && <CardsView/>}
            {activeTab === 'wallet' && <WalletView/>}
            {activeTab === 'sources' && <SourcesView/>}
            {activeTab === 'settings' && <SettingsView/>}
            {activeTab === 'training' && <TrainingView onOpenHand={setModalHandId}/>}
          </Suspense>
        </div>
      </main>
    </div>
  );
}
