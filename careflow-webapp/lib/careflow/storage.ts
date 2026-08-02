import { createSeedState } from "./seed";
import type { CareFlowState } from "./types";

export const STORAGE_KEY = "careflow.prototype.v1";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

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

function isPrescription(value: unknown): boolean {
  return isRecord(value)
    && hasStrings(value, ["id", "inventoryId", "name", "nameTh", "strength", "form", "quantityLabel", "instructionTh", "instructionEn"])
    && isFiniteNumber(value.quantity)
    && typeof value.prepared === "boolean"
    && Array.isArray(value.timing)
    && value.timing.every((timing) => ["morning", "noon", "evening", "bedtime", "meal", "symptom"].includes(timing as string));
}

function isVisit(value: unknown): boolean {
  const validStatuses = ["intake", "waiting", "consulting", "awaiting-dispensing", "awaiting-payment", "complete"];
  return isRecord(value)
    && hasStrings(value, ["id", "patientId", "arrivedAt", "chiefComplaint"])
    && validStatuses.includes(value.status as string)
    && isVitals(value.vitals)
    && isClinicalNote(value.clinical)
    && Array.isArray(value.medications)
    && value.medications.every(isPrescription)
    && isFiniteNumber(value.consultationFee)
    && isFiniteNumber(value.medicationTotal)
    && typeof value.inventoryDeducted === "boolean";
}

function isInventoryItem(value: unknown): boolean {
  return isRecord(value)
    && hasStrings(value, ["id", "code", "name", "nameTh", "strength", "form"])
    && ["เม็ด", "แคปซูล", "ขวด"].includes(value.unit as string)
    && ["stock", "threshold", "dispensedThisMonth"].every((key) => isFiniteNumber(value[key]));
}

function isBatch(value: unknown): boolean {
  return isRecord(value)
    && hasStrings(value, ["id", "inventoryId", "unit", "supplier", "batchNumber", "expiry", "receivedAt"])
    && ["เม็ด", "แคปซูล", "ขวด"].includes(value.unit as string)
    && isFiniteNumber(value.quantity);
}

function isAppointment(value: unknown): boolean {
  return isRecord(value)
    && hasStrings(value, ["id", "patientId", "patientName", "date", "time", "reason", "notes", "tone"])
    && isFiniteNumber(value.durationMinutes)
    && ["mint", "blue", "red", "neutral", "rose"].includes(value.tone as string);
}

function isTransaction(value: unknown): boolean {
  return isRecord(value)
    && hasStrings(value, ["id", "visitId", "paidAt"])
    && ["cash", "promptpay"].includes(value.method as string)
    && ["consultationFee", "medicationTotal", "total"].every((key) => isFiniteNumber(value[key]));
}

function isToast(value: unknown): boolean {
  return isRecord(value)
    && hasStrings(value, ["id", "message"])
    && ["success", "error", "info"].includes(value.tone as string);
}

function isCareFlowState(value: unknown): value is CareFlowState {
  if (!isRecord(value)) return false;
  const candidate = value;
  return (
    candidate.version === 1 &&
    (candidate.role === "assistant" || candidate.role === "doctor") &&
    typeof candidate.storageRecovered === "boolean" &&
    Array.isArray(candidate.patients) && candidate.patients.every(isPatient) &&
    Array.isArray(candidate.visits) && candidate.visits.every(isVisit) &&
    Array.isArray(candidate.inventory) && candidate.inventory.every(isInventoryItem) &&
    Array.isArray(candidate.batches) && candidate.batches.every(isBatch) &&
    Array.isArray(candidate.appointments) && candidate.appointments.every(isAppointment) &&
    Array.isArray(candidate.transactions) && candidate.transactions.every(isTransaction) &&
    Array.isArray(candidate.toasts) && candidate.toasts.every(isToast)
  );
}

export function loadState(storage: StorageLike): CareFlowState {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return createSeedState();

  try {
    const envelope = JSON.parse(raw) as { version?: number; state?: unknown };
    if (envelope.version !== 1 || !isCareFlowState(envelope.state)) return recoveredSeed();
    return { ...envelope.state, storageRecovered: false, toasts: [] };
  } catch {
    return recoveredSeed();
  }
}

export function saveState(storage: StorageLike, state: CareFlowState): void {
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, state: { ...state, toasts: [] } }));
}
