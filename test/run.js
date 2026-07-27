/*
 * Test entry point.
 *
 * Runs each test file as its own process, sequentially, and fails if any of
 * them does. Sequential because the session tests bind real PTYs and assert on
 * timing-sensitive idle transitions, which get flaky when files compete for
 * the machine.
 *
 * `node --test` would normally do this, but it cannot here: node-pty leaves a
 * handle open on Windows, so a file that has spawned a PTY never lets the run
 * finalise. The runner prints no summary and never exits, roughly two runs in
 * three. sessionManager.test.js therefore reports and exits itself — see the
 * note at the top of that file — and this just collects exit codes.
 *
 * The deadline is a backstop against a genuinely stuck file. It fails the run;
 * it never passes one.
 */
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FILES = ['test/originGuard.test.js', 'test/sessionManager.test.js'];
const FILE_DEADLINE_MS = 3 * 60 * 1000;

function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    /*
     * /T for the tree: the file's process owns the PTYs. Bounded, because
     * taskkill against a wedged ConPTY tree can itself block, and a hang here
     * would be the very thing this backstop exists to prevent.
     */
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      timeout: 10_000,
      windowsHide: true,
    });
  } else {
    child.kill('SIGKILL');
  }
}

function runFile(file) {
  return new Promise((resolve) => {
    process.stdout.write(`\n> ${file}\n`);

    // stderr inherited: node-pty's Windows teardown helper writes AttachConsole
    // stack traces there. Noise, not results. See README troubleshooting.
    const child = spawn(process.execPath, [file], { cwd: ROOT, stdio: 'inherit' });

    let done = false;
    const settle = (failed, note) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      killTree(child);
      if (note) process.stdout.write(`${note}\n`);
      resolve(failed);
    };

    const deadline = setTimeout(() => {
      settle(true, `  TIMED OUT after ${FILE_DEADLINE_MS / 1000}s.`);
    }, FILE_DEADLINE_MS);

    child.on('exit', (code) => settle(code !== 0));
    child.on('error', (err) => {
      console.error(err);
      settle(true);
    });
  });
}

(async () => {
  const failed = [];
  for (const file of FILES) {
    if (await runFile(file)) failed.push(file);
  }

  if (failed.length) {
    process.stdout.write(`\nFAILED: ${failed.join(', ')}\n`);
    process.exit(1);
  }
  process.stdout.write('\nAll test files passed\n');
  process.exit(0);
})();
