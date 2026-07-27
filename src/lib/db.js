/*
 * Store for projects, cards and sessions.
 *
 * Uses Node's built-in node:sqlite rather than better-sqlite3: the latter has
 * no prebuilt binary for this Node/Windows pair and needs a C++ toolchain to
 * compile, which this machine doesn't have. node:sqlite needs no native build.
 *
 * Plain CommonJS (not TS) because server.js requires this at runtime outside
 * the Next build. Types live in cockpit.d.ts.
 */
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/*
 * COCKPIT_DATA_DIR lets you point an instance at a throwaway database, so you
 * can run a scratch Cockpit on another port without touching your real board.
 */
const dataDir = process.env.COCKPIT_DATA_DIR
  ? path.resolve(process.env.COCKPIT_DATA_DIR)
  : path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'cockpit.db'));

/*
 * Next's build-time "collecting page data" step imports every API route in
 * several worker processes at once, each of which requires this module and
 * opens its own connection to the same file. node:sqlite has no busy
 * timeout by default, so two of those connections hitting the schema setup
 * below at the same instant throws "database is locked" instead of one
 * waiting for the other. WAL plus a timeout makes that a wait, not an error.
 */
// busy_timeout first: unlike journal_mode, it never touches the database
// file, so it's always safe and is what makes the WAL switch below retry
// instead of failing the instant another worker holds the write lock.
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    displayName TEXT NOT NULL,
    folderPath TEXT NOT NULL,
    stack TEXT,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL REFERENCES projects(id),
    title TEXT NOT NULL,
    description TEXT,
    "column" TEXT NOT NULL DEFAULT 'todo',
    mode TEXT NOT NULL DEFAULT 'terminal',
    claudeSessionId TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    cardId TEXT REFERENCES cards(id),
    projectId TEXT NOT NULL REFERENCES projects(id),
    mode TEXT NOT NULL DEFAULT 'terminal',
    status TEXT NOT NULL DEFAULT 'running',
    claudeSessionId TEXT,
    summary TEXT,
    costUsd REAL,
    error TEXT,
    startedAt TEXT NOT NULL,
    finishedAt TEXT
  );
`);

/*
 * Additive migrations. Earlier builds shipped a cards table without
 * `position`, and there is real data in the wild (a board the user has
 * already filled in), so add columns in place rather than recreating.
 */
function columnNames(table) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);
}

function addColumnIfMissing(table, name, definition) {
  if (!columnNames(table).includes(name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    return true;
  }
  return false;
}

if (addColumnIfMissing('cards', 'position', 'REAL')) {
  // Backfill ordering for pre-existing cards from their creation order.
  const existing = db.prepare('SELECT id FROM cards ORDER BY createdAt ASC').all();
  const setPos = db.prepare('UPDATE cards SET position = ? WHERE id = ?');
  existing.forEach((row, i) => setPos.run((i + 1) * 1000, row.id));
}

addColumnIfMissing('projects', 'archived', 'INTEGER NOT NULL DEFAULT 0');

const now = () => new Date().toISOString();

/* ---------------------------------------------------------------- projects */

/* SQLite has no boolean type, so archived round-trips as 0/1. */
function hydrateProject(row) {
  return row ? { ...row, archived: Boolean(row.archived) } : row;
}

function listProjects() {
  return db
    .prepare('SELECT * FROM projects ORDER BY archived ASC, createdAt ASC')
    .all()
    .map(hydrateProject);
}

function getProject(id) {
  return hydrateProject(db.prepare('SELECT * FROM projects WHERE id = ?').get(id));
}

function findProjectByPath(folderPath) {
  return hydrateProject(
    db.prepare('SELECT * FROM projects WHERE folderPath = ?').get(folderPath)
  );
}

function createProject({ displayName, folderPath, stack }) {
  const project = {
    id: crypto.randomUUID(),
    displayName,
    folderPath,
    stack: stack || null,
    archived: false,
    createdAt: now(),
  };
  db.prepare(
    `INSERT INTO projects (id, displayName, folderPath, stack, archived, createdAt)
     VALUES (?, ?, ?, ?, 0, ?)`
  ).run(
    project.id,
    project.displayName,
    project.folderPath,
    project.stack,
    project.createdAt
  );
  return project;
}

function updateProject(id, updates) {
  const existing = getProject(id);
  if (!existing) return null;
  const next = { ...existing, ...updates };
  db.prepare(
    'UPDATE projects SET displayName = ?, folderPath = ?, stack = ?, archived = ? WHERE id = ?'
  ).run(next.displayName, next.folderPath, next.stack, next.archived ? 1 : 0, id);
  return next;
}

/* Deleting a project takes its cards and session records with it. */
function deleteProject(id) {
  const existing = getProject(id);
  if (!existing) return false;
  db.prepare('DELETE FROM sessions WHERE projectId = ?').run(id);
  db.prepare('DELETE FROM cards WHERE projectId = ?').run(id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  return true;
}

/* ------------------------------------------------------------------- cards */

function listCards() {
  return db
    .prepare('SELECT * FROM cards ORDER BY position ASC, createdAt ASC')
    .all();
}

function getCard(id) {
  return db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
}

function nextPosition(column) {
  const row = db
    .prepare('SELECT MAX(position) AS maxPos FROM cards WHERE "column" = ?')
    .get(column);
  return (row?.maxPos ?? 0) + 1000;
}

function createCard({ projectId, title, description, column }) {
  const stamp = now();
  const col = column || 'todo';
  const card = {
    id: crypto.randomUUID(),
    projectId,
    title,
    description: description || '',
    column: col,
    mode: 'terminal',
    claudeSessionId: null,
    position: nextPosition(col),
    createdAt: stamp,
    updatedAt: stamp,
  };
  db.prepare(
    `INSERT INTO cards
       (id, projectId, title, description, "column", mode, claudeSessionId, position, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    card.id,
    card.projectId,
    card.title,
    card.description,
    card.column,
    card.mode,
    card.claudeSessionId,
    card.position,
    card.createdAt,
    card.updatedAt
  );
  return card;
}

function updateCard(id, updates) {
  const existing = getCard(id);
  if (!existing) return null;

  // Moving to a different column without an explicit position appends to it.
  const movingColumn = updates.column && updates.column !== existing.column;
  const position =
    updates.position ??
    (movingColumn ? nextPosition(updates.column) : existing.position);

  const next = { ...existing, ...updates, position, updatedAt: now() };

  db.prepare(
    `UPDATE cards
        SET title = ?, description = ?, "column" = ?, mode = ?,
            claudeSessionId = ?, position = ?, updatedAt = ?
      WHERE id = ?`
  ).run(
    next.title,
    next.description,
    next.column,
    next.mode,
    next.claudeSessionId,
    next.position,
    next.updatedAt,
    id
  );

  return next;
}

function deleteCard(id) {
  const existing = getCard(id);
  if (!existing) return false;
  /*
   * sessions.cardId references cards(id) and node:sqlite enforces foreign
   * keys, so the session rows have to go first — otherwise every delete of a
   * card that has ever been run fails with FOREIGN KEY constraint failed.
   * Callers are responsible for killing any live PTY first (see the routes).
   */
  db.prepare('DELETE FROM sessions WHERE cardId = ?').run(id);
  db.prepare('DELETE FROM cards WHERE id = ?').run(id);
  return true;
}

/* ---------------------------------------------------------------- sessions */

function listSessions() {
  return db.prepare('SELECT * FROM sessions ORDER BY startedAt ASC').all();
}

function getSession(id) {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

function createSession({ id, cardId, projectId, mode }) {
  const session = {
    id: id || crypto.randomUUID(),
    cardId: cardId || null,
    projectId,
    mode: mode || 'terminal',
    status: 'running',
    claudeSessionId: null,
    summary: null,
    costUsd: null,
    error: null,
    startedAt: now(),
    finishedAt: null,
  };
  db.prepare(
    `INSERT INTO sessions
       (id, cardId, projectId, mode, status, claudeSessionId, summary, costUsd, error, startedAt, finishedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    session.id,
    session.cardId,
    session.projectId,
    session.mode,
    session.status,
    session.claudeSessionId,
    session.summary,
    session.costUsd,
    session.error,
    session.startedAt,
    session.finishedAt
  );
  return session;
}

function updateSession(id, updates) {
  const existing = getSession(id);
  if (!existing) return null;
  const next = { ...existing, ...updates };
  db.prepare(
    `UPDATE sessions
        SET status = ?, claudeSessionId = ?, summary = ?, costUsd = ?, error = ?, finishedAt = ?
      WHERE id = ?`
  ).run(
    next.status,
    next.claudeSessionId,
    next.summary,
    next.costUsd,
    next.error,
    next.finishedAt,
    id
  );
  return next;
}

function deleteSession(id) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

/*
 * Terminal sessions only exist while their PTY does. A restart of the backend
 * kills every PTY, so any session still marked live in the DB is a leftover.
 */
function reapStaleSessions() {
  db.prepare(
    `UPDATE sessions
        SET status = 'exited', finishedAt = COALESCE(finishedAt, ?)
      WHERE status IN ('running', 'idle')`
  ).run(now());
}

module.exports = {
  listProjects,
  getProject,
  findProjectByPath,
  createProject,
  updateProject,
  deleteProject,
  listCards,
  getCard,
  createCard,
  updateCard,
  deleteCard,
  listSessions,
  getSession,
  createSession,
  updateSession,
  deleteSession,
  reapStaleSessions,
};
