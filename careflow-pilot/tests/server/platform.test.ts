import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as auditModule from "../../src/server/modules/platform/audit.js";
import * as platform from "../../src/server/modules/platform/index.js";
import {
  appendAuditEvent,
  assertExpectedRevision,
  auditEvents,
  clinicCounters,
  executeIdempotent,
  hasPermission,
  hashEvidence,
  idempotencyRecords,
  requirePermission,
  runAuditedTransaction,
  type Actor,
  type CommandBody,
} from "../../src/server/modules/platform/index.js";
import {
  appendMaintenanceAuditEvent,
  runMaintenanceAuditedTransaction,
} from "../../src/server/maintenance/audit.js";
import { createTestDatabase, type TestDatabase } from "./helpers/database.js";

const cleanups: Array<() => void> = [];
const occurredAt = "2026-08-03T01:02:03.000Z";

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function databaseWithActor(role: Actor["role"] = "doctor"): {
  database: TestDatabase;
  actor: Actor;
} {
  const database = createTestDatabase();
  cleanups.push(database.cleanup);
  const actor: Actor = {
    id: `${role}-001`,
    role,
    displayName: role === "doctor" ? "พญ. ทดสอบ" : "ผู้ช่วยทดสอบ",
  };

  database.sqlite
    .prepare(
      `INSERT INTO staff_accounts (
        id, clinic_id, username, display_name, role, password_hash,
        must_change_password, pilot_acknowledged_at, active, revision,
        last_password_changed_at, disabled_at, created_at, updated_at
      ) VALUES (?, 'clinic', ?, ?, ?, 'test-password-hash', 0, ?, 1, 1, ?, NULL, ?, ?)`,
    )
    .run(
      actor.id,
      actor.id,
      actor.displayName,
      actor.role,
      occurredAt,
      occurredAt,
      occurredAt,
      occurredAt,
    );

  return { database, actor };
}

function commandBody(
  payload: Record<string, unknown> = { a: 1, b: 2 },
): CommandBody<unknown, Record<string, number>> {
  return { expectedRevisions: { patient: 1 }, payload };
}

function appendTestAudit(
  tx: Parameters<typeof appendAuditEvent>[0]["tx"],
  actor: Actor,
  entityId: string,
): void {
  appendAuditEvent({
    tx,
    actor,
    id: `audit-${entityId}`,
    action: "patient.synthetic-created",
    entityType: "test-entity",
    entityId,
    entityRevision: 1,
    reason: null,
    occurredAt,
    metadata: { source: "platform-test" },
  });
}

describe("role permissions", () => {
  it("assigns clinical and inventory permissions only to the roles authorized to perform them", () => {
    expect(platform.permissionsByRole).toEqual({
      assistant: [
        "patient:read",
        "patient:create-synthetic",
        "visit:submit-intake",
        "visit:read-queue",
        "patient:update-allergy",
      "inventory:read",
      "inventory:receive",
      "inventory:reserve",
      "fulfillment:read",
      "fulfillment:prepare",
      "label:print",
      ],
      doctor: [
        "patient:read",
        "patient:create-synthetic",
        "visit:submit-intake",
        "visit:read-queue",
        "visit:start-consultation",
        "patient:update-allergy",
        "clinical:read",
        "clinical:save-draft",
        "clinical:sign",
        "clinical:amend",
        "medication:read-catalog",
        "medication:sign-decision",
      "inventory:read",
      "inventory:reserve",
      "fulfillment:read",
      "fulfillment:prepare",
      "label:print",
      "fulfillment:release",
      "fulfillment:handoff",
      "inventory:quarantine",
      "inventory:release-quarantine",
      "inventory:adjust",
      ],
    });
  });

  it.each([
    { role: "assistant" as const, allowed: false },
    { role: "doctor" as const, allowed: true },
  ])("reports visit:start-consultation=$allowed for $role", ({ role, allowed }) => {
    const actor: Actor = { id: `${role}-001`, role, displayName: role };

    expect(hasPermission(actor, "visit:start-consultation")).toBe(allowed);
  });

  it("rejects an Assistant that directly requests a Doctor permission", () => {
    const actor: Actor = { id: "assistant-001", role: "assistant", displayName: "Assistant" };

    expect(() => requirePermission(actor, "visit:start-consultation")).toThrowError(
      expect.objectContaining({ code: "FORBIDDEN", statusCode: 403 }),
    );
  });
});

describe("idempotent audited transactions", () => {
  it("canonically hashes the operation and body and replays the original result without rerunning work", () => {
    const { database, actor } = databaseWithActor();
    const work = vi.fn((tx: Parameters<typeof appendAuditEvent>[0]["tx"]) => {
      tx.insert(clinicCounters).values({ key: "work-count", value: 1 }).run();
      appendTestAudit(tx, actor, "entity-001");
      return { statusCode: 201, data: { id: "entity-001", revision: 1 } };
    });

    const first = executeIdempotent({
      db: database.db,
      actor,
      key: "request-0001",
      operation: "test.create.v1",
      requestBody: commandBody({ b: 2, a: 1 }),
      work,
    });
    const replay = executeIdempotent({
      db: database.db,
      actor,
      key: "request-0001",
      operation: "test.create.v1",
      requestBody: commandBody({ a: 1, b: 2 }),
      work,
    });

    expect(first).toEqual({
      statusCode: 201,
      body: { data: { id: "entity-001", revision: 1 }, replayed: false },
    });
    expect(replay).toEqual({
      statusCode: 201,
      body: { data: { id: "entity-001", revision: 1 }, replayed: true },
    });
    expect(work).toHaveBeenCalledTimes(1);
    expect(
      database.db.select().from(clinicCounters).all().filter((row) => row.key !== "synthetic_patient"),
    ).toHaveLength(1);
    expect(database.db.select().from(auditEvents).all()).toHaveLength(1);
    expect(database.db.select().from(idempotencyRecords).get()).toMatchObject({
      requestHash: "3e3bd32ed1c1c3f075d297d066e534e737d85a8dc6c63bcaa31e3c625711031a",
      responseStatus: 201,
    });
  });

  it("fails closed instead of redacting an unrelated legacy envelope for safe replay", () => {
    const { database, actor } = databaseWithActor();
    const body = commandBody({ value: 1 });
    const work = vi.fn(() => ({ statusCode: 200, data: { id: "safe-entity" } }));
    const safeReplay = {
      store: (data: { id: string }) => ({ id: data.id }),
      rebuild: (_tx: Parameters<typeof appendAuditEvent>[0]["tx"], reference: { id: string }) => ({ id: reference.id }),
      isLegacyResponse: (data: unknown): data is { id: string } => (
        typeof data === "object" && data !== null && "id" in data && typeof data.id === "string"
      ),
    };
    executeIdempotent({
      db: database.db,
      actor,
      key: "safe-replay-legacy-001",
      operation: "test.safe-replay.v1",
      requestBody: body,
      work,
      safeReplay,
    });
    database.db.update(idempotencyRecords)
      .set({ responseJson: JSON.stringify({ data: { unrelated: true }, replayed: false }) })
      .where(eq(idempotencyRecords.key, "safe-replay-legacy-001"))
      .run();

    expect(() => executeIdempotent({
      db: database.db,
      actor,
      key: "safe-replay-legacy-001",
      operation: "test.safe-replay.v1",
      requestBody: body,
      work,
      safeReplay,
    })).toThrow("Invalid legacy idempotency response for safe replay");
    expect(work).toHaveBeenCalledTimes(1);
    expect(database.db.select().from(idempotencyRecords).get()?.responseJson)
      .toContain("unrelated");
  });

  it.each([
    {
      label: "changed body",
      operation: "test.create.v1",
      body: commandBody({ a: 1, b: 3 }),
    },
    {
      label: "changed operation",
      operation: "test.update.v1",
      body: commandBody({ a: 1, b: 2 }),
    },
  ])("rejects the same key with a $label without another write", ({ operation, body }) => {
    const { database, actor } = databaseWithActor();
    const work = vi.fn((tx: Parameters<typeof appendAuditEvent>[0]["tx"]) => {
      tx.insert(clinicCounters).values({ key: "collision-count", value: 1 }).run();
      appendTestAudit(tx, actor, "collision-entity");
      return { statusCode: 201, data: { id: "collision-entity" } };
    });
    executeIdempotent({
      db: database.db,
      actor,
      key: "request-0002",
      operation: "test.create.v1",
      requestBody: commandBody({ b: 2, a: 1 }),
      work,
    });

    expect(() =>
      executeIdempotent({
        db: database.db,
        actor,
        key: "request-0002",
        operation,
        requestBody: body,
        work,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT", statusCode: 409 }),
    );
    expect(work).toHaveBeenCalledTimes(1);
    expect(
      database.db.select().from(clinicCounters).all().filter((row) => row.key !== "synthetic_patient"),
    ).toHaveLength(1);
    expect(database.db.select().from(auditEvents).all()).toHaveLength(1);
    expect(database.db.select().from(idempotencyRecords).all()).toHaveLength(1);
  });

  it.each([
    "1234567",
    "x".repeat(129),
    "contains space",
    "linefeed\nkey",
    "คำขอ-0001",
  ])("rejects a non-canonical Idempotency-Key before running work: %j", (key) => {
    const { database, actor } = databaseWithActor();
    const work = vi.fn(() => ({ statusCode: 201, data: { id: "must-not-exist" } }));

    expect(() =>
      executeIdempotent({
        db: database.db,
        actor,
        key,
        operation: "test.create.v1",
        requestBody: commandBody(),
        work,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "VALIDATION_FAILED", statusCode: 422 }),
    );
    expect(work).not.toHaveBeenCalled();
    expect(database.db.select().from(idempotencyRecords).all()).toHaveLength(0);
  });

  it("rolls back a stale revision without changing the original row or writing Audit", () => {
    const { database, actor } = databaseWithActor();
    database.db.insert(clinicCounters).values({ key: "revision-target", value: 2 }).run();

    expect(() =>
      executeIdempotent({
        db: database.db,
        actor,
        key: "request-0003",
        operation: "test.update.v1",
        requestBody: { expectedRevisions: { entity: 1 }, payload: { value: 3 } },
        work: (tx) => {
          const target = tx
            .select()
            .from(clinicCounters)
            .where(eq(clinicCounters.key, "revision-target"))
            .get();
          assertExpectedRevision(target?.value, 1);
          tx.update(clinicCounters).set({ value: 3 }).run();
          appendTestAudit(tx, actor, "revision-target");
          return { statusCode: 200, data: { value: 3 } };
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "REVISION_CONFLICT",
        statusCode: 409,
        currentRevisions: { entity: 2 },
      }),
    );
    expect(
      database.db
        .select()
        .from(clinicCounters)
        .where(eq(clinicCounters.key, "revision-target"))
        .get(),
    ).toMatchObject({ value: 2 });
    expect(database.db.select().from(auditEvents).all()).toHaveLength(0);
    expect(database.db.select().from(idempotencyRecords).all()).toHaveLength(0);
  });

  it.each([
    { actual: 1.5, expected: 1 },
    { actual: 1, expected: 1.5 },
  ])("rejects non-integer revisions ($actual, $expected)", ({ actual, expected }) => {
    expect(() => assertExpectedRevision(actual, expected)).toThrowError(
      expect.objectContaining({ code: "REVISION_CONFLICT", statusCode: 409 }),
    );
  });

  it("rolls back domain, Audit, and idempotency writes when work throws", () => {
    const { database, actor } = databaseWithActor();

    expect(() =>
      executeIdempotent({
        db: database.db,
        actor,
        key: "request-0004",
        operation: "test.failure.v1",
        requestBody: commandBody(),
        work: (tx) => {
          tx.insert(clinicCounters).values({ key: "rolled-back", value: 1 }).run();
          appendTestAudit(tx, actor, "rolled-back");
          throw new Error("injected work failure");
        },
      }),
    ).toThrow("injected work failure");
    expect(
      database.db.select().from(clinicCounters).all().filter((row) => row.key !== "synthetic_patient"),
    ).toHaveLength(0);
    expect(database.db.select().from(auditEvents).all()).toHaveLength(0);
    expect(database.db.select().from(idempotencyRecords).all()).toHaveLength(0);
  });

  it("rejects a system Audit actor inside a named HTTP command and rolls back", () => {
    const { database, actor } = databaseWithActor();

    expect(() =>
      executeIdempotent({
        db: database.db,
        actor,
        key: "request-0005",
        operation: "test.spoof.v1",
        requestBody: commandBody(),
        work: (tx) => {
          tx.insert(clinicCounters).values({ key: "spoofed", value: 1 }).run();
          appendAuditEvent({
            tx,
            actor: {
              id: null,
              role: "system",
              displayName: "maintenance-cli",
            } as unknown as Actor,
            id: "audit-spoofed",
            action: "patient.synthetic-created",
            entityType: "test-entity",
            entityId: "spoofed",
            entityRevision: 1,
            reason: null,
            occurredAt,
          });
          return { statusCode: 201, data: { id: "spoofed" } };
        },
      }),
    ).toThrow("Named actor required");
    expect(
      database.db.select().from(clinicCounters).all().filter((row) => row.key !== "synthetic_patient"),
    ).toHaveLength(0);
    expect(database.db.select().from(auditEvents).all()).toHaveLength(0);
    expect(database.db.select().from(idempotencyRecords).all()).toHaveLength(0);
  });
});

describe("signed evidence hashing", () => {
  it("hashes canonically stable JSON with SHA-256", () => {
    expect(hashEvidence({ b: 2, a: 1 })).toBe("43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777");
  });
});

describe("append-only Audit Events", () => {
  it.each([
    ["note.draft-saved", null, false],
    ["note.signed", null, false],
    ["medication.decision-signed", null, false],
    ["visit.consultation-finalized", null, false],
    ["note.amendment-signed", null, true],
    ["medication.decision-revised", null, true],
    ["visit.allergy-safety-changed", null, true],
  ] as const)("enforces the server-owned reason policy for %s", (action, reason, required) => {
    const { database, actor } = databaseWithActor();
    const append = () => runAuditedTransaction({
      db: database.db,
      actor,
      work: (tx) => appendAuditEvent({
        tx,
        actor,
        id: `audit-${action}`,
        action,
        entityType: "clinical-test",
        entityId: action,
        entityRevision: 1,
        reason,
        occurredAt,
      } as Parameters<typeof appendAuditEvent>[0]),
    });

    if (required) {
      expect(append).toThrow("Audit reason is required");
    } else {
      expect(append).not.toThrow();
    }
  });

  it("does not expose maintenance system capabilities from the HTTP-facing platform index", () => {
    expect(platform).not.toHaveProperty("runMaintenanceAuditedTransaction");
    expect(platform).not.toHaveProperty("appendMaintenanceAuditEvent");
    expect(platform).not.toHaveProperty("maintenanceAuditCapability");
    expectTypeOf<Parameters<typeof runAuditedTransaction>[0]["actor"]>().toEqualTypeOf<Actor>();
    expectTypeOf<Parameters<typeof appendAuditEvent>[0]["actor"]>().toEqualTypeOf<Actor>();
  });

  it("does not export raw actor-selectable transaction primitives", () => {
    expect(auditModule).not.toHaveProperty("runBoundAuditedTransaction");
    expect(auditModule).not.toHaveProperty("appendBoundAuditEvent");
  });

  it("writes system Audit only through the maintenance-only boundary", () => {
    const { database } = databaseWithActor();

    runMaintenanceAuditedTransaction({
      db: database.db,
      work: (tx) =>
        appendMaintenanceAuditEvent({
          tx,
          id: "audit-maintenance-account-created",
          action: "account.created",
          entityType: "staff-account",
          entityId: "doctor-002",
          entityRevision: 1,
          reason: null,
          occurredAt,
        }),
    });

    expect(database.db.select().from(auditEvents).get()).toMatchObject({
      actorId: null,
      actorRole: "system",
      action: "account.created",
      entityId: "doctor-002",
    });
  });

  it("rejects a system actor at the named audited transaction boundary", () => {
    const { database } = databaseWithActor();
    const systemActor = {
      id: null,
      role: "system",
      displayName: "maintenance-cli",
    } as const;

    expect(() =>
      runAuditedTransaction({
        db: database.db,
        actor: systemActor as unknown as Actor,
        work: (tx) =>
          appendAuditEvent({
            tx,
            actor: systemActor as unknown as Actor,
            id: "audit-system-from-public-helper",
            action: "account.created",
            entityType: "staff-account",
            entityId: "doctor-002",
            entityRevision: 1,
            reason: null,
            occurredAt,
          }),
      }),
    ).toThrow("Named actor required");
    expect(database.db.select().from(auditEvents).all()).toHaveLength(0);
  });

  it("rejects the public append helper inside a maintenance system transaction", () => {
    const { database } = databaseWithActor();
    const systemActor = {
      id: null,
      role: "system",
      displayName: "maintenance-cli",
    } as unknown as Actor;

    expect(() =>
      runMaintenanceAuditedTransaction({
        db: database.db,
        work: (tx) =>
          appendAuditEvent({
            tx,
            actor: systemActor,
            id: "audit-public-system-append",
            action: "account.created",
            entityType: "staff-account",
            entityId: "doctor-003",
            entityRevision: 1,
            reason: null,
            occurredAt,
          }),
      }),
    ).toThrow("Named actor required");
    expect(database.db.select().from(auditEvents).all()).toHaveLength(0);
  });

  it("rejects a missing reason when the action contract requires one", () => {
    const { database, actor } = databaseWithActor();

    expect(() =>
      runAuditedTransaction({
        db: database.db,
        actor,
        work: (tx) =>
          appendAuditEvent({
            tx,
            actor,
            id: "audit-missing-reason",
            action: "allergy.updated",
            entityType: "test-entity",
            entityId: "reason-required",
            entityRevision: 1,
            reasonRequired: false,
            reason: null,
            occurredAt,
          } as unknown as Parameters<typeof appendAuditEvent>[0]),
      }),
    ).toThrow("Audit reason is required");
    expect(database.db.select().from(auditEvents).all()).toHaveLength(0);
  });

  it("rejects an action that is absent from the server-owned Audit policy", () => {
    const { database, actor } = databaseWithActor();

    expect(() =>
      runAuditedTransaction({
        db: database.db,
        actor,
        work: (tx) =>
          appendAuditEvent({
            tx,
            actor,
            id: "audit-unknown-action",
            action: "allergy.updated.v2",
            entityType: "patient",
            entityId: "patient-001",
            entityRevision: 2,
            reasonRequired: false,
            reason: null,
            occurredAt,
          } as unknown as Parameters<typeof appendAuditEvent>[0]),
      }),
    ).toThrow("Unknown Audit action");
    expect(database.db.select().from(auditEvents).all()).toHaveLength(0);
  });

  it.each(["toString", "constructor", "__proto__"])(
    "rejects an inherited-object action name: %s",
    (inheritedAction) => {
      const { database, actor } = databaseWithActor();

      expect(() =>
        runAuditedTransaction({
          db: database.db,
          actor,
          work: (tx) =>
            appendAuditEvent({
              tx,
              actor,
              id: `audit-${inheritedAction}`,
              action: inheritedAction,
              entityType: "patient",
              entityId: "patient-001",
              entityRevision: 1,
              reason: null,
              occurredAt,
            } as unknown as Parameters<typeof appendAuditEvent>[0]),
        }),
      ).toThrow("Unknown Audit action");
      expect(database.db.select().from(auditEvents).all()).toHaveLength(0);
    },
  );

  it.each([
    "2026-08-03T08:02:03.000+07:00",
    "2026-08-03T01:02:03",
    "not-a-timestamp",
  ])("rejects a non-canonical UTC Audit timestamp: %s", (invalidOccurredAt) => {
    const { database, actor } = databaseWithActor();

    expect(() =>
      runAuditedTransaction({
        db: database.db,
        actor,
        work: (tx) =>
          appendAuditEvent({
            tx,
            actor,
            id: "audit-invalid-time",
            action: "patient.synthetic-created",
            entityType: "patient",
            entityId: "patient-001",
            entityRevision: 1,
            reason: null,
            occurredAt: invalidOccurredAt,
          }),
      }),
    ).toThrow("Audit timestamp must be canonical UTC");
    expect(database.db.select().from(auditEvents).all()).toHaveLength(0);
  });

  it.each(["UPDATE audit_events SET action = 'tampered'", "DELETE FROM audit_events"])(
    "blocks direct SQL: %s",
    (statement) => {
      const { database, actor } = databaseWithActor();
      runAuditedTransaction({
        db: database.db,
        actor,
        work: (tx) => appendTestAudit(tx, actor, "immutable-entity"),
      });
      const original = database.sqlite.prepare("SELECT * FROM audit_events").get();

      expect(() => database.sqlite.prepare(statement).run()).toThrow(/append-only/);
      expect(database.sqlite.prepare("SELECT * FROM audit_events").all()).toEqual([original]);
    },
  );
});
