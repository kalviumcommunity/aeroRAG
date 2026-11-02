import { AlertCircle, LoaderCircle, ShieldAlert } from 'lucide-react';

export function Loading({ label = 'Loading', className = '' }) {
  return (
    <div className={`flex items-center gap-2 py-10 text-sm text-muted ${className}`} role="status" aria-label={label}>
      <LoaderCircle className="animate-spin" size={18} />
      {label}…
    </div>
  );
}

export function ErrorNotice({ children, className = '' }) {
  if (!children) return null;
  return (
    <div
      className={`inline-flex items-start gap-3 rounded-xl border border-rose-100 bg-rose-50 p-3 text-sm text-rose-700 ${className}`}
      role="alert"
    >
      <AlertCircle size={16} />
      <span>{children}</span>
    </div>
  );
}

export function SafetyNotice() {
  return (
    <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-sm text-amber-700 flex items-start gap-3">
      <ShieldAlert size={16} />
      <span>
        Academic prototype only. Verify operational decisions against authorized airline sources.
      </span>
    </div>
  );
}

export function EmptyState({ title, children, className = '' }) {
  return (
    <div className={`flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-line bg-paper p-10 text-center ${className}`}>
      <div className="rounded-full bg-white border border-line p-3 text-muted">AR</div>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className="text-muted text-sm">{children}</p>
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, action }) {
  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
      <div>
        <span className="block text-xs font-semibold text-muted tracking-wide">{eyebrow}</span>
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        {description && <p className="text-muted text-sm mt-1">{description}</p>}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}
