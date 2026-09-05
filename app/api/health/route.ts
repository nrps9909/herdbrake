import { getDatabase } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const startedAt = Date.now();
  try {
    await getDatabase()
      .prepare(
        'SELECT owner_id,policy_json,revision FROM stress_runs UNION ALL SELECT owner_id,policy_json,revision FROM workspace_settings LIMIT 1',
      )
      .first();
    return Response.json(
      {
        status: 'ok',
        database: 'connected',
        service: 'herdbrake-assurance',
        latencyMs: Date.now() - startedAt,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    return Response.json(
      {
        status: 'degraded',
        database: 'unavailable',
        service: 'herdbrake-assurance',
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
