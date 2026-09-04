import assert from 'node:assert/strict';
import test from 'node:test';
import { runRiskEngine, selectSafeRelease } from '../lib/herdbrake.ts';

test('high severity creates a critical aggregate risk while every intent passes individually', () => {
  const result = runRiskEngine({ scenarioId: 'stablecoin', severity: 1 });
  assert.equal(result.state, 'CRITICAL');
  assert.ok(result.directionalAgreement >= 70);
  assert.equal(result.intents.every((intent) => intent.individualPolicy === 'PASS'), true);
});

test('lower severity stays below the fleet correlation breaker', () => {
  const result = runRiskEngine({ scenarioId: 'stablecoin', severity: 0.1, liquidityFloor: 60 });
  assert.notEqual(result.state, 'CRITICAL');
});

test('safe release prioritizes critical suppliers and returns unique intents', () => {
  const result = runRiskEngine({ scenarioId: 'stablecoin', severity: 1 });
  const selected = selectSafeRelease(result.intents, 5);
  assert.equal(selected.length, 5);
  assert.equal(new Set(selected).size, 5);
  assert.equal(selected.every((id) => result.intents.find((intent) => intent.id === id)?.critical), true);
});
