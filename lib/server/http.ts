import { ApiError } from '../errors.ts';

export type RunContext = { params: Promise<{ id: string }> };
export function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('cache-control', 'no-store');
  return Response.json(data, { ...init, headers });
}

export async function apiHandler(
  action: () => Promise<Response>,
  failure: string,
) {
  const requestId = crypto.randomUUID();
  try {
    const response = await action();
    response.headers.set('x-request-id', requestId);
    return response;
  } catch (error) {
    const known = error instanceof ApiError;
    if (!known)
      console.error(
        JSON.stringify({
          level: 'error',
          code: 'HB_INTERNAL',
          requestId,
          event: 'api_request_failed',
        }),
      );
    return json(
      {
        error: known ? error.message : failure,
        code: known ? error.code : 'HB_INTERNAL',
        requestId,
      },
      {
        status: known ? error.status : 500,
        headers: {
          'x-request-id': requestId,
          ...(known && error.status === 429 ? { 'retry-after': '60' } : {}),
        },
      },
    );
  }
}

export async function readJson(
  request: Request,
  maxBytes = 8192,
): Promise<unknown> {
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
    'application/json'
  )
    throw new ApiError(
      'Content-Type must be application/json.',
      415,
      'HB_UNSUPPORTED_MEDIA_TYPE',
    );
  // Stream a bounded body; Content-Length alone cannot limit chunked requests.
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError('A JSON body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ApiError(
          `Request body exceeds ${maxBytes / 1024} KiB.`,
          413,
          'HB_PAYLOAD_TOO_LARGE',
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError('Malformed JSON body.');
  }
}
