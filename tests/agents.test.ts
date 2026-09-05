import assert from 'node:assert/strict';
import test from 'node:test';
import recording from '../fixtures/agent-recording.json' with { type: 'json' };
import {
  agentIntents,
  generateAgentTrace,
  parseAgentDecisions,
  verifyAgentTrace,
} from '../lib/agent-workflow.ts';
import type { AgentTrace } from '../lib/agent-workflow.ts';
import { createAssuranceRepository } from '../lib/server/assurance-repository.ts';
import { createWorkspaceRepository } from '../lib/server/workspace-repository.ts';
import { testDatabase } from './helpers/database.ts';
import { ApiError } from '../lib/errors.ts';

const trace = (): AgentTrace => structuredClone(recording) as AgentTrace;
void test('recorded real inference retains its hash and cannot edit invoice amounts or destinations', async () => {
  const value = trace();
  assert.equal(await verifyAgentTrace(value), true);
  value.mode = 'recorded';
  assert.equal(await verifyAgentTrace(value), true);
  const intents = agentIntents(value);
  assert.equal(intents.length, 12);
  assert.ok(intents.every((i) => i.status === 'HELD' && i.amount === 900_000));
  value.sessions[0].decisions[0].action = 'DELAY';
  value.sessions[0].decisions[0].reason = 'tampered';
  assert.equal(await verifyAgentTrace(value), false);
});
void test('model output rejects duplicate, unknown, missing invoices and instruction-bearing extra fields', () => {
  const session = trace().sessions[0];
  for (const decisions of [
    session.decisions.slice(1),
    [...session.decisions.slice(1), session.decisions[1]],
    session.decisions.map((d, i) =>
      i === 0 ? { ...d, invoiceId: 'UNKNOWN' } : d,
    ),
    session.decisions.map((d, i) =>
      i === 0 ? { ...d, action: 'RELEASED' } : d,
    ),
    session.decisions.map((d, i) => (i === 0 ? { ...d, amount: 1 } : d)),
  ])
    assert.throws(
      () => parseAgentDecisions({ decisions }, session.agent),
      ApiError,
    );
});
void test('provider failures and truncated responses fail closed without synthetic fallback', async () => {
  for (const response of [
    new Response('{}', { status: 503 }),
    Response.json({ done: false }),
    Response.json({
      done: true,
      done_reason: 'length',
      message: { content: '{}' },
      model: 'test',
    }),
  ]) {
    await assert.rejects(
      generateAgentTrace(
        'http://127.0.0.1:11434',
        'test',
        async () => response,
      ),
      ApiError,
    );
  }
  await assert.rejects(
    generateAgentTrace('http://127.0.0.1:11434', 'test', async () => {
      throw new Error('offline');
    }),
    ApiError,
  );
});
void test('agent trace and intents persist atomically, remain private and replay once', async () => {
  const { database, sqlite } = testDatabase();
  try {
    const owner = createAssuranceRepository(database, 'alice');
    const id = crypto.randomUUID();
    const value = trace();
    value.mode = 'recorded';
    const [run, concurrent] = await Promise.all([
      owner.createAgentRun(value, 0, id),
      owner.createAgentRun(value, 0, id),
    ]);
    assert.deepEqual(concurrent, run);
    assert.equal(run.source, 'ai');
    assert.deepEqual(await owner.getStoredRun(run.runId), run);
    assert.deepEqual(await owner.createAgentRun(value, 0, id), run);
    assert.equal(
      await createAssuranceRepository(database, 'bob').getStoredRun(run.runId),
      null,
    );
    assert.equal(
      sqlite.prepare('SELECT COUNT(*) AS count FROM stress_runs').get()!.count,
      1,
    );
    const evidence = await owner.getEvidence(run.runId);
    assert.equal(evidence.audit.chainValid, true);
    assert.equal(evidence.commitmentsValid, true);
    assert.equal(evidence.policyValid, true);
    assert.equal(evidence.releasePolicyValid, true);
    const changed = trace();
    changed.sessions[0].response = 'tamper';
    await assert.rejects(
      owner.createAgentRun(changed, 0, crypto.randomUUID()),
      ApiError,
    );
    const settingsRepo = createWorkspaceRepository(database, 'alice');
    const settings = await settingsRepo.getSettings();
    await settingsRepo.updateSettings({
      ...settings,
      policy: { ...settings.policy, liquidityFloor: 95 },
    });
    await assert.rejects(
      owner.createAgentRun(value, 0, crypto.randomUUID()),
      ApiError,
    );
    const strict = await owner.createAgentRun(value, 1, crypto.randomUUID());
    await assert.rejects(
      owner.releaseIntents(strict.runId, {
        count: 5,
        prioritizeCritical: true,
        confirmed: true,
        authorizationReason: 'Verify AI proposal guard',
        idempotencyKey: 'agent-release-guard',
        expectedAuditHead: strict.auditHead!,
      }),
      (e: unknown) => e instanceof ApiError && e.status === 422,
    );
  } finally {
    sqlite.close();
  }
});
