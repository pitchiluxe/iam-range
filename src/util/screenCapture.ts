/**
 * util/screenCapture.ts — photographing the workstation, and the screen.
 *
 * There are two captures here and they answer different questions.
 *
 * `captureWindow()` photographs this window through the main process's
 * capturePage. It is silent, instant, needs no permission and can only ever
 * contain the workstation. That is the right source for evidence: a snip of
 * the directory console after a change, attached to a ticket.
 *
 * `captureDisplay()` asks the browser for a screen, a window or a tab through
 * getDisplayMedia. This exists because the workstation is also used to record
 * tutorials, where the point is to show the real screen — the packaged app
 * beside a terminal, a browser, notes. A capture that can only see its own
 * window cannot do that.
 *
 * The earlier design refused getDisplayMedia outright, on the grounds that a
 * page holding it can photograph whatever else is open. That risk is real and
 * has not gone away; what has changed is that it is now the feature somebody
 * asked for, so it is fenced rather than absent:
 *
 *   - It is never automatic. getDisplayMedia cannot be called without a user
 *     gesture, and the browser — or Electron's own picker — puts the choice of
 *     what to share in front of the user every single time. Nothing here can
 *     pre-select a source or remember one.
 *   - The stream is used for exactly one frame and then every track is
 *     stopped, so the share indicator goes out immediately.
 *   - It stays off the evidence path. Snip still prefers the window capture,
 *     and only offers the screen picker when asked or when there is no window
 *     capture to fall back on.
 *
 * In a plain browser tab there is no window capture, only the picker. That is
 * why Snip used to do nothing at all on the web build: `captureScreen()`
 * returned null and the tool reported itself unavailable.
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

/** Whether the silent window capture is available — the installed app only. */
export function canCaptureWindow(): boolean {
  return bridge() !== null;
}

/** Whether the screen picker is available. True in any modern browser. */
export function canCaptureDisplay(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
}

/** Whether a snip is possible here at all, by either route. */
export function canCaptureScreen(): boolean {
  return canCaptureWindow() || canCaptureDisplay();
}

/**
 * Capture the workstation window.
 *
 * Returns a PNG data URL, or null when there is no window capture available or
 * it produced nothing. Null rather than a throw: the caller offers a fallback,
 * and a tool that raises an exception because it is running in a browser is a
 * tool that looks broken.
 */
export async function captureWindow(): Promise<string | null> {
  const electron = bridge();
  if (!electron) return null;
  try {
    const result = await electron.invoke('capture:screen');
    return typeof result === 'string' && result.startsWith('data:image/') ? result : null;
  } catch {
    return null;
  }
}

/**
 * Open a screen stream for the user to choose a source for.
 *
 * Exported because the recorder needs the live stream, not a still. The
 * caller owns the tracks and must stop them.
 */
export async function openDisplayStream(
  opts: { audio?: boolean } = {},
): Promise<MediaStream | null> {
  if (!canCaptureDisplay()) return null;
  try {
    return await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 60 } },
      // System audio, where the platform offers it. On Windows this is the
      // "share audio" tick in the picker; the user decides, and a decline
      // costs nothing because the microphone is a separate track.
      audio: opts.audio === false ? false : true,
    });
  } catch {
    // Cancelled the picker, or no permission. Both are ordinary.
    return null;
  }
}

/** Draw the first painted frame of a video track onto a canvas, as a PNG. */
async function firstFrame(stream: MediaStream): Promise<string | null> {
  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  try {
    await video.play();
    // One decoded frame is not enough on its own: the first is routinely
    // blank while the compositor attaches. Wait for real dimensions, then
    // give it a paint.
    await new Promise<void>((resolve) => {
      let tries = 0;
      const check = (): void => {
        if ((video.videoWidth > 0 && tries > 2) || tries > 60) {
          resolve();
          return;
        }
        tries += 1;
        requestAnimationFrame(check);
      };
      check();
    });
    if (!video.videoWidth || !video.videoHeight) return null;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  } finally {
    video.pause();
    video.srcObject = null;
  }
}

/**
 * Photograph a screen, window or tab the user picks.
 *
 * One frame, then every track is stopped, so the browser's "sharing" state
 * lasts about as long as a shutter.
 */
export async function captureDisplay(): Promise<string | null> {
  const stream = await openDisplayStream({ audio: false });
  if (!stream) return null;
  try {
    return await firstFrame(stream);
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}

/**
 * Capture whatever this build can, preferring the silent window capture.
 *
 * Kept under the original name because it is what the annotation tools and
 * their tests already call. The difference from before is the fallback: on the
 * web build this now opens the picker instead of returning null, which is why
 * Snip did nothing there.
 */
export async function captureScreen(): Promise<string | null> {
  return (await captureWindow()) ?? (await captureDisplay());
}
