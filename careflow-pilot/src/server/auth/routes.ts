import argon2 from "argon2";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  changePasswordBodySchema,
  loginBodySchema,
  pilotAcknowledgementBodySchema,
} from "../../shared/contracts.js";
import type { AppConfig } from "../config.js";
import type { DatabaseHandle } from "../db/client.js";
import { ApiError } from "../errors.js";
import { requireAuthenticatedSession } from "./hooks.js";
import {
  appendAuditEvent,
  runAuditedTransaction,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  sessions,
  staffAccounts,
  type SessionService,
} from "../modules/platform/index.js";

export const PASSWORD_HASH_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
});

const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,p=1,t=3$L74u8y3f5lD6VCFAbW8hig$9KuhEqlatshWav5NuQ7X5ly5NF3pfy9D82hWJGp+bxA";

export type PasswordVerifier = (hash: string, password: string) => Promise<boolean>;
export type PasswordHasher = (password: string) => Promise<string>;

function normalizeUsername(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function authRequired(): ApiError {
  return new ApiError({ code: "AUTH_REQUIRED", messageTh: "กรุณาเข้าสู่ระบบ" });
}

function setSessionCookie(reply: FastifyReply, token: string, config: AppConfig): void {
  reply.setCookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: config.cookieSecure,
  });
}

function clearSessionCookie(reply: FastifyReply, config: AppConfig): void {
  reply.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    secure: config.cookieSecure,
  });
}

function assertNewPassword(input: {
  username: string;
  currentPassword?: string;
  newPassword: string;
}): void {
  const length = Array.from(input.newPassword).length;
  if (
    length < 12 ||
    length > 128 ||
    normalizeUsername(input.newPassword) === normalizeUsername(input.username) ||
    input.newPassword === input.currentPassword
  ) {
    throw new ApiError({
      code: "VALIDATION_FAILED",
      messageTh: "รหัสผ่านใหม่ต้องมี 12–128 ตัวอักษรและไม่ซ้ำชื่อผู้ใช้หรือรหัสผ่านเดิม",
      fieldErrors: { newPassword: "รหัสผ่านใหม่ไม่เป็นไปตามข้อกำหนด" },
    });
  }
}

interface LoginAttemptBucket {
  failures: number[];
}

export function registerAuthRoutes(input: {
  app: FastifyInstance;
  database: DatabaseHandle;
  config: AppConfig;
  clock: () => Date;
  idFactory: () => string;
  sessionService: SessionService;
  passwordVerifier?: PasswordVerifier;
  passwordHasher?: PasswordHasher;
}): void {
  const verify = input.passwordVerifier ?? ((hash, password) => argon2.verify(hash, password));
  const hash = input.passwordHasher ?? ((password) => argon2.hash(password, PASSWORD_HASH_OPTIONS));
  const attempts = new Map<string, LoginAttemptBucket>();

  input.app.post("/api/auth/login", async (request, reply) => {
    const body = loginBodySchema.parse(request.body);
    const username = normalizeUsername(body.username);
    const now = input.clock();
    const attemptKey = `${request.ip}\u0000${username}`;
    const cutoff = now.getTime() - 60_000;
    const bucket = attempts.get(attemptKey) ?? { failures: [] };
    bucket.failures = bucket.failures.filter((timestamp) => timestamp > cutoff);
    attempts.set(attemptKey, bucket);
    if (bucket.failures.length >= 5) {
      throw new ApiError({
        code: "RATE_LIMITED",
        messageTh: "มีการลองเข้าสู่ระบบมากเกินไป กรุณารอสักครู่",
        retryAfterSeconds: 60,
      });
    }

    const account = input.database.db
      .select()
      .from(staffAccounts)
      .where(eq(staffAccounts.username, username))
      .get();
    const verified = await verify(account?.passwordHash ?? DUMMY_PASSWORD_HASH, body.password);
    if (!account || !verified || account.active !== 1) {
      bucket.failures.push(now.getTime());
      if (account?.active !== 1 && account) input.sessionService.revokeAll(account.id);
      throw authRequired();
    }
    attempts.delete(attemptKey);
    const issued = input.sessionService.issue(account.id, now);
    const session = input.sessionService.authenticate(issued.token, now);
    if (!session) throw new Error("Issued session unavailable");
    setSessionCookie(reply, issued.token, input.config);
    return { data: input.sessionService.dto(session) };
  });

  input.app.get("/api/auth/session", async (request) => ({
    data: input.sessionService.dto(requireAuthenticatedSession(request)),
  }));

  input.app.post("/api/auth/acknowledge-pilot", async (request, reply) => {
    pilotAcknowledgementBodySchema.parse(request.body);
    const session = requireAuthenticatedSession(request);
    const account = input.database.db
      .select()
      .from(staffAccounts)
      .where(eq(staffAccounts.id, session.actor.id))
      .get();
    if (!account || account.active !== 1) throw authRequired();
    const now = input.clock();
    if (account.pilotAcknowledgedAt === null) {
      const revision = account.revision + 1;
      runAuditedTransaction({
        db: input.database.db,
        actor: session.actor,
        work: (tx) => {
          tx.update(staffAccounts)
            .set({ pilotAcknowledgedAt: now.toISOString(), revision, updatedAt: now.toISOString() })
            .where(eq(staffAccounts.id, account.id))
            .run();
          appendAuditEvent({
            tx,
            actor: session.actor,
            id: input.idFactory(),
            action: "account.pilot-acknowledged",
            entityType: "staff-account",
            entityId: account.id,
            entityRevision: revision,
            reason: null,
            occurredAt: now.toISOString(),
          });
        },
      });
      session.account.pilotAcknowledgedAt = now.toISOString();
    }
    input.sessionService.touch(session, now, true);
    return reply.code(204).send();
  });

  input.app.post("/api/auth/change-password", async (request, reply) => {
    const body = changePasswordBodySchema.parse(request.body);
    const session = requireAuthenticatedSession(request);
    const account = input.database.db
      .select()
      .from(staffAccounts)
      .where(eq(staffAccounts.id, session.actor.id))
      .get();
    if (!account || account.active !== 1) throw authRequired();
    const verified = await verify(account.passwordHash, body.currentPassword);
    if (!verified) throw authRequired();
    assertNewPassword({
      username: account.username,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    });
    const passwordHash = await hash(body.newPassword);
    const now = input.clock();
    const revision = account.revision + 1;
    let replacementToken = "";
    runAuditedTransaction({
      db: input.database.db,
      actor: session.actor,
      work: (tx) => {
        const changed = tx
          .update(staffAccounts)
          .set({
            passwordHash,
            mustChangePassword: 0,
            revision,
            lastPasswordChangedAt: now.toISOString(),
            updatedAt: now.toISOString(),
          })
          .where(
            and(
              eq(staffAccounts.id, account.id),
              eq(staffAccounts.active, 1),
              eq(staffAccounts.revision, account.revision),
              eq(staffAccounts.passwordHash, account.passwordHash),
            ),
          )
          .run();
        if (changed.changes !== 1) {
          const current = tx
            .select({ revision: staffAccounts.revision })
            .from(staffAccounts)
            .where(eq(staffAccounts.id, account.id))
            .get();
          throw new ApiError({
            code: "REVISION_CONFLICT",
            messageTh: "ข้อมูลบัญชีถูกเปลี่ยนแปลงแล้ว กรุณาลองใหม่",
            currentRevisions: { account: current?.revision ?? account.revision },
          });
        }
        tx.delete(sessions).where(eq(sessions.staffId, account.id)).run();
        appendAuditEvent({
          tx,
          actor: session.actor,
          id: input.idFactory(),
          action: "account.password-changed",
          entityType: "staff-account",
          entityId: account.id,
          entityRevision: revision,
          reason: null,
          occurredAt: now.toISOString(),
        });
        replacementToken = input.sessionService.issueInTransaction(tx, account.id, now).token;
      },
    });
    setSessionCookie(reply, replacementToken, input.config);
    return reply.code(204).send();
  });

  input.app.post("/api/auth/activity", async (request, reply) => {
    const session = requireAuthenticatedSession(request);
    input.sessionService.touch(session, input.clock());
    return reply.code(204).send();
  });

  input.app.post("/api/auth/logout", async (request, reply) => {
    requireAuthenticatedSession(request);
    input.sessionService.revoke(request.cookies[SESSION_COOKIE_NAME]);
    clearSessionCookie(reply, input.config);
    return reply.code(204).send();
  });
}
