// src/hooks/usePokerMetrics.js
import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { calculateHeroMetrics } from '../utils/heroMetrics.js';

export const usePokerMetrics = (gameTypeFilter = 'both') => {
  const { sessions, tournaments } = useSelector((state) => state.poker);

  const cashHands = useMemo(
    () => sessions.flatMap((session) => session.hands).filter((hand) => !hand.isRebuy),
    [sessions],
  );
  const tournamentHands = useMemo(
    () => tournaments.flatMap((tournament) => tournament.hands).filter((hand) => !hand.isRebuy),
    [tournaments],
  );

  const activeHands = useMemo(() => {
    if (gameTypeFilter === 'cash') return cashHands;
    if (gameTypeFilter === 'tournament') return tournamentHands;
    return [...cashHands, ...tournamentHands];
  }, [cashHands, tournamentHands, gameTypeFilter]);

  const heroMetrics = useMemo(
    () => calculateHeroMetrics(activeHands, gameTypeFilter),
    [activeHands, gameTypeFilter],
  );

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

  return {
    activeHands,
    cashHands,
    tournamentHands,
    heroMetrics,
    opponentsMetrics,
  };
};
