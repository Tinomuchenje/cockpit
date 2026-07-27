# Security

Cockpit spawns shells and reads your filesystem. That is its job, so it is worth
being precise about what is a vulnerability here and what is the design.

## The model

The server binds `127.0.0.1` only and there is no authentication. **That bind
address is the security boundary**, not an implementation detail. A terminal
served over HTTP is a remote shell the moment it is reachable off-machine, and
`/api/browse` will enumerate the filesystem.

Loopback keeps other machines out. It does not keep other *websites* out, since
a page in any tab can reach `127.0.0.1`, so `server.js` also enforces an
`Origin` allowlist on every request and before the WebSocket handshake
completes. Browsers attach `Origin` to cross-origin requests and page script
cannot forge it.

## In scope

Reports along these lines are wanted:

- Any way for a **website** to reach the API or the WebSocket, read session
  data, or send input to a session. WebSockets are exempt from the same-origin
  policy, so this is the sharpest edge in the app.
- Any way to make the server bind to something other than loopback.
- Path traversal or escape in `/api/browse` beyond what the picker intends.
- Secrets leaking through `/api/environment`. It reads Claude Code's MCP config,
  which routinely carries API keys in `env`, bearer tokens in `headers`, and
  tokens in URLs. It is meant to redact all of that and return only a name, a
  scope, a transport label and one identifying hint. Anything else getting
  through is a bug.
- Command injection into the spawned process beyond the folder path you chose.

## Not in scope

- **Local processes reaching the server.** Anything that can already run code as
  you can reach Cockpit, and could equally run `claude` directly. On a shared or
  multi-user machine, treat a running Cockpit as an open shell.
- **The absence of authentication.** Known and deliberate. If you want Cockpit
  reachable over a network, that needs an auth layer first, and there is no
  supported configuration for it today.
- **Unsigned builds.** The Windows installer and macOS dmg are not code signed.
  SmartScreen and Gatekeeper warnings are expected. Fixing this costs money, not
  code.
- Claude Code's own behaviour. Report that to Anthropic.

## Reporting

Use GitHub's **private vulnerability reporting** on this repository (Security →
Report a vulnerability) rather than opening a public issue.

There is no bounty, and no formal response time. This is a personal project.

## Supported versions

The latest release only.
