export const getAnalysisHistory = (entry) => {
  if (Array.isArray(entry)) return entry;
  if (entry?.analysis) return [entry];
  return [];
};

export const getAnalyzedHands = (hands, analysesByHandId) => (
  hands.filter((hand) => getAnalysisHistory(analysesByHandId[hand.id]).length > 0)
);

export const getSavedHands = (hands, savedHandIds) => {
  const savedIds = new Set(savedHandIds.map(String));
  return hands.filter((hand) => savedIds.has(String(hand.id)));
};

export const sortHands = (hands, sortBy, sortOrder) => (
  [...hands].sort((a, b) => {
    const valueA = sortBy === 'date' ? a.timestamp : a.netProfit;
    const valueB = sortBy === 'date' ? b.timestamp : b.netProfit;
    return sortOrder === 'desc' ? valueB - valueA : valueA - valueB;
  })
);
