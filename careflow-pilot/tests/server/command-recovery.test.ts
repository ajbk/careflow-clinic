import { afterEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./helpers/database.js";
import { seedAccount } from "./helpers/auth.js";
import { executeIdempotent } from "../../src/server/modules/platform/idempotency.js";
import { cancelCommand, commandStatus, currentGeneration } from "../../src/server/modules/platform/operations.js";

let database: TestDatabase | undefined;
afterEach(() => { database?.cleanup(); database = undefined; });
describe("command outcome recovery", () => {
  it("reports absence as UNKNOWN and durably fences a late command after cancellation", async () => {
    database = createTestDatabase();
    const { actor } = await seedAccount(database);
    const key = "cancel-late-command";
    const generation = currentGeneration(database);
    expect(commandStatus(database, actor, key, generation).status).toBe("UNKNOWN");
    expect(cancelCommand(database, actor, key, "inventory.receive", generation).status).toBe("CANCELLED");
    let physicalEffect = 0;
    expect(() => executeIdempotent({ db: database!.db, actor, key, operation: "inventory.receive", requestBody: { expectedRevisions: {}, payload: {} },
      work: () => { physicalEffect++; return { statusCode: 201, data: {} }; } })).toThrow(/ยกเลิก/);
    expect(physicalEffect).toBe(0);
    expect(commandStatus(database, actor, key, generation).status).toBe("CANCELLED");
  });
  it("returns COMMITTED if the write won, without exposing its stored clinical result", async () => {
    database = createTestDatabase();
    const { actor } = await seedAccount(database);
    const key = "commit-before-cancel";
    const generation = currentGeneration(database);
    const input = { db: database.db, actor, key, operation: "inventory.receive", requestBody: { expectedRevisions: {}, payload: {} },
      work: () => ({ statusCode: 201, data: { privateClinical: "must not escape" } }) };
    executeIdempotent(input);
    const status = cancelCommand(database, actor, key, "inventory.receive", generation);
    expect(status.status).toBe("COMMITTED");
    expect(JSON.stringify(status)).not.toContain("privateClinical");
    expect(executeIdempotent(input).body.replayed).toBe(true);
  });
  it("isolates actors and rechecks current permission and recovery generation", async () => {
    database = createTestDatabase();
    const { actor } = await seedAccount(database);
    const { actor: assistant } = await seedAccount(database, { username: "assistant", role: "assistant" });
    const generation = currentGeneration(database);
    cancelCommand(database, actor, "actor-private-key", "finance.confirm-promptpay.v1", generation);
    expect(commandStatus(database, assistant, "actor-private-key", generation).status).toBe("UNKNOWN");
    expect(() => cancelCommand(database!, assistant, "actor-private-key", "finance.confirm-promptpay.v1", generation)).toThrow();
    database.sqlite.prepare("UPDATE platform_metadata SET value = 'new-generation' WHERE key = 'recovery_generation'").run();
    expect(() => cancelCommand(database!, actor, "different-key", "inventory.receive", generation)).toThrow(/กู้คืน/);
  });
  it("rolls back command evidence together with a failed business transaction", async () => {
    database = createTestDatabase();
    const { actor } = await seedAccount(database);
    const generation = currentGeneration(database);
    expect(() => executeIdempotent({ db: database!.db, actor, key: "rolled-back-key", operation: "inventory.receive", requestBody: { expectedRevisions: {}, payload: {} },
      work: () => ({ statusCode: 201, data: {} }), afterStore: () => { throw new Error("interrupted"); } })).toThrow("interrupted");
    expect(commandStatus(database, actor, "rolled-back-key", generation).status).toBe("UNKNOWN");
  });
});
