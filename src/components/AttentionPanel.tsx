'use client';

import { useState } from 'react';
import type { Card, Project, Session } from '@/lib/types';
import { useCockpit } from './CockpitProvider';
import { Button, Kbd, cx } from './ui';

/**
 * Board-side triage for sessions that are waiting on you.
 *
 * Shows the tail of what each waiting session has on screen — usually a
 * permission prompt or a question — and lets you answer it here. The point is
 * to clear a queue of prompts without hopping between tabs.
 *
 * The screen text comes from each session's xterm buffer (the panes stay
 * mounted), so it's the real rendered screen rather than a guess at parsing
 * raw escape codes server-side.
 */
export function AttentionPanel({
  sessions,
  cards,
  projects,
  onOpenSession,
}: {
  sessions: Session[];
  cards: Card[];
  projects: Project[];
  onOpenSession: (sessionId: string) => void;
}) {
  const waiting = sessions.filter((s) => s.status === 'idle');
  const [collapsed, setCollapsed] = useState(false);

  if (waiting.length === 0) return null;

  return (
    <div className="mx-4 mb-3 overflow-hidden rounded-xl border border-waiting/25 bg-waiting/[0.04]">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-waiting/[0.06]"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-waiting" />
        <span className="text-xs font-medium text-waiting">
          {waiting.length} {waiting.length === 1 ? 'session is' : 'sessions are'} waiting on
          you
        </span>
        <ChevronIcon className={cx('ml-auto text-faint', collapsed && '-rotate-90')} />
      </button>

      {!collapsed && (
        <div className="space-y-2 px-2 pb-2">
          {waiting.map((session) => (
            <WaitingSession
              key={session.id}
              session={session}
              card={cards.find((c) => c.id === session.cardId)}
              project={projects.find((p) => p.id === session.projectId)}
              onOpen={() => onOpenSession(session.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WaitingSession({
  session,
  card,
  project,
  onOpen,
}: {
  session: Session;
  card: Card | undefined;
  project: Project | undefined;
  onOpen: () => void;
}) {
  const { screens, sendInput } = useCockpit();
  const [reply, setReply] = useState('');

  const screen = screens[session.id] ?? '';
  /*
   * Claude Code draws borders, banners and ASCII-art logos. Rather than
   * enumerating box-drawing and block glyphs (which missed ▛███▜ style art),
   * judge each line by how much actual text it carries: fewer than three
   * word characters means it's decoration, not a question.
   */
  const tail = screen
    .split('\n')
    // Drop the box-drawing frame from each line's edges; it's pure chrome here.
    .map((l) => l.replace(/^[\s│┃|]+/u, '').replace(/[\s│┃|]+$/u, ''))
    .filter((l) => (l.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 3)
    .slice(-10);

  function send(data: string) {
    sendInput(session.id, data);
  }

  function sendReply() {
    if (!reply.trim()) return;
    send(`\x1b[200~${reply.trim()}\x1b[201~`);
    setTimeout(() => send('\r'), 60);
    setReply('');
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-2.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="min-w-0 truncate text-xs font-medium text-ink">
          {card?.title ?? project?.displayName ?? 'Session'}
        </span>
        {card && project && (
          <span className="shrink-0 text-[10px] text-faint">{project.displayName}</span>
        )}
        <Button size="sm" variant="ghost" className="ml-auto shrink-0" onClick={onOpen}>
          Open tab
        </Button>
      </div>

      {tail.length > 0 ? (
        <pre className="mb-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-base px-2.5 py-2 font-mono text-[11px] leading-relaxed text-muted">
          {tail.join('\n')}
        </pre>
      ) : (
        <p className="mb-2 rounded-md bg-base px-2.5 py-2 text-[11px] text-faint">
          Nothing on screen yet.
        </p>
      )}

      {/*
        Claude Code's prompts are numbered menus confirmed with Enter, so the
        quick keys cover the common cases; the text box handles everything else.
      */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="secondary" onClick={() => send('1\r')} title="Choose option 1">
          1
        </Button>
        <Button size="sm" variant="secondary" onClick={() => send('2\r')} title="Choose option 2">
          2
        </Button>
        <Button size="sm" variant="secondary" onClick={() => send('\r')} title="Press Enter">
          <Kbd>Enter</Kbd>
        </Button>
        <Button size="sm" variant="ghost" onClick={() => send('\x1b')} title="Press Escape">
          <Kbd>Esc</Kbd>
        </Button>

        <input
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              sendReply();
            }
          }}
          placeholder="or type a reply…"
          className="min-w-0 flex-1 rounded-md border border-line bg-base px-2.5 py-1.5 font-mono text-[11px] text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
        <Button size="sm" variant="primary" disabled={!reply.trim()} onClick={sendReply}>
          Send
        </Button>
      </div>
    </div>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      className={cx('transition-transform duration-150', className)}
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
