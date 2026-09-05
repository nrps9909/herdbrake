import assert from 'node:assert/strict';
import test from 'node:test';
import { apiRequest, assuranceApi } from '../lib/client-api.ts';
import { ApiError } from '../lib/errors.ts';

void test('client treats failed restores as errors, not ready state', async (context) => {
  context.mock.method(globalThis, 'fetch', async () =>
    Response.json(
      { error: 'Database unavailable', code: 'HB_INTERNAL' },
      { status: 500 },
    ),
  );
  await assert.rejects(
    assuranceApi.latest(),
    (error: unknown) => error instanceof ApiError && error.status === 500,
  );
});
void test('client handles empty stores and non-JSON service responses', async (context) => {
  const fetchMock = context.mock.method(
    globalThis,
    'fetch',
    async () => new Response(null, { status: 204 }),
  );
  assert.equal(await assuranceApi.latest(), null);
  fetchMock.mock.mockImplementation(
    async () => new Response('<html>upstream error</html>', { status: 502 }),
  );
  await assert.rejects(
    apiRequest('/api/runs'),
    (error: unknown) =>
      error instanceof ApiError && error.code === 'HB_INVALID_RESPONSE',
  );
});
void test('release transports the original authorization and idempotency key unchanged', async (context) => {
  const input = {
    count: 5,
    prioritizeCritical: true,
    confirmed: true as const,
    authorizationReason: 'Supplier continuity',
    idempotencyKey: 'release:retry',
    expectedAuditHead: 'a'.repeat(64),
  };
  context.mock.method(
    globalThis,
    'fetch',
    async (_path: string, init: RequestInit) => {
      assert.equal(
        new Headers(init.headers).get('idempotency-key'),
        input.idempotencyKey,
      );
      assert.deepEqual(JSON.parse(init.body as string), input);
      assert.equal(init.cache, 'no-store');
      assert.ok(init.signal);
      return Response.json({ releasedCount: 5 });
    },
  );
  await assuranceApi.release(`RUN-${crypto.randomUUID()}`, input);
});
