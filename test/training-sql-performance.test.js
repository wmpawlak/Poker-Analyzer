import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTrainingDatabase } from '../server/training/trainingDatabase.js';
import { createTrainingRepository } from '../server/training/trainingRepository.js';
import { createTrainingService } from '../server/training/trainingService.js';
import {
  TRAINING_ANSWER_KEY_CONTRACT_VERSION,
} from '../server/training/answerKeyContract.js';
import {
  CARD_FACTS_VALIDATION_VERSION,
  computeDecisionCardFacts,
} from '../server/training/decisionCardFacts.js';

const SPOT_COUNT = 25_000;
const facts = computeDecisionCardFacts({ heroCards: ['Ah', 'Kd'], board: [] });
const question = {
  heroCards: ['Ah', 'Kd'],
  board: [],
  heroPosition: 'BTN',
  effectiveStackBb: 100,
  legalActions: ['fold', 'raise'],
  players: [],
  priorActions: [],
  context: { opponentsInHand: 1 },
};

const timed = async (task) => {
  const started = performance.now();
  const result = await task();
  return { result, durationMs: performance.now() - started };
};

test('ścieżki SQL treningu nie eksportują katalogu przy 25 tys. spotów', async (t) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'poker-training-sql-performance-'));
  t.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));

  const seeded = createTrainingDatabase({ dataDirectory });
  const now = '2026-08-13T12:00:00.000Z';
  seeded.exec('BEGIN;');
  try {
    seeded.prepare(`
      INSERT INTO sources (
        hand_id, fingerprint, game_type, played_at, status, expected_spot_count,
        observed_spot_count, extractor_version, first_seen_at, last_seen_at, scanned_at, updated_at
      ) VALUES (?, ?, 'cash', ?, 'current', ?, ?, 1, ?, ?, ?, ?)
    `).run('perf-hand', 'perf-fingerprint', now, SPOT_COUNT, SPOT_COUNT, now, now, now, now);
    const insertSpot = seeded.prepare(`
      INSERT INTO spots (
        version_id, spot_id, hand_id, source_fingerprint, exercise_type, game_type,
        source_status, readiness, active, local_validation_version, local_valid,
        question_json, answer_options_json, payload_json, played_at, created_at, updated_at
      ) VALUES (?, ?, 'perf-hand', 'perf-fingerprint', 'preflop_selection', 'cash',
        'current', ?, ?, 1, 1, ?, ?, '{}', ?, ?, ?)
    `);
    const answerOptions = JSON.stringify([
      { id: 'fold', action: 'fold' },
      { id: 'raise', action: 'raise' },
    ]);
    const questionJson = JSON.stringify(question);
    for (let index = 0; index < SPOT_COUNT; index += 1) {
      const versionId = `perf-spot-${index}`;
      insertSpot.run(
        versionId,
        `perf-spot-${index}`,
        index === 0 ? 'ready' : 'pending_key',
        index === 0 ? 1 : 0,
        questionJson,
        answerOptions,
        now,
        now,
        now,
      );
    }
    seeded.prepare(`
      INSERT INTO answer_keys (
        id, spot_version_id, contract_version, status, confidence, local_facts_valid,
        facts_validation_version, preferred_answer, decision_card_facts_json,
        acceptable_alternatives_json, payload_json, created_at
      ) VALUES ('perf-key', 'perf-spot-0', ?, 'ready', 'high', 1, ?, 'raise', ?, '[]', '{}', ?)
    `).run(
      TRAINING_ANSWER_KEY_CONTRACT_VERSION,
      CARD_FACTS_VALIDATION_VERSION,
      JSON.stringify(facts),
      now,
    );
    seeded.prepare(`
      UPDATE spots SET current_answer_key_id = 'perf-key', readiness = 'ready', active = 1,
        decision_card_facts_json = ?
      WHERE version_id = 'perf-spot-0'
    `).run(JSON.stringify(facts));
    seeded.prepare(`
      UPDATE collection_metadata SET migration_status = 'completed', updated_at = ?, revision = 1
      WHERE id = 1
    `).run(now);
    seeded.exec('COMMIT;');
  } catch (error) {
    try { seeded.exec('ROLLBACK;'); } catch { /* preserve original error */ }
    throw error;
  } finally {
    seeded.close();
  }

  const repository = createTrainingRepository({ dataDirectory });
  let snapshotCalls = 0;
  const originalSnapshot = repository.getSnapshot;
  repository.getSnapshot = async (...args) => {
    snapshotCalls += 1;
    return originalSnapshot(...args);
  };
  const service = createTrainingService({
    repository,
    random: () => 0,
    idFactory: (prefix) => `${prefix}-perf`,
  });

  await service.getStatus({ sampleSize: 100 });
  const status = await timed(() => service.getStatus({ sampleSize: 100 }));
  const created = await timed(() => service.createOrResumeSession({
    exerciseType: 'preflop_selection', gameType: 'cash', size: 10,
  }));
  const next = await timed(() => service.getNextQuestion(created.result.session.id));
  const answer = await timed(() => service.submitAnswer(created.result.session.id, {
    spotVersionId: next.result.question.spotVersionId,
    answer: 'raise',
  }));
  const history = await timed(() => service.getHistory({ limit: 10 }));
  const stats = await timed(() => service.getStats({}));

  assert.equal(created.result.session.targetSize, 1);
  assert.equal(answer.result.session.status, 'completed');
  assert.equal(history.result.totalAttempts, 1);
  assert.equal(stats.result.total.total, 1);
  assert.equal(snapshotCalls, 0);
  assert.ok(status.durationMs < 250, `status trwał ${status.durationMs.toFixed(1)} ms`);
  assert.ok(created.durationMs < 250, `tworzenie sesji trwało ${created.durationMs.toFixed(1)} ms`);
  assert.ok(next.durationMs < 250, `GET next trwał ${next.durationMs.toFixed(1)} ms`);
  assert.ok(answer.durationMs < 250, `zapis odpowiedzi trwał ${answer.durationMs.toFixed(1)} ms`);

  const planDb = createTrainingDatabase({ dataDirectory });
  try {
    const plan = planDb.prepare(`
      EXPLAIN QUERY PLAN
      SELECT * FROM session_spots WHERE session_id = ? AND status = 'pending'
      ORDER BY position LIMIT 1
    `).all('missing-session');
    assert.equal(plan.some(({ detail }) => String(detail).includes('idx_session_spots_session_position')), true);
  } finally {
    planDb.close();
  }
  await repository.close();
});
