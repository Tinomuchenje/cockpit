/*
 * Electron shell.
 *
 * The window is a thin client: it loads the same localhost server the browser
 * would. What Electron buys is lifecycle. The server is a child of this
 * process, so opening the app starts it and quitting the app stops it, with no
 * hidden process left behind and no launcher script to run.
 *
 * The server runs as a *forked Node process*, not inside the main process.
 * ELECTRON_RUN_AS_NODE makes Electron's binary behave as plain Node, so
 * server.js runs in a genuine Node 24 environment. That keeps Next.js and
 * node-pty away from Electron's patched globals, and means server.js needs no
 * knowledge that Electron exists.
 */
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { fork, spawnSync } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server.js');
const START_PORT = 3000;
const BOOT_TIMEOUT_MS = 60_000;

let serverProcess = null;
let serverPort = null;
let mainWindow = null;
let quitting = false;

/*
 * A packaged app's working directory is wherever Explorer launched it from, and
 * its own folder is read-only. The board has to live in per-user app data.
 * db.js already honours COCKPIT_DATA_DIR, so no source change is needed.
 *
 * An explicit COCKPIT_DATA_DIR still wins, so the app can be pointed at the
 * same board as `npm run dev` (or a throwaway one) rather than being stuck
 * with a second, separate board it silently created.
 */
const DATA_DIR = process.env.COCKPIT_DATA_DIR
  ? path.resolve(process.env.COCKPIT_DATA_DIR)
  : app.getPath('userData');

function findFreePort(from) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', (err) => {
      if (err.code === 'EADDRINUSE') resolve(findFreePort(from + 1));
      else reject(err);
    });
    // 127.0.0.1 specifically: the server binds the IPv4 loopback only, so a
    // port free on :: but taken on 127.0.0.1 is not actually free for us.
    probe.once('listening', () => probe.close(() => resolve(from)));
    probe.listen(from, '127.0.0.1');
  });
}

function ping(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/api/projects', timeout: 2000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function startServer() {
  serverPort = await findFreePort(START_PORT);

  serverProcess = fork(SERVER, [], {
    cwd: ROOT, // Next resolves .next relative to cwd.
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(serverPort),
      COCKPIT_DATA_DIR: DATA_DIR,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  // Without this the server is silent when packaged. Surfaced in the terminal
  // during development, and reachable via --enable-logging when packaged.
  serverProcess.stdout?.on('data', (d) => process.stdout.write(`[server] ${d}`));
  serverProcess.stderr?.on('data', (d) => process.stderr.write(`[server] ${d}`));

  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`Server exited during startup (code ${serverProcess.exitCode})`);
    }
    if (await ping(serverPort)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server did not answer on port ${serverPort} within ${BOOT_TIMEOUT_MS}ms`);
}

function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  const pid = serverProcess.pid;

  if (process.platform === 'win32') {
    /*
     * Windows has no process groups and no real SIGTERM, so the server's own
     * graceful-shutdown handler never runs. Killing only the server would
     * orphan every ConPTY it spawned, leaving claude processes running with
     * nothing attached. /T takes the whole tree.
     */
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    // Elsewhere SIGTERM reaches server.js, which calls sessions.shutdown().
    serverProcess.kill('SIGTERM');
  }
  serverProcess = null;
}

async function liveSessionCount() {
  if (!serverPort) return 0;
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: serverPort, path: '/api/sessions', timeout: 2000 },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            const sessions = JSON.parse(body);
            resolve(
              Array.isArray(sessions)
                ? sessions.filter((s) => s.status !== 'exited' && s.status !== 'cancelled').length
                : 0
            );
          } catch {
            resolve(0);
          }
        });
      }
    );
    req.on('error', () => resolve(0));
    req.on('timeout', () => {
      req.destroy();
      resolve(0);
    });
  });
}

/*
 * Updates are Windows-only, and that is a platform limitation rather than a
 * choice: Squirrel.Mac refuses to apply an update to an unsigned app, so an
 * unnotarised mac build can never update itself. Mac users re-download.
 *
 * Downloading happens in the background and installs on quit, never mid-flight.
 * Restarting the app under a running Claude session to apply a patch release
 * would be a poor trade.
 */
const CAN_UPDATE = process.platform === 'win32' && app.isPackaged;

function checkForUpdates({ interactive = false } = {}) {
  if (!CAN_UPDATE) {
    if (interactive) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Updates',
        message: 'Automatic updates are not available on this build.',
        detail:
          process.platform === 'darwin'
            ? 'The macOS build is unsigned, and macOS will not apply updates to an unsigned app. Download the latest release from GitHub instead.'
            : 'Updates only apply to installed builds.',
      });
    }
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.on('error', (err) => {
    // A failed update check must never block using the app, so this is only
    // ever surfaced when the user asked.
    if (interactive) dialog.showErrorBox('Update check failed', String(err));
  });

  if (interactive) {
    autoUpdater.once('update-not-available', () => {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Updates',
        message: `Cockpit ${app.getVersion()} is the latest version.`,
      });
    });
    autoUpdater.checkForUpdates();
  } else {
    autoUpdater.checkForUpdatesAndNotify();
  }
}

/*
 * The default menu binds Ctrl/Cmd +, - and 0 to page zoom. Those are the
 * terminal's zoom keys, and a menu accelerator wins before the page ever sees
 * the event, so the default menu silently breaks a documented feature. This
 * menu keeps the useful items and drops the zoom ones.
 */
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Cockpit on GitHub',
          click: () => shell.openExternal('https://github.com/Tinomuchenje/cockpit'),
        },
        {
          label: 'Report an issue',
          click: () =>
            shell.openExternal('https://github.com/Tinomuchenje/cockpit/issues/new'),
        },
        { type: 'separator' },
        { label: 'Check for updates…', click: () => checkForUpdates({ interactive: true }) },
        { label: `Version ${app.getVersion()}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0d12', // Matches the dark theme, so no white flash on boot.
    title: 'Cockpit',
    show: false,
    // Windows and macOS read the icon from the exe/app bundle regardless, but
    // Linux (and a dev-mode `electron .`) only ever show a window icon if one
    // is set here. build/icon.png always exists by this point: it's a
    // postinstall step (see scripts/make-icon.mjs).
    icon: path.join(ROOT, 'build', 'icon.png'),
    webPreferences: {
      // The renderer is just a web page talking to localhost over HTTP. It
      // needs no Node access, so it doesn't get any.
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);

  // Anything that isn't the app itself belongs in the real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  /*
   * Closing the window ends every running Claude session, because the PTYs are
   * children of the server. That is a surprising amount to lose to a stray
   * Ctrl+W, so confirm when anything is actually live.
   */
  mainWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    liveSessionCount().then((count) => {
      if (count > 0) {
        const response = dialog.showMessageBoxSync(mainWindow, {
          type: 'warning',
          buttons: ['Quit and end sessions', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
          title: 'Sessions still running',
          message: `${count} session${count === 1 ? ' is' : 's are'} still running.`,
          detail: 'Quitting Cockpit ends them. Any unsaved work in those sessions is lost.',
        });
        if (response !== 0) return;
      }
      quitting = true;
      app.quit();
    });
  });
}

// A second launch should focus the existing window, not start a second server
// fighting for the port and the same database file.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    buildMenu();
    try {
      await startServer();
    } catch (err) {
      dialog.showErrorBox(
        'Cockpit could not start',
        `${err.message}\n\nThe board lives in:\n${DATA_DIR}`
      );
      app.exit(1);
      return;
    }
    createWindow();

    // Delayed so a slow or unreachable update server can't hold up first paint.
    setTimeout(() => checkForUpdates(), 5_000);
  });

  // Quit on last window closed everywhere, macOS included. The usual macOS
  // convention of staying resident would leave the server and its sessions
  // running behind a closed window, which is the confusion this shell exists
  // to remove.
  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('will-quit', stopServer);
  process.on('exit', stopServer);
}
