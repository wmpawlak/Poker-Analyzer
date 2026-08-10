export const makeHand = ({
  id,
  date = '2026/08/01 12:00:00',
  table = 'Table A',
  tournament = false,
  tournamentId = '9001',
} = {}) => `CoinPoker Hand #${id}: NLH (₮0.05/₮0.10) - ${date} UTC
Table '${table}' 2-max Seat #1 is the button
${tournament ? `Tournament 'Test Tournament' '${tournamentId}'\n` : ''}Seat 1: Hero (₮10.00 in chips)
Seat 2: Villain (₮10.00 in chips)
*** HOLE CARDS ***
Dealt to Hero [Ah Kd]
Hero: calls ₮0.10
*** SUMMARY ***
Seat 1: Hero folded before Flop`;
