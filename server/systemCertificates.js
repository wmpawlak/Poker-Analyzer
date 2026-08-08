import tls from 'node:tls';

export const configureSystemCertificates = (tlsImplementation = tls) => {
  if (
    typeof tlsImplementation.getCACertificates !== 'function'
    || typeof tlsImplementation.setDefaultCACertificates !== 'function'
  ) {
    return false;
  }

  const defaultCertificates = tlsImplementation.getCACertificates('default');
  const systemCertificates = tlsImplementation.getCACertificates('system');
  const combinedCertificates = [...new Set([
    ...(Array.isArray(defaultCertificates) ? defaultCertificates : []),
    ...(Array.isArray(systemCertificates) ? systemCertificates : []),
  ])];

  if (combinedCertificates.length === 0) return false;
  tlsImplementation.setDefaultCACertificates(combinedCertificates);
  return true;
};
