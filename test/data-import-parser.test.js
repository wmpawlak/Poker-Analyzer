import test from 'node:test';
import assert from 'node:assert/strict';
import { createContentHash } from '../server/dataRepository.js';
import { parseHandHistoryDocument } from '../src/parser/pokerParser.js';
import { makeHand } from './helpers/pokerHands.js';

test('parser dokumentu normalizuje tekst i raportuje uszkodzoną sekcję między poprawnymi rękami', () => {
  const cash = makeHand({ id: '1001' });
  const tournament = makeHand({ id: '1002', tournament: true, date: '2027/01/01 00:01:00' });
  const document = `\uFEFF\r\n  ${cash}\r\n\r\nCoinPoker Hand #broken: NLH - 2026/02/30 12:00:00 UTC\r\n\r\n${tournament}\r\n`;

  const parsed = parseHandHistoryDocument(document);

  assert.equal(parsed.validHands.length, 2);
  assert.equal(parsed.issues.length, 1);
  assert.deepEqual(parsed.issues[0], {
    ordinal: 2,
    handId: null,
    reason: 'MISSING_HAND_ID',
  });
  assert.equal(parsed.validHands[0].hand.gameType, 'cash');
  assert.equal(parsed.validHands[1].hand.gameType, 'tournament');
  assert.equal(parsed.validHands[0].rawText.startsWith('CoinPoker Hand #1001'), true);
  assert.equal(parsed.validHands[0].rawText.includes('\r'), false);
});

test('błędna data trafia do issues, a hash pomija BOM, CRLF i zewnętrzne białe znaki', () => {
  const valid = makeHand({ id: '1003' });
  const invalidDate = makeHand({ id: '1004', date: '2026/02/30 12:00:00' });
  const parsed = parseHandHistoryDocument(`${valid}\n${invalidDate}`);

  assert.equal(parsed.validHands.length, 1);
  assert.deepEqual(parsed.issues, [{
    ordinal: 2,
    handId: '1004',
    reason: 'INVALID_PLAYED_AT',
  }]);
  assert.equal(createContentHash(`\uFEFF\r\n ${valid}\r\n`), createContentHash(valid));
});
