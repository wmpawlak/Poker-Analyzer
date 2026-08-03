// src/components/HandTile.jsx
import React from 'react';
import { CardIcon } from './CardIcon.jsx';

export const HandTile = ({ hand, onClick }) => {
  if (hand.isRebuy) {
    return (
      <div className="flex flex-col items-center justify-center p-3.5 bg-red-50 border border-red-200 rounded-xl mb-3 shadow-sm relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9InJnYmEoMjM5LCA2OCwgNjgsIDAuMSkiLz48L3N2Zz4=')] opacity-50"></div>
        <span className="relative z-10 text-red-700 font-black text-sm uppercase tracking-wider flex items-center gap-2">💸 Rebuy Dokonany</span>
        <span className="relative z-10 text-red-600 font-bold text-xs mt-1">Dodano +{hand.rebuyValue.toLocaleString()} żetonów</span>
      </div>
    );
  }

  const isTourney = hand.isTournament;
  let tileBg = "bg-white hover:bg-slate-50 border-gray-200";
  if (hand.outcome === 'WON') tileBg = "bg-green-50/50 hover:bg-green-100/60 border-green-200";
  if (hand.outcome === 'LOST') tileBg = "bg-red-50/50 hover:bg-red-100/60 border-red-200";
  const prefix = isTourney ? '' : '₮';
  const displayProfit = isTourney ? Math.abs(hand.netProfit).toLocaleString('en-US', {maximumFractionDigits: 2}) : Math.abs(hand.netProfit).toFixed(2);

  const safeHeroCards = hand.heroCards || [];
  const safeBoardCards = hand.boardCards || [];

  return (
    <div onClick={() => onClick(hand.id)} className={`flex items-center justify-between p-3.5 border rounded-xl cursor-pointer transition-all ${tileBg} shadow-sm active:scale-[0.99] mb-3`}>
      <div className="flex items-center gap-4 w-5/12">
        <div className="flex flex-col items-center bg-white px-2 py-1.5 rounded-lg border shadow-xs min-w-[65px]">
          <div className="flex items-center gap-0.5">{safeHeroCards.length > 0 ? safeHeroCards.map((c, i) => <CardIcon key={i} cardStr={c} />) : <span className="text-[10px] text-gray-400">Fold</span>}</div>
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-bold text-gray-800 flex items-center gap-2">{hand.handRanking}</span>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] font-mono font-bold bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">{hand.position}</span>
            <span className="text-[10px] text-gray-400 font-mono">{hand.dateStr} {hand.timeStr}</span>
          </div>
        </div>
      </div>
      <div className="flex-1 flex justify-center items-center">
        {safeBoardCards.length > 0 && <div className="flex items-center gap-0.5 bg-slate-100/80 p-1.5 rounded-lg border border-gray-200 shadow-inner">{safeBoardCards.map((c, i) => <CardIcon key={i} cardStr={c} />)}</div>}
      </div>
      <div className="flex items-center justify-end w-3/12 text-right">
        <span className={`font-mono text-base font-black tracking-tighter ${hand.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{hand.netProfit >= 0 ? `+${prefix}${displayProfit}` : `-${prefix}${displayProfit}`}</span>
      </div>
    </div>
  );
};