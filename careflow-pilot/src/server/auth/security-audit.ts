import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { DatabaseHandle } from "../db/client.js";

type SecurityAction = "login.succeeded" | "login.failed" | "logout" | "request.denied" | "record.read" | "password.changed";
export function recordSecurityEvent(database: DatabaseHandle, event: {
  action: SecurityAction; actorId?: string; route: string; status: number; now: Date;
}): void {
  database.sqlite.prepare(`INSERT INTO security_events (id, actor_id, action, route, status, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(randomUUID(), event.actorId ?? null, event.action, event.route, event.status, event.now.toISOString());
}

export function registerSecurityAudit(app: FastifyInstance, database: DatabaseHandle, clock: () => Date): void {
  const recorded = new WeakSet<object>();
  app.addHook("onSend", async (request, reply, payload) => {
    const route = request.routeOptions.url ?? "/unmatched";
    if (recorded.has(request)) return payload;
    recorded.add(request);
    let action: SecurityAction | undefined;
    if ([401, 403, 429].includes(reply.statusCode)) action = route === "/api/auth/login" ? "login.failed" : "request.denied";
    else if (request.actor && request.method === "GET" && route.startsWith("/api/") && !route.startsWith("/api/auth/") && route !== "/api/health") action = "record.read";
    if (action) recordSecurityEvent(database, { action, actorId: request.actor?.id, route, status: reply.statusCode, now: clock() });
    return payload;
  });
}
