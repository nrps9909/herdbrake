import { InputError, NotFoundError, runReplayProbe } from '@/lib/server/assurance-store';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { const { id } = await context.params; return Response.json(await runReplayProbe(id), { headers: { 'cache-control': 'no-store' } }); }
  catch (error) { const status = error instanceof NotFoundError ? 404 : error instanceof InputError ? 400 : 500; return Response.json({ error: error instanceof NotFoundError || error instanceof InputError ? error.message : 'Unable to run replay probe.', code: status === 404 ? 'HB_NOT_FOUND' : status === 400 ? 'HB_INVALID_INPUT' : 'HB_INTERNAL' }, { status }); }
}
