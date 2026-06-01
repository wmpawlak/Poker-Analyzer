// src/store/pokerSlice.js
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { parseRawHandHistory, buildSessions, buildTourneySessions } from '../parser/pokerParser.js';

export const verifyApiKey = createAsyncThunk(
  'poker/verifyApi',
  async (apiKey, { rejectWithValue }) => {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }] })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error?.message || 'Błąd Gemini API');
      }
      return true;
    } catch (e) {
      return rejectWithValue(e.message);
    }
  }
);

export const analyzeHandWithAI = createAsyncThunk(
  'poker/analyzeHand',
  async ({ handText, apiKey }, { rejectWithValue }) => {
    try {
      const prompt = `Jesteś profesjonalnym, ale przystępnym trenerem pokera. Przeanalizuj to rozdanie krok po kroku z perspektywy gracza "Hero". 
MUSISZ zwrócić odpowiedź WYŁĄCZNIE jako poprawny obiekt JSON. Żadnego tekstu przed i po JSONie.
ZAWSZE odpowiadaj w języku polskim. 
Używaj prostego, naturalnego języka. Unikaj skomplikowanego żargonu matematycznego (np. skomplikowanych pojęć GTO). Skup się na praktycznej ocenie zagrań, błędach w sizingach i czytaniu zachowania przeciwników. 

BARDZO WAŻNE DOTYCZĄCE KART:
Jeśli w komentarzach wymieniasz jakiekolwiek karty (zarówno z ręki, jak i ze stołu), MUSISZ użyć wyłącznie formatu nawiasów kwadratowych, np. [Kh As], [Tc], [Qd 2c].
ABSOLUTNIE NIE PISZ słownych nazw kart! ZABRONIONE JEST pisanie np. "[Kh Ah] (As-Król Kier)" czy "Para Króli". Zamiast tego napisz po prostu "[Kh Ah]" lub "[Kc Kd]". Traktuj zapis w nawiasach kwadratowych jako jedyny istniejący sposób opisu kart.

Struktura JSON musi wyglądać dokładnie tak:
{
  "preflop": "Twój komentarz pre-flop po polsku, karty np. [As Kd]",
  "flop": "Twój komentarz do gry na flopie (lub null jeśli runda się nie odbyła)",
  "turn": "Twój komentarz do gry na turnie (lub null)",
  "river": "Twój komentarz do gry na riverze (lub null)",
  "summary": "Ogólne wnioski co było dobre, a co złe. Krótko, jasno i na temat."
}
Oto log rozdania:\n\n${handText}`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });
      
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error?.message || 'Błąd Gemini API');
      }
      
      let aiText = data.candidates[0].content.parts[0].text;
      aiText = aiText.replace(/```json/gi, '').replace(/```/g, '').trim();
      
      try {
        return JSON.parse(aiText);
      } catch (parseError) {
        return { summary: aiText };
      }
      
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);
const initialState = {
  sources: [], // Magazyn wgranych plików źródłowych
  rawHands: [], 
  sessions: [], 
  tournaments: [],
  heroMetrics: null,
  opponentsMetrics: [],
  apiKey: localStorage.getItem('poker_gemini_key') || '',
  apiStatus: 'idle', 
  selectedSessionId: null,
  selectedTourneyId: null,
  selectedHandId: null,
  aiAnalyses: JSON.parse(localStorage.getItem('poker_ai_analyses')) || {},
  loadingAI: false,
  errorAI: null
};

// Funkcja pomocnicza do przeliczania rozdań na podstawie TYLKO aktywnych plików
const recalculateAllHands = (state) => {
  const enabledText = state.sources
    .filter(s => s.enabled)
    .map(s => s.content)
    .join('\n\n');

  const allHands = parseRawHandHistory(enabledText);
  state.rawHands = allHands;
  
  const cashHands = allHands.filter(h => !h.isTournament);
  const tourneyHands = allHands.filter(h => h.isTournament);
  
  state.sessions = buildSessions(cashHands);
  state.tournaments = buildTourneySessions(tourneyHands, 20);

  // Aggregating Metrics
  const heroStats = {
    vpipCount: 0,
    pfrCount: 0,
    totalHands: allHands.length,
    wtsdCount: 0,
    wsdCount: 0,
    totalProfit: 0,
    totalBets: 0,
    totalRaises: 0,
    totalCalls: 0
  };

  const opponents = {};

  allHands.forEach(hand => {
    const players = hand.players || {};
    
    // Hero Stats
    const hero = players['Hero'];
    if (hero) {
      if (hero.vpip) heroStats.vpipCount++;
      if (hero.pfr) heroStats.pfrCount++;
      if (hero.reachedShowdown) heroStats.wtsdCount++;
      if (hero.wonShowdown) heroStats.wsdCount++;
      heroStats.totalProfit += hero.netProfit;
      heroStats.totalBets += hero.bets;
      heroStats.totalRaises += hero.raises;
      heroStats.totalCalls += hero.calls;
    }

    // Opponent Stats
    Object.keys(players).forEach(name => {
      if (name === 'Hero') return;
      if (!opponents[name]) {
        opponents[name] = {
          name,
          hands: 0,
          showdowns: 0,
          wins: 0,
          losses: 0,
          netProfit: 0,
          sessions: new Set()
        };
      }
      const opp = opponents[name];
      opp.hands++;
      if (players[name].reachedShowdown) opp.showdowns++;
      if (players[name].wonHand) opp.wins++;
      else if (players[name].investment > 0) opp.losses++;
      opp.netProfit += players[name].netProfit;
      
      const sId = hand.isTournament ? hand.tourneyId : hand.tableId;
      if (sId) opp.sessions.add(sId);
    });
  });

  // Finalize Hero Stats
  state.heroMetrics = {
    vpip: heroStats.totalHands > 0 ? (heroStats.vpipCount / heroStats.totalHands) * 100 : 0,
    pfr: heroStats.totalHands > 0 ? (heroStats.pfrCount / heroStats.totalHands) * 100 : 0,
    af: heroStats.totalCalls > 0 ? (heroStats.totalBets + heroStats.totalRaises) / heroStats.totalCalls : (heroStats.totalBets + heroStats.totalRaises > 0 ? 100 : 0),
    wtsd: heroStats.totalHands > 0 ? (heroStats.wtsdCount / heroStats.totalHands) * 100 : 0,
    wsd: heroStats.wtsdCount > 0 ? (heroStats.wsdCount / heroStats.wtsdCount) * 100 : 0,
    winrate: heroStats.totalHands > 0 ? (heroStats.totalProfit / heroStats.totalHands) : 0,
    totalProfit: heroStats.totalProfit,
    totalHands: heroStats.totalHands
  };

  // Finalize Opponent Stats
  state.opponentsMetrics = Object.values(opponents).map(opp => ({
    ...opp,
    sessionCount: opp.sessions.size,
    netProfit: parseFloat(opp.netProfit.toFixed(2))
  })).sort((a, b) => b.hands - a.hands);
};

const pokerSlice = createSlice({
  name: 'poker',
  initialState,
  reducers: {
    uploadHandHistory: (state, action) => {
      const { filename, content } = action.payload;
      const isTourney = /Tournament '/i.test(content);
      
      state.sources.push({
        id: `src_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        filename,
        content,
        type: isTourney ? 'Tournament' : 'Cash',
        enabled: true,
        dateAdded: new Date().toISOString()
      });
      
      recalculateAllHands(state);
    },
    toggleSource: (state, action) => {
      const src = state.sources.find(s => s.id === action.payload);
      if (src) {
        src.enabled = !src.enabled;
        recalculateAllHands(state);
      }
    },
    removeSource: (state, action) => {
      state.sources = state.sources.filter(s => s.id !== action.payload);
      recalculateAllHands(state);
    },
    setApiKey: (state, action) => {
      state.apiKey = action.payload;
      state.apiStatus = 'idle';
      localStorage.setItem('poker_gemini_key', action.payload);
    },
    selectSession: (state, action) => { state.selectedSessionId = action.payload; state.selectedHandId = null; },
    selectTourney: (state, action) => { state.selectedTourneyId = action.payload; state.selectedHandId = null; },
    selectHand: (state, action) => { state.selectedHandId = action.payload; },
    clearData: (state) => {
      state.sources = []; state.rawHands = []; state.sessions = []; state.tournaments = []; 
      state.selectedSessionId = null; state.selectedTourneyId = null; state.selectedHandId = null;
      state.aiAnalyses = {}; localStorage.removeItem('poker_ai_analyses');
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(verifyApiKey.pending, (state) => { state.apiStatus = 'testing'; })
      .addCase(verifyApiKey.fulfilled, (state) => { state.apiStatus = 'valid'; })
      .addCase(verifyApiKey.rejected, (state) => { state.apiStatus = 'invalid'; })
      .addCase(analyzeHandWithAI.pending, (state) => { state.loadingAI = true; state.errorAI = null; })
      .addCase(analyzeHandWithAI.fulfilled, (state, action) => {
        state.loadingAI = false;
        state.aiAnalyses[state.selectedHandId] = action.payload;
        localStorage.setItem('poker_ai_analyses', JSON.stringify(state.aiAnalyses));
      })
      .addCase(analyzeHandWithAI.rejected, (state, action) => { state.loadingAI = false; state.errorAI = action.payload; });
  }
});

export const { uploadHandHistory, toggleSource, removeSource, setApiKey, selectSession, selectTourney, selectHand, clearData } = pokerSlice.actions;
export default pokerSlice.reducer;

//Chciałbym żebyś mi zrobił podstawowe metryki gracza pokerowego w nowej zakładce "Mój profil". Które to statystki wyliczają się do gracza Hero. Statystyki takie: VPIP, PFR, AF, WSTD, WATSD, Winrate

//Dodatkowo kolejna zakładka "Przeciwnicy" z listą zawodników-przeciwników na bazie ich ID - żeby móc zobaczyć z kim najwięcej grałem/wygrałem/przegrałem. Czyli żeby było wypisane ile rozdań, ile sesji, ile razy showdown, ile razy wygrałem, ile razy przegrałem, jaka wartość łączna wygranych/przegranych - danych/oddanych żetonów

//Lista układów które są najlepsze poszła w złym kierunku - chciałbym żeby ona sprawdziła moja historię wszystkich rozdań cash + turnieje i pokazywała jaka szansa na wygraną z danym układem wg wzoru - ile razy dana ręka wygrała / ilość rozdań wszytskich oraz ile razy dana ręka wygrała / ilość wygranych rozdań