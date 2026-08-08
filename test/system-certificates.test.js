import test from 'node:test';
import assert from 'node:assert/strict';
import { configureSystemCertificates } from '../server/systemCertificates.js';

test('serwer łączy certyfikaty domyślne z magazynem systemowym', () => {
  const calls = [];
  const tlsImplementation = {
    getCACertificates: (type) => type === 'default'
      ? ['bundled-ca', 'shared-ca']
      : ['system-ca', 'shared-ca'],
    setDefaultCACertificates: (certificates) => calls.push(certificates),
  };

  assert.equal(configureSystemCertificates(tlsImplementation), true);
  assert.deepEqual(calls, [['bundled-ca', 'shared-ca', 'system-ca']]);
});

test('starszy Node bez API magazynu systemowego zachowuje dotychczasowe certyfikaty', () => {
  assert.equal(configureSystemCertificates({}), false);
});
