import assert from 'node:assert/strict';
import test from 'node:test';
import {
  makeAuditEvent,
  sha256Hex,
  stableStringify,
  verifyAuditChain,
} from '../lib/assurance-core.ts';

void test('canonical JSON produces the same commitment regardless of key order', async () => {
  const left = await sha256Hex(
    stableStringify({ amount: 4200, action: 'PAY' }),
  );
  const right = await sha256Hex(
    stableStringify({ action: 'PAY', amount: 4200 }),
  );
  assert.equal(left, right);
  assert.equal(left.length, 64);
});

void test('audit chain verifies and detects tampering', async () => {
  const runId = 'RUN-TEST';
  const first = await makeAuditEvent(
    runId,
    'INTENTS_EVALUATED',
    { count: 30 },
    null,
    '2026-09-04T08:00:00.000Z',
  );
  const second = await makeAuditEvent(
    runId,
    'BREAKER_TRIGGERED',
    { state: 'CRITICAL' },
    first.eventHash,
    '2026-09-04T08:00:01.000Z',
  );
  assert.equal(await verifyAuditChain(runId, [first, second]), true);
  assert.equal(
    await verifyAuditChain(runId, [
      first,
      { ...second, detail: { state: 'NORMAL' } },
    ]),
    false,
  );
});

void test('canonical JSON rejects unsupported values and uses locale-independent key ordering', () => {
  for (const value of [
    undefined,
    NaN,
    Infinity,
    { missing: undefined },
    new Date(),
    BigInt(1),
  ])
    assert.throws(() => stableStringify(value), TypeError);
  assert.equal(stableStringify({ z: 1, Z: 2, a: 3 }), '{"Z":2,"a":3,"z":1}');
});
void test('empty, reordered and cross-run audit trails fail verification', async () => {
  assert.equal(await verifyAuditChain('RUN-a', []), false);
  const first = await makeAuditEvent('RUN-a', 'FIRST', {}, null, '2026-09-05');
  const second = await makeAuditEvent(
    'RUN-a',
    'SECOND',
    {},
    first.eventHash,
    '2026-09-05',
  );
  assert.equal(await verifyAuditChain('RUN-a', [second, first]), false);
  assert.equal(await verifyAuditChain('RUN-b', [first, second]), false);
});
