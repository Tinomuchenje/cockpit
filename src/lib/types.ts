export type Project = {
  id: string;
  displayName: string;
  folderPath: string;
  stack: string | null;
  /** Archived projects stay in the store but drop out of the board by default. */
  archived: boolean;
  createdAt: string;
};

export type ColumnId = 'todo' | 'in_progress' | 'review' | 'done';

export const COLUMNS: { id: ColumnId; label: string; hint: string }[] = [
  { id: 'todo', label: 'To Do', hint: 'Created, not started' },
  { id: 'in_progress', label: 'In Progress', hint: 'A live session is open' },
  { id: 'review', label: 'Review', hint: 'Work done, checking it over' },
  { id: 'done', label: 'Done', hint: 'Committed and pushed' },
];

export type Card = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  column: ColumnId;
  mode: 'terminal' | 'headless';
  claudeSessionId: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type SessionStatus = 'running' | 'idle' | 'exited' | 'cancelled';

export type Session = {
  id: string;
  cardId: string | null;
  projectId: string;
  mode: 'terminal' | 'headless';
  status: SessionStatus;
  claudeSessionId: string | null;
  summary: string | null;
  costUsd: number | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

/** Frames the browser sends up the multiplexed socket. */
export type ClientFrame =
  | { type: 'subscribe'; sessionId: string }
  | { type: 'unsubscribe'; sessionId: string }
  | { type: 'input'; sessionId: string; data: string }
  | { type: 'resize'; sessionId: string; cols: number; rows: number };

/** Frames the backend sends down. */
export type ServerFrame =
  | { type: 'hello'; sessions: Session[] }
  | { type: 'output'; sessionId: string; data: string }
  /** Full scrollback on (re)attach; the client resets the terminal first. */
  | { type: 'replay'; sessionId: string; data: string }
  | {
      type: 'status';
      sessionId: string;
      status: SessionStatus;
      error: string | null;
      /**
       * True only on the first idle/exit of an episode. Drives the chime, while
       * `status` drives the badge — a TUI that repaints itself would otherwise
       * ring on every running->idle flip.
       */
      attention: boolean;
      /** When the current waiting episode began, for the stale-session prompt. */
      idleSince: number | null;
    }
  | { type: 'started'; sessionId: string; session: Session }
  | { type: 'restarted'; sessionId: string }
  | { type: 'closed'; sessionId: string };

export const STATUS_LABEL: Record<SessionStatus, string> = {
  running: 'Working',
  idle: 'Waiting for you',
  exited: 'Ended',
  cancelled: 'Cancelled',
};
