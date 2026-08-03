import { describe, expect, it } from "vitest";
import { formatThaiDateTime } from "../../src/client/lib/thai-date";

describe("Thai Buddhist date formatting", () => {
  it("renders Bangkok time with a Buddhist Era year", () => {
    const rendered = formatThaiDateTime("2026-08-03T17:30:00.000Z");
    expect(rendered).toContain("4 สิงหาคม 2569");
  });

  it("changes the local date across Bangkok midnight", () => {
    const before = formatThaiDateTime("2026-08-03T16:59:59.000Z");
    const after = formatThaiDateTime("2026-08-03T17:00:00.000Z");
    expect(before).toContain("3 สิงหาคม 2569");
    expect(after).toContain("4 สิงหาคม 2569");
  });
});
