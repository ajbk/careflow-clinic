import { ApiError } from "../../errors.js";

export function assertExpectedRevision(
  actual: number | null | undefined,
  expected: number,
  revisionName = "entity",
): asserts actual is number {
  if (!Number.isInteger(actual) || !Number.isInteger(expected) || actual !== expected) {
    throw new ApiError({
      code: "REVISION_CONFLICT",
      messageTh: "ข้อมูลมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลล่าสุด",
      currentRevisions: Number.isInteger(actual)
        ? { [revisionName]: actual as number }
        : undefined,
    });
  }
}
