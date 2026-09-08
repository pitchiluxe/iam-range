/**
 * util/saveCapture.ts — where a screenshot or a recording actually goes.
 *
 * Both capture tools used to "save" by doing two things, neither of which
 * produced a file anybody could open:
 *
 *   - they wrote the string "[png image] lab-....png" into the in-VM
 *     filesystem, so File Explorer listed a name with no picture behind it,
 *     and
 *   - they clicked a detached <a download>, which in the packaged application
 *     lands in whatever Electron decides to do with a download from a file://
 *     page — at best a dialog, at worst nothing visible at all.
 *
 * So the tool reported "Saved." and there was no file. This module is the fix,
 * and it saves in both places on purpose, because they are for different
 * things:
 *
 *   real disk   the artefact. A PNG or a WebM the user can attach to a ticket,
 *               drop into a document, or upload. In the installed application
 *               it is written straight to Documents\IAM Range with no dialog;
 *               on the web build there is no filesystem, so it falls back to a
 *               download.
 *   in-VM       the copy the lab can see. Evidence collection is part of the
 *               exercise, so the file has to exist inside the workstation's
 *               own Documents folder too — and it holds the real data URL, not
 *               a placeholder, so it can be opened rather than merely listed.
 */
import { FS } from '@/terminal/shellIntrinsics';

interface ElectronBridge {
  invoke(cmd: string, ...args: unknown[]): Promise<unknown>;
}

function bridge(): ElectronBridge | null {
  const g = globalThis as unknown as { electron?: ElectronBridge };
  return g.electron ?? null;
}

/** Where the in-VM copy lives — the workstation's own Documents folder. */
const VM_DOCUMENTS = 'C:\\Users\\admin\\Documents';

export interface SaveResult {
  /** The full path written on the real filesystem, when there was one. */
  path?: string;
  /** Whether a browser download was started instead. */
  downloaded: boolean;
  /** Whether the in-VM copy was written. */
  inVm: boolean;
}

/** A blob as bare base64, which is what crosses the IPC boundary. */
async function toBase64(blob: Blob): Promise<string> {
  const dataUrl = await toDataUrl(blob);
  const comma = dataUrl.indexOf(',');
  return comma === -1 ? '' : dataUrl.slice(comma + 1);
}

/** A blob as a data URL, which is what the in-VM copy stores. */
export function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('could not read the capture'));
    reader.readAsDataURL(blob);
  });
}

/** Start a browser download. The web build's only route to a real file. */
function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  // Attached before the click. A detached anchor works in Chrome and does
  // nothing in several other engines, which is the kind of difference that
  // shows up as "it saved on my machine".
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked late: revoking immediately can cancel the download in Chromium.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Save a capture everywhere it should go.
 *
 * Never throws. A failure on one route does not cost the other, and the
 * result says which ones happened so the caller can tell the user something
 * true rather than an unconditional "Saved."
 */
export async function saveCapture(blob: Blob, name: string): Promise<SaveResult> {
  const result: SaveResult = { downloaded: false, inVm: false };

  // The real file first: it is the one the user came for.
  const electron = bridge();
  if (electron) {
    try {
      const base64 = await toBase64(blob);
      const written = await electron.invoke('capture:save', { name, base64 });
      if (typeof written === 'string' && written) result.path = written;
    } catch {
      // Fall through to the download, rather than losing the capture.
    }
  }
  if (!result.path) {
    try {
      download(blob, name);
      result.downloaded = true;
    } catch {
      /* nothing more to try */
    }
  }

  // Then the copy the lab can see. Real data, so it opens.
  try {
    const dataUrl = await toDataUrl(blob);
    const res = FS.writeFile(`${VM_DOCUMENTS}\\${name}`, dataUrl);
    result.inVm = res.ok;
  } catch {
    result.inVm = false;
  }

  return result;
}

/** A one-line description of what just happened, for the toast. */
export function describeSave(result: SaveResult, name: string): string {
  if (result.path) return `Saved to ${result.path}`;
  if (result.downloaded) return `${name} downloaded, and copied into the workstation's Documents.`;
  if (result.inVm) return `Saved into the workstation's Documents as ${name}.`;
  return 'The capture could not be saved.';
}
