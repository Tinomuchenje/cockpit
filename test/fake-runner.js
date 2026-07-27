/*
 * A scripted stand-in for `claude`, driven through COCKPIT_RUNNER.
 *
 * The tests need a real PTY child with predictable output. Spawning the actual
 * CLI would make the suite depend on Claude Code being installed, signed in,
 * and behaving the same across versions, and would cost money to run.
 *
 * Protocol, one line at a time on stdin:
 *   <anything>   echoed back verbatim, so tests can prove input reaches the PTY
 *   /flood N     writes N bytes, for exercising the scrollback cap
 *   /quit        exits 0
 */
process.stdout.write('READY\n');

let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;

  // A PTY delivers Enter as CR, not LF.
  let index;
  while ((index = buffer.search(/[\r\n]/)) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);

    if (line === '/quit') {
      process.exit(0);
    } else if (line.startsWith('/flood ')) {
      const size = Number(line.slice(7)) || 0;
      // Chunked, because one enormous write can outrun the PTY's buffer.
      const chunkSize = 4096;
      for (let written = 0; written < size; written += chunkSize) {
        process.stdout.write('x'.repeat(Math.min(chunkSize, size - written)));
      }
      process.stdout.write('\nFLOODED\n');
    } else if (line.length) {
      process.stdout.write(`ECHO:${line}\n`);
    }
  }
});

// Without this the process exits as soon as stdin is drained.
process.stdin.resume();
