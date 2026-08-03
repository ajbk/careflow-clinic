import { useMutation } from "@tanstack/react-query";
import { ClipboardPlus, Search, Send, Sparkles, UserPlus } from "lucide-react";
import type { ChangeEvent, FormEvent, ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { PatientDto } from "../../shared/contracts";
import { PatientHeader } from "../components/careflow/PatientHeader";
import { ActionButton, Card, PageHeader, SectionHeading } from "../components/careflow/ui";
import { createSyntheticPatient, type SyntheticPatientAttempt, usePatientSearch } from "../features/patients";
import {
  createIntakeAttempt,
  initialIntakeDraft,
  type IntakeAttempt,
  type IntakeDraft,
  useSubmitIntake,
  vitalFields,
} from "../features/intake";
import { ApiClient, apiClient as defaultApiClient } from "../lib/api-client";
import { ApiError, isApiError, serverUnavailableError } from "../lib/api-error";
import { createCommandAttempt } from "../lib/idempotency";

const fieldOrder = [
  "chiefComplaint",
  "temperatureC",
  "systolicMmhg",
  "diastolicMmhg",
  "heartRateBpm",
  "spo2Percent",
  "weightKg",
  "heightCm",
] as const;

type FieldKey = (typeof fieldOrder)[number];

function normalizeFieldKey(key: string): FieldKey | null {
  const normalized = key
    .replace(/^payload\./, "")
    .replace(/^vitals\./, "");
  return (fieldOrder as readonly string[]).includes(normalized) ? normalized as FieldKey : null;
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [activeVisit, setActiveVisit] = useState(false);
  const [generateAttempt, setGenerateAttempt] = useState<SyntheticPatientAttempt | null>(null);
  const [submitAttempt, setSubmitAttempt] = useState<IntakeAttempt | null>(null);
  const [retryAttempt, setRetryAttempt] = useState<IntakeAttempt | null>(null);
  const generateAttemptRef = useRef<SyntheticPatientAttempt | null>(null);
  const fieldRefs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({});

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchText.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const patientSearch = usePatientSearch(debouncedSearch, apiClient);
  const generateMutation = useMutation({
    mutationFn: (attempt: SyntheticPatientAttempt) => createSyntheticPatient(apiClient, attempt),
    onSuccess: (result, attempt) => {
      if (generateAttemptRef.current !== attempt) return;
      setSelectedPatient(result.data);
      setSearchText("");
      setDebouncedSearch("");
      setGenerateAttempt(null);
      generateAttemptRef.current = null;
      setSubmitAttempt(null);
      setRetryAttempt(null);
      setFieldErrors({});
      setActiveVisit(false);
      setSummaryError(null);
    },
  });
  const submitMutation = useSubmitIntake(apiClient);

  useEffect(() => {
    if (!submitMutation.isSuccess) return;
    navigate("/queue", { replace: true });
  }, [navigate, submitMutation.isSuccess]);

  function handleSubmitError(error: unknown): void {
    const apiError = describeError(error);
    setActiveVisit(apiError.code === "ACTIVE_VISIT_EXISTS");
    setSummaryError(apiError.messageTh || "ยังบันทึกไม่ได้");
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
    const firstKey = fieldOrder.find((key) => fieldErrors[key]);
    if (!firstKey) return;
    const element = fieldRefs.current[firstKey];
    if (!element) return;
    const frame = window.requestAnimationFrame(() => element.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [fieldErrors]);

  const setDraftValue = (key: keyof IntakeDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSubmitAttempt(null);
    setRetryAttempt(null);
    if (fieldErrors[key]) setFieldErrors((current) => ({ ...current, [key]: "" }));
    setSummaryError(null);
    setActiveVisit(false);
  };

  function choosePatient(patient: PatientDto): void {
    if (submitPending || generationPending) return;
    if (selectedPatient?.id === patient.id) return;
    if (hasDraftValues(draft) && selectedPatient && typeof window !== "undefined") {
      const confirmed = window.confirm("เปลี่ยนผู้ป่วยและล้างความพยายามสร้างผู้ป่วยสังเคราะห์หรือไม่");
      if (!confirmed) return;
    }
    setSelectedPatient(patient);
    setGenerateAttempt(null);
    generateAttemptRef.current = null;
    setSubmitAttempt(null);
    setRetryAttempt(null);
    setFieldErrors({});
    setSummaryError(null);
    setActiveVisit(false);
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
    const attempt = submitAttempt ?? createIntakeAttempt(selectedPatient, draft);
    if (!submitAttempt) setSubmitAttempt(attempt);
    submitMutation.mutate(attempt, {
      onError: (error) => {
        setRetryAttempt(attempt);
        handleSubmitError(error);
      },
    });
  }

  const error = describeError(submitMutation.error);
  const generatedError = generateMutation.error ? describeError(generateMutation.error) : null;
  const searchResults = debouncedSearch.length >= 2 ? patientSearch.data ?? [] : [];
  const submitPending = submitMutation.isPending;
  const generationPending = generateMutation.isPending;

  return (
    <div className="flow-page intake-page">
      <PageHeader
        eyebrow="PATIENT INTAKE"
        title="รับผู้ป่วย"
        description="บันทึกข้อมูลที่จำเป็นก่อนส่งเข้าคิวแพทย์"
      />

      {summaryError ? (
        <div className={`intake-error-summary ${activeVisit ? "intake-error-active" : ""}`} role="alert" aria-live="assertive">
          <strong>{activeVisit ? "ผู้ป่วยมีคิวที่กำลังดำเนินการ" : error.status === 0 || error.status >= 500 ? "ยังบันทึกไม่ได้" : "กรุณาตรวจสอบข้อมูล"}</strong>
          <span>{summaryError}</span>
          {activeVisit ? <Link className="queue-recovery-link" to="/queue">โหลดคิวล่าสุด</Link> : null}
          {retryAttempt && (error.status === 0 || error.status >= 500) ? (
            <button className="inline-retry-button" type="button" onClick={() => submitMutation.mutate(retryAttempt, {
              onError: (nextError) => {
                setRetryAttempt(retryAttempt);
                handleSubmitError(nextError);
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

          {searchResults.length > 0 ? (
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
            <ActionButton type="submit" icon={Send} disabled={!selectedPatient || submitPending || generationPending}>
              {submitPending ? "กำลังส่งเข้าคิว…" : "ส่งพบแพทย์"}
            </ActionButton>
          </div>
        </Card>
      </form>
    </div>
  );
}
