// src/views/ProfileViews.jsx
import React from 'react';

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

export const OpponentsView = ({ opponentsMetrics }) => (
  <div className="max-w-6xl mx-auto animate-in fade-in duration-300">
    <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm h-[calc(100vh-140px)] flex flex-col">
      <div className="border-b border-gray-100 pb-4 mb-4 shrink-0">
        <h3 className="text-xl font-black text-gray-800">Baza Przeciwników</h3>
        <p className="text-sm text-gray-500 mt-1">Z kim mierzysz się najczęściej i na kim zarabiasz najwięcej?</p>
      </div>
      {opponentsMetrics.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-gray-400">Brak danych o przeciwnikach.</div>
      ) : (
        <div className="flex-1 overflow-auto custom-scrollbar border border-gray-200 rounded-xl">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-slate-600 font-bold sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-6 py-4 border-b border-gray-200">Nazwa Przeciwnika</th>
                <th className="px-6 py-4 border-b border-gray-200 text-center">Rozdań</th>
                <th className="px-6 py-4 border-b border-gray-200 text-center">Hero Wygrał</th>
                <th className="px-6 py-4 border-b border-gray-200 text-center">Hero Przegrał</th>
                <th className="px-6 py-4 border-b border-gray-200 text-right">Twój Zysk</th>
              </tr>
            </thead>
            <tbody>
              {opponentsMetrics.slice(0, 150).map((opp) => (
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
      )}
    </div>
  </div>
);