import { sha256Hex, stableStringify } from './assurance-core.ts';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Pending = { signature: string; requestId: string; createdAt: number };

// Only a content fingerprint and request identity are kept in tab-scoped storage.
// This recovers an uncertain create after reload without storing invoice contents.
export function mutationRecovery(ownerId: string, storage?: Storage) {
  const memory = new Map<string, Pending>();
  const key = (kind: string) => `herdbrake:pending:${ownerId}:${kind}`;
  return {
    async requestId(kind: string, value: unknown) {
      const signature = await sha256Hex(stableStringify(value));
      let previous = memory.get(kind);
      if (!previous) {
        try {
          previous = JSON.parse(storage?.getItem(key(kind)) ?? 'null') as
            | Pending
            | undefined;
        } catch {
          /* Storage may be disabled or contain an incomplete value. */
        }
      }
      if (
        previous?.signature === signature &&
        typeof previous.requestId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          previous.requestId,
        ) &&
        previous.createdAt <= Date.now() &&
        Date.now() - previous.createdAt < 86_400_000
      ) {
        memory.set(kind, previous);
        return previous.requestId;
      }
      const next = {
        signature,
        requestId: crypto.randomUUID(),
        createdAt: Date.now(),
      };
      memory.set(kind, next);
      try {
        storage?.setItem(key(kind), JSON.stringify(next));
      } catch {
        /* In-memory retries remain available. */
      }
      return next.requestId;
    },
    complete(kind: string) {
      memory.delete(kind);
      try {
        storage?.removeItem(key(kind));
      } catch {
        /* Do not turn a confirmed save into a failure. */
      }
    },
  };
}
