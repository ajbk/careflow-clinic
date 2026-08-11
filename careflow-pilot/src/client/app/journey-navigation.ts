import type { JourneyAction, JourneyBlocker } from "../../shared/contracts";

export type JourneyDestination =
  | { kind: "ROUTE"; to: string }
  | { kind: "LOCAL"; action: "START_CONSULTATION" | "REVIEW_ALLERGY" }
  | { kind: "NONE" };

const visitRoute: Partial<Record<JourneyAction, (visitId: string) => string>> = {
  OPEN_CONSULTATION: (id) => `/consultations/${encodeURIComponent(id)}`,
  START_PREPARATION: (id) => `/dispensing/${encodeURIComponent(id)}`,
  PRINT_LABEL: (id) => `/dispensing/${encodeURIComponent(id)}`,
  CONFIRM_ALLOCATION: (id) => `/dispensing/${encodeURIComponent(id)}`,
  COMPLETE_PREPARATION: (id) => `/dispensing/${encodeURIComponent(id)}`,
  RELEASE_MEDICATION: (id) => `/dispensing/${encodeURIComponent(id)}`,
  HANDOFF_MEDICATION: (id) => `/dispensing/${encodeURIComponent(id)}`,
  FINALIZE_CHARGE: (id) => `/checkout/${encodeURIComponent(id)}`,
  RECORD_CASH: (id) => `/checkout/${encodeURIComponent(id)}`,
  RECORD_PROMPTPAY: (id) => `/checkout/${encodeURIComponent(id)}`,
  APPROVE_FULL_WAIVER: (id) => `/checkout/${encodeURIComponent(id)}`,
  CLOSE_VISIT: (id) => `/checkout/${encodeURIComponent(id)}`,
  OPEN_OPD_CARD: (id) => `/visits/${encodeURIComponent(id)}/opd-card`,
};

function stockRecoveryRoute(visitId: string, blocker: JourneyBlocker | undefined): string | null {
  const medicationId = blocker?.medication?.medicationId;
  if (!medicationId) return null;
  const returnTo = `/dispensing/${encodeURIComponent(visitId)}`;
  return `/inventory/receive?${new URLSearchParams({ medicationId, returnTo }).toString()}`;
}

export function journeyDestination(
  action: JourneyAction,
  visitId: string,
  blocker?: JourneyBlocker,
): JourneyDestination {
  if (action === "START_CONSULTATION" || action === "REVIEW_ALLERGY") return { kind: "LOCAL", action };
  if (action === "RECEIVE_STOCK") {
    const to = stockRecoveryRoute(visitId, blocker);
    return to ? { kind: "ROUTE", to } : { kind: "NONE" };
  }
  const to = visitRoute[action]?.(visitId);
  return to ? { kind: "ROUTE", to } : { kind: "NONE" };
}

/** Keep return navigation within this single-origin application. */
export function sanitizeJourneyReturnTo(value: string | null | undefined): string {
  if (!value) return "/inventory";
  const candidate = value.trim();
  let decoded: string;
  try {
    decoded = decodeURIComponent(candidate);
  } catch {
    return "/inventory";
  }
  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    decoded.startsWith("//") ||
    decoded.includes("\\") ||
    decoded.includes("\u0000") ||
    /^[a-z][a-z\d+.-]*:/i.test(decoded)
  ) {
    return "/inventory";
  }
  return candidate;
}

export function visitIdFromJourneyReturnTo(returnTo: string): string | null {
  const match = /^\/dispensing\/([^/?#]+)(?:[/?#]|$)/.exec(returnTo);
  if (!match) return null;
  try {
    const visitId = decodeURIComponent(match[1]);
    return visitId.length > 0 && !visitId.includes("/") && !visitId.includes("\\") ? visitId : null;
  } catch {
    return null;
  }
}
