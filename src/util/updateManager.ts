/**
 * util/updateManager.ts — Renderer-side bridge to the main-process auto-updater.
 *
 * Only meaningful when running inside Electron (window.electron is exposed by
 * preload.cjs). In a browser tab (dev mode), all methods become no-ops and
 * `isAvailable()` returns false so the UI can fall back gracefully.
 */
export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'unsupported'
  /** The check ran and failed — a missing release feed, no network, a bad
   *  token. Distinct from 'idle' on purpose: reporting a failed check as
   *  "no updates available" hides a broken updater behind a reassuring
   *  message, which is how this shipped unnoticed. */
  | 'error';

export interface UpdateInfo {
  version?: string;
  releaseNotes?: string | null;
  progress?: number;
}

export interface UpdateStatus {
  state: UpdateState;
  info: UpdateInfo | null;
  error?: string;
}

type Listener = (status: UpdateStatus) => void;

interface ElectronBridge {
  invoke(cmd: string, ...args: unknown[]): Promise<unknown>;
  onUpdateStatus?(fn: (status: UpdateStatus) => void): () => void;
}

function getBridge(): ElectronBridge | null {
  const w = window as unknown as { electron?: ElectronBridge };
  return w.electron ?? null;
}

class UpdateManager {
  private listeners: Set<Listener> = new Set();
  private currentStatus: UpdateStatus = { state: 'idle', info: null };
  private unsubBridge: (() => void) | null = null;
  private installed = false;

  /** Wire up the bridge subscription. Idempotent. */
  install(): void {
    if (this.installed) return;
    this.installed = true;
    const bridge = getBridge();
    if (!bridge) {
      this.currentStatus = { state: 'unsupported', info: null };
      return;
    }
    if (bridge.onUpdateStatus) {
      this.unsubBridge = bridge.onUpdateStatus((status) => {
        this.currentStatus = status;
        this.emit();
      });
    }
    // Get the current state in case we missed the initial broadcast
    bridge
      .invoke('update:getStatus')
      .then((status) => {
        if (status && typeof status === 'object') {
          this.currentStatus = status as UpdateStatus;
          this.emit();
        }
      })
      .catch(() => {
        /* ignore — main process not ready or bridge unavailable */
      });
  }

  isAvailable(): boolean {
    return getBridge() !== null;
  }

  getStatus(): UpdateStatus {
    return this.currentStatus;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.currentStatus);
    return () => this.listeners.delete(fn);
  }

  /** Manually check for updates (returns the latest status). */
  async checkForUpdates(): Promise<UpdateStatus> {
    const bridge = getBridge();
    if (!bridge) return this.currentStatus;
    try {
      const status = (await bridge.invoke('update:check')) as UpdateStatus;
      this.currentStatus = status;
      this.emit();
      return status;
    } catch (err) {
      const errorStatus: UpdateStatus = {
        state: 'idle',
        info: null,
        error: err instanceof Error ? err.message : String(err),
      };
      this.currentStatus = errorStatus;
      this.emit();
      return errorStatus;
    }
  }

  /** Trigger download of an available update. */
  async downloadUpdate(): Promise<UpdateStatus> {
    const bridge = getBridge();
    if (!bridge) return this.currentStatus;
    try {
      const status = (await bridge.invoke('update:download')) as UpdateStatus;
      this.currentStatus = status;
      this.emit();
      return status;
    } catch (err) {
      const errorStatus: UpdateStatus = {
        state: 'idle',
        info: null,
        error: err instanceof Error ? err.message : String(err),
      };
      this.currentStatus = errorStatus;
      this.emit();
      return errorStatus;
    }
  }

  /** Quit and install the downloaded update. */
  installUpdate(): void {
    const bridge = getBridge();
    if (!bridge) return;
    void bridge.invoke('update:install');
  }

  private emit(): void {
    for (const fn of this.listeners) {
      try {
        fn(this.currentStatus);
      } catch {
        /* listener threw — ignore to keep other listeners alive */
      }
    }
  }
}

export const updateManager = new UpdateManager();
