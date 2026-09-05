import { scenarios } from '@/lib/herdbrake';
export const dynamic = 'force-dynamic';
const jsonBody = (schema: object) => ({
  required: true,
  content: { 'application/json': { schema } },
});
const id = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', pattern: '^RUN-[0-9a-f-]{36}$' },
};
const client = {
  name: 'x-herdbrake-client',
  in: 'header',
  required: true,
  schema: { type: 'string', const: 'workspace' },
  description:
    'Same-origin request marker. This does not authenticate the caller.',
};
const readErrors = {
  '401': { description: 'Sign in through Sites first' },
  '404': { description: 'Run absent or belongs to another account' },
  '500': { description: 'Internal error with request ID' },
};
const writeErrors = {
  ...readErrors,
  '400': { description: 'Invalid input' },
  '403': { description: 'Missing client marker or cross-origin mutation' },
  '409': {
    description:
      'Stale policy, audit head, conflicting key or invalid evidence',
  },
  '413': { description: 'Request too large' },
  '415': { description: 'Expected application/json' },
  '422': {
    description:
      'Cumulative approval exceeds the captured liquidity floor or per-intent limit; nothing is approved',
  },
  '429': {
    description: 'Per-account mutation limit exceeded; retry next minute',
  },
};
export async function GET(request: Request) {
  return Response.json(
    {
      openapi: '3.1.0',
      info: {
        title: 'HerdBrake Workspace API',
        version: '2.0.0',
        description:
          'All workspace and run routes require an authenticated Sites session. Sites dispatch supplies trusted identity; callers must not supply identity headers. Records are scoped to the signed-in user. Approval updates intent records only and never moves funds.',
      },
      servers: [{ url: new URL(request.url).origin }],
      paths: {
        '/api/agents': {
          get: {
            summary: 'Read live-model availability and recording provenance',
            responses: {
              '200': {
                description: 'Model metadata; no credentials or internal URL',
              },
              ...readErrors,
            },
          },
          post: {
            summary:
              'Run three independent model sessions or replay the bundled real inference, then save a held batch',
            parameters: [client],
            requestBody: jsonBody({
              type: 'object',
              required: ['mode', 'policyRevision', 'requestId'],
              properties: {
                mode: { type: 'string', enum: ['live', 'recorded'] },
                policyRevision: { type: 'integer', minimum: 0 },
                requestId: { type: 'string', format: 'uuid' },
              },
            }),
            responses: {
              '200': { description: 'Previously saved request' },
              '201': { description: 'Held batch with original model trace' },
              '502': {
                description:
                  'Invalid or incomplete model response; no batch created',
              },
              '503': {
                description: 'Live model unavailable; no synthetic fallback',
              },
              ...writeErrors,
            },
          },
        },
        '/api/health': {
          get: {
            summary: 'Check service and current D1 schema',
            responses: {
              '200': { description: 'Healthy' },
              '503': {
                description: 'Database unavailable or migration missing',
              },
            },
          },
        },
        '/api/workspace': {
          get: {
            summary: 'Read personal settings and latest 20 policy versions',
            responses: {
              '200': { description: 'Settings and history' },
              ...readErrors,
            },
          },
          patch: {
            summary: 'Save a new policy version atomically',
            parameters: [client],
            requestBody: jsonBody({
              type: 'object',
              required: ['name', 'revision', 'policy'],
              properties: {
                name: { type: 'string', minLength: 1, maxLength: 60 },
                revision: { type: 'integer', minimum: 0 },
                policy: { $ref: '#/components/schemas/Policy' },
              },
            }),
            responses: {
              '200': {
                description: 'Saved settings with incremented revision',
              },
              ...writeErrors,
            },
          },
        },
        '/api/runs': {
          get: {
            summary: 'Latest owned run, or paginated batch history with list=1',
            parameters: [
              {
                name: 'list',
                in: 'query',
                schema: { type: 'string', const: '1' },
              },
              {
                name: 'search',
                in: 'query',
                schema: { type: 'string', maxLength: 100 },
              },
              {
                name: 'state',
                in: 'query',
                schema: {
                  type: 'string',
                  enum: ['ALL', 'NORMAL', 'REVIEW', 'CRITICAL'],
                },
              },
              {
                name: 'page',
                in: 'query',
                schema: { type: 'integer', minimum: 0, maximum: 10000 },
              },
            ],
            responses: {
              '200': {
                description:
                  'Latest run or {items,total,page,summary}; history page size 20',
              },
              '204': { description: 'No latest run' },
              ...readErrors,
            },
          },
          post: {
            summary:
              'Persist a 30-intent synthetic scenario with policy snapshot',
            parameters: [client],
            requestBody: jsonBody({
              type: 'object',
              required: ['scenarioId', 'severity', 'liquidityFloor'],
              properties: {
                scenarioId: {
                  type: 'string',
                  enum: scenarios.map((item) => item.id),
                },
                severity: { type: 'number', minimum: 0.1, maximum: 1 },
                liquidityFloor: { type: 'integer', minimum: 50, maximum: 95 },
              },
            }),
            responses: { '201': { description: 'Stored run' }, ...writeErrors },
          },
        },
        '/api/runs/import': {
          post: {
            summary:
              'Validate and persist 1–50 CSV intents using the reviewed policy version',
            parameters: [client],
            requestBody: jsonBody({
              type: 'object',
              required: ['name', 'csv', 'policyRevision'],
              properties: {
                name: { type: 'string', minLength: 1, maxLength: 80 },
                csv: {
                  type: 'string',
                  description:
                    'UTF-8 up to 32768 bytes. Headers: entity,action,destination,amount,currency,critical. JSON request up to 40 KiB.',
                },
                policyRevision: { type: 'integer', minimum: 0 },
              },
            }),
            responses: {
              '201': { description: 'Stored imported batch' },
              ...writeErrors,
            },
          },
        },
        '/api/runs/{id}': {
          get: {
            summary: 'Read original intents and current audit state',
            parameters: [id],
            responses: { '200': { description: 'Stored run' }, ...readErrors },
          },
        },
        '/api/runs/{id}/release': {
          post: {
            summary: 'Idempotently record explicit human approval',
            parameters: [
              id,
              client,
              {
                name: 'idempotency-key',
                in: 'header',
                required: true,
                schema: {
                  type: 'string',
                  minLength: 8,
                  maxLength: 100,
                  pattern: '^[A-Za-z0-9:_-]+$',
                },
              },
            ],
            requestBody: jsonBody({
              type: 'object',
              required: ['count', 'confirmed', 'authorizationReason'],
              properties: {
                count: { type: 'integer', minimum: 1, maximum: 10 },
                prioritizeCritical: { type: 'boolean', default: true },
                confirmed: { type: 'boolean', const: true },
                authorizationReason: {
                  type: 'string',
                  minLength: 8,
                  maxLength: 160,
                },
                expectedAuditHead: {
                  type: 'string',
                  pattern: '^[a-f0-9]{64}$',
                  description:
                    'Bind approval to the reviewed snapshot. Retry transport failures with identical key and payload.',
                },
              },
            }),
            responses: {
              '200': {
                description:
                  'Original release result; idempotentReplay indicates a retry',
              },
              ...writeErrors,
            },
          },
        },
        '/api/runs/{id}/replay': {
          post: {
            summary:
              'Exercise the actual D1 nonce constraint and record the result',
            parameters: [id, client],
            responses: {
              '200': { description: 'Duplicate rejected; no funds moved' },
              ...writeErrors,
            },
          },
        },
        '/api/runs/{id}/evidence': {
          get: {
            summary:
              'Download original batch, audit chain, policy and integrity checks',
            parameters: [id],
            responses: {
              '200': {
                description:
                  'Evidence JSON including chainValid, commitmentsValid, policyValid, releaseStateValid and evidenceHash',
              },
              ...readErrors,
            },
          },
        },
        '/api/runs/{id}/csv': {
          get: {
            summary:
              'Export current intent states as spreadsheet-safe UTF-8 CSV',
            parameters: [id],
            responses: {
              '200': {
                description: 'CSV attachment; formula-like text is neutralized',
              },
              ...readErrors,
            },
          },
        },
      },
      components: {
        schemas: {
          Policy: {
            type: 'object',
            required: [
              'liquidityFloor',
              'openingLiquidity',
              'twdPerUsd',
              'usdcUsd',
              'herdThreshold',
              'concentrationThreshold',
              'maxIntentUsd',
            ],
            properties: {
              liquidityFloor: { type: 'integer', minimum: 50, maximum: 95 },
              openingLiquidity: {
                type: 'number',
                minimum: 1000,
                maximum: 1e12,
              },
              twdPerUsd: { type: 'number', minimum: 1, maximum: 1000 },
              usdcUsd: { type: 'number', minimum: 0.01, maximum: 10 },
              herdThreshold: { type: 'number', minimum: 50, maximum: 100 },
              concentrationThreshold: {
                type: 'number',
                minimum: 10,
                maximum: 100,
              },
              maxIntentUsd: { type: 'number', minimum: 1, maximum: 1e9 },
            },
          },
        },
      },
    },
    { headers: { 'cache-control': 'public, max-age=300' } },
  );
}
