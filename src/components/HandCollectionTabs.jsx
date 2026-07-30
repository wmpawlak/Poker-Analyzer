import { Brain, Layers3, Save } from 'lucide-react';

const tabs = [
  { id: 'session', label: 'Sesja', icon: Layers3 },
  { id: 'analyzed', label: 'Z analizą', icon: Brain, countKey: 'analyzedCount' },
  { id: 'saved', label: 'Zapisane ręce', icon: Save, countKey: 'savedCount' },
];

export const HandCollectionTabs = ({
  mode,
  onChange,
  analyzedCount,
  savedCount,
  accent = 'indigo',
}) => {
  const counts = { analyzedCount, savedCount };
  const activeClasses = accent === 'amber'
    ? 'bg-amber-500 text-white shadow-sm'
    : 'bg-indigo-600 text-white shadow-sm';

  return (
    <div className="grid grid-cols-1 gap-1 rounded-xl border border-gray-200 bg-slate-100 p-1">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const count = tab.countKey ? counts[tab.countKey] : null;
        const isActive = mode === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
              isActive ? activeClasses : 'text-gray-600 hover:bg-white'
            }`}
          >
            <span className="flex items-center gap-2"><Icon size={15}/>{tab.label}</span>
            {count !== null && (
              <span className={`min-w-6 rounded-full px-1.5 py-0.5 text-[10px] ${isActive ? 'bg-white/20' : 'bg-white text-gray-500'}`}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
