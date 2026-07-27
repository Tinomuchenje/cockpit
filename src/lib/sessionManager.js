/*
 * Owns every live Claude Code PTY.
 *
 * Sessions live here, in the long-lived backend process, NOT on a WebSocket.
 * That is the whole point: you can close the browser tab, navigate away, or
 * reload the page and the `claude` process keeps running. Reattaching replays
 * the scrollback so the terminal looks like you never left.
 *
 * Plain CommonJS because server.js requires this outside the Next build.
 */
const pty = require('node-pty');
const crypto = require('node:crypto');
const store = require('./db');

/** No PTY output for this long => the session is waiting on you. */
const IDLE_AFTER_MS = 2500;

/** Cap replay scrollback per session so long-running sessions can't grow unbounded. */
const MAX_BUFFER_BYTES = 256 * 1024;

/*
 * Runtime state hangs off globalThis, and that is load-bearing.
 *
 * This module gets instantiated twice: server.js `require`s it through Node's
 * CommonJS cache, while the Next API routes `import` it through webpack's
 * server bundle. Those are two separate module objects. Module-level Maps would
 * therefore give the API route (which spawns the PTY) and the WebSocket handler
 * (which streams it) a private map each — the socket would look up a session
 * the route created and find nothing, so the terminal would stay blank.
 *
 * Hanging the state on globalThis gives both instances the same Maps. It also
 * means live sessions survive a dev-mode hot reload.
 */
const state = (globalThis.__cockpitSessionState ??= {
  /** sessionId -> live runtime state (never serialised; the DB holds the record) */
  live: new Map(),
  /** Event listeners: (event) => void */
  listeners: new Set(),
});

const live = state.live;
const listeners = state.listeners;

function onEvent(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A broken listener must not take down a PTY.
    }
  }
}

/*
 * node-pty's ConPTY backend can't exec a .cmd shim directly — CreateProcess
 * doesn't do PATHEXT resolution, so `claude` (installed by npm as claude.cmd)
 * fails with "error code: 2". Going through cmd.exe resolves it. Kept behind
 * this helper so the non-Windows path stays a one-line change.
 */
function spawnClaude({ cwd, cols, rows, args = [] }) {
  const opts = {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: process.env,
  };
  /*
   * COCKPIT_RUNNER swaps the binary. Nothing in the app sets it; it exists so
   * the tests can drive a scripted stand-in rather than requiring Claude Code
   * to be installed and signed in on whatever machine runs them. It is also
   * the seam a real multi-runner feature would grow from, since this function
   * is the only place that knows which program a session runs.
   */
  if (process.env.COCKPIT_RUNNER) {
    const extra = process.env.COCKPIT_RUNNER_ARGS
      ? JSON.parse(process.env.COCKPIT_RUNNER_ARGS)
      : [];
    return pty.spawn(process.env.COCKPIT_RUNNER, [...extra, ...args], opts);
  }

  if (process.platform === 'win32') {
    return pty.spawn('cmd.exe', ['/c', 'claude', ...args], opts);
  }
  return pty.spawn('claude', args, opts);
}

function setStatus(sessionId, status, extra = {}) {
  const entry = live.get(sessionId);
  if (entry && entry.status === status && !extra.force) return;

  if (entry) entry.status = status;

  const finished = status === 'exited' || status === 'cancelled';
  store.updateSession(sessionId, {
    status,
    ...(finished ? { finishedAt: new Date().toISOString() } : {}),
    ...(extra.error !== undefined ? { error: extra.error } : {}),
  });

  /*
   * `attention` drives the chime; `status` drives the badge. They are separate
   * because Claude Code's TUI redraws itself periodically (spinners, cursor),
   * which flips a waiting session running -> idle over and over. Chiming on
   * every idle transition meant one finished task rang repeatedly.
   *
   * So: ring once when a session starts waiting, and stay quiet until you have
   * actually interacted with it (see `write`, which clears the flag).
   */
  let attention = false;
  if (entry && (status === 'idle' || status === 'exited')) {
    attention = !entry.notified;
    entry.notified = true;
  }

  emit({
    type: 'status',
    sessionId,
    status,
    error: extra.error ?? null,
    attention,
    idleSince: entry && status === 'idle' ? (entry.idleSince ??= Date.now()) : null,
  });
}

function armIdleTimer(entry) {
  clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => {
    // Only a running session can go idle; exited ones stay exited.
    if (entry.status === 'running') setStatus(entry.id, 'idle');
  }, IDLE_AFTER_MS);
}

function appendToBuffer(entry, chunk) {
  entry.buffer.push(chunk);
  entry.bufferBytes += chunk.length;
  while (entry.bufferBytes > MAX_BUFFER_BYTES && entry.buffer.length > 1) {
    entry.bufferBytes -= entry.buffer.shift().length;
  }
}

function wire(entry) {
  /*
   * Bind to this specific process, not to whatever entry.pty happens to be
   * when the event fires. A restart kills the old PTY and immediately puts a
   * new one on the same entry, but the old process's exit event arrives after
   * that. Without this guard the dying process's handler runs against the live
   * one: it nulls entry.pty, so write() and resize() silently go nowhere, and
   * it marks the session exited. The tab still shows output from the new
   * process, so the session looks alive while being unable to receive a
   * keystroke, and the orphaned claude keeps running with nothing attached.
   */
  const self = entry.pty;
  const superseded = () => entry.pty !== self;

  self.onData((data) => {
    if (superseded()) return;
    appendToBuffer(entry, data);
    if (entry.status !== 'running') setStatus(entry.id, 'running');
    armIdleTimer(entry);
    emit({ type: 'output', sessionId: entry.id, data });
  });

  self.onExit(({ exitCode }) => {
    if (superseded()) return;
    clearTimeout(entry.idleTimer);
    entry.pty = null;
    setStatus(entry.id, 'exited', { force: true });
    emit({ type: 'output', sessionId: entry.id, data: exitNotice(exitCode) });
  });
}

function exitNotice(exitCode) {
  const label = exitCode === 0 ? 'session ended' : `session ended (exit ${exitCode})`;
  return `\r\n\x1b[2m── ${label} ──\x1b[0m\r\n`;
}

/**
 * Start a session for a card (or a bare project, when cardId is null).
 * Throws if the project is unknown or `claude` can't be spawned.
 */
function startSession({ cardId, projectId, cols = 100, rows = 30 }) {
  const project = store.getProject(projectId);
  if (!project) throw new Error(`unknown project: ${projectId}`);

  const id = crypto.randomUUID();
  const record = store.createSession({ id, cardId, projectId, mode: 'terminal' });

  let ptyProcess;
  try {
    ptyProcess = spawnClaude({ cwd: project.folderPath, cols, rows });
  } catch (err) {
    const message = `${err.message} — is the \`claude\` CLI on PATH?`;
    store.updateSession(id, {
      status: 'exited',
      error: message,
      finishedAt: new Date().toISOString(),
    });
    throw new Error(message);
  }

  const entry = {
    id,
    cardId: cardId || null,
    projectId,
    pty: ptyProcess,
    status: 'running',
    buffer: [],
    bufferBytes: 0,
    cols,
    rows,
    idleTimer: null,
    /** Whether this waiting episode has already been announced (see setStatus). */
    notified: false,
    /** When the current idle episode began, for the "still working?" prompt. */
    idleSince: null,
  };
  live.set(id, entry);
  wire(entry);
  armIdleTimer(entry);

  emit({ type: 'started', sessionId: id, session: { ...record, status: 'running' } });
  return { ...record, status: 'running' };
}

/** Replayable scrollback for a session, as one string. */
function getScrollback(sessionId) {
  const entry = live.get(sessionId);
  return entry ? entry.buffer.join('') : '';
}

/*
 * Terminal apps that enable focus reporting (Claude Code sends ?1004h) get
 * \x1b[I on focus and \x1b[O on blur. xterm emits those automatically, so
 * merely switching browser tabs would otherwise register as you typing —
 * clearing the notify flag and re-arming the whole chime cycle.
 */
const FOCUS_REPORT = /^(\x1b\[[IO])+$/;

function write(sessionId, data) {
  const entry = live.get(sessionId);
  if (!entry || !entry.pty) return false;
  entry.pty.write(data);

  if (!FOCUS_REPORT.test(data)) {
    // Real input: you've engaged, so re-arm the chime for the next wait and
    // clear the badge immediately rather than waiting for output to arrive.
    entry.notified = false;
    entry.idleSince = null;
    if (entry.status === 'idle') setStatus(sessionId, 'running');
    armIdleTimer(entry);
  }
  return true;
}

function resize(sessionId, cols, rows) {
  const entry = live.get(sessionId);
  if (!entry) return false;
  entry.cols = cols;
  entry.rows = rows;
  if (entry.pty) {
    try {
      entry.pty.resize(cols, rows);
    } catch {
      // Resizing a PTY mid-teardown can throw; harmless.
    }
  }
  return true;
}

/**
 * Restart in place: same session id and tab, fresh `claude` process. This is
 * how you pick up newly added MCP servers, hooks or skills.
 */
function restart(sessionId) {
  const entry = live.get(sessionId);
  if (!entry) return false;

  clearTimeout(entry.idleTimer);
  if (entry.pty) {
    try {
      entry.pty.kill();
    } catch {
      // Already gone.
    }
  }

  const project = store.getProject(entry.projectId);
  entry.pty = spawnClaude({ cwd: project.folderPath, cols: entry.cols, rows: entry.rows });
  entry.buffer = [];
  entry.bufferBytes = 0;
  entry.status = 'running';
  // A fresh process is a fresh waiting episode: it should be able to chime.
  entry.notified = false;
  entry.idleSince = null;

  store.updateSession(sessionId, { status: 'running', finishedAt: null, error: null });
  wire(entry);
  armIdleTimer(entry);

  emit({ type: 'restarted', sessionId });
  emit({ type: 'status', sessionId, status: 'running', error: null });
  return true;
}

/** Kill the PTY and forget the session entirely (removes its tab). */
function close(sessionId) {
  const entry = live.get(sessionId);
  if (entry) {
    clearTimeout(entry.idleTimer);
    if (entry.pty) {
      try {
        entry.pty.kill();
      } catch {
        // Already gone.
      }
    }
    live.delete(sessionId);
  }
  store.deleteSession(sessionId);
  emit({ type: 'closed', sessionId });
  return true;
}

/** Sessions with a live runtime entry, for hydrating a fresh page load. */
function listLiveSessions() {
  return [...live.values()].map((entry) => {
    const record = store.getSession(entry.id);
    return {
      ...record,
      status: entry.status,
    };
  });
}

function shutdown() {
  for (const entry of live.values()) {
    clearTimeout(entry.idleTimer);
    if (entry.pty) {
      try {
        entry.pty.kill();
      } catch {
        // Best effort on the way out.
      }
    }
  }
  live.clear();
}

module.exports = {
  onEvent,
  startSession,
  getScrollback,
  write,
  resize,
  restart,
  close,
  listLiveSessions,
  shutdown,
  IDLE_AFTER_MS,
};
