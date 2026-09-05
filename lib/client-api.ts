import type {
  RunInput,
  StoredRun,
  ReleaseInput,
  ReleaseResult,
  ReplayResult,
} from './contracts.ts';
import { ApiError } from './errors.ts';

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeout])
    : timeout;
  const headers = new Headers(init.headers);
  headers.set('x-herdbrake-client', 'workspace');
  const response = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers,
    signal,
  });
  if (response.status === 204) return null as T;
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(
      'Service returned an unreadable response. Refresh to verify the result.',
      502,
      'HB_INVALID_RESPONSE',
    );
  }
  if (!response.ok) {
    const error = payload as { error?: string; code?: string } | null;
    throw new ApiError(
      error?.error ?? 'Request failed. Refresh to verify the result.',
      response.status,
      error?.code ?? 'HB_REQUEST_FAILED',
    );
  }
  return payload as T;
}
const runPath = (id: string) => `/api/runs/${encodeURIComponent(id)}`;
const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
export const assuranceApi = {
  latest: (signal?: AbortSignal) =>
    apiRequest<StoredRun | null>('/api/runs', { signal }),
  create: (input: RunInput) => apiRequest<StoredRun>('/api/runs', post(input)),
  get: (id: string) => apiRequest<StoredRun>(runPath(id)),
  release: (id: string, input: ReleaseInput) =>
    apiRequest<ReleaseResult>(`${runPath(id)}/release`, {
      ...post(input),
      headers: {
        'content-type': 'application/json',
        'idempotency-key': input.idempotencyKey,
      },
    }),
  replay: (id: string) =>
    apiRequest<ReplayResult>(`${runPath(id)}/replay`, { method: 'POST' }),
  evidence: (id: string) => apiRequest<unknown>(`${runPath(id)}/evidence`),
};
