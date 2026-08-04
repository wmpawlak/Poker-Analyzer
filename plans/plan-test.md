# Plan testowania obliczeń statystyk pokerowych

## Definicje i wzory

| Statystyka | Wzór stosowany w aplikacji |
|---|---|
| VPIP | ręce z dobrowolnym call/bet/raise preflop ÷ wszystkie ręce |
| PFR | ręce z raise’em/betem preflop ÷ wszystkie ręce |
| 3-bet | 3-bety ÷ okazje, w których Hero stanął przed pierwszym raise’em |
| Fold do 3-betu | foldy Hero po otrzymaniu 3-betu ÷ otrzymane 3-bety |
| 4-bet | 4-bety Hero ÷ okazje po otrzymaniu 3-betu |
| RFI / steal | open raise Hero ÷ okazje do open raise; osobno CO, BTN, SB oraz BTN/SB heads-up |
| C-bet | flopowe bety/raise’y agresora preflop bez wcześniejszego betu ÷ okazje do c-betu |
| C-bet SRP | c-bety w pulach z dokładnie jednym raise’em preflop ÷ okazje do c-betu w SRP |
| Fold do c-betu | foldy bezpośrednio na kwalifikujący się flopowy c-bet ÷ takie okazje |
| AF | `(bety + raise’y) ÷ calle` postflop, osobno łącznie/flop/turn/river |
| AFq | `(bety + raise’y) ÷ (bety + raise’y + calle)` postflop, osobno dla ulic |
| WTSD | faktyczne show/muck Hero po flopie ÷ ręce, w których Hero zobaczył flop |
| W$SD | wygrane według CoinPoker `SUMMARY` ÷ faktyczne showdowny Hero |
| Wynik netto | `Σ(heroWinnings − heroInvestment)` |
| Cash winrate | `Σ(netProfit / BB danej ręki) ÷ liczba rąk × 100` |
| Turniejowy winrate | `Σ(netProfit w żetonach) ÷ liczba prawdziwych rąk × 100` |
| Hands | liczba prawdziwych rąk; syntetyczne wpisy rebuy są wykluczone |

Brak okazji zwraca `—`; AF zwraca `∞` wyłącznie przy agresji większej od zera i zerowej liczbie calli.

## Zmiany testowe

- Dodać dwa małe, kontrolowane fixture’y surowych historii CoinPoker: Cash oraz turniej z rebuyem.
- Wprowadzić dla nich ręcznie zweryfikowane, oczekiwane liczniki `wykonania / okazje` dla każdej statystyki i oczekiwane wyniki netto/winrate.
- Pokryć jednym zestawem rąk: free BB, limp/call, open raise, 3-bet, fold/4-bet po 3-becie, RFI z CO/BTN/SB i heads-up BTN/SB, straddle/AUTOBB, call all-in, SRP oraz 3-bet pot, c-bet/missed c-bet/fold do c-betu, wszystkie ulice, wygrany i przegrany showdown oraz wygraną bez showdownu.
- Dla turnieju sprawdzić, że wykryty rebuy nie zwiększa Hands, liczników ani wyniku/100.

## Testy regresyjne i niezmienniki

- Porównywać wynik parsera i `calculateSessionMetrics` z golden wartościami, bez uśredniania procentów per ręka.
- Dodać niezmienniki: liczniki nieujemne, `wykonania ≤ okazje`, `PFR ≤ VPIP`, suma RFI pozycyjnego = RFI ogółem, `C-bet SRP ≤ C-bet`, `W$SD.opportunities = WTSD.executions`.
- Sprawdzić zależność AF/AFq: brak decyzji daje `—`; sama agresja daje AF `∞` i AFq `100%`; same calle dają AF `0` i AFq `0%`.
- Uruchomić pełne testy, ESLint zmienionych plików i build. Nie używać lokalnych plików `data/` jako fixture’ów regresyjnych, bo są danymi użytkownika i zmieniają się w czasie.

## Próbki kontrolne

- Cash: sesja `session_200906_2026/06/03`, 537 rąk — zachować jako jednorazowy audyt referencyjny.
- Turniej: `tourney_54831_2026/05/08`, 273 ręce i 1 rebuy — potwierdza różnicę między BB/100 a żetonami/100.
- Fixture’y będą trwałym źródłem regresji; bieżące sesje posłużą tylko do sprawdzenia końcowego po implementacji.
