import assert from 'node:assert/strict';
import test from 'node:test';
import { createAssuranceRepository } from '../lib/server/assurance-repository.ts';
import {
  makeAuditEvent,
  sha256Hex,
  stableStringify,
} from '../lib/assurance-core.ts';
import { ConflictError, NotFoundError } from '../lib/errors.ts';
import { testDatabase } from './helpers/database.ts';
import type { ReleaseInput } from '../lib/contracts.ts';

const input = {
  scenarioId: 'stablecoin' as const,
  severity: 1,
  liquidityFloor: 75,
};
const release = (key = 'release:first'): ReleaseInput => ({
  count: 5,
  prioritizeCritical: true,
  confirmed: true,
  authorizationReason: 'Critical supplier continuity',
  idempotencyKey: key,
});
const setup = () => {
  const db = testDatabase();
  return { ...db, repo: createAssuranceRepository(db.database, 'test-owner') };
};

void test('create, restore, release and export preserve real durable intentions', async () => {
  const { repo, sqlite } = setup();
  try {
    assert.equal(await repo.getLatestStoredRun(), null);
    const run = await repo.createStressRun(input);
    assert.equal(run.revision, 3);
    assert.deepEqual(await repo.getStoredRun(run.runId), run);
    const result = await repo.releaseIntents(run.runId, {
      ...release(),
      expectedAuditHead: run.auditHead!,
    });
    assert.equal(result.releasedCount, 5);
    const evidence = await repo.getEvidence(run.runId);
    assert.equal(evidence.audit.chainValid, true);
    assert.equal(evidence.commitmentsValid, true);
    assert.equal(
      evidence.run.risk.intents.filter((i) => i.status === 'RELEASED').length,
      5,
    );
    assert.equal(evidence.run.revision, 4);
    const { evidenceHash, ...contents } = evidence;
    assert.equal(evidenceHash, await sha256Hex(stableStringify(contents)));
  } finally {
    sqlite.close();
  }
});

void test('same idempotency key returns original result and rejects changed authorization', async () => {
  const { repo, sqlite } = setup();
  try {
    const run = await repo.createStressRun(input);
    const request = { ...release(), expectedAuditHead: run.auditHead! };
    const first = await repo.releaseIntents(run.runId, request);
    const retry = await repo.releaseIntents(run.runId, request);
    assert.deepEqual(retry, { ...first, idempotentReplay: true });
    await assert.rejects(
      repo.releaseIntents(run.runId, { ...request, count: 8 }),
      ConflictError,
    );
    assert.equal((await repo.getStoredRun(run.runId))!.revision, 4);
  } finally {
    sqlite.close();
  }
});

void test('simultaneous identical releases commit once', async () => {
  const { repo, sqlite } = setup();
  try {
    const run = await repo.createStressRun(input);
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        repo.releaseIntents(run.runId, release()),
      ),
    );
    assert.equal(responses.filter((r) => !r.idempotentReplay).length, 1);
    assert.ok(responses.every((r) => r.auditHead === responses[0].auditHead));
    assert.equal((await repo.getEvidence(run.runId)).audit.chainValid, true);
    assert.equal((await repo.getStoredRun(run.runId))!.revision, 4);
  } finally {
    sqlite.close();
  }
});

void test('different simultaneous releases cannot fork the chain or over-release', async () => {
  const { repo, sqlite } = setup();
  try {
    const run = await repo.createStressRun(input);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        repo.releaseIntents(run.runId, {
          ...release(`release:${i}`),
          expectedAuditHead: run.auditHead!,
        }),
      ),
    );
    assert.equal(
      results.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    for (const result of results)
      if (result.status === 'rejected')
        assert.ok(result.reason instanceof ConflictError);
    const evidence = await repo.getEvidence(run.runId);
    assert.equal(evidence.audit.chainValid, true);
    assert.equal(
      evidence.run.risk.intents.filter((i) => i.status === 'RELEASED').length,
      5,
    );
  } finally {
    sqlite.close();
  }
});

void test('release versus replay race stays atomic and subsequent release requires renewed review', async () => {
  const { repo, sqlite } = setup();
  try {
    const run = await repo.createStressRun(input);
    await Promise.allSettled([
      repo.releaseIntents(run.runId, release()),
      repo.runReplayProbe(run.runId),
    ]);
    assert.equal((await repo.getEvidence(run.runId)).audit.chainValid, true);
    await assert.rejects(
      repo.releaseIntents(run.runId, {
        ...release('release:stale'),
        expectedAuditHead: run.auditHead!,
      }),
      ConflictError,
    );
  } finally {
    sqlite.close();
  }
});

void test('exhausted runs reject empty releases, and replay never creates a payment', async () => {
  const { repo, sqlite } = setup();
  try {
    const run = await repo.createStressRun({ ...input, liquidityFloor: 50 });
    for (let i = 0; i < 3; i++)
      await repo.releaseIntents(run.runId, {
        ...release(`release:${i}`),
        count: 10,
      });
    await assert.rejects(
      repo.releaseIntents(run.runId, release('release:empty')),
      ConflictError,
    );
    const probe = await repo.runReplayProbe(run.runId);
    assert.equal(probe.blocked, true);
    assert.equal(probe.fundsMoved, false);
    const evidence = await repo.getEvidence(run.runId);
    assert.equal(evidence.run.risk.intents.length, 30);
    assert.equal(evidence.audit.chainValid, true);
    assert.equal(evidence.commitmentsValid, true);
  } finally {
    sqlite.close();
  }
});

void test('evidence detects stored intent and audit tampering instead of regenerating them', async () => {
  const { repo, sqlite } = setup();
  try {
    const run = await repo.createStressRun(input);
    sqlite
      .prepare(
        'UPDATE payment_intents SET amount = 1 WHERE run_id = ? AND intent_id = ?',
      )
      .run(run.runId, run.risk.intents[0].id);
    let evidence = await repo.getEvidence(run.runId);
    assert.equal(evidence.run.risk.intents[0].amount, 1);
    assert.equal(evidence.commitmentsValid, false);
    sqlite
      .prepare(
        "UPDATE audit_events SET detail_json = '{}' WHERE run_id = ? AND sequence = 1",
      )
      .run(run.runId);
    evidence = await repo.getEvidence(run.runId);
    assert.equal(evidence.audit.chainValid, false);
    await assert.rejects(
      repo.releaseIntents(run.runId, release()),
      ConflictError,
    );
  } finally {
    sqlite.close();
  }
});

void test('missing runs use a typed not-found error', async () => {
  const { repo, sqlite } = setup();
  try {
    const id = `RUN-${crypto.randomUUID()}`;
    assert.equal(await repo.getStoredRun(id), null);
    await assert.rejects(repo.getEvidence(id), NotFoundError);
  } finally {
    sqlite.close();
  }
});

void test('migration preserves populated legacy chains with equal timestamps and reverse IDs', async () => {
  const { sqlite, database, upgrade } = testDatabase(false);
  try {
    const runId = `RUN-${crypto.randomUUID()}`;
    const timestamp = '2026-09-05T01:00:00.000Z';
    sqlite
      .prepare(
        'INSERT INTO stress_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        runId,
        'stablecoin',
        1,
        75,
        'CRITICAL',
        'HB-HERD-002',
        80,
        80,
        0,
        100,
        timestamp,
        timestamp,
      );
    const first = await makeAuditEvent(runId, 'FIRST', {}, null, timestamp);
    const second = await makeAuditEvent(
      runId,
      'SECOND',
      {},
      first.eventHash,
      timestamp,
    );
    for (const [event, id] of [
      [first, 'EVT-z'],
      [second, 'EVT-a'],
    ] as const)
      sqlite
        .prepare('INSERT INTO audit_events VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(
          id,
          runId,
          event.eventType,
          event.detailJson,
          event.previousHash,
          event.eventHash,
          timestamp,
        );
    upgrade();
    sqlite
      .prepare('UPDATE stress_runs SET owner_id = ? WHERE id = ?')
      .run('test-owner', runId);
    const evidence = await createAssuranceRepository(
      database,
      'test-owner',
    ).getEvidence(runId);
    assert.equal(evidence.audit.chainValid, true);
    assert.equal(evidence.run.revision, 2);
    assert.deepEqual(
      evidence.audit.events.map((e) => e.eventType),
      ['FIRST', 'SECOND'],
    );
  } finally {
    sqlite.close();
  }
});

void test('replay probe exercises nonce uniqueness and rolls back if that constraint is absent', async () => {
  const { repo, sqlite } = setup();
  try {
    const run = await repo.createStressRun(input);
    sqlite.exec('DROP INDEX idx_payment_intents_run_nonce');
    await assert.rejects(repo.runReplayProbe(run.runId));
    const current = await repo.getStoredRun(run.runId);
    assert.equal(current!.risk.intents.length, 30);
    assert.equal(current!.revision, 3);
  } finally {
    sqlite.close();
  }
});

void test('unaudited status edits and truncated audit tails fail integrity verification', async () => {
  const { repo, sqlite } = setup();
  try {
    const run = await repo.createStressRun(input);
    sqlite
      .prepare(
        "UPDATE payment_intents SET status = 'RELEASED' WHERE run_id = ? AND intent_id = ?",
      )
      .run(run.runId, run.risk.intents[0].id);
    assert.equal((await repo.getEvidence(run.runId)).releaseStateValid, false);
    await assert.rejects(
      repo.releaseIntents(run.runId, release()),
      ConflictError,
    );
    sqlite
      .prepare('DELETE FROM audit_events WHERE run_id = ? AND sequence = 3')
      .run(run.runId);
    assert.equal((await repo.getEvidence(run.runId)).audit.chainValid, false);
  } finally {
    sqlite.close();
  }
});
