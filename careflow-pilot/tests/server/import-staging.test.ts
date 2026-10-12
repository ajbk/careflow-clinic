import { describe, expect, it } from "vitest";
import { dryRunImport, type SourceAdapter } from "../../src/server/import/staging.js";

function adapter(records: unknown[]): SourceAdapter { return { namespace: "synthetic-old-system", syntheticOnly: true, read: async function* () { for (const row of records) yield row; } }; }
const candidate = { sourceEntity: "patient", sourceId: "fixture-001", entity: "patient", syntheticId: "DEMO-000001", facts: { allergyState: "UNKNOWN" as const }, ambiguities: [] };
describe("source-independent migration staging", () => {
  it("uses source identity separately from batch hash and never interprets unknown allergy as none", async () => {
    const first = await dryRunImport({ adapter: adapter([candidate]), batchHash: "a".repeat(64), prior: new Map() });
    const record = first.rows[0]!;
    expect(record.status).toBe("READY_FOR_REVIEW"); expect(record.allergyState).toBe("UNKNOWN");
    const next = await dryRunImport({ adapter: adapter([candidate]), batchHash: "b".repeat(64), prior: new Map([[record.sourceKey, record.contentHash]]) });
    expect(next.rows[0]?.status).toBe("DUPLICATE");
    expect(next.rows[0]?.sourceKey).toBe(record.sourceKey);
    expect(next.applied).toBe(0);
  });
  it("quarantines conflicting stable IDs, ambiguous facts and unsupported real-data sources", async () => {
    const result = await dryRunImport({ adapter: adapter([candidate, { ...candidate, facts: { allergyState: "NONE" } },
      { ...candidate, sourceId: "other", ambiguities: ["DATE_ERA", "UNIT"] }]), batchHash: "a".repeat(64), prior: new Map() });
    expect(result.rows.map((row) => row.status)).toEqual(["CONFLICT", "CONFLICT", "QUARANTINED"]);
    await expect(dryRunImport({ adapter: { ...adapter([]), syntheticOnly: false }, batchHash: "a".repeat(64), prior: new Map() })).rejects.toThrow(/synthetic/i);
  });
  it("returns no raw source identity or clinical payload in reports", async () => {
    const result = await dryRunImport({ adapter: adapter([{ ...candidate, sourceId: "sensitive-source-id", facts: { allergyState: "UNKNOWN", label: "do not echo payload" } }]), batchHash: "a".repeat(64), prior: new Map() });
    expect(JSON.stringify(result)).not.toContain("sensitive-source-id");
    expect(JSON.stringify(result)).not.toContain("do not echo payload");
  });
});
