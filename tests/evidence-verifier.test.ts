import assert from 'node:assert/strict';
import test from 'node:test';
import demo from '../docs/acceptance/demo-evidence-2026-09-06.json' with { type: 'json' };
import live from '../docs/acceptance/live-ai-ui-2026-09-06.json' with { type: 'json' };
import { sha256Hex, stableStringify } from '../lib/assurance-core.ts';
import { verifyEvidence } from '../lib/evidence-verifier.ts';

async function rehash(value: typeof demo) {
  const { evidenceHash: _hash, ...content } = value;
  value.evidenceHash = await sha256Hex(stableStringify(content));
  return value;
}
void test('offline verifier accepts actual recorded and live UI evidence', async () => {
  for (const value of [demo, live])
    assert.ok(
      Object.values(await verifyEvidence(value)).every((v) => v !== false),
    );
});
void test('recomputed package hash cannot hide an unaudited release', async () => {
  const value = structuredClone(demo);
  value.run.risk.intents.find((i) => i.status === 'HELD')!.status = 'RELEASED';
  const checks = await verifyEvidence(await rehash(value));
  assert.equal(checks.packageHash, true);
  assert.equal(checks.originalIntentCommitments, true);
  assert.equal(checks.releaseState, false);
  assert.equal(checks.reportedChecks, false);
});
void test('offline verifier catches a valid-prefix chain with a truncated tail', async () => {
  const value = structuredClone(demo);
  value.run.auditEvents.pop();
  value.audit.events = structuredClone(value.run.auditEvents);
  const checks = await verifyEvidence(await rehash(value));
  assert.equal(checks.packageHash, true);
  assert.equal(checks.auditChain, false);
});
void test('offline verifier recomputes cumulative outflow instead of trusting reported flags', async () => {
  const value = structuredClone(demo);
  for (const intent of value.run.risk.intents) intent.status = 'RELEASED';
  const checks = await verifyEvidence(await rehash(value));
  assert.equal(checks.packageHash, true);
  assert.equal(checks.releasePolicy, false);
});
void test('offline verifier rejects changed policy and a model trace detached from the audit', async () => {
  const policy = structuredClone(demo);
  policy.run.policy.liquidityFloor = 75;
  assert.equal(
    (await verifyEvidence(await rehash(policy))).policySnapshot,
    false,
  );
  const model = structuredClone(demo);
  model.run.aiTrace.sessions[0].response = '{}';
  assert.equal(
    (await verifyEvidence(await rehash(model))).modelRecording,
    false,
  );
});
void test('malformed evidence and dishonest server flags fail closed', async () => {
  for (const value of [null, {}, { schemaVersion: '2.0', run: {} }]) {
    assert.equal((await verifyEvidence(value)).schema, false);
  }
  const value = structuredClone(demo);
  value.audit.chainValid = false;
  const checks = await verifyEvidence(await rehash(value));
  assert.equal(checks.auditChain, true);
  assert.equal(checks.reportedChecks, false);
});
