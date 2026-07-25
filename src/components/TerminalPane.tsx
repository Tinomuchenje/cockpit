'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { Card, Project, Session } from '@/lib/types';
import { STATUS_LABEL } from '@/lib/types';
import { useCockpit } from './CockpitProvider';
import { PromptComposer } from './PromptComposer';
import { Button, StatusDot, cx, statusTextClass } from './ui';

const XTERM_THEME = {
  background: '#0b0c0e',
  foreground: '#e9ebef',
  cursor: '#7c5cff',
  cursorAccent: '#0b0c0e',
  selectionBackground: '#2a2350',
  black: '#12141a',
  red: '#fb7185',
  green: '#34d399',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#2dd4bf',
  white: '#c7ccd6',
  brightBlack: '#646c7a',
  brightRed: '#fda4af',
  brightGreen: '#6ee7b7',
  brightYellow: '#fcd34d',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#5eead4',
  brightWhite: '#f8fafc',
};

const FONT_MIN = 8;
const FONT_MAX = 28;
const FONT_DEFAULT = 13;
const FONT_STORAGE_KEY = 'cockpit.terminalFontSize';

/** How long a session sits waiting before we ask whether you're still on it. */
const STALE_AFTER_MS = 5 * 60 * 1000;

export function TerminalPane({
  session,
  card,
  project,
  active,
}: {
  session: Session;
  card: Card | undefined;
  project: Project | undefined;
  active: boolean;
}) {
  const {
    subscribeOutput,
    sendInput,
    sendResize,
    restartSession,
    closeSession,
    publishScreen,
    idleSince,
  } = useCockpit();

  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const [fontSize, setFontSize] = useState(() => readStoredFont());
  const [staleDismissed, setStaleDismissed] = useState(false);
  /*
   * A ticking clock, not Date.now() in render. Besides being impure, reading
   * the clock during render means the staleness check only re-evaluates when
   * something else happens to re-render this pane — so the nudge might never
   * appear at all.
   */
  const [now, setNow] = useState(0);

  /*
   * The composer is pre-filled from the card description and shown until you
   * send it. Nothing is written to the PTY until you explicitly hit send —
   * per spec, a run must never auto-fire a prompt.
   */
  const [composerOpen, setComposerOpen] = useState(Boolean(card?.description?.trim()));
  const [hasSent, setHasSent] = useState(false);

  /* Tick only while this session is waiting; nothing else needs a timer. */
  useEffect(() => {
    if (session.status !== 'idle') return;
    // First read is queued rather than synchronous, to avoid a cascading render.
    const first = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [session.status]);

  const refit = useCallback(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    const host = hostRef.current;
    // A hidden pane measures zero; skip until it's back on screen.
    if (!term || !fit || !host || host.offsetParent === null) return;
    try {
      fit.fit();
      sendResize(session.id, term.cols, term.rows);
    } catch {
      // Fit can throw mid-teardown; harmless.
    }
  }, [session.id, sendResize]);

  const zoom = useCallback((next: number | 'reset') => {
    const value =
      next === 'reset' ? FONT_DEFAULT : Math.min(FONT_MAX, Math.max(FONT_MIN, next));
    setFontSize(persistFont(value));
  }, []);

  /* ------------------------------------------------------ xterm lifecycle */

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new XTerm({
      cursorBlink: true,
      fontFamily:
        'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: FONT_DEFAULT,
      lineHeight: 1.35,
      theme: XTERM_THEME,
      allowProposedApi: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    termRef.current = term;
    fitRef.current = fit;

    const disposeInput = term.onData((data) => sendInput(session.id, data));

    // Ctrl/Cmd +/-/0 zoom the terminal instead of the whole page, which is what
    // every other terminal does. Returning false stops xterm passing it on.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown' || !(event.ctrlKey || event.metaKey)) return true;
      if (event.key === '=' || event.key === '+') {
        event.preventDefault();
        setFontSize((c) => persistFont(Math.min(FONT_MAX, c + 1)));
        return false;
      }
      if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        setFontSize((c) => persistFont(Math.max(FONT_MIN, c - 1)));
        return false;
      }
      if (event.key === '0') {
        event.preventDefault();
        setFontSize(persistFont(FONT_DEFAULT));
        return false;
      }
      return true;
    });

    // `replay` arrives on (re)attach and carries the whole scrollback, so
    // reset first — that keeps a double subscribe from rendering it twice.
    const unsubscribe = subscribeOutput(session.id, (data, isReplay) => {
      if (isReplay) term.reset();
      term.write(data);
    });

    return () => {
      unsubscribe();
      disposeInput.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [session.id, sendInput, subscribeOutput]);

  /* Apply zoom changes and reflow the PTY to the new geometry. */
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    refit();
  }, [fontSize, refit]);

  /* --------------------------------------------------------------- sizing */

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(refit);
    observer.observe(host);
    return () => observer.disconnect();
  }, [refit]);

  /* Re-fit and focus when this tab comes to the front. */
  useEffect(() => {
    if (!active) return;
    const raf = requestAnimationFrame(() => {
      refit();
      if (!composerOpen) termRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [active, composerOpen, refit]);

  /*
   * Publish the rendered screen so the board's attention panel can show what
   * this session is asking. Read out of xterm's own buffer rather than parsed
   * from raw bytes server-side: the TUI repaints regions, so the byte stream
   * tail isn't the same as what's actually on screen.
   */
  useEffect(() => {
    if (session.status !== 'idle') return;

    function capture() {
      const term = termRef.current;
      if (!term) return;
      const buffer = term.buffer.active;
      /*
       * Only the viewport — buffer.length counts the whole scrollback, and
       * reading all of it meant the panel showed the bottom border of Claude's
       * input box rather than the question above it. baseY is the first row
       * currently on screen.
       */
      const lines: string[] = [];
      for (let y = buffer.baseY; y < buffer.baseY + term.rows; y++) {
        lines.push(buffer.getLine(y)?.translateToString(true) ?? '');
      }
      publishScreen(session.id, lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd());
    }

    // Small delay so the final repaint has landed before we snapshot.
    const timer = setTimeout(capture, 250);
    return () => clearTimeout(timer);
  }, [session.status, session.id, publishScreen]);

  /* ---------------------------------------------------------------- send */

  function handleSend(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    /*
     * Wrap in bracketed-paste markers so Claude Code's TUI treats embedded
     * newlines as literal content. Sending a multi-line string raw would make
     * the first newline submit, truncating the prompt.
     */
    sendInput(session.id, `\x1b[200~${trimmed}\x1b[201~`);

    // Let the TUI absorb the paste before submitting it.
    setTimeout(() => sendInput(session.id, '\r'), 60);

    setHasSent(true);
    setComposerOpen(false);
    requestAnimationFrame(() => termRef.current?.focus());
  }

  const dead = session.status === 'exited' || session.status === 'cancelled';

  /* Long-idle nudge, so forgotten sessions don't pile up invisibly. */
  const waitingSince = idleSince[session.id];
  const waitedMs = waitingSince && now ? now - waitingSince : 0;
  const isStale = !staleDismissed && session.status === 'idle' && waitedMs > STALE_AFTER_MS;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <StatusDot status={session.status} />
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h2 className="truncate text-sm font-medium text-ink">
                {card?.title ?? project?.displayName ?? 'Session'}
              </h2>
              <span
                className={cx('text-[11px] font-medium', statusTextClass(session.status))}
              >
                {STATUS_LABEL[session.status]}
              </span>
            </div>
            <p
              className="truncate font-mono text-[11px] text-faint"
              title={project?.folderPath}
            >
              {project?.folderPath}
            </p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {/* zoom */}
          <div className="flex items-center rounded-lg border border-line">
            <button
              onClick={() => zoom(fontSize - 1)}
              disabled={fontSize <= FONT_MIN}
              title="Zoom out (Ctrl -)"
              className="px-2 py-1 text-muted transition-colors hover:text-ink disabled:opacity-30"
            >
              <MinusIcon />
            </button>
            <button
              onClick={() => zoom('reset')}
              title="Reset zoom (Ctrl 0)"
              className="min-w-[2.25rem] border-x border-line px-1 py-1 font-mono text-[10px] text-faint transition-colors hover:text-ink"
            >
              {fontSize}px
            </button>
            <button
              onClick={() => zoom(fontSize + 1)}
              disabled={fontSize >= FONT_MAX}
              title="Zoom in (Ctrl +)"
              className="px-2 py-1 text-muted transition-colors hover:text-ink disabled:opacity-30"
            >
              <PlusIcon />
            </button>
          </div>

          {!composerOpen && (
            <Button size="sm" variant="ghost" onClick={() => setComposerOpen(true)}>
              Compose
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void restartSession(session.id)}
            title="Kill and respawn claude in place — picks up new MCPs, hooks and skills"
          >
            Restart
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="hover:text-dead"
            onClick={() => void closeSession(session.id)}
            title="End this session and close the tab"
          >
            Close
          </Button>
        </div>
      </header>

      {session.error && (
        <p className="border-b border-dead/25 bg-dead/10 px-4 py-2 text-xs text-dead">
          {session.error}
        </p>
      )}

      {isStale && (
        <div className="cp-fade-in flex flex-wrap items-center gap-2 border-b border-waiting/25 bg-waiting/[0.06] px-4 py-2">
          <p className="text-xs text-waiting">
            This session has been waiting {Math.round(waitedMs / 60000)} minutes. Still
            working on it?
          </p>
          <div className="ml-auto flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setStaleDismissed(true)}>
              Still working
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void closeSession(session.id)}
            >
              Close session
            </Button>
          </div>
        </div>
      )}

      <div
        className="relative min-h-0 flex-1 overflow-hidden bg-base"
        onWheel={(e) => {
          // Ctrl+wheel zoom, as terminals and editors do.
          if (!(e.ctrlKey || e.metaKey)) return;
          e.preventDefault();
          zoom(fontSize + (e.deltaY < 0 ? 1 : -1));
        }}
      >
        <div ref={hostRef} className="absolute inset-0 px-3 py-2" />
      </div>

      {composerOpen && (
        <PromptComposer
          initialValue={hasSent ? '' : (card?.description ?? '')}
          isFirstSend={!hasSent && Boolean(card?.description?.trim())}
          disabled={dead}
          onSend={handleSend}
          onDismiss={() => {
            setComposerOpen(false);
            requestAnimationFrame(() => termRef.current?.focus());
          }}
        />
      )}
    </div>
  );
}

/** Keep localStorage in step wherever zoom changes from. */
function persistFont(value: number) {
  window.localStorage.setItem(FONT_STORAGE_KEY, String(value));
  return value;
}

/**
 * Zoom is read during the initial useState so the terminal is created at the
 * right size, instead of mounting at the default and resizing a frame later.
 */
function readStoredFont() {
  if (typeof window === 'undefined') return FONT_DEFAULT;
  const stored = Number(window.localStorage.getItem(FONT_STORAGE_KEY));
  return stored >= FONT_MIN && stored <= FONT_MAX ? stored : FONT_DEFAULT;
}

function MinusIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
      <path d="M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}
