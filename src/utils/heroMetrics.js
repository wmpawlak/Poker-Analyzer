import { calculateSessionMetrics } from './sessionMetrics.js';

const formatMetricValue = (metric, precision) => typeof metric.value === 'number'
  ? metric.value.toFixed(precision)
  : metric.value;

export const calculateHeroMetrics = (activeHands = [], gameType = 'mixed') => {
  const sessionMetrics = calculateSessionMetrics(activeHands, gameType);
  if (sessionMetrics.hands === 0) return null;

  return {
    sessionMetrics,
    totalHands: sessionMetrics.hands,
    vpip: formatMetricValue(sessionMetrics.preflop.vpip, 1),
    pfr: formatMetricValue(sessionMetrics.preflop.pfr, 1),
    af: formatMetricValue(sessionMetrics.postflop.af.total, 2),
    wtsd: formatMetricValue(sessionMetrics.showdown.wtsd, 1),
    wsd: formatMetricValue(sessionMetrics.showdown.wsd, 1),
    totalProfit: sessionMetrics.totalProfit.toFixed(2),
    winrate: formatMetricValue(sessionMetrics.winrate, 2),
    winrateUnit: sessionMetrics.winrate.unit,
  };
};
