import assert from 'node:assert/strict';
import test from 'node:test';
import { makeAuditEvent, sha256Hex, stableStringify, verifyAuditChain } from '../lib/assurance-core.ts';

test('canonical JSON produces the same commitment regardless of key order', async () => {
  const left = await sha256Hex(stableStringify({ amount: 4200, action: 'PAY' }));
  const right = await sha256Hex(stableStringify({ action: 'PAY', amount: 4200 }));
  assert.equal(left, right);
  assert.equal(left.length, 64);
});

test('audit chain verifies and detects tampering', async () => {
  const runId = 'RUN-TEST';
  const first = await makeAuditEvent(runId, 'INTENTS_EVALUATED', { count: 30 }, null, '2026-09-04T08:00:00.000Z');
  const second = await makeAuditEvent(runId, 'BREAKER_TRIGGERED', { state: 'CRITICAL' }, first.eventHash, '2026-09-04T08:00:01.000Z');
  assert.equal(await verifyAuditChain(runId, [first, second]), true);
  assert.equal(await verifyAuditChain(runId, [first, { ...second, detail: { state: 'NORMAL' } }]), false);
});
