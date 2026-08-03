import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Actor, Permission } from "../../shared/contracts.js";
import { ApiError } from "../errors.js";
import {
  SESSION_COOKIE_NAME,
  requirePermission,
  type AuthenticatedSession,
  type SessionService,
} from "../modules/platform/index.js";

declare module "fastify" {
  interface FastifyRequest {
    authenticatedSession?: AuthenticatedSession;
    actor?: Actor;
  }
}

const gateBypassPaths = new Set([
  "/api/health",
  "/api/auth/login",
  "/api/auth/session",
  "/api/auth/acknowledge-pilot",
  "/api/auth/change-password",
  "/api/auth/activity",
  "/api/auth/logout",
]);

function authRequired(): ApiError {
  return new ApiError({ code: "AUTH_REQUIRED", messageTh: "กรุณาเข้าสู่ระบบ" });
}

export function authenticateRequest(request: FastifyRequest): Actor {
  const session = request.authenticatedSession;
  if (!session) throw authRequired();
  request.actor = session.actor;
  return session.actor;
}

export function requireActor(request: FastifyRequest, permission: Permission): Actor {
  return requirePermission(authenticateRequest(request), permission);
}

export function requireAuthenticatedSession(request: FastifyRequest): AuthenticatedSession {
  authenticateRequest(request);
  return request.authenticatedSession as AuthenticatedSession;
}

export function registerAuthHooks(input: {
  app: FastifyInstance;
  sessions: SessionService;
  clock: () => Date;
}): void {
  input.app.addHook("onRequest", async (request) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    request.authenticatedSession = input.sessions.authenticate(token, input.clock());
    request.actor = request.authenticatedSession?.actor;
  });

  input.app.addHook("preHandler", async (request) => {
    const route = request.routeOptions.url;
    if (!route?.startsWith("/api") || gateBypassPaths.has(route)) return;
    const session = requireAuthenticatedSession(request);
    if (session.account.pilotAcknowledgedAt === null) {
      throw new ApiError({
        code: "PILOT_ACKNOWLEDGEMENT_REQUIRED",
        messageTh: "กรุณายืนยันกติกาการใช้ข้อมูลสังเคราะห์",
      });
    }
    if (session.account.mustChangePassword) {
      throw new ApiError({
        code: "PASSWORD_CHANGE_REQUIRED",
        messageTh: "กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน",
      });
    }
  });
}
