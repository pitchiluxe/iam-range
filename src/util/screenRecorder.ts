/**
 * util/screenRecorder.ts — recording a lab walkthrough, with narration.
 *
 * The obvious implementation is getDisplayMedia or desktopCapturer, and both
 * are refused here for the same reason the annotation tool refuses them: they
 * hand a page the user's whole screen. Somebody recording a lab does not
 * intend to publish whatever is behind the window, and a capability like that
 * cannot be withdrawn once a build has shipped with it.
 *
 * So the video is built from the capture the workstation already has. The main
 * process photographs its own window on a timer, each frame is drawn to an
 * offscreen canvas, and canvas.captureStream() turns that into a video track.
 * It can only ever contain this window, by construction rather than by policy.
 *
 * The cost is frame rate. capturePage is far heavier than a compositor tap, so
 * this records at around ten frames a second — fine for a walkthrough of a
 * console, wrong for anything with real motion in it. That is a deliberate
 * trade and the UI says so rather than implying sixty.
 *
 * Audio is the microphone, so the narration is the point: "here is what I am
 * doing and why". System audio is not captured, and the caller is told that
 * rather than left to discover it in a silent recording.
 */
import { captureScreen } from './screenCapture';

export interface RecorderHandle {
  stop(): Promise<Blob | null>;
  /** Seconds elapsed, for a running clock in the UI. */
  elapsed(): number;
  hasAudio(): boolean;
}

export interface RecorderOptions {
  /** Frames per second. Ten is the practical ceiling for capturePage. */
  fps?: number;
  /** Ask for the microphone. False records silent video. */
  audio?: boolean;
}

/** Whether this build can record at all. */
export function canRecord(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  );
}

/** The best container this browser will actually produce. */
function pickMimeType(): string | undefined {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

/**
 * Start recording.
 *
 * Returns null when there is nothing to record from — no capture bridge, or a
 * browser without MediaRecorder. Null rather than a throw, because the caller
 * shows a message and carries on.
 */
export async function startRecording(
  opts: RecorderOptions = {},
): Promise<RecorderHandle | null> {
  if (!canRecord()) return null;

  const fps = Math.min(15, Math.max(1, opts.fps ?? 10));

  // One frame first, to size the canvas and to prove capture works before
  // asking the learner for a microphone.
  const first = await captureScreen();
  if (!first) return null;

  const frame = new Image();
  await new Promise<void>((resolve, reject) => {
    frame.onload = () => resolve();
    frame.onerror = () => reject(new Error('capture decode failed'));
    frame.src = first;
  });

  const canvas = document.createElement('canvas');
  canvas.width = frame.naturalWidth;
  canvas.height = frame.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(frame, 0, 0);

  const stream = canvas.captureStream(fps);

  let micStream: MediaStream | null = null;
  if (opts.audio !== false) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of micStream.getAudioTracks()) stream.addTrack(track);
    } catch {
      // Declined, or no microphone. A silent recording is still a recording,
      // and refusing to start would lose the walkthrough over the narration.
      micStream = null;
    }
  }

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start(1000);

  const startedAt = Date.now();
  let running = true;

  // The capture loop. setTimeout rather than setInterval: capturePage takes
  // as long as it takes, and an interval would queue frames faster than they
  // can be produced until the window stops responding.
  const pump = async (): Promise<void> => {
    while (running) {
      const started = Date.now();
      const dataUrl = await captureScreen();
      if (!running) break;
      if (dataUrl) {
        try {
          const img = new Image();
          await new Promise<void>((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
            img.src = dataUrl;
          });
          if (img.naturalWidth > 0) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        } catch {
          // A dropped frame is a dropped frame; the recording continues.
        }
      }
      const spent = Date.now() - started;
      await new Promise((r) => setTimeout(r, Math.max(0, 1000 / fps - spent)));
    }
  };
  void pump();

  return {
    elapsed: () => Math.floor((Date.now() - startedAt) / 1000),
    hasAudio: () => micStream !== null,
    stop: () =>
      new Promise<Blob | null>((resolve) => {
        running = false;
        if (recorder.state === 'inactive') {
          resolve(chunks.length > 0 ? new Blob(chunks, { type: mimeType ?? 'video/webm' }) : null);
          return;
        }
        recorder.onstop = () => {
          for (const track of stream.getTracks()) track.stop();
          micStream?.getTracks().forEach((t) => t.stop());
          resolve(chunks.length > 0 ? new Blob(chunks, { type: mimeType ?? 'video/webm' }) : null);
        };
        recorder.stop();
      }),
  };
}
