import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCurrentSessionAnalysisReport,
  getSessionAnalysisStatus,
} from '../src/utils/sessionAnalysisStatus.js';

test('status analizy sesji wymaga fingerprintu i zgodnej rewizji datasetu', () => {
  const reports = [
    { reportId: 'old-revision', fingerprint: 'session-a', datasetRevision: 'revision-1' },
    { reportId: 'wrong-fingerprint', fingerprint: 'other-session', datasetRevision: 'revision-2' },
  ];
  const params = { reports, sessionFingerprint: 'session-a', datasetRevision: 'revision-2' };

  assert.equal(getCurrentSessionAnalysisReport(params), null);
  assert.equal(getSessionAnalysisStatus(params), 'stale');
  assert.equal(getSessionAnalysisStatus({ ...params, reports: [] }), 'missing');
});

test('legacyjny raport bez rewizji jest aktualny przy zgodnym fingerprintie', () => {
  const legacy = { reportId: 'legacy', fingerprint: 'session-a' };
  const params = { reports: [legacy], sessionFingerprint: 'session-a', datasetRevision: 'revision-2' };

  assert.equal(getCurrentSessionAnalysisReport(params), legacy);
  assert.equal(getSessionAnalysisStatus(params), 'current');
});
