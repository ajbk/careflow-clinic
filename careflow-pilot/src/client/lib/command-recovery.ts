import { z } from "zod";
import { ApiError } from "./api-error";

const storageKey = "careflow-command-breadcrumbs-v1";
export const commandRecoveryEvent = "careflow-command-recovery";
const breadcrumbSchema = z.strictObject({ key: z.string().min(8).max(128), owner: z.string().min(1).max(128), generation: z.string().min(1).max(80), operation: z.string().min(1).max(80) });
export type CommandBreadcrumb = z.infer<typeof breadcrumbSchema>;

export function pendingOutcomeError(): ApiError {
  return new ApiError({ code: "COMMAND_OUTCOME_UNKNOWN", status: 409, messageTh: "ยังไม่ทราบผลคำสั่งก่อนหน้า กรุณาตรวจสอบผลหรือยกเลิกคำสั่งเดิมก่อนทำรายการใหม่" });
}

/** Opaque breadcrumbs only: no body, URL/entity, session token, clinical data or offline queue. */
export function readBreadcrumbs(): CommandBreadcrumb[] {
  try {
    const raw = sessionStorage.getItem(storageKey);
    return raw === null ? [] : z.array(breadcrumbSchema).max(32).parse(JSON.parse(raw));
  } catch { throw pendingOutcomeError(); }
}

export function storeBreadcrumbs(rows: CommandBreadcrumb[]): void {
  try {
    const validated = z.array(breadcrumbSchema).max(32).parse(rows);
    if (validated.length) sessionStorage.setItem(storageKey, JSON.stringify(validated));
    else sessionStorage.removeItem(storageKey);
  }
  catch { throw pendingOutcomeError(); }
}
export function notifyCommandRecovery(): void { window.dispatchEvent(new Event(commandRecoveryEvent)); }

export const operationStatusResponse = z.strictObject({ data: z.strictObject({
  status: z.enum(["UNKNOWN", "COMMITTED", "CANCELLED"]), generation: z.string().min(1),
}) });
