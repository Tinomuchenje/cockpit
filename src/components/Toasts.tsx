'use client';

import { useCockpit } from './CockpitProvider';
import { cx } from './ui';

const TONE = {
  info: 'border-line bg-raised text-ink',
  good: 'border-live/25 bg-live/10 text-live',
  bad: 'border-dead/25 bg-dead/10 text-dead',
};

export function Toasts() {
  const { toasts, dismissToast } = useCockpit();

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          onClick={() => dismissToast(toast.id)}
          className={cx(
            'cp-slide-up pointer-events-auto max-w-md rounded-xl border px-4 py-2.5 text-left text-xs leading-relaxed shadow-xl shadow-black/40 backdrop-blur-sm transition-opacity hover:opacity-80',
            TONE[toast.tone]
          )}
        >
          {toast.message}
        </button>
      ))}
    </div>
  );
}
