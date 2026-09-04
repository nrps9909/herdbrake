import { getEvidence, InputError, NotFoundError } from '@/lib/server/assurance-store';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { const { id } = await context.params; return Response.json(await getEvidence(id), { headers: { 'cache-control': 'no-store', 'content-disposition': 'attachment; filename="herdbrake-evidence.json"' } }); }
  catch (error) { const status = error instanceof NotFoundError ? 404 : error instanceof InputError ? 400 : 500; return Response.json({ error: error instanceof NotFoundError || error instanceof InputError ? error.message : 'Unable to create evidence pack.', code: status === 404 ? 'HB_NOT_FOUND' : status === 400 ? 'HB_INVALID_INPUT' : 'HB_INTERNAL' }, { status }); }
}
