// src/hooks/usePokerMetrics.js
import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { calculateHeroMetrics } from '../utils/heroMetrics.js';

export const usePokerMetrics = (gameTypeFilter = 'both') => {
  const { sessions, tournaments } = useSelector((state) => state.poker);

  const activeHands = useMemo(() => {
    let h = [];
    if (gameTypeFilter === 'both') h = [...sessions, ...tournaments].flatMap(s => s.hands);
    else if (gameTypeFilter === 'cash') h = sessions.flatMap(s => s.hands);
    else if (gameTypeFilter === 'tournament') h = tournaments.flatMap(s => s.hands);
    return h.filter(hand => !hand.isRebuy);
  }, [sessions, tournaments, gameTypeFilter]);

  const heroMetrics = useMemo(() => calculateHeroMetrics(activeHands), [activeHands]);

  const opponentsMetrics = useMemo(() => {
    const oppMap = {};
    
    activeHands.forEach(h => {
       if (!h.opponents || !Array.isArray(h.opponents)) return;
       
       const uniqueSessId = h.isTournament ? h.tourneyId : `${h.tableId}_${h.dateStr.split(' ')[0]}`;

       h.opponents.forEach(rawOpp => {
          const opp = String(rawOpp).trim();
          if (!opp) return;

          if (!oppMap[opp]) {
            oppMap[opp] = { 
              id: opp, 
              handsPlayed: 0, 
              sessions: new Set(), 
              showdowns: 0, 
              heroWins: 0, 
              heroLosses: 0, 
              netExchanged: 0 
            };
          }
          
          const o = oppMap[opp];
          o.handsPlayed += 1; 
          o.sessions.add(uniqueSessId);
          
          if (h.sawShowdown) o.showdowns += 1;
          
          // Sprawiedliwe rozbicie zysku/straty na ilość zaangażowanych graczy
          const profitShare = h.netProfit / h.opponents.length;
          
          if (h.outcome === 'WON') { 
            o.heroWins += 1; 
            o.netExchanged += profitShare; 
          } else if (h.outcome === 'LOST') { 
            o.heroLosses += 1; 
            o.netExchanged += profitShare; 
          }
       });
    });

    // Filtrujemy niekompatybilny obiekt 'Set' przy mapowaniu wartości na listę końcową
    return Object.values(oppMap).map(o => {
       const { sessions, ...rest } = o;
       return { 
           ...rest, 
           sessionsCount: sessions.size 
       };
    }).sort((a, b) => b.handsPlayed - a.handsPlayed);
  }, [activeHands]);

  return { activeHands, heroMetrics, opponentsMetrics };
};
