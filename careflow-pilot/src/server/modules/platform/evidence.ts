import { createHash } from "node:crypto";
import stableStringify from "fast-json-stable-stringify";

/** Produces the canonical SHA-256 digest for immutable signed evidence. */
export function hashEvidence(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}
