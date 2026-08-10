import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AlertTriangle, Brain, Filter } from 'lucide-react';
import {
  fetchSessionDetail,
  fetchHandCollection,
  fetchSessionHands,
  fetchSessions,
  selectSession,
  selectTourney,
} from '../store/pokerSlice.js';
import { SessionSummary } from './SessionSummary.jsx';
import { SessionAnalysisPanel } from './SessionAnalysisPanel.jsx';
import { VirtualHandList } from './VirtualHandList.jsx';
import { HAND_RANKS } from '../utils/handFilters.js';
import { getSessionAnalysisStatus } from '../utils/sessionAnalysisStatus.js';

const SessionChart = lazy(() => import('./SessionChart.jsx'));
const EMPTY_HANDS = [];

const formatProfit = (value, gameType) => {
  const amount = Number(value) || 0;
  const sign = amount >= 0 ? '+' : '-';
  const unit = gameType === 'cash' ? 'zł' : '';
  return `${sign}${unit}${Math.abs(amount).toLocaleString('pl-PL', { maximumFractionDigits: 2 })}`;
};

export const SessionBrowserView = ({ gameType, onHandClick }) => {
  const dispatch = useDispatch();
  const sessionPage = useSelector((state) => state.poker.currentPages[gameType]);
  const datasetRevision = useSelector((state) => state.poker.dataset.datasetRevision);
  const selectedId = useSelector((state) => (
    gameType === 'cash' ? state.poker.selectedSessionId : state.poker.selectedTourneyId
  ));
  const sessionDetailsById = useSelector((state) => state.poker.sessionDetailsById);
  const sessionHandsById = useSelector((state) => state.poker.sessionHandsById);
  const sessionAiAnalyses = useSelector((state) => state.poker.sessionAiAnalyses);
  const handCollections = useSelector((state) => state.poker.handCollections[gameType]);
  const analyzedHandIdsKey = useSelector((state) => JSON.stringify(Object.keys(state.poker.aiAnalyses).sort()));
  const savedHandIdsKey = useSelector((state) => JSON.stringify([...state.poker.savedHandIds].map(String).sort()));
  const selectAction = gameType === 'cash' ? selectSession : selectTourney;
  const accent = gameType === 'cash' ? 'indigo' : 'amber';
  const isCash = gameType === 'cash';
  const [handsFilterRank, setHandsFilterRank] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [sortOrder, setSortOrder] = useState('desc');
  const [handsSortBy, setHandsSortBy] = useState('date');
  const [handsSortOrder, setHandsSortOrder] = useState('desc');
  const [collectionMode, setCollectionMode] = useState('sessions');
  const [analysisStatusFilter, setAnalysisStatusFilter] = useState('all');
  const analyzedHandIds = useMemo(() => JSON.parse(analyzedHandIdsKey), [analyzedHandIdsKey]);
  const savedHandIds = useMemo(() => JSON.parse(savedHandIdsKey), [savedHandIdsKey]);
  const activeHandCollection = collectionMode === 'sessions' ? null : handCollections[collectionMode];

  useEffect(() => {
    if (sessionPage.status === 'loading' && sessionPage.handRanking === handsFilterRank) return;
    if (!sessionPage.datasetRevision
      || (datasetRevision && sessionPage.datasetRevision !== datasetRevision)
      || sessionPage.handRanking !== handsFilterRank) {
      dispatch(fetchSessions({ gameType, handRanking: handsFilterRank }));
    }
  }, [datasetRevision, dispatch, gameType, handsFilterRank, sessionPage.datasetRevision, sessionPage.handRanking, sessionPage.status]);

  useEffect(() => {
    if (sessionPage.status !== 'succeeded') return;
    if (selectedId && sessionPage.items.some((session) => session.id === selectedId)) return;
    dispatch(selectAction(sessionPage.items[0]?.id || null));
  }, [dispatch, selectAction, selectedId, sessionPage.items, sessionPage.status]);

  useEffect(() => {
    if (!selectedId || collectionMode !== 'sessions') return;
    dispatch(fetchSessionDetail({ sessionId: selectedId }));
    dispatch(fetchSessionHands({
      sessionId: selectedId,
      handRanking: handsFilterRank,
      sortBy: handsSortBy,
      sortOrder: handsSortOrder,
    }));
  }, [collectionMode, datasetRevision, dispatch, handsFilterRank, handsSortBy, handsSortOrder, selectedId]);

  const collectionQuery = useMemo(() => ({
    datasetRevision,
    gameType,
    mode: collectionMode,
    analyzedHandIds,
    savedHandIds,
    handRanking: handsFilterRank,
    sortBy: handsSortBy,
    sortOrder: handsSortOrder,
  }), [analyzedHandIds, collectionMode, datasetRevision, gameType, handsFilterRank, handsSortBy, handsSortOrder, savedHandIds]);

  useEffect(() => {
    if (collectionMode === 'sessions' || !datasetRevision) return;
    dispatch(fetchHandCollection(collectionQuery));
  }, [collectionMode, collectionQuery, datasetRevision, dispatch]);

  const sessionsWithAnalysisStatus = useMemo(() => sessionPage.items.map((session) => ({
    ...session,
    analysisStatus: getSessionAnalysisStatus({
      reports: sessionAiAnalyses[session.id],
      sessionFingerprint: session.fingerprint,
      datasetRevision,
    }),
  })), [datasetRevision, sessionAiAnalyses, sessionPage.items]);
  const sortedSessions = useMemo(() => sessionsWithAnalysisStatus
    .filter((session) => (
      analysisStatusFilter === 'all'
      || (analysisStatusFilter === 'current' && session.analysisStatus === 'current')
      || (analysisStatusFilter === 'without-current' && session.analysisStatus !== 'current')
    ))
    .sort((left, right) => {
      const valueLeft = sortBy === 'date' ? left.startTime : left.totalProfit;
      const valueRight = sortBy === 'date' ? right.startTime : right.totalProfit;
      return sortOrder === 'desc' ? valueRight - valueLeft : valueLeft - valueRight;
    }), [analysisStatusFilter, sessionsWithAnalysisStatus, sortBy, sortOrder]);
  const selectedSession = sessionPage.items.find((session) => session.id === selectedId) || null;
  const detail = selectedId ? sessionDetailsById[selectedId] : null;
  const handPage = selectedId ? sessionHandsById[selectedId] : null;
  const loadedHands = handPage?.items || EMPTY_HANDS;
  const availableRanks = useMemo(() => {
    const labels = new Map(HAND_RANKS.map(({ id, label }) => [id, label]));
    return (sessionPage.availableRanks || []).map(({ id, count }) => ({ id, count, label: labels.get(id) || id }));
  }, [sessionPage.availableRanks]);
  const nextHandCursor = handPage?.nextCursor || null;
  const handPageStatus = handPage?.status || 'idle';
  const loadMoreHands = useCallback(() => {
    if (!selectedId || !nextHandCursor || handPageStatus === 'loading') return;
    dispatch(fetchSessionHands({
      sessionId: selectedId,
      handRanking: handsFilterRank,
      sortBy: handsSortBy,
      sortOrder: handsSortOrder,
      cursor: nextHandCursor,
    }));
  }, [dispatch, handPageStatus, handsFilterRank, handsSortBy, handsSortOrder, nextHandCursor, selectedId]);
  const loadMoreCollectionHands = useCallback(() => {
    if (!activeHandCollection?.nextCursor || activeHandCollection.status === 'loading') return;
    dispatch(fetchHandCollection({ ...collectionQuery, cursor: activeHandCollection.nextCursor }));
  }, [activeHandCollection, collectionQuery, dispatch]);
  const chartData = detail?.session?.chartData || [];
  const detailSession = detail?.session || selectedSession;

  return (
    <div className="mx-auto grid h-[calc(100vh-140px)] max-w-7xl grid-cols-1 gap-6 animate-in fade-in duration-300 lg:grid-cols-3">
      <div className="flex h-full flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="grid shrink-0 grid-cols-3 gap-1 rounded-xl border border-gray-200 bg-slate-50 p-1 text-[11px] font-bold">
          <button type="button" onClick={() => setCollectionMode('sessions')} aria-pressed={collectionMode === 'sessions'} className={`rounded-lg px-2 py-2 transition-colors ${collectionMode === 'sessions' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>Sesje</button>
          <button type="button" onClick={() => setCollectionMode('analyzed')} aria-pressed={collectionMode === 'analyzed'} className={`rounded-lg px-2 py-2 transition-colors ${collectionMode === 'analyzed' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>Z analizą</button>
          <button type="button" onClick={() => setCollectionMode('saved')} aria-pressed={collectionMode === 'saved'} className={`rounded-lg px-2 py-2 transition-colors ${collectionMode === 'saved' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>Zapisane</button>
        </div>
        {collectionMode === 'sessions' && <label className="flex shrink-0 items-center justify-between gap-3 rounded-xl border border-gray-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
          Status analizy
          <select value={analysisStatusFilter} onChange={(event) => setAnalysisStatusFilter(event.target.value)} className="cursor-pointer bg-transparent text-right font-bold outline-none">
            <option value="all">Wszystkie</option>
            <option value="current">Z aktualnym raportem</option>
            <option value="without-current">Bez aktualnego raportu</option>
          </select>
        </label>}
        <div className="relative shrink-0">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18}/>
          <select value={handsFilterRank} onChange={(event) => setHandsFilterRank(event.target.value)} className="w-full cursor-pointer rounded-xl border border-gray-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm font-semibold text-gray-700 outline-none">
            <option value="">Wszystkie układy w otwartej sesji…</option>
            {availableRanks.map((rank) => <option key={rank.id} value={rank.id}>{rank.label} ({rank.count})</option>)}
          </select>
        </div>
        {sessionPage.status === 'loading' && sessionPage.items.length === 0 ? <div className="p-8 text-center text-gray-400">Wczytywanie sesji…</div> : null}
        {sessionPage.status === 'failed' ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{sessionPage.error}</div> : null}
        {sessionPage.status !== 'loading' && sortedSessions.length === 0 ? <div className="p-8 text-center text-gray-400">{analysisStatusFilter === 'all' ? `Brak ${isCash ? 'sesji Cash' : 'turniejów'}. Wgraj pliki w centrum importu.` : 'Brak sesji pasujących do wybranego statusu analizy.'}</div> : null}
        {sortedSessions.length > 0 && <>
          <div className="flex shrink-0 items-center justify-between gap-2 rounded-lg border border-gray-100 bg-slate-50 p-2.5 text-xs">
            <div className="text-gray-500">Sortuj: <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} className="bg-transparent font-bold"><option value="date">Datą</option><option value="profit">Wynikiem</option></select></div>
            <div className="text-gray-500">Kolejność: <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} className="bg-transparent font-bold"><option value="desc">Malejąco</option><option value="asc">Rosnąco</option></select></div>
          </div>
          <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto pr-2 custom-scrollbar">
            {sortedSessions.map((session) => (
              <div key={session.id} role="button" tabIndex={0} onClick={() => dispatch(selectAction(session.id))} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); dispatch(selectAction(session.id)); } }} className={`flex w-full cursor-pointer flex-col rounded-xl border p-4 text-left transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500 ${selectedId === session.id ? (isCash ? 'border-indigo-600 bg-indigo-50 shadow-md ring-2 ring-indigo-100' : 'border-amber-600 bg-amber-50 shadow-md ring-2 ring-amber-100') : 'border-gray-200 hover:bg-slate-50'}`}>
                <div className="flex w-full items-center justify-between text-sm font-semibold">
                  <span className="flex max-w-[70%] min-w-0 items-center gap-1.5 text-gray-900" title={isCash ? `Stół: ${session.tableId}` : session.tourneyName}>
                    {session.analysisStatus === 'current' && <button type="button" onClick={(event) => { event.stopPropagation(); setAnalysisStatusFilter('current'); }} title="Aktualna analiza sesji" aria-label="Aktualna analiza sesji — filtruj sesje z aktualnym raportem" className="shrink-0 rounded p-0.5 text-indigo-600 hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"><Brain size={16}/></button>}
                    {session.analysisStatus === 'stale' && <button type="button" onClick={(event) => { event.stopPropagation(); setAnalysisStatusFilter('without-current'); }} title="Analiza sesji jest nieaktualna" aria-label="Analiza sesji jest nieaktualna — filtruj sesje bez aktualnego raportu" className="shrink-0 rounded p-0.5 text-amber-600 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500"><AlertTriangle size={16}/></button>}
                    <span className="truncate">{isCash ? <>Stół #{session.tableId} <span className="ml-2 text-xs font-normal text-gray-400">({session.dateStr})</span></> : <>{session.tourneyName}<span className="ml-2 text-xs font-normal text-gray-400">#{session.tourneyId}</span></>}</span>
                  </span>
                  <span className={`ml-2 shrink-0 font-mono text-base tracking-tight ${session.totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatProfit(session.totalProfit, gameType)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Rozdania: {session.handCount}</span>{session.rebuys > 0 && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-red-600">Rebuy: {session.rebuys}</span>}</div>
              </div>
            ))}
          </div>
        </>}
        </div>
        {collectionMode !== 'sessions' && <section className="flex min-h-[24rem] flex-1 flex-col rounded-2xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-2">
          <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-3">
            <div>
              <h2 className="text-base font-bold text-gray-800">{collectionMode === 'analyzed' ? 'Ręce z analizą' : 'Zapisane ręce'}</h2>
              <p className="mt-1 text-xs text-slate-500">Wynik: {activeHandCollection?.total || 0} · Analizowane: {activeHandCollection?.collectionCounts?.analyzed || 0} · Zapisane: {activeHandCollection?.collectionCounts?.saved || 0}</p>
            </div>
            <div className="flex gap-3 rounded-xl border border-gray-200 bg-slate-50 p-2 text-xs">
              <div className="text-gray-500">Sortuj: <select value={handsSortBy} onChange={(event) => setHandsSortBy(event.target.value)} className="cursor-pointer bg-transparent font-bold outline-none"><option value="date">Datą</option><option value="profit">Wynikiem</option></select></div>
              <div className="text-gray-500">Kolejność: <select value={handsSortOrder} onChange={(event) => setHandsSortOrder(event.target.value)} className="cursor-pointer bg-transparent font-bold outline-none"><option value="desc">Malejąco</option><option value="asc">Rosnąco</option></select></div>
            </div>
          </div>
          {activeHandCollection?.status === 'failed'
            ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{activeHandCollection.error}</div>
            : <VirtualHandList
              hands={activeHandCollection?.items || EMPTY_HANDS}
              onHandClick={onHandClick}
              onLoadMore={loadMoreCollectionHands}
              hasNextPage={Boolean(activeHandCollection?.nextCursor)}
              isLoading={activeHandCollection?.status === 'loading'}
              resetKey={`${datasetRevision}:${gameType}:${collectionMode}:${handsFilterRank}:${handsSortBy}:${handsSortOrder}`}
              emptyMessage={activeHandCollection?.status === 'loading' ? 'Wczytywanie kolekcji…' : 'Brak rąk w tej kolekcji.'}
            />}
        </section>}
      {/* The collection is the second grid column while the session detail remains hidden. */}

      <div className={`flex h-full flex-col gap-6 overflow-y-auto pr-2 custom-scrollbar lg:col-span-2 ${collectionMode === 'sessions' ? '' : 'hidden'}`}>
        <div className={collectionMode === 'sessions' ? 'contents' : 'hidden'}>
        {!selectedSession ? <div className="flex h-full items-center justify-center rounded-2xl border border-gray-200 bg-white text-gray-400 shadow-sm">Wybierz {isCash ? 'sesję Cash' : 'turniej'} po lewej stronie.</div> : <>
          {detail?.status === 'failed' && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{detail.error}</div>}
          {detail?.status === 'loading' && !detail?.session && <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm font-semibold text-indigo-700">Wczytywanie podsumowania sesji…</div>}
          {detailSession?.metrics && <SessionSummary
            metrics={detailSession.metrics}
            accent={accent}
            analysisPanel={<SessionAnalysisPanel
              sessionId={selectedSession.id}
              sessionFingerprint={selectedSession.fingerprint}
              handCount={selectedSession.handCount}
              onHandClick={onHandClick}
              accent={accent}
            />}
          />}
          {chartData.length > 0 && <div className="shrink-0 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="mb-4 text-base font-bold text-gray-800">{isCash ? `Wykres portfela (Stół #${selectedSession.tableId})` : `Wykres stacka: ${selectedSession.tourneyName}`}</h3>
            <div className="h-80 w-full"><Suspense fallback={<div className="p-4 text-sm text-slate-500">Ładowanie wykresu…</div>}><SessionChart chartData={chartData} isCash={isCash}/></Suspense></div>
          </div>}
          <div className="flex min-h-[18rem] flex-1 flex-col rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-3">
              <h3 className="text-base font-bold text-gray-800">{isCash ? 'Rozegrane ręce' : 'Rozegrane ręce turniejowe'}</h3>
              <div className="flex gap-3 rounded-xl border border-gray-200 bg-slate-50 p-2 text-xs"><div className="text-gray-500">Sortuj: <select value={handsSortBy} onChange={(event) => setHandsSortBy(event.target.value)} className="cursor-pointer bg-transparent font-bold outline-none"><option value="date">Datą</option><option value="profit">Wynikiem</option></select></div><div className="text-gray-500">Kolejność: <select value={handsSortOrder} onChange={(event) => setHandsSortOrder(event.target.value)} className="cursor-pointer bg-transparent font-bold outline-none"><option value="desc">Malejąco</option><option value="asc">Rosnąco</option></select></div></div>
            </div>
            {handPage?.status === 'failed' ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{handPage.error}</div> : <VirtualHandList hands={loadedHands} onHandClick={onHandClick} onLoadMore={loadMoreHands} hasNextPage={Boolean(handPage?.nextCursor)} isLoading={handPage?.status === 'loading'} resetKey={`${datasetRevision}:${selectedId}:${handsFilterRank}:${handsSortBy}:${handsSortOrder}`} emptyMessage={handPage?.status === 'loading' ? 'Wczytywanie rąk…' : 'Brak rozdań w tej sesji.'}/>} 
          </div>
        </>}
      </div>
    </div>
    </div>
  );
};
