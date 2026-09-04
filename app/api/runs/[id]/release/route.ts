import {
  InputError,
  NotFoundError,
  releaseIntents,
} from '@/lib/server/assurance-store';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const headerKey = request.headers.get('idempotency-key');
    const bodyKey =
      typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
    const result = await releaseIntents(id, {
      count: Number(body.count),
      prioritizeCritical: body.prioritizeCritical !== false,
      idempotencyKey: headerKey || bodyKey,
      confirmed: body.confirmed === true,
      authorizationReason:
        typeof body.authorizationReason === 'string'
          ? body.authorizationReason
          : '',
    });
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const status =
      error instanceof InputError || error instanceof NotFoundError
        ? error.status
        : error instanceof SyntaxError
          ? 400
          : 500;
    return Response.json(
      {
        error:
          status === 500
            ? 'Unable to stage release.'
            : (error as Error).message,
        code:
          status === 404
            ? 'HB_NOT_FOUND'
            : status === 400
              ? 'HB_INVALID_INPUT'
              : 'HB_INTERNAL',
      },
      { status, headers: { 'cache-control': 'no-store' } },
    );
  }
}
