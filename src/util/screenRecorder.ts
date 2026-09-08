/**
 * util/screenRecorder.ts — recording a walkthrough: screen, camera, voice.
 *
 * This replaces a recorder that could only photograph its own window on a
 * timer. That produced roughly ten frames a second of the workstation and
 * nothing else, which is the wrong tool for the job it was being used for:
 * recording a tutorial, where the screen being shown is the real one and the
 * person explaining it should be visible.
 *
 * What it composes:
 *
 *   video   the screen, window or tab the user picks, at its own frame rate,
 *           with the webcam drawn into a corner as a circular bubble
 *   audio   the microphone, mixed with system audio when the picker offered
 *           it and the user ticked the box
 *
 * The composition is a canvas. Both video tracks are painted into it every
 * animation frame and `canvas.captureStream()` turns that into the recorded
 * track, which is what makes a picture-in-picture possible at all — a
 * MediaRecorder cannot be handed two video tracks and told to overlay one.
 *
 * On the capability. getDisplayMedia and getUserMedia are exactly the two
 * things the previous design refused, on the grounds that between them they
 * are a camera and a screen grabber pointed at somebody's desk. That is still
 * true, and the mitigations are structural rather than promises:
 *
 *   - Neither can be reached without a user gesture, and both put the
 *     browser's own consent UI in front of the user. Nothing here chooses a
 *     screen or turns on a camera by itself.
 *   - The share is visible for as long as it lasts: the browser's indicator,
 *     the recorder's own clock, and the stop control in the toolbar.
 *   - When the user ends the share from the browser's bar, the recording stops
 *     and finalises rather than continuing to write a frozen frame.
 *   - Every track this opens is stopped when it stops. A live camera after the
 *     recording ends is a light left on.
 *   - In the packaged application the permission stays scoped to the
 *     workstation's own document; a page loaded in the in-VM browser is still
 *     refused, which is the part that actually mattered.
 */

/** Where the camera bubble sits. */
export type CameraCorner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

export interface RecorderHandle {
  stop(): Promise<Blob | null>;
  /** Seconds elapsed, for a running clock in the UI. */
  elapsed(): number;
  hasAudio(): boolean;
  hasCamera(): boolean;
  /** Whether system audio came through as well as the microphone. */
  hasSystemAudio(): boolean;
  /** Move the bubble mid-recording, when it lands over the thing being shown. */
  setCameraCorner(corner: CameraCorner): void;
  cameraCorner(): CameraCorner;
}

export interface RecorderOptions {
  /** Frames per second for the composed track. */
  fps?: number;
  /** Ask for the microphone. False records without narration. */
  audio?: boolean;
  /** Draw the webcam into a corner. False records the screen alone. */
  camera?: boolean;
  /** Which corner the bubble starts in. */
  cameraCorner?: CameraCorner;
  /** Bubble diameter as a fraction of the shorter edge of the screen. */
  cameraScale?: number;
  /** Called when the user ends the share from the browser's own bar. */
  onEnded?: () => void;
}

/** Whether this build can record at all. */
export function canRecord(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getDisplayMedia
  );
}

/** Whether a webcam bubble is possible. */
export function canRecordCamera(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
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

/** A playing, muted <video> bound to a stream, ready to draw from. */
async function videoFor(stream: MediaStream): Promise<HTMLVideoElement> {
  const el = document.createElement('video');
  el.srcObject = stream;
  el.muted = true;
  el.playsInline = true;
  await el.play();
  // Dimensions arrive a frame or two after play() resolves.
  await new Promise<void>((resolve) => {
    let tries = 0;
    const check = (): void => {
      if (el.videoWidth > 0 || tries > 60) {
        resolve();
        return;
      }
      tries += 1;
      requestAnimationFrame(check);
    };
    check();
  });
  return el;
}

/** Draw `src` into a square, cropped to fill rather than squashed. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  src: HTMLVideoElement,
  x: number,
  y: number,
  size: number,
): void {
  const sw = src.videoWidth;
  const sh = src.videoHeight;
  if (!sw || !sh) return;
  // The short edge of the source fills the bubble; the long edge is centred
  // and cropped. A webcam is 16:9 and a bubble is round, so without this the
  // face is stretched.
  const side = Math.min(sw, sh);
  ctx.drawImage(src, (sw - side) / 2, (sh - side) / 2, side, side, x, y, size, size);
}

/**
 * Start recording.
 *
 * Returns null when the user cancelled the screen picker, or when the runtime
 * cannot record. Null rather than a throw, because the caller shows a message
 * and carries on — and cancelling the picker is not an error.
 */
export async function startRecording(
  opts: RecorderOptions = {},
): Promise<RecorderHandle | null> {
  if (!canRecord()) return null;

  const fps = Math.min(60, Math.max(1, opts.fps ?? 30));
  const cameraScale = Math.min(0.4, Math.max(0.08, opts.cameraScale ?? 0.18));
  let corner: CameraCorner = opts.cameraCorner ?? 'bottom-right';

  // The screen first. It needs a user gesture and shows a picker, so asking
  // for it before the camera means a cancelled picker costs no camera light.
  let screenStream: MediaStream;
  try {
    const picked = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: fps, max: 60 } },
      audio: true,
    });
    screenStream = picked;
  } catch {
    return null;
  }

  const cleanup: MediaStream[] = [screenStream];
  const stopAll = (): void => {
    for (const s of cleanup) for (const t of s.getTracks()) t.stop();
  };

  let screenVideo: HTMLVideoElement;
  try {
    screenVideo = await videoFor(screenStream);
  } catch {
    stopAll();
    return null;
  }

  const width = screenVideo.videoWidth || 1280;
  const height = screenVideo.videoHeight || 720;

  // Camera, best effort. A declined camera loses the bubble, not the
  // recording — the screen and the narration are the substance.
  let cameraVideo: HTMLVideoElement | null = null;
  if (opts.camera !== false && canRecordCamera()) {
    try {
      const cam = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      cleanup.push(cam);
      cameraVideo = await videoFor(cam);
    } catch {
      cameraVideo = null;
    }
  }

  // Microphone, also best effort, and separate from the camera request so a
  // refused camera does not cost the narration.
  let micStream: MediaStream | null = null;
  if (opts.audio !== false) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      cleanup.push(micStream);
    } catch {
      micStream = null;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    stopAll();
    return null;
  }

  const stream = canvas.captureStream(fps);

  // ---- Audio ---------------------------------------------------------------
  // Microphone and system audio are two tracks, and MediaRecorder writes one.
  // They are summed through a WebAudio graph so the narration sits over
  // whatever the shared screen was playing.
  const systemAudio = screenStream.getAudioTracks();
  let audioCtx: AudioContext | null = null;
  let hasAnyAudio = false;
  if (micStream || systemAudio.length > 0) {
    try {
      audioCtx = new AudioContext();
      const mix = audioCtx.createMediaStreamDestination();
      if (micStream) {
        audioCtx.createMediaStreamSource(micStream).connect(mix);
      }
      if (systemAudio.length > 0) {
        const sysGain = audioCtx.createGain();
        // Under the voice on purpose: this is a narrated walkthrough, and
        // system audio at full level talks over the person explaining.
        sysGain.gain.value = 0.6;
        audioCtx.createMediaStreamSource(new MediaStream(systemAudio)).connect(sysGain);
        sysGain.connect(mix);
      }
      for (const track of mix.stream.getAudioTracks()) stream.addTrack(track);
      hasAnyAudio = true;
    } catch {
      // No WebAudio. Fall back to the microphone alone rather than silence.
      audioCtx = null;
      if (micStream) {
        for (const track of micStream.getAudioTracks()) stream.addTrack(track);
        hasAnyAudio = true;
      }
    }
  }

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  // A timeslice, so a crash mid-recording still leaves the frames that were
  // already flushed rather than one unwritten blob.
  recorder.start(1000);

  const startedAt = Date.now();
  let running = true;
  let raf = 0;

  // ---- The compositor ------------------------------------------------------
  // requestAnimationFrame rather than a timer: it is already paced to the
  // display, and it stops being called when nothing is being painted, which
  // is the correct behaviour for a source that has nothing new in it.
  const paint = (): void => {
    if (!running) return;
    ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);

    if (cameraVideo && cameraVideo.videoWidth > 0) {
      const size = Math.round(Math.min(canvas.width, canvas.height) * cameraScale);
      const margin = Math.round(size * 0.16);
      const x = corner.endsWith('right') ? canvas.width - size - margin : margin;
      const y = corner.startsWith('bottom') ? canvas.height - size - margin : margin;
      const r = size / 2;

      ctx.save();
      // A soft drop shadow, so the bubble reads as sitting above the screen
      // rather than being part of it.
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = Math.round(size * 0.08);
      ctx.beginPath();
      ctx.arc(x + r, y + r, r, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.arc(x + r, y + r, r, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      drawCover(ctx, cameraVideo, x, y, size);
      ctx.restore();

      // A ring, which is what stops the bubble disappearing into a dark
      // screenshot of a dark console.
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + r, y + r, r - 1, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(2, Math.round(size * 0.02));
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.stroke();
      ctx.restore();
    }

    raf = requestAnimationFrame(paint);
  };
  raf = requestAnimationFrame(paint);

  let stopped: Promise<Blob | null> | null = null;

  const finish = (): Promise<Blob | null> => {
    if (stopped) return stopped;
    stopped = new Promise<Blob | null>((resolve) => {
      running = false;
      cancelAnimationFrame(raf);

      const done = (): void => {
        stopAll();
        for (const track of stream.getTracks()) track.stop();
        void audioCtx?.close().catch(() => undefined);
        screenVideo.srcObject = null;
        if (cameraVideo) cameraVideo.srcObject = null;
        resolve(chunks.length > 0 ? new Blob(chunks, { type: mimeType ?? 'video/webm' }) : null);
      };

      if (recorder.state === 'inactive') {
        done();
        return;
      }
      recorder.onstop = done;
      recorder.stop();
    });
    return stopped;
  };

  // Ending the share from the browser's own bar is a stop, not a stall. Left
  // unhandled, the canvas would keep recording the last frame it saw.
  for (const track of screenStream.getVideoTracks()) {
    track.addEventListener('ended', () => {
      if (!running) return;
      void finish().then(() => opts.onEnded?.());
    });
  }

  return {
    elapsed: () => Math.floor((Date.now() - startedAt) / 1000),
    hasAudio: () => hasAnyAudio,
    hasCamera: () => cameraVideo !== null,
    hasSystemAudio: () => systemAudio.length > 0,
    cameraCorner: () => corner,
    setCameraCorner: (next) => {
      corner = next;
    },
    stop: finish,
  };
}
