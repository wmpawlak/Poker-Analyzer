export const TRAINING_AUDIT_VERSION = 1;

// One-time local audit of the collection that was generated before the v3
// card-facts contract.  Fingerprints are resolved from the collection when
// the migration runs, so a later source revision is not excluded by handId
// alone.
export const TRAINING_AUDIT_HAND_IDS = Object.freeze([
  '4047200125',
  '4483140308',
  '5409220082',
  '5486780230',
  '6102910203',
  '6113520207',
  '87872500008',
  '102461200207',
  '102461200236',
  '108986300004',
  '108986300029',
  '114878800119',
  '124108800023',
  '128622300018',
  '128622300029',
  '128969900008',
  '132213800013',
  '132296200061',
]);

export const DEFAULT_TRAINING_AUDIT_EXCLUSIONS = Object.freeze(
  TRAINING_AUDIT_HAND_IDS.map((handId) => Object.freeze({ handId })),
);

const asString = (value) => String(value ?? '').trim();
const clone = (value) => JSON.parse(JSON.stringify(value));
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const createEmptyTrainingAuditState = () => ({
  version: TRAINING_AUDIT_VERSION,
  excludedHands: [],
  selectionFrozen: false,
});

export const normalizeTrainingAuditState = (value) => {
  const source = isObject(value) ? value : {};
  const seen = new Set();
  const excludedHands = (Array.isArray(source.excludedHands) ? source.excludedHands : [])
    .map((entry) => ({
      handId: asString(entry?.handId),
      fingerprint: asString(entry?.fingerprint) || null,
      reason: asString(entry?.reason) || 'local_card_audit',
      excludedAt: asString(entry?.excludedAt) || null,
    }))
    .filter(({ handId, fingerprint }) => handId && fingerprint)
    .filter(({ handId, fingerprint }) => {
      const key = `${handId}\u0000${fingerprint}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return {
    version: TRAINING_AUDIT_VERSION,
    excludedHands,
    selectionFrozen: source.selectionFrozen === true,
  };
};

export const auditEntryKey = ({ handId, fingerprint }) => `${asString(handId)}\u0000${asString(fingerprint)}`;

export const isTrainingAuditExcluded = (auditState, { handId, fingerprint } = {}) => {
  const normalizedHandId = asString(handId);
  const normalizedFingerprint = asString(fingerprint);
  if (!normalizedHandId || !normalizedFingerprint) return false;
  return normalizeTrainingAuditState(auditState).excludedHands.some((entry) => (
    entry.handId === normalizedHandId && entry.fingerprint === normalizedFingerprint
  ));
};

export const mergeTrainingAuditExclusions = (auditState, requestedEntries, {
  spots = [],
  sources = {},
  now = null,
} = {}) => {
  const normalized = normalizeTrainingAuditState(auditState);
  const requested = Array.isArray(requestedEntries) ? requestedEntries : [];
  const candidates = new Map();
  [...spots, ...Object.entries(sources).map(([handId, source]) => ({ ...source, handId }))]
    .forEach((record) => {
      const handId = asString(record?.handId);
      const fingerprint = asString(record?.sourceFingerprint || record?.fingerprint);
      if (!handId || !fingerprint) return;
      const values = candidates.get(handId) || new Set();
      values.add(fingerprint);
      candidates.set(handId, values);
    });

  const entries = [...normalized.excludedHands];
  const seen = new Set(entries.map(auditEntryKey));
  requested.forEach((requestedEntry) => {
    const entry = typeof requestedEntry === 'string'
      ? { handId: requestedEntry }
      : requestedEntry;
    const handId = asString(entry?.handId);
    if (!handId) return;
    const requestedFingerprint = asString(entry?.fingerprint);
    const fingerprints = requestedFingerprint
      ? [requestedFingerprint]
      : [...(candidates.get(handId) || [])];
    fingerprints.forEach((fingerprint) => {
      const key = auditEntryKey({ handId, fingerprint });
      if (!fingerprint || seen.has(key)) return;
      seen.add(key);
      entries.push({
        handId,
        fingerprint,
        reason: asString(entry?.reason) || 'local_card_audit',
        excludedAt: asString(entry?.excludedAt) || now,
      });
    });
  });
  const next = {
    ...normalized,
    excludedHands: entries,
    selectionFrozen: normalized.selectionFrozen || entries.length > normalized.excludedHands.length,
  };
  return { state: next, changed: JSON.stringify(next) !== JSON.stringify(normalized) };
};

export const cloneTrainingAuditState = (value) => clone(normalizeTrainingAuditState(value));
