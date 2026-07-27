/*
 * Cross-origin guard for the loopback server.
 *
 * Binding to 127.0.0.1 keeps other machines out. It does not keep other *sites*
 * out: a page in any tab can reach 127.0.0.1, and two of the browser's usual
 * protections do not apply here.
 *
 *   - WebSockets are exempt from the same-origin policy entirely. Without this
 *     check, any site could open ws://127.0.0.1:PORT/ws, read the `hello` frame
 *     listing every live session, and send `input` frames into one. That is
 *     keystroke injection into a live Claude Code session, which is arbitrary
 *     command execution from a random tab.
 *   - The JSON routes look CSRF-safe but are not: `req.json()` parses the body
 *     whatever the Content-Type says, so a cross-origin POST sent as text/plain
 *     is a "simple" request, skips preflight, and takes effect even though the
 *     attacker cannot read the reply.
 *
 * Origin is attached by the browser to every cross-origin fetch and to form
 * posts, and page script cannot forge it, so allowlisting it closes both.
 *
 * Plain CommonJS because server.js requires this at runtime outside the Next
 * build, the same reason db.js and sessionManager.js are.
 */

/**
 * Build an origin check for a server listening on `port`.
 *
 * @param {number|string} port
 * @returns {(req: {headers: Record<string, string|undefined>}) => boolean}
 */
function makeOriginGuard(port) {
  const allowed = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
  ]);

  return function originAllowed(req) {
    const origin = req.headers.origin;

    /*
     * No Origin header at all means this is not a browser cross-origin
     * request: curl, the Electron main process, or a same-origin top-level
     * navigation. Those are fine. A literal "null" is not — that is what a
     * sandboxed iframe or a data: URL sends, and it is attacker-reachable.
     */
    if (origin === undefined) return true;

    return allowed.has(origin);
  };
}

module.exports = { makeOriginGuard };
