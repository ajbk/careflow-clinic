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
    currentPatients: waiting + consulting + payment,
    waiting,
    dispensing,
    payment,
    lowStock,
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
