import type { Card, ColumnId, Project, Session, SessionStatus } from './types';

/*
 * Hand-written types for db.js. That module stays CommonJS JavaScript because
 * server.js requires it at runtime, outside the Next/TS build — but everything
 * importing it from the app gets real type checking through this declaration.
 */

export function listProjects(): Project[];
export function getProject(id: string): Project | undefined;
export function findProjectByPath(folderPath: string): Project | undefined;
export function createProject(input: {
  displayName: string;
  folderPath: string;
  stack?: string | null;
}): Project;
export function updateProject(
  id: string,
  updates: Partial<Pick<Project, 'displayName' | 'folderPath' | 'stack' | 'archived'>>
): Project | null;
export function deleteProject(id: string): boolean;

export function listCards(): Card[];
export function getCard(id: string): Card | undefined;
export function createCard(input: {
  projectId: string;
  title: string;
  description?: string;
  column?: ColumnId;
}): Card;
export function updateCard(
  id: string,
  updates: Partial<
    Pick<
      Card,
      'title' | 'description' | 'column' | 'mode' | 'claudeSessionId' | 'position'
    >
  >
): Card | null;
export function deleteCard(id: string): boolean;

export function listSessions(): Session[];
export function getSession(id: string): Session | undefined;
export function createSession(input: {
  id?: string;
  cardId?: string | null;
  projectId: string;
  mode?: 'terminal' | 'headless';
}): Session;
export function updateSession(
  id: string,
  updates: Partial<
    Pick<
      Session,
      'status' | 'claudeSessionId' | 'summary' | 'costUsd' | 'error' | 'finishedAt'
    >
  >
): Session | null;
export function deleteSession(id: string): void;
export function reapStaleSessions(): void;

export type { Card, ColumnId, Project, Session, SessionStatus };
