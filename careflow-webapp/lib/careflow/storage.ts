import { createSeedState } from "./seed";
import type {
  CareFlowState,
  InventoryBatch,
  InventoryItem,
  InventoryUnit,
  PrescriptionItem,
  Visit,
} from "./types";

export const STORAGE_KEY = "careflow.prototype.v2";
export const LEGACY_STORAGE_KEY = "careflow.prototype.v1";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type LegacyInventoryUnit = InventoryUnit | "กล่อง";
type LegacyPrescriptionItem = Omit<PrescriptionItem, "unit">;
type LegacyVisit = Omit<Visit, "medications"> & { medications: LegacyPrescriptionItem[] };
type LegacyInventoryItem = Omit<InventoryItem, "unit"> & { unit: LegacyInventoryUnit };
type LegacyInventoryBatch = Omit<InventoryBatch, "unit"> & { unit: LegacyInventoryUnit };
type LegacyCareFlowState = Omit<CareFlowState, "version" | "visits" | "inventory" | "batches"> & {
  version: 1;
  visits: LegacyVisit[];
  inventory: LegacyInventoryItem[];
  batches: LegacyInventoryBatch[];
};

const inventoryUnits: readonly InventoryUnit[] = ["เม็ด", "แคปซูล", "ขวด"];
const prescriptionTimings = ["morning", "noon", "evening", "bedtime", "meal", "symptom"] as const;
const visitStatuses = ["intake", "waiting", "consulting", "awaiting-dispensing", "awaiting-payment", "complete"] as const;
const appointmentTones = ["mint", "blue", "red", "neutral", "rose"] as const;
const toastTones = ["success", "error", "info"] as const;

const legacyUnitByInventoryId: Record<string, InventoryUnit> = {
  "med-amoxicillin": "แคปซูล",
  "med-paracetamol": "เม็ด",
  "med-metformin": "เม็ด",
  "med-ibuprofen": "ขวด",
  "med-loratadine": "เม็ด",
  "med-omeprazole": "แคปซูล",
  "med-amlodipine": "เม็ด",
};

function recoveredSeed(): CareFlowState {
  return { ...createSeedState(), storageRecovered: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function hasStrings(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => isString(value[key]));
}

function hasMember(values: readonly string[], value: unknown): boolean {
  return typeof value === "string" && values.includes(value);
}

function isPatient(value: unknown): boolean {
  return isRecord(value)
    && hasStrings(value, ["id", "hn", "name", "gender", "phone"])
    && isFiniteNumber(value.age)
    && isStringArray(value.allergies);
}

function isVitals(value: unknown): boolean {
  return isRecord(value) && ["weight", "height", "temperature", "systolic", "diastolic", "heartRate", "spo2"].every((key) => isFiniteNumber(value[key]));
}

function isDiagnosis(value: unknown): boolean {
  return value === null || (isRecord(value) && hasStrings(value, ["code", "labelTh", "labelEn"]));
}

function isClinicalNote(value: unknown): boolean {
  return isRecord(value)
    && hasStrings(value, ["subjective", "objective", "assessment", "plan"])
    && isDiagnosis(value.diagnosis);
}

function isPrescription(value: unknown, requireUnit: boolean): boolean {
  return isRecord(value)
    && hasStrings(value, ["id", "inventoryId", "name", "nameTh", "strength", "form", "quantityLabel", "instructionTh", "instructionEn"])
    && (!requireUnit || hasMember(inventoryUnits, value.unit))
    && isFiniteNumber(value.quantity)
    && typeof value.prepared === "boolean"
    && Array.isArray(value.timing)
    && value.timing.every((timing) => hasMember(prescriptionTimings, timing));
}

function isVisit(value: unknown, requirePrescriptionUnit: boolean): boolean {
  return isRecord(value)
    && hasStrings(value, ["id", "patientId", "arrivedAt", "chiefComplaint"])
    && hasMember(visitStatuses, value.status)
    && isVitals(value.vitals)
    && isClinicalNote(value.clinical)
    && Array.isArray(value.medications)
    && value.medications.every((medication) => isPrescription(medication, requirePrescriptionUnit))
    && isFiniteNumber(value.consultationFee)
    && isFiniteNumber(value.medicationTotal)
    && typeof value.inventoryDeducted === "boolean";
}

function isInventoryItem(value: unknown, acceptLegacyBox: boolean): boolean {
  return isRecord(value)
    && hasStrings(value, ["id", "code", "name", "nameTh", "strength", "form"])
    && (hasMember(inventoryUnits, value.unit) || (acceptLegacyBox && value.unit === "กล่อง"))
    && ["stock", "threshold", "dispensedThisMonth"].every((key) => isFiniteNumber(value[key]));
}

function isBatch(value: unknown, acceptLegacyBox: boolean): boolean {
  return isRecord(value)
    && hasStrings(value, ["id", "inventoryId", "unit", "supplier", "batchNumber", "expiry", "receivedAt"])
    && (hasMember(inventoryUnits, value.unit) || (acceptLegacyBox && value.unit === "กล่อง"))
    && isFiniteNumber(value.quantity);
}

function isAppointment(value: unknown): boolean {
  return isRecord(value)
    && hasStrings(value, ["id", "patientId", "patientName", "date", "time", "reason", "notes", "tone"])
    && isFiniteNumber(value.durationMinutes)
    && hasMember(appointmentTones, value.tone);
}

function isTransaction(value: unknown): boolean {
  return isRecord(value)
    && hasStrings(value, ["id", "visitId", "paidAt"])
    && hasMember(["cash", "promptpay"], value.method)
    && ["consultationFee", "medicationTotal", "total"].every((key) => isFiniteNumber(value[key]));
}

function isToast(value: unknown): boolean {
  return isRecord(value)
    && hasStrings(value, ["id", "message"])
    && hasMember(toastTones, value.tone);
}

function hasStateShape(value: unknown, version: 1 | 2, legacy: boolean): boolean {
  if (!isRecord(value)) return false;
  return value.version === version
    && (value.role === "assistant" || value.role === "doctor")
    && typeof value.storageRecovered === "boolean"
    && Array.isArray(value.patients) && value.patients.every(isPatient)
    && Array.isArray(value.visits) && value.visits.every((visit) => isVisit(visit, !legacy))
    && Array.isArray(value.inventory) && value.inventory.every((item) => isInventoryItem(item, legacy))
    && Array.isArray(value.batches) && value.batches.every((batch) => isBatch(batch, legacy))
    && Array.isArray(value.appointments) && value.appointments.every(isAppointment)
    && Array.isArray(value.transactions) && value.transactions.every(isTransaction)
    && Array.isArray(value.toasts) && value.toasts.every(isToast);
}

function isCareFlowState(value: unknown): value is CareFlowState {
  return hasStateShape(value, 2, false);
}

function isLegacyCareFlowState(value: unknown): value is LegacyCareFlowState {
  return hasStateShape(value, 1, true);
}

function canonicalUnit(inventoryId: string, unit: LegacyInventoryUnit): InventoryUnit | null {
  if (unit === "กล่อง") return legacyUnitByInventoryId[inventoryId] ?? null;
  return unit;
}

function migrateLegacyState(legacy: LegacyCareFlowState): CareFlowState | null {
  const inventory = legacy.inventory.map((item) => {
    const unit = canonicalUnit(item.id, item.unit);
    return unit ? { ...item, unit } : null;
  });
  if (inventory.some((item) => item === null)) return null;
  const canonicalInventory = inventory as InventoryItem[];
  const unitsByInventoryId = new Map(canonicalInventory.map((item) => [item.id, item.unit]));

  const batches = legacy.batches.map((batch) => {
    const unit = canonicalUnit(batch.inventoryId, batch.unit);
    return unit ? { ...batch, unit } : null;
  });
  if (batches.some((batch) => batch === null)) return null;

  const visits = legacy.visits.map((visit) => {
    const medications = visit.medications.map((medication) => {
      const unit = unitsByInventoryId.get(medication.inventoryId);
      return unit ? { ...medication, unit, quantityLabel: `${medication.quantity} ${unit}` } : null;
    });
    return medications.some((medication) => medication === null)
      ? null
      : { ...visit, medications: medications as PrescriptionItem[] };
  });
  if (visits.some((visit) => visit === null)) return null;

  const migrated: CareFlowState = {
    ...legacy,
    version: 2,
    inventory: canonicalInventory,
    batches: batches as InventoryBatch[],
    visits: visits as Visit[],
  };
  return isCareFlowState(migrated) ? migrated : null;
}

function parseEnvelope(raw: string): { version?: number; state?: unknown } | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function loadState(storage: StorageLike): CareFlowState {
  const currentRaw = storage.getItem(STORAGE_KEY);
  if (currentRaw !== null) {
    const envelope = parseEnvelope(currentRaw);
    if (!envelope || envelope.version !== 2 || !isCareFlowState(envelope.state)) return recoveredSeed();
    return { ...envelope.state, storageRecovered: false, toasts: [] };
  }

  const legacyRaw = storage.getItem(LEGACY_STORAGE_KEY);
  if (legacyRaw === null) return createSeedState();
  const legacyEnvelope = parseEnvelope(legacyRaw);
  if (!legacyEnvelope || legacyEnvelope.version !== 1 || !isLegacyCareFlowState(legacyEnvelope.state)) return recoveredSeed();
  const migrated = migrateLegacyState(legacyEnvelope.state);
  if (!migrated) return recoveredSeed();

  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, state: migrated }));
  return { ...migrated, storageRecovered: false };
}

export function saveState(storage: StorageLike, state: CareFlowState): void {
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, state: { ...state, toasts: [] } }));
}
