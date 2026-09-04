export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return Response.json(
    {
      openapi: '3.1.0',
      info: {
        title: 'HerdBrake Assurance API',
        version: '1.0.0',
        description:
          'Persistent pre-execution aggregate-risk controls for synthetic treasury-agent payment intents.',
      },
      servers: [{ url: origin }],
      paths: {
        '/api/health': {
          get: {
            summary: 'Check service and D1 connectivity',
            responses: {
              '200': { description: 'Healthy' },
              '503': { description: 'Database unavailable' },
            },
          },
        },
        '/api/runs': {
          get: {
            summary: 'Restore the latest persisted stress run',
            responses: {
              '200': { description: 'Latest run' },
              '204': { description: 'No run exists yet' },
            },
          },
          post: {
            summary: 'Create and persist a stress run',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['scenarioId', 'severity', 'liquidityFloor'],
                    properties: {
                      scenarioId: {
                        type: 'string',
                        enum: [
                          'stablecoin',
                          'fx',
                          'settlement',
                          'supplier',
                          'receivables',
                          'shared-feed',
                        ],
                      },
                      severity: { type: 'number', minimum: 0.1, maximum: 1 },
                      liquidityFloor: {
                        type: 'integer',
                        minimum: 50,
                        maximum: 95,
                      },
                    },
                  },
                },
              },
            },
            responses: {
              '201': {
                description:
                  'Run, intents, commitments, and initial audit chain created',
              },
              '400': { description: 'Invalid input' },
            },
          },
        },
        '/api/runs/{id}': {
          get: {
            summary: 'Read one persisted stress run',
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            responses: {
              '200': { description: 'Current run state' },
              '404': { description: 'Run not found' },
            },
          },
        },
        '/api/runs/{id}/release': {
          post: {
            summary: 'Idempotently stage a human-authorized release',
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
              {
                name: 'idempotency-key',
                in: 'header',
                required: true,
                schema: { type: 'string', minLength: 8 },
              },
            ],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
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
                    },
                  },
                },
              },
            },
            responses: {
              '200': {
                description:
                  'Release persisted or prior response replayed safely',
              },
              '400': {
                description: 'Invalid input or missing explicit authorization',
              },
              '404': { description: 'Run not found' },
            },
          },
        },
        '/api/runs/{id}/replay': {
          post: {
            summary: 'Probe duplicate nonce protection',
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            responses: {
              '200': { description: 'Replay blocked and audit event appended' },
            },
          },
        },
        '/api/runs/{id}/evidence': {
          get: {
            summary: 'Export a hash-verifiable evidence pack',
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            responses: {
              '200': {
                description:
                  'Evidence JSON with commitments, audit chain, and package hash',
              },
            },
          },
        },
      },
    },
    { headers: { 'cache-control': 'public, max-age=300' } },
  );
}
