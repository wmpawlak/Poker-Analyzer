// src/components/Sidebar.jsx
import { LayoutDashboard, WalletCards, Settings, BarChart2, Trophy, Database, User, Users, Brain } from 'lucide-react';

const NavButton = ({ id, icon: Icon, label, activeTab, setActiveTab }) => (
  <button data-testid={`nav-${id}`} onClick={() => setActiveTab(id)} className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold transition-all ${activeTab === id ? 'bg-indigo-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}>
    <Icon size={20} /> {label}
  </button>
);

export const Sidebar = ({ activeTab, setActiveTab }) => {
  return (
    <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col shadow-2xl z-10 shrink-0 relative">
      <div className="p-6 border-b border-slate-800">
        <h1 className="text-xl font-black text-white tracking-wide flex items-center gap-2"><span className="text-indigo-500">♠️</span> PokerAI</h1>
      </div>
      <nav className="flex-1 p-4 flex flex-col gap-2 overflow-y-auto custom-scrollbar">
        <NavButton id="profile" icon={User} label="Mój Profil (Hero)" activeTab={activeTab} setActiveTab={setActiveTab} />
        <NavButton id="session-group-analysis" icon={Brain} label="Analiza wielu sesji" activeTab={activeTab} setActiveTab={setActiveTab} />
        <NavButton id="opponents" icon={Users} label="Przeciwnicy" activeTab={activeTab} setActiveTab={setActiveTab} />
        <div className="h-px bg-slate-800 my-2"></div>
        <NavButton id="cash" icon={LayoutDashboard} label="Gry Cash" activeTab={activeTab} setActiveTab={setActiveTab} />
        <NavButton id="tournaments" icon={Trophy} label="Turnieje" activeTab={activeTab} setActiveTab={setActiveTab} />
        <NavButton id="cards" icon={BarChart2} label="Karty Startowe" activeTab={activeTab} setActiveTab={setActiveTab} />
        <NavButton id="wallet" icon={WalletCards} label="Wykresy i Zyski" activeTab={activeTab} setActiveTab={setActiveTab} />
        <div className="h-px bg-slate-800 my-2"></div>
        <NavButton id="sources" icon={Database} label="Wgrane Pliki" activeTab={activeTab} setActiveTab={setActiveTab} />
        <NavButton id="settings" icon={Settings} label="Ustawienia AI" activeTab={activeTab} setActiveTab={setActiveTab} />
      </nav>
    </aside>
  );
};
