import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import { ApiError } from "../errors.js";

declare module "fastify" { interface FastifyRequest { securityClientIp?: string } }

export function sessionCookieName(config: AppConfig): string {
  return config.cloud ? "__Host-careflow_session" : "careflow_session";
}

export function csrfForSession(tokenHash: string): string {
  return createHash("sha256").update(`careflow-csrf-v1:${tokenHash}`).digest("hex");
}

function forbidden(): never {
  throw new ApiError({ code: "FORBIDDEN", messageTh: "การเชื่อมต่อไม่ผ่านการตรวจสอบความปลอดภัย" });
}

/** The only ingress is one exact loopback peer. Never infer trust from hop count. */
export function registerCloudBoundary(app: FastifyInstance, config: AppConfig): void {
  const cloud = config.cloud;
  app.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    if (!cloud) return;
    const peer = request.raw.socket.remoteAddress?.replace(/^::ffff:/, "");
    const host = new URL(cloud.publicOrigin).host;
    const headers = request.headers;
    if (!peer || !cloud.trustedProxies.includes(peer) || headers.host !== host ||
        headers["x-forwarded-proto"] !== "https" || headers.forwarded !== undefined ||
        (headers["x-forwarded-host"] !== undefined && headers["x-forwarded-host"] !== host) ||
        headers["x-forwarded-port"] !== undefined) forbidden();
    const forwardedIp = headers["x-forwarded-for"];
    if (forwardedIp !== undefined && (typeof forwardedIp !== "string" || !isIP(forwardedIp))) forbidden();
    request.securityClientIp = typeof forwardedIp === "string" ? forwardedIp : peer;
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      if (headers.origin !== cloud.publicOrigin ||
          (headers["sec-fetch-site"] !== undefined && headers["sec-fetch-site"] !== "same-origin")) forbidden();
      if (Number(headers["content-length"] ?? 0) > 0 || headers["transfer-encoding"] !== undefined) {
        if (headers["content-type"]?.split(";", 1)[0]?.trim() !== "application/json") forbidden();
      }
    }
  });
}

/** Registered after authentication so the token is bound to the current session. */
export function registerCloudCsrf(app: FastifyInstance, config: AppConfig): void {
  if (!config.cloud) return;
  app.addHook("preHandler", async (request) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method) || !request.authenticatedSession) return;
    if (request.routeOptions.url === "/api/auth/login") return;
    const token = request.headers["x-csrf-token"];
    const expected = csrfForSession(request.authenticatedSession.tokenHash);
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token) ||
        !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) forbidden();
  });
}
