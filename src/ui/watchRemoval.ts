/** Lifecycle cleanup only: DOM changes must never trigger more rendering here. */
export function watchRemoval(element: HTMLElement, cleanup: () => void): MutationObserver {
  const observer = new MutationObserver(() => {
    if (element.isConnected) return;
    observer.disconnect();
    cleanup();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return observer;
}
