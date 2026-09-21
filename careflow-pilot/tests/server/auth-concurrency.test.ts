import argon2 from "argon2";
import { afterEach, describe, expect, it } from "vitest";
import { auditEvents, sessions } from "../../src/server/modules/platform/index.js";
import { cookieFrom, login, seedAccount, TEST_NEW_PASSWORD } from "./helpers/auth.js";
import { createTestApp } from "./helpers/database.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("concurrent login protection", () => {
  it("rejects an old-password login that finishes after another session changes the password", async () => {
    const entered = deferred();
    const resume = deferred();
    let holdNextVerification = false;
    const fixture = await createTestApp({
      passwordVerifier: async (hash, password) => {
        const hold = holdNextVerification;
        holdNextVerification = false;
        const verified = await argon2.verify(hash, password);
        if (hold) {
          entered.resolve();
          await resume.promise;
        }
        return verified;
      },
    });
    cleanups.push(fixture.cleanup);
    const account = await seedAccount(fixture.database, { mustChangePassword: false });
    const originalCookie = cookieFrom(await login(fixture.app, account.username, account.password));

    holdNextVerification = true;
    const delayedLogin = login(fixture.app, account.username, account.password);
    cleanups.push(async () => {
      resume.resolve();
      await delayedLogin;
    });
    await entered.promise;
    const changed = await fixture.app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { cookie: originalCookie },
      payload: { currentPassword: account.password, newPassword: TEST_NEW_PASSWORD },
    });
    expect(changed.statusCode).toBe(204);
    const replacementCookie = cookieFrom(changed);
    expect(fixture.database.db.select().from(sessions).all()).toHaveLength(1);

    resume.resolve();
    const response = await delayedLogin;
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("AUTH_REQUIRED");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(fixture.database.db.select().from(sessions).all()).toHaveLength(1);
    expect(fixture.database.db.select().from(auditEvents).all()).toEqual([
      expect.objectContaining({ action: "account.password-changed", entityRevision: 2 }),
    ]);
    expect((await fixture.app.inject({
      method: "GET", url: "/api/auth/session", headers: { cookie: originalCookie },
    })).statusCode).toBe(401);
    expect((await fixture.app.inject({
      method: "GET", url: "/api/auth/session", headers: { cookie: replacementCookie },
    })).statusCode).toBe(200);
    expect((await login(fixture.app, account.username, TEST_NEW_PASSWORD)).statusCode).toBe(200);
  });

  it("admits only five of twelve concurrent failed logins for the same IP and normalized username", async () => {
    const admittedOrRejected = deferred();
    const resume = deferred();
    let arrivals = 0;
    let verifications = 0;
    const recordArrival = (): void => {
      arrivals += 1;
      if (arrivals === 12) admittedOrRejected.resolve();
    };
    const fixture = await createTestApp({
      passwordVerifier: async (hash, password) => {
        verifications += 1;
        recordArrival();
        await resume.promise;
        return argon2.verify(hash, password);
      },
    });
    cleanups.push(fixture.cleanup);
    const requests = Array.from({ length: 12 }, (_, index) =>
      login(fixture.app, index % 2 ? " Missing " : "missing", "wrong-password-value", {
        remoteAddress: "127.0.0.9",
      }).then((response) => {
        if (response.statusCode === 429) recordArrival();
        return response;
      }),
    );
    cleanups.push(async () => {
      resume.resolve();
      await Promise.all(requests);
    });
    await admittedOrRejected.promise;
    resume.resolve();
    const responses = await Promise.all(requests);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      401, 401, 401, 401, 401, 429, 429, 429, 429, 429, 429, 429,
    ]);
    expect(verifications).toBe(5);
    expect(responses.every((response) => response.headers["set-cookie"] === undefined)).toBe(true);
    expect(fixture.database.db.select().from(sessions).all()).toHaveLength(0);
    const next = await login(fixture.app, "missing", "wrong-password-value", {
      remoteAddress: "127.0.0.9",
    });
    expect(next.statusCode).toBe(429);
    expect(next.json().error.code).toBe("RATE_LIMITED");
  });

  it.each([
    { field: "active", replacement: 0, remainingSessions: 0 },
    { field: "revision", replacement: 2, remainingSessions: 1 },
    { field: "password_hash", replacement: null, remainingSessions: 1 },
  ])("rejects a login if $field changes during password verification", async ({ field, replacement, remainingSessions }) => {
    const entered = deferred();
    const resume = deferred();
    let holdNextVerification = false;
    const fixture = await createTestApp({
      passwordVerifier: async (hash, password) => {
        const hold = holdNextVerification;
        holdNextVerification = false;
        const verified = await argon2.verify(hash, password);
        if (hold) {
          entered.resolve();
          await resume.promise;
        }
        return verified;
      },
    });
    cleanups.push(fixture.cleanup);
    const account = await seedAccount(fixture.database, { mustChangePassword: false });
    expect((await login(fixture.app, account.username, account.password)).statusCode).toBe(200);
    const value = replacement ?? await argon2.hash(TEST_NEW_PASSWORD);
    holdNextVerification = true;
    const delayedLogin = login(fixture.app, account.username, account.password);
    cleanups.push(async () => {
      resume.resolve();
      await delayedLogin;
    });
    await entered.promise;
    fixture.database.sqlite.prepare(`UPDATE staff_accounts SET ${field} = ? WHERE id = ?`).run(value, account.actor.id);

    resume.resolve();
    const response = await delayedLogin;
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toMatchObject({ code: "AUTH_REQUIRED" });
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(fixture.database.db.select().from(sessions).all()).toHaveLength(remainingSessions);
  });

  it("keeps pending attempts counted when a successful login completes", async () => {
    const firstFourEntered = deferred();
    const fifthEntered = deferred();
    const resume = deferred();
    const wrongPassword = "wrong-password-value";
    let pendingVerifications = 0;
    const fixture = await createTestApp({
      passwordVerifier: async (hash, password) => {
        if (password === wrongPassword) {
          pendingVerifications += 1;
          if (pendingVerifications === 4) firstFourEntered.resolve();
          if (pendingVerifications === 5) fifthEntered.resolve();
          await resume.promise;
        }
        return argon2.verify(hash, password);
      },
    });
    cleanups.push(fixture.cleanup);
    const account = await seedAccount(fixture.database, { mustChangePassword: false });
    const requests = Array.from({ length: 4 }, () => login(fixture.app, account.username, wrongPassword));
    cleanups.push(async () => {
      resume.resolve();
      await Promise.all(requests);
    });
    await firstFourEntered.promise;

    expect((await login(fixture.app, account.username, account.password)).statusCode).toBe(200);
    requests.push(login(fixture.app, account.username, wrongPassword));
    await fifthEntered.promise;
    expect((await login(fixture.app, account.username, account.password)).statusCode).toBe(429);

    resume.resolve();
    expect((await Promise.all(requests)).map((response) => response.statusCode)).toEqual([401, 401, 401, 401, 401]);
    expect((await login(fixture.app, account.username, account.password)).statusCode).toBe(429);
  });

  it("resets completed failures on success and allows recovery at the exact one-minute boundary", async () => {
    let now = new Date("2026-08-03T00:00:00.000Z");
    const fixture = await createTestApp({ clock: () => now });
    cleanups.push(fixture.cleanup);
    const account = await seedAccount(fixture.database, { mustChangePassword: false });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await login(fixture.app, account.username, "wrong-password-value")).statusCode).toBe(401);
    }
    expect((await login(fixture.app, account.username, account.password)).statusCode).toBe(200);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await login(fixture.app, account.username, "wrong-password-value")).statusCode).toBe(401);
    }
    now = new Date("2026-08-03T00:00:59.999Z");
    expect((await login(fixture.app, account.username, account.password)).statusCode).toBe(429);
    now = new Date("2026-08-03T00:01:00.000Z");
    expect((await login(fixture.app, account.username, account.password)).statusCode).toBe(200);
  });

  it("releases reserved attempts when password verification errors", async () => {
    let failVerification = true;
    const fixture = await createTestApp({
      passwordVerifier: async (hash, password) => {
        if (failVerification) throw new Error("Synthetic verifier failure");
        return argon2.verify(hash, password);
      },
    });
    cleanups.push(fixture.cleanup);
    const account = await seedAccount(fixture.database, { mustChangePassword: false });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await login(fixture.app, account.username, account.password)).statusCode).toBe(500);
    }
    failVerification = false;
    expect((await login(fixture.app, account.username, account.password)).statusCode).toBe(200);
  });
});
