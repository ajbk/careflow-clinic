import { afterEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./helpers/database.js";
import { operationalHealth } from "../../src/server/maintenance/health.js";
import { setOperationalMetadata } from "../../src/server/maintenance/metadata.js";

let database: TestDatabase | undefined;
afterEach(() => { database?.cleanup(); database = undefined; });
describe("operational readiness", () => {
  it("keeps cloud readiness closed without external verified backup and a separate decrypt/restore drill", () => {
    database = createTestDatabase();
    const health = operationalHealth(database, { cloud: true, backupMaxAgeSeconds: 600 }, new Date());
    expect(health.ready).toBe(false);
    expect(health.reasons).toContain("BACKUP_UNVERIFIED");
    expect(health.reasons).toContain("RESTORE_DRILL_MISSING");
    expect(JSON.stringify(health)).not.toContain(database.databasePath);
  });
  it("distinguishes recovery mode from liveness and never treats a local drill store as off-host protection", () => {
    database = createTestDatabase();
    setOperationalMetadata(database.sqlite, "recovery_mode", "reconciling");
    setOperationalMetadata(database.sqlite, "last_backup_receipt", JSON.stringify({ objectId: "11111111-1111-4111-8111-111111111111.cfbak", databaseId: "11111111-1111-4111-8111-111111111111", environmentId: "synthetic-test", sha256: "a".repeat(64), bytes: 100, keyId: "b".repeat(64), verifiedAt: "2026-10-09T00:00:00.000Z", snapshotStartedAt: "2026-10-09T00:00:00.000Z", snapshotCompletedAt: "2026-10-09T00:00:00.000Z", generation: "synthetic-generation", storageKind: "synthetic-directory" }));
    const health = operationalHealth(database, { cloud: true, backupMaxAgeSeconds: 600 }, new Date());
    expect(health.reasons).toContain("RECOVERY_REQUIRED");
    expect(health.reasons).toContain("BACKUP_FAILURE_DOMAIN_UNVERIFIED");
    expect(health.ready).toBe(false);
  });
  it("does not renew backup freshness when an old snapshot finishes uploading later", () => {
    database = createTestDatabase();
    const now = new Date("2026-10-09T10:00:00.000Z");
    setOperationalMetadata(database.sqlite, "last_backup_receipt", JSON.stringify({ objectId: "11111111-1111-4111-8111-111111111111.cfbak", databaseId: "11111111-1111-4111-8111-111111111111", environmentId: "synthetic-test", sha256: "a".repeat(64), bytes: 100, keyId: "b".repeat(64), verifiedAt: now.toISOString(), snapshotStartedAt: "2026-10-09T08:00:00.000Z", snapshotCompletedAt: "2026-10-09T08:00:10.000Z", generation: "synthetic-generation", storageKind: "external" }));
    expect(operationalHealth(database, { cloud: true, backupMaxAgeSeconds: 600 }, now)).toMatchObject({ writeAllowed: false, backupAgeSeconds: 7200, reasons: expect.arrayContaining(["BACKUP_STALE"]) });
  });
  it("closes writes for low disk and an explicitly selected but unverified backup policy", () => {
    database = createTestDatabase();
    expect(operationalHealth(database, { cloud: true, minFreeBytes: Number.MAX_SAFE_INTEGER }, new Date())).toMatchObject({ writeAllowed: false, reasons: expect.arrayContaining(["DISK_LOW"]) });
    expect(operationalHealth(database, { cloud: true, backupMaxAgeSeconds: 600 }, new Date())).toMatchObject({ writeAllowed: false });
    expect(operationalHealth(database, { cloud: true }, new Date())).toMatchObject({ ready: false, writeAllowed: true });
  });
});
