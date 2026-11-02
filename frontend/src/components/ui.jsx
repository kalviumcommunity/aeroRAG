import { useCallback, useContext, createContext, useMemo, useState } from 'react';
import { AlertCircle, Bell, CheckCheck, LoaderCircle, Info } from 'lucide-react';

export function Button({ className = '', variant = 'primary', disabled = false, loading = false, size = 'default', ...props }) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-xl border font-semibold transition-all disabled:opacity-50 disabled:pointer-events-none';
  const variants = {
    primary: 'bg-brand text-white border-brand hover:bg-brand-dark hover:border-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
    secondary: 'bg-white text-ink border-line hover:bg-paper hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
    ghost: 'text-muted hover:bg-paper hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
    danger: 'bg-white text-rose-700 border-rose-200 hover:bg-rose-50 hover:border-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2',
    outline: 'bg-transparent text-ink border-line hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2'
  };
  const sizes = { sm: 'px-3 py-1.5 text-xs', default: 'px-4 py-2 text-sm', lg: 'px-6 py-3 text-base' };
  return (
    <button className={[base, variants[variant], sizes[size], className].filter(Boolean).join(' ')} disabled={disabled} {...props}>
      {loading && <LoaderCircle className="animate-spin" size={14} />}
      {props.children}
    </button>
  );
}

export function Input({ className = '', ...props }) {
  return (
    <input className={[ 'flex-1 bg-white border border-line rounded-xl px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition-all disabled:bg-paper disabled:text-muted', className ].filter(Boolean).join(' ')} {...props} />
  );
}

export function Label({ children, className = '', htmlFor }) {
  return <label className={['block text-xs font-semibold text-muted tracking-wide mb-1.5', className].filter(Boolean).join(' ')} htmlFor={htmlFor}>{children}</label>;
}

export function Card({ className = '', children }) {
  return <div className={['bg-white border border-line rounded-2xl shadow-card', className].filter(Boolean).join(' ')}>{children}</div>;
}

export function CardHeader({ className = '', children }) {
  return <div className={['px-5 py-4 border-b border-line', className].filter(Boolean).join(' ')}>{children}</div>;
}

export function CardBody({ className = '', children }) {
  return <div className={['p-5', className].filter(Boolean).join(' ')}>{children}</div>;
}

export function Badge({ className = '', variant = 'default', children }) {
  const variants = {
    default: 'bg-paper text-ink border border-line',
    current: 'bg-green-50 text-green-800 border border-green-100',
    superseded: 'bg-amber-50 text-amber-800 border border-amber-100',
    expired: 'bg-rose-50 text-rose-800 border border-rose-100',
    draft: 'bg-slate-50 text-slate-800 border border-slate-100',
    historical: 'bg-indigo-50 text-indigo-800 border border-indigo-100',
    unknown: 'bg-slate-100 text-slate-500 border border-slate-200',
    processing: 'bg-blue-50 text-blue-700 border border-blue-100',
    failed: 'bg-rose-50 text-rose-700 border border-rose-100',
    ready: 'bg-green-50 text-green-700 border border-green-100'
  };
  return (
    <span className={['inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold', variants[variant], className].filter(Boolean).join(' ')}>{children}</span>
  );
}

export function Skeleton({ className = '', ...props }) {
  return <div className={['animate-pulse rounded-md bg-paper', className].filter(Boolean).join(' ')} {...props} />;
}

export function SectionTitle({ children, className = '' }) {
  return <h2 className={['text-base font-semibold text-ink tracking-tight mb-6', className].filter(Boolean).join(' ')}>{children}</h2>;
}

export function FieldHint({ children, className = '' }) {
  return <p className={['text-xs text-muted mt-1', className].filter(Boolean).join(' ')}>{children}</p>;
}

const TOAST_LIMIT = 5;
const TOAST_REMOVE_DELAY = 4000;
const ToastContext = createContext({ toasts: [], toast: () => {}, dismiss: () => {} });

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const toast = useCallback(({ title, description, variant = 'default', duration = TOAST_REMOVE_DELAY }) => {
    const id = Math.random().toString(36).slice(2, 9);
    setToasts((prev) => [...prev.slice(-TOAST_LIMIT + 1), { id, title, description, variant }]);
    if (duration !== null) {
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), duration);
    }
    return id;
  }, []);

  const dismiss = useCallback((id) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);
  const value = useMemo(() => ({ toasts, toast, dismiss }), [toasts]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed top-5 right-5 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <Toast key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

const variantProps = {
  default: { bg: 'bg-white', border: 'border-line', icon: Info, iconClass: 'text-brand' },
  success: { bg: 'bg-green-50', border: 'border-green-100', icon: CheckCheck, iconClass: 'text-green-700' },
  error: { bg: 'bg-rose-50', border: 'border-rose-100', icon: AlertCircle, iconClass: 'text-rose-700' }
};

function Toast({ toast, onDismiss }) {
  const { bg, border, icon: Icon, iconClass } = variantProps[toast.variant] ?? variantProps.default;
  return (
    <div className={['pointer-events-auto', bg, border, 'rounded-xl shadow-card p-4 min-w-[320px] animate-in fade-in slide-in-from-right-4 duration-200'].filter(Boolean).join(' ')} key={toast.id} role="alert">
      <div className="flex gap-3">
        <Icon size={18} className={iconClass} />
        <div className="flex-1">
          {toast.title && <h4 className="text-sm font-semibold text-ink">{toast.title}</h4>}
          {toast.description && <p className="text-xs text-muted mt-0.5">{toast.description}</p>}
        </div>
        <button onClick={() => onDismiss(toast.id)} className="text-muted hover:text-ink transition-colors" aria-label="Dismiss notification">
          <Bell size={16} />
        </button>
      </div>
    </div>
  );
}
