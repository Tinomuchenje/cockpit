# Cockpit

Run Claude Code across several projects from one window, driven by a Kanban board.

Each card is a task in a project. Hit **Run** and a real interactive `claude`
session opens in that project's folder, with the card's description pre-filled
into an editable prompt box — nothing is sent until you press Send. Sessions live
in the backend, not in the browser tab, so you can switch tabs, navigate away or
reload the page and they keep running.

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

Requires the `claude` CLI on your PATH.

| Script | What it does |
|---|---|
| `npm run dev` | Custom server: Next.js + the WebSocket/PTY layer, one process |
| `npm run build` / `npm start` | Production build and serve |
| `npm run typecheck` | `next typegen` then `tsc --noEmit` |
| `npm run lint` | ESLint |

`COCKPIT_DATA_DIR` points an instance at a different SQLite file, which is handy
for a throwaway board:

```bash
COCKPIT_DATA_DIR=/tmp/cockpit-scratch npm run dev
```

## Where things are

```
server.js                  custom server: Next handler + multiplexed /ws
src/lib/db.js              SQLite store (projects, cards, sessions)
src/lib/sessionManager.js  owns every live PTY; idle detection, scrollback
src/app/api/               REST for projects, cards, sessions, folder browsing
src/components/            board, terminal panes, dialogs
```

The board and terminals share a single WebSocket. Status frames go to every
client (so the board can badge a session whose tab isn't open); output frames
only go to sockets subscribed to that session.

## Platform notes

Built and tested on Windows. Four decisions here are non-obvious, and undoing any
of them breaks the app in a way that isn't easy to diagnose:

- **`node:sqlite`, not `better-sqlite3`.** The latter has no prebuilt binary for
  this Node/Windows pair and needs a C++ toolchain to compile. Node's built-in
  needs no native build. It logs an experimental warning on startup; that's
  expected.
- **Webpack, not Turbopack.** Turbopack doesn't resolve the `node:sqlite`
  builtin, so both `server.js` and `npm run build` pass `--webpack`.
- **`claude` is spawned via `cmd.exe /c` on Windows.** node-pty's ConPTY backend
  can't exec a `.cmd` shim directly — `CreateProcess` doesn't do PATHEXT
  resolution — so spawning `claude` by name fails with "error code: 2".
- **Session state hangs off `globalThis`.** `server.js` requires
  `sessionManager` through Node's CommonJS cache while the API routes import it
  through webpack's bundle: two module instances. Module-level state would give
  the route that spawns a PTY and the socket that streams it a private map each,
  and the terminal would render nothing.

You'll occasionally see `AttachConsole failed` stack traces when closing a
session. That's node-pty's own short-lived Windows helper process; the backend is
unaffected.

## Security

The server binds to `127.0.0.1` only, and that is the security model, not a
detail. There is no auth, `/api/browse` will enumerate the filesystem, and a
terminal served over HTTP is a remote shell the moment it's reachable
off-machine. Don't change the bind address without adding auth first.

## State

Milestones M0–M2 of the build spec are done: the board, terminal sessions, and
cards wired to sessions (run, pre-filled prompt, idle badging, restart in place).

Not built yet: a git panel, `--resume`/`--continue`, and headless mode
(`claude -p` with a diff and summary to approve).
