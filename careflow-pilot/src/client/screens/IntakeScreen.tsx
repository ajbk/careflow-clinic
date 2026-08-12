import { useMutation } from "@tanstack/react-query";
import { ClipboardPlus, Search, Send, Sparkles, UserPlus } from "lucide-react";
import type { ChangeEvent, FormEvent, ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AllergyAssessmentDto, PatientDto } from "../../shared/contracts";
import { IntakeAllergyCard } from "../components/careflow/IntakeAllergyCard";
import { PatientHeader } from "../components/careflow/PatientHeader";
import { ActionButton, Card, PageHeader, SectionHeading } from "../components/careflow/ui";
import {
  createSyntheticPatient,
  type SyntheticPatientAttempt,
  usePatientAllergy,
  usePatientSearch,
} from "../features/patients";
import {
  createIntakeAttempt,
  initialIntakeAllergyDraft,
  initialIntakeDraft,
  intakeAllergyDraftFromContext,
  type IntakeAttempt,
  type IntakeAllergyDraft,
  type IntakeDraft,
  useSubmitIntake,
  vitalFields,
} from "../features/intake";
import { ApiClient, apiClient as defaultApiClient } from "../lib/api-client";
import { ApiError, isApiError, serverUnavailableError } from "../lib/api-error";
import { createCommandAttempt } from "../lib/idempotency";

const intakeFieldOrder = [
  "chiefComplaint",
  "temperatureC",
  "systolicMmhg",
  "diastolicMmhg",
  "heartRateBpm",
  "spo2Percent",
  "weightKg",
  "heightCm",
] as const;

type LoadedAllergyAuthority = {
  patientId: string;
  patientRevision: number;
  allergyRevision: number;
};

type AllergyReconfirmationState = "idle" | "reloading" | "reconfirmation-required" | "reload-failed";

function normalizeFieldKey(key: string): string | null {
  const normalized = key.replace(/^payload\./, "");
  if (normalized.startsWith("vitals.")) {
    const vital = normalized.replace(/^vitals\./, "");
    return (intakeFieldOrder as readonly string[]).includes(vital) ? vital : null;
  }
  if (normalized === "allergy.answer" || normalized === "allergy.changeReason") return normalized;
  if (/^allergy\.items\.\d+\.(substance|reaction|severity|note)$/.test(normalized)) return normalized;
  return (intakeFieldOrder as readonly string[]).includes(normalized) ? normalized : null;
}

function fieldErrorRank(key: string): number {
  const intakeIndex = (intakeFieldOrder as readonly string[]).indexOf(key);
  if (intakeIndex >= 0) return intakeIndex;
  if (key === "allergy.answer") return 100;
  const item = /^allergy\.items\.(\d+)\.(substance|reaction|severity|note)$/.exec(key);
  if (item) {
    const propertyRank = { substance: 0, reaction: 1, severity: 2, note: 3 }[item[2]] ?? 4;
    return 110 + Number(item[1]) * 4 + propertyRank;
  }
  if (key === "allergy.changeReason") return 300;
  return 1_000;
}

function ageLabel(patient: PatientDto): string {
  const birth = new Date(`${patient.birthDate}T00:00:00.000Z`);
  if (!Number.isFinite(birth.getTime())) return "ไม่ทราบอายุ";
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  if (
    now.getUTCMonth() < birth.getUTCMonth() ||
    (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())
  ) age -= 1;
  return `อายุ ${Math.max(0, age)} ปี`;
}

function sexLabel(patient: PatientDto): string {
  return patient.sex === "female" ? "หญิง" : patient.sex === "male" ? "ชาย" : "ไม่ระบุเพศ";
}

function hasDraftValues(draft: IntakeDraft): boolean {
  return Object.values(draft).some((value) => value.trim().length > 0);
}

function requiresAllergyChangeReason(
  assessment: AllergyAssessmentDto | undefined,
  draft: IntakeAllergyDraft,
): boolean {
  return assessment !== undefined && assessment.state !== "UNKNOWN" && (
    (assessment.state === "PRESENT" && draft.answer === "NO") ||
    (assessment.state === "NONE_KNOWN" && draft.answer === "YES")
  );
}

function hasValidReportedAllergyItems(draft: IntakeAllergyDraft): boolean {
  return draft.answer !== "YES" || (
    draft.items.length >= 1 &&
    draft.items.length <= 20 &&
    draft.items.every((item) => item.substance.trim().length > 0 && item.reaction.trim().length > 0)
  );
}

function describeError(error: unknown): ApiError {
  if (isApiError(error)) return error;
  return serverUnavailableError(error);
}

function SyntheticSearchResult({
  patient,
  onSelect,
  disabled = false,
}: {
  patient: PatientDto;
  onSelect: (patient: PatientDto) => void;
  disabled?: boolean;
}): ReactElement {
  return (
    <button
      className="patient-search-result"
      type="button"
      onClick={() => onSelect(patient)}
      disabled={disabled}
      aria-label={`เลือกผู้ป่วย ${patient.displayName}`}
    >
      <span className="patient-search-result-main">
        <strong>{patient.displayName}</strong>
        <small>HN {patient.hn} · {ageLabel(patient)} · {sexLabel(patient)}</small>
      </span>
      <span className="patient-search-result-action">เลือกผู้ป่วย</span>
    </button>
  );
}

export function IntakeScreen({ apiClient = defaultApiClient }: { apiClient?: ApiClient }): ReactElement {
  const navigate = useNavigate();
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<PatientDto | null>(null);
  const [draft, setDraft] = useState<IntakeDraft>(initialIntakeDraft);
  const [allergyDraft, setAllergyDraft] = useState<IntakeAllergyDraft>(initialIntakeAllergyDraft);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [activeVisit, setActiveVisit] = useState(false);
  const [allergyReconfirmationState, setAllergyReconfirmationState] = useState<AllergyReconfirmationState>("idle");
  const [generateAttempt, setGenerateAttempt] = useState<SyntheticPatientAttempt | null>(null);
  const [submitAttempt, setSubmitAttempt] = useState<IntakeAttempt | null>(null);
  const [retryAttempt, setRetryAttempt] = useState<IntakeAttempt | null>(null);
  const generateAttemptRef = useRef<SyntheticPatientAttempt | null>(null);
  const loadedAllergyAuthority = useRef<LoadedAllergyAuthority | null>(null);
  const selectedPatientIdRef = useRef<string | null>(null);
  const allergyReloadRequest = useRef(0);
  const nextAllergyItemId = useRef(0);
  const fieldRefs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>>({});
  const allergyReloadButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchText.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const patientSearch = usePatientSearch(debouncedSearch, apiClient);
  const patientAllergy = usePatientAllergy(selectedPatient?.id ?? null, apiClient);
  const allergyContext = patientAllergy.data?.patient.id === selectedPatient?.id ? patientAllergy.data : undefined;
  const allergyAuthorityReloadPending = allergyReconfirmationState === "reloading" || allergyReconfirmationState === "reload-failed";
  const cachedAllergyAuthorityFailed = Boolean(selectedPatient && allergyContext && patientAllergy.isError);
  const allergyContextPending = selectedPatient !== null && (!allergyContext || patientAllergy.isFetching || cachedAllergyAuthorityFailed || allergyAuthorityReloadPending);
  const allergyChangeReasonRequired = requiresAllergyChangeReason(allergyContext?.allergy, allergyDraft);
  const reportedAllergyItemsValid = hasValidReportedAllergyItems(allergyDraft);

  useEffect(() => {
    const selectedPatientId = selectedPatient?.id ?? null;
    if (selectedPatientIdRef.current === selectedPatientId) return;
    selectedPatientIdRef.current = selectedPatientId;
    allergyReloadRequest.current += 1;
  }, [selectedPatient]);

  useEffect(() => {
    if (!selectedPatient) {
      loadedAllergyAuthority.current = null;
      return;
    }
    if (!allergyContext) return;
    const nextAuthority = {
      patientId: allergyContext.patient.id,
      patientRevision: allergyContext.patient.revision,
      allergyRevision: allergyContext.allergy.revision,
    };
    const previousAuthority = loadedAllergyAuthority.current;
    if (
      previousAuthority?.patientId === nextAuthority.patientId &&
      previousAuthority.patientRevision === nextAuthority.patientRevision &&
      previousAuthority.allergyRevision === nextAuthority.allergyRevision
    ) return;
    loadedAllergyAuthority.current = nextAuthority;
    if (!previousAuthority || previousAuthority.patientId !== nextAuthority.patientId) {
      nextAllergyItemId.current = allergyContext.allergy.items.length;
      setAllergyDraft(intakeAllergyDraftFromContext(allergyContext));
      return;
    }
    setAllergyDraft((current) => ({ ...current, answer: null }));
    setSubmitAttempt(null);
    setRetryAttempt(null);
  }, [allergyContext, selectedPatient]);

  useEffect(() => {
    if (!selectedPatient || !allergyContext || !patientAllergy.isError) return;
    const patientId = selectedPatient.id;
    queueMicrotask(() => {
      if (selectedPatientIdRef.current !== patientId) return;
      setAllergyDraft((current) => ({ ...current, answer: null }));
      setSubmitAttempt(null);
      setRetryAttempt(null);
      setSummaryError(null);
      setActiveVisit(false);
      setAllergyReconfirmationState("reload-failed");
    });
  }, [allergyContext, patientAllergy.isError, selectedPatient]);

  const generateMutation = useMutation({
    mutationFn: (attempt: SyntheticPatientAttempt) => createSyntheticPatient(apiClient, attempt),
    onSuccess: (result, attempt) => {
      if (generateAttemptRef.current !== attempt) return;
      setSelectedPatient(result.data);
      setSearchText("");
      setDebouncedSearch("");
      setGenerateAttempt(null);
      generateAttemptRef.current = null;
      loadedAllergyAuthority.current = null;
      nextAllergyItemId.current = 0;
      setAllergyDraft(initialIntakeAllergyDraft);
      setSubmitAttempt(null);
      setRetryAttempt(null);
      setFieldErrors({});
      setActiveVisit(false);
      selectedPatientIdRef.current = result.data.id;
      allergyReloadRequest.current += 1;
      setAllergyReconfirmationState("idle");
      setSummaryError(null);
    },
  });
  const submitMutation = useSubmitIntake(apiClient);

  useEffect(() => {
    if (!submitMutation.isSuccess) return;
    navigate("/queue", { replace: true });
  }, [navigate, submitMutation.isSuccess]);

  async function reloadAllergyContext(patientId: string): Promise<void> {
    const reloadRequest = ++allergyReloadRequest.current;
    setAllergyReconfirmationState("reloading");
    const reload = await patientAllergy.refetch();
    if (allergyReloadRequest.current !== reloadRequest || selectedPatientIdRef.current !== patientId) return;
    if (reload.isSuccess && reload.data?.patient.id === patientId) {
      setAllergyDraft((current) => ({ ...current, answer: null }));
      setSubmitAttempt(null);
      setRetryAttempt(null);
      setSummaryError(null);
      setActiveVisit(false);
      setAllergyReconfirmationState("reconfirmation-required");
      return;
    }
    setAllergyReconfirmationState("reload-failed");
  }

  async function handleSubmitError(error: unknown, attempt: IntakeAttempt): Promise<void> {
    const apiError = describeError(error);
    setActiveVisit(apiError.code === "ACTIVE_VISIT_EXISTS");
    if (apiError.status === 409 && apiError.code === "REVISION_CONFLICT") {
      setSummaryError(null);
      setSubmitAttempt(null);
      setRetryAttempt(null);
      setAllergyDraft((current) => ({ ...current, answer: null }));
      const patientId = selectedPatientIdRef.current;
      if (patientId) await reloadAllergyContext(patientId);
      return;
    }
    setAllergyReconfirmationState("idle");
    setSummaryError(apiError.messageTh || "ยังบันทึกไม่ได้");
    setRetryAttempt(attempt);
    if (apiError.status === 422 && apiError.fieldErrors) {
      const mapped = Object.fromEntries(
        Object.entries(apiError.fieldErrors)
          .map(([key, message]) => [normalizeFieldKey(key), message] as const)
          .filter(([key]) => key !== null),
      ) as Record<string, string>;
      setFieldErrors(mapped);
    }
  }

  useEffect(() => {
    const firstKey = Object.keys(fieldErrors)
      .filter((key) => fieldErrors[key])
      .sort((left, right) => fieldErrorRank(left) - fieldErrorRank(right))[0];
    if (!firstKey) return;
    const element = fieldRefs.current[firstKey];
    if (!element) return;
    const frame = window.requestAnimationFrame(() => element.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [fieldErrors]);

  useEffect(() => {
    const target = allergyReconfirmationState === "reconfirmation-required"
      ? allergyContextPending ? null : fieldRefs.current["allergy.answer"]
      : allergyReconfirmationState === "reload-failed" ? allergyReloadButtonRef.current : null;
    if (!target) return;
    const frame = window.requestAnimationFrame(() => target.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [allergyContextPending, allergyReconfirmationState]);

  const setDraftValue = (key: keyof IntakeDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSubmitAttempt(null);
    setRetryAttempt(null);
    if (fieldErrors[key]) setFieldErrors((current) => ({ ...current, [key]: "" }));
    setSummaryError(null);
    setActiveVisit(false);
  };

  const clearAllergyErrors = () => {
    setFieldErrors((current) => Object.fromEntries(
      Object.entries(current).filter(([key]) => !key.startsWith("allergy.")),
    ));
  };

  const invalidateAllergyAttempt = () => {
    setSubmitAttempt(null);
    setRetryAttempt(null);
    setSummaryError(null);
    setActiveVisit(false);
  };

  const setAllergyAnswer = (answer: "NO" | "YES") => {
    const firstItem = answer === "YES" && allergyDraft.items.length === 0
      ? { key: `new-${nextAllergyItemId.current++}`, substance: "", reaction: "", severity: "UNKNOWN" as const, note: "" }
      : null;
    setAllergyDraft((current) => ({
      ...current,
      answer,
      items: firstItem ? [firstItem] : current.items,
    }));
    setAllergyReconfirmationState("idle");
    clearAllergyErrors();
    invalidateAllergyAttempt();
  };

  const updateAllergyItem = (key: string, patch: Partial<IntakeAllergyDraft["items"][number]>) => {
    setAllergyDraft((current) => ({
      ...current,
      items: current.items.map((item) => item.key === key ? { ...item, ...patch } : item),
    }));
    clearAllergyErrors();
    invalidateAllergyAttempt();
  };

  const addAllergyItem = () => {
    if (allergyDraft.items.length >= 20) return;
    const item = { key: `new-${nextAllergyItemId.current++}`, substance: "", reaction: "", severity: "UNKNOWN" as const, note: "" };
    setAllergyDraft((current) => ({ ...current, items: [...current.items, item] }));
    clearAllergyErrors();
    invalidateAllergyAttempt();
  };

  const removeAllergyItem = (key: string) => {
    if (allergyDraft.items.length <= 1) return;
    setAllergyDraft((current) => ({ ...current, items: current.items.filter((item) => item.key !== key) }));
    clearAllergyErrors();
    invalidateAllergyAttempt();
  };

  const setAllergyChangeReason = (changeReason: string) => {
    setAllergyDraft((current) => ({ ...current, changeReason }));
    clearAllergyErrors();
    invalidateAllergyAttempt();
  };

  function choosePatient(patient: PatientDto): void {
    if (submitPending || generationPending) return;
    if (selectedPatient?.id === patient.id) return;
    if (hasDraftValues(draft) && selectedPatient && typeof window !== "undefined") {
      const confirmed = window.confirm("เปลี่ยนผู้ป่วยและล้างความพยายามสร้างผู้ป่วยสังเคราะห์หรือไม่");
      if (!confirmed) return;
    }
    setSelectedPatient(patient);
    selectedPatientIdRef.current = patient.id;
    allergyReloadRequest.current += 1;
    loadedAllergyAuthority.current = null;
    nextAllergyItemId.current = 0;
    setAllergyDraft(initialIntakeAllergyDraft);
    setGenerateAttempt(null);
    generateAttemptRef.current = null;
    setSubmitAttempt(null);
    setRetryAttempt(null);
    setFieldErrors({});
    setSummaryError(null);
    setActiveVisit(false);
    setAllergyReconfirmationState("idle");
    setSearchText("");
    setDebouncedSearch("");
  }

  function createPatient(): void {
    const creatingNewAttempt = !generateAttempt;
    if (creatingNewAttempt && selectedPatient && hasDraftValues(draft) && typeof window !== "undefined") {
      const confirmed = window.confirm("สร้างผู้ป่วยใหม่และล้างความพยายามส่ง Intake เดิมหรือไม่");
      if (!confirmed) return;
    }
    const attempt = generateAttempt ?? createCommandAttempt<Record<string, never>, Record<string, never>>({}, {});
    if (creatingNewAttempt) {
      setGenerateAttempt(attempt);
      generateAttemptRef.current = attempt;
      setSubmitAttempt(null);
      setRetryAttempt(null);
      setFieldErrors({});
      setActiveVisit(false);
      setSummaryError(null);
    }
    generateMutation.mutate(attempt);
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setSummaryError(null);
    setActiveVisit(false);
    setFieldErrors({});
    if (!selectedPatient) {
      setSummaryError("กรุณาค้นหาหรือสร้างผู้ป่วยสังเคราะห์ก่อนส่งเข้าคิว");
      return;
    }
    if (!allergyContext || allergyContextPending || allergyDraft.answer === null || !reportedAllergyItemsValid || (allergyChangeReasonRequired && !allergyDraft.changeReason.trim())) {
      setSummaryError("กรุณาโหลดและยืนยันข้อมูลแพ้ยาก่อนส่งเข้าคิว");
      return;
    }
    const attempt = submitAttempt ?? createIntakeAttempt(allergyContext, draft, allergyDraft);
    if (!submitAttempt) setSubmitAttempt(attempt);
    submitMutation.mutate(attempt, {
      onError: (error) => {
        void handleSubmitError(error, attempt);
      },
    });
  }

  const error = describeError(submitMutation.error);
  const generatedError = generateMutation.error ? describeError(generateMutation.error) : null;
  const searchError = patientSearch.error ? describeError(patientSearch.error) : null;
  const searchResults = debouncedSearch.length >= 2 ? patientSearch.data ?? [] : [];
  const submitPending = submitMutation.isPending;
  const generationPending = generateMutation.isPending;

  return (
    <div className="flow-page intake-page">
      <PageHeader
        eyebrow="ASSISTANT WORKSPACE · PATIENT INTAKE"
        title="ลงทะเบียนผู้ป่วยและซักประวัติ"
        description="ค้นหาหรือสร้างผู้ป่วย บันทึกสัญญาณชีพ แล้วส่งพบแพทย์"
      />

      {summaryError || allergyReconfirmationState !== "idle" ? (
        <div className={`intake-error-summary ${activeVisit ? "intake-error-active" : ""}`} role="alert" aria-live="assertive">
          <strong>{allergyReconfirmationState === "reconfirmation-required" ? "ข้อมูลแพ้ยาเปลี่ยนแปลงแล้ว" : allergyReconfirmationState === "reloading" || allergyReconfirmationState === "reload-failed" ? "ข้อมูลแพ้ยาอาจเปลี่ยนแปลงแล้ว" : activeVisit ? "ผู้ป่วยมีคิวที่กำลังดำเนินการ" : error.status === 0 || error.status >= 500 ? "ยังบันทึกไม่ได้" : "กรุณาตรวจสอบข้อมูล"}</strong>
          <span>{allergyReconfirmationState === "reconfirmation-required" ? "โหลดข้อมูลล่าสุดแล้ว กรุณายืนยันคำตอบประวัติแพ้ยาอีกครั้ง" : allergyReconfirmationState === "reloading" ? "กำลังโหลดข้อมูลแพ้ยาล่าสุด" : allergyReconfirmationState === "reload-failed" ? "ยังโหลดข้อมูลแพ้ยาล่าสุดไม่สำเร็จ กรุณาลองโหลดอีกครั้งก่อนยืนยันคำตอบ" : summaryError}</span>
          {activeVisit ? <Link className="queue-recovery-link" to="/queue">โหลดคิวล่าสุด</Link> : null}
          {allergyReconfirmationState === "reload-failed" && selectedPatient ? (
            <button ref={allergyReloadButtonRef} className="inline-retry-button" type="button" onClick={() => void reloadAllergyContext(selectedPatient.id)} disabled={patientAllergy.isFetching}>
              {patientAllergy.isFetching ? "กำลังโหลด…" : "โหลดข้อมูลแพ้ยาล่าสุดอีกครั้ง"}
            </button>
          ) : null}
          {retryAttempt && (error.status === 0 || error.status >= 500) ? (
            <button className="inline-retry-button" type="button" onClick={() => submitMutation.mutate(retryAttempt, {
              onError: (nextError) => {
                void handleSubmitError(nextError, retryAttempt);
              },
            })} disabled={submitPending}>
              {submitPending ? "กำลังลองใหม่…" : "ลองบันทึกอีกครั้ง"}
            </button>
          ) : null}
        </div>
      ) : null}

      <form className="intake-layout" onSubmit={submit} noValidate>
        <Card className="intake-card patient-selection-card">
          <SectionHeading icon={UserPlus} title="ผู้ป่วยสังเคราะห์" description="ค้นหาผู้ป่วยที่มีอยู่ หรือให้ระบบสร้างตัวอย่างใหม่" />
          <div className="patient-search-row">
            <label className="field" htmlFor="patient-search">
              <span className="field-label">ค้นหาผู้ป่วยสังเคราะห์</span>
              <span className="patient-search-input-wrap">
                <Search aria-hidden="true" size={18} />
                <input
                  id="patient-search"
                  className="care-input patient-search-input"
                  value={searchText}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchText(event.target.value)}
                  placeholder="ค้นหา HN หรือชื่อผู้ป่วยทดสอบ"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={generationPending || submitPending}
                />
              </span>
              <span className="field-hint">เริ่มค้นหาเมื่อพิมพ์อย่างน้อย 2 ตัวอักษร</span>
            </label>
            <ActionButton
              type="button"
              variant="secondary"
              icon={Sparkles}
              onClick={createPatient}
              disabled={generationPending || submitPending}
            >
              {generationPending ? "กำลังสร้าง…" : generateAttempt ? "ลองสร้างอีกครั้ง" : "สร้างผู้ป่วยสังเคราะห์"}
            </ActionButton>
          </div>
          <p className="synthetic-generation-note">ระบบจะสร้างเลข HN ชื่อ และข้อมูลประชากรสังเคราะห์ให้โดยอัตโนมัติ ไม่มีการกรอกข้อมูลผู้ป่วยจริง</p>
          {generatedError ? <p className="field-error" role="status">{generatedError.messageTh}</p> : null}

          {debouncedSearch.length >= 2 && patientSearch.isError ? (
            <div className="intake-error-summary patient-search-error" role="alert" aria-live="polite">
              <strong>ค้นหาผู้ป่วยไม่สำเร็จ</strong>
              <span>{searchError?.messageTh ?? "ไม่สามารถค้นหาผู้ป่วยได้ กรุณาลองใหม่อีกครั้ง"}</span>
              <button className="inline-retry-button" type="button" onClick={() => void patientSearch.refetch()} disabled={patientSearch.isFetching}>
                {patientSearch.isFetching ? "กำลังค้นหา…" : "ลองค้นหาอีกครั้ง"}
              </button>
            </div>
          ) : searchResults.length > 0 ? (
            <div className="patient-search-results" aria-label="ผลการค้นหาผู้ป่วย">
              {searchResults.map((result) => <SyntheticSearchResult key={result.id} patient={result} onSelect={choosePatient} disabled={generationPending || submitPending} />)}
            </div>
          ) : debouncedSearch.length >= 2 && !patientSearch.isFetching && !patientSearch.error ? (
            <p className="patient-search-empty">ไม่พบผู้ป่วยสังเคราะห์ที่ตรงกับคำค้นหา</p>
          ) : null}

          {selectedPatient ? (
            <div className="selected-patient-panel">
              <PatientHeader patient={selectedPatient} status="พร้อมรับเข้าคิว" statusTone="success" />
              <p className="selected-patient-revision">ข้อมูลจากระบบ · revision {selectedPatient.revision}</p>
            </div>
          ) : (
            <div className="patient-selection-empty">
              <UserPlus aria-hidden="true" size={22} />
              <span>เลือกหรือสร้างผู้ป่วยสังเคราะห์เพื่อเริ่มบันทึก Intake</span>
            </div>
          )}
        </Card>

        <Card className="intake-card intake-allergy-panel">
          <IntakeAllergyCard
            assessment={allergyContext?.allergy}
            draft={allergyDraft}
            fieldErrors={fieldErrors}
            disabled={!selectedPatient || allergyContextPending || submitPending}
            onAnswerChange={setAllergyAnswer}
            onItemChange={updateAllergyItem}
            onAddItem={addAllergyItem}
            onRemoveItem={removeAllergyItem}
            onChangeReasonChange={setAllergyChangeReason}
            onRegisterField={(key, element) => { fieldRefs.current[key] = element; }}
          />
          {selectedPatient && patientAllergy.error && allergyReconfirmationState === "idle" ? (
            <div className="intake-error-summary intake-allergy-context-error" role="alert">
              <strong>โหลดข้อมูลแพ้ยาไม่สำเร็จ</strong>
              <span>{describeError(patientAllergy.error).messageTh}</span>
              <button className="inline-retry-button" type="button" onClick={() => void patientAllergy.refetch()} disabled={patientAllergy.isFetching}>
                {patientAllergy.isFetching ? "กำลังโหลด…" : "ลองโหลดอีกครั้ง"}
              </button>
            </div>
          ) : null}
        </Card>

        <Card className="intake-card">
          <SectionHeading icon={ClipboardPlus} title="สัญญาณชีพและอาการ" description="กรอกข้อมูลสำคัญก่อนพบแพทย์" />
          {!selectedPatient ? <p className="intake-form-hint">กรุณาเลือกผู้ป่วยด้านบนก่อนกรอกข้อมูล</p> : null}
          <div className="form-grid vital-grid">
            {vitalFields.map((field) => (
              <label className="field" htmlFor={field.key} key={field.key}>
                <span className="field-label">{field.label}</span>
                <input
                  id={field.key}
                  ref={(element) => { fieldRefs.current[field.key] = element; }}
                  className={`care-input ${fieldErrors[field.key] ? "input-error" : ""}`}
                  type="number"
                  inputMode="decimal"
                  step={field.step}
                  placeholder={field.placeholder}
                  value={draft[field.key]}
                  onChange={(event) => setDraftValue(field.key, event.target.value)}
                  disabled={!selectedPatient || submitPending}
                  aria-invalid={fieldErrors[field.key] ? true : undefined}
                />
                {fieldErrors[field.key] ? <span className="field-error">{fieldErrors[field.key]}</span> : null}
              </label>
            ))}
          </div>
          <div className="form-spacer">
            <label className="field" htmlFor="chiefComplaint">
              <span className="field-label">อาการสำคัญ *</span>
              <textarea
                id="chiefComplaint"
                ref={(element) => { fieldRefs.current.chiefComplaint = element; }}
                className={`care-input care-textarea ${fieldErrors.chiefComplaint ? "input-error" : ""}`}
                value={draft.chiefComplaint}
                onChange={(event) => setDraftValue("chiefComplaint", event.target.value)}
                placeholder="อาการที่มาพบแพทย์ ระยะเวลา และข้อมูลสำคัญ"
                disabled={!selectedPatient || submitPending}
                aria-invalid={fieldErrors.chiefComplaint ? true : undefined}
              />
              {fieldErrors.chiefComplaint ? <span className="field-error">{fieldErrors.chiefComplaint}</span> : null}
            </label>
          </div>
          <div className="form-actions">
            <ActionButton type="submit" icon={Send} disabled={!selectedPatient || !allergyContext || allergyContextPending || allergyDraft.answer === null || !reportedAllergyItemsValid || (allergyChangeReasonRequired && !allergyDraft.changeReason.trim()) || submitPending || generationPending}>
              {submitPending ? "กำลังส่งเข้าคิว…" : "ส่งพบแพทย์"}
            </ActionButton>
          </div>
        </Card>
      </form>
    </div>
  );
}
