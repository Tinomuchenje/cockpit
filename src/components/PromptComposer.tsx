'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Kbd } from './ui';

/**
 * The editable prompt box. On a card's first run it arrives pre-filled with the
 * card description — but nothing reaches the PTY until you press send, so you
 * can add context or rewrite it entirely first.
 */
export function PromptComposer({
  initialValue,
  isFirstSend,
  disabled,
  onSend,
  onDismiss,
}: {
  initialValue: string;
  isFirstSend: boolean;
  disabled: boolean;
  onSend: (text: string) => void;
  onDismiss: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Caret at the end so you can keep typing onto the pre-filled text.
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  /* Grow with the content, up to a third of the viewport. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight / 3)}px`;
  }, [value]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter is a newline. Escape hands focus to the terminal.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend(value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onDismiss();
    }
  }

  return (
    <div className="cp-slide-up border-t border-line bg-surface px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs text-muted">
          {isFirstSend ? (
            <>
              Pre-filled from the card. Edit it, then send —{' '}
              <span className="text-faint">nothing runs until you do.</span>
            </>
          ) : (
            'Send a message to this session.'
          )}
        </p>
        <div className="flex items-center gap-1.5 text-[10px] text-faint">
          <Kbd>Enter</Kbd> send
          <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> newline
          <Kbd>Esc</Kbd> terminal
        </div>
      </div>

      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
        spellCheck={false}
        placeholder="What should Claude do?"
        className="w-full resize-none rounded-lg border border-line bg-base px-3 py-2.5 font-mono text-[13px] leading-relaxed text-ink placeholder:text-faint transition-colors duration-150 hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
      />

      <div className="mt-2 flex items-center justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Type in terminal instead
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={disabled || !value.trim()}
          onClick={() => onSend(value)}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
