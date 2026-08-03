import React from 'react';

export const CardIcon = ({ cardStr }) => {
  if (!cardStr || cardStr.length < 2) return null;
  
  // Pobieramy wartość i wymuszamy wielką literę (J, Q, K, A)
  let value = cardStr.slice(0, -1).toUpperCase();
  // Zamiana T na 10
  if (value === 'T') value = '10';
  
  const suit = cardStr.slice(-1).toLowerCase();

  const suitMap = {
    c: { symbol: '♣', color: 'text-green-600' }, 
    d: { symbol: '♦', color: 'text-blue-600' },  
    h: { symbol: '♥', color: 'text-red-600' },   
    s: { symbol: '♠', color: 'text-gray-900' }   
  };

  const currentSuit = suitMap[suit] || { symbol: suit, color: 'text-gray-700' };

  return (
    <div className="inline-flex flex-col items-center justify-center bg-white border border-gray-300 rounded px-1 py-0.5 mx-0.5 shadow-sm min-w-[28px]">
      <span className="text-[10px] font-bold text-gray-800 leading-none">{value}</span>
      <span className={`text-xs leading-none font-sans ${currentSuit.color}`}>{currentSuit.symbol}</span>
    </div>
  );
};