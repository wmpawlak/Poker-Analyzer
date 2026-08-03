import { getHandRankLabel } from '../utils/handFilters.js';

export const HERO_OUTCOMES = ['WON', 'LOST', 'FOLDED'];

export const analysisResponseSchema = {
  type: 'object',
  properties: {
    heroResult: {
      type: 'object',
      properties: {
        outcome: { type: 'string', enum: HERO_OUTCOMES },
      },
      required: ['outcome'],
      additionalProperties: false,
    },
    preflop: { type: 'string' },
    flop: { type: 'string' },
    turn: { type: 'string' },
    river: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['heroResult', 'preflop', 'flop', 'turn', 'river', 'summary'],
  additionalProperties: false,
};

export const buildHandAnalysisPrompt = (hand) => {
  return `Jesteś profesjonalnym, ale przystępnym trenerem pokera. Analizuj decyzje Hero, a nie ustalony wynik rozdania.

NADRZĘDNE FAKTY Z PODSUMOWANIA COINPOKER — NIE WOLNO ICH ZMIENIAĆ ANI IM ZAPRZECZAĆ:
- ID rozdania: #${hand.id}
- Wynik Hero: ${hand.outcome}
- Zebrana kwota: ${hand.heroWinnings}
- Wynik netto: ${hand.netProfit}
- Końcowy układ: ${getHandRankLabel(hand.handRanking)} (${hand.handRanking})

Pole heroResult.outcome w odpowiedzi musi dokładnie powtórzyć wynik Hero. ID, kwoty i końcowy układ zostaną dołączone lokalnie i nie wolno Ci ich obliczać. Jeśli karty lub Twoja interpretacja wydają się przeczyć wynikowi Hero, przyjmij za prawdę podsumowanie CoinPoker.
Odpowiadaj wyłącznie po polsku, prostym naturalnym językiem. Skup się na praktycznej ocenie zagrań, sizingach i czytaniu zachowania przeciwników. Jeżeli wymieniasz karty, zapisuj je tylko w nawiasach kwadratowych, np. [Kh As] lub [Tc]. Dla rundy, która się nie odbyła, zwróć pusty tekst.

Log rozdania:

${hand.rawText}`;
};

export const validateHandAnalysis = (analysis, hand) => {
  const actualOutcome = analysis?.heroResult?.outcome;
  if (actualOutcome !== hand.outcome) {
    throw new Error(
      `Analiza AI błędnie odczytała wynik Hero. Oczekiwano: ${hand.outcome}, otrzymano: ${actualOutcome || 'brak'}. Odpowiedź została odrzucona.`,
    );
  }

  return {
    ...analysis,
    heroResult: {
      handId: String(hand.id),
      outcome: hand.outcome,
      heroWinnings: hand.heroWinnings,
      netProfit: hand.netProfit,
      handRanking: hand.handRanking,
    },
  };
};

