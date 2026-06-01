// src/views/CardsView.jsx
import React, { useState, useMemo } from 'react';
import { CardIcon } from '../components/CardIcon.jsx';
import { X, Grid } from 'lucide-react';

export const CardsView = ({ activeHands }) => {
  const [cardTypeFilter, setCardTypeFilter] = useState('all');
  const [viewMode, setViewMode] = useState('classic'); // 'classic' lub 'advanced'
  const [cardsSortBy, setCardsSortBy] = useState('count');
  const [cardsSortOrder, setCardsSortOrder] = useState('desc');
  const [activeModal, setActiveModal] = useState(null); // 'suited', 'offsuit' lub null

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

  // Funkcja przypisująca stonowany kolor kafelka na podstawie Win Rate (żółty idealnie przy 50%)
  const getHeatmapColor = (hand) => {
    if (!hand || hand.count === 0) return 'bg-white text-gray-300 border-gray-200 opacity-50';
    const wr = hand.winRate;
    if (wr >= 60) return 'bg-emerald-500 text-white font-bold border-emerald-600 shadow-sm';
    if (wr >= 55) return 'bg-lime-400 text-lime-900 font-bold border-lime-500 shadow-sm';
    if (wr >= 48) return 'bg-yellow-300 text-yellow-900 font-bold border-yellow-400 shadow-sm'; 
    if (wr >= 35) return 'bg-orange-400 text-white font-bold border-orange-500 shadow-sm';
    return 'bg-red-500 text-white font-bold border-red-600 shadow-sm';
  };

  // Funkcja przypisująca stonowany kolor dymka częstotliwości (dymek żółty przy 50% wartości maxCount)
  const getCountBadgeColor = (count) => {
    if (count === 0) return 'hidden';
    const ratio = count / maxCount;
    if (ratio >= 0.75) return 'bg-green-500 text-white';
    if (ratio >= 0.55) return 'bg-lime-400 text-lime-950';
    if (ratio >= 0.45) return 'bg-yellow-300 text-yellow-950'; 
    if (ratio >= 0.20) return 'bg-orange-400 text-white';
    return 'bg-red-500 text-white';
  };

  // Renderowanie schodkowej siatki rąk startowych
const renderGrid = (type) => {
    const ranks = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
    
    return (
      <div className="flex gap-1.5 justify-start">
        {ranks.map((firstRank, colIndex) => {
          // Dla każdej kolumny "firstRank" jest stałe
          return (
            <div key={firstRank} className="flex flex-col gap-1.5">
              {ranks.map((secondRank) => {
                // Logika wyboru układu zależna od typu
                let lookupKey = "";
                if (type === 'pair') {
                  if (firstRank !== secondRank) return null;
                  lookupKey = firstRank + secondRank;
                } else if (type === 'suited') {
                  if (ranks.indexOf(firstRank) >= ranks.indexOf(secondRank)) return null;
                  lookupKey = firstRank + secondRank + 's';
                } else { // offsuit
                  if (ranks.indexOf(firstRank) >= ranks.indexOf(secondRank)) return null;
                  lookupKey = firstRank + secondRank + 'o';
                }

                const handObj = all169HandsData.find(h => h.key === lookupKey);
                if (!handObj) return null;

                const colorClass = getHeatmapColor(handObj);
                const badgeColorClass = handObj ? getCountBadgeColor(handObj.count) : 'hidden';

                return (
                  <div 
                    key={lookupKey} 
                    className={`w-20 h-16 flex flex-col items-center justify-center rounded-xl border cursor-default transition-all hover:scale-110 hover:!z-50 relative ${colorClass}`}
                    title={`${lookupKey}: Rozegrano ${handObj.count} | WR: ${handObj.winRate.toFixed(1)}%`}
                  >
                    {handObj.count > 0 && (
                      <div className={`absolute -top-3 -right-3 w-8 h-8 rounded-full border border-black flex items-center justify-center text-sm font-black shadow-md select-none z-40 ${badgeColorClass}`}>
                        {handObj.count}
                      </div>
                    )}
                    <span className="text-base font-black tracking-tighter leading-none">{firstRank}-{secondRank}</span>
                    {handObj.count > 0 && (
                      <span className="text-sm leading-none font-black mt-1">{handObj.winRate.toFixed(0)}%</span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto bg-white p-6 rounded-2xl shadow-sm border border-gray-200 animate-in fade-in duration-300 flex flex-col h-[calc(100vh-140px)] relative">
      
      {/* NAKŁADKA MODALA (Heatmapy) */}
      {activeModal && (
        <div className="absolute inset-0 z-40 bg-white/95 backdrop-blur-md rounded-2xl flex flex-col p-8 animate-in fade-in zoom-in-95">
          <div className="flex justify-between items-center mb-6 border-b pb-4">
            <div className="flex items-center gap-8">
              <div>
                <h2 className="text-2xl font-black text-gray-800">Mapa Termiczna Układów</h2>
                <p className="text-sm text-gray-500 mt-1">Kolor kafelka = Win Rate (WR). Kółeczko w rogu = Liczba rozegranych rozdań (próbka).</p>
              </div>

              {/* TOGGLE WEWNĄTRZ MODALA */}
              <div className="flex bg-slate-100 p-1 rounded-xl border border-gray-200 shadow-inner z-50">
                <button 
                  onClick={() => setActiveModal('suited')} 
                  className={`px-5 py-2 rounded-lg text-xs font-black transition-all ${activeModal === 'suited' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-600 hover:bg-slate-200'}`}
                >
                  Pary & Suited
                </button>
                <button 
                  onClick={() => setActiveModal('offsuit')} 
                  className={`px-5 py-2 rounded-lg text-xs font-black transition-all ${activeModal === 'offsuit' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-600 hover:bg-slate-200'}`}
                >
                  Off-Suit
                </button>
              </div>
            </div>

            <button onClick={() => setActiveModal(null)} className="p-2.5 bg-slate-100 hover:bg-slate-200 rounded-full transition-colors z-50">
              <X size={24} className="text-slate-600" />
            </button>
          </div>
          
          {/* Legenda */}
          <div className="flex gap-5 mb-6 text-xs font-bold uppercase tracking-wider text-gray-600 flex-wrap bg-slate-50 p-3 rounded-xl border">
             <div className="flex items-center gap-2"><div className="w-4 h-4 rounded bg-emerald-500"></div> &ge; 60% (Świetne WR)</div>
             <div className="flex items-center gap-2"><div className="w-4 h-4 rounded bg-lime-400"></div> 55-59% (Dobre)</div>
             <div className="flex items-center gap-2"><div className="w-4 h-4 rounded bg-yellow-300"></div> 48-54% (Średnie / Okolice 50%)</div>
             <div className="flex items-center gap-2"><div className="w-4 h-4 rounded bg-orange-400"></div> 35-47% (Słabe)</div>
             <div className="flex items-center gap-2"><div className="w-4 h-4 rounded bg-red-500"></div> &lt; 35% (Koszmar)</div>
             <div className="flex items-center gap-2 ml-4"><div className="w-4 h-4 rounded bg-white border border-gray-200"></div> Brak danych</div>
          </div>

          <div className="flex-1 overflow-auto custom-scrollbar flex justify-center pb-8 pt-6">
             {renderGrid(activeModal)}
          </div>
        </div>
      )}

      {/* STANDARDOWY WIDOK LISTY */}
      <div className="border-b pb-4 mb-4 shrink-0 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-gray-800">Statystyka Rąk Startowych</h3>
          <div className="flex gap-2 mt-2">
            <button onClick={() => setViewMode('classic')} className={`px-3 py-1 rounded-lg text-xs font-bold ${viewMode === 'classic' ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-600'}`}>Klasyczny</button>
            <button onClick={() => setViewMode('advanced')} className={`px-3 py-1 rounded-lg text-xs font-bold ${viewMode === 'advanced' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600'}`}>Zaawansowany</button>
          </div>
        </div>
        
        <div className="flex flex-col gap-2 items-end">
          {/* PRZYCISKI DO OTWIERANIA MODALI */}
          <div className="flex gap-2">
            <button onClick={() => setActiveModal('suited')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 shadow-sm transition-colors">
              <Grid size={14}/> Mapa Par & Suited
            </button>
            <button onClick={() => setActiveModal('offsuit')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 shadow-sm transition-colors">
              <Grid size={14}/> Mapa Off-Suit
            </button>
          </div>
          
          <div className="flex gap-1 bg-slate-100 p-1 rounded-xl border">
            {['all', 'pair', 'suited', 'offsuit'].map(type => (
               <button key={type} onClick={() => setCardTypeFilter(type)} className={`px-2.5 py-1.5 rounded-lg text-xs font-bold ${cardTypeFilter === type ? 'bg-white shadow-sm' : ''}`}>
                 {type.toUpperCase()}
               </button>
            ))}
          </div>
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
                   <div className="bg-indigo-100 h-5 rounded-md flex overflow-hidden border border-indigo-200 w-full">
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