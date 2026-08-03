import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import type { LucideIcon } from "lucide-react";

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function Card({
  children,
  className,
  as: Element = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "article" | "div";
}) {
  return <Element className={classes("care-card", className)}>{children}</Element>;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <p className="page-eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function SectionHeading({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div className="section-heading-copy">
        {Icon ? <Icon aria-hidden="true" size={22} strokeWidth={1.8} /> : null}
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "waiting" | "active" | "success" | "warning" | "error" | "info";
}) {
  return <span className={`status-pill status-${tone}`}>{children}</span>;
}

export function ActionButton({
  children,
  variant = "primary",
  icon: Icon,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  icon?: LucideIcon;
}) {
  return (
    <button className={classes("care-button", `care-button-${variant}`, className)} {...props}>
      {Icon ? <Icon aria-hidden="true" size={19} strokeWidth={2} /> : null}
      <span>{children}</span>
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
}) {
  const id = props.id ?? props.name;
  return (
    <label className={classes("field", className)} htmlFor={id}>
      <span className="field-label">{label}</span>
      <input id={id} className={classes("care-input", error && "input-error")} {...props} />
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function TextAreaField({
  label,
  error,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  error?: string;
  className?: string;
}) {
  const id = props.id ?? props.name;
  return (
    <label className={classes("field", className)} htmlFor={id}>
      <span className="field-label">{label}</span>
      <textarea id={id} className={classes("care-input care-textarea", error && "input-error")} {...props} />
      {error ? <span className="field-error">{error}</span> : null}
    </label>
  );
}

export function SelectField({
  label,
  children,
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const id = props.id ?? props.name;
  return (
    <label className={classes("field", className)} htmlFor={id}>
      <span className="field-label">{label}</span>
      <select id={id} className="care-input care-select" {...props}>
        {children}
      </select>
    </label>
  );
}

export function EmptyState({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon"><Icon aria-hidden="true" size={26} /></span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

export function formatThaiCurrency(value: number) {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    maximumFractionDigits: 0,
  }).format(value);
}
