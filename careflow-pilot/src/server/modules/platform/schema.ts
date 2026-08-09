import { sql } from "drizzle-orm";
import {
  check,
  customType,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

const nocaseText = customType<{ data: string }>({
  dataType: () => "text collate nocase",
});

export const clinicConfig = sqliteTable(
  "clinic_config",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull(),
    syntheticOnly: integer("synthetic_only").notNull(),
    consultationFeeBaht: integer("consultation_fee_baht").notNull().default(100),
    pricingRevision: integer("pricing_revision").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("clinic_config_id_check", sql`${table.id} = 'clinic'`),
    check("clinic_config_name_check", sql`length(trim(${table.name})) BETWEEN 1 AND 120`),
    check("clinic_config_timezone_check", sql`${table.timezone} = 'Asia/Bangkok'`),
    check("clinic_config_synthetic_only_check", sql`${table.syntheticOnly} = 1`),
    check("clinic_config_consultation_fee_baht_check", sql`typeof(${table.consultationFeeBaht}) = 'integer' AND ${table.consultationFeeBaht} BETWEEN 1 AND 1000000`),
    check("clinic_config_pricing_revision_check", sql`typeof(${table.pricingRevision}) = 'integer' AND ${table.pricingRevision} >= 1`),
  ],
);

export const platformMetadata = sqliteTable("platform_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const clinicCounters = sqliteTable(
  "clinic_counters",
  {
    key: text("key").primaryKey(),
    value: integer("value").notNull(),
  },
  (table) => [check("clinic_counters_value_check", sql`${table.value} >= 0`)],
);

export const staffAccounts = sqliteTable(
  "staff_accounts",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinicConfig.id),
    username: nocaseText("username").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: ["assistant", "doctor"] }).notNull(),
    passwordHash: text("password_hash").notNull(),
    mustChangePassword: integer("must_change_password").notNull(),
    pilotAcknowledgedAt: text("pilot_acknowledged_at"),
    active: integer("active").notNull(),
    revision: integer("revision").notNull(),
    lastPasswordChangedAt: text("last_password_changed_at").notNull(),
    disabledAt: text("disabled_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("staff_accounts_role_check", sql`${table.role} IN ('assistant', 'doctor')`),
    check("staff_accounts_must_change_password_check", sql`${table.mustChangePassword} IN (0, 1)`),
    check("staff_accounts_active_check", sql`${table.active} IN (0, 1)`),
    check("staff_accounts_revision_check", sql`${table.revision} >= 1`),
    unique("staff_accounts_clinic_username_unique").on(table.clinicId, table.username),
  ],
);

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  staffId: text("staff_id")
    .notNull()
    .references(() => staffAccounts.id),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinicConfig.id),
    actorId: text("actor_id").references(() => staffAccounts.id),
    actorRole: text("actor_role", { enum: ["assistant", "doctor", "system"] }).notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    entityRevision: integer("entity_revision").notNull(),
    reason: text("reason"),
    occurredAt: text("occurred_at").notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
  },
  (table) => [
    check("audit_events_actor_role_check", sql`${table.actorRole} IN ('assistant', 'doctor', 'system')`),
    check("audit_events_entity_revision_check", sql`${table.entityRevision} >= 1`),
    check("audit_events_metadata_json_check", sql`json_valid(${table.metadataJson})`),
    check(
      "audit_events_actor_identity_check",
      sql`(${table.actorRole} = 'system' AND ${table.actorId} IS NULL) OR (${table.actorRole} IN ('assistant', 'doctor') AND ${table.actorId} IS NOT NULL)`,
    ),
  ],
);

export const idempotencyRecords = sqliteTable(
  "idempotency_records",
  {
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinicConfig.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => staffAccounts.id),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseJson: text("response_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.actorId, table.key] }),
    check("idempotency_records_status_check", sql`${table.responseStatus} BETWEEN 100 AND 599`),
    check("idempotency_records_response_json_check", sql`json_valid(${table.responseJson})`),
  ],
);
