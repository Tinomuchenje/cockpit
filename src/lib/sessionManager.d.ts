import type { Session, SessionStatus } from './types';

/*
 * Hand-written types for sessionManager.js — same reason as db.d.ts: the
 * implementation is CommonJS so server.js can require it at runtime.
 */

export type ManagerEvent =
  | { type: 'output'; sessionId: string; data: string }
  | { type: 'status'; sessionId: string; status: SessionStatus; error: string | null }
  | { type: 'started'; sessionId: string; session: Session }
  | { type: 'restarted'; sessionId: string }
  | { type: 'closed'; sessionId: string };

export function onEvent(listener: (event: ManagerEvent) => void): () => void;
export function startSession(input: {
  cardId?: string | null;
  projectId: string;
  cols?: number;
  rows?: number;
}): Session;
export function getScrollback(sessionId: string): string;
export function write(sessionId: string, data: string): boolean;
export function resize(sessionId: string, cols: number, rows: number): boolean;
export function restart(sessionId: string): boolean;
export function close(sessionId: string): boolean;
export function listLiveSessions(): Session[];
export function shutdown(): void;
export const IDLE_AFTER_MS: number;
