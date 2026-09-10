/**
 * util/ps1Opener.ts — open a .ps1 file from the File Explorer into the
 * PowerShell ISE window.
 *
 * The ISE is opened through the same app-launcher channel as everything else,
 * but it also needs the file name and contents. Those are queued here and
 * picked up when the ISE renders (or consumed by an already-open ISE via the
 * load event).
 */
import { requestApp } from './appLauncher';

export const LOAD_PS1_EVENT = 'apex-load-ps1';

export interface PendingPs1 {
  name: string;
  content: string;
}

let pending: PendingPs1 | null = null;

export function openPs1File(name: string, content: string): void {
  pending = { name, content };
  // Notify any already-open ISE.
  document.dispatchEvent(new CustomEvent<PendingPs1>(LOAD_PS1_EVENT, { detail: pending }));
  // Open or focus the ISE.
  requestApp('script-editor');
}

export function takePendingPs1(): PendingPs1 | null {
  const file = pending;
  pending = null;
  return file;
}
