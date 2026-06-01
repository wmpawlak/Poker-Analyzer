// src/views/CardsView.jsx
import React, { useState, useMemo } from 'react';
import { CardIcon } from '../components/CardIcon.jsx';

export const CardsView = ({ activeHands }) => {
  const [cardTypeFilter, setCardTypeFilter] = useState('all');
  const [viewMode, setViewMode] = useState('classic'); // 'classic' lub 'advanced'
  const [cardsSortBy, setCardsSortBy] = useState('count');
  const [cardsSortOrder, setCardsSortOrder] = useState('desc');

  // Przeliczanie statystyk rąk
  const all169HandsData = useMemo(() => {
    const ranks = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
    const handsMap = {};

    // Inicjalizacja mapy 169 rąk
    ranks.forEach(r => {
      const key = r + r;
      handsMap[key] = { key, type: 'pair', labelText: 'Para', cards: [`${r.toLowerCase()}s`, `${r.toLowerCase()}h`], count: 0, wins: 0, losses: 0 };
    });

    for (let i = 0; i < ranks.length; i++) {
      for (let j = i + 1; j < ranks.length; j++) {
        const high = ranks[i]; const low = ranks[j];
        handsMap[`${high}${low}s`] = { key: `${high}${low}s`, type: 'suited', labelText: 'Suited', cards: [`${high.toLowerCase()}s`, `${low.toLowerCase()}s`], count: 0, wins: 0, losses: 0 };
        handsMap[`${high}${low}o`] = { key: `${high}${low}o`, type: 'offsuit', labelText: 'Off-suit', cards: [`${high.toLowerCase()}s`, `${low.toLowerCase()}h`], count: 0, wins: 0, losses: 0 };
      }
    }

    let totalWinsGlobal = 0;
    activeHands.forEach(hand => {
      if (!hand.heroCards || hand.heroCards.length < 2) return;
      const r1 = hand.heroCards[0][0].toUpperCase(); const r2 = hand.heroCards[1][0].toUpperCase();
      const s1 = hand.heroCards[0][1].toLowerCase(); const s2 = hand.heroCards[1][1].toLowerCase();

      let lookupKey = "";
      if (r1 === r2) lookupKey = r1 + r2;
      else {
        const ranksOrder = "23456789TJQKA";
        const highRank = ranksOrder.indexOf(r1) > ranksOrder.indexOf(r2) ? r1 : r2;
        const lowRank = ranksOrder.indexOf(r1) > ranksOrder.indexOf(r2) ? r2 : r1;
        lookupKey = highRank + lowRank + (s1 === s2 ? "s" : "o");
      }

      if (handsMap[lookupKey]) {
        handsMap[lookupKey].count += 1;
        if (hand.outcome === 'WON') { handsMap[lookupKey].wins += 1; totalWinsGlobal += 1; } 
        else handsMap[lookupKey].losses += 1;
      }
    });

    Object.values(handsMap).forEach(h => {
       h.winRate = h.count > 0 ? (h.wins / h.count) * 100 : 0;
       h.winContribution = totalWinsGlobal > 0 ? (h.wins / totalWinsGlobal) * 100 : 0;
    });

    return Object.values(handsMap);
  }, [activeHands]);

  const maxCount = useMemo(() => Math.max(...all169HandsData.map(h => h.count), 1), [all169HandsData]);

  const filtered169Hands = useMemo(() => {
    let result = cardTypeFilter === 'all' ? [...all169HandsData] : all169HandsData.filter(h => h.type === cardTypeFilter);
    return result.sort((a, b) => {
      let valA = a[cardsSortBy]; let valB = b[cardsSortBy];
      if (valB !== valA) return cardsSortOrder === 'desc' ? valB - valA : valA - valB;
      return b.count - a.count;
    });
  }, [all169HandsData, cardTypeFilter, cardsSortBy, cardsSortOrder]);

  return (
    <div className="max-w-4xl mx-auto bg-white p-6 rounded-2xl shadow-sm border border-gray-200 animate-in fade-in duration-300 flex flex-col h-[calc(100vh-140px)]">
      <div className="border-b pb-4 mb-4 shrink-0 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-gray-800">Statystyka Rąk Startowych</h3>
          <div className="flex gap-2 mt-2">
            <button onClick={() => setViewMode('classic')} className={`px-3 py-1 rounded-lg text-xs font-bold ${viewMode === 'classic' ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-600'}`}>Klasyczny</button>
            <button onClick={() => setViewMode('advanced')} className={`px-3 py-1 rounded-lg text-xs font-bold ${viewMode === 'advanced' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600'}`}>Zaawansowany</button>
          </div>
        </div>
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl border">
          {['all', 'pair', 'suited', 'offsuit'].map(type => (
             <button key={type} onClick={() => setCardTypeFilter(type)} className={`px-2.5 py-1.5 rounded-lg text-xs font-bold ${cardTypeFilter === type ? 'bg-white shadow-sm' : ''}`}>
               {type.toUpperCase()}
             </button>
          ))}
        </div>
      </div>
      
      <div className="flex justify-between items-center bg-slate-50 p-2 rounded-xl text-xs gap-3 border mb-3 shrink-0">
        <select value={cardsSortBy} onChange={(e) => setCardsSortBy(e.target.value)} className="bg-transparent font-bold cursor-pointer outline-none">
          <option value="count">Sortuj: Częstotliwość</option>
          <option value="wins">Sortuj: Wygrane</option>
          <option value="losses">Sortuj: Przegrane</option>
          <option value="winRate">Sortuj: Win Rate</option>
        </select>
        <select value={cardsSortOrder} onChange={(e) => setCardsSortOrder(e.target.value)} className="bg-transparent font-bold cursor-pointer outline-none">
          <option value="desc">Malejąco</option>
          <option value="asc">Rosnąco</option>
        </select>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar flex flex-col gap-2">
        {filtered169Hands.map((hand) => {
          if (hand.count === 0) return null;
          const widthPercent = (hand.count / maxCount) * 100;

          return (
            <div key={hand.key} className="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 border border-gray-200 bg-white shadow-sm">
              <div className="w-14 shrink-0 flex gap-0.5 justify-center scale-110"><CardIcon cardStr={hand.cards[0]} /><CardIcon cardStr={hand.cards[1]} /></div>
              
              <div className="flex-1 flex flex-col gap-1">
                 <div className="text-[10px] font-bold text-gray-500 uppercase">{hand.labelText}</div>
                 
                 {viewMode === 'classic' ? (
                   <div className="bg-slate-100 h-5 rounded-md flex overflow-hidden border border-gray-200" style={{ width: `${widthPercent}%` }}>
                     {hand.wins > 0 && <div className="bg-emerald-500 h-full" style={{ width: `${(hand.wins / hand.count) * 100}%` }} />}
                     {hand.losses > 0 && <div className="bg-rose-500 h-full" style={{ width: `${(hand.losses / hand.count) * 100}%` }} />}
                   </div>
                 ) : (
                   <div className="bg-indigo-100 h-5 rounded-md flex overflow-hidden border border-indigo-200" style={{ width: `${widthPercent}%` }}>
                      <div className="bg-indigo-500 h-full" style={{ width: `${hand.winRate}%` }} />
                   </div>
                 )}
              </div>
              <div className="text-[10px] font-mono text-gray-500 w-24 text-right">
                {viewMode === 'classic' ? `W:${hand.wins} P:${hand.losses}` : `${hand.winRate.toFixed(1)}% WR`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};