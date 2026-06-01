// src/hooks/usePokerMetrics.js
import { useMemo } from 'react';
import { useSelector } from 'react-redux';

export const usePokerMetrics = (gameTypeFilter = 'both') => {
  const { sessions, tournaments } = useSelector((state) => state.poker);

  const activeHands = useMemo(() => {
    let h = [];
    if (gameTypeFilter === 'both') h = [...sessions, ...tournaments].flatMap(s => s.hands);
    else if (gameTypeFilter === 'cash') h = sessions.flatMap(s => s.hands);
    else if (gameTypeFilter === 'tournament') h = tournaments.flatMap(s => s.hands);
    return h.filter(hand => !hand.isRebuy);
  }, [sessions, tournaments, gameTypeFilter]);

  const heroMetrics = useMemo(() => {
    if (activeHands.length === 0) return null;
    let vpip = 0, pfr = 0, wtsd = 0, wsd = 0, betsRaises = 0, calls = 0, profit = 0;
    
    activeHands.forEach(h => {
       if (h.heroVPIP) vpip++;
       if (h.heroPFR) pfr++;
       if (h.sawShowdown) wtsd++;
       if (h.sawShowdown && h.outcome === 'WON') wsd++;
       betsRaises += h.heroPostFlopBetsRaises || 0;
       calls += h.heroPostFlopCalls || 0;
       profit += h.netProfit;
    });

    return {
      totalHands: activeHands.length,
      vpip: ((vpip / activeHands.length) * 100).toFixed(1),
      pfr: ((pfr / activeHands.length) * 100).toFixed(1),
      af: calls === 0 ? (betsRaises > 0 ? '∞' : '0.0') : (betsRaises / calls).toFixed(2),
      wtsd: ((wtsd / activeHands.length) * 100).toFixed(1),
      wsd: wtsd === 0 ? '0.0' : ((wsd / wtsd) * 100).toFixed(1),
      totalProfit: profit.toFixed(2),
      winrate: ((profit / activeHands.length) * 100).toFixed(2)
    };
  }, [activeHands]);

  const opponentsMetrics = useMemo(() => {
    const oppMap = {};
    activeHands.forEach(h => {
       if (!h.opponents) return;
       const uniqueSessId = h.isTournament ? h.tourneyId : `${h.tableId}_${h.dateStr.split(' ')[0]}`;

       h.opponents.forEach(opp => {
          if (!oppMap[opp]) oppMap[opp] = { id: opp, handsPlayed: 0, sessions: new Set(), showdowns: 0, heroWins: 0, heroLosses: 0, netExchanged: 0 };
          const o = oppMap[opp];
          o.handsPlayed++; o.sessions.add(uniqueSessId);
          if (h.sawShowdown) o.showdowns++;
          if (h.outcome === 'WON') { o.heroWins++; o.netExchanged += h.netProfit; } 
          else if (h.outcome === 'LOST') { o.heroLosses++; o.netExchanged += h.netProfit; }
       });
    });

    return Object.values(oppMap).map(o => ({ ...o, sessionsCount: o.sessions.size })).sort((a, b) => b.handsPlayed - a.handsPlayed);
  }, [activeHands]);

  return { activeHands, heroMetrics, opponentsMetrics };
};