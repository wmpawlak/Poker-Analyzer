// src/components/Sidebar.jsx
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { clearData } from '../store/pokerSlice';
import { LayoutDashboard, WalletCards, Settings, BarChart2, Trophy, Database, User, Users, Trash2 } from 'lucide-react';

export const Sidebar = ({ activeTab, setActiveTab }) => {
  const dispatch = useDispatch();
  const sources = useSelector(state => state.poker.sources);

  const NavButton = ({ id, icon: Icon, label }) => (
    <button onClick={() => setActiveTab(id)} className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold transition-all ${activeTab === id ? 'bg-indigo-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}>
      <Icon size={20} /> {label}
    </button>
  );

  return (
    <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col shadow-2xl z-10 shrink-0 relative">
      <div className="p-6 border-b border-slate-800">
        <h1 className="text-xl font-black text-white tracking-wide flex items-center gap-2"><span className="text-indigo-500">♠️</span> PokerAI</h1>
      </div>
      <nav className="flex-1 p-4 flex flex-col gap-2 overflow-y-auto custom-scrollbar">
        <NavButton id="profile" icon={User} label="Mój Profil (Hero)" />
        <NavButton id="opponents" icon={Users} label="Przeciwnicy" />
        <div className="h-px bg-slate-800 my-2"></div>
        <NavButton id="cash" icon={LayoutDashboard} label="Gry Cash" />
        <NavButton id="tournaments" icon={Trophy} label="Turnieje" />
        <NavButton id="cards" icon={BarChart2} label="Karty Startowe" />
        <NavButton id="wallet" icon={WalletCards} label="Wykresy i Zyski" />
        <div className="h-px bg-slate-800 my-2"></div>
        <NavButton id="sources" icon={Database} label="Wgrane Pliki" />
        <NavButton id="settings" icon={Settings} label="Ustawienia AI" />
      </nav>
      {sources.length > 0 && (
        <div className="p-4 border-t border-slate-800">
          <button onClick={() => dispatch(clearData())} className="w-full bg-red-900/50 hover:bg-red-600 text-red-200 hover:text-white px-3 py-2 rounded-lg text-sm flex justify-center items-center gap-2 font-bold transition-all border border-red-800/50"><Trash2 size={16} /> Wyczyść dane</button>
        </div>
      )}
    </aside>
  );
};