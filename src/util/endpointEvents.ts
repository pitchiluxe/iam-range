/**
 * util/endpointEvents.ts — "something changed on this computer".
 *
 * A repair can come from Settings, from Outlook, or from the terminal, and the
 * other windows open on the same computer should show it at once: restart the
 * spooler in the shell and the Printers page stops saying Stopped. Same
 * document-event convention as util/appLauncher.ts, so no window has to know
 * which others exist.
 */
const EVENT = 'apex-endpoint-changed';

export function notifyEndpointChanged(computer: string): void {
  document.dispatchEvent(new CustomEvent<string>(EVENT, { detail: computer.toUpperCase() }));
}

/**
 * Re-run `handler` whenever `computer` changes, for as long as `owner` is on
 * the page. The listener removes itself once the window is gone, so a closed
 * window does not keep re-rendering into a detached element.
 */
export function onEndpointChanged(owner: HTMLElement, computer: string, handler: () => void): void {
  const want = computer.toUpperCase();
  const listener = (e: Event): void => {
    if (!owner.isConnected) {
      document.removeEventListener(EVENT, listener);
      return;
    }
    if ((e as CustomEvent<string>).detail === want) handler();
  };
  document.addEventListener(EVENT, listener);
}
