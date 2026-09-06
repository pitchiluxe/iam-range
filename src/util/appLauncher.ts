/**
 * util/appLauncher.ts — one window asking for another to be opened.
 *
 * The tutor cites an article and the learner clicks it; Documentation has to
 * come up. Without this the tutor would need the desktop overlay, and the
 * overlay already imports the tutor — a cycle that would only get worse as
 * more windows learn to link to each other.
 *
 * So windows raise a request and the overlay, which is the only thing that
 * knows how to open a window, answers it. Same `document`-event convention as
 * util/desktopIcons.ts, for the same reason: no shared store dependency.
 *
 * The overlay still applies its department check to the id, so this is a
 * request rather than a command — a Finance desktop cannot be talked into
 * opening Active Directory by a link.
 */

const LAUNCH_EVENT = 'apex-launch-app';

export interface LaunchRequest {
  /** Application id, as registered in desktopOverlay's DESKTOP_APPS. */
  appId: string;
}

export function requestApp(appId: string): void {
  document.dispatchEvent(new CustomEvent<LaunchRequest>(LAUNCH_EVENT, { detail: { appId } }));
}

/** Subscribe to launch requests. Returns an unsubscribe function. */
export function onAppRequest(handler: (req: LaunchRequest) => void): () => void {
  const listener = (e: Event): void => {
    const detail = (e as CustomEvent<LaunchRequest>).detail;
    if (detail?.appId) handler(detail);
  };
  document.addEventListener(LAUNCH_EVENT, listener);
  return () => document.removeEventListener(LAUNCH_EVENT, listener);
}
