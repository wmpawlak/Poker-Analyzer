// src/parser/pokerParser.js

const parsePokerDate = (dateStr) => {
  if (!dateStr) return new Date();
  const cleanStr = dateStr.replace(/CE[S]?T|GMT|UTC/g, '').trim();
  const formattedStr = cleanStr.replace(/\//g, '-').replace(' ', 'T');
  const d = new Date(formattedStr);
  return isNaN(d.getTime()) ? new Date() : d;
};

const parseChips = (valStr) => {
  if (!valStr) return 0;
  if (typeof valStr === 'number') return valStr;
  return parseFloat(valStr.replace(/[^\d.-]/g, '')) || 0;
};

export const parseRawHandHistory = (rawText) => {
  const rawHands = rawText.split(/(?=CoinPoker Hand #)/i);
  const parsedHands = [];

  for (let rawHand of rawHands) {
    if (!rawHand.trim()) continue;

    try {
      const handData = {
        id: '', timestamp: null, dateStr: '', timeStr: '', blinds: '', gameType: 'NLH',
        heroCards: [], boardCards: [], handRanking: '', heroInvestment: 0,
        heroWinnings: 0, netProfit: 0, outcome: 'FOLDED', rawText: rawHand.trim(),
        position: 'UNKNOWN', streets: [], isTournament: false, heroStartingStack: 0,
        tableId: '', tourneyName: '', tourneyId: '',
        heroVPIP: false, heroPFR: false, sawShowdown: false,
        heroPostFlopBetsRaises: 0, heroPostFlopCalls: 0,
        opponents: []
      };

      const idMatch = rawHand.match(/CoinPoker Hand #(\d+)/i);
      if (!idMatch) continue;
      handData.id = idMatch[1];

      const tableMatch = rawHand.match(/Table '([^']+)'/i);
      if (tableMatch) handData.tableId = tableMatch[1];

      const tourneyMatch = rawHand.match(/Tournament '([^']+)' '([^']+)'/i);
      if (tourneyMatch) {
        handData.isTournament = true;
        handData.tourneyName = tourneyMatch[1];
        handData.tourneyId = tourneyMatch[2];
      }

      const stackMatch = rawHand.match(/Seat \d+:\s+Hero\s*\([^\d]*([\d.,]+)\s+in chips\)/i);
      if (stackMatch) handData.heroStartingStack = parseChips(stackMatch[1]);

      const lines = rawHand.split(/\r?\n/).map(l => l.trim()).filter(l => l);
      if (lines.length === 0) continue;

      const dateMatch = lines[0].match(/(\d{4}[-/]\d{2}[-/]\d{2}.*)/);
      if (dateMatch) {
        handData.dateStr = dateMatch[1].trim();
        const d = parsePokerDate(handData.dateStr);
        handData.timestamp = d.getTime();
      } else {
        handData.timestamp = new Date().getTime();
      }

      const boardMatch = rawHand.match(/Board \[\s*(.+?)\s*\]/i);
      if (boardMatch) handData.boardCards = boardMatch[1].split(' ').filter(c => c.trim() !== '');

      const cardsMatch = rawHand.match(/Dealt to Hero \[(.+?)\]/i);
      if (cardsMatch) handData.heroCards = cardsMatch[1].split(' ');

      // DEDUPLIKACJA MIEJSC (NAPRAWIA BŁĄD Z UTG+3 w 6-max)
      // Zapobiega liczeniu gracza podwójnie z sekcji "Summary" na końcu rozdania
      const seats = [...rawHand.matchAll(/Seat (\d+): ([^\s()]+)/gi)]; 
      let activeSeats = [];
      let seenSeats = new Set();
      
      seats.forEach(seat => {
        const sNum = parseInt(seat[1]);
        const playerId = seat[2].trim();
        if (!seenSeats.has(sNum)) {
            seenSeats.add(sNum);
            activeSeats.push({ seatNum: sNum, playerId });
            if (playerId !== 'Hero') handData.opponents.push(playerId);
        }
      });

      const streetBlocks = rawHand.split(/(?=\*\*\* (?:HOLE CARDS|FLOP|TURN|RIVER|SHOWDOWN|SUMMARY))/);
      const streets = [];
      
      streetBlocks.forEach(block => {
        if (!block.trim()) return;
        const blockLines = block.split(/\r?\n/).map(l => l.trim()).filter(l => l);
        
        const stMatch = blockLines[0].match(/\*\*\* (HOLE CARDS|FLOP|TURN|RIVER|SHOWDOWN|SUMMARY)(.*)/);
        
        if (stMatch) {
          let name = stMatch[1];
          if (name === 'HOLE CARDS') name = 'PRE-FLOP';
          if (name === 'SHOWDOWN') handData.sawShowdown = true;

          let cards = [];
          if (['FLOP', 'TURN', 'RIVER'].includes(name)) {
            const brackets = [...stMatch[2].matchAll(/\[(.*?)\]/g)];
            if (brackets.length > 0) cards = brackets[brackets.length - 1][1].split(' ').filter(c => c.trim() !== '');
          }
          
          const actionLines = blockLines.slice(1).filter(l => !l.startsWith('Dealt to') && !l.startsWith('Total pot') && !l.startsWith('Board') && !l.startsWith('Hand was') && !l.startsWith('Game ended'));
          
          actionLines.forEach(line => {
             if (line.startsWith('Hero:')) {
                const isRaise = line.includes('raises') || line.includes('ALLIN');
                const isBet = line.includes('bets');
                const isCall = line.includes('calls');

                if (name === 'PRE-FLOP') {
                   if (isRaise || isBet || isCall) handData.heroVPIP = true;
                   if (isRaise) handData.heroPFR = true;
                } else if (['FLOP', 'TURN', 'RIVER'].includes(name)) {
                   if (isRaise || isBet) handData.heroPostFlopBetsRaises++;
                   if (isCall) handData.heroPostFlopCalls++;
                }
             }
          });

          if (actionLines.length > 0 || cards.length > 0) streets.push({ name, cards, lines: actionLines });
        }
      });
      handData.streets = streets;

      let totalInvested = 0;
      let totalReturned = 0;
      let currentStreetInvestment = 0;

      for (let line of lines) {
        if (line.startsWith('***')) { currentStreetInvestment = 0; continue; }
        if (line.startsWith('Hero:')) {
          const anteMatch = line.match(/posts ante\s+[^\d]*([\d.,]+)/i);
          if (anteMatch) { totalInvested += parseChips(anteMatch[1]); continue; }
          const blindMatch = line.match(/posts\s+(?:small|big)\s+blind\s+[^\d]*([\d.,]+)/i);
          if (blindMatch) { const val = parseChips(blindMatch[1]); totalInvested += (val - currentStreetInvestment); currentStreetInvestment = val; continue; }
          const actionMatch = line.match(/(?:calls|bets|ALLIN)\s+[^\d]*([\d.,]+)/i);
          if (actionMatch) { const val = parseChips(actionMatch[1]); totalInvested += val; currentStreetInvestment += val; continue; }
          const raiseMatch = line.match(/raises\s+[^\d]*[\d.,]+\s+to\s+[^\d]*([\d.,]+)/i);
          if (raiseMatch) { const val = parseChips(raiseMatch[1]); totalInvested += (val - currentStreetInvestment); currentStreetInvestment = val; continue; }
          const returnMatch = line.match(/RETURN\s+[^\d]*([\d.,]+)/i);
          if (returnMatch) { totalReturned += parseChips(returnMatch[1]); continue; }
        }
      }

      handData.heroInvestment = parseFloat((totalInvested - totalReturned).toFixed(2));

      let isWinner = false;
      const heroSummaryLine = lines.find(l => l.match(/^Seat \d+:\s+Hero\s+/i));
      
      if (heroSummaryLine && heroSummaryLine.includes('and won')) isWinner = true;
      else if (rawHand.match(/Hero collected/i)) isWinner = true;
      else if (rawHand.match(/Hero.*? won /i)) isWinner = true;

      if (isWinner) {
        handData.outcome = 'WON';
        const collectMatch = rawHand.match(/Hero collected\s+[^\d]*([\d.,]+)/i);
        const wonMatch = rawHand.match(/Hero.*?won\s*\([^\d]*([\d.,]+)\)/i);
        if (collectMatch) handData.heroWinnings = parseChips(collectMatch[1]);
        else if (wonMatch) handData.heroWinnings = parseChips(wonMatch[1]);
        else handData.heroWinnings = 0; 
      } else {
        handData.outcome = handData.heroInvestment > 0 ? 'LOST' : 'FOLDED';
        handData.heroWinnings = 0;
      }

      handData.netProfit = parseFloat((handData.heroWinnings - handData.heroInvestment).toFixed(2));

      // PRECYZYJNA LOGIKA POZYCJI ODLICZANA OD BIG BLINDA
      if (activeSeats.length >= 2) {
        activeSeats.sort((a, b) => a.seatNum - b.seatNum);
        
        // Szukamy regularnego BB ignorując 'auto big blind'
        const bbMatch = rawHand.match(/^([^:]+):\s+posts (?:small & )?big blind/m);
        let bbIndex = -1;
        
        if (bbMatch) {
            bbIndex = activeSeats.findIndex(s => s.playerId === bbMatch[1]);
        }
        
        // Zabezpieczenie: jeśli nie znaleziono czystego BB, próbujemy policzyć to od Buttona
        if (bbIndex === -1) {
            const btnMatch = rawHand.match(/Seat #(\d+) is the button/i);
            if (btnMatch) {
                const btnSeat = parseInt(btnMatch[1]);
                const btnIndex = activeSeats.findIndex(s => s.seatNum === btnSeat);
                if (btnIndex !== -1) {
                    bbIndex = activeSeats.length === 2 ? (btnIndex + 1) % 2 : (btnIndex + 2) % activeSeats.length;
                }
            }
        }

        const heroIndex = activeSeats.findIndex(s => s.playerId === 'Hero');

        if (heroIndex !== -1 && bbIndex !== -1) {
           const N = activeSeats.length;
           const distFromBB = (heroIndex - bbIndex + N) % N;
           
           let posMap = [];
           // Skalowalna mapa (obsłuży również stoły z innej liczby graczy jeśli takie wyślesz)
           if (N === 2) posMap = ['BB', 'BTN'];
           else if (N === 3) posMap = ['BB', 'BTN', 'SB'];
           else if (N === 4) posMap = ['BB', 'CO', 'BTN', 'SB'];
           else if (N === 5) posMap = ['BB', 'HJ', 'CO', 'BTN', 'SB'];
           else if (N === 6) posMap = ['BB', 'UTG', 'HJ', 'CO', 'BTN', 'SB'];
           else if (N === 7) posMap = ['BB', 'UTG', 'UTG+1', 'HJ', 'CO', 'BTN', 'SB'];
           else if (N === 8) posMap = ['BB', 'UTG', 'UTG+1', 'UTG+2', 'HJ', 'CO', 'BTN', 'SB'];
           else if (N >= 9) posMap = ['BB', 'UTG', 'UTG+1', 'UTG+2', 'UTG+3', 'HJ', 'CO', 'BTN', 'SB'];

           handData.position = posMap[distFromBB] || 'UNKNOWN';
        }
      }

      parsedHands.push(handData);
    } catch (e) {
      console.error(e);
    }
  }
  return parsedHands.sort((a, b) => a.timestamp - b.timestamp);
};

export const buildSessions = (hands) => {
  const sessionMap = {};
  hands.forEach((hand) => {
    if (hand.isTournament) return;
    const tableId = hand.tableId || 'Nieznany';
    const sId = `${tableId}_${hand.dateStr.split(' ')[0]}`;
    if (!sessionMap[sId]) {
      sessionMap[sId] = {
        id: `session_${sId}`, tableId: tableId, startTime: hand.timestamp, lastTimestamp: hand.timestamp,
        dateStr: hand.dateStr, hands: [], totalProfit: 0, type: 'Cash'
      };
    }
    const currentSession = sessionMap[sId];
    currentSession.hands.push({ ...hand, sessionHandIndex: currentSession.hands.length + 1 });
    currentSession.totalProfit += hand.netProfit;
    currentSession.lastTimestamp = Math.max(currentSession.lastTimestamp, hand.timestamp);
  });
  return Object.values(sessionMap).map(finalizeSession).sort((a, b) => b.startTime - a.startTime);
};

const finalizeSession = (session) => {
  let runningProfit = 0;
  session.chartData = session.hands.map(hand => {
    runningProfit += hand.netProfit;
    return { handIndex: hand.sessionHandIndex, profit: parseFloat(runningProfit.toFixed(2)) };
  });
  session.totalProfit = parseFloat(session.totalProfit.toFixed(2));
  return session;
};

export const buildTourneySessions = (hands) => {
  const tourneyMap = {};
  hands.forEach((hand) => {
    if (!hand.isTournament) return;
    const tId = hand.tourneyId ? `${hand.tourneyId}_${hand.dateStr.split(' ')[0]}` : `unknown_${hand.timestamp}`;
    if (!tourneyMap[tId]) {
      tourneyMap[tId] = {
        id: `tourney_${tId}`, tourneyId: hand.tourneyId || 'Nieznane ID', tourneyName: hand.tourneyName || 'Nieznany Turniej',
        startTime: hand.timestamp, lastTimestamp: hand.timestamp, dateStr: hand.dateStr, hands: [], 
        totalProfit: 0, type: 'Tournament', rebuys: 0, startStack: hand.heroStartingStack
      };
    }
    const currentSession = tourneyMap[tId];
    if (currentSession.hands.length > 0) {
      const lastActualHands = currentSession.hands.filter(h => !h.isRebuy);
      if (lastActualHands.length > 0) {
        const lastHand = lastActualHands[lastActualHands.length - 1];
        const expectedStack = lastHand.heroStartingStack + lastHand.netProfit;
        if (hand.heroStartingStack > expectedStack + 100) {
          currentSession.rebuys += 1;
          const rebuyAmount = hand.heroStartingStack - expectedStack;
          currentSession.hands.push({
            id: `rebuy_${hand.id}`, timestamp: hand.timestamp - 1, isRebuy: true, rebuyValue: rebuyAmount,
            isTournament: true, netProfit: 0, heroStartingStack: expectedStack, sessionHandIndex: currentSession.hands.length + 1,
            heroCards: [], boardCards: [], opponents: []
          });
        }
      }
    }
    currentSession.hands.push({ ...hand, sessionHandIndex: currentSession.hands.length + 1 });
    currentSession.totalProfit += hand.netProfit;
    currentSession.lastTimestamp = Math.max(currentSession.lastTimestamp, hand.timestamp);
  });
  return Object.values(tourneyMap).map(finalizeTourneySession).sort((a, b) => b.startTime - a.startTime);
};

const finalizeTourneySession = (session) => {
  session.chartData = session.hands.map(hand => {
    return { 
      handIndex: hand.sessionHandIndex, 
      stack: hand.isRebuy ? hand.heroStartingStack + hand.rebuyValue : hand.heroStartingStack + hand.netProfit,
      profit: hand.netProfit,
      isRebuy: hand.isRebuy || false
    };
  });
  session.totalProfit = parseFloat(session.totalProfit.toFixed(2));
  return session;
};