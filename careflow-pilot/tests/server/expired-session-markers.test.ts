import { describe, expect, it } from "vitest";
import {
  MAX_EXPIRED_SESSION_MARKERS,
  createSessionService,
  sweepExpiredSessionMarkers,
} from "../../src/server/modules/platform/sessions.js";
import { seedAccount } from "./helpers/auth.js";
import { createTestDatabase } from "./helpers/database.js";

function hashOf(index: number): string {
  return index.toString(16).padStart(64, "0");
}

function tokenFor(index: number): string {
  return `${index.toString(36).padStart(42, "a")}z`;
}

describe("expired session marker cache", () => {
  it("physically sweeps stale hashes during an unrelated cache sweep", () => {
    const now = 1_000_000;
    const markers = new Map<string, number>([
      [hashOf(1), now - 1],
      [hashOf(2), now + 1],
      [hashOf(3), now - 500],
    ]);

    sweepExpiredSessionMarkers(markers, now);

    expect([...markers.entries()]).toEqual([[hashOf(2), now + 1]]);
  });

  it("evicts the oldest hashes to enforce the hard marker bound", () => {
    const now = 1_000_000;
    const markers = new Map<string, number>();
    for (let index = 0; index <= MAX_EXPIRED_SESSION_MARKERS; index += 1) {
      markers.set(hashOf(index), now + 1);
    }

    sweepExpiredSessionMarkers(markers, now);

    expect(markers.size).toBe(MAX_EXPIRED_SESSION_MARKERS);
    expect(markers.has(hashOf(0))).toBe(false);
    expect([...markers.keys()][0]).toBe(hashOf(1));
  });

  it("evicts only the oldest marker while preserving recent expiry truth", async () => {
    const database = createTestDatabase();
    try {
      const account = await seedAccount(database, { mustChangePassword: false });
      const tokens = Array.from({ length: MAX_EXPIRED_SESSION_MARKERS + 1 }, (_, index) => tokenFor(index));
      let nextToken = 0;
      let now = new Date("2026-08-03T00:00:00.000Z");
      const service = createSessionService({
        database,
        idleMinutes: 15,
        absoluteHours: 8,
        tokenFactory: () => tokens[nextToken++] ?? tokenFor(0),
      });
      const issued = database.db.transaction((tx) =>
        tokens.map(() => service.issueInTransaction(tx, account.actor.id, now)),
      );

      now = new Date("2026-08-03T00:15:00.000Z");
      database.sqlite.transaction(() => {
        for (const session of issued) {
          expect(service.isExpired(session.token, now)).toBe(true);
          expect(service.authenticate(session.token, now)).toBeUndefined();
        }
      })();

      const reissuedOldest = service.issue(account.actor.id, now);
      expect(reissuedOldest.token).toBe(tokenFor(0));
      expect(service.isExpired(reissuedOldest.token, now)).toBe(false);
      expect(service.authenticate(reissuedOldest.token, now)?.actor.id).toBe(account.actor.id);
      expect(service.isExpired(tokenFor(MAX_EXPIRED_SESSION_MARKERS), now)).toBe(true);
    } finally {
      database.cleanup();
    }
  });
});
