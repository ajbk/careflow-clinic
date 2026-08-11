import type { AllergyAssessmentDto, AllergySeverity } from "../../../shared/contracts";
import { allergySeverityLabelTh, allergyStateLabelTh } from "../../features/allergy";
import type { IntakeAllergyDraft } from "../../features/intake";

type AllergyItemPatch = Partial<IntakeAllergyDraft["items"][number]>;
type FieldElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;

export function IntakeAllergyCard({
  assessment,
  draft,
  fieldErrors,
  disabled,
  onAnswerChange,
  onItemChange,
  onAddItem,
  onRemoveItem,
  onChangeReasonChange,
  onRegisterField,
}: {
  assessment?: AllergyAssessmentDto;
  draft: IntakeAllergyDraft;
  fieldErrors: Record<string, string>;
  disabled: boolean;
  onAnswerChange: (answer: "NO" | "YES") => void;
  onItemChange: (key: string, patch: AllergyItemPatch) => void;
  onAddItem: () => void;
  onRemoveItem: (key: string) => void;
  onChangeReasonChange: (value: string) => void;
  onRegisterField?: (key: string, element: FieldElement) => void;
}) {
  const changingResolvedState = assessment !== undefined && assessment.state !== "UNKNOWN" && (
    (assessment.state === "PRESENT" && draft.answer === "NO") ||
    (assessment.state === "NONE_KNOWN" && draft.answer === "YES")
  );
  const showItems = draft.answer === "YES";

  return (
    <section className="intake-allergy-card" aria-label="ประวัติแพ้ยา">
      <div className="intake-allergy-prior" aria-live="polite">
        <strong>ข้อมูลแพ้ยาเดิม</strong>
        <span>{assessment ? allergyStateLabelTh(assessment.state) : "กำลังโหลดข้อมูลแพ้ยา…"}</span>
        {assessment?.state === "PRESENT" && assessment.items.length > 0 ? (
          <span>{assessment.items.map((item) => `${item.substance} (${item.reaction})`).join(", ")}</span>
        ) : null}
      </div>

      <fieldset className="intake-allergy-fieldset" disabled={disabled}>
        <legend>ประวัติแพ้ยา *</legend>
        <p className="field-hint">กรุณาถามและเลือกคำตอบก่อนส่งผู้ป่วยเข้าคิว</p>
        <div className="intake-allergy-answers">
          <label className={`intake-allergy-answer ${draft.answer === "NO" ? "intake-allergy-answer-selected" : ""}`}>
            <input
              ref={(element) => onRegisterField?.("allergy.answer", element)}
              type="radio"
              name="intake-allergy-answer"
              value="NO"
              checked={draft.answer === "NO"}
              onChange={() => onAnswerChange("NO")}
              aria-invalid={fieldErrors["allergy.answer"] ? true : undefined}
            />
            <span>ไม่แพ้</span>
          </label>
          <label className={`intake-allergy-answer ${draft.answer === "YES" ? "intake-allergy-answer-selected" : ""}`}>
            <input
              type="radio"
              name="intake-allergy-answer"
              value="YES"
              checked={draft.answer === "YES"}
              onChange={() => onAnswerChange("YES")}
              aria-invalid={fieldErrors["allergy.answer"] ? true : undefined}
            />
            <span>แพ้</span>
          </label>
        </div>
        {fieldErrors["allergy.answer"] ? <p className="field-error">{fieldErrors["allergy.answer"]}</p> : null}

        {showItems ? (
          <div className="intake-allergy-items">
            {draft.items.map((item, index) => {
              const substanceKey = `allergy.items.${index}.substance`;
              const reactionKey = `allergy.items.${index}.reaction`;
              const severityKey = `allergy.items.${index}.severity`;
              const noteKey = `allergy.items.${index}.note`;
              return (
                <section className="intake-allergy-item" aria-label={`รายการแพ้ ${index + 1}`} key={item.key}>
                  <div className="intake-allergy-item-heading">
                    <strong>รายการแพ้ {index + 1}</strong>
                    <button
                      className="inline-retry-button"
                      type="button"
                      onClick={() => onRemoveItem(item.key)}
                      disabled={draft.items.length <= 1}
                      aria-label={`ลบรายการแพ้ ${index + 1}`}
                    >
                      ลบรายการ
                    </button>
                  </div>
                  <label className="field">
                    <span className="field-label">สารที่แพ้ *</span>
                    <input
                      ref={(element) => onRegisterField?.(substanceKey, element)}
                      className={`care-input ${fieldErrors[substanceKey] ? "input-error" : ""}`}
                      value={item.substance}
                      onChange={(event) => onItemChange(item.key, { substance: event.target.value })}
                      aria-invalid={fieldErrors[substanceKey] ? true : undefined}
                    />
                    {fieldErrors[substanceKey] ? <span className="field-error">{fieldErrors[substanceKey]}</span> : null}
                  </label>
                  <label className="field">
                    <span className="field-label">อาการแพ้ *</span>
                    <input
                      ref={(element) => onRegisterField?.(reactionKey, element)}
                      className={`care-input ${fieldErrors[reactionKey] ? "input-error" : ""}`}
                      value={item.reaction}
                      onChange={(event) => onItemChange(item.key, { reaction: event.target.value })}
                      aria-invalid={fieldErrors[reactionKey] ? true : undefined}
                    />
                    {fieldErrors[reactionKey] ? <span className="field-error">{fieldErrors[reactionKey]}</span> : null}
                  </label>
                  <label className="field">
                    <span className="field-label">ความรุนแรง</span>
                    <select
                      ref={(element) => onRegisterField?.(severityKey, element)}
                      className={`care-input care-select ${fieldErrors[severityKey] ? "input-error" : ""}`}
                      value={item.severity}
                      onChange={(event) => onItemChange(item.key, { severity: event.target.value as AllergySeverity })}
                      aria-invalid={fieldErrors[severityKey] ? true : undefined}
                    >
                      {(["UNKNOWN", "MILD", "MODERATE", "SEVERE"] as const).map((severity) => (
                        <option key={severity} value={severity}>{allergySeverityLabelTh(severity)}</option>
                      ))}
                    </select>
                    {fieldErrors[severityKey] ? <span className="field-error">{fieldErrors[severityKey]}</span> : null}
                  </label>
                  <label className="field">
                    <span className="field-label">หมายเหตุ (ถ้ามี)</span>
                    <textarea
                      ref={(element) => onRegisterField?.(noteKey, element)}
                      className={`care-input care-textarea ${fieldErrors[noteKey] ? "input-error" : ""}`}
                      value={item.note}
                      onChange={(event) => onItemChange(item.key, { note: event.target.value })}
                      aria-invalid={fieldErrors[noteKey] ? true : undefined}
                    />
                    {fieldErrors[noteKey] ? <span className="field-error">{fieldErrors[noteKey]}</span> : null}
                  </label>
                </section>
              );
            })}
            <button className="care-button care-button-secondary" type="button" onClick={onAddItem} disabled={draft.items.length >= 20}>เพิ่มรายการแพ้</button>
          </div>
        ) : null}

        {changingResolvedState ? (
          <div className="intake-allergy-change-warning" role="alert">
            <strong>ข้อมูลแพ้ยาเปลี่ยนจากข้อมูลเดิม</strong>
            <label className="field">
              <span className="field-label">เหตุผลที่ข้อมูลแพ้ยาเปลี่ยน *</span>
              <textarea
                ref={(element) => onRegisterField?.("allergy.changeReason", element)}
                className={`care-input care-textarea ${fieldErrors["allergy.changeReason"] ? "input-error" : ""}`}
                value={draft.changeReason}
                onChange={(event) => onChangeReasonChange(event.target.value)}
                aria-invalid={fieldErrors["allergy.changeReason"] ? true : undefined}
              />
              {fieldErrors["allergy.changeReason"] ? <span className="field-error">{fieldErrors["allergy.changeReason"]}</span> : null}
            </label>
          </div>
        ) : null}
      </fieldset>
    </section>
  );
}
