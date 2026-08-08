import type { Actor, Permission } from "../../../shared/contracts.js";
import { ApiError } from "../../errors.js";

export const permissionsByRole = {
  assistant: [
    "patient:read",
    "patient:create-synthetic",
    "visit:submit-intake",
    "visit:read-queue",
    "patient:update-allergy",
    "inventory:read",
    "inventory:receive",
    "inventory:reserve",
  ],
  doctor: [
    "patient:read",
    "patient:create-synthetic",
    "visit:submit-intake",
    "visit:read-queue",
    "visit:start-consultation",
    "patient:update-allergy",
    "clinical:read",
    "clinical:save-draft",
    "clinical:sign",
    "clinical:amend",
    "medication:read-catalog",
    "medication:sign-decision",
    "inventory:read",
    "inventory:reserve",
  ],
} as const satisfies Record<Actor["role"], readonly Permission[]>;

export function hasPermission(actor: Actor, permission: Permission): boolean {
  return (permissionsByRole[actor.role] as readonly Permission[]).includes(permission);
}

export function requirePermission(actor: Actor, permission: Permission): Actor {
  if (!hasPermission(actor, permission)) {
    throw new ApiError({
      code: "FORBIDDEN",
      messageTh: "บัญชีนี้ไม่มีสิทธิ์ดำเนินการ",
    });
  }
  return actor;
}
