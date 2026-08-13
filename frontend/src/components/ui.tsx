import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Check, Info, Loader2, MoreVertical, X } from 'lucide-react';

// Shared primitives. Everything visual in the app is built from these so a
// spacing or colour change happens in exactly one place.

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

/**
 * Per-item mount delay for a `.stagger` list. Capped so a hundred-row list does
 * not take five seconds to finish appearing.
 */
export function stagger(index: number): React.CSSProperties {
  return { '--i': Math.min(index, 12) } as React.CSSProperties;
}

// --- Logo -----------------------------------------------------------------

export function Logo({ compact = false, light = false }: { compact?: boolean; light?: boolean }) {
  return (
    <span className="group inline-flex items-center gap-2.5">
      <span className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center">
        {/* Rounded-square mark. The two dots are the "motion": one settled, one
            still travelling, and they close the gap on hover. */}
        <span
          className="absolute inset-0 rounded-[10px] bg-brand-gradient shadow-brand transition-transform duration-500 ease-swift group-hover:scale-105"
          aria-hidden
        />
        <span className="relative inline-block h-3.5 w-6">
          <span className="absolute left-0 top-0 h-3.5 w-3.5 rounded-full bg-white/95" />
          <span className="absolute right-0 top-0 h-3.5 w-3.5 rounded-full bg-white/50 transition-all duration-500 ease-swift group-hover:right-0.5" />
        </span>
      </span>

      {!compact && (
        <span className="text-[17px] font-extrabold leading-none tracking-tighter">
          <span className={light ? 'text-white' : 'text-ink'}>sales</span>
          <span className={light ? 'text-brand-300' : 'text-brand-600'}>motion</span>
        </span>
      )}
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
        Icon && <Icon size={size === 'sm' ? 14 : 16} className="shrink-0" />
      )}
      {children}
    </button>
  );
}

// --- Surfaces -------------------------------------------------------------

export function Card({
  className,
  interactive = false,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div {...rest} className={cx('card', interactive && 'card-interactive', className)}>
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
      <div className="min-w-0 animate-fade-in-up">
        {eyebrow && (
          <p className="eyebrow mb-1.5 flex items-center gap-1.5 text-brand-600">
            <span className="h-1 w-1 rounded-full bg-brand-500" aria-hidden />
            {eyebrow}
          </p>
        )}
        <h1 className="text-[28px] font-extrabold leading-[1.15] tracking-tighter text-ink">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-ink-muted">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 animate-fade-in-up">{actions}</div>
      )}
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

/**
 * Live status dot with an expanding halo. Used wherever something is actively
 * running - it reads as "in progress" without needing a word next to it.
 */
export function PulseDot({ tone = 'brand' }: { tone?: 'brand' | 'green' | 'amber' | 'red' }) {
  const colors = {
    brand: 'bg-brand-500',
    green: 'bg-emerald-500',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
  };
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0" aria-hidden>
      <span className={cx('absolute inset-0 rounded-full animate-pulse-ring', colors[tone])} />
      <span className={cx('relative inline-flex h-2 w-2 rounded-full', colors[tone])} />
    </span>
  );
}

export function Alert({
  tone = 'info',
  children,
  onDismiss,
}: {
  // 'warning' is for something that failed without costing the reader anything -
  // a refresh that did not land over a report they can still read. Red would
  // claim more than happened.
  tone?: 'info' | 'warning' | 'error' | 'success';
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  const tones = {
    info: 'border-brand-200 bg-brand-50 text-brand-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    error: 'border-red-200 bg-red-50 text-red-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  };
  const chips = {
    info: 'bg-brand-500/15 text-brand-600',
    warning: 'bg-amber-500/15 text-amber-600',
    error: 'bg-red-500/15 text-red-600',
    success: 'bg-emerald-500/15 text-emerald-600',
  };
  const Icon =
    tone === 'error' || tone === 'warning' ? AlertCircle : tone === 'success' ? Check : Info;

  return (
    <div
      role="status"
      className={cx(
        'flex animate-slide-down items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-card',
        tones[tone]
      )}
    >
      <span
        className={cx(
          'mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-lg',
          chips[tone]
        )}
      >
        <Icon size={14} />
      </span>
      <div className="min-w-0 flex-1 pt-0.5 leading-relaxed">{children}</div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mr-1 shrink-0 rounded-lg p-1 opacity-60 transition hover:bg-black/5 hover:opacity-100"
        >
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
    <div className="card animate-fade-in-up flex flex-col items-center overflow-hidden px-6 py-16 text-center">
      {/* Halo behind the glyph - stops a lone grey icon reading as an error */}
      <div className="relative mb-5 flex h-16 w-16 items-center justify-center">
        <span
          className="absolute inset-0 rounded-2xl bg-brand-500/10 blur-xl"
          aria-hidden
        />
        <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-surface shadow-card">
          <Icon size={24} className="text-brand-500" />
        </span>
      </div>
      <h3 className="text-[17px] font-bold tracking-tight text-ink">{title}</h3>
      {description && (
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-ink-muted">
      <span className="relative flex h-9 w-9 items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-brand-500/10 blur-md" aria-hidden />
        <Loader2 size={22} className="relative animate-spin text-brand-500" />
      </span>
      <span className="font-medium">{label || 'Loading…'}</span>
    </div>
  );
}

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="card card-pad shimmer" style={stagger(i)}>
          <div className="flex items-center gap-4">
            <div className="h-11 w-11 shrink-0 rounded-xl bg-slate-200" />
            <div className="min-w-0 flex-1">
              <div className="h-3.5 w-1/3 rounded-full bg-slate-200" />
              <div className="mt-2.5 h-3 w-2/3 rounded-full bg-slate-100" />
            </div>
          </div>
          <div className="mt-4 h-3 w-1/2 rounded-full bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

/**
 * Determinate bar when the server has reported a percentage, an indeterminate
 * sweep when it has not - a bar frozen at 10% reads as a stalled job.
 */
export function ProgressBar({
  percent,
  className,
}: {
  percent?: number;
  className?: string;
}) {
  const known = typeof percent === 'number' && percent > 0;

  return (
    <div
      className={cx('h-1.5 w-full overflow-hidden rounded-full bg-slate-100', className)}
      role="progressbar"
      aria-valuenow={known ? percent : undefined}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {known ? (
        <div
          className="h-full rounded-full bg-brand-gradient transition-[width] duration-700 ease-swift"
          style={{ width: `${Math.min(100, percent!)}%` }}
        />
      ) : (
        <div className="h-full w-1/4 animate-progress-sweep rounded-full bg-brand-gradient" />
      )}
    </div>
  );
}

// --- Overflow menu ----------------------------------------------------------

export interface MenuAction {
  label: string;
  icon?: React.ElementType;
  onClick: () => void;
  /** Renders in red and sits below a divider - destructive actions only. */
  danger?: boolean;
  disabled?: boolean;
  /** Left out of the menu entirely. Cheaper at the call site than filtering. */
  hidden?: boolean;
  hint?: string;
}

const MENU_WIDTH = 224; // w-56
const MENU_GAP = 8;

/**
 * A "…" button holding the actions that do not deserve permanent space.
 *
 * Rows used to stack every action as its own button, which set the height of
 * the whole tile by the number of things you could do to it rather than by how
 * much there was to read. One primary action stays out in the open; the rest
 * live here.
 *
 * The panel is rendered into <body> rather than beside the button. Every card
 * it is used on sets `overflow-hidden` - for the rounded progress strip along
 * the bottom - and an absolutely positioned menu inside one is cropped at the
 * card's edge. That silently hid the last items: a five-item menu on a short
 * card showed three, so "Remove" simply was not there. A portal cannot be
 * clipped by an ancestor, whatever that ancestor's overflow is set to.
 */
export function OverflowMenu({
  actions,
  label = 'More actions',
  align = 'right',
}: {
  actions: MenuAction[];
  label?: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top?: number; bottom?: number; left: number } | null>(null);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const visible = actions.filter((a) => !a.hidden);
  const normal = visible.filter((a) => !a.danger);
  const destructive = visible.filter((a) => a.danger);

  // Anchored to the trigger in viewport coordinates, so the panel tracks the
  // button when the page behind it scrolls instead of drifting off it.
  const place = useCallback(() => {
    const box = buttonRef.current?.getBoundingClientRect();
    if (!box) return;

    // Enough to decide which way to open. The panel then sizes itself: an
    // upward menu is pinned by its bottom edge, so its height is never guessed.
    const estimated = visible.length * 40 + 24;
    const dropUp = window.innerHeight - box.bottom < estimated && box.top > estimated;

    const left =
      align === 'right'
        ? Math.max(MENU_GAP, box.right - MENU_WIDTH)
        : Math.min(box.left, window.innerWidth - MENU_WIDTH - MENU_GAP);

    setPosition(
      dropUp
        ? { bottom: window.innerHeight - box.top + MENU_GAP, left }
        : { top: box.bottom + MENU_GAP, left }
    );
  }, [align, visible.length]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;

    // The panel is not a descendant of the trigger any more, so an outside
    // click has to clear both.
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    // Capture phase: the page scrolls inside <main>, not on window, and a
    // bubbling listener never sees that.
    const onScroll = () => place();

    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);

    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, place]);

  if (visible.length === 0) return null;

  const renderItem = (action: MenuAction, i: number) => {
    const Icon = action.icon;
    return (
      <button
        key={`${action.label}-${i}`}
        role="menuitem"
        disabled={action.disabled}
        title={action.hint}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(false);
          action.onClick();
        }}
        className={cx(
          'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition',
          'disabled:cursor-not-allowed disabled:opacity-45',
          action.danger
            ? 'text-red-600 hover:bg-red-50'
            : 'text-ink-soft hover:bg-slate-50 hover:text-ink'
        )}
      >
        {Icon && <Icon size={15} className="shrink-0" />}
        {action.label}
      </button>
    );
  };

  return (
    <>
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className={cx(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-all duration-200',
          open
            ? 'border-slate-300 bg-slate-100 text-ink'
            : 'border-slate-200 bg-surface text-ink-muted hover:border-slate-300 hover:bg-slate-50 hover:text-ink'
        )}
      >
        <MoreVertical size={16} />
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            onClick={(e) => e.stopPropagation()}
            style={{ top: position.top, bottom: position.bottom, left: position.left, width: MENU_WIDTH }}
            className={cx(
              'fixed z-[60] animate-scale-in rounded-2xl border border-slate-200 bg-surface p-1.5 shadow-pop',
              position.bottom !== undefined ? 'origin-bottom' : 'origin-top'
            )}
          >
            {normal.map(renderItem)}
            {destructive.length > 0 && normal.length > 0 && (
              <div className="my-1 h-px bg-slate-100" role="separator" />
            )}
            {destructive.map(renderItem)}
          </div>,
          document.body
        )}
    </>
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
        className="fixed inset-0 animate-fade-in bg-navy-950/55 backdrop-blur-[3px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cx(
          'relative my-auto w-full animate-scale-in rounded-2xl border border-slate-200/70 bg-surface shadow-pop',
          size === 'lg' ? 'max-w-3xl' : 'max-w-xl'
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-[17px] font-bold tracking-tight text-ink">{title}</h2>
            {description && (
              <p className="mt-1 text-[13.5px] leading-relaxed text-ink-muted">{description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="btn btn-ghost -mr-2 h-8 w-8 rounded-lg p-0"
          >
            <X size={17} />
          </button>
        </div>

        <div className="max-h-[calc(100vh-16rem)] overflow-y-auto px-6 py-5">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2 rounded-b-2xl border-t border-slate-200 bg-surface-2 px-6 py-4">
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
        <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-red-600">
          <AlertCircle size={12} className="shrink-0" />
          {error}
        </p>
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
        className="flex max-h-40 min-h-[46px] w-full cursor-text flex-wrap items-center gap-1.5 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-surface px-2.5 py-2 shadow-inset transition focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/10 hover:border-slate-300"
      >
        {value.map((tag, i) => (
          <span
            key={`${tag}-${i}`}
            className="inline-flex animate-scale-in items-center gap-1 rounded-lg bg-brand-50 py-1 pl-2.5 pr-1 text-[13px] font-medium text-brand-700 ring-1 ring-inset ring-brand-200"
          >
            {tag}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                remove(i);
              }}
              className="rounded p-0.5 text-brand-500 transition hover:bg-brand-100 hover:text-brand-700"
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
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="eyebrow text-ink-faint">Suggested</span>
          {unusedSuggestions.slice(0, 8).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="rounded-lg border border-dashed border-slate-300 px-2 py-0.5 text-[12px] text-ink-muted transition hover:-translate-y-px hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700"
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

/**
 * The fit score. The arc sweeps and the number counts up on mount, so the
 * headline metric of the whole product arrives with some weight behind it.
 */
export function ScoreRing({
  value,
  band,
  size = 88,
}: {
  value: number;
  band?: string;
  size?: number;
}) {
  // Two rings on one page must not share a gradient id, or the second wins
  const gradientId = `score-${useId().replace(/:/g, '')}`;

  const stroke = size >= 80 ? 8 : 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const target = Math.max(0, Math.min(100, value));

  // Count-up. Starts from 0 on every mount rather than tweening between values,
  // because the score only ever changes by way of a fresh report.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setShown(target);
      return;
    }

    let frame = 0;
    const start = performance.now();
    const duration = 900;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // Ease-out cubic: fast to begin, gentle at the finish
      setShown(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  const [from, to] =
    target >= 80
      ? ['#10b981', '#059669']
      : target >= 60
      ? ['#3b82f6', '#4f46e5']
      : target >= 40
      ? ['#f59e0b', '#ea580c']
      : ['#94a3b8', '#64748b'];

  return (
    <div className="inline-flex flex-col items-center">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90 overflow-visible">
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={from} />
              <stop offset="100%" stopColor={to} />
            </linearGradient>
          </defs>

          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            className="stroke-slate-200"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - shown / 100)}
            style={{ filter: `drop-shadow(0 1px 4px ${to}55)` }}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="font-extrabold leading-none tracking-tighter tabular-nums"
            style={{ color: to, fontSize: size * 0.31 }}
          >
            {shown}
          </span>
        </div>
      </div>

      {band && (
        <span className="eyebrow mt-2 text-center text-ink-muted">{band}</span>
      )}
    </div>
  );
}
