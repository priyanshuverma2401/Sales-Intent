import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Loader2, X } from 'lucide-react';

// Shared primitives. Everything visual in the app is built from these so a
// spacing or colour change happens in exactly one place.

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

// --- Logo -----------------------------------------------------------------

export function Logo({ compact = false, light = false }: { compact?: boolean; light?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      {!compact && (
        <span className="text-[17px] font-extrabold tracking-tight">
          <span className={light ? 'text-white' : 'text-navy-900'}>sales</span>
          <span className={light ? 'text-brand-300' : 'text-brand-600'}>motion</span>
        </span>
      )}
      <span className="relative inline-block h-4 w-7 shrink-0">
        <span
          className={cx(
            'absolute left-0 top-0 h-4 w-4 rounded-full',
            light ? 'bg-white' : 'bg-navy-900'
          )}
        />
        <span
          className={cx(
            'absolute right-0 top-0 h-4 w-4 rounded-full opacity-90',
            light ? 'bg-brand-400' : 'bg-brand-600'
          )}
        />
      </span>
    </span>
  );
}

// --- Buttons --------------------------------------------------------------

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ElementType;
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon: Icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx('btn', `btn-${size}`, `btn-${variant}`, className)}
    >
      {loading ? (
        <Loader2 size={size === 'sm' ? 14 : 16} className="animate-spin" />
      ) : (
        Icon && <Icon size={size === 'sm' ? 14 : 16} />
      )}
      {children}
    </button>
  );
}

// --- Surfaces -------------------------------------------------------------

export function Card({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cx('card', className)}>
      {children}
    </div>
  );
}

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
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
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 text-2xs font-bold uppercase tracking-[0.14em] text-brand-600">
            {eyebrow}
          </p>
        )}
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// --- Feedback -------------------------------------------------------------

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: 'neutral' | 'brand' | 'green' | 'amber' | 'red';
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={cx('badge', `badge-${tone}`, className)}>{children}</span>;
}

export function Alert({
  tone = 'info',
  children,
  onDismiss,
}: {
  tone?: 'info' | 'error' | 'success';
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  const tones = {
    info: 'border-brand-200 bg-brand-50 text-brand-800',
    error: 'border-red-200 bg-red-50 text-red-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  };
  const Icon = tone === 'error' ? AlertCircle : tone === 'success' ? Check : AlertCircle;

  return (
    <div className={cx('flex items-start gap-3 rounded-lg border px-4 py-3 text-sm', tones[tone])}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && (
        <button onClick={onDismiss} className="shrink-0 opacity-60 hover:opacity-100">
          <X size={15} />
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ElementType;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100">
        <Icon size={22} className="text-ink-faint" />
      </div>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-14 text-sm text-ink-muted">
      <Loader2 size={16} className="animate-spin" />
      {label || 'Loading…'}
    </div>
  );
}

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="card card-pad">
          <div className="h-4 w-1/3 animate-pulse rounded bg-slate-200" />
          <div className="mt-3 h-3 w-2/3 animate-pulse rounded bg-slate-100" />
          <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

// --- Modal ----------------------------------------------------------------

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'md' | 'lg';
}) {
  // Escape closes, and the page behind must not scroll while the dialog is up
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div
        className="fixed inset-0 bg-navy-950/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cx(
          'relative my-auto w-full animate-scale-in rounded-2xl bg-white shadow-pop',
          size === 'lg' ? 'max-w-3xl' : 'max-w-xl'
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
          </div>
          <button onClick={onClose} className="btn btn-ghost -mr-2 h-8 w-8 rounded-lg p-0">
            <X size={17} />
          </button>
        </div>

        <div className="max-h-[calc(100vh-16rem)] overflow-y-auto px-6 py-5">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Field wrappers -------------------------------------------------------

export function Field({
  label,
  hint,
  required,
  error,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-xs font-medium text-red-600">{error}</p>
      ) : (
        hint && <p className="hint">{hint}</p>
      )}
    </div>
  );
}

/**
 * Tag input used for every list-shaped field: capabilities, keywords, target
 * departments. Enter or comma commits a tag; Backspace on an empty box removes
 * the last one.
 */
export function TagInput({
  value,
  onChange,
  placeholder,
  suggestions = [],
  max = 20,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
  max?: number;
}) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const add = (raw: string) => {
    const tag = raw.trim().replace(/,$/, '');
    if (!tag) return;
    // Case-insensitive de-dupe so "GenAI" and "genai" cannot both be added
    if (value.some((v) => v.toLowerCase() === tag.toLowerCase())) {
      setDraft('');
      return;
    }
    if (value.length >= max) return;
    onChange([...value, tag]);
    setDraft('');
  };

  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));

  const unusedSuggestions = suggestions.filter(
    (s) => !value.some((v) => v.toLowerCase() === s.toLowerCase())
  );

  return (
    <div>
      <div
        onClick={() => inputRef.current?.focus()}
        className="flex min-h-[46px] w-full cursor-text flex-wrap items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-2 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20"
      >
        {value.map((tag, i) => (
          <span
            key={`${tag}-${i}`}
            className="inline-flex items-center gap-1 rounded-md bg-brand-50 py-1 pl-2 pr-1 text-[13px] font-medium text-brand-700"
          >
            {tag}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                remove(i);
              }}
              className="rounded p-0.5 text-brand-500 hover:bg-brand-100 hover:text-brand-700"
              aria-label={`Remove ${tag}`}
            >
              <X size={12} />
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          value={draft}
          placeholder={value.length === 0 ? placeholder : ''}
          onChange={(e) => {
            // Pasting "a, b, c" should create three tags, not one
            if (e.target.value.includes(',')) {
              e.target.value.split(',').forEach(add);
            } else {
              setDraft(e.target.value);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(draft);
            } else if (e.key === 'Backspace' && !draft && value.length) {
              remove(value.length - 1);
            }
          }}
          onBlur={() => add(draft)}
          className="min-w-[140px] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm text-ink outline-none placeholder:text-ink-faint"
        />
      </div>

      {unusedSuggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">
            Suggested
          </span>
          {unusedSuggestions.slice(0, 8).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="rounded-md border border-dashed border-slate-300 px-2 py-0.5 text-[12px] text-ink-muted transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Score ring -----------------------------------------------------------

export function ScoreRing({
  value,
  band,
  size = 88,
}: {
  value: number;
  band?: string;
  size?: number;
}) {
  const stroke = size >= 80 ? 8 : 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, value)) / 100;

  const color =
    value >= 80 ? '#059669' : value >= 60 ? '#2563eb' : value >= 40 ? '#f59e0b' : '#94a3b8';

  return (
    <div className="inline-flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - pct)}
            style={{ transition: 'stroke-dashoffset 700ms ease-out' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="font-extrabold leading-none"
            style={{ color, fontSize: size * 0.3 }}
          >
            {value}
          </span>
        </div>
      </div>
      {band && (
        <span className="mt-1.5 text-2xs font-bold uppercase tracking-wider text-ink-muted">
          {band}
        </span>
      )}
    </div>
  );
}
