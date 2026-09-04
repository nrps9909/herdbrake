import { getStoredRun, InputError } from '@/lib/server/assurance-store';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { const { id } = await context.params; const result = await getStoredRun(id); if (!result) return Response.json({ error: 'Stress run not found.', code: 'HB_NOT_FOUND' }, { status: 404 }); return Response.json(result, { headers: { 'cache-control': 'no-store' } }); }
  catch (error) { const invalid = error instanceof InputError; return Response.json({ error: invalid ? error.message : 'Unable to read stress run.', code: invalid ? 'HB_INVALID_INPUT' : 'HB_INTERNAL' }, { status: invalid ? 400 : 500 }); }
}
