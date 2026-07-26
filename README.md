# Cockpit

Run Claude Code across several projects from one window, driven by a Kanban board.

Each card is a task in a project. Hit **Run** and a real interactive `claude`
session opens in that project's folder, with the card's description pre-filled
into an editable prompt box. Sessions live in the backend rather than the browser
tab, so you can switch tabs, navigate away, or reload the page and they keep
running.

The problem it solves: working across several repos means opening an editor,
picking a workspace, starting Claude Code, pasting context, waiting, then
repeating the whole ceremony to touch a different project. Cockpit collapses that
into one window and one board.

---

## Contents

- [Quick start](#quick-start)
- [Concepts](#concepts)
- [Using it](#using-it)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Data model](#data-model)
- [HTTP API](#http-api)
- [WebSocket protocol](#websocket-protocol)
- [Security](#security)
- [Platform notes](#platform-notes)
- [Troubleshooting](#troubleshooting)
- [Project layout](#project-layout)
- [What's built, what isn't](#whats-built-what-isnt)

---

## Quick start

Requires Node 22.5+ (for the built-in `node:sqlite`) and the `claude` CLI on your
PATH.

```bash
npm install
npm run dev            # http://localhost:3000
```

| Script | What it does |
|---|---|
| `npm run dev` | One process: Next.js plus the WebSocket/PTY layer |
| `npm run build` | Production build (webpack — see [Platform notes](#platform-notes)) |
| `npm start` | Serve the production build |
| `npm run typecheck` | `next typegen` then `tsc --noEmit` |
| `npm run lint` | ESLint |

`npm run typecheck` runs `next typegen` first because the API routes use Next's
generated `RouteContext<'/api/...'>` types. Without it, a clean checkout fails to
typecheck with "Cannot find name 'RouteContext'".

---

## Concepts

**Project** — a folder on disk you've already cloned. Cockpit never clones
anything; it points at what's there.

**Card** — one task in one project. The description is the important field: it
becomes the prompt the session starts from, so give it a body and acceptance
criteria rather than a one-liner.

**Session** — a running `claude` process in a project's folder, streamed to the
browser. Owned by the backend, not by a browser tab.

**Columns** map onto session state so the board and the engine can't disagree:

| Column | Meaning |
|---|---|
| To Do | Created, not started |
| In Progress | A card moves here automatically when you run it |
| Review | Work done, checking it over. You move cards here |
| Done | Committed and pushed. You move cards here |

**Session status** drives the badges:

| Status | Shown as | Meaning |
|---|---|---|
| `running` | green, pulsing | Producing output — it's working |
| `idle` | amber | Quiet for 2.5s, so it's waiting on you |
| `exited` | grey | The process ended |

---

## Using it

### Add a project

**Add project** → **Browse…** opens a filesystem picker with drive buttons,
breadcrumbs, and a `git` badge next to folders that are repos. You can also paste
a path directly; the display name is derived from the folder name.

The picker is server-side by necessity: no browser API can give a web page an
absolute path (`showDirectoryPicker()` returns an opaque handle,
`<input webkitdirectory>` gives relative paths), and a real path is needed for the
PTY's working directory.

Adding a folder with no `.git` is allowed — you just can't commit from it, and
Cockpit says so.

### Create cards

**New card**, or the `+` on any column header to create directly in that column.
Clicking a card opens it for editing; **Save & run** saves and starts a session in
one step.

### Run a card

**Run** on a card:

1. Spawns `claude` in that project's folder.
2. Moves the card to In Progress.
3. Opens a tab and pre-fills the composer with the card's description.

**Nothing is sent until you press Send.** You can edit the prompt, add context, or
rewrite it entirely first. Multi-line prompts are wrapped in bracketed-paste
markers so embedded newlines stay literal instead of submitting early.

### Work across sessions

Every session gets a tab. Terminal panes stay mounted when you switch away, and
the PTY lives in the backend, so switching tabs or reloading the page costs you
nothing — reattaching replays the scrollback (up to 256KB per session).

- **Restart** kills and respawns `claude` in place, keeping the same tab. This is
  how you pick up newly added MCP servers, hooks, or skills.
- **Close** ends the session and removes the tab.
- **Compose** reopens the prompt box for sending a long or multi-line message.

### Handle sessions waiting on you

When a session goes quiet it's flagged as waiting: the tab badges, the OS title
becomes `(1) Cockpit`, and a chime plays if the tab isn't already in front.

The bell rings **once per waiting episode**, not on every status flip. Claude
Code's TUI repaints itself periodically, which would otherwise ring repeatedly for
one finished task. It re-arms after you actually interact with the session.

An **attention panel** at the top of the board lists every waiting session with
the real text on its screen, and lets you answer from there:

- Quick keys `1`, `2`, `Enter`, `Esc` for numbered prompts (the usual shape of a
  Claude Code permission request).
- A reply box for anything else.

The screen text is read from each session's xterm buffer, so it's the actual
rendered screen rather than an attempt to parse raw escape codes server-side.

After 5 minutes waiting, the session pane asks whether you're still on it and
offers to close it, so forgotten sessions don't pile up.

### Keep the board manageable

- **Archive** a project to drop it and its cards off the board without deleting
  anything. Archived projects stay behind a "N archived" toggle.
- **Remove** deletes the project and its cards from Cockpit. Nothing on disk is
  touched. The dialog offers "Archive instead".
- **Clear** on the Done column header bulk-deletes everything in Done.
- Columns over 15 cards collapse to the newest, with a "show older" toggle.

Cards reorder within a column and move between columns by dragging. Positions are
fractional, so a reorder is a single-row update rather than renumbering a column.

---

## Keyboard shortcuts

| Keys | Where | Action |
|---|---|---|
| `Ctrl/Cmd` `1` | anywhere | Jump to the board |
| `Ctrl/Cmd` `2`–`9` | anywhere | Jump to the nth session tab |
| `Ctrl/Cmd` `+` / `-` | terminal | Zoom the terminal (8–28px) |
| `Ctrl/Cmd` `0` | terminal | Reset zoom to 13px |
| `Ctrl/Cmd` `scroll` | terminal | Zoom |
| `Enter` | composer | Send |
| `Shift` `Enter` | composer | Newline |
| `Esc` | composer | Hand focus to the terminal |
| `Esc` | any dialog | Close |

Terminal zoom is deliberately captured so it zooms the terminal rather than the
whole page, as every other terminal does. It persists in `localStorage`.

---

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `COCKPIT_DATA_DIR` | `./data` | Where `cockpit.db` lives |
| `NODE_ENV` | — | `production` makes `npm start` serve the build |

`COCKPIT_DATA_DIR` gives you a throwaway board, which is the safe way to test
destructive things like Clear Done without touching your real one:

```bash
COCKPIT_DATA_DIR=/tmp/cockpit-scratch PORT=3200 npm run dev
```

Tunable constants, if the defaults annoy you:

| Constant | Value | Where |
|---|---|---|
| `IDLE_AFTER_MS` | 2500 | `src/lib/sessionManager.js` |
| `MAX_BUFFER_BYTES` | 256KB | `src/lib/sessionManager.js` |
| `STALE_AFTER_MS` | 5 min | `src/components/TerminalPane.tsx` |
| `FONT_MIN/MAX/DEFAULT` | 8 / 28 / 13 | `src/components/TerminalPane.tsx` |
| `COLLAPSE_AFTER` | 15 | `src/components/Column.tsx` |

---

## Architecture

One long-lived Node process serves the UI and owns the terminals:

```
Browser
  Kanban board  +  xterm.js terminal tabs
     |  one multiplexed WebSocket  (keystrokes up, output + status down)
     v
server.js — custom Next.js server, long-lived
  ├── Next.js request handler (pages + /api)
  ├── WebSocketServer on /ws
  └── sessionManager — owns every node-pty process
        idle detection · scrollback buffers · status events
     |
     v
SQLite (data/cockpit.db)   +   each project's folder on disk
```

The spec this was built from suggested two processes (a Fastify backend plus a
Next.js frontend). One process was chosen instead: at this scale the split buys
nothing and costs two dev servers and a CORS story. The trade-off is the
`globalThis` wrinkle described in [Platform notes](#platform-notes).

**Why sessions live in the backend.** An earlier version tied each PTY to its
WebSocket, so leaving the terminal page killed `claude`. Sessions are now keyed in
a registry that outlives any socket; a socket closing only unsubscribes it.

**One socket per browser tab, multiplexed.** Status frames go to every connected
client, because the board badges sessions whose terminal isn't on screen. Output
frames only go to sockets that subscribed to that session.

**Restarting the backend** kills every PTY, so any session still marked live in
the database is stale by definition and gets marked `exited` on boot.

---

## Data model

Three tables in SQLite. Schema changes are applied as additive `ALTER TABLE`
migrations guarded by `PRAGMA table_info`, so an existing board survives an
upgrade.

```
projects   id, displayName, folderPath, stack, archived, createdAt
cards      id, projectId, title, description, column, mode,
           claudeSessionId, position, createdAt, updatedAt
sessions   id, cardId, projectId, mode, status, claudeSessionId,
           summary, costUsd, error, startedAt, finishedAt
```

`position` is a float for fractional reordering. `archived` is 0/1 (SQLite has no
boolean) and is hydrated to a real boolean on the way out. `mode` is always
`terminal` today; `headless` exists in the schema for a later milestone.

Foreign keys are enforced, so `sessions` rows referencing a card must go before
the card does — see `deleteCard`.

---

## HTTP API

| Route | Methods | Notes |
|---|---|---|
| `/api/projects` | `GET` `POST` | Validates the folder exists and rejects duplicates |
| `/api/projects/[id]` | `PATCH` `DELETE` | `PATCH` handles rename and archive |
| `/api/cards` | `GET` `POST` | |
| `/api/cards/[id]` | `PATCH` `DELETE` | `PATCH` handles edits, column and position |
| `/api/cards/bulk` | `POST` | Delete by `ids` or clear a whole `column` |
| `/api/sessions` | `GET` `POST` | `POST` takes a `cardId` (or a bare `projectId`) |
| `/api/sessions/[id]` | `POST` `DELETE` | `POST` restarts in place |
| `/api/browse` | `GET` | Directory listing for the folder picker |

Deleting a card or clearing a column kills any live PTY for those cards first, so
a delete can't orphan a running process.

---

## WebSocket protocol

One connection at `/ws`. JSON frames both ways.

**Client → server**

| Frame | Payload |
|---|---|
| `subscribe` | `sessionId` — replies with a `replay` frame |
| `unsubscribe` | `sessionId` |
| `input` | `sessionId`, `data` |
| `resize` | `sessionId`, `cols`, `rows` |

**Server → client**

| Frame | Payload |
|---|---|
| `hello` | Every live session, for hydrating a fresh page load |
| `replay` | Full scrollback on attach. The client resets the terminal first |
| `output` | Incremental PTY bytes |
| `status` | `status`, `error`, `attention`, `idleSince` |
| `started` / `restarted` / `closed` | Session lifecycle |

`replay` is distinct from `output` on purpose: the client resets the terminal
before writing it, so a double subscribe (React strict mode remounts effects in
development) can't render the buffer twice.

`attention` is separate from `status` for the same class of reason — `status`
drives the badge and flips often, `attention` is true only on the first idle of an
episode and drives the chime.

---

## Security

**The server binds to `127.0.0.1` only, and that is the security model, not a
detail.** There is no authentication. `/api/browse` will enumerate the
filesystem, and a terminal served over HTTP is a remote shell the moment it is
reachable off-machine.

Do not change the bind address without adding authentication first. If you ever
expose this, treat it as a serious risk.

---

## Platform notes

Built and tested on Windows. Four decisions here are non-obvious, and undoing any
of them breaks the app in ways that are hard to diagnose:

**`node:sqlite`, not `better-sqlite3`.** `better-sqlite3` has no prebuilt binary
for this Node/Windows pair and falls back to `node-gyp rebuild`, which needs
Visual Studio Build Tools. Node's built-in SQLite needs no native build. It logs
an experimental warning on startup; that's expected.

**Webpack, not Turbopack.** Turbopack does not resolve the `node:sqlite` builtin
and fails with "Unsupported external type Url for commonjs reference". `server.js`
passes `webpack: true` to `next()`, and `npm run build` passes `--webpack`.

**`claude` is spawned through `cmd.exe /c` on Windows.** node-pty's ConPTY backend
cannot exec a `.cmd` shim directly — `CreateProcess` does not do PATHEXT
resolution — so spawning `claude` by name fails with "Cannot create process, error
code: 2". Non-Windows platforms spawn it directly; the branch is in
`spawnClaude()`.

**Session state hangs off `globalThis`.** `server.js` requires `sessionManager`
through Node's CommonJS cache while the API routes import it through webpack's
server bundle — two separate module instances. Module-level state would give the
route that spawns a PTY and the socket that streams it a private registry each,
and the terminal would render nothing at all while every API call returned 200.

Next's own dev-mode HMR WebSocket also upgrades on this server. Dropping those
upgrades silently breaks client-side hydration — the page renders but nothing is
interactive — so `server.js` hands any non-`/ws` upgrade to
`app.getUpgradeHandler()`.

---

## Troubleshooting

**`AttachConsole failed` stack traces when closing a session.** node-pty spawns a
short-lived Windows helper process that crashes on teardown. Its stderr lands in
the log but the backend is unaffected — verified across repeated close cycles.
Noise, not a fault.

**A hydration mismatch warning mentioning `<body>`.** Browser extensions inject
attributes onto `<body>` before React hydrates. `suppressHydrationWarning` is set
on `<body>` for exactly this.

**Port already in use, or the wrong app answers.** Cockpit binds `127.0.0.1`
specifically, so another dev server bound to `0.0.0.0` can hold the same port
without an obvious conflict. Since `localhost` resolves to `::1` first, the other
app wins. Give Cockpit its own port with `PORT=3200`.

**A session shows an error about `claude` not being found.** The CLI has to be on
the PATH of the process running `npm run dev`.

**Typecheck fails with "Cannot find name 'RouteContext'".** Run
`npm run typecheck` rather than `tsc --noEmit` directly; the types are generated.

---

## Project layout

```
server.js                       custom server: Next handler + multiplexed /ws
src/
  lib/
    db.js                       SQLite store, migrations   (CommonJS)
    db.d.ts                     hand-written types for it
    sessionManager.js           owns every live PTY        (CommonJS)
    sessionManager.d.ts         hand-written types for it
    types.ts                    shared domain + frame types
    chime.ts                    Web Audio notification tones
    projectColor.ts             per-project accent colours
  app/
    page.tsx                    mounts the provider + shell
    layout.tsx, globals.css     design tokens, dark theme
    api/                        REST routes
  components/
    CockpitProvider.tsx         client store, the one WebSocket
    AppShell.tsx                tab bar, pane switching
    Board.tsx  Column.tsx  CardTile.tsx
    AttentionPanel.tsx          board-side triage for waiting sessions
    TerminalPane.tsx            xterm host, zoom, screen capture
    PromptComposer.tsx          the pre-filled editable prompt
    FolderPicker.tsx            filesystem browser
    ui.tsx                      buttons, dialogs, fields, primitives
data/cockpit.db                 your board (gitignored)
```

`db.js` and `sessionManager.js` are CommonJS JavaScript rather than TypeScript
because plain `node` loads them via `server.js`, outside the Next build. They have
hand-written `.d.ts` files so the app still gets full type checking.

---

## What's built, what isn't

Milestones M0–M2 of the build spec are done, plus parts of M3.

**Working:** the cross-project board with drag reordering; projects added by
folder with a filesystem picker; archiving; bulk-clearing Done; terminal sessions
that survive navigation and reloads with scrollback replay; cards wired to
sessions with a pre-filled prompt; tabbed sessions with idle/exit badging, chimes
and title counts; board-side triage with inline replies; restart in place;
terminal zoom.

**Not built yet:**

- A git panel (`status` / `diff` / commit / push from the UI). Git is manual in
  the terminal today.
- `--resume` / `--continue` to reattach to a previous Claude session.
- Headless mode: `claude -p` with `--output-format stream-json`, landing a diff
  and summary in Review to approve. `mode` and the cost/summary columns are
  already in the schema for it.
- Tab reordering.
- macOS/Linux verification. The platform branches exist but are untested.
