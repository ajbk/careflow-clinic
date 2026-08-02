export type Role = "assistant" | "doctor";

export type VisitStatus =
  | "intake"
  | "waiting"
  | "consulting"
  | "awaiting-dispensing"
  | "awaiting-payment"
  | "complete";

export type PaymentMethod = "cash" | "promptpay";
export type ToastTone = "success" | "error" | "info";

export interface Vitals {
  weight: number;
  height: number;
  temperature: number;
  systolic: number;
  diastolic: number;
  heartRate: number;
  spo2: number;
}

export interface Patient {
  id: string;
  hn: string;
  name: string;
  nameEn?: string;
  age: number;
  gender: string;
  phone: string;
  allergies: string[];
  contactName?: string;
  contactPhone?: string;
  totalVisits?: number;
  lastVisit?: string;
}

export interface Diagnosis {
  code: string;
  labelTh: string;
  labelEn: string;
}

export interface ClinicalNote {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  diagnosis: Diagnosis | null;
}

export interface PrescriptionItem {
  id: string;
  inventoryId: string;
  name: string;
  nameTh: string;
  strength: string;
  form: string;
  quantity: number;
  quantityLabel: string;
  instructionTh: string;
  instructionEn: string;
  timing: Array<"morning" | "noon" | "evening" | "bedtime" | "meal" | "symptom">;
  warning?: string;
  prepared: boolean;
}

export interface Visit {
  id: string;
  patientId: string;
  status: VisitStatus;
  arrivedAt: string;
  startedAt?: string;
  signedAt?: string;
  dispensedAt?: string;
  completedAt?: string;
  room?: string;
  doctorName?: string;
  vitals: Vitals;
  chiefComplaint: string;
  clinical: ClinicalNote;
  medications: PrescriptionItem[];
  consultationFee: number;
  medicationTotal: number;
  inventoryDeducted: boolean;
  visitType?: string;
}

export interface InventoryItem {
  id: string;
  code: string;
  name: string;
  nameTh: string;
  strength: string;
  form: string;
  stock: number;
  unit: string;
  threshold: number;
  earliestExpiry?: string;
  dispensedThisMonth: number;
}

export interface InventoryBatch {
  id: string;
  inventoryId: string;
  quantity: number;
  unit: string;
  supplier: string;
  batchNumber: string;
  expiry: string;
  receivedAt: string;
}

export interface Appointment {
  id: string;
  patientId: string;
  patientName: string;
  date: string;
  time: string;
  durationMinutes: number;
  reason: string;
  notes: string;
  tone: "mint" | "blue" | "red" | "neutral" | "rose";
}

export interface Transaction {
  id: string;
  visitId: string;
  method: PaymentMethod;
  consultationFee: number;
  medicationTotal: number;
  total: number;
  paidAt: string;
}

export interface ToastMessage {
  id: string;
  tone: ToastTone;
  message: string;
}

export interface CareFlowState {
  version: 1;
  role: Role;
  patients: Patient[];
  visits: Visit[];
  inventory: InventoryItem[];
  batches: InventoryBatch[];
  appointments: Appointment[];
  transactions: Transaction[];
  toasts: ToastMessage[];
  storageRecovered: boolean;
}

export type CareFlowAction =
  | { type: "HYDRATE"; payload: { state: CareFlowState } }
  | {
      type: "SUBMIT_INTAKE";
      payload: {
        patient: Patient;
        visit: {
          id: string;
          arrivedAt: string;
          vitals: Vitals;
          chiefComplaint: string;
        };
      };
    }
  | { type: "START_CONSULTATION"; payload: { visitId: string; startedAt: string } }
  | {
      type: "SIGN_VISIT";
      payload: { visitId: string; signedAt: string; clinical: ClinicalNote };
    }
  | {
      type: "TOGGLE_MEDICATION_PREPARED";
      payload: { visitId: string; medicationId: string };
    }
  | {
      type: "CONFIRM_DISPENSING";
      payload: { visitId: string; dispensedAt: string };
    }
  | {
      type: "COMPLETE_PAYMENT";
      payload: { visitId: string; method: PaymentMethod; paidAt: string };
    }
  | {
      type: "RECEIVE_STOCK";
      payload: Omit<InventoryBatch, "id">;
    }
  | { type: "CREATE_APPOINTMENT"; payload: Appointment }
  | { type: "SET_ROLE"; payload: { role: Role } }
  | { type: "DISMISS_TOAST"; payload: { id: string } }
  | { type: "RESET_DEMO" };
