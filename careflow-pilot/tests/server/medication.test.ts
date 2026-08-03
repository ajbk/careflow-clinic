import { afterEach, describe, expect, it } from "vitest";
import type { MedicationDto } from "../../src/shared/contracts.js";
import { createMedicationService } from "../../src/server/modules/medication/index.js";
import { cookieFrom, login, seedAccount } from "./helpers/auth.js";
import { createTestApp } from "./helpers/database.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function authenticatedMedicationApp(role: "assistant" | "doctor" = "doctor") {
  const fixture = await createTestApp();
  cleanups.push(fixture.cleanup);
  const account = await seedAccount(fixture.database, {
    username: role,
    role,
    displayName: role === "assistant" ? "ผู้ช่วยทดสอบ" : "พญ. ทดสอบ",
    mustChangePassword: false,
  });
  const cookie = cookieFrom(await login(fixture.app, account.username, account.password));
  return { ...fixture, account, cookie };
}

async function search(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  cookie: string,
  q: string,
) {
  return app.inject({
    method: "GET",
    url: `/api/medications?q=${encodeURIComponent(q)}`,
    headers: { cookie },
  });
}

describe("synthetic medication catalog", () => {
  it("returns active synthetic entries and escapes wildcards", async () => {
    const fixture = await authenticatedMedicationApp();
    fixture.database.sqlite.prepare("UPDATE medications SET active=0 WHERE id='DEMO-MED-004'").run();

    expect((await search(fixture.app, fixture.cookie, "DEMO")).json().data.map((row: MedicationDto) => row.id))
      .toEqual(["DEMO-MED-001", "DEMO-MED-002", "DEMO-MED-003"]);
    expect((await search(fixture.app, fixture.cookie, "%_")).json().data).toEqual([]);
  });

  it("accepts trimmed Unicode queries from 2 through 80 code points", async () => {
    const fixture = await authenticatedMedicationApp();

    expect((await search(fixture.app, fixture.cookie, " DE ")).statusCode).toBe(200);
    expect((await search(fixture.app, fixture.cookie, "😀".repeat(80))).statusCode).toBe(200);
    expect((await search(fixture.app, fixture.cookie, "D")).statusCode).toBe(422);
    expect((await search(fixture.app, fixture.cookie, "😀".repeat(81))).statusCode).toBe(422);
  });

  it("applies the query boundary to direct medication service callers", async () => {
    const fixture = await authenticatedMedicationApp();
    const medications = createMedicationService({ database: fixture.database });

    expect(() => medications.searchMedications("D")).toThrow(/คำค้นหาต้องมี 2–80 ตัวอักษร/);
  });

  it("orders by display name then id, limits 20, and exposes only catalog DTO fields", async () => {
    const fixture = await authenticatedMedicationApp();
    const insert = fixture.database.sqlite.prepare(
      "INSERT INTO medications (id, display_name, strength_text, dosage_form_text, canonical_unit, active, revision, created_at, updated_at) VALUES (?, ?, '100 mg', 'tablet', 'tablet', 1, 1, ?, ?)",
    );
    for (let sequence = 5; sequence <= 25; sequence += 1) {
      const id = `DEMO-MED-${String(sequence).padStart(3, "0")}`;
      insert.run(id, sequence < 7 ? "[DEMO] AAA" : `[DEMO] Extra ${String(sequence).padStart(3, "0")}`, "2026-08-03T00:00:00.000Z", "2026-08-03T00:00:00.000Z");
    }

    const response = await search(fixture.app, fixture.cookie, "DEMO");
    expect(response.statusCode).toBe(200);
    const data = response.json().data as MedicationDto[];
    expect(data).toHaveLength(20);
    expect(data.slice(0, 2).map((row) => row.id)).toEqual(["DEMO-MED-005", "DEMO-MED-006"]);
    expect(Object.keys(data[0] ?? {}).sort()).toEqual([
      "canonicalUnit", "displayName", "dosageFormText", "id", "revision", "strengthText",
    ]);
  });

  it("requires the catalog permission", async () => {
    const doctor = await authenticatedMedicationApp("doctor");
    const assistant = await authenticatedMedicationApp("assistant");

    expect((await search(doctor.app, doctor.cookie, "DEMO")).statusCode).toBe(200);
    expect((await search(assistant.app, assistant.cookie, "DEMO")).statusCode).toBe(403);
    expect((await doctor.app.inject({ method: "GET", url: "/api/medications?q=DEMO" })).statusCode).toBe(401);
  });

  it("rejects inactive or missing medication revisions and reports stale revisions", async () => {
    const fixture = await authenticatedMedicationApp();
    const medications = createMedicationService({ database: fixture.database });

    fixture.database.sqlite.prepare("UPDATE medications SET active=0 WHERE id='DEMO-MED-001'").run();
    expect(() => fixture.database.db.transaction((tx) => medications.assertMedicationRevision(tx, "DEMO-MED-001", 1)))
      .toThrow(/ไม่พบยา/);
    expect(() => fixture.database.db.transaction((tx) => medications.assertMedicationRevision(tx, "DEMO-MED-999", 1)))
      .toThrow(/ไม่พบยา/);
    fixture.database.sqlite.prepare("UPDATE medications SET revision=2 WHERE id='DEMO-MED-002'").run();
    expect(() => fixture.database.db.transaction((tx) => medications.assertMedicationRevision(tx, "DEMO-MED-002", 1)))
      .toThrow(/ข้อมูลมีการเปลี่ยนแปลง/);
  });
});
