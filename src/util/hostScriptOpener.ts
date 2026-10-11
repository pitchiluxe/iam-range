import { requestApp } from './appLauncher';

export const HOST_SCRIPT_EVENT = 'apex-host-script';
export interface HostScript { name: string; content: string }
let pending: HostScript | null = null;

/** Transfer a script for review in real PowerShell; execution stays a Run action. */
export function openHostScript(script: HostScript): void {
  pending = script;
  document.dispatchEvent(new CustomEvent<HostScript>(HOST_SCRIPT_EVENT, { detail: script }));
  requestApp('host-powershell');
}
export function takeHostScript(): HostScript | null {
  const script = pending;
  pending = null;
  return script;
}
