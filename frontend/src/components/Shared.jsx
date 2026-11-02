import { AlertCircle, LoaderCircle, ShieldAlert } from 'lucide-react';

export function Loading({ label = 'Loading' }) {
  return <div className="flex items-center gap-2 py-10 text-sm text-muted" role="status"><LoaderCircle className="animate-spin" size={18} />{label}…</div>;
}

export function ErrorNotice({ children }) {
  if (!children) return null;
  return <div className="notice-error" role="alert"><AlertCircle size={18} /> <span>{children}</span></div>;
}

export function SafetyNotice() {
  return <div className="safety-notice"><ShieldAlert size={18} /><span>Academic prototype only. Verify operational decisions against authorized airline sources.</span></div>;
}

export function EmptyState({ title, children }) {
  return <div className="empty-state"><div className="empty-mark">AR</div><h3>{title}</h3><p>{children}</p></div>;
}
