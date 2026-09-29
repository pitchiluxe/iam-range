// electron/preload.cjs
// The only bridge between the renderer and the main process.
//
// Exposes:
//   window.electron.invoke(cmd, ...args)  — call a main-process handler
//   window.electron.onUpdateStatus(fn)    — subscribe to auto-update changes
//   window.electron.ollamaRequest(req, fn) — talk to the local Ollama via the main process
//   window.env                            — static values, read once at startup
//
// Node and Electron APIs are never handed to the renderer. Everything crosses
// as a named channel the main process chose to answer.

const { contextBridge, ipcRenderer } = require('electron');

let ollamaSeq = 0;

contextBridge.exposeInMainWorld('electron', {
  /**
   * Call a main-process handler and resolve with its return value.
   * @param {string} cmd  channel name, e.g. 'update:check'
   * @param {...any} args forwarded to the handler
   * @returns {Promise<unknown>}
   */
  invoke: (cmd, ...args) => ipcRenderer.invoke(cmd, ...args),

  /**
   * Subscribe to auto-update status broadcasts.
   * @param {(status: { state: string, info: object | null, error?: string }) => void} fn
   * @returns {() => void} unsubscribe
   */
  onUpdateStatus: (fn) => {
    const handler = (_event, status) => fn(status);
    ipcRenderer.on('update:status', handler);
    return () => ipcRenderer.removeListener('update:status', handler);
  },

  /**
   * Subscribe to "which screen should I share?".
   *
   * Sent by the main process when getDisplayMedia is called and the platform
   * has no picker of its own. The renderer answers with
   * invoke('capture:sourcePicked', id), or null to cancel. Delivered as an
   * event rather than a return value because the question originates in the
   * main process, which invoke() cannot express.
   *
   * @param {(sources: {id:string,name:string,kind:string,thumbnail:string|null}[]) => void} fn
   * @returns {() => void} unsubscribe
   */
  /**
   * One request to the local Ollama, made by the main process (see
   * 'ollama:request' in main.cjs for why). onEvent receives
   * ('head', {status, statusText}), then ('data', text) per chunk, then
   * ('end') -- or ('error', message) at any point.
   * @param {{path: string, method?: string, body?: string}} req
   * @param {(kind: string, data?: unknown) => void} onEvent
   * @returns {() => void} abort
   */
  ollamaRequest: (req, onEvent) => {
    const id = ++ollamaSeq;
    const handler = (_event, msgId, kind, data) => {
      if (msgId !== id) return;
      if (kind === 'end' || kind === 'error') ipcRenderer.removeListener('ollama:event', handler);
      onEvent(kind, data);
    };
    ipcRenderer.on('ollama:event', handler);
    ipcRenderer.send('ollama:request', id, { path: req.path, method: req.method, body: req.body });
    return () => {
      ipcRenderer.removeListener('ollama:event', handler);
      ipcRenderer.send('ollama:abort', id);
    };
  },

  /**
   * Output from a real PowerShell session started with invoke('pwsh:start').
   * fn receives (id, kind, data): 'out' | 'err' text, 'done' with the current
   * directory when a command finishes, 'exit' with the exit code.
   * @returns {() => void} unsubscribe
   */
  onPwshEvent: (fn) => {
    const handler = (_event, id, kind, data) => fn(id, kind, data);
    ipcRenderer.on('pwsh:event', handler);
    return () => ipcRenderer.removeListener('pwsh:event', handler);
  },

  /**
   * A page in the in-VM browser asked for a pop-up; the main process has
   * already checked the allowlist. fn(url) opens it as a tab.
   * @returns {() => void} unsubscribe
   */
  onBrowserPopup: (fn) => {
    const handler = (_event, url) => fn(url);
    ipcRenderer.on('browser:popup', handler);
    return () => ipcRenderer.removeListener('browser:popup', handler);
  },

  onPickCaptureSource: (fn) => {
    const handler = (_event, sources) => fn(sources);
    ipcRenderer.on('capture:pick-source', handler);
    return () => ipcRenderer.removeListener('capture:pick-source', handler);
  },
});

// Read synchronously. exposeInMainWorld clones the value at call time, so an
// async round-trip here would only ever expose the placeholder it started
// with — the renderer would never see the resolved payload.
let envPayload = {};
try {
  envPayload = ipcRenderer.sendSync('env:get:sync') ?? {};
} catch {
  /* main process not ready to answer — an empty payload is correct */
}
contextBridge.exposeInMainWorld('env', envPayload);
