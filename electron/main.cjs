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

const { app, BrowserWindow, shell, ipcMain, net } = require('electron');
const path = require('path');

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
    title: 'Identity Operations Workstation',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

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
