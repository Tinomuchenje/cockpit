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
- [Ideas for later](#ideas-for-later)

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

### See what a session can reach

**Environment** in the project bar lists the skills, MCP servers and plugins a
session in that project will actually have, read live from Claude Code's own
config. Filter across all three, and expand a skill to read its full description.

Two things it's careful about:

- **Skills from disabled plugins are not listed.** The files are still on disk, so
  a naive scan would claim a skill is available when a session can't use it.
- **MCP servers needing auth are distinguished by scope.** A *configured* server
  (user or project) needing authentication is flagged amber, because it's
  actionable. A claude.ai *connector* is listed but stays muted — you may never
  have intended to authorise it, and treating those as alarms makes the warning
  meaningless.

It's read-only by design. Claude Code owns these files and writes them while it
runs, so editing them here would race its own writes. Config changes also need a
respawn to take effect, which is what **Restart** on a session is for.

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
| `/api/environment` | `GET` | Skills, MCP servers and plugins for a project |

Deleting a card or clearing a column kills any live PTY for those cards first, so
a delete can't orphan a running process.

`/api/environment` reads Claude Code's config and **redacts before responding**.
MCP definitions routinely carry credentials — API keys in `env`, bearer tokens in
`headers`, a token in a URL query — so it returns only a name, a scope, a
transport label, and one identifying hint (a bare command name, or a URL's host
with no path or query). The raw config is never passed through.

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

**The page renders but nothing is interactive, with `webpack-hmr` errors in the
console.** Next blocks cross-origin requests to its dev endpoints, which rejects
the HMR WebSocket and leaves the app unhydrated. `allowedDevOrigins` in
`next.config.ts` permits the loopback literals, so `127.0.0.1` works as well as
`localhost` — add any other host you reach the dev server by. Development only.

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
    environment.ts              reads Claude Code's skills/MCP/plugin config
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
    EnvironmentDialog.tsx       skills / MCP / plugins panel
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
terminal zoom; a read-only Environment panel for skills, MCP servers and plugins.

**Not built yet** (the remaining spec milestones):

- A git panel (`status` / `diff` / commit / push from the UI). Git is manual in
  the terminal today.
- `--resume` / `--continue` to reattach to a previous Claude session.
- Headless mode: `claude -p` with `--output-format stream-json`, landing a diff
  and summary in Review to approve. `mode` and the cost/summary columns are
  already in the schema for it.
- Tab reordering.
- macOS/Linux verification. The platform branches exist but are untested.

---

## Ideas for later

Captured so they don't get lost. Roughly ordered by how ready each one is, with
the awkward part named — several of these are cheaper or more expensive than they
first look.

### Editing skills and MCP config

The read-only half is built — see [See what a session can
reach](#see-what-a-session-can-reach). `src/lib/environment.ts` reads:

| Source | Holds |
|---|---|
| `~/.claude/skills/` | user skills, either `<name>/SKILL.md` or a bundle a level deeper |
| plugin `installPath/skills/` | skills a plugin brings, if that plugin is enabled |
| `~/.claude/plugins/installed_plugins.json` | plugins, versions, marketplaces |
| `~/.claude/settings.json` | which plugins are enabled |
| `~/.claude.json` | MCP servers, per-project under `projects[path].mcpServers` |
| project `.mcp.json` | the shareable per-repo MCP convention |
| `~/.claude/mcp-needs-auth-cache.json` | servers and connectors needing auth |

**Editing** is the part left, and it's a bigger step than it looks: you'd be
writing files Claude Code owns while it may be writing them itself. If it's worth
doing, do it narrowly — toggling a plugin on or off is a single boolean in
`settings.json` and much safer than editing MCP definitions in place.

Also unbuilt: hooks (they live in `settings.json` and could be listed the same
way), and per-session environment rather than per-project — a session started
before a config change still has the old one, which the panel doesn't currently
distinguish.

### Model agnostic

Worth splitting, because three quite different things get called this and they
differ by orders of magnitude in cost:

1. **Another vendor's CLI** (Codex, Gemini CLI, opencode, and so on). Genuinely
   modest. `spawnClaude()` in `src/lib/sessionManager.js` is the only code that
   knows which binary runs; everything else — PTY handling, streaming, idle
   detection, scrollback, badging — is already vendor-neutral. Turn it into a
   small runner registry with a per-project or per-card choice, and store the
   runner on the card. The one thing that would need per-runner knowledge is the
   attention panel's quick keys, since `1`/`2`/`Enter` assume Claude Code's
   numbered prompts.

2. **Claude Code pointed at a different model** — Kimi, DeepSeek, a local model —
   via an OpenAI-compatible proxy and `ANTHROPIC_BASE_URL`. This is the cheapest
   option by far: it's environment configuration per project, with no
   architectural change at all. Probably where to start.

3. **Cockpit running its own agent loop.** Don't, unless the goal has genuinely
   changed. Cockpit is a session host; Claude Code is the harness and the loop.
   Building an agent here means owning tool dispatch, permissions, context
   management and streaming — a different product, and the reason the current
   design is as small as it is.

So: (2) for reach, (1) for real multi-vendor support, and treat (3) as a rewrite
rather than a feature.

### Agentic workflows

Running multi-step or fan-out work from a card rather than one interactive session.

This depends on **headless mode** landing first — you can't orchestrate an
interactive PTY unattended, which is the whole reason headless is a separate
milestone. Two constraints worth writing down now:

- Never run two writers in the same folder. Parallel work in one project needs
  isolated checkouts; Claude Code has native worktree support (`-w`) rather than
  hand-rolling it.
- Don't let the board imply more concurrency than the engine delivers. If several
  headless cards are queued, show them queued, not all active.

The board is already the right surface for this: a workflow card with sub-steps
maps onto columns more naturally than onto a terminal.

### Pulling tasks from project management tools

ClickUp, or whatever the tasks actually live in.

The honest cost here is **sync**, not the API. One-way import — pull tasks in as
cards, keep the external id and a link on the card, never write back — is a small
feature and sidesteps the hard part entirely. Two-way sync means reconciling
status models, handling edits on both sides, and conflict rules, and it is where
integrations like this usually stop being worth it.

Two things to settle before building anything:

- **Is ClickUp the right target?** If the team's work actually lives in Asana,
  build for that instead. Pick the tool tasks genuinely originate in — an
  integration with the wrong one is worse than none.
- **Does a task from a tracker make a good card?** Cards here need a real
  description with acceptance criteria to be worth running. A one-line ticket
  title imported as a card will just mean more back-and-forth in the session. An
  import that pulls the ticket's full description and comments is useful; one that
  pulls titles is noise.

Start read-only, with a manual "import" action rather than background polling, and
see whether the imported cards actually get run.
