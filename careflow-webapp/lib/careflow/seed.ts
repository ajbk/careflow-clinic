import type {
  Appointment,
  CareFlowState,
  InventoryItem,
  Patient,
  PrescriptionItem,
  Visit,
  VisitStatus,
  Vitals,
} from "./types";

const baseVitals: Vitals = {
  weight: 62,
  height: 168,
  temperature: 36.7,
  systolic: 120,
  diastolic: 80,
  heartRate: 78,
  spo2: 98,
};

const demoMedications: PrescriptionItem[] = [
  {
    id: "rx-paracetamol",
    inventoryId: "med-paracetamol",
    name: "Paracetamol",
    nameTh: "พาราเซตามอล",
    strength: "500mg",
    form: "เม็ด",
    quantity: 20,
    quantityLabel: "20 เม็ด",
    instructionTh: "รับประทานครั้งละ 1–2 เม็ด ทุก 4–6 ชั่วโมงเมื่อมีอาการปวดหรือมีไข้",
    instructionEn: "Take 1–2 tablets every 4–6 hours as needed for pain or fever.",
    timing: ["symptom"],
    warning: "ไม่ควรรับประทานเกิน 8 เม็ดต่อวัน",
    prepared: false,
  },
  {
    id: "rx-amoxicillin",
    inventoryId: "med-amoxicillin",
    name: "Amoxicillin",
    nameTh: "อะม็อกซีซิลลิน",
    strength: "250mg",
    form: "แคปซูล",
    quantity: 30,
    quantityLabel: "30 แคปซูล",
    instructionTh: "รับประทานครั้งละ 1 แคปซูล วันละ 3 ครั้ง หลังอาหาร",
    instructionEn: "Take 1 capsule 3 times daily after meals.",
    timing: ["morning", "noon", "evening", "meal"],
    warning: "รับประทานให้ครบตามที่แพทย์สั่ง",
    prepared: false,
  },
  {
    id: "rx-loratadine",
    inventoryId: "med-loratadine",
    name: "Loratadine",
    nameTh: "ลอราทาดีน",
    strength: "10mg",
    form: "เม็ด",
    quantity: 10,
    quantityLabel: "10 เม็ด",
    instructionTh: "รับประทานครั้งละ 1 เม็ด วันละ 1 ครั้ง หลังอาหารเช้า",
    instructionEn: "Take 1 tablet once daily after breakfast.",
    timing: ["morning", "meal"],
    warning: "อาจทำให้ง่วงซึม",
    prepared: false,
  },
  {
    id: "rx-omeprazole",
    inventoryId: "med-omeprazole",
    name: "Omeprazole",
    nameTh: "โอเมพราโซล",
    strength: "20mg",
    form: "แคปซูล",
    quantity: 14,
    quantityLabel: "14 แคปซูล",
    instructionTh: "รับประทานครั้งละ 1 แคปซูล วันละ 1 ครั้ง ก่อนอาหารเช้า",
    instructionEn: "Take 1 capsule once daily before breakfast.",
    timing: ["morning", "meal"],
    warning: "รับประทานก่อนอาหารอย่างน้อย 30 นาที",
    prepared: false,
  },
];

const patients: Patient[] = [
  {
    id: "patient-somchai",
    hn: "65-00124",
    name: "สมชาย ใจดี",
    nameEn: "Somchai Jai-dee",
    age: 68,
    gender: "ชาย",
    phone: "081-234-5678",
    allergies: ["เพนิซิลลิน"],
    contactName: "มณี ใจดี (ภรรยา)",
    contactPhone: "081-XXX-XXXX",
    totalVisits: 24,
    lastVisit: "2026-07-18",
  },
  { id: "patient-maliwan", hn: "66-00131", name: "มะลิวัลย์ สุขดี", age: 54, gender: "หญิง", phone: "082-111-2211", allergies: [] },
  { id: "patient-ariya", hn: "66-00132", name: "อารียา มงคล", age: 31, gender: "หญิง", phone: "082-111-2212", allergies: [] },
  { id: "patient-wichai", hn: "66-00133", name: "วิชัย รักไทย", age: 46, gender: "ชาย", phone: "082-111-2213", allergies: [] },
  { id: "patient-bunmee", hn: "65-00089", name: "บุญมี แสนสุข", age: 73, gender: "หญิง", phone: "082-111-2214", allergies: [] },
  { id: "patient-somsri", hn: "66-00134", name: "สมศรี สุขใจ", age: 59, gender: "หญิง", phone: "082-111-2215", allergies: [] },
  { id: "patient-prasert", hn: "66-00135", name: "ประเสริฐ ยินดี", age: 62, gender: "ชาย", phone: "082-111-2216", allergies: [] },
  { id: "patient-malee", hn: "65-00090", name: "มาลี ใจดี", age: 48, gender: "หญิง", phone: "082-111-2217", allergies: [] },
  { id: "patient-pornchai", hn: "65-00091", name: "พรชัย ทองดี", age: 52, gender: "ชาย", phone: "082-111-2218", allergies: [] },
  { id: "patient-nipon", hn: "65-00092", name: "นิพนธ์ รุ่งเรือง", age: 57, gender: "ชาย", phone: "082-111-2219", allergies: [] },
  { id: "patient-wandee", hn: "66-00136", name: "วันดี รักษา", age: 39, gender: "หญิง", phone: "082-111-2220", allergies: [] },
];

function visit(
  id: string,
  patientId: string,
  status: VisitStatus,
  arrivedAt: string,
  extras: Partial<Visit> = {},
): Visit {
  return {
    id,
    patientId,
    status,
    arrivedAt,
    vitals: { ...baseVitals },
    chiefComplaint: "ตรวจติดตามอาการทั่วไป",
    clinical: {
      subjective: "",
      objective: "",
      assessment: "",
      plan: "",
      diagnosis: null,
    },
    medications: [],
    consultationFee: 100,
    medicationTotal: 0,
    inventoryDeducted: false,
    ...extras,
  };
}

const inventory: InventoryItem[] = [
  { id: "med-amoxicillin", code: "DRG-0012", name: "Amoxicillin", nameTh: "อะม็อกซีซิลลิน", strength: "250mg", form: "แคปซูล", stock: 450, unit: "กล่อง", threshold: 50, earliestExpiry: "2028-10-31", dispensedThisMonth: 720 },
  { id: "med-paracetamol", code: "DRG-0001", name: "Paracetamol", nameTh: "พาราเซตามอล", strength: "500mg", form: "เม็ด", stock: 42, unit: "กล่อง", threshold: 50, earliestExpiry: "2027-12-31", dispensedThisMonth: 1850 },
  { id: "med-metformin", code: "DRG-0020", name: "Metformin", nameTh: "เมตฟอร์มิน", strength: "500mg", form: "เม็ด", stock: 210, unit: "กล่อง", threshold: 80, earliestExpiry: "2029-01-31", dispensedThisMonth: 980 },
  { id: "med-ibuprofen", code: "DRG-0031", name: "Ibuprofen Syrup", nameTh: "ไอบูโพรเฟนชนิดน้ำ", strength: "100mg/5ml", form: "น้ำเชื่อม", stock: 0, unit: "ขวด", threshold: 20, dispensedThisMonth: 126 },
  { id: "med-loratadine", code: "DRG-0042", name: "Loratadine", nameTh: "ลอราทาดีน", strength: "10mg", form: "เม็ด", stock: 85, unit: "กล่อง", threshold: 30, earliestExpiry: "2028-11-30", dispensedThisMonth: 310 },
  { id: "med-omeprazole", code: "DRG-0054", name: "Omeprazole", nameTh: "โอเมพราโซล", strength: "20mg", form: "แคปซูล", stock: 14, unit: "กล่อง", threshold: 20, earliestExpiry: "2027-09-30", dispensedThisMonth: 440 },
  { id: "med-amlodipine", code: "DRG-0061", name: "Amlodipine", nameTh: "แอมโลดิพีน", strength: "5mg", form: "เม็ด", stock: 3500, unit: "เม็ด", threshold: 500, earliestExpiry: "2029-04-30", dispensedThisMonth: 1240 },
];

const appointments: Appointment[] = [
  { id: "appt-1", patientId: "patient-somchai", patientName: "สมชาย ใจดี", date: "2026-08-03", time: "09:00", durationMinutes: 60, reason: "ตรวจติดตามอาการเบาหวาน", notes: "", tone: "mint" },
  { id: "appt-2", patientId: "patient-wandee", patientName: "วันดี รักษา", date: "2026-08-04", time: "10:00", durationMinutes: 60, reason: "ผู้ป่วยใหม่ — ตรวจทั่วไป", notes: "", tone: "blue" },
  { id: "appt-3", patientId: "patient-bunmee", patientName: "บุญมี แสนสุข", date: "2026-08-05", time: "09:00", durationMinutes: 60, reason: "รับยาความดัน", notes: "", tone: "mint" },
  { id: "appt-4", patientId: "patient-maliwan", patientName: "มะลิวัลย์ สุขดี", date: "2026-08-07", time: "14:00", durationMinutes: 60, reason: "ฉีดวัคซีนไข้หวัดใหญ่", notes: "", tone: "rose" },
];

export interface SeedOptions {
  demoVisitStatus?: VisitStatus;
  allPrepared?: boolean;
}

export function createSeedState(options: SeedOptions = {}): CareFlowState {
  const prepared = options.allPrepared ?? false;
  const demoStatus = options.demoVisitStatus ?? "waiting";
  const visits: Visit[] = [
    visit("demo-visit", "patient-somchai", demoStatus, "2026-08-02T08:30:00.000Z", {
      chiefComplaint: "ไอแห้งและอ่อนเพลียมา 4 วัน ไม่มีไข้หรือหอบเหนื่อย",
      medications: demoMedications.map((medication) => ({ ...medication, prepared })),
      medicationTotal: 250,
      doctorName: "พญ. อริสรา สุขใจ",
      visitType: "ตรวจอาการเฉียบพลัน",
      signedAt: demoStatus === "awaiting-dispensing" || demoStatus === "awaiting-payment" || demoStatus === "complete" ? "2026-08-02T09:45:00.000Z" : undefined,
      clinical: demoStatus === "waiting" || demoStatus === "consulting"
        ? { subjective: "", objective: "", assessment: "", plan: "", diagnosis: null }
        : {
            subjective: "ไอแห้งมา 4 วัน รู้สึกอ่อนเพลียเล็กน้อย",
            objective: "ปอดใสทั้งสองข้าง ไม่มีเสียง wheezing หรือ crackles",
            assessment: "ติดเชื้อทางเดินหายใจส่วนบนเฉียบพลัน",
            plan: "พักผ่อน ดื่มน้ำอุ่น และรับประทานยาตามคำสั่ง",
            diagnosis: { code: "J06.9", labelTh: "การติดเชื้อทางเดินหายใจส่วนบนเฉียบพลัน", labelEn: "Acute upper respiratory infection" },
          },
    }),
    visit("visit-wait-2", "patient-maliwan", "waiting", "2026-08-02T08:45:00.000Z"),
    visit("visit-wait-3", "patient-ariya", "waiting", "2026-08-02T09:00:00.000Z"),
    visit("visit-wait-4", "patient-wichai", "waiting", "2026-08-02T09:05:00.000Z"),
    visit("visit-wait-5", "patient-bunmee", "waiting", "2026-08-02T09:10:00.000Z"),
    visit("visit-consult-1", "patient-somsri", "consulting", "2026-08-02T08:20:00.000Z", { startedAt: "2026-08-02T09:05:00.000Z", room: "ห้อง 1", doctorName: "พญ. อริสรา" }),
    visit("visit-consult-2", "patient-prasert", "consulting", "2026-08-02T08:35:00.000Z", { startedAt: "2026-08-02T09:10:00.000Z", room: "ห้อง 2", doctorName: "นพ. ปกรณ์" }),
    visit("visit-dispense-1", "patient-malee", "awaiting-dispensing", "2026-08-02T08:05:00.000Z"),
    visit("visit-dispense-2", "patient-pornchai", "awaiting-dispensing", "2026-08-02T08:15:00.000Z"),
    visit("visit-payment-1", "patient-nipon", "awaiting-payment", "2026-08-02T08:10:00.000Z"),
    visit("visit-complete-1", "patient-wandee", "complete", "2026-08-02T07:45:00.000Z", { completedAt: "2026-08-02T08:50:00.000Z" }),
  ];

  return {
    version: 1,
    role: "doctor",
    patients: patients.map((patient) => ({ ...patient, allergies: [...patient.allergies] })),
    visits,
    inventory: inventory.map((item) => ({ ...item })),
    batches: [],
    appointments: appointments.map((appointment) => ({ ...appointment })),
    transactions: [],
    toasts: [],
    storageRecovered: false,
  };
}

export const seedState = createSeedState();
