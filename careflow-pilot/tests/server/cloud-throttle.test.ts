import { afterEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./helpers/database.js";
import { createPasswordLimiter } from "../../src/server/auth/throttle.js";

let database: TestDatabase | undefined;
afterEach(() => { database?.cleanup(); database = undefined; });
describe("durable password admission", () => {
  it("keeps the account budget across source IPs and service restarts, and expires it", () => {
    database = createTestDatabase();
    let now = 1_000_000;
    let limiter = createPasswordLimiter(database, () => now);
    for (let i = 0; i < 5; i++) limiter.admit("doctor", `198.51.100.${i}`)();
    limiter = createPasswordLimiter(database, () => now);
    expect(() => limiter.admit("doctor", "203.0.113.9")).toThrow(/มากเกินไป/);
    now += 60_001;
    expect(() => limiter.admit("doctor", "203.0.113.9")()).not.toThrow();
  });
  it("bounds concurrent expensive password work and bucket cardinality without eviction bypass", () => {
    database = createTestDatabase();
    const limiter = createPasswordLimiter(database, () => 1_000_000, { maxBuckets: 4, maxConcurrent: 2 });
    const release1 = limiter.admit("one", "198.51.100.1");
    const release2 = limiter.admit("two", "198.51.100.2");
    expect(() => limiter.admit("three", "198.51.100.3")).toThrow();
    release1(); release1(); release2();
    expect(() => limiter.admit("three", "198.51.100.3")).toThrow();
    expect(database.sqlite.prepare("SELECT count(*) n FROM auth_rate_limits").get()).toEqual({ n: 4 });
    expect(JSON.stringify(database.sqlite.prepare("SELECT * FROM auth_rate_limits").all())).not.toContain("198.51.100");
  });
  it("fails closed if durable admission cannot be recorded", () => {
    database = createTestDatabase();
    database.sqlite.exec("CREATE TRIGGER test_limiter_failure BEFORE INSERT ON auth_rate_limits BEGIN SELECT RAISE(ABORT, 'disk failure'); END");
    const limiter = createPasswordLimiter(database, () => 1_000_000);
    expect(() => limiter.admit("doctor", "198.51.100.1")).toThrow();
  });
});
