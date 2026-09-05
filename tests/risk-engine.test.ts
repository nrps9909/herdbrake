import assert from 'node:assert/strict';
import test from 'node:test';
import { runRiskEngine, selectSafeRelease } from '../lib/herdbrake.ts';

void test('high severity creates a critical aggregate risk while every intent passes individually', () => {
  const result = runRiskEngine({ scenarioId: 'stablecoin', severity: 1 });
  assert.equal(result.state, 'CRITICAL');
  assert.ok(result.directionalAgreement >= 70);
  assert.equal(
    result.intents.every((intent) => intent.individualPolicy === 'PASS'),
    true,
  );
});

void test('lower severity stays below the fleet correlation breaker', () => {
  const result = runRiskEngine({
    scenarioId: 'stablecoin',
    severity: 0.1,
    liquidityFloor: 60,
  });
  assert.notEqual(result.state, 'CRITICAL');
});

void test('safe release prioritizes critical suppliers and returns unique intents', () => {
  const result = runRiskEngine({ scenarioId: 'stablecoin', severity: 1 });
  const selected = selectSafeRelease(result.intents, 5);
  assert.equal(selected.length, 5);
  assert.equal(new Set(selected).size, 5);
  assert.equal(
    selected.every(
      (id) => result.intents.find((intent) => intent.id === id)?.critical,
    ),
    true,
  );
});

void test('mixed-currency totals use the explicit synthetic USD conversion', async () => {
  const { amountInUsd, evaluateRisk, formatMoney } =
    await import('../lib/herdbrake.ts');
  const result = runRiskEngine({ scenarioId: 'stablecoin', severity: 1 });
  const intent = result.intents[0];
  assert.equal(intent.currency, 'TWD');
  assert.equal(amountInUsd(intent), 270_000);
  assert.match(formatMoney(intent.amount, intent.currency), /^NT\$/);
  const only = evaluateRisk([intent], 75);
  assert.equal(only.proposedOutflow, 270_000);
  assert.ok(Number.isFinite(evaluateRisk([], 75).directionalAgreement));
});

void test('safe release never reselects already released intents', () => {
  const result = runRiskEngine({ scenarioId: 'stablecoin', severity: 1 });
  const selected = selectSafeRelease(result.intents, 5);
  const next = runRiskEngine({
    scenarioId: 'stablecoin',
    severity: 1,
    releasedIds: selected,
  });
  assert.ok(
    selectSafeRelease(next.intents, 5).every((id) => !selected.includes(id)),
  );
});
