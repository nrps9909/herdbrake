export type HashAuditEvent = {
  id: string;
  eventType: string;
  detail: unknown;
  detailJson: string;
  previousHash: string | null;
  eventHash: string;
  createdAt: string;
};

// Hash only JSON-compatible data, with locale-independent UTF-16 key ordering.
export function stableStringify(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (
    value &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('Commitment data must contain only finite JSON values.');
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export async function makeAuditEvent(
  runId: string,
  eventType: string,
  detail: unknown,
  previousHash: string | null,
  createdAt: string,
): Promise<HashAuditEvent> {
  const eventHash = await sha256Hex(
    stableStringify({ runId, eventType, detail, previousHash, createdAt }),
  );
  return {
    id: `EVT-${crypto.randomUUID()}`,
    eventType,
    detail,
    detailJson: JSON.stringify(detail),
    previousHash,
    eventHash,
    createdAt,
  };
}

export async function verifyAuditChain(
  runId: string,
  events: Array<
    Pick<
      HashAuditEvent,
      'eventType' | 'detail' | 'previousHash' | 'eventHash' | 'createdAt'
    >
  >,
) {
  if (events.length === 0) return false;
  let previous: string | null = null;
  for (const event of events) {
    if (event.previousHash !== previous) return false;
    const expected = await sha256Hex(
      stableStringify({
        runId,
        eventType: event.eventType,
        detail: event.detail,
        previousHash: previous,
        createdAt: event.createdAt,
      }),
    );
    if (expected !== event.eventHash) return false;
    previous = event.eventHash;
  }
  return true;
}
