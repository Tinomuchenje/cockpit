const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { WebSocketServer } = require('ws');
const store = require('./src/lib/db');
const sessions = require('./src/lib/sessionManager');

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3000', 10);

/*
 * Turbopack doesn't treat node:sqlite as a builtin yet and fails to resolve it,
 * so pin the dev bundler to webpack, which externalises any node: import.
 */
const app = next({ dev, webpack: true });
const handle = app.getRequestHandler();

/*
 * Any PTY from a previous run died with that process, so no session in the DB
 * can still be live. Mark them ended before the UI reads them.
 */
store.reapStaleSessions();

app.prepare().then(() => {
  const nextUpgradeHandler = app.getUpgradeHandler();

  const server = createServer((req, res) => {
    handle(req, res, parse(req.url, true));
  });

  const wss = new WebSocketServer({ noServer: true });

  /*
   * One socket per browser tab, multiplexed across every session it cares
   * about. `subs` records which sessions each socket wants output for; status
   * changes go to everyone, because the board badges sessions whose terminal
   * isn't currently on screen.
   */
  const subs = new Map(); // ws -> Set<sessionId>

  function send(ws, frame) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
  }

  sessions.onEvent((event) => {
    for (const [ws, subscribed] of subs) {
      if (event.type === 'output') {
        if (subscribed.has(event.sessionId)) send(ws, event);
      } else {
        send(ws, event);
      }
    }
  });

  wss.on('connection', (ws) => {
    subs.set(ws, new Set());

    // Hydrate the client with whatever is already running.
    send(ws, { type: 'hello', sessions: sessions.listLiveSessions() });

    ws.on('message', (raw) => {
      let frame;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const subscribed = subs.get(ws);
      if (!subscribed) return;

      switch (frame.type) {
        case 'subscribe': {
          subscribed.add(frame.sessionId);
          // Scrollback goes down as a distinct `replay` frame, not `output`:
          // the client resets the terminal before writing it, so a double
          // subscribe (React strict mode remounts effects in dev) can't
          // render the buffer twice.
          send(ws, {
            type: 'replay',
            sessionId: frame.sessionId,
            data: sessions.getScrollback(frame.sessionId),
          });
          break;
        }
        case 'unsubscribe':
          subscribed.delete(frame.sessionId);
          break;
        case 'input':
          sessions.write(frame.sessionId, frame.data);
          break;
        case 'resize':
          sessions.resize(frame.sessionId, frame.cols, frame.rows);
          break;
      }
    });

    ws.on('close', () => {
      // Dropping a socket must never kill a PTY — sessions outlive browser tabs.
      subs.delete(ws);
    });
  });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = parse(req.url, true);
    if (pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
    } else {
      // Next's dev-mode HMR socket upgrades on this server too. Dropping it
      // silently breaks client-side hydration, so hand it back to Next.
      nextUpgradeHandler(req, socket, head);
    }
  });

  /*
   * Loopback only, and this is not optional. A terminal served over HTTP is a
   * remote shell the moment it's reachable off-machine, and /api/browse will
   * happily enumerate the filesystem. There is no auth here, so the bind
   * address IS the security boundary.
   */
  server.listen(port, '127.0.0.1', () => {
    console.log(`> Cockpit ready on http://localhost:${port}`);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      sessions.shutdown();
      server.close(() => process.exit(0));
    });
  }
});
