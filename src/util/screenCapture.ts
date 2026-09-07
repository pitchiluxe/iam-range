/**
 * util/screenCapture.ts — photographing the workstation, and only it.
 *
 * The annotation tool needs a picture of this window. The main process takes
 * it with capturePage and hands back a data URL; there is no path here to
 * desktopCapturer, which would let a page photograph the user's real desktop —
 * their mail, their password manager, whatever else is open behind the VM.
 * That is not a capability a training application has any business holding,
 * and not one that can be withdrawn once it has been exposed.
 *
 * In a browser tab there is no capture at all, and this says so rather than
 * failing quietly: the tool falls back to opening or pasting an image, which
 * is how somebody would use it against a screenshot taken with the operating
 * system's own tool anyway.
 */

interface ElectronBridge {
  invoke(cmd: string, ...args: unknown[]): Promise<unknown>;
}

function bridge(): ElectronBridge | null {
  // globalThis rather than window: this is also reached from a test runner
  // with no DOM, and a ReferenceError there would look like a capture failure
  // rather than an absent browser global.
  const g = globalThis as unknown as { electron?: ElectronBridge };
  return g.electron ?? null;
}

/** Whether a snip is possible here at all. */
export function canCaptureScreen(): boolean {
  return bridge() !== null;
}

/**
 * Capture the workstation window.
 *
 * Returns a PNG data URL, or null when there is no capture available or it
 * produced nothing. Null rather than a throw: the caller offers the fallback,
 * and a tool that raises an exception because it is running in a browser is
 * a tool that looks broken.
 */
export async function captureScreen(): Promise<string | null> {
  const electron = bridge();
  if (!electron) return null;
  try {
    const result = await electron.invoke('capture:screen');
    return typeof result === 'string' && result.startsWith('data:image/') ? result : null;
  } catch {
    return null;
  }
}
