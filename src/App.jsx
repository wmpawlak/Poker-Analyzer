// src/App.jsx
import React, { useState, useRef } from 'react';
import { useDispatch } from 'react-redux';
import { uploadHandHistory } from './store/pokerSlice.js';
import { usePokerMetrics } from './hooks/usePokerMetrics.js';

import { Sidebar } from './components/Sidebar.jsx';
import { ProfileView, OpponentsView } from './views/ProfileViews.jsx';
import { CashView } from './views/CashView.jsx';
import { TournamentsView } from './views/TournamentsView.jsx';
import { CardsView } from './views/CardsView.jsx';
import { WalletView, SourcesView, SettingsView } from './views/MiscViews.jsx';
import { ReplayerModal } from './components/replayer/ReplayerModal.jsx';
import { Upload } from 'lucide-react';

export default function App() {
  const dispatch = useDispatch();
  
  // Stany UI
  const [activeTab, setActiveTab] = useState('profile'); 
  const [gameTypeFilter, setGameTypeFilter] = useState('both'); 
  const [modalHandId, setModalHandId] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  // Pobranie przeliczonych metryk z custom hooka
  const { activeHands, heroMetrics, opponentsMetrics } = usePokerMetrics(gameTypeFilter);

  // Drag & Drop
  const handleDragEnter = (e) => { e.preventDefault(); e.stopPropagation(); dragCounter.current += 1; setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); dragCounter.current -= 1; if (dragCounter.current === 0) setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false); dragCounter.current = 0;
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.txt')) {
      const reader = new FileReader();
      reader.onload = (evt) => dispatch(uploadHandHistory({ filename: file.name, content: evt.target.result }));
      reader.readAsText(file);
    }
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

      <main className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50 relative">
        <header className="bg-white border-b border-gray-200 px-8 py-5 flex justify-between items-center shadow-sm z-10 shrink-0">
          <div className="flex items-center gap-6">
            <h2 className="text-2xl font-bold text-gray-800 capitalize">Zakładka: {activeTab}</h2>
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
               if(file){ const r = new FileReader(); r.onload = (evt) => dispatch(uploadHandHistory({ filename: file.name, content: evt.target.result })); r.readAsText(file); }
            }} className="hidden" />
          </label>
        </header>

        <div className="flex-1 overflow-auto p-6 scrollbar-thin">
          {activeTab === 'profile' && <ProfileView heroMetrics={heroMetrics} />}
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