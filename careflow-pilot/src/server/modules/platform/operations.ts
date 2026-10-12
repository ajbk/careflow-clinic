import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Actor } from "../../../shared/contracts.js";
import { operationPermissions } from "../../../shared/operations.js";
import type { DatabaseHandle } from "../../db/client.js";
import { authenticateRequest } from "../../auth/hooks.js";
import { ApiError } from "../../errors.js";
import { requirePermission } from "./permissions.js";

const keySchema = z.string().regex(/^[!-~]{8,128}$/);
export function currentGeneration(database: DatabaseHandle): string {
  const value = database.sqlite.prepare("SELECT value FROM platform_metadata WHERE key = 'recovery_generation'").pluck().get();
  if (typeof value !== "string" || !value) throw new Error("Recovery generation missing");
  return value;
}

export function assertGeneration(database: DatabaseHandle, generation: unknown): void {
  if (generation !== currentGeneration(database)) throw new ApiError({ code: "GENERATION_CHANGED", messageTh: "ระบบผ่านการกู้คืนข้อมูล ต้องตรวจสอบรายการกับผู้รับผิดชอบก่อนทำคำสั่งใหม่" });
}

function authorize(actor: Actor, operation: string): void {
  const permission = Object.hasOwn(operationPermissions, operation) ? operationPermissions[operation] : undefined;
  if (!permission) throw new ApiError({ code: "FORBIDDEN", messageTh: "ไม่สามารถตรวจสอบคำสั่งนี้ได้" });
  requirePermission(actor, permission);
}

export function commandStatus(database: DatabaseHandle, actor: Actor, key: string, generation: string) {
  keySchema.parse(key);
  assertGeneration(database, generation);
  return lookupStatus(database, actor, key, generation);
}

function lookupStatus(database: DatabaseHandle, actor: Actor, key: string, generation: string) {
  const committed = database.sqlite.prepare("SELECT operation FROM idempotency_records WHERE actor_id = ? AND key = ?").get(actor.id, key) as { operation: string } | undefined;
  const cancelled = database.sqlite.prepare("SELECT operation FROM command_cancellations WHERE actor_id = ? AND key = ?").get(actor.id, key) as { operation: string } | undefined;
  const result = committed ?? cancelled;
  if (result) authorize(actor, result.operation);
  return { status: committed ? "COMMITTED" as const : cancelled ? "CANCELLED" as const : "UNKNOWN" as const, generation };
}

export function cancelCommand(database: DatabaseHandle, actor: Actor, key: string, operation: string, generation: string) {
  keySchema.parse(key); authorize(actor, operation);
  return database.sqlite.transaction(() => {
    if (generation !== currentGeneration(database)) {
      const raw = database.sqlite.prepare("SELECT value FROM platform_metadata WHERE key='recovery_approval'").pluck().get();
      const approval = typeof raw === "string" ? z.object({ sourceGeneration: z.string(), generation: z.string(), cutoffDisposition: z.literal("NO_UNRECORDED_EFFECTS") }).safeParse(JSON.parse(raw)) : undefined;
      if (!approval?.success || approval.data.sourceGeneration !== generation || approval.data.generation !== currentGeneration(database) ||
          database.sqlite.prepare("SELECT value FROM platform_metadata WHERE key='recovery_mode'").pluck().get() !== "normal") assertGeneration(database, generation);
    }
    const status = lookupStatus(database, actor, key, generation);
    if (status.status !== "UNKNOWN") return status;
    database.sqlite.prepare(`INSERT INTO command_cancellations (actor_id, key, operation, generation, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(actor.id, key, operation, generation, new Date().toISOString());
    return { status: "CANCELLED" as const, generation };
  }).immediate();
}

export function registerOperationRoutes(app: FastifyInstance, database: DatabaseHandle): void {
  app.get<{ Params: { key: string }; Querystring: { generation: string } }>("/api/operations/:key", async (request) => ({
    data: commandStatus(database, authenticateRequest(request), request.params.key, request.query.generation),
  }));
  app.post<{ Params: { key: string } }>("/api/operations/:key/cancel", async (request) => {
    const body = z.strictObject({ operation: z.string().max(80), generation: z.string().min(1).max(80) }).parse(request.body);
    return { data: cancelCommand(database, authenticateRequest(request), request.params.key, body.operation, body.generation) };
  });
}
