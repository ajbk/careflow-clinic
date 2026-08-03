import stableStringify from "fast-json-stable-stringify";
import type { DatabaseHandle } from "../../db/client.js";
import type { Actor } from "../../../shared/contracts.js";
import { auditEvents } from "./schema.js";

export type AppDatabase = DatabaseHandle["db"];
export type AppTransaction = Parameters<Parameters<AppDatabase["transaction"]>[0]>[0];

declare const auditedTransactionBrand: unique symbol;
export type AuditedTransaction = AppTransaction & {
  readonly [auditedTransactionBrand]: true;
};

export type AuditActor =
  | Actor
  | { id: null; role: "system"; displayName: "maintenance-cli" };

const transactionActors = new WeakMap<AppTransaction, AuditActor>();

interface AuditEventBaseInput {
  tx: AuditedTransaction;
  actor: AuditActor;
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  entityRevision: number;
  occurredAt: string;
  metadata?: Record<string, unknown>;
}

export type AuditEventInput = AuditEventBaseInput &
  (
    | { reasonRequired: true; reason: string }
    | { reasonRequired: false; reason: string | null }
  );

export function appendAuditEvent(input: AuditEventInput): void {
  const transactionActor = transactionActors.get(input.tx);
  if (
    !transactionActor ||
    transactionActor.id !== input.actor.id ||
    transactionActor.role !== input.actor.role ||
    transactionActor.displayName !== input.actor.displayName
  ) {
    throw new Error("Audit actor does not match transaction actor");
  }
  if (
    input.reasonRequired &&
    (typeof input.reason !== "string" || input.reason.trim().length === 0)
  ) {
    throw new Error("Audit reason is required");
  }

  input.tx
    .insert(auditEvents)
    .values({
      id: input.id,
      clinicId: "clinic",
      actorId: input.actor.id,
      actorRole: input.actor.role,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      entityRevision: input.entityRevision,
      reason: input.reason,
      occurredAt: input.occurredAt,
      metadataJson: stableStringify(input.metadata ?? {}),
    })
    .run();
}

export function runBoundAuditedTransaction<T>(input: {
  db: AppDatabase;
  actor: AuditActor;
  work: (tx: AuditedTransaction) => T;
}): T {
  const actor = { ...input.actor } as AuditActor;
  return input.db.transaction(
    (tx) => {
      transactionActors.set(tx, actor);
      try {
        return input.work(tx as AuditedTransaction);
      } finally {
        transactionActors.delete(tx);
      }
    },
    { behavior: "immediate" },
  );
}

export function runAuditedTransaction<T>(input: {
  db: AppDatabase;
  actor: AuditActor;
  work: (tx: AuditedTransaction) => T;
}): T {
  return runBoundAuditedTransaction(input);
}
