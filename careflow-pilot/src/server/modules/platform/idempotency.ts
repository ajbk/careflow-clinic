import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import stableStringify from "fast-json-stable-stringify";
import type {
  Actor,
  CommandBody,
  CommandHttpResult,
  CommandWorkResult,
  IdempotentEnvelope,
} from "../../../shared/contracts.js";
import { ApiError } from "../../errors.js";
import {
  runBoundAuditedTransaction,
  type AppDatabase,
  type AuditedTransaction,
} from "./audit.js";
import { idempotencyRecords } from "./schema.js";

const IDEMPOTENCY_KEY_PATTERN = /^[!-~]{8,128}$/;

function assertValidIdempotencyKey(key: string): void {
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new ApiError({
      code: "VALIDATION_FAILED",
      messageTh: "Idempotency-Key ต้องมีอักขระ ASCII ที่มองเห็นได้ 8–128 ตัว",
      fieldErrors: {
        "idempotency-key": "ต้องมีอักขระ ASCII ที่มองเห็นได้ 8–128 ตัว",
      },
    });
  }
}

function requestHash(
  operation: string,
  requestBody: CommandBody<unknown, Record<string, number>>,
): string {
  return createHash("sha256")
    .update(stableStringify({ operation, requestBody }))
    .digest("hex");
}

function parseStoredEnvelope<T>(responseJson: string): IdempotentEnvelope<T> {
  const parsed: unknown = JSON.parse(responseJson);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("data" in parsed) ||
    !("replayed" in parsed) ||
    typeof parsed.replayed !== "boolean"
  ) {
    throw new Error("Invalid stored idempotency response");
  }
  return parsed as IdempotentEnvelope<T>;
}

export function executeIdempotent<T>(input: {
  db: AppDatabase;
  actor: Actor;
  key: string;
  operation: string;
  requestBody: CommandBody<unknown, Record<string, number>>;
  work: (tx: AuditedTransaction) => CommandWorkResult<T>;
}): CommandHttpResult<T> {
  assertValidIdempotencyKey(input.key);
  const hash = requestHash(input.operation, input.requestBody);

  return runBoundAuditedTransaction({
    db: input.db,
    actor: input.actor,
    work: (tx) => {
      const existing = tx
        .select()
        .from(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.actorId, input.actor.id),
            eq(idempotencyRecords.key, input.key),
          ),
        )
        .get();

      if (existing) {
        if (existing.requestHash !== hash) {
          throw new ApiError({
            code: "IDEMPOTENCY_CONFLICT",
            messageTh: "คีย์คำขอนี้ถูกใช้กับข้อมูลอื่นแล้ว",
          });
        }

        const stored = parseStoredEnvelope<T>(existing.responseJson);
        return {
          statusCode: existing.responseStatus,
          body: { data: stored.data, replayed: true },
        };
      }

      const result = input.work(tx);
      const body: IdempotentEnvelope<T> = { data: result.data, replayed: false };
      tx.insert(idempotencyRecords)
        .values({
          clinicId: "clinic",
          actorId: input.actor.id,
          key: input.key,
          requestHash: hash,
          responseStatus: result.statusCode,
          responseJson: stableStringify(body),
          createdAt: new Date().toISOString(),
        })
        .run();

      return { statusCode: result.statusCode, body };
    },
  });
}
