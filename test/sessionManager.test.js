/*
 * Session lifecycle. This is where both of the bugs found so far lived, and
 * it is the part of the app that is hardest to check by hand: PTY events are
 * asynchronous, and a restart replaces a live process underneath its own
 * event handlers.
 *
 * Sessions run test/fake-runner.js instead of the real CLI, via COCKPIT_RUNNER.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// db.js opens its database at require time, so the data directory and the
// runner have to be set before anything below is loaded.
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-test-'));
process.env.COCKPIT_DATA_DIR = DATA_DIR;
process.env.COCKPIT_RUNNER = process.execPath;
process.env.COCKPIT_RUNNER_ARGS = JSON.stringify([
  path.join(__dirname, 'fake-runner.js'),
]);

const store = require('../src/lib/db');
const sessions = require('../src/lib/sessionManager');

const PROJECT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-proj-'));
const project = store.createProject({
  displayName: 'test-project',
  folderPath: PROJECT_DIR,
  stack: null,
});

/* ------------------------------------------------------------------ helpers */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Collect every event the manager emits, for assertions after the fact. */
function record() {
  const events = [];
  sessions.onEvent((e) => events.push(e));
  return {
    events,
    of: (type) => events.filter((e) => e.type === type),
    text: (id) =>
      events
        .filter((e) => e.type === 'output' && e.sessionId === id)
        .map((e) => e.data)
        .join(''),
  };
}

/** Poll until `predicate` holds, so tests wait on the PTY rather than a guess. */
async function until(predicate, { timeout = 8000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function startAndSettle(log) {
  const session = sessions.startSession({
    cardId: null,
    projectId: project.id,
    cols: 80,
    rows: 24,
  });
  await until(() => log.text(session.id).includes('READY'), { label: 'runner start' });
  return session;
}

test.after(() => {
  sessions.shutdown();
  /*
   * Best effort. Windows refuses to unlink a file that still has an open
   * handle, and node:sqlite holds the database open for the life of the
   * process while node-pty's teardown is asynchronous. Failing the run over
   * temp files the OS will reclaim anyway would be a false negative.
   */
  for (const dir of [DATA_DIR, PROJECT_DIR]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Left for the OS.
    }
  }
});

/* -------------------------------------------------------------------- tests */

test('a started session runs, buffers output and appears as live', async () => {
  const log = record();
  const session = await startAndSettle(log);

  assert.equal(session.status, 'running');
  assert.equal(log.of('started').length, 1);

  const live = sessions.listLiveSessions().find((s) => s.id === session.id);
  assert.ok(live, 'session should be listed as live');
  assert.equal(live.status, 'running');

  // Scrollback is what a reattaching client replays, so it must hold the
  // output that already went out over the socket.
  assert.match(sessions.getScrollback(session.id), /READY/);

  sessions.close(session.id);
});

test('input reaches the process', async () => {
  const log = record();
  const session = await startAndSettle(log);

  sessions.write(session.id, 'hello\r');
  await until(() => log.text(session.id).includes('ECHO:hello'), { label: 'echo' });

  sessions.close(session.id);
});

test('goes idle when quiet, and raises attention exactly once per episode', async () => {
  const log = record();
  const session = await startAndSettle(log);

  await until(
    () => log.of('status').some((e) => e.sessionId === session.id && e.status === 'idle'),
    { timeout: sessions.IDLE_AFTER_MS + 4000, label: 'idle' }
  );

  const attentions = log
    .of('status')
    .filter((e) => e.sessionId === session.id && e.attention);
  assert.equal(attentions.length, 1, 'one chime per waiting episode, not per repaint');

  /*
   * Claude Code's TUI repaints itself periodically, which flips a waiting
   * session running -> idle over and over. Only interacting with it should
   * re-arm the chime.
   */
  sessions.write(session.id, 'again\r');
  await until(
    () =>
      log
        .of('status')
        .filter((e) => e.sessionId === session.id && e.attention).length === 2,
    { timeout: sessions.IDLE_AFTER_MS + 4000, label: 'attention re-arm after input' }
  );

  sessions.close(session.id);
});

test('restart keeps the session usable', async () => {
  // Regression. restart() replaced entry.pty, but the dying process's onExit
  // still closed over `entry` and ran afterwards: it nulled the live pty and
  // marked the session exited. Output from the new process kept arriving, so
  // the tab looked alive while being unable to receive a single keystroke, and
  // the orphaned process kept running with nothing attached.
  const log = record();
  const session = await startAndSettle(log);

  sessions.write(session.id, 'before\r');
  await until(() => log.text(session.id).includes('ECHO:before'), { label: 'pre-restart echo' });

  assert.equal(sessions.restart(session.id), true);
  assert.equal(log.of('restarted').length, 1);

  // Same session, same tab.
  const live = sessions.listLiveSessions().find((s) => s.id === session.id);
  assert.ok(live, 'session should still be live after a restart');

  // A fresh process, and the scrollback starts over with it.
  await until(() => sessions.getScrollback(session.id).includes('READY'), {
    label: 'runner restart',
  });
  assert.doesNotMatch(
    sessions.getScrollback(session.id),
    /ECHO:before/,
    'restart should clear the buffer, not append to it'
  );

  // The part that regressed: the new process must actually be reachable.
  const marker = 'after-restart';
  sessions.write(session.id, `${marker}\r`);
  await until(() => sessions.getScrollback(session.id).includes(`ECHO:${marker}`), {
    label: 'keystrokes after restart',
  });

  // And the record must not still be carrying the old process's death.
  const record_ = store.getSession(session.id);
  assert.equal(record_.finishedAt, null, 'a restarted session has not finished');
  assert.notEqual(record_.status, 'exited');

  sessions.close(session.id);
});

test('a process that exits on its own marks the session exited', async () => {
  const log = record();
  const session = await startAndSettle(log);

  sessions.write(session.id, '/quit\r');

  await until(
    () => log.of('status').some((e) => e.sessionId === session.id && e.status === 'exited'),
    { label: 'exit status' }
  );
  assert.match(log.text(session.id), /session ended/);

  const record_ = store.getSession(session.id);
  assert.equal(record_.status, 'exited');
  assert.ok(record_.finishedAt, 'an exited session records when it finished');

  sessions.close(session.id);
});

test('close removes the session and its record', async () => {
  const log = record();
  const session = await startAndSettle(log);

  sessions.close(session.id);

  assert.equal(
    sessions.listLiveSessions().find((s) => s.id === session.id),
    undefined
  );
  assert.equal(log.of('closed').length, 1);
  assert.equal(store.getSession(session.id), undefined);
});

test('scrollback is capped', async () => {
  const log = record();
  const session = await startAndSettle(log);

  // Comfortably past the cap, so trimming has to happen.
  sessions.write(session.id, '/flood 400000\r');
  await until(() => sessions.getScrollback(session.id).includes('FLOODED'), {
    timeout: 20000,
    label: 'flood',
  });

  const size = sessions.getScrollback(session.id).length;
  assert.ok(
    size <= 256 * 1024,
    `scrollback should stay within the cap, saw ${size} bytes`
  );
  // Trimming drops the oldest chunks, so the newest output must survive.
  assert.match(sessions.getScrollback(session.id), /FLOODED/);

  sessions.close(session.id);
});

test('writing to an unknown session is a no-op, not a crash', () => {
  // The client can send input for a session the backend has already forgotten,
  // e.g. a socket that was mid-flight when the tab closed.
  assert.doesNotThrow(() => sessions.write('no-such-session', 'x'));
  assert.doesNotThrow(() => sessions.resize('no-such-session', 10, 10));
  assert.equal(sessions.restart('no-such-session'), false);
  assert.equal(sessions.getScrollback('no-such-session'), '');
});
