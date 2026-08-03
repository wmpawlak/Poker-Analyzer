const MIN_CLASSIFICATION_HANDS = 30;
const MIN_CONTEXT_HANDS = 10;
const SHORT_STACK_BB = 20;
const MIN_PUSH_FOLD_CONTEXT_SHARE = 30;
const MAX_PROFILE_DISTANCE = 1.25;

const FEATURE_DEFINITIONS = {
  vpip: { scale: 10, weight: 1.3, minimumOpportunities: 30 },
  pfr: { scale: 10, weight: 1.3, minimumOpportunities: 30 },
  vpipPfrGap: { scale: 8, weight: 1.15, minimumOpportunities: 30 },
  threeBet: { scale: 8, weight: 0.8, minimumOpportunities: 15 },
  afq: { scale: 20, weight: 0.8, minimumOpportunities: 20 },
  foldToCBet: { scale: 25, weight: 0.55, minimumOpportunities: 10 },
};

export const PLAYER_STYLE_PROFILES = [
  {
    id: 'TAG',
    label: 'TAG',
    description: 'Gra relatywnie mało rąk, a po wejściu do puli zwykle przejmuje inicjatywę.',
    targets: { vpip: 22, pfr: 19, vpipPfrGap: 3, threeBet: 7, afq: 55, foldToCBet: 48 },
  },
  {
    id: 'LAG',
    label: 'LAG',
    description: 'Wchodzi do wielu pul i często wywiera presję podbiciami oraz 3-betami.',
    targets: { vpip: 33, pfr: 28, vpipPfrGap: 5, threeBet: 12, afq: 62, foldToCBet: 42 },
  },
  {
    id: 'NIT_ROCK',
    label: 'Nit / rock',
    description: 'Wybiera bardzo wąski zakres rąk i rzadko angażuje się bez silnego układu.',
    targets: { vpip: 12, pfr: 9, vpipPfrGap: 3, threeBet: 3, afq: 42, foldToCBet: 58 },
  },
  {
    id: 'LOOSE_PASSIVE',
    label: 'Loose-passive / calling station',
    description: 'Często wchodzi do puli, lecz znacznie częściej calluje niż przejmuje inicjatywę.',
    targets: { vpip: 40, pfr: 14, vpipPfrGap: 26, threeBet: 3, afq: 30, foldToCBet: 38 },
  },
  {
    id: 'TIGHT_PASSIVE',
    label: 'Tight-passive',
    description: 'Gra niewiele rąk, ale po wejściu do puli zbyt często pozostaje pasywny.',
    targets: { vpip: 18, pfr: 9, vpipPfrGap: 9, threeBet: 3, afq: 32, foldToCBet: 55 },
  },
  {
    id: 'MANIAC',
    label: 'Maniak',
    description: 'Gra bardzo szeroko i wyjątkowo często wybiera agresywne linie.',
    targets: { vpip: 55, pfr: 45, vpipPfrGap: 10, threeBet: 20, afq: 76, foldToCBet: 25 },
  },
  {
    id: 'WEAK_TIGHT',
    label: 'Weak-tight / fit-or-fold',
    description: 'Przed flopem gra dość selektywnie, a po flopie często rezygnuje bez trafienia.',
    targets: { vpip: 22, pfr: 17, vpipPfrGap: 5, threeBet: 5, afq: 40, foldToCBet: 76 },
  },
  {
    id: 'BALANCED',
    label: 'Reg / zbalansowany',
    description: 'Statystyki są zbliżone do aktywnego, lecz względnie zbalansowanego wzorca gry.',
    targets: { vpip: 27, pfr: 22, vpipPfrGap: 5, threeBet: 8, afq: 51, foldToCBet: 50 },
  },
  {
    id: 'RECREATIONAL',
    label: 'Recreational / niestandardowy',
    description: 'Łączy szeroki wybór rąk z niespójną proporcją agresji do callowania.',
    targets: { vpip: 44, pfr: 23, vpipPfrGap: 21, threeBet: 7, afq: 44, foldToCBet: 45 },
  },
];

const isNumericMetric = (metric) => Number.isFinite(metric?.value);

const getReliability = (hands) => {
  if (hands < MIN_CLASSIFICATION_HANDS) {
    return { id: 'INSUFFICIENT', label: 'Za mała próba', minimumHands: MIN_CLASSIFICATION_HANDS };
  }
  if (hands < 100) {
    return { id: 'PRELIMINARY', label: 'Wstępny profil', minimumHands: MIN_CLASSIFICATION_HANDS };
  }
  return { id: 'STATISTICAL', label: 'Profil statystyczny', minimumHands: 100 };
};

const extractFeatures = (metrics) => {
  const vpip = metrics?.preflop?.vpip;
  const pfr = metrics?.preflop?.pfr;
  const threeBet = metrics?.preflop?.threeBet;
  const afq = metrics?.postflop?.afq?.total;
  const foldToCBet = metrics?.postflop?.foldToCBet;

  return {
    vpip: isNumericMetric(vpip) ? { value: vpip.value, opportunities: vpip.opportunities } : null,
    pfr: isNumericMetric(pfr) ? { value: pfr.value, opportunities: pfr.opportunities } : null,
    vpipPfrGap: isNumericMetric(vpip) && isNumericMetric(pfr)
      ? {
        value: Math.max(0, vpip.value - pfr.value),
        opportunities: Math.min(vpip.opportunities, pfr.opportunities),
      }
      : null,
    threeBet: isNumericMetric(threeBet)
      ? { value: threeBet.value, opportunities: threeBet.opportunities }
      : null,
    afq: isNumericMetric(afq)
      ? { value: afq.value, opportunities: afq.betsRaises + afq.calls }
      : null,
    foldToCBet: isNumericMetric(foldToCBet)
      ? { value: foldToCBet.value, opportunities: foldToCBet.opportunities }
      : null,
  };
};

const scoreProfile = (profile, features) => {
  let weightedSquaredDistance = 0;
  let totalWeight = 0;

  Object.entries(FEATURE_DEFINITIONS).forEach(([featureId, definition]) => {
    const feature = features[featureId];
    if (!feature) return;

    const sampleWeight = Math.min(1, feature.opportunities / definition.minimumOpportunities);
    const effectiveWeight = definition.weight * sampleWeight;
    const normalizedDistance = (feature.value - profile.targets[featureId]) / definition.scale;
    weightedSquaredDistance += effectiveWeight * (normalizedDistance ** 2);
    totalWeight += effectiveWeight;
  });

  return totalWeight > 0 ? Math.sqrt(weightedSquaredDistance / totalWeight) : Number.POSITIVE_INFINITY;
};

const getStackContext = (hands) => {
  const measurableHands = hands.filter((hand) => Number(hand?.bigBlind) > 0
    && Number(hand?.heroStartingStack) > 0);
  const shortStackHands = measurableHands.filter(
    (hand) => Number(hand.heroStartingStack) / Number(hand.bigBlind) < SHORT_STACK_BB,
  );
  const shortStackShare = measurableHands.length > 0
    ? (shortStackHands.length / measurableHands.length) * 100
    : null;

  const pushFoldEligibleHands = shortStackHands.filter(
    (hand) => hand.heroStats?.preflop?.heroHadDecision,
  );
  const allInHands = pushFoldEligibleHands
    .filter((hand) => hand.heroStats?.preflop?.heroWentAllIn).length;
  const passiveCallHands = pushFoldEligibleHands.filter(
    (hand) => hand.heroStats?.preflop?.heroCallCount > 0,
  ).length;
  const allInShare = pushFoldEligibleHands.length > 0
    ? (allInHands / pushFoldEligibleHands.length) * 100
    : null;
  const passiveCallShare = pushFoldEligibleHands.length > 0
    ? (passiveCallHands / pushFoldEligibleHands.length) * 100
    : null;

  return {
    shortStack: {
      active: measurableHands.length >= MIN_CONTEXT_HANDS && shortStackShare >= 60,
      thresholdBb: SHORT_STACK_BB,
      measurableHands: measurableHands.length,
      matchingHands: shortStackHands.length,
      share: shortStackShare === null ? null : Number(shortStackShare.toFixed(1)),
    },
    pushFold: {
      active: pushFoldEligibleHands.length >= MIN_CONTEXT_HANDS
        && shortStackShare >= MIN_PUSH_FOLD_CONTEXT_SHARE
        && allInShare >= 15
        && passiveCallShare <= 20,
      minimumContextShare: MIN_PUSH_FOLD_CONTEXT_SHARE,
      eligibleHands: pushFoldEligibleHands.length,
      allInHands,
      passiveCallHands,
      allInShare: allInShare === null ? null : Number(allInShare.toFixed(1)),
      passiveCallShare: passiveCallShare === null ? null : Number(passiveCallShare.toFixed(1)),
    },
  };
};

const toActiveBadges = (context) => [
  context.shortStack.active && {
    id: 'SHORT_STACK',
    label: 'Short-stack',
    description: `Stack poniżej ${SHORT_STACK_BB} BB w większości mierzalnych rozdań.`,
  },
  context.pushFold.active && {
    id: 'PUSH_FOLD',
    label: 'Push-fold',
    description: 'Na płytkim stacku Hero często wchodzi all-in i rzadko wybiera zwykły call.',
  },
].filter(Boolean);

export const classifyPlayerStyle = (metrics, hands = []) => {
  const actualHands = (Array.isArray(hands) ? hands : []).filter((hand) => hand && !hand.isRebuy);
  const handCount = Number.isFinite(metrics?.hands) ? metrics.hands : actualHands.length;
  const reliability = getReliability(handCount);
  const context = getStackContext(actualHands);
  const badges = toActiveBadges(context);

  if (reliability.id === 'INSUFFICIENT') {
    return {
      style: null,
      reliability,
      badges,
      context,
      comparedFeatures: 0,
    };
  }

  const features = extractFeatures(metrics);
  const comparedFeatures = Object.values(features).filter(Boolean).length;
  const rankedProfiles = PLAYER_STYLE_PROFILES
    .map((profile) => ({ profile, distance: scoreProfile(profile, features) }))
    .sort((left, right) => left.distance - right.distance);
  const closest = rankedProfiles[0];

  if (!closest
    || !Number.isFinite(closest.distance)
    || comparedFeatures < 3
    || closest.distance > MAX_PROFILE_DISTANCE) {
    return {
      style: {
        id: 'MIXED',
        label: 'Mieszany',
        description: 'Dostępne dane nie tworzą jeszcze spójnego profilu statystycznego.',
        distance: null,
      },
      reliability,
      badges,
      context,
      comparedFeatures,
    };
  }

  return {
    style: {
      id: closest.profile.id,
      label: closest.profile.label,
      description: closest.profile.description,
      distance: Number(closest.distance.toFixed(3)),
    },
    reliability,
    badges,
    context,
    comparedFeatures,
  };
};
