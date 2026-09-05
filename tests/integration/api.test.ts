import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { csvTemplate } from '../../lib/import-csv.ts';
import type { WorkspaceSettings } from '../../lib/policy.ts';
import { scenarios } from '../../lib/herdbrake.ts';
import type { StoredRun } from '../../lib/contracts.ts';

const origin = process.env.HERDBRAKE_TEST_ORIGIN ?? 'http://localhost:3000';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname))
  throw new Error(
    'Integration tests create synthetic records and must target a local Worker.',
  );
let cookie = '';
before(async () => {
  const response = await fetch(
    new URL('/signin-with-chatgpt?return_to=%2Fworkspace', origin),
    { redirect: 'manual' },
  );
  assert.equal(
    response.status,
    302,
    'Run API acceptance against vinext dev with the official Sites local sign-in plugin.',
  );
  const session = response.headers.get('set-cookie');
  assert.ok(session?.includes('__sites_local_auth='));
  cookie = session!.split(';')[0];
});
const request = (path: string, body?: unknown, key?: string) =>
  fetch(new URL(path, origin), {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      cookie,
      'x-herdbrake-client': 'workspace',
      'content-type': 'application/json',
      ...(key ? { 'idempotency-key': key } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const create = async (scenarioId = 'stablecoin', severity = 1) => {
  const response = await request('/api/runs', {
    scenarioId,
    severity,
    liquidityFloor: 75,
  });
  assert.equal(response.status, 201, await response.clone().text());
  return response.json() as Promise<StoredRun>;
};
void test('real Worker persists recorded AI provenance, retries one request and rejects anonymous use', async () => {
  assert.equal((await fetch(new URL('/api/agents', origin))).status, 401);
  const capabilities = await request('/api/agents');
  assert.equal(capabilities.status, 200);
  const settings = (await (await request('/api/workspace')).json()) as {
    settings: WorkspaceSettings;
  };
  const body = {
    mode: 'recorded',
    policyRevision: settings.settings.revision,
    requestId: crypto.randomUUID(),
  };
  const first = await request('/api/agents', body);
  assert.equal(first.status, 201, await first.clone().text());
  const saved = (await first.json()) as StoredRun;
  assert.equal(saved.source, 'ai');
  assert.equal(saved.aiTrace?.mode, 'recorded');
  assert.equal(saved.risk.intents.length, 12);
  assert.ok(saved.risk.intents.every((i) => i.status === 'HELD'));
  const retry = await request('/api/agents', body);
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), saved);
  assert.equal(
    (await request('/api/agents', { ...body, mode: 'live' })).status,
    409,
  );
  const evidence = (await (
    await request(`/api/runs/${saved.runId}/evidence`)
  ).json()) as { audit: { chainValid: boolean }; policyValid: boolean };
  assert.equal(evidence.audit.chainValid, true);
  assert.equal(evidence.policyValid, true);
});
void test('local Worker health and all six scenario routes', async () => {
  assert.equal((await request('/api/health')).status, 200);
  for (const scenario of scenarios) {
    const run = await create(scenario.id);
    assert.equal(run.risk.intents.length, 30);
    assert.equal(run.auditEvents.length, 3);
    const restored = await request(`/api/runs/${run.runId}`);
    assert.equal(restored.status, 200);
    assert.deepEqual(await restored.json(), run);
  }
});
void test('real D1 concurrent release, stale-head protection and evidence chain', async () => {
  const run = await create();
  const body = {
    count: 5,
    prioritizeCritical: true,
    confirmed: true,
    authorizationReason: 'Local integration authorization',
    expectedAuditHead: run.auditHead,
  };
  const key = `integration:${crypto.randomUUID()}`;
  const responses = await Promise.all(
    Array.from({ length: 6 }, () =>
      request(`/api/runs/${run.runId}/release`, body, key),
    ),
  );
  for (const response of responses)
    assert.equal(response.status, 200, await response.clone().text());
  const payloads = await Promise.all(
    responses.map(
      (response) => response.json() as Promise<{ idempotentReplay: boolean }>,
    ),
  );
  assert.equal(payloads.filter((result) => !result.idempotentReplay).length, 1);
  assert.equal(
    (
      await request(
        `/api/runs/${run.runId}/release`,
        { ...body, count: 7 },
        key,
      )
    ).status,
    409,
  );
  assert.equal(
    (await request(`/api/runs/${run.runId}/release`, body, `${key}:new`))
      .status,
    409,
  );
  const probe = await request(`/api/runs/${run.runId}/replay`, {});
  assert.equal(probe.status, 200);
  const download = await request(`/api/runs/${run.runId}/evidence`);
  assert.equal(download.headers.get('cache-control'), 'no-store');
  assert.match(download.headers.get('content-disposition')!, /attachment/);
  const evidence = (await download.json()) as {
    audit: { chainValid: boolean };
    commitmentsValid: boolean;
    run: StoredRun;
  };
  assert.equal(evidence.audit.chainValid, true);
  assert.equal(evidence.commitmentsValid, true);
  assert.equal(
    evidence.run.risk.intents.filter((intent) => intent.status === 'RELEASED')
      .length,
    5,
  );
});
void test('Worker rejects invalid inputs with consistent JSON and no caching', async () => {
  for (const body of [
    null,
    [],
    { scenarioId: 'fx', severity: '1', liquidityFloor: 75 },
  ]) {
    const response = await request('/api/runs', body);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await request('/api/runs', 'x'.repeat(9000))).status, 413);
  const unsupported = await fetch(new URL('/api/runs', origin), {
    method: 'POST',
    headers: { cookie, 'x-herdbrake-client': 'workspace' },
    body: '{}',
  });
  assert.equal(unsupported.status, 415);
  assert.equal(
    (await request(`/api/runs/RUN-${crypto.randomUUID()}`)).status,
    404,
  );
  assert.equal((await request('/api/runs/RUN-invalid')).status, 400);
  const spec = (await (await request('/api/openapi')).json()) as {
    info: { version: string };
    paths: object;
  };
  assert.equal(spec.info.version, '2.0.0');
  assert.equal(Object.keys(spec.paths).length, 10);
});

void test('anonymous and spoofed identity requests are rejected; authenticated writes enforce same origin', async () => {
  for (const path of ['/api/runs', '/api/workspace', '/api/runs?list=1']) {
    assert.equal((await fetch(new URL(path, origin))).status, 401);
    const forged = await fetch(new URL(path, origin), {
      headers: {
        'oai-authenticated-user-id': 'forged',
        'oai-authenticated-user-email': 'forged@example.test',
      },
    });
    assert.equal(forged.status, 401);
  }
  const missingMarker = await fetch(new URL('/api/runs', origin), {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(missingMarker.status, 403);
  const crossOrigin = await fetch(new URL('/api/runs', origin), {
    method: 'POST',
    headers: {
      cookie,
      'x-herdbrake-client': 'workspace',
      origin: 'https://foreign.example',
      'content-type': 'application/json',
    },
    body: '{}',
  });
  assert.equal(crossOrigin.status, 403);
  // Vinext may reject cross-origin requests before the route handler executes.
  assert.ok(missingMarker.headers.get('x-request-id'));
  const page = await fetch(new URL('/workspace', origin), {
    redirect: 'manual',
  });
  assert.equal(page.status, 307);
  assert.match(page.headers.get('location')!, /signin-with-chatgpt/);
  const authenticated = await fetch(new URL('/workspace', origin), {
    headers: { cookie },
  });
  assert.equal(authenticated.status, 200);
  assert.match(await authenticated.text(), /工作總覽/);
});
void test('CSV import, policy version conflict, history search and downloads use real D1', async () => {
  const initial = (await (await request('/api/workspace')).json()) as {
    settings: WorkspaceSettings;
  };
  const body = {
    name: 'API acceptance import ' + crypto.randomUUID().slice(0, 8),
    csv: csvTemplate,
    policyRevision: initial.settings.revision,
  };
  const created = await request('/api/runs/import', body);
  assert.equal(created.status, 201, await created.clone().text());
  const run = (await created.json()) as StoredRun;
  assert.equal(run.intentCount, 3);
  assert.equal(run.source, 'import');
  const history = (await (
    await request('/api/runs?list=1&search=' + encodeURIComponent(body.name))
  ).json()) as { items: Array<{ id: string }>; total: number };
  assert.equal(history.total, 1);
  assert.equal(history.items[0].id, run.runId);
  const csv = await request(`/api/runs/${run.runId}/csv`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition')!, /attachment/);
  assert.match(await csv.text(), /Taipei HQ/);
  const invalid = await request('/api/runs/import', {
    ...body,
    csv: csvTemplate.replace('125000', '-1'),
  });
  assert.equal(invalid.status, 400);
  const stale = await request('/api/runs/import', {
    ...body,
    policyRevision: initial.settings.revision + 1,
  });
  assert.equal(stale.status, 409);
  const update = await fetch(new URL('/api/workspace', origin), {
    method: 'PATCH',
    headers: {
      cookie,
      'content-type': 'application/json',
      'x-herdbrake-client': 'workspace',
    },
    body: JSON.stringify(initial.settings),
  });
  assert.equal(update.status, 200);
  const updated = (await update.json()) as WorkspaceSettings;
  assert.equal(updated.revision, initial.settings.revision + 1);
  assert.equal((await request('/api/runs/import', body)).status, 409);
  const restored = (await (
    await request(`/api/runs/${run.runId}`)
  ).json()) as StoredRun;
  assert.deepEqual(restored.policy, run.policy);
  assert.equal(restored.policyRevision, run.policyRevision);
  const evidence = (await (
    await request(`/api/runs/${run.runId}/evidence`)
  ).json()) as { policyValid: boolean };
  assert.equal(evidence.policyValid, true);
});

void test('Worker enforces cumulative liquidity and preserves the audit head on a rejected approval', async () => {
  const created = await request('/api/runs', {
    scenarioId: 'stablecoin',
    severity: 1,
    liquidityFloor: 95,
  });
  assert.equal(created.status, 201);
  const run = (await created.json()) as StoredRun;
  const body = {
    count: 5,
    prioritizeCritical: true,
    confirmed: true,
    authorizationReason: 'Verify cumulative liquidity floor',
    expectedAuditHead: run.auditHead,
  };
  const approved = await request(
    `/api/runs/${run.runId}/release`,
    body,
    `floor:${crypto.randomUUID()}`,
  );
  assert.equal(approved.status, 200, await approved.clone().text());
  const before = (await (
    await request(`/api/runs/${run.runId}`)
  ).json()) as StoredRun;
  const rejected = await request(
    `/api/runs/${run.runId}/release`,
    { ...body, count: 10, expectedAuditHead: before.auditHead },
    `floor:${crypto.randomUUID()}`,
  );
  assert.equal(rejected.status, 422);
  assert.equal(
    ((await rejected.json()) as { code: string }).code,
    'HB_LIQUIDITY_FLOOR',
  );
  assert.deepEqual(
    await (await request(`/api/runs/${run.runId}`)).json(),
    before,
  );
  const evidence = (await (
    await request(`/api/runs/${run.runId}/evidence`)
  ).json()) as { releasePolicyValid: boolean };
  assert.equal(evidence.releasePolicyValid, true);
});
