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

type SystemAuditActor = { id: null; role: "system"; displayName: "maintenance-cli" };
type BoundAuditActor = Actor | SystemAuditActor;

const systemAuditActor: SystemAuditActor = {
  id: null,
  role: "system",
  displayName: "maintenance-cli",
};

const transactionActors = new WeakMap<AppTransaction, BoundAuditActor>();

const auditActionPolicyEntries = [
  ["account.created", "optional"],
  ["account.disabled", "optional"],
  ["account.password-reset", "optional"],
  ["account.password-changed", "optional"],
  ["account.pilot-acknowledged", "optional"],
  ["patient.synthetic-created", "optional"],
  ["visit.intake-submitted", "optional"],
  ["visit.consultation-started", "optional"],
  ["allergy.updated", "required"],
  ["note.draft-saved", "optional"],
  ["note.signed", "optional"],
  ["medication.decision-signed", "optional"],
  ["visit.consultation-finalized", "optional"],
  ["note.amendment-signed", "required"],
  ["medication.decision-revised", "required"],
  ["visit.allergy-safety-changed", "required"],
  ["inventory.stock-received", "optional"],
  ["inventory.reservation-created", "optional"],
  ["inventory.reservation-released", "required"],
  ["visit.preparation-started", "optional"],
  ["visit.preparation-abandoned", "required"],
  ["label.version-created", "optional"],
  ["label.print-requested", "optional"],
  ["preparation.allocation-confirmed", "optional"],
  ["visit.preparation-completed", "optional"],
  ["fulfillment.artifacts-invalidated", "required"],
] as const;

type AuditActionPolicyEntry = (typeof auditActionPolicyEntries)[number];
export type AuditAction = AuditActionPolicyEntry[0];
type AuditReasonRequirement<TAction extends AuditAction> = Extract<
  AuditActionPolicyEntry,
  readonly [TAction, "optional" | "required"]
>[1];

const auditActionPolicy: ReadonlyMap<string, "optional" | "required"> = new Map(
  auditActionPolicyEntries,
);

interface AuditEventBaseInput<TAction extends AuditAction> {
  tx: AuditedTransaction;
  id: string;
  action: TAction;
  entityType: string;
  entityId: string;
  entityRevision: number;
  occurredAt: string;
  metadata?: Record<string, unknown>;
}

type AuditReasonInput<TAction extends AuditAction> =
  AuditReasonRequirement<TAction> extends "required"
    ? { reason: string }
    : { reason: string | null };

export type AuditEventDetails<TAction extends AuditAction = AuditAction> =
  TAction extends AuditAction
    ? AuditEventBaseInput<TAction> & AuditReasonInput<TAction>
    : never;

export type AuditEventInput<TAction extends AuditAction = AuditAction> =
  AuditEventDetails<TAction> & { actor: Actor };

const canonicalUtcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isCanonicalUtcTimestamp(value: string): boolean {
  if (!canonicalUtcTimestampPattern.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function assertNamedActor(actor: unknown): asserts actor is Actor {
  if (
    typeof actor !== "object" ||
    actor === null ||
    !("id" in actor) ||
    typeof actor.id !== "string" ||
    actor.id.length === 0 ||
    !("role" in actor) ||
    (actor.role !== "assistant" && actor.role !== "doctor") ||
    !("displayName" in actor) ||
    typeof actor.displayName !== "string"
  ) {
    throw new Error("Named actor required");
  }
}

function appendBoundAuditEvent<TAction extends AuditAction>(
  input: AuditEventDetails<TAction> & { actor: BoundAuditActor },
): void {
  const transactionActor = transactionActors.get(input.tx);
  if (
    !transactionActor ||
    transactionActor.id !== input.actor.id ||
    transactionActor.role !== input.actor.role ||
    transactionActor.displayName !== input.actor.displayName
  ) {
    throw new Error("Audit actor does not match transaction actor");
  }
  const policy = auditActionPolicy.get(input.action);
  if (!policy) {
    throw new Error("Unknown Audit action");
  }
  if (
    policy === "required" &&
    (typeof input.reason !== "string" || input.reason.trim().length === 0)
  ) {
    throw new Error("Audit reason is required");
  }
  if (!isCanonicalUtcTimestamp(input.occurredAt)) {
    throw new Error("Audit timestamp must be canonical UTC");
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

export function appendAuditEvent<TAction extends AuditAction>(
  input: AuditEventInput<TAction>,
): void {
  assertNamedActor(input.actor);
  appendBoundAuditEvent(input);
}

function runBoundAuditedTransaction<T>(input: {
  db: AppDatabase;
  actor: BoundAuditActor;
  work: (tx: AuditedTransaction) => T;
}): T {
  const actor = { ...input.actor } as BoundAuditActor;
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

export function runNamedAuditedTransactionInternal<T>(input: {
  db: AppDatabase;
  actor: Actor;
  work: (tx: AuditedTransaction) => T;
}): T {
  assertNamedActor(input.actor);
  return runBoundAuditedTransaction(input);
}

export const maintenanceAuditCapability = Object.freeze({
  append<TAction extends AuditAction>(input: AuditEventDetails<TAction>): void {
    appendBoundAuditEvent({ ...input, actor: systemAuditActor });
  },
  run<T>(input: {
    db: AppDatabase;
    work: (tx: AuditedTransaction) => T;
  }): T {
    return runBoundAuditedTransaction({
      db: input.db,
      actor: systemAuditActor,
      work: input.work,
    });
  },
});

export function runAuditedTransaction<T>(input: {
  db: AppDatabase;
  actor: Actor;
  work: (tx: AuditedTransaction) => T;
}): T {
  return runNamedAuditedTransactionInternal(input);
}
