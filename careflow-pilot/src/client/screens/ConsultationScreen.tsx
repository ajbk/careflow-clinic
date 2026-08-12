import { ClipboardCheck, FileSignature, LockKeyhole, Stethoscope } from "lucide-react";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { Link, useParams } from "react-router-dom";
import { clinicalNoteDraftInputSchema, medicationDecisionDraftInputSchema, type ClinicalNoteDraftInput, type JourneyAction, type MedicationDecisionDraftInput, type PatientSnapshotDto, type ReviewAllergyPayload, type SignClinicalNoteAmendmentBody, type SnapshotSource, type VisitWorkspaceDto } from "../../shared/contracts";
import { useAuth } from "../auth/AuthProvider";
import { AllergyReviewDialog } from "../components/careflow/AllergyReviewDialog";
import { ClinicalNoteEditor } from "../components/careflow/ClinicalNoteEditor";
import { JourneyAuthorityBanner, JourneyNextTaskCard } from "../components/careflow/JourneyNextTaskCard";
import { MedicationDecisionEditor } from "../components/careflow/MedicationDecisionEditor";
import { MedicationDecisionRevisionDialog } from "../components/careflow/MedicationDecisionRevisionDialog";
import { SignedClinicalEvidence } from "../components/careflow/SignedClinicalEvidence";
import { VisitJourneyRibbon } from "../components/careflow/VisitJourneyRibbon";
import { ActionButton, Card, PageHeader, SectionHeading, StatusBadge, TextAreaField } from "../components/careflow/ui";
import { allergySeverityLabelTh, allergyStateLabelTh, createReviewAllergyAttempt, useReviewAllergy } from "../features/allergy";
import { createFinalizeAttempt, createSaveDraftAttempt, type ConsultationFormValue, useAmendClinicalNote, useFinalizeConsultation, useReviseMedicationDecision, useSaveConsultationDraft } from "../features/clinical";
import { journeyAuthorityUnavailable, useVisitJourney } from "../features/journey";
import { createStartConsultationAttempt, useStartConsultation, useVisitWorkspace, type StartConsultationAttempt } from "../features/visit";
import { isApiError } from "../lib/api-error";
import { createCommandAttempt, type CommandAttempt } from "../lib/idempotency";
import { formatThaiDateTime } from "../lib/thai-date";

const blankNote: ClinicalNoteDraftInput = { subjective: "", objective: "", assessment: "", plan: "", diagnoses: [""] };
const blankValue: ConsultationFormValue = { note: blankNote, medicationDecision: { kind: "UNDECIDED" } };
function workspaceDraftStamp(data: VisitWorkspaceDto) { return `${data.visit.id}:${data.consultationDraft.note?.revision ?? 0}:${data.consultationDraft.medicationDecision?.revision ?? 0}`; }
function formValue(data: VisitWorkspaceDto): ConsultationFormValue {
  const note = data.consultationDraft.note;
  const decision = data.consultationDraft.medicationDecision;
  return {
    note: note ? { subjective: note.subjective, objective: note.objective, assessment: note.assessment, plan: note.plan, diagnoses: note.diagnoses.length ? note.diagnoses : [""] } : blankNote,
    medicationDecision: !decision || decision.kind === "UNDECIDED" ? { kind: "UNDECIDED" } : decision.kind === "NO_MEDICATION" ? { kind: "NO_MEDICATION", noMedicationReason: decision.noMedicationReason } : { kind: "ORDER", items: decision.items.map((item) => ({ medicationId: item.medication.id, medicationRevision: item.medication.revision, quantity: item.quantity, directionsTh: item.directionsTh })) },
  };
}
function saveableValue(value: ConsultationFormValue): ConsultationFormValue {
  return { ...value, note: { ...value.note, diagnoses: value.note.diagnoses.filter((diagnosis) => diagnosis.trim().length > 0) } };
}
function formFingerprint(value: ConsultationFormValue) { return JSON.stringify(value); }
function decisionValid(value: MedicationDecisionDraftInput) { return value.kind === "ORDER" ? value.items.length > 0 && value.items.every((item) => item.quantity >= 1 && item.directionsTh.trim().length > 0) : value.kind === "NO_MEDICATION" && value.noMedicationReason.trim().length > 0; }
function noteValidForSigning(value: ClinicalNoteDraftInput) { return clinicalNoteDraftInputSchema.safeParse(value).success && [value.subjective, value.objective, value.assessment, value.plan].every((field) => field.trim().length > 0) && value.diagnoses.length > 0; }
function message(error: unknown) { return isApiError(error) ? error.messageTh : "ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองใหม่อีกครั้ง"; }
function vital(value: number | null, suffix = "") { return value === null ? "—" : `${value}${suffix}`; }
function sourceBadge(source: SnapshotSource | null, label = "แหล่งข้อมูล"): ReactElement | null {
  if (!source) return null;
  return <div className="snapshot-source"><span>{label} {source.type} · ID {source.id}</span><time dateTime={source.occurredAt}>{formatThaiDateTime(source.occurredAt)}</time></div>;
}
function snapshotValue(values: string[]) {
  return values.length > 0 ? <ul>{values.map((item) => <li key={item}>{item}</li>)}</ul> : <span>ไม่มีข้อมูล</span>;
}
function allergySource(snapshot: PatientSnapshotDto): SnapshotSource | null {
  const allergy = snapshot.allergy;
  return allergy.id && allergy.reviewedAt ? { type: "ALLERGY_REVIEW", id: allergy.id, occurredAt: allergy.reviewedAt } : null;
}
function PatientSnapshot({ snapshot }: { snapshot: PatientSnapshotDto }): ReactElement {
  const allergy = snapshot.allergy;
  const allergyDetails = allergy.state === "PRESENT"
    ? <ul>{allergy.items.map((item) => <li key={`${item.substance}-${item.reaction}`}><strong>{item.substance} · {item.reaction}</strong><span>ความรุนแรง {allergySeverityLabelTh(item.severity)}</span>{item.note ? <span>หมายเหตุ {item.note}</span> : null}</li>)}</ul>
    : allergy.state === "NONE_KNOWN" ? <span>ไม่พบประวัติแพ้ที่ยืนยัน</span> : <span>ยังไม่ทราบข้อมูล</span>;
  const allergyProvenance = allergy.revision > 0 ? <div className="snapshot-allergy-provenance"><span>ผู้ให้ข้อมูล {allergy.sourceText ?? "ยังไม่ทราบข้อมูล"}</span><span>เหตุผล {allergy.reason ?? "ยังไม่ทราบข้อมูล"}</span>{allergy.reviewedBy ? <span>ผู้ทบทวน {allergy.reviewedBy.displayName}</span> : null}{allergy.reviewedAt ? <time dateTime={allergy.reviewedAt}>ทบทวนเมื่อ {formatThaiDateTime(allergy.reviewedAt)}</time> : null}</div> : null;
  const facts = [
    { label: "ปัญหาสำคัญ", fact: snapshot.activeProblems },
    { label: "บริบทยาปัจจุบัน", fact: snapshot.currentMedicationContext },
    { label: "แผนล่าสุดที่เกี่ยวข้อง", fact: snapshot.latestRelevantPlan },
    { label: "ติดตามต่อไป", fact: snapshot.pendingFollowUp },
  ] as const;
  return <section className="patient-snapshot care-card" aria-label="Patient Snapshot">
    <div className="snapshot-heading"><div><p className="page-eyebrow">PATIENT CONTEXT</p><h2>Patient Snapshot</h2></div><span>ข้อมูลอ้างอิง</span></div>
    <article className="snapshot-fact"><div className="snapshot-fact-header"><span>ประวัติแพ้ยา</span><StatusBadge tone={allergy.state === "UNKNOWN" ? "waiting" : allergy.state === "PRESENT" ? "error" : "success"}>{allergyStateLabelTh(allergy.state)}</StatusBadge></div><div className="snapshot-fact-value">{allergyDetails}</div>{allergyProvenance}{sourceBadge(allergySource(snapshot))}</article>
    {facts.map(({ label, fact }) => <article className="snapshot-fact" key={label}><div className="snapshot-fact-header"><span>{label}</span><StatusBadge tone={fact.state === "UNKNOWN" ? "waiting" : "info"}>{fact.state}</StatusBadge></div><div className="snapshot-fact-value">{fact.state === "UNKNOWN" ? <span>ยังไม่ทราบข้อมูล</span> : Array.isArray(fact.value) ? snapshotValue(fact.value) : <p>{fact.value}</p>}</div>{sourceBadge(fact.source)}</article>)}
    <article className="snapshot-fact snapshot-visits"><div className="snapshot-fact-header"><span>ประวัติ Visit ล่าสุด</span><StatusBadge tone={snapshot.recentVisits.length > 0 ? "info" : "waiting"}>{snapshot.recentVisits.length > 0 ? `${snapshot.recentVisits.length} รายการ` : "UNKNOWN"}</StatusBadge></div>{snapshot.recentVisits.length > 0 ? <ul>{snapshot.recentVisits.map((recent) => <li key={recent.visitId}><strong>Visit {recent.visitId}</strong><span>Clinical Note source</span><span>{recent.diagnoses.join(", ")}</span><span>{recent.plan}</span>{sourceBadge({ type: "CLINICAL_NOTE", id: recent.noteId, occurredAt: recent.signedAt })}</li>)}</ul> : <span>ยังไม่ทราบข้อมูล</span>}</article>
  </section>;
}

function ConsultationWorkspace({ visitId }: { visitId: string }): ReactElement {
  const auth = useAuth(); const workspace = useVisitWorkspace(visitId);
  const journey = useVisitJourney(visitId);
  const save = useSaveConsultationDraft(); const finalize = useFinalizeConsultation(); const start = useStartConsultation(); const allergy = useReviewAllergy(); const amend = useAmendClinicalNote(); const revise = useReviseMedicationDecision();
  const [value, setValue] = useState<ConsultationFormValue>(blankValue); const [stamp, setStamp] = useState(""); const [dirty, setDirty] = useState(false); const [conflict, setConflict] = useState(false); const [startBlocked, setStartBlocked] = useState(false); const [allergyBlocked, setAllergyBlocked] = useState(false); const [showAllergy, setShowAllergy] = useState(false); const [showConfirm, setShowConfirm] = useState(false); const [evidenceAction, setEvidenceAction] = useState<"amend" | "revise" | null>(null); const [amendment, setAmendment] = useState({ content: "", reason: "" });
  const saveAttempt = useRef<ReturnType<typeof createSaveDraftAttempt> | null>(null); const finalizeAttempt = useRef<ReturnType<typeof createFinalizeAttempt> | null>(null); const startAttempt = useRef<StartConsultationAttempt | null>(null); const startInFlight = useRef(false); const allergyAttempt = useRef<ReturnType<typeof createReviewAllergyAttempt> | null>(null); const allergyFingerprint = useRef(""); const amendmentAttempt = useRef<CommandAttempt<SignClinicalNoteAmendmentBody["payload"], SignClinicalNoteAmendmentBody["expectedRevisions"]> | null>(null); const confirmRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!workspace.data) return;
    const next = workspaceDraftStamp(workspace.data);
    if (next === stamp) return;
    const serverValue = formValue(workspace.data);
    queueMicrotask(() => {
      saveAttempt.current = null;
      finalizeAttempt.current = null;
      setStamp(next);
      if (stamp && dirty && formFingerprint(serverValue) !== formFingerprint(value)) {
        setConflict(true);
        return;
      }
      setValue(serverValue);
      setDirty(false);
      setConflict(false);
    });
  }, [dirty, stamp, value, workspace.data]);
  useEffect(() => { if (showConfirm) confirmRef.current?.focus(); }, [showConfirm]);
  if (workspace.isPending) return <div className="flow-page consultation-page"><PageHeader eyebrow="DOCTOR WORKSPACE" title="ห้องตรวจ" /><Card><div className="consultation-skeleton" /></Card></div>;
  if (!workspace.data) return <div className="flow-page consultation-page"><PageHeader eyebrow="DOCTOR WORKSPACE" title="ห้องตรวจ" /><Card><section className="workflow-blocked" role="alert"><LockKeyhole aria-hidden="true" /><p>{workspace.error ? message(workspace.error) : "ไม่พบข้อมูลห้องตรวจ"}</p></section></Card></div>;
  const data = workspace.data; const staleWorkspace = Boolean(workspace.error); const authorityUnavailable = journeyAuthorityUnavailable(journey); const journeyAllows = (action: JourneyAction) => !authorityUnavailable && Boolean(journey.data?.allowedActions.includes(action)); const canSaveDraft = journeyAllows("SAVE_CONSULTATION_DRAFT"); const canFinalizeConsultation = journeyAllows("FINALIZE_CONSULTATION"); const canAmendClinicalNote = journeyAllows("AMEND_CLINICAL_NOTE"); const canReviseMedicationDecision = journeyAllows("REVISE_MEDICATION_DECISION"); const editable = canSaveDraft; const draftValue = saveableValue(value); const validDraft = clinicalNoteDraftInputSchema.safeParse(draftValue.note).success && medicationDecisionDraftInputSchema.safeParse(draftValue.medicationDecision).success; const validDecision = decisionValid(value.medicationDecision); const persistedValue = formValue(data); const persistedDraftComplete = Boolean(data.consultationDraft.note && data.consultationDraft.medicationDecision) && noteValidForSigning(persistedValue.note) && decisionValid(persistedValue.medicationDecision); const canSign = canFinalizeConsultation && !dirty && !conflict && !staleWorkspace && persistedDraftComplete && !finalize.isPending; const status = data.visit.status === "CONSULTING" ? { label: "กำลังตรวจ", tone: "active" as const } : { label: data.visit.status, tone: "waiting" as const };
  const reloadWorkspace = async () => { const result = await workspace.refetch(); if (!result.isSuccess || !result.data) return; setStamp(workspaceDraftStamp(result.data)); setConflict(false); setStartBlocked(false); setAllergyBlocked(false); start.reset(); allergy.reset(); saveAttempt.current = null; finalizeAttempt.current = null; startAttempt.current = null; startInFlight.current = false; if (!dirty) setValue(formValue(result.data)); };
  const saveDraft = () => { if (!editable || !validDraft || conflict || staleWorkspace) return; saveAttempt.current ??= createSaveDraftAttempt(data, draftValue); save.mutate({ visitId: data.visit.id, attempt: saveAttempt.current }, { onError: (error) => { if (isApiError(error) && error.status === 409) { setConflict(true); saveAttempt.current = null; } }, onSuccess: () => { saveAttempt.current = null; setDirty(false); setConflict(false); } }); };
  const sign = () => { if (!canSign) return; try { finalizeAttempt.current ??= createFinalizeAttempt(data); } catch { return; } finalize.mutate({ visitId: data.visit.id, attempt: finalizeAttempt.current }, { onError: (error) => { if (isApiError(error) && error.status === 409) { setConflict(true); finalizeAttempt.current = null; setShowConfirm(false); } }, onSuccess: () => { finalizeAttempt.current = null; setShowConfirm(false); } }); };
  const startConsultation = () => { if (startInFlight.current || start.isPending || startBlocked || staleWorkspace || !journeyAllows("START_CONSULTATION")) return; startInFlight.current = true; startAttempt.current ??= createStartConsultationAttempt(data.visit); start.mutate({ visitId: data.visit.id, attempt: startAttempt.current }, { onError: (error) => { startInFlight.current = false; if (isApiError(error) && (error.code === "REVISION_CONFLICT" || error.code === "INVALID_STATE")) { startAttempt.current = null; setStartBlocked(true); } }, onSuccess: () => { startInFlight.current = false; startAttempt.current = null; setStartBlocked(false); } }); };
  const openAllergyReview = () => { allergy.reset(); setAllergyBlocked(false); setShowAllergy(true); };
  const reviewAllergy = (payload: ReviewAllergyPayload) => { if (allergyBlocked || staleWorkspace || !journeyAllows("REVIEW_ALLERGY")) return; const next = { ...payload, visitId: data.visit.id }; const fingerprint = JSON.stringify(next); if (fingerprint !== allergyFingerprint.current) { allergyFingerprint.current = fingerprint; allergyAttempt.current = null; } allergyAttempt.current ??= createReviewAllergyAttempt(data, next); allergy.mutate({ context: data, attempt: allergyAttempt.current }, { onError: (error) => { if (isApiError(error) && (error.code === "REVISION_CONFLICT" || error.code === "INVALID_STATE")) { allergyAttempt.current = null; setAllergyBlocked(true); setConflict(true); } }, onSuccess: () => { allergyAttempt.current = null; allergyFingerprint.current = ""; setStartBlocked(false); start.reset(); setAllergyBlocked(false); setShowAllergy(false); } }); };
  const changeValue = (next: ConsultationFormValue) => { setValue(next); setDirty(true); saveAttempt.current = null; finalizeAttempt.current = null; };
  const submitAmendment = () => { if (staleWorkspace || !canAmendClinicalNote || !data.signedClinicalNote || !amendment.content.trim() || !amendment.reason.trim()) return; amendmentAttempt.current ??= createCommandAttempt({ amendment: data.amendments.length }, amendment); amend.mutate({ visitId: data.visit.id, noteId: data.signedClinicalNote.id, attempt: amendmentAttempt.current }, { onSuccess: () => { amendmentAttempt.current = null; setEvidenceAction(null); } }); };
  const fieldErrors = (error: unknown) => isApiError(error) ? error.fieldErrors : undefined;
  const editorErrors = fieldErrors(save.error) ?? fieldErrors(finalize.error);
  return <div className="flow-page consultation-page">
    <PageHeader eyebrow="DOCTOR WORKSPACE · CONSULTATION" title="ห้องตรวจผู้ป่วย" description="บันทึก Clinical Note และการตัดสินใจเรื่องยาในข้อมูลสังเคราะห์" />
    {journey.data ? <><VisitJourneyRibbon steps={journey.data.steps} /><JourneyNextTaskCard summary={journey.data} visitId={data.visit.id} currentRole={auth.session?.user.role ?? "doctor"} authorityReady={!authorityUnavailable} localActionHandlers={{ ...(start.isPending || startBlocked || staleWorkspace || !journeyAllows("START_CONSULTATION") ? {} : { START_CONSULTATION: startConsultation }), ...(allergy.isPending || allergyBlocked || staleWorkspace || !journeyAllows("REVIEW_ALLERGY") ? {} : { REVIEW_ALLERGY: openAllergyReview }) }} commandFailure={start.error ? message(start.error) : undefined} /></> : null}
    {authorityUnavailable ? <JourneyAuthorityBanner error={journey.error} fetching={journey.isFetching} onReload={() => void journey.refetch()} /> : null}
    {staleWorkspace ? <div className="conflict-alert workspace-stale-alert" role="alert"><span><strong>ข้อมูลห้องตรวจอาจไม่เป็นปัจจุบัน</strong> กรุณาโหลดข้อมูลล่าสุดก่อนบันทึกหรือลงนาม</span><ActionButton type="button" variant="secondary" onClick={() => void reloadWorkspace()} disabled={workspace.isFetching}>{workspace.isFetching ? "กำลังโหลด…" : "โหลดข้อมูลล่าสุด"}</ActionButton></div> : null}
    <div className="clinical-workspace-grid"><aside className="consultation-patient-rail" aria-label="บริบทผู้ป่วย"><div className="care-card patient-identity"><div className="patient-header"><div className="patient-header-copy"><strong>{data.patient.displayName}</strong><span>HN {data.patient.hn}</span></div><StatusBadge tone={status.tone}>{status.label}</StatusBadge></div><div className="allergy-summary"><span>ประวัติแพ้ยา</span><strong>{allergyStateLabelTh(data.patientSnapshot.allergy.state)}</strong><ActionButton type="button" variant="secondary" onClick={openAllergyReview} disabled={staleWorkspace || !journeyAllows("REVIEW_ALLERGY")}>ทบทวนประวัติแพ้</ActionButton></div><Link className="care-button care-button-secondary" to="/queue">กลับคิวผู้ป่วย</Link></div><PatientSnapshot snapshot={data.patientSnapshot} /></aside>
      <div className="consultation-clinical-content"><section className="care-card consultation-current-visit" aria-label="ข้อมูล Visit ปัจจุบัน"><SectionHeading icon={Stethoscope} title="ข้อมูล Visit ปัจจุบัน" description={`อาการสำคัญ: ${data.intake.chiefComplaint}`} /><div className="consultation-meta"><span>Visit {data.visit.id}</span><span>revision {data.visit.revision}</span><StatusBadge tone={status.tone}>{status.label}</StatusBadge></div><div className="vitals-summary"><span>อุณหภูมิ <strong>{vital(data.intake.vitals.temperatureC, " °C")}</strong></span><span>ความดัน <strong>{data.intake.vitals.systolicMmhg === null || data.intake.vitals.diastolicMmhg === null ? "—" : `${data.intake.vitals.systolicMmhg}/${data.intake.vitals.diastolicMmhg}`}</strong></span><span>ชีพจร <strong>{vital(data.intake.vitals.heartRateBpm, " ครั้ง/นาที")}</strong></span><span>SpO₂ <strong>{vital(data.intake.vitals.spo2Percent, "%")}</strong></span><span>น้ำหนัก <strong>{vital(data.intake.vitals.weightKg, " กก.")}</strong></span><span>ส่วนสูง <strong>{vital(data.intake.vitals.heightCm, " ซม.")}</strong></span></div><section className="clinical-evidence" aria-label="หลักฐานจาก Intake"><SectionHeading icon={ClipboardCheck} title="หลักฐานจาก Intake" description="ข้อมูลนี้มาจาก snapshot ที่บันทึกแล้ว" /><div className="evidence-grid"><div><span>ผู้บันทึก</span><strong>{data.intake.recordedBy.displayName}</strong></div><div><span>เวลาบันทึก</span><strong>{formatThaiDateTime(data.intake.recordedAt)}</strong></div><div><span>มาถึงคลินิก</span><strong>{formatThaiDateTime(data.visit.arrivedAt)}</strong></div><div><span>เริ่มห้องตรวจ</span><strong>{data.visit.startedAt ? formatThaiDateTime(data.visit.startedAt) : "ยังไม่เริ่ม"}</strong></div></div></section></section>
        {data.signedClinicalNote && data.medicationDecision ? <>
          <SignedClinicalEvidence note={data.signedClinicalNote} decision={data.medicationDecision} amendments={data.amendments} onAmend={!staleWorkspace && canAmendClinicalNote ? () => setEvidenceAction("amend") : undefined} onRevise={!staleWorkspace && canReviseMedicationDecision ? () => setEvidenceAction("revise") : undefined} />
          <div className="signed-next-actions">{data.visit.status === "AWAITING_ORDER_REVISION" ? <strong>รอแก้ไขการตัดสินใจยา</strong> : data.visit.status === "AWAITING_PREPARATION" ? <><span>ตรวจสอบฉลากและเริ่มเตรียมยา</span>{journeyAllows("START_PREPARATION") ? <Link className="care-button care-button-secondary" to={`/dispensing/${data.visit.id}`}>ไปหน้าเตรียมยา</Link> : null}</> : data.visit.status === "PREPARING" ? <><span>กำลังเตรียมยาและยืนยัน allocation</span>{journeyAllows("CONFIRM_ALLOCATION") ? <Link className="care-button care-button-secondary" to={`/dispensing/${data.visit.id}`}>ดูสถานะการเตรียมยา</Link> : null}</> : data.visit.status === "AWAITING_RELEASE" ? <><span>เตรียมยาเสร็จแล้ว รอแพทย์ตรวจปล่อย</span>{journeyAllows("RELEASE_MEDICATION") ? <Link className="care-button care-button-secondary" to={`/dispensing/${data.visit.id}`}>ดูการตรวจปล่อยยา</Link> : null}</> : data.visit.status === "AWAITING_HANDOFF" ? <><span>รอส่งมอบยา</span>{journeyAllows("HANDOFF_MEDICATION") ? <Link className="care-button care-button-secondary" to={`/dispensing/${data.visit.id}`}>ดูการส่งมอบยา</Link> : null}</> : data.visit.status === "AWAITING_CHARGE" ? <><span>ขั้นตอนถัดไปคือการยืนยันยอดและรับชำระ</span>{journeyAllows("FINALIZE_CHARGE") ? <Link className="care-button care-button-secondary" to={`/checkout/${data.visit.id}`}>ไปหน้าชำระเงิน</Link> : null}</> : <span>ขั้นตอนถัดไปยังไม่พร้อมใน Pilot</span>}</div>
        </> : <section className="care-card consultation-note-panel" aria-label="Clinical Note">
          <SectionHeading icon={FileSignature} title="Clinical Note" description="บันทึกโดยแพทย์เท่านั้น" />
          {conflict ? <div role="alert" className="conflict-alert">ข้อมูลเวอร์ชันปัจจุบันเปลี่ยนแปลงแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนลงนาม <ActionButton type="button" variant="secondary" onClick={() => void reloadWorkspace()} disabled={workspace.isFetching}>โหลดข้อมูลล่าสุด</ActionButton></div> : null}
          {save.error ? <p className="field-error" role="alert">{message(save.error)}</p> : null}
          {finalize.error ? <p className="field-error" role="alert">{message(finalize.error)}</p> : null}
          <ClinicalNoteEditor value={value.note} errors={editorErrors} onChange={(note) => changeValue({ ...value, note })} disabled={!editable || authorityUnavailable || save.isPending || finalize.isPending} />
          <SectionHeading title="การตัดสินใจเรื่องยา" description="ต้องเลือกคำสั่งยา หรือระบุว่าไม่สั่งยา" />
          <MedicationDecisionEditor value={value.medicationDecision} errors={editorErrors} onChange={(medicationDecision) => changeValue({ ...value, medicationDecision })} disabled={!editable || authorityUnavailable || save.isPending || finalize.isPending} />
          {dirty ? <p className="field-hint">มีการแก้ไขที่ยังไม่บันทึก กรุณาบันทึกร่างล่าสุดก่อนลงนาม</p> : !validDecision ? <p className="field-hint">บันทึกร่างได้ และต้องระบุรายการยาพร้อมวิธีใช้ หรือเหตุผลที่ไม่สั่งยาก่อนลงนาม</p> : !persistedDraftComplete ? <p className="field-hint">ข้อมูล SOAP และการวินิจฉัยในร่างต้องครบก่อนลงนาม</p> : null}
          <div className="consultation-actions">{canSaveDraft ? <ActionButton type="button" variant="secondary" onClick={saveDraft} disabled={conflict || staleWorkspace || save.isPending || !validDraft}>{save.isPending ? "กำลังบันทึก…" : "บันทึกร่าง"}</ActionButton> : null}{canFinalizeConsultation ? <ActionButton type="button" onClick={() => setShowConfirm(true)} disabled={!canSign}>ลงนามและส่งต่อ</ActionButton> : canSaveDraft ? <p className="field-hint" role="status">ยังลงนามไม่ได้จนกว่าจะทบทวนประวัติแพ้ยา</p> : <p className="field-hint" role="status">รอสิทธิ์บันทึกห้องตรวจจากเส้นทางผู้ป่วยล่าสุด</p>}</div>
        </section>}</div></div>
    {showAllergy ? <AllergyReviewDialog allergy={data.patientSnapshot.allergy} onClose={() => { allergy.reset(); setAllergyBlocked(false); setShowAllergy(false); }} onSave={reviewAllergy} pending={allergy.isPending} error={allergy.error ? message(allergy.error) : staleWorkspace || authorityUnavailable ? "ข้อมูลห้องตรวจหรือสิทธิ์ Journey อาจไม่เป็นปัจจุบัน" : undefined} blocked={allergyBlocked || staleWorkspace || authorityUnavailable} onReload={() => void reloadWorkspace()} reloadPending={workspace.isFetching || journey.isFetching} /> : null}
    {showConfirm ? <div className="dialog-backdrop"><section className="care-card sign-dialog" role="dialog" aria-modal="true" aria-label="ยืนยันการลงนาม" ref={confirmRef} tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape") setShowConfirm(false); if (event.key === "Enter" && !event.shiftKey) sign(); }}><h2>ยืนยันการลงนาม</h2><p>การวินิจฉัย: {persistedValue.note.diagnoses.filter(Boolean).join(", ") || "ยังไม่ระบุ"}</p><p>การตัดสินใจยา: {persistedValue.medicationDecision.kind === "ORDER" ? "สั่งยา" : persistedValue.medicationDecision.kind === "NO_MEDICATION" ? "ไม่สั่งยา" : "ยังไม่ตัดสินใจ"}</p><div className="dialog-actions"><ActionButton type="button" variant="secondary" onClick={() => setShowConfirm(false)} disabled={finalize.isPending}>ยกเลิก</ActionButton><ActionButton type="button" onClick={sign} disabled={!canSign}>ยืนยันการลงนาม</ActionButton></div></section></div> : null}
    {evidenceAction === "amend" ? <div className="dialog-backdrop"><section className="care-card sign-dialog" role="dialog" aria-modal="true" aria-label="เพิ่มคำแก้ไข"><h2>เพิ่มคำแก้ไข</h2><TextAreaField label="รายละเอียด" value={amendment.content} onChange={(event) => { amendmentAttempt.current = null; setAmendment({ ...amendment, content: event.target.value }); }} disabled={amend.isPending || staleWorkspace || !canAmendClinicalNote} /><TextAreaField label="เหตุผล" value={amendment.reason} onChange={(event) => { amendmentAttempt.current = null; setAmendment({ ...amendment, reason: event.target.value }); }} disabled={amend.isPending || staleWorkspace || !canAmendClinicalNote} />{amend.error ? <p className="field-error">{message(amend.error)}</p> : null}<div className="dialog-actions"><ActionButton type="button" variant="secondary" onClick={() => setEvidenceAction(null)} disabled={amend.isPending}>ยกเลิก</ActionButton><ActionButton type="button" onClick={submitAmendment} disabled={staleWorkspace || !canAmendClinicalNote || amend.isPending || !amendment.content.trim() || !amendment.reason.trim()}>ลงนาม</ActionButton></div></section></div> : null}
    {evidenceAction === "revise" && data.medicationDecision ? <MedicationDecisionRevisionDialog decision={data.medicationDecision} expectedRevisions={{ visit: data.visit.revision, patient: data.patient.revision, medicationDecision: data.medicationDecision.version }} pending={revise.isPending || staleWorkspace || !canReviseMedicationDecision} error={revise.error ? message(revise.error) : staleWorkspace || !canReviseMedicationDecision ? "ข้อมูลห้องตรวจหรือสิทธิ์ Journey อาจไม่เป็นปัจจุบัน" : undefined} onCancel={() => setEvidenceAction(null)} onSubmit={(attempt) => { if (!staleWorkspace && canReviseMedicationDecision) revise.mutate({ visitId: data.visit.id, attempt }, { onSuccess: () => setEvidenceAction(null) }); }} /> : null}
  </div>;
}

export function ConsultationScreen(): ReactElement {
  const { visitId = "" } = useParams();
  return <ConsultationWorkspace key={visitId} visitId={visitId} />;
}
