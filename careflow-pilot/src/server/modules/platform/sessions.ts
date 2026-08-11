import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Actor, SessionDto } from "../../../shared/contracts.js";
import type { DatabaseHandle } from "../../db/client.js";
import { permissionsByRole } from "./permissions.js";
import { clinicConfig, sessions } from "./schema.js";

export const SESSION_COOKIE_NAME = "careflow_session";
export const SESSION_MAX_AGE_SECONDS = 28_800;

export interface AuthenticatedSession {
  actor: Actor;
  account: {
    username: string;
    pilotAcknowledgedAt: string | null;
    mustChangePassword: boolean;
  };
  tokenHash: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export interface SessionService {
  issue(staffId: string, now: Date): { token: string; tokenHash: string };
  issueInTransaction(
    tx: Parameters<Parameters<DatabaseHandle["db"]["transaction"]>[0]>[0],
    staffId: string,
    now: Date,
  ): { token: string; tokenHash: string };
  isExpired(token: string | undefined, now: Date): boolean;
  authenticate(token: string | undefined, now: Date): AuthenticatedSession | undefined;
  revoke(token: string | undefined): void;
  revokeAll(staffId: string): void;
  touch(session: AuthenticatedSession, now: Date, force?: boolean): void;
  dto(session: AuthenticatedSession): SessionDto;
  hashToken(token: string): string;
}

export function createSessionService(input: {
  database: DatabaseHandle;
  idleMinutes: number;
  absoluteHours: number;
  tokenFactory?: () => string;
}): SessionService {
  const tokenFactory = input.tokenFactory ?? (() => randomBytes(32).toString("base64url"));
  const idleMilliseconds = input.idleMinutes * 60_000;
  const absoluteMilliseconds = input.absoluteHours * 3_600_000;
  const clinic = input.database.db.select().from(clinicConfig).get();
  if (!clinic) throw new Error("Clinic configuration unavailable");

  const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
  const values = (staffId: string, now: Date) => {
    const token = tokenFactory();
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid session token factory output");
    const timestamp = now.toISOString();
    return {
      token,
      row: {
        tokenHash: hashToken(token),
        staffId,
        createdAt: timestamp,
        lastSeenAt: timestamp,
        expiresAt: new Date(now.getTime() + absoluteMilliseconds).toISOString(),
      },
    };
  };

  const service: SessionService = {
    issue(staffId, now) {
      const generated = values(staffId, now);
      input.database.db.insert(sessions).values(generated.row).run();
      return { token: generated.token, tokenHash: generated.row.tokenHash };
    },
    issueInTransaction(tx, staffId, now) {
      const generated = values(staffId, now);
      tx.insert(sessions).values(generated.row).run();
      return { token: generated.token, tokenHash: generated.row.tokenHash };
    },
    isExpired(token, now) {
      if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
      const tokenHash = hashToken(token);
      const row = input.database.sqlite
        .prepare(
          `SELECT s.created_at, s.last_seen_at, s.expires_at, a.active
             FROM sessions s JOIN staff_accounts a ON a.id = s.staff_id
            WHERE s.token_hash = ?`,
        )
        .get(tokenHash) as
        | { created_at: string; last_seen_at: string; expires_at: string; active: number }
        | undefined;
      if (!row || row.active !== 1) return false;
      const idleBoundary = Date.parse(row.last_seen_at) + idleMilliseconds;
      const absoluteBoundary = Math.min(
        Date.parse(row.expires_at),
        Date.parse(row.created_at) + absoluteMilliseconds,
      );
      return now.getTime() >= idleBoundary || now.getTime() >= absoluteBoundary;
    },
    authenticate(token, now) {
      if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
      const tokenHash = hashToken(token);
      const row = input.database.sqlite
        .prepare(
          `SELECT s.token_hash, s.created_at, s.last_seen_at, s.expires_at,
                  a.id, a.username, a.display_name, a.role, a.active,
                  a.must_change_password, a.pilot_acknowledged_at
             FROM sessions s JOIN staff_accounts a ON a.id = s.staff_id
            WHERE s.token_hash = ?`,
        )
        .get(tokenHash) as
        | {
            token_hash: string;
            created_at: string;
            last_seen_at: string;
            expires_at: string;
            id: string;
            username: string;
            display_name: string;
            role: Actor["role"];
            active: number;
            must_change_password: number;
            pilot_acknowledged_at: string | null;
          }
        | undefined;
      if (!row) return undefined;
      if (row.active !== 1) {
        input.database.db.delete(sessions).where(eq(sessions.staffId, row.id)).run();
        return undefined;
      }
      const idleBoundary = Date.parse(row.last_seen_at) + idleMilliseconds;
      const absoluteBoundary = Math.min(
        Date.parse(row.expires_at),
        Date.parse(row.created_at) + absoluteMilliseconds,
      );
      if (now.getTime() >= idleBoundary || now.getTime() >= absoluteBoundary) {
        input.database.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).run();
        return undefined;
      }
      return {
        actor: { id: row.id, role: row.role, displayName: row.display_name },
        account: {
          username: row.username,
          pilotAcknowledgedAt: row.pilot_acknowledged_at,
          mustChangePassword: row.must_change_password === 1,
        },
        tokenHash: row.token_hash,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        expiresAt: row.expires_at,
      };
    },
    revoke(token) {
      if (!token) return;
      input.database.db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))).run();
    },
    revokeAll(staffId) {
      input.database.db.delete(sessions).where(eq(sessions.staffId, staffId)).run();
    },
    touch(session, now, force = false) {
      if (!force && now.getTime() - Date.parse(session.lastSeenAt) < 60_000) return;
      input.database.db
        .update(sessions)
        .set({ lastSeenAt: now.toISOString() })
        .where(eq(sessions.tokenHash, session.tokenHash))
        .run();
      session.lastSeenAt = now.toISOString();
    },
    dto(session) {
      const idleExpiresAt = new Date(
        Math.min(Date.parse(session.lastSeenAt) + idleMilliseconds, Date.parse(session.expiresAt)),
      ).toISOString();
      return {
        user: {
          id: session.actor.id,
          username: session.account.username,
          displayName: session.actor.displayName,
          role: session.actor.role,
        },
        clinic: { id: clinic.id, name: clinic.name },
        permissions: [...permissionsByRole[session.actor.role]],
        pilotAcknowledgedAt: session.account.pilotAcknowledgedAt,
        mustChangePassword: session.account.mustChangePassword,
        idleExpiresAt,
      };
    },
    hashToken,
  };
  return service;
}
