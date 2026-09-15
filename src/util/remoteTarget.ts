/**
 * util/remoteTarget.ts — "connect to this computer" from a ticket.
 *
 * A help-desk ticket names a computer, and the Ticket Queue offers to connect
 * to it. The queue cannot reach into the Remote Desktop window (the overlay
 * owns windows, and imports both), so it leaves the target here and asks for
 * the window; Remote Desktop takes the target when it renders, or hears the
 * event if it is already open. Same document-event convention as
 * util/appLauncher.ts.
 */
import { requestApp } from './appLauncher';

const TARGET_EVENT = 'apex-remote-target';

let pending: string | null = null;

/** Open Remote Desktop pointed at `computer`. */
export function requestRemoteConnection(computer: string): void {
  pending = computer;
  requestApp('remote-desktop');
  document.dispatchEvent(new CustomEvent<string>(TARGET_EVENT, { detail: computer }));
}

/** The computer a ticket asked to connect to, once. */
export function takePendingRemoteTarget(): string | null {
  const target = pending;
  pending = null;
  return target;
}

/** Hear connection requests while Remote Desktop is already open. Returns an unsubscribe. */
export function onRemoteTarget(handler: (computer: string) => void): () => void {
  const listener = (e: Event): void => {
    const computer = (e as CustomEvent<string>).detail;
    if (computer) {
      pending = null;
      handler(computer);
    }
  };
  document.addEventListener(TARGET_EVENT, listener);
  return () => document.removeEventListener(TARGET_EVENT, listener);
}
