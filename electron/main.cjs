// electron/main.cjs
// Main process for the identity operations workstation.
//
// Deliberately smaller than the 3D lab's: there is no WebGL to enable and no
// renderer that needs Node. What it does own:
//
//   - loading the production build
//   - a single-instance lock, because two copies would fight over the same
//     persisted documents, notes and desktop layout
//   - opening external links in the real browser rather than inside the app
//   - auto-update through electron-updater and GitHub Releases
//   - reporting whether Ollama is reachable, which the renderer cannot always
//     answer for itself
//
// The renderer stays sandboxed. Everything it needs crosses through preload.

const { app, BrowserWindow, shell, ipcMain, net, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');

let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch {
  // Only present in packaged builds. A dev launch continues without it.
  autoUpdater = null;
}

const DIST = path.join(__dirname, '..', 'dist');
const INDEX_HTML = path.join(DIST, 'index.html');
const OLLAMA_URL = 'http://127.0.0.1:11434/api/tags';

/** 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' */
let updateState = 'idle';
let updateInfo = null;
let updateError = null;

let mainWindow = null;

// ---------------------------------------------------------------------------
// Auto-update
// ---------------------------------------------------------------------------

function currentStatus() {
  return {
    state: autoUpdater ? updateState : 'unsupported',
    info: updateInfo,
    ...(updateError ? { error: updateError } : {}),
  };
}

function broadcast() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:status', currentStatus());
  }
}

function setupAutoUpdater() {
  if (!autoUpdater) return;

  autoUpdater.logger = {
    info: (...a) => console.log('[updater]', ...a),
    warn: (...a) => console.warn('[updater]', ...a),
    error: (...a) => console.error('[updater]', ...a),
  };
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    updateState = 'checking';
    updateError = null;
    broadcast();
  });
  autoUpdater.on('update-available', (info) => {
    updateState = 'available';
    updateInfo = { version: info.version, releaseNotes: info.releaseNotes ?? null };
    broadcast();
  });
  autoUpdater.on('update-not-available', () => {
    updateState = 'idle';
    updateInfo = null;
    broadcast();
  });
  autoUpdater.on('download-progress', (p) => {
    updateState = 'downloading';
    updateInfo = { ...(updateInfo ?? {}), progress: Math.round(p.percent) };
    broadcast();
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateState = 'downloaded';
    updateInfo = { version: info.version, releaseNotes: info.releaseNotes ?? null };
    broadcast();
  });
  // A failed check is reported as a failure. Reporting it as "no updates
  // available" is how a broken updater once shipped unnoticed in this project.
  autoUpdater.on('error', (err) => {
    updateState = 'error';
    updateError = err == null ? 'Unknown updater error' : String(err.message ?? err);
    broadcast();
  });
}

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

/**
 * Whether a local Ollama is answering.
 *
 * Asked from the main process because it is not subject to the renderer's
 * origin rules, so a negative answer here means Ollama really is not running
 * rather than that the page was not allowed to ask.
 */
function probeOllama(timeoutMs = 1200) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const timer = setTimeout(() => done(false), timeoutMs);

    try {
      const request = net.request(OLLAMA_URL);
      request.on('response', (response) => {
        clearTimeout(timer);
        done(response.statusCode >= 200 && response.statusCode < 300);
      });
      request.on('error', () => {
        clearTimeout(timer);
        done(false);
      });
      request.end();
    } catch {
      clearTimeout(timer);
      done(false);
    }
  });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function envPayload() {
  return { IS_ELECTRON: true, APP_VERSION: app.getVersion() };
}

ipcMain.handle('env:get', () => envPayload());
ipcMain.on('env:get:sync', (event) => {
  event.returnValue = envPayload();
});

ipcMain.handle('update:getStatus', () => currentStatus());

ipcMain.handle('update:check', async () => {
  if (!autoUpdater) return currentStatus();
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    updateState = 'error';
    updateError = String(err?.message ?? err);
    broadcast();
  }
  return currentStatus();
});

ipcMain.handle('update:download', async () => {
  if (!autoUpdater) return currentStatus();
  try {
    updateState = 'downloading';
    broadcast();
    await autoUpdater.downloadUpdate();
  } catch (err) {
    updateState = 'error';
    updateError = String(err?.message ?? err);
    broadcast();
  }
  return currentStatus();
});

ipcMain.handle('update:install', () => {
  if (!autoUpdater) return false;
  autoUpdater.quitAndInstall();
  return true;
});

ipcMain.handle('ollama:probe', () => probeOllama());

/**
 * Capture the workstation's own window, for the annotation tool.
 *
 * capturePage rather than desktopCapturer on purpose: the renderer gets a
 * picture of this window and nothing else. desktopCapturer would hand a web
 * page the ability to photograph the user's real desktop -- their email, their
 * password manager -- which is not a capability a training VM has any business
 * holding, and not one that can be taken back once exposed.
 */
ipcMain.handle('capture:screen', async () => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    const image = await mainWindow.webContents.capturePage();
    return image.isEmpty() ? null : image.toDataURL();
  } catch {
    return null;
  }
});

/**
 * Write a capture to the real filesystem.
 *
 * The annotation tools used to "save" through an <a download> from a file://
 * page, which in a packaged application is at best a dialog and at worst
 * nothing at all — the tool said "Saved." and there was no file. This writes
 * the bytes itself, under Documents\IAM Range, and returns the path so the
 * toast can name it.
 *
 * The filename is taken apart and rebuilt rather than trusted: it arrives from
 * the renderer, and a name is not a path. Anything with a separator, a drive
 * letter or a traversal in it is reduced to its basename, so a capture cannot
 * be written outside the folder this function owns.
 */
ipcMain.handle('capture:save', async (_event, payload) => {
  try {
    const raw = String(payload?.name ?? '');
    const base = path.basename(raw).replace(/[^A-Za-z0-9._-]/g, '_');
    if (!base || base === '.' || base === '..') return null;
    // Only the two things the capture tools produce.
    if (!/\.(png|webm)$/i.test(base)) return null;

    const base64 = String(payload?.base64 ?? '');
    if (!base64 || !/^[A-Za-z0-9+/=\s]+$/.test(base64)) return null;

    const dir = path.join(app.getPath('documents'), 'IAM Range');
    await fs.promises.mkdir(dir, { recursive: true });
    const target = path.join(dir, base);
    await fs.promises.writeFile(target, Buffer.from(base64, 'base64'));
    return target;
  } catch (err) {
    console.error('[capture] save failed', err);
    return null;
  }
});

/** Reveal a saved capture in the real file manager. */
ipcMain.handle('capture:reveal', (_event, target) => {
  try {
    const dir = path.join(app.getPath('documents'), 'IAM Range');
    const resolved = path.resolve(String(target));
    // Only inside the folder this application writes to. "Show me a file"
    // must not become "show me any file on the disk".
    if (!resolved.startsWith(path.resolve(dir) + path.sep)) return false;
    shell.showItemInFolder(resolved);
    return true;
  } catch {
    return false;
  }
});

// Opening a link is the one thing the renderer cannot do for itself, and it
// must never become "run whatever the page passes". Only http and https.
ipcMain.handle('shell:openExternal', (_event, url) => {
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    void shell.openExternal(parsed.toString());
    return true;
  } catch {
    return false;
  }
});

/**
 * Ask the renderer which screen or window to share, and wait for the answer.
 *
 * One request at a time: `pendingPick` is the resolver for the outstanding
 * question. A second request while one is open cancels the first rather than
 * leaving a picker on screen that nothing is listening to.
 *
 * The timeout exists because this promise gates a permission callback. If the
 * renderer never answers -- a crash, a closed window -- the callback would
 * never fire and getDisplayMedia would hang forever with no way for the user
 * to get out of it.
 */
let pendingPick = null;

function askRendererToPick(sources) {
  if (pendingPick) {
    pendingPick(null);
    pendingPick = null;
  }
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve(null);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pendingPick === settle) pendingPick = null;
      resolve(null);
    }, 120_000);

    const settle = (id) => {
      clearTimeout(timer);
      resolve(id);
    };
    pendingPick = settle;
    mainWindow.webContents.send('capture:pick-source', sources);
  });
}

// The renderer's answer. A null id is "cancelled", which is an ordinary
// outcome and not an error.
ipcMain.handle('capture:sourcePicked', (_event, id) => {
  const settle = pendingPick;
  pendingPick = null;
  if (settle) settle(id == null ? null : String(id));
  return true;
});

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0a0d12',
    show: false,
    // Mirrors PRODUCT.windowTitle in src/config/product.ts, which this
    // CommonJS module cannot import. tests/branding.test.ts checks them.
    title: 'IAM Range — Identity Operations Workstation',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // The in-VM browser renders real pages in a <webview>. Without this it
      // falls back to an iframe, which Google and most other sites decline —
      // the packaged app looked more limited than the web build had to be.
      webviewTag: true,
    },
  });

  // A webview is still fenced: it may only load what the allowlist permits,
  // enforced here as well as in the renderer so a bug in one is not the only
  // thing standing between the lab and the open internet.
  mainWindow.webContents.on('will-attach-webview', (_event, webPreferences) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
  });

  /**
   * Who may ask for what.
   *
   * Without a handler Electron's default applies to everything this window
   * loads, and this window renders arbitrary pages inside a webview. The
   * recorder needs a microphone for narration and a camera for the presenter
   * bubble, so media is granted to the workstation's own document -- loaded
   * from file: -- and to nothing else. A page in the in-VM browser asking for
   * the microphone, the camera, the user's location or notifications is
   * refused, because there is no feature there that needs any of those and an
   * unasked-for grant is the kind of thing nobody discovers until it matters.
   *
   * That fence is the part that always mattered. Widening the workstation's
   * own capability to record a tutorial does not widen anything a browsed page
   * can reach.
   */
  mainWindow.webContents.session.setPermissionRequestHandler(
    (contents, permission, callback) => {
      const url = contents?.getURL?.() ?? '';
      const isTheApp = url.startsWith('file://');
      if (permission === 'media' && isTheApp) {
        callback(true);
        return;
      }
      callback(false);
    },
  );

  // The synchronous counterpart, consulted for some checks rather than the
  // handler above. Same rule, so the two cannot disagree.
  mainWindow.webContents.session.setPermissionCheckHandler((_contents, permission, origin) => {
    return permission === 'media' && String(origin).startsWith('file://');
  });

  /**
   * What the recorder is allowed to record.
   *
   * getDisplayMedia does not work in Electron at all without this: with no
   * handler the request is denied outright, which is why the recorder had to
   * be built out of repeated window captures in the first place.
   *
   * The user still chooses. `useSystemPicker` hands the decision to the
   * operating system where one exists; where it does not, the source list is
   * sent to the renderer, which shows its own picker with a thumbnail of every
   * screen and window. Nothing is granted until something is picked, and
   * cancelling grants nothing -- callback({}) is a denial, and the recorder
   * treats it as "the user changed their mind" rather than an error.
   */
  mainWindow.webContents.session.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 320, height: 200 },
          fetchWindowIcons: false,
        });
        if (sources.length === 0) {
          callback({});
          return;
        }

        const chosenId = await askRendererToPick(
          sources.map((s) => ({
            id: s.id,
            name: s.name,
            kind: s.id.startsWith('screen:') ? 'screen' : 'window',
            thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
          })),
        );

        const source = sources.find((s) => s.id === chosenId);
        if (!source) {
          callback({});
          return;
        }
        // 'loopback' is system audio on Windows. The user still has to have
        // asked for audio; a video-only request gets video only.
        callback({ video: source, audio: 'loopback' });
      } catch (err) {
        console.error('[capture] display media request failed', err);
        callback({});
      }
    },
    { useSystemPicker: true },
  );

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Anything the page tries to open in a new window goes to the real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // And a navigation away from the app is not a navigation, it is a link.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url);
    }
  });

  void mainWindow.loadFile(INDEX_HTML);
}

// Two copies would fight over the same saved documents, sticky notes and
// desktop layout, and the loser's writes would vanish without a word.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    setupAutoUpdater();
    createWindow();

    // A check on launch, after the window has settled. Failures surface in the
    // UI rather than as a dialog nobody asked for.
    if (autoUpdater) {
      setTimeout(() => {
        autoUpdater.checkForUpdates().catch((err) => {
          updateState = 'error';
          updateError = String(err?.message ?? err);
          broadcast();
        });
      }, 4000);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
