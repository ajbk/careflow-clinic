import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "./helpers/database.js";
import { createBackupCoordinator } from "../../src/server/maintenance/backup-coordinator.js";

let database: TestDatabase | undefined;
afterEach(() => { database?.cleanup(); database = undefined; });
describe("backup coordinator", () => {
  it("coalesces overlapping requests and emits a safe failure alert without raw error content", async () => {
    database = createTestDatabase();
    let reject!: (error: Error) => void;
    const run = vi.fn(() => new Promise<never>((_resolve, fail) => { reject = fail; }));
    const alerts: unknown[] = [];
    const coordinator = createBackupCoordinator({ database, run, intervalSeconds: 600, alert: async (event) => { alerts.push(event); } });
    const first = coordinator.runNow(); const second = coordinator.runNow();
    expect(run).toHaveBeenCalledTimes(1);
    reject(new Error("secret private key / patient / path details"));
    await Promise.all([first, second]); await coordinator.stop();
    expect(alerts).toHaveLength(1);
    expect(JSON.stringify(alerts)).not.toContain("secret");
    expect(alerts[0]).toMatchObject({ code: "BACKUP_FAILED" });
  });
});
