export const calculateHeroMetrics = (activeHands = []) => {
  if (activeHands.length === 0) return null;

  let vpip = 0;
  let pfr = 0;
  let sawFlop = 0;
  let wentToShowdown = 0;
  let wonAtShowdown = 0;
  let betsRaises = 0;
  let calls = 0;
  let profit = 0;

  activeHands.forEach((hand) => {
    if (hand.heroVPIP) vpip += 1;
    if (hand.heroPFR) pfr += 1;
    if (hand.heroSawFlop) sawFlop += 1;
    if (hand.sawShowdown) wentToShowdown += 1;
    if (hand.sawShowdown && hand.outcome === 'WON') wonAtShowdown += 1;
    betsRaises += hand.heroPostFlopBetsRaises || 0;
    calls += hand.heroPostFlopCalls || 0;
    profit += hand.netProfit;
  });

  return {
    totalHands: activeHands.length,
    vpip: ((vpip / activeHands.length) * 100).toFixed(1),
    pfr: ((pfr / activeHands.length) * 100).toFixed(1),
    af: calls === 0 ? (betsRaises > 0 ? '∞' : '0.0') : (betsRaises / calls).toFixed(2),
    wtsd: sawFlop === 0 ? '0.0' : ((wentToShowdown / sawFlop) * 100).toFixed(1),
    wsd: wentToShowdown === 0 ? '0.0' : ((wonAtShowdown / wentToShowdown) * 100).toFixed(1),
    totalProfit: profit.toFixed(2),
    winrate: ((profit / activeHands.length) * 100).toFixed(2),
  };
};
