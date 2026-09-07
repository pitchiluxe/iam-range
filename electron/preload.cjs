// electron/preload.cjs
// The only bridge between the renderer and the main process.
//
// Exposes:
//   window.electron.invoke(cmd, ...args)  — call a main-process handler
//   window.electron.onUpdateStatus(fn)    — subscribe to auto-update changes
//   window.env                            — static values, read once at startup
//
// Node and Electron APIs are never handed to the renderer. Everything crosses
// as a named channel the main process chose to answer.

const { contextBridge, ipcRenderer } = require('electron');

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
