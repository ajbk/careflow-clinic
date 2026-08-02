import type { CareFlowState, InventoryItem, Visit } from "./types";

export function selectInventoryStatus(
  item: Pick<InventoryItem, "stock" | "threshold">,
): "healthy" | "low" | "depleted" {
  if (item.stock <= 0) return "depleted";
  if (item.stock <= item.threshold) return "low";
  return "healthy";
}

export function selectDashboardMetrics(state: CareFlowState) {
  const waiting = state.visits.filter((visit) => visit.status === "waiting").length;
  const consulting = state.visits.filter((visit) => visit.status === "consulting").length;
  const dispensing = state.visits.filter(
    (visit) => visit.status === "awaiting-dispensing",
  ).length;
  const payment = state.visits.filter((visit) => visit.status === "awaiting-payment").length;
  const lowStock = state.inventory.filter(
    (item) => selectInventoryStatus(item) !== "healthy",
  ).length;

  return {
    currentPatients: waiting + consulting + dispensing + payment,
    waiting,
    dispensing,
    payment,
    lowStock,
  };
}

const analyticsBaseline = {
  patientVolume: 248,
  consultations: 312,
  revenue: 45_200,
  lowStock: 3,
  patients: 11,
  monthlySeries: [
    { label: "พ.ค.", value: 58 }, { label: "มิ.ย.", value: 72 },
    { label: "ก.ค.", value: 64 }, { label: "ส.ค.", value: 86 },
    { label: "ก.ย.", value: 78 }, { label: "ต.ค.", value: 92 },
  ],
  diagnoses: [
    { label: "ความดันโลหิตสูง", code: "I10", count: 48 },
    { label: "เบาหวานชนิดที่ 2", code: "E11", count: 42 },
    { label: "การติดเชื้อทางเดินหายใจส่วนบน", code: "J06.9", count: 31 },
    { label: "ปวดกล้ามเนื้อ", code: "M79.1", count: 24 },
  ],
};

/** Reference values for October 2566 plus observable state deltas for this demo. */
export function selectAnalyticsReport(state: CareFlowState) {
  const patientDelta = state.patients.length - analyticsBaseline.patients;
  const signedVisits = state.visits.filter((visit) => Boolean(visit.signedAt)).length;
  const revenueDelta = state.transactions.reduce((total, transaction) => total + transaction.total, 0);
  const lowStock = state.inventory.filter((item) => selectInventoryStatus(item) !== "healthy").length;
  const diagnosisDeltas = new Map<string, number>();
  for (const visit of state.visits) {
    const diagnosis = visit.clinical.diagnosis;
    if (diagnosis) diagnosisDeltas.set(diagnosis.code, (diagnosisDeltas.get(diagnosis.code) ?? 0) + 1);
  }
  const diagnoses = analyticsBaseline.diagnoses
    .map((item) => ({ ...item, count: item.count + (diagnosisDeltas.get(item.code) ?? 0) }))
    .sort((left, right) => right.count - left.count);
  const activityDelta = patientDelta + signedVisits + state.transactions.length
    + [...diagnosisDeltas.values()].reduce((total, count) => total + count, 0)
    + (analyticsBaseline.lowStock - lowStock);

  return {
    period: "ตุลาคม 2566",
    patientVolume: analyticsBaseline.patientVolume + patientDelta,
    consultations: analyticsBaseline.consultations + signedVisits,
    revenue: analyticsBaseline.revenue + revenueDelta,
    lowStock,
    diagnoses,
    monthlySeries: analyticsBaseline.monthlySeries.map((point, index) => ({
      ...point,
      value: point.value + (index === analyticsBaseline.monthlySeries.length - 1 ? activityDelta : 0),
    })),
  };
}

export function selectQueueColumns(state: CareFlowState): {
  waiting: Visit[];
  inProgress: Visit[];
  completed: Visit[];
} {
  return {
    waiting: state.visits.filter((visit) => visit.status === "waiting"),
    inProgress: state.visits.filter((visit) => visit.status === "consulting"),
    completed: state.visits.filter((visit) =>
      ["awaiting-dispensing", "awaiting-payment", "complete"].includes(visit.status),
    ),
  };
}

export function selectPatient(state: CareFlowState, patientId: string) {
  return state.patients.find((patient) => patient.id === patientId);
}

export function selectVisit(state: CareFlowState, visitId: string) {
  return state.visits.find((visit) => visit.id === visitId);
}

export function selectVisitPatient(state: CareFlowState, visitId: string) {
  const visit = selectVisit(state, visitId);
  return visit ? selectPatient(state, visit.patientId) : undefined;
}
