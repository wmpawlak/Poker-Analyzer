const hasMatchingDatasetRevision = (report, datasetRevision) => {
  const reportRevision = String(report?.datasetRevision || '').trim();
  if (!reportRevision) return true;
  return Boolean(datasetRevision) && reportRevision === datasetRevision;
};

export const getCurrentSessionAnalysisReport = ({
  reports = [],
  sessionFingerprint = '',
  datasetRevision = '',
} = {}) => (
  [...(Array.isArray(reports) ? reports : [])]
    .reverse()
    .find((report) => (
      report
      && report.fingerprint === sessionFingerprint
      && hasMatchingDatasetRevision(report, datasetRevision)
    )) || null
);

export const getSessionAnalysisStatus = (params = {}) => {
  const reports = Array.isArray(params.reports) ? params.reports : [];
  if (getCurrentSessionAnalysisReport(params)) return 'current';
  return reports.length > 0 ? 'stale' : 'missing';
};
