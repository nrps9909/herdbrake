import { createStressRun, getLatestStoredRun, InputError } from '@/lib/server/assurance-store';
import { ScenarioId } from '@/lib/herdbrake';

export const dynamic = 'force-dynamic';

export async function GET() {
  try { const latest = await getLatestStoredRun(); return latest ? Response.json(latest, { headers: { 'cache-control': 'no-store' } }) : new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } }); }
  catch { return Response.json({ error: 'Unable to restore the latest run.', code: 'HB_INTERNAL' }, { status: 500, headers: { 'cache-control': 'no-store' } }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const result = await createStressRun({ scenarioId: body.scenarioId as ScenarioId, severity: Number(body.severity), liquidityFloor: Number(body.liquidityFloor) });
    return Response.json(result, { status: 201, headers: { 'cache-control': 'no-store', location: `/api/runs/${encodeURIComponent(result.runId)}` } });
  } catch (error) { return apiError(error); }
}

function apiError(error: unknown) { const status = error instanceof InputError ? error.status : error instanceof SyntaxError ? 400 : 500; return Response.json({ error: status === 500 ? 'Unable to create stress run.' : (error as Error).message, code: status === 500 ? 'HB_INTERNAL' : 'HB_INVALID_INPUT' }, { status, headers: { 'cache-control': 'no-store' } }); }
