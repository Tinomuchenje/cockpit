'use client';

import { useEffect, useState } from 'react';
import { useCockpit } from './CockpitProvider';
import { AboutDialog } from './AboutDialog';
import { Board } from './Board';
import { TerminalPane } from './TerminalPane';
import { Toasts } from './Toasts';
import { StatusDot, cx } from './ui';

export function AppShell() {
  const {
    sessions,
    cards,
    projects,
    activeTab,
    setActiveTab,
    connected,
    muted,
    setMuted,
    closeSession,
  } = useCockpit();

  const [showAbout, setShowAbout] = useState(false);

  /*
   * Ctrl/Cmd+1 jumps to the board, 2..9 to the nth session — switching
   * projects shouldn't need the mouse.
   */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > 9) return;
      e.preventDefault();
      if (n === 1) setActiveTab('board');
      else {
        const session = sessions[n - 2];
        if (session) setActiveTab(session.id);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sessions, setActiveTab]);

  /* A closed tab shouldn't leave the shell pointing at nothing. */
  useEffect(() => {
    if (activeTab !== 'board' && !sessions.some((s) => s.id === activeTab)) {
      setActiveTab('board');
    }
  }, [activeTab, sessions, setActiveTab]);

  const attentionCount = sessions.filter(
    (s) => s.status === 'idle' && s.id !== activeTab
  ).length;

  /* Surface the count in the OS tab title, for when Cockpit is in the background. */
  useEffect(() => {
    document.title = attentionCount > 0 ? `(${attentionCount}) Cockpit` : 'Cockpit';
  }, [attentionCount]);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-1 border-b border-line bg-surface px-3">
        <div className="flex items-center gap-2 pr-2">
          <Logo />
          <span className="text-sm font-semibold tracking-tight text-ink">Cockpit</span>
        </div>

        <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          <Tab
            label="Board"
            active={activeTab === 'board'}
            onClick={() => setActiveTab('board')}
          />
          {sessions.map((session) => {
            const card = cards.find((c) => c.id === session.cardId);
            const project = projects.find((p) => p.id === session.projectId);
            return (
              <Tab
                key={session.id}
                label={card?.title ?? project?.displayName ?? 'Session'}
                subLabel={card ? project?.displayName : undefined}
                active={activeTab === session.id}
                status={session.status}
                needsAttention={session.status === 'idle' && activeTab !== session.id}
                onClick={() => setActiveTab(session.id)}
                onClose={() => void closeSession(session.id)}
              />
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2 pl-2">
          <button
            onClick={() => setShowAbout(true)}
            title="What Cockpit does"
            aria-label="What Cockpit does"
            className="rounded-md p-1.5 text-faint transition-colors hover:bg-hover hover:text-ink"
          >
            <HelpIcon />
          </button>
          <button
            onClick={() => setMuted(!muted)}
            title={muted ? 'Sounds are off' : 'Sounds are on'}
            className="rounded-md p-1.5 text-faint transition-colors hover:bg-hover hover:text-ink"
          >
            {muted ? <MuteIcon /> : <SoundIcon />}
          </button>
          <span
            className={cx(
              'flex items-center gap-1.5 text-[11px]',
              connected ? 'text-faint' : 'text-waiting'
            )}
            title={connected ? 'Connected to the Cockpit backend' : 'Reconnecting…'}
          >
            <span
              className={cx(
                'h-1.5 w-1.5 rounded-full',
                connected ? 'bg-live' : 'bg-waiting'
              )}
            />
            {connected ? 'Live' : 'Reconnecting'}
          </span>
        </div>
      </header>

      <main className="relative min-h-0 flex-1">
        {/*
          Every pane stays mounted. Unmounting a terminal on tab switch would
          throw away its xterm buffer and scroll position; the PTY itself lives
          on the backend and is unaffected either way.
        */}
        <div
          className={cx(
            'absolute inset-0 flex flex-col',
            activeTab === 'board' ? 'z-10' : 'invisible -z-10'
          )}
        >
          <Board />
        </div>

        {sessions.map((session) => (
          <div
            key={session.id}
            className={cx(
              'absolute inset-0',
              activeTab === session.id ? 'z-10' : 'invisible -z-10'
            )}
          >
            <TerminalPane
              session={session}
              card={cards.find((c) => c.id === session.cardId)}
              project={projects.find((p) => p.id === session.projectId)}
              active={activeTab === session.id}
            />
          </div>
        ))}
      </main>

      <Toasts />
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
    </div>
  );
}

function Tab({
  label,
  subLabel,
  active,
  status,
  needsAttention,
  onClick,
  onClose,
}: {
  label: string;
  subLabel?: string;
  active: boolean;
  status?: 'running' | 'idle' | 'exited' | 'cancelled';
  needsAttention?: boolean;
  onClick: () => void;
  onClose?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cx(
        'group relative flex h-11 min-w-0 max-w-[220px] cursor-pointer items-center gap-2 px-3 text-xs transition-colors duration-150',
        active ? 'text-ink' : 'text-muted hover:bg-hover hover:text-ink'
      )}
    >
      {status && <StatusDot status={status} />}
      <span className="min-w-0 flex-1 truncate font-medium">
        {label}
        {subLabel && <span className="ml-1.5 text-faint">{subLabel}</span>}
      </span>

      {needsAttention && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-waiting" />
      )}

      {onClose && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          title="End session"
          className="shrink-0 rounded p-0.5 text-faint opacity-0 transition-opacity hover:bg-line hover:text-ink group-hover:opacity-100"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path
              d="M1 1l8 8M9 1l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}

      {/* Active tab indicator sits on the header's bottom border. */}
      <span
        className={cx(
          'absolute inset-x-0 bottom-0 h-0.5 transition-colors duration-150',
          active ? 'bg-accent' : 'bg-transparent'
        )}
      />
    </div>
  );
}

/*
 * The attitude indicator from the app icon, redrawn as vectors. Kept in step
 * with scripts/make-icon.mjs by hand: same bank angle, same pitch offset, same
 * palette. If one changes, change the other.
 */
function Logo() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
      <defs>
        <clipPath id="cp-logo-face">
          <circle cx="10" cy="10" r="8" />
        </clipPath>
      </defs>
      <g clipPath="url(#cp-logo-face)">
        <rect x="0" y="0" width="20" height="20" fill="#2f3542" />
        <g transform="rotate(-11 10 10)">
          <rect x="-6" y="-6" width="32" height="17.9" fill="#7c5cff" />
          <rect x="-6" y="11.9" width="32" height="0.6" fill="#e9ebef" />
        </g>
      </g>
      <circle cx="10" cy="10" r="8" fill="none" stroke="#3d4452" strokeWidth="1.4" />
      <path
        d="M5.8 10h2.1M12.1 10h2.1"
        stroke="#e9ebef"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <circle cx="10" cy="10" r="0.95" fill="#e9ebef" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9.2" />
      <path
        d="M9.4 9.2a2.7 2.7 0 1 1 3.4 2.6c-.5.2-.8.7-.8 1.2v.6"
        strokeLinecap="round"
      />
      <path d="M12 16.8h.01" strokeLinecap="round" />
    </svg>
  );
}

function SoundIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="M15.5 8.5a4 4 0 0 1 0 7" strokeLinecap="round" />
    </svg>
  );
}

function MuteIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="M16 9.5l4 5M20 9.5l-4 5" strokeLinecap="round" />
    </svg>
  );
}
