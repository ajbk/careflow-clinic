export interface CommandAttempt<TPayload, TRevisions extends Record<string, number>> {
  readonly idempotencyKey: string;
  readonly expectedRevisions: TRevisions;
  readonly payload: TPayload;
  readonly generation?: string;
  readonly owner?: string;
}

let currentGeneration: string | undefined;
let currentOwner: string | undefined;
export function setCommandGeneration(generation: string | undefined, owner?: string): void { currentGeneration = generation; currentOwner = owner; }

function freezeValue<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) freezeValue(child, seen);
  Object.freeze(value);
  return value;
}

/** Creates one immutable mutation attempt. Explicit retries reuse this object and UUID. */
export function createCommandAttempt<
  TPayload,
  TRevisions extends Record<string, number>,
>(expectedRevisions: TRevisions, payload: TPayload): CommandAttempt<TPayload, TRevisions> {
  const attempt = {
    idempotencyKey: globalThis.crypto.randomUUID(),
    expectedRevisions: freezeValue(expectedRevisions),
    payload: freezeValue(payload),
    ...(currentGeneration ? { generation: currentGeneration, owner: currentOwner } : {}),
  } as CommandAttempt<TPayload, TRevisions>;
  return Object.freeze(attempt);
}
