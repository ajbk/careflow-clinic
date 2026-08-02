import { createSeedState } from "./seed";
import type { CareFlowAction, CareFlowState, ToastTone, Visit } from "./types";

function defaultMedicationInstruction(name: string) {
  if (name === "Paracetamol") return "รับประทานครั้งละ 1 เม็ด ทุก 4–6 ชั่วโมงเมื่อมีอาการปวดหรือมีไข้";
  if (name === "Amoxicillin") return "รับประทานครั้งละ 1 แคปซูล วันละ 3 ครั้ง หลังอาหาร";
  if (name === "Omeprazole") return "รับประทานครั้งละ 1 แคปซูล ก่อนอาหารเช้า";
  return "รับประทานตามคำสั่งแพทย์";
}

function addToast(state: CareFlowState, tone: ToastTone, message: string): CareFlowState {
  return {
    ...state,
    toasts: [
      ...state.toasts,
      { id: `toast-${state.toasts.length + 1}-${message.length}`, tone, message },
    ].slice(-4),
  };
}

function updateVisit(
  state: CareFlowState,
  visitId: string,
  updater: (visit: Visit) => Visit,
): CareFlowState {
  return {
    ...state,
    visits: state.visits.map((visit) => (visit.id === visitId ? updater(visit) : visit)),
  };
}

export function careFlowReducer(state: CareFlowState, action: CareFlowAction): CareFlowState {
  switch (action.type) {
    case "HYDRATE":
      return action.payload.state;

    case "SUBMIT_INTAKE": {
      const { patient, visit } = action.payload;
      const next: CareFlowState = {
        ...state,
        patients: [...state.patients, { ...patient, allergies: [...patient.allergies] }],
        visits: [
          ...state.visits,
          {
            ...visit,
            patientId: patient.id,
            status: "waiting",
            clinical: { subjective: "", objective: "", assessment: "", plan: "", diagnosis: null },
            medications: [],
            consultationFee: 100,
            medicationTotal: 0,
            inventoryDeducted: false,
          },
        ],
      };
      return addToast(next, "success", "ส่งผู้ป่วยเข้าสู่คิวแพทย์แล้ว");
    }

    case "START_CONSULTATION": {
      const visit = state.visits.find((item) => item.id === action.payload.visitId);
      if (!visit || visit.status !== "waiting") {
        return addToast(state, "error", "ไม่สามารถเริ่มการตรวจจากสถานะปัจจุบันได้");
      }
      return addToast(
        updateVisit(state, visit.id, (item) => ({
          ...item,
          status: "consulting",
          startedAt: action.payload.startedAt,
        })),
        "success",
        "เริ่มการตรวจแล้ว",
      );
    }

    case "SIGN_VISIT": {
      const visit = state.visits.find((item) => item.id === action.payload.visitId);
      if (!visit || visit.status !== "consulting") {
        return addToast(state, "error", "รายการตรวจนี้ยังไม่พร้อมสำหรับการลงนาม");
      }
      if (!action.payload.clinical.assessment.trim() || !action.payload.clinical.diagnosis) {
        return addToast(state, "error", "กรุณาระบุการประเมินและวินิจฉัยก่อนลงนาม");
      }
      return addToast(
        updateVisit(state, visit.id, (item) => ({
          ...item,
          status: "awaiting-dispensing",
          signedAt: action.payload.signedAt,
          clinical: { ...action.payload.clinical },
        })),
        "success",
        "ลงนามเวชระเบียนแล้ว ส่งต่อไปยังห้องยา",
      );
    }

    case "ADD_PRESCRIPTION": {
      const visit = state.visits.find((item) => item.id === action.payload.visitId);
      const inventoryItem = state.inventory.find((item) => item.id === action.payload.inventoryId);
      const quantity = Math.floor(action.payload.quantity);
      if (!visit || visit.status !== "consulting" || !inventoryItem || !Number.isInteger(action.payload.quantity) || quantity <= 0) {
        return addToast(state, "error", "ไม่สามารถเพิ่มรายการยาได้");
      }
      if (inventoryItem.stock < quantity) {
        return addToast(state, "error", "จำนวนยาในคลังไม่เพียงพอ");
      }
      if (visit.medications.some((medication) => medication.inventoryId === inventoryItem.id)) {
        return addToast(state, "info", "เพิ่มยารายการนี้ในแผนแล้ว");
      }
      const medication = {
        id: `rx-${visit.id}-${inventoryItem.id}`,
        inventoryId: inventoryItem.id,
        name: inventoryItem.name,
        nameTh: inventoryItem.nameTh,
        strength: inventoryItem.strength,
        form: inventoryItem.form,
        quantity,
        quantityLabel: `${quantity} ${inventoryItem.form}`,
        instructionTh: defaultMedicationInstruction(inventoryItem.name),
        instructionEn: "Take as directed by the clinician.",
        timing: ["symptom"] as const,
        warning: "ใช้ตามคำสั่งแพทย์",
        prepared: false,
      };
      return addToast(
        updateVisit(state, visit.id, (item) => ({
          ...item,
          medications: [...item.medications, medication],
          medicationTotal: item.medicationTotal + quantity * 2,
        })),
        "success",
        `เพิ่ม ${inventoryItem.nameTh} ในแผนยาแล้ว`,
      );
    }

    case "TOGGLE_MEDICATION_PREPARED":
      return updateVisit(state, action.payload.visitId, (visit) => ({
        ...visit,
        medications: visit.medications.map((medication) =>
          medication.id === action.payload.medicationId
            ? { ...medication, prepared: !medication.prepared }
            : medication,
        ),
      }));

    case "CONFIRM_DISPENSING": {
      const visit = state.visits.find((item) => item.id === action.payload.visitId);
      if (!visit || visit.status !== "awaiting-dispensing") {
        return addToast(state, "error", "รายการนี้ไม่ได้อยู่ในขั้นตอนจัดยา");
      }
      if (visit.medications.length === 0 || visit.medications.some((medication) => !medication.prepared)) {
        return addToast(state, "error", "กรุณาตรวจยาครบทุกรายการก่อนยืนยัน");
      }
      if (visit.inventoryDeducted) {
        return addToast(state, "info", "รายการยานี้ถูกตัดออกจากคลังแล้ว");
      }
      const quantities = new Map(
        visit.medications.map((medication) => [medication.inventoryId, medication.quantity]),
      );
      const next: CareFlowState = {
        ...state,
        inventory: state.inventory.map((item) => ({
          ...item,
          stock: Math.max(0, item.stock - (quantities.get(item.id) ?? 0)),
        })),
        visits: state.visits.map((item) =>
          item.id === visit.id
            ? {
                ...item,
                status: "awaiting-payment",
                dispensedAt: action.payload.dispensedAt,
                inventoryDeducted: true,
              }
            : item,
        ),
      };
      return addToast(next, "success", "ยืนยันการจ่ายยาและอัปเดตคลังแล้ว");
    }

    case "COMPLETE_PAYMENT": {
      const visit = state.visits.find((item) => item.id === action.payload.visitId);
      if (!visit || visit.status !== "awaiting-payment") {
        return addToast(state, "error", "รายการนี้ยังไม่พร้อมรับชำระเงิน");
      }
      const next: CareFlowState = {
        ...state,
        visits: state.visits.map((item) =>
          item.id === visit.id
            ? { ...item, status: "complete", completedAt: action.payload.paidAt }
            : item,
        ),
        transactions: [
          ...state.transactions,
          {
            id: `txn-${visit.id}`,
            visitId: visit.id,
            method: action.payload.method,
            consultationFee: visit.consultationFee,
            medicationTotal: visit.medicationTotal,
            total: visit.consultationFee + visit.medicationTotal,
            paidAt: action.payload.paidAt,
          },
        ],
      };
      return addToast(next, "success", "รับชำระเงินและปิดการตรวจเรียบร้อยแล้ว");
    }

    case "RECEIVE_STOCK": {
      const item = state.inventory.find((inventoryItem) => inventoryItem.id === action.payload.inventoryId);
      if (!item || action.payload.quantity <= 0 || !action.payload.batchNumber.trim()) {
        return addToast(state, "error", "กรุณากรอกข้อมูลรับยาให้ครบถ้วน");
      }
      const next: CareFlowState = {
        ...state,
        inventory: state.inventory.map((inventoryItem) =>
          inventoryItem.id === item.id
            ? { ...inventoryItem, stock: inventoryItem.stock + action.payload.quantity }
            : inventoryItem,
        ),
        batches: [
          ...state.batches,
          { ...action.payload, id: `batch-${state.batches.length + 1}` },
        ],
      };
      return addToast(next, "success", `รับ ${item.nameTh} เข้าคลังแล้ว`);
    }

    case "CREATE_APPOINTMENT": {
      const conflict = state.appointments.some(
        (appointment) =>
          appointment.date === action.payload.date && appointment.time === action.payload.time,
      );
      if (conflict) {
        return addToast(state, "error", "ช่วงเวลานี้มีนัดหมายแล้ว กรุณาเลือกเวลาอื่น");
      }
      return addToast(
        { ...state, appointments: [...state.appointments, { ...action.payload }] },
        "success",
        "บันทึกนัดหมายใหม่แล้ว",
      );
    }

    case "SET_ROLE":
      return { ...state, role: action.payload.role };

    case "DISMISS_TOAST":
      return { ...state, toasts: state.toasts.filter((toast) => toast.id !== action.payload.id) };

    case "RESET_DEMO":
      return addToast(createSeedState(), "info", "รีเซ็ตข้อมูลตัวอย่างแล้ว");

    default:
      return state;
  }
}
