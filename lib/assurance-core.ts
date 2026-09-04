export type HashAuditEvent = { id: string; eventType: string; detail: unknown; detailJson: string; previousHash: string | null; eventHash: string; createdAt: string };

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function makeAuditEvent(runId: string, eventType: string, detail: unknown, previousHash: string | null, createdAt: string): Promise<HashAuditEvent> {
  const eventHash = await sha256Hex(stableStringify({ runId, eventType, detail, previousHash, createdAt }));
  return { id: `EVT-${crypto.randomUUID()}`, eventType, detail, detailJson: JSON.stringify(detail), previousHash, eventHash, createdAt };
}

export async function verifyAuditChain(runId: string, events: Array<Pick<HashAuditEvent, 'eventType' | 'detail' | 'previousHash' | 'eventHash' | 'createdAt'>>) {
  let previous: string | null = null;
  for (const event of events) {
    if (event.previousHash !== previous) return false;
    const expected = await sha256Hex(stableStringify({ runId, eventType: event.eventType, detail: event.detail, previousHash: previous, createdAt: event.createdAt }));
    if (expected !== event.eventHash) return false;
    previous = event.eventHash;
  }
  return true;
}
