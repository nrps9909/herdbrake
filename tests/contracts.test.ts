import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseRunInput,
  parseReleaseInput,
  validateRunId,
} from '../lib/contracts.ts';
import { ApiError } from '../lib/errors.ts';
import { apiHandler, json, readJson } from '../lib/server/http.ts';

const validRun = { scenarioId: 'fx', severity: 0.5, liquidityFloor: 75 };
const validRelease = {
  count: 5,
  prioritizeCritical: true,
  confirmed: true,
  authorizationReason: 'Supplier continuity',
  idempotencyKey: 'release:test',
};
for (const value of [
  null,
  [],
  'abc',
  { ...validRun, severity: '0.5' },
  { ...validRun, severity: true },
  { ...validRun, severity: NaN },
  { ...validRun, liquidityFloor: null },
  { ...validRun, scenarioId: 'missing' },
]) {
  void test(`reject invalid run input: ${JSON.stringify(value)}`, () =>
    assert.throws(() => parseRunInput(value), ApiError));
}
void test('release validates types and exact confirmation', () => {
  for (const update of [
    { count: '5' },
    { count: true },
    { count: 0 },
    { prioritizeCritical: 'false' },
    { confirmed: 'true' },
    { authorizationReason: '       ' },
    { expectedAuditHead: 'invalid' },
  ]) {
    assert.throws(
      () => parseReleaseInput({ ...validRelease, ...update }),
      ApiError,
    );
  }
  assert.throws(
    () => parseReleaseInput(validRelease, 'release:different'),
    ApiError,
  );
  assert.equal(parseReleaseInput(validRelease).count, 5);
});
void test('run identifier requires a canonical UUID layout', () => {
  validateRunId(`RUN-${crypto.randomUUID()}`);
  assert.throws(() => validateRunId(`RUN-${'-'.repeat(36)}`), ApiError);
});
void test('HTTP layer bounds chunked bodies and handles invalid media and syntax', async () => {
  const request = (body: string, type = 'application/json') =>
    new Request('https://local/api/runs', {
      method: 'POST',
      headers: { 'content-type': type },
      body,
    });
  assert.deepEqual(await readJson(request(JSON.stringify(validRun))), validRun);
  await assert.rejects(readJson(request('{')), ApiError);
  await assert.rejects(
    readJson(request('{}', 'text/plain')),
    (error: unknown) => error instanceof ApiError && error.status === 415,
  );
  await assert.rejects(
    readJson(request('x'.repeat(9000))),
    (error: unknown) => error instanceof ApiError && error.status === 413,
  );
});
void test('all API responses disable caching and hide internal errors', async (context) => {
  const logger = context.mock.method(console, 'error', () => undefined);
  assert.equal(json({ ok: true }).headers.get('cache-control'), 'no-store');
  const response = await apiHandler(async () => {
    throw new Error('database internals');
  }, 'Unable to read run.');
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: 'Unable to read run.',
    code: 'HB_INTERNAL',
    requestId: response.headers.get('x-request-id'),
  });
  assert.match(response.headers.get('x-request-id')!, /^[a-f0-9-]{36}$/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(logger.mock.callCount(), 1);
  const log = String(logger.mock.calls[0].arguments[0]);
  assert.ok(log.includes(response.headers.get('x-request-id')!));
  assert.ok(!log.includes('database internals'));
});
