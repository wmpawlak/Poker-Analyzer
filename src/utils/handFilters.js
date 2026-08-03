export const HAND_RANKS = [
  { id: 'HIGH_CARD', label: 'Wysoka karta' },
  { id: 'PAIR', label: 'Para' },
  { id: 'TWO_PAIR', label: 'Dwie pary' },
  { id: 'THREE_OF_A_KIND', label: 'Trójka' },
  { id: 'STRAIGHT', label: 'Strit' },
  { id: 'FLUSH', label: 'Kolor' },
  { id: 'FULL_HOUSE', label: 'Full' },
  { id: 'FOUR_OF_A_KIND', label: 'Kareta' },
  { id: 'STRAIGHT_FLUSH', label: 'Poker' },
  { id: 'NO_HAND', label: 'Brak układu' },
];

const RANK_LABELS = new Map(HAND_RANKS.map(({ id, label }) => [id, label]));

export const getHandRankLabel = (rank) => RANK_LABELS.get(rank) || 'Brak układu';

export const getAvailableHandRanks = (sessions) => {
  const usedRanks = new Set(
    sessions.flatMap((session) => session.hands)
      .filter((hand) => !hand.isRebuy)
      .map((hand) => hand.handRanking || 'NO_HAND'),
  );

  return HAND_RANKS.filter(({ id }) => usedRanks.has(id));
};

export const getFilteredSessions = (sessions, handRanking) => (
  handRanking
    ? sessions.filter((session) => session.hands.some((hand) => !hand.isRebuy && hand.handRanking === handRanking))
    : sessions
);

export const getVisibleHands = (session, handRanking) => {
  if (!session) return [];

  return session.hands.filter((hand) => (
    !hand.isRebuy && (!handRanking || hand.handRanking === handRanking)
  ));
};

export const getSelectedEntityId = (entities, selectedId) => {
  if (!selectedId || entities.some((entity) => entity.id === selectedId)) return selectedId;
  return entities[0]?.id ?? null;
};
