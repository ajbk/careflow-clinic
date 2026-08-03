import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { clinicConfig } from "../platform/schema.js";

export const patients = sqliteTable(
  "patients",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinicConfig.id),
    hn: text("hn").notNull(),
    displayName: text("display_name").notNull(),
    phone: text("phone").notNull(),
    birthDate: text("birth_date").notNull(),
    sex: text("sex", { enum: ["female", "male", "unknown"] }).notNull(),
    revision: integer("revision").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    unique("patients_clinic_hn_unique").on(table.clinicId, table.hn),
    check(
      "patients_hn_check",
      sql`length(${table.hn}) = 11 AND ${table.hn} GLOB 'DEMO-[0-9][0-9][0-9][0-9][0-9][0-9]'`,
    ),
    check(
      "patients_display_name_check",
      sql`${table.displayName} = 'ผู้ป่วยทดสอบ ' || substr(${table.hn}, 6)`,
    ),
    check(
      "patients_phone_check",
      sql`length(${table.phone}) = 10 AND ${table.phone} GLOB '000000[0-9][0-9][0-9][0-9]'`,
    ),
    check(
      "patients_phone_hn_check",
      sql`${table.phone} = '000000' || substr(${table.hn}, -4)`,
    ),
    check(
      "patients_sex_check",
      sql`${table.sex} IN ('female', 'male', 'unknown')`,
    ),
    check(
      "patients_demographics_check",
      sql`${table.birthDate} = '1990-01-01' AND ${table.sex} = 'unknown'`,
    ),
    check("patients_revision_check", sql`${table.revision} >= 1`),
  ],
);
