'use client';

import { useEffect, useRef } from 'react';
import type { SessionStatus } from '@/lib/types';

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

/* ----------------------------------------------------------------- button */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
};

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium ' +
  'transition-all duration-150 ease-out disabled:opacity-40 disabled:pointer-events-none ' +
  'active:scale-[0.97] whitespace-nowrap';

const BUTTON_VARIANTS = {
  primary:
    'bg-accent text-white hover:bg-accent-hot shadow-[0_1px_0_0_rgba(255,255,255,0.08)_inset]',
  secondary: 'bg-raised text-ink border border-line hover:bg-hover hover:border-line-strong',
  ghost: 'text-muted hover:text-ink hover:bg-hover',
  danger: 'bg-dead/10 text-dead border border-dead/25 hover:bg-dead/20',
};

const BUTTON_SIZES = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-9 px-3.5 text-sm',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      {...rest}
    />
  );
}

/* ------------------------------------------------------------------ input */

const FIELD =
  'w-full rounded-lg bg-base border border-line px-3 py-2 text-sm text-ink ' +
  'placeholder:text-faint transition-colors duration-150 ' +
  'hover:border-line-strong focus:border-accent focus:outline-none ' +
  'focus:ring-2 focus:ring-accent/25';

export function Input({
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(FIELD, className)} {...rest} />;
}

export function Textarea({
  className,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(FIELD, 'resize-y leading-relaxed', className)} {...rest} />;
}

export function Select({
  className,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(FIELD, 'cursor-pointer', className)} {...rest} />;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-faint">{hint}</span>}
    </label>
  );
}

/* ----------------------------------------------------------------- dialog */

/**
 * Escape closes, the backdrop closes, focus moves inside on open, and the
 * page behind can't scroll while it's up.
 */
export function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the first real control so keyboard users land inside the dialog.
    panelRef.current
      ?.querySelector<HTMLElement>('input, textarea, select, button')
      ?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm cp-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="cp-pop-in w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl shadow-black/60"
      >
        <header className="border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </header>
        <div className="max-h-[65vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex justify-end gap-2 border-t border-line bg-base/40 px-5 py-3.5">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ status dot */

const STATUS_STYLE: Record<SessionStatus, { dot: string; ring: boolean; text: string }> = {
  running: { dot: 'bg-live', ring: true, text: 'text-live' },
  idle: { dot: 'bg-waiting', ring: false, text: 'text-waiting' },
  exited: { dot: 'bg-faint', ring: false, text: 'text-faint' },
  cancelled: { dot: 'bg-faint', ring: false, text: 'text-faint' },
};

export function StatusDot({
  status,
  className,
}: {
  status: SessionStatus;
  className?: string;
}) {
  const style = STATUS_STYLE[status];
  return (
    <span
      className={cx(
        'inline-block h-2 w-2 shrink-0 rounded-full',
        style.dot,
        style.ring && 'cp-pulse',
        className
      )}
    />
  );
}

export function statusTextClass(status: SessionStatus) {
  return STATUS_STYLE[status].text;
}

/* ------------------------------------------------------------ empty state */

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="cp-fade-in flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 text-faint">{icon}</div>}
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {children && (
        <div className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted">{children}</div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* -------------------------------------------------------- keyboard hint */

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-line-strong bg-raised px-1.5 py-0.5 font-mono text-[10px] text-muted">
      {children}
    </kbd>
  );
}
