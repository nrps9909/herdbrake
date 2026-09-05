import assert from 'node:assert/strict';
import test from 'node:test';
import { planRelease, releasePosition } from '../lib/release-plan.ts';
import { defaultPolicy } from '../lib/policy.ts';
import type { PaymentIntent } from '../lib/herdbrake.ts';
import { createAssuranceRepository } from '../lib/server/assurance-repository.ts';
import { createWorkspaceRepository } from '../lib/server/workspace-repository.ts';
import { testDatabase } from './helpers/database.ts';
import { ApiError } from '../lib/errors.ts';

const policy = { ...defaultPolicy, openingLiquidity: 1000 };
const intent = (
  id: string,
  amount: number,
  extra: Partial<PaymentIntent> = {},
): PaymentIntent => ({
  id,
  amount,
  currency: 'USD',
  entity: 'Synthetic supplier',
  action: 'PAY',
  destination: id,
  individualPolicy: 'PASS',
  status: 'HELD',
  critical: false,
  nonce: id,
  ...extra,
});

void test('release plan includes prior approvals and allows the exact floor but not one cent over', () => {
  const prior = intent('paid', 200, { status: 'RELEASED' });
  const exact = planRelease([prior, intent('next', 50)], 1, true, policy);
  assert.equal(exact.allowed, true);
  assert.equal(exact.projectedBuffer, 75);
  assert.equal(exact.remainingBudget, 0);
  const over = planRelease([prior, intent('next', 50.01)], 1, true, policy);
  assert.equal(over.allowed, false);
  assert.equal(over.shortfall, 0.01);
});

void test('release accounting reserves mixed currencies conservatively and never charges cash-retention decisions', () => {
  const rows = [
    intent('twd', 3200, { currency: 'TWD' }),
    intent('usdc', 100, { currency: 'USDC' }),
    intent('delay', 900, { action: 'DELAY' }),
    intent('buffer', 800, { action: 'BUFFER' }),
  ];
  const plan = planRelease(rows, 4, false, { ...policy, usdcUsd: 1.1 });
  assert.equal(plan.batchOutflow, 210);
  assert.equal(plan.allowed, true);
  assert.deepEqual(
    plan.ids,
    rows.map((row) => row.id),
  );
  assert.equal(
    planRelease([intent('max', 101)], 1, true, { ...policy, maxIntentUsd: 100 })
      .allowed,
    false,
  );
});

void test('all-or-nothing server approval cannot reset its budget through repeated calls or idempotency keys', async () => {
  const { database, sqlite } = testDatabase();
  const repo = createAssuranceRepository(database, 'budget-owner');
  const workspace = createWorkspaceRepository(database, 'budget-owner');
  try {
    const settings = await workspace.getSettings();
    const saved = await workspace.updateSettings({ ...settings, policy });
    const run = await repo.importRun({
      name: 'Cumulative floor',
      policyRevision: saved.revision,
      csv: 'entity,action,destination,amount,currency,critical\nA,PAY,A,200,USD,true\nB,PAY,B,50,USD,false\nC,PAY,C,0.01,USD,false',
    });
    const request = {
      count: 1,
      prioritizeCritical: false,
      confirmed: true as const,
      authorizationReason: 'Synthetic liquidity acceptance',
      idempotencyKey: 'budget:first',
    };
    await repo.releaseIntents(run.runId, request);
    const before = await repo.getStoredRun(run.runId);
    await assert.rejects(
      repo.releaseIntents(run.runId, {
        ...request,
        count: 2,
        idempotencyKey: 'budget:over',
      }),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 422 &&
        error.code === 'HB_LIQUIDITY_FLOOR',
    );
    assert.deepEqual(await repo.getStoredRun(run.runId), before);
    await repo.releaseIntents(run.runId, {
      ...request,
      idempotencyKey: 'budget:exact',
    });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        repo.releaseIntents(run.runId, {
          ...request,
          idempotencyKey: `budget:repeat:${i}`,
        }),
      ),
    );
    assert.ok(results.every((result) => result.status === 'rejected'));
    const evidence = await repo.getEvidence(run.runId);
    assert.equal(evidence.releasePolicyValid, true);
    assert.equal(evidence.audit.chainValid, true);
    assert.equal(
      releasePosition(evidence.run.risk.intents, policy).retainedBuffer,
      75,
    );
  } finally {
    sqlite.close();
  }
});

void test('legacy over-budget approvals are reported as invalid and cannot authorize more cash outflow', async () => {
  const { database, sqlite } = testDatabase();
  const repo = createAssuranceRepository(database, 'legacy-budget');
  try {
    const run = await repo.createStressRun({
      scenarioId: 'stablecoin',
      severity: 1,
      liquidityFloor: 95,
    });
    sqlite
      .prepare(
        "UPDATE payment_intents SET status = 'RELEASED' WHERE run_id = ?",
      )
      .run(run.runId);
    const evidence = await repo.getEvidence(run.runId);
    assert.equal(evidence.releasePolicyValid, false);
    assert.equal(evidence.releaseStateValid, false);
  } finally {
    sqlite.close();
  }
});

void test('scenario creation cannot bypass the configured per-intent admission limit', async () => {
  const { database, sqlite } = testDatabase();
  try {
    const settings = createWorkspaceRepository(database, 'admission-owner');
    await settings.updateSettings({
      ...(await settings.getSettings()),
      policy: { ...defaultPolicy, maxIntentUsd: 100 },
    });
    const repo = createAssuranceRepository(database, 'admission-owner');
    await assert.rejects(
      repo.createStressRun({
        scenarioId: 'stablecoin',
        severity: 1,
        liquidityFloor: 75,
      }),
      (error: unknown) =>
        error instanceof ApiError && error.code === 'HB_INTENT_LIMIT',
    );
    assert.equal((await repo.listRuns()).total, 0);
  } finally {
    sqlite.close();
  }
});
