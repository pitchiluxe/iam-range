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
function probeOllama(timeoutMs = 4000) {
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
 * The renderer's requests to Ollama, made from here.
 *
 * The packaged app loads its page from file:, so every fetch it makes carries
 * "Origin: null" -- and Ollama answers 403 to that origin unless the learner
 * happened to set OLLAMA_ORIGINS. That is why the instructor, the tutor and
 * "Generate work" worked on some computers and not on others, and always in
 * development (http://localhost is allowed). The main process sends no origin
 * at all, so Ollama accepts it everywhere, with no setting to change.
 *
 * Only paths under /api/ on the local Ollama are reachable, only the
 * workstation's own window may ask, and the reply streams back chunk by chunk
 * so long answers still appear word by word.
 */
const OLLAMA_BASE = new URL(OLLAMA_URL).origin;
const ollamaRequests = new Map();

ipcMain.on('ollama:request', async (event, id, req) => {
  const key = `${event.sender.id}:${id}`;
  const send = (kind, data) => {
    if (!event.sender.isDestroyed()) event.sender.send('ollama:event', id, kind, data);
  };
  let url;
  try {
    url = new URL(String(req?.path ?? ''), OLLAMA_BASE);
  } catch {
    url = null;
  }
  if (!mainWindow || event.sender !== mainWindow.webContents || !url || url.origin !== OLLAMA_BASE || !url.pathname.startsWith('/api/')) {
    send('error', 'Request refused');
    return;
  }
  const ctl = new AbortController();
  ollamaRequests.set(key, ctl);
  try {
    const post = req.method === 'POST';
    const res = await net.fetch(url.href, {
      method: post ? 'POST' : 'GET',
      body: post && typeof req.body === 'string' ? req.body : undefined,
      headers: post ? { 'Content-Type': 'application/json' } : undefined,
      signal: ctl.signal,
    });
    send('head', { status: res.status, statusText: res.statusText });
    if (res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        send('data', decoder.decode(value, { stream: true }));
      }
    }
    send('end');
  } catch (err) {
    send('error', String(err?.message ?? err));
  } finally {
    ollamaRequests.delete(key);
  }
});

ipcMain.on('ollama:abort', (event, id) => {
  ollamaRequests.get(`${event.sender.id}:${id}`)?.abort();
});

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

// ---------------------------------------------------------------------------
// AD Enterprise Lab on real VirtualBox VMs
//
// Three narrow channels, each bound to the two lab VMs named in
// adlab.vbox.json — never to an arbitrary VM, command or path:
//   adlab:vm-status  which of DC01 / CLIENT01 exist and are running
//   adlab:vm-start   start one of them (in its own VirtualBox window)
//   adlab:vm-facts   run the read-only collector and return its JSON
// Grading happens in the renderer, with the same engine the simulator uses.
// ---------------------------------------------------------------------------
const { execFile } = require('child_process');
const ADLAB_KEYS = ['DC01', 'CLIENT01'];

function adlabKitDir() {
  const candidates = [
    path.join(process.resourcesPath || '', 'omari-lab', '10-AD-ENTERPRISE-VBOX'),
    path.join(process.resourcesPath || '', 'adlab-vbox'),
    path.join(__dirname, '..', 'omari-lab', '10-AD-ENTERPRISE-VBOX'),
  ];
  return candidates.find((d) => fs.existsSync(path.join(d, 'Get-AdLabFacts.ps1'))) || null;
}

function adlabConfig() {
  const dir = adlabKitDir();
  if (!dir) return null;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'adlab.vbox.json'), 'utf8'));
    cfg.vboxManage = String(cfg.vboxManage).replace(/%([^%]+)%/g, (_m, v) => process.env[v] || '');
    return { dir, cfg };
  } catch {
    return null;
  }
}

function run(file, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) =>
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }),
    );
  });
}

ipcMain.handle('adlab:vm-status', async () => {
  const kit = adlabConfig();
  if (!kit) return { ok: false, error: 'The VirtualBox kit (omari-lab/10-AD-ENTERPRISE-VBOX) was not found.' };
  if (!fs.existsSync(kit.cfg.vboxManage)) return { ok: false, error: 'VirtualBox is not installed (VBoxManage not found).' };
  const all = await run(kit.cfg.vboxManage, ['list', 'vms'], 20_000);
  const running = await run(kit.cfg.vboxManage, ['list', 'runningvms'], 20_000);
  const vms = {};
  for (const key of ADLAB_KEYS) {
    const name = kit.cfg.vms[key].vmName;
    vms[key] = { vmName: name, exists: all.stdout.includes(`"${name}"`), running: running.stdout.includes(`"${name}"`) };
  }
  return { ok: true, vms };
});

ipcMain.handle('adlab:vm-start', async (_event, key) => {
  if (!ADLAB_KEYS.includes(key)) return false;
  const kit = adlabConfig();
  if (!kit) return false;
  const res = await run(kit.cfg.vboxManage, ['startvm', kit.cfg.vms[key].vmName, '--type', 'gui'], 60_000);
  return !res.err;
});

// Snapshots are how a real lab is reset: "LabNN-Start" is the moment a lab
// began, "Lab01-Start" the fresh machines. Names are restricted so a renderer
// can never pass anything VBoxManage would read as an option or a path.
const SNAPSHOT_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,39}$/;

async function snapshotNames(kit, vmName) {
  const res = await run(kit.cfg.vboxManage, ['snapshot', vmName, 'list', '--machinereadable'], 30_000);
  return [...res.stdout.matchAll(/^SnapshotName[^=]*="(.*)"$/gm)].map((m) => m[1]);
}

ipcMain.handle('adlab:vm-snapshots', async () => {
  const kit = adlabConfig();
  if (!kit) return { ok: false, error: 'The VirtualBox kit was not found.' };
  const out = {};
  for (const key of ADLAB_KEYS) out[key] = await snapshotNames(kit, kit.cfg.vms[key].vmName);
  return { ok: true, snapshots: out };
});

/**
 * Save and restore go through the kit's AdLab-Snapshot.ps1 — the same script
 * a learner can run by hand — so the app and the command line behave the same.
 * It saves OFFLINE (clean shutdown, snapshot, start again): live snapshots
 * crashed VirtualBox's service on a host like this one.
 */
async function snapshotScript(kit, args) {
  const script = path.join(kit.dir, 'AdLab-Snapshot.ps1');
  const res = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args, '-Json'], 1_200_000);
  const line = res.stdout.split(/\r?\n/).filter((l) => l.trim().startsWith('{')).pop();
  if (!line) return { ok: false, error: (res.stderr || res.stdout || String(res.err || 'No output')).slice(0, 500) };
  try {
    return JSON.parse(line);
  } catch (e) {
    return { ok: false, error: `Could not read the snapshot script output: ${e.message}` };
  }
}

ipcMain.handle('adlab:vm-save', async (_event, name) => {
  if (typeof name !== 'string' || !SNAPSHOT_NAME.test(name)) return { ok: false, error: 'Invalid snapshot name.' };
  const kit = adlabConfig();
  if (!kit) return { ok: false, error: 'The VirtualBox kit was not found.' };
  return snapshotScript(kit, ['-Save', name]);
});

// Where the VirtualBox kit lives, for the setup guide: the install folder is
// the learner's choice, so the guide asks rather than guessing.
ipcMain.handle('adlab:kit-folder', () => adlabKitDir());
ipcMain.handle('adlab:open-kit-folder', async () => {
  const dir = adlabKitDir();
  if (!dir) return { ok: false, error: 'The VirtualBox kit was not found.' };
  const err = await shell.openPath(dir);
  return err ? { ok: false, error: err } : { ok: true, dir };
});

ipcMain.handle('adlab:vm-restore', async (_event, name) => {
  if (typeof name !== 'string' || !SNAPSHOT_NAME.test(name)) return { ok: false, error: 'Invalid snapshot name.' };
  const kit = adlabConfig();
  if (!kit) return { ok: false, error: 'The VirtualBox kit was not found.' };
  return snapshotScript(kit, ['-Restore', name]);
});

// ---------------------------------------------------------------------------
// IAM Portfolio — VM track on the same DC01
//   portfolio:vm-init         prepare DC01 (domain + baseline + Portfolio-Base)
//   portfolio:vm-setup  (id)  set up / restart one project's scenario
//   portfolio:vm-facts        read-only collection for the deterministic checks
// Bound to the kit's own scripts and the six VM project ids — nothing else.
// ---------------------------------------------------------------------------
const PORTFOLIO_VM_PROJECTS = ['p01', 'p02', 'p03', 'p04', 'p08', 'p10'];

function portfolioVmDir() {
  const candidates = [
    path.join(process.resourcesPath || '', 'omari-lab', '11-IAM-PORTFOLIO', 'vm'),
    path.join(__dirname, '..', 'omari-lab', '11-IAM-PORTFOLIO', 'vm'),
  ];
  return candidates.find((d) => fs.existsSync(path.join(d, 'Get-PortfolioFacts.ps1'))) || null;
}

async function portfolioScript(name, args, timeoutMs) {
  const dir = portfolioVmDir();
  if (!dir) return { ok: false, error: 'The portfolio VM kit (omari-lab/11-IAM-PORTFOLIO/vm) was not found.' };
  const res = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(dir, name), ...args, '-Json'], timeoutMs);
  const line = res.stdout.split(/\r?\n/).filter((l) => l.trim().startsWith('{')).pop();
  if (!line) return { ok: false, error: (res.stderr || res.stdout || String(res.err || 'No output')).slice(0, 800) };
  try {
    return JSON.parse(line);
  } catch (e) {
    return { ok: false, error: `Could not read the script output: ${e.message}` };
  }
}

ipcMain.handle('portfolio:vm-init', () => portfolioScript('Initialize-PortfolioDC.ps1', [], 3_600_000));

ipcMain.handle('portfolio:vm-setup', (_event, project) => {
  if (!PORTFOLIO_VM_PROJECTS.includes(project)) return { ok: false, error: 'Not a VM-track project.' };
  return portfolioScript('Set-PortfolioScenario.ps1', ['-Project', project], 900_000);
});

ipcMain.handle('portfolio:vm-facts', () => portfolioScript('Get-PortfolioFacts.ps1', [], 900_000));

ipcMain.handle('adlab:vm-facts', async () => {
  const kit = adlabConfig();
  if (!kit) return { ok: false, error: 'The VirtualBox kit (omari-lab/10-AD-ENTERPRISE-VBOX) was not found.' };
  const script = path.join(kit.dir, 'Get-AdLabFacts.ps1');
  const res = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Json'], 600_000);
  const line = res.stdout.split(/\r?\n/).filter((l) => l.trim().startsWith('{')).pop();
  if (!line) return { ok: false, error: (res.stderr || res.stdout || String(res.err || 'No output')).slice(0, 800) };
  try {
    return { ok: true, doc: JSON.parse(line) };
  } catch (e) {
    return { ok: false, error: `Could not read the collector output: ${e.message}` };
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
// Real PowerShell console (90-Day Challenge)
// ---------------------------------------------------------------------------
//
// The simulated terminal speaks the ActiveDirectory module against the
// workstation's own directory. The Entra ID and Graph labs need the real thing
// — Connect-MgGraph, Invoke-RestMethod, Install-Module — so this runs
// powershell.exe on this computer, as the signed-in Windows user, only when the
// learner opens the "PowerShell (this PC)" window. Webviews get no preload, so
// a browsed page can never reach these channels.
//
// Protocol: powershell.exe reads commands from stdin (-Command -). Each block
// the learner submits is sent base64-encoded and dot-sourced, so functions and
// variables persist between blocks, then a marker line carrying a per-session
// random nonce reports "finished" and the current directory. A script cannot
// print the marker by accident, and cannot forge it without the nonce.

const crypto = require('crypto');
const { spawn } = require('child_process');
const pwshSessions = new Map();
let pwshSeq = 0;

/**
 * Send one block. Command and marker travel on ONE line: anything queued behind
 * a running command would be read by the next Read-Host as its answer.
 */
function pwshRun(session, code) {
  const b64 = Buffer.from(code, 'utf8').toString('base64');
  session.child.stdin.write(
    `. ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')))); ` +
      `[Console]::Out.WriteLine('${session.marker}' + (Get-Location).Path)\n`,
  );
}

function pwshSend(sender, id, kind, data) {
  if (!sender.isDestroyed()) sender.send('pwsh:event', id, kind, data);
}

ipcMain.handle('pwsh:start', (event) => {
  if (process.platform !== 'win32') return { error: 'The PowerShell console needs Windows.' };
  const id = ++pwshSeq;
  const nonce = crypto.randomBytes(12).toString('hex');
  const marker = `<<C90-DONE-${nonce}>>`;
  const askMarker = `<<C90-ASK-${nonce}>>`;
  const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '-'], {
    cwd: app.getPath('documents'),
    windowsHide: true,
  });
  const sender = event.sender;
  let pending = '';

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    const out = [];
    for (const line of lines) {
      if (line.startsWith(marker)) {
        if (out.length) pwshSend(sender, id, 'out', out.splice(0).join('\n') + '\n');
        pwshSend(sender, id, 'done', line.slice(marker.length));
      } else if (line.startsWith(askMarker)) {
        // Read-Host is waiting; '1' means the answer is a secret to mask.
        if (out.length) pwshSend(sender, id, 'out', out.splice(0).join('\n') + '\n');
        pwshSend(sender, id, 'ask', line.slice(askMarker.length) === '1');
      } else {
        out.push(line);
      }
    }
    if (out.length) pwshSend(sender, id, 'out', out.join('\n') + '\n');
    // A prompt such as Read-Host's has no newline yet: show it now, unless it
    // could be the start of the marker.
    if (pending && !marker.startsWith(pending) && !askMarker.startsWith(pending)) {
      pwshSend(sender, id, 'out', pending);
      pending = '';
    }
  });
  child.stderr.on('data', (chunk) => pwshSend(sender, id, 'err', chunk));
  child.on('error', (err) => pwshSend(sender, id, 'err', `Could not start PowerShell: ${err.message}\n`));
  child.on('exit', (code) => {
    pwshSessions.delete(id);
    pwshSend(sender, id, 'exit', code);
  });
  sender.once('destroyed', () => child.kill());

  pwshSessions.set(id, { child, marker });
  // UTF-8 both ways, no progress bars (console-only noise here), and a
  // Read-Host that works over a pipe. The built-in one reads whatever line is
  // queued next and, with -AsSecureString, waits on a console that does not
  // exist. This one tells the window to show an input box, then reads the
  // answer the learner types.
  const init = [
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'",
    'function global:Read-Host { param([Parameter(Position=0)][object]$Prompt, [switch]$AsSecureString, [switch]$MaskInput)',
    `  [Console]::Out.WriteLine('${askMarker}' + [int]($AsSecureString -or $MaskInput))`,
    "  if ($Prompt) { [Console]::Out.Write([string]$Prompt + ': ') }",
    '  $line = [Console]::In.ReadLine()',
    "  [Console]::Out.WriteLine('')",
    '  if ($AsSecureString) { ConvertTo-SecureString $line -AsPlainText -Force } else { $line } }',
  ].join('\n');
  pwshRun(pwshSessions.get(id), init);
  return { id };
});

ipcMain.handle('pwsh:run', (_event, id, code) => {
  const s = pwshSessions.get(id);
  if (!s || typeof code !== 'string') return false;
  pwshRun(s, code);
  return true;
});

// A line typed while a command is still running: the answer to Read-Host.
ipcMain.handle('pwsh:input', (_event, id, line) => {
  const s = pwshSessions.get(id);
  if (!s || typeof line !== 'string') return false;
  s.child.stdin.write(line.replace(/\r?\n/g, ' ') + '\n');
  return true;
});

ipcMain.handle('pwsh:stop', (_event, id) => {
  const s = pwshSessions.get(id);
  if (!s) return false;
  // /T takes the whole tree: a hung Install-Module or python -m http.server
  // is a child of powershell.exe and would otherwise outlive it.
  execFile('taskkill', ['/PID', String(s.child.pid), '/T', '/F'], () => {});
  return true;
});

app.on('before-quit', () => {
  for (const { child } of pwshSessions.values()) child.kill();
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
