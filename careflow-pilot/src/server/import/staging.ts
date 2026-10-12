import { createHash } from "node:crypto";
import stableStringify from "fast-json-stable-stringify";
import { z } from "zod";

/** Adapters are added only after reviewing the actual export. No legacy parser or DB writer exists here. */
export interface SourceAdapter {
  namespace: string;
  syntheticOnly: boolean;
  read(): AsyncIterable<unknown>;
}
const candidateSchema = z.strictObject({
  sourceEntity: z.string().min(1).max(100), sourceId: z.string().min(1).max(200),
  entity: z.enum(["patient", "encounter", "medication", "stock", "payment"]),
  syntheticId: z.string().regex(/^DEMO-\d{6}$/),
  facts: z.object({ allergyState: z.enum(["UNKNOWN", "NONE", "RECORDED"]).default("UNKNOWN") }).catchall(z.unknown()),
  ambiguities: z.array(z.enum(["DATE_ERA", "TIMEZONE", "UNIT", "DUPLICATE_ID", "ALLERGY", "PAYMENT_STATE", "MAPPING"])).max(20),
});
type Status = "READY_FOR_REVIEW" | "DUPLICATE" | "CONFLICT" | "QUARANTINED";
interface StagingReportRow { sourceKey: string; contentHash: string; status: Status; allergyState: "UNKNOWN" | "NONE" | "RECORDED"; issues: string[] }
const digest = (value: unknown): string => createHash("sha256").update(stableStringify(value)).digest("hex");

/** A versioned dry-run report only. Historical encounters/payments never become live commands. */
export async function dryRunImport(input: { adapter: SourceAdapter; batchHash: string; prior: ReadonlyMap<string, string> }) {
  if (input.adapter.syntheticOnly !== true) throw new Error("Only synthetic source adapters are enabled");
  const namespace = z.string().regex(/^[a-z0-9][a-z0-9._-]{2,79}$/).parse(input.adapter.namespace);
  const batchHash = z.string().regex(/^[a-f0-9]{64}$/).parse(input.batchHash);
  const rows: StagingReportRow[] = [];
  for await (const raw of input.adapter.read()) {
    if (rows.length >= 10_000) throw new Error("Staging batch exceeds review limit");
    const parsed = candidateSchema.safeParse(raw);
    if (!parsed.success) { rows.push({ sourceKey: digest({ namespace, invalidRow: rows.length, batchHash }), contentHash: digest(null), status: "QUARANTINED", allergyState: "UNKNOWN", issues: ["INVALID_CANONICAL_RECORD"] }); continue; }
    const row = parsed.data;
    const sourceKey = digest({ namespace, entity: row.sourceEntity, sourceId: row.sourceId });
    const contentHash = digest({ entity: row.entity, syntheticId: row.syntheticId, facts: row.facts });
    const previous = input.prior.get(sourceKey);
    const status: Status = row.ambiguities.length ? "QUARANTINED" : previous === undefined ? "READY_FOR_REVIEW" : previous === contentHash ? "DUPLICATE" : "CONFLICT";
    rows.push({ sourceKey, contentHash, status, allergyState: row.facts.allergyState, issues: [...row.ambiguities] });
  }
  const grouped = new Map<string, StagingReportRow[]>();
  for (const row of rows) grouped.set(row.sourceKey, [...(grouped.get(row.sourceKey) ?? []), row]);
  for (const group of grouped.values()) {
    if (new Set(group.map((row) => row.contentHash)).size > 1) for (const row of group) { row.status = "CONFLICT"; row.issues.push("CONFLICTING_SOURCE_ID"); }
    else if (group.length > 1) for (const row of group.slice(1)) if (row.status === "READY_FOR_REVIEW") row.status = "DUPLICATE";
  }
  return { version: 1 as const, syntheticOnly: true as const, batchHash, rows, applied: 0 as const };
}
