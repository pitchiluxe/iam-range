/**
 * ui/desktopAnnotator.ts — drawing on the desktop itself.
 *
 * The window-based Snip & Annotate marks up a picture after the fact. This is
 * the other half: a transparent sheet over the live workstation with a
 * floating toolbar you can drag out of your own way, so somebody can circle a
 * field in Active Directory while it is on screen — teaching, walking a
 * colleague through a change, or narrating a recording.
 *
 * The behaviour that makes or breaks a tool like this is what happens to
 * clicks. A full-screen canvas swallows every one of them, so the desktop
 * underneath becomes unusable and the tool has to be closed to do anything.
 * The overlay therefore has two states and the toolbar always says which one
 * it is in:
 *
 *   Draw     the sheet takes the pointer, and the desktop is frozen behind it
 *   Click    pointer-events go through to the applications underneath
 *
 * The marks stay visible in both. That is the point — you draw on a console,
 * then keep using the console with the annotation still over it.
 *
 * The toolbar is draggable because a fixed one always ends up over the thing
 * being annotated. Its position is remembered, since somebody who moved it
 * once meant it.
 */
import { showToast } from '@/ui/toast';
import { captureWindow, captureDisplay } from '@/util/screenCapture';
import { startRecording, canRecord, canRecordCamera } from '@/util/screenRecorder';
import type { RecorderHandle, CameraCorner } from '@/util/screenRecorder';
import { saveCapture, describeSave } from '@/util/saveCapture';

const OVERLAY_ID = 'desktop-annotator';
const POSITION_KEY = 'annotator_toolbar_position';

type Tool = 'pen' | 'highlight' | 'arrow' | 'box' | 'eraser';

const TOOLS: { id: Tool; label: string; title: string }[] = [
  { id: 'pen', label: '✎', title: 'Pen' },
  { id: 'highlight', label: '▤', title: 'Highlighter — translucent, so text stays readable' },
  { id: 'arrow', label: '↗', title: 'Arrow' },
  { id: 'box', label: '▭', title: 'Box' },
  { id: 'eraser', label: '⌫', title: 'Eraser' },
];

const COLORS = ['#ff5f56', '#ffbd2e', '#4ec9b0', '#5b8def', '#ffffff'];

const STYLES = `
  #${OVERLAY_ID} {
    position: fixed; inset: 0; z-index: 8000;
  }
  #${OVERLAY_ID}.click-through { pointer-events: none; }
  #${OVERLAY_ID} .da-canvas {
    position: absolute; inset: 0; width: 100%; height: 100%;
  }
  #${OVERLAY_ID}.draw .da-canvas { cursor: crosshair; }
  #${OVERLAY_ID}.click-through .da-canvas { pointer-events: none; }

  /*
   * A frame and a label on the screen while the sheet is taking clicks.
   *
   * The toolbar says which mode it is in, but the toolbar is one small strip
   * that can be dragged anywhere, and the thing it is describing is the whole
   * screen. Without a marker on the screen itself, "my clicks do nothing" and
   * "the pen is in drawing mode" are two facts with nothing connecting them.
   * Drawn on the overlay rather than as separate elements so they cannot be
   * left behind, and pointer-events: none so neither eats a click of its own.
   *
   * The label is a filled pill at the bottom, not text at the top: the
   * toolbar opens across the top and the label was landing underneath it, and
   * transparent text in --on-accent is invisible against a dark wallpaper --
   * which is the whole failure this is here to prevent.
   */
  #${OVERLAY_ID}.draw::after {
    content: ''; position: fixed; inset: 0; pointer-events: none;
    border: 2px solid var(--accent);
    box-sizing: border-box;
  }
  #${OVERLAY_ID}.draw::before {
    content: 'Drawing — clicks go to the pen. Press Esc to use the desktop.';
    position: fixed; left: 50%; bottom: 60px; transform: translateX(-50%);
    pointer-events: none; z-index: 1;
    font: 600 12px "Segoe UI", system-ui, sans-serif;
    color: var(--on-accent, #06080c); background: var(--accent, #4ec9b0);
    padding: 6px 14px; border-radius: 999px; white-space: nowrap;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
  }

  .da-bar {
    position: fixed; z-index: 8100; display: flex; align-items: center; gap: 4px;
    padding: 6px; border-radius: 10px; pointer-events: auto;
    background: linear-gradient(180deg, var(--glass-top), var(--glass-bottom));
    border: 1px solid var(--glass-border);
    box-shadow: 0 12px 34px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.14);
    backdrop-filter: blur(24px) saturate(160%);
    -webkit-backdrop-filter: blur(24px) saturate(160%);
    font-family: "Segoe UI", system-ui, sans-serif;
  }
  .da-grip {
    width: 16px; height: 30px; margin-right: 2px; border-radius: 5px; cursor: grab;
    display: flex; align-items: center; justify-content: center;
    color: var(--muted); font-size: 13px; user-select: none;
  }
  .da-grip:active { cursor: grabbing; }
  .da-btn {
    min-width: 30px; height: 30px; padding: 0 7px; border-radius: 6px; cursor: pointer;
    background: transparent; color: var(--glass-text); border: 1px solid transparent;
    font-family: inherit; font-size: 14px; line-height: 1;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .da-btn:hover { background: rgba(255,255,255,0.12); }
  .da-btn.on { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
  .da-btn.wide { font-size: 11.5px; padding: 0 10px; }
  .da-swatch { width: 20px; height: 20px; border-radius: 50%; border: 2px solid transparent;
    cursor: pointer; padding: 0; }
  .da-swatch.on { border-color: var(--glass-text); }
  .da-sep { width: 1px; height: 20px; background: var(--glass-border); margin: 0 3px; }
  .da-mode {
    font-size: 10.5px; padding: 0 9px; height: 30px; border-radius: 6px;
    display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
    border: 1px solid var(--glass-border); background: transparent;
    color: var(--glass-text); font-family: inherit; white-space: nowrap;
  }
  .da-mode.drawing { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
`;

interface Point {
  x: number;
  y: number;
}
interface Stroke {
  tool: Tool;
  color: string;
  points: Point[];
}

/** m:ss, for the running recorder. */
function formatElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

let active = false;

/**
 * Detach for the Escape handler, held at module level.
 *
 * The pen has two ways off the screen -- its own close button and toggling
 * the Start menu entry again -- and the second one runs in a different call
 * than the one that registered the listener. Without this, that path left a
 * document-level keydown handler behind, closed over a dead overlay, still
 * swallowing Escape for the rest of the session.
 */
let detachEscape: (() => void) | null = null;

/** Whether the desktop annotator is currently up. */
export function annotatorActive(): boolean {
  return active;
}

const CAMERA_KEY = 'annotator_camera_on';

/** Whether the camera bubble was on last time. Defaults to on where a camera
 *  is possible at all: recording a walkthrough is what this is for. */
function loadCameraPreference(): boolean {
  try {
    const raw = localStorage.getItem(CAMERA_KEY);
    if (raw !== null) return raw === '1';
  } catch {
    /* fall through to the default */
  }
  return canRecordCamera();
}

function saveCameraPreference(on: boolean): void {
  try {
    localStorage.setItem(CAMERA_KEY, on ? '1' : '0');
  } catch {
    /* the preference lasts the session, which is not fatal */
  }
}

function loadPosition(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { x: number; y: number };
      if (typeof p.x === 'number' && typeof p.y === 'number') return p;
    }
  } catch {
    /* fall through to the default */
  }
  return { x: Math.round(window.innerWidth / 2 - 200), y: 24 };
}

/**
 * Open the annotator, or close it if it is already up.
 *
 * Toggling from one entry point, because a tool that covers the screen needs
 * an obvious way back off it.
 */
export function toggleDesktopAnnotator(): void {
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) {
    existing.remove();
    document.querySelector('.da-bar')?.remove();
    detachEscape?.();
    detachEscape = null;
    active = false;
    return;
  }
  active = true;

  if (!document.getElementById('desktop-annotator-css')) {
    const style = document.createElement('style');
    style.id = 'desktop-annotator-css';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  let tool: Tool = 'pen';
  let color = COLORS[0]!;
  /*
   * Opens in click-through, not drawing.
   *
   * Drawing mode lays a full-screen canvas over the workstation, so every
   * click lands on the canvas instead of whatever is underneath it. Opening
   * straight into that made the whole application look broken: fields render
   * normally, because they are simply underneath, so nothing appears disabled
   * -- you click a text box, no caret arrives, and nothing you type shows up.
   * The same for the taskbar, the ticket queue, every dialog. Somebody who
   * opened the pen and forgot about it had no way to connect the two.
   *
   * The safe state is therefore the default, and drawing is one clearly
   * labelled click away. A pen that has to be switched on is a smaller
   * surprise than a workstation that has silently stopped accepting input.
   */
  let drawMode = false;
  let strokes: Stroke[] = [];
  let current: Stroke | null = null;
  let recorder: RecorderHandle | null = null;
  let recordTick: number | null = null;
  // Remembered across openings of the toolbar: somebody who recorded with the
  // camera on once is recording a tutorial and will want it on again.
  let cameraOn = loadCameraPreference();
  let cameraCorner: CameraCorner = 'bottom-right';

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'click-through';

  const canvas = document.createElement('canvas');
  canvas.className = 'da-canvas';
  overlay.appendChild(canvas);

  function sizeCanvas(): void {
    // Backing store in device pixels, so lines are not soft on a scaled
    // display; the CSS size stays in layout pixels.
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * ratio);
    canvas.height = Math.round(window.innerHeight * ratio);
    const ctx = canvas.getContext('2d');
    ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
    paint();
  }

  function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke): void {
    ctx.save();
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const first = s.points[0];
    const last = s.points[s.points.length - 1];
    if (!first || !last) {
      ctx.restore();
      return;
    }

    if (s.tool === 'highlight') {
      // Wide and translucent, so whatever is underneath stays readable.
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 16;
    } else if (s.tool === 'eraser') {
      // Cuts a hole in the annotation layer rather than painting over it, so
      // the desktop shows through exactly as it did before the mark.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = 24;
    } else {
      ctx.lineWidth = 3;
    }

    if (s.tool === 'arrow' || s.tool === 'box') {
      if (s.tool === 'box') {
        ctx.strokeRect(first.x, first.y, last.x - first.x, last.y - first.y);
      } else {
        const angle = Math.atan2(last.y - first.y, last.x - first.x);
        const head = 15;
        ctx.beginPath();
        ctx.moveTo(first.x, first.y);
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(last.x - head * Math.cos(angle - Math.PI / 7), last.y - head * Math.sin(angle - Math.PI / 7));
        ctx.lineTo(last.x - head * Math.cos(angle + Math.PI / 7), last.y - head * Math.sin(angle + Math.PI / 7));
        ctx.closePath();
        ctx.fill();
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (const p of s.points.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function paint(): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    for (const s of strokes) drawStroke(ctx, s);
    if (current) drawStroke(ctx, current);
  }

  const at = (e: MouseEvent): Point => ({ x: e.clientX, y: e.clientY });

  canvas.addEventListener('mousedown', (e) => {
    if (!drawMode) return;
    current = { tool, color, points: [at(e)] };
  });
  canvas.addEventListener('mousemove', (e) => {
    if (!current) return;
    current.points.push(at(e));
    paint();
  });
  const finish = (): void => {
    if (!current) return;
    if (current.points.length > 1) strokes.push(current);
    current = null;
    paint();
  };
  canvas.addEventListener('mouseup', finish);
  canvas.addEventListener('mouseleave', finish);

  window.addEventListener('resize', sizeCanvas);

  // ---- Toolbar -----------------------------------------------------------

  const bar = document.createElement('div');
  bar.className = 'da-bar';
  const pos = loadPosition();
  bar.style.left = `${pos.x}px`;
  bar.style.top = `${pos.y}px`;

  /** Hand a file to the browser and drop a copy in the VM's Documents. */
  /**
   * Hand a capture to the file system, and say where it went.
   *
   * The previous version wrote the literal string "[recording] lab-....webm"
   * into the in-VM filesystem and clicked a detached anchor, then reported
   * success regardless of whether either worked. saveCapture writes the real
   * bytes and reports what actually happened.
   */
  async function deliver(blob: Blob, name: string, note: string): Promise<void> {
    const result = await saveCapture(blob, name);
    const saved = Boolean(result.path) || result.downloaded || result.inVm;
    showToast(saved ? `${note} ${describeSave(result, name)}` : describeSave(result, name), {
      kind: saved ? 'success' : 'error',
    });
  }

  const stamp = (): string =>
    new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  /**
   * Photograph the screen, annotations included.
   *
   * The toolbar is hidden for the frame it takes. A picture of the annotation
   * with the annotator's own toolbar across the middle of it is not the
   * picture anybody wanted.
   */
  async function screenshot(): Promise<void> {
    bar.style.visibility = 'hidden';
    // A frame, so the hide has actually painted before the capture.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    // The window capture first: it is silent and needs no picker. Falling
    // back to the screen picker is what makes this work on the web build,
    // where it used to report itself unavailable and do nothing.
    const dataUrl = (await captureWindow()) ?? (await captureDisplay());
    bar.style.visibility = 'visible';

    if (!dataUrl) {
      showToast('Nothing was captured.', { kind: 'warn' });
      return;
    }
    const res = await fetch(dataUrl);
    await deliver(await res.blob(), `lab-${stamp()}.png`, 'Screenshot saved.');
  }

  async function toggleRecording(): Promise<void> {
    if (recorder) {
      const handle = recorder;
      recorder = null;
      if (recordTick !== null) {
        clearInterval(recordTick);
        recordTick = null;
      }
      renderBar();
      const blob = await handle.stop();
      if (!blob) {
        showToast('The recording produced nothing.', { kind: 'warn' });
        return;
      }
      await deliver(blob, `lab-${stamp()}.webm`, 'Recording saved.');
      return;
    }

    if (!canRecord()) {
      showToast('Recording is not available in this build.', { kind: 'warn' });
      return;
    }
    showToast('Choose what to share\u2026', { kind: 'info' });
    const handle = await startRecording({
      fps: 30,
      audio: true,
      camera: cameraOn,
      cameraCorner,
      // Ending the share from the browser's own bar has to land here too, or
      // the toolbar goes on showing a clock for a recording that has stopped.
      onEnded: () => {
        if (!recorder) return;
        const ending = recorder;
        recorder = null;
        if (recordTick !== null) {
          clearInterval(recordTick);
          recordTick = null;
        }
        renderBar();
        void ending.stop().then(async (blob) => {
          if (!blob) {
            showToast('The recording produced nothing.', { kind: 'warn' });
            return;
          }
          await deliver(blob, `lab-${stamp()}.webm`, 'Recording saved.');
        });
      },
    });
    if (!handle) {
      // Cancelling the picker is the ordinary case, not a failure.
      showToast('No screen was shared, so nothing is being recorded.', { kind: 'info' });
      return;
    }
    recorder = handle;
    // A clock, because a recorder with no visible elapsed time is one people
    // leave running.
    recordTick = window.setInterval(renderBar, 1000);
    renderBar();

    const parts = ['Recording the screen you picked'];
    if (handle.hasCamera()) parts.push('with your camera in the corner');
    if (handle.hasAudio()) {
      parts.push(handle.hasSystemAudio() ? 'and microphone + system audio' : 'and your microphone');
    }
    showToast(
      handle.hasAudio()
        ? `${parts.join(' ')}.`
        : `${parts.join(' ')} \u2014 but with no audio: no microphone, or permission was declined.`,
      { kind: handle.hasAudio() ? 'success' : 'warn' },
    );
  }

  /** Move the camera bubble off whatever it is covering. */
  function cycleCameraCorner(): void {
    const order: CameraCorner[] = ['bottom-right', 'bottom-left', 'top-left', 'top-right'];
    const next = order[(order.indexOf(cameraCorner) + 1) % order.length];
    if (!next) return;
    cameraCorner = next;
    // Mid-recording the handle owns the corner, so it has to be told. The
    // stored value is what the next recording starts from.
    recorder?.setCameraCorner(next);
    renderBar();
    showToast(`Camera bubble: ${next.replace('-', ' ')}.`, { kind: 'info' });
  }

  function setMode(next: boolean): void {
    drawMode = next;
    overlay.className = next ? 'draw' : 'click-through';
    renderBar();
  }

  /*
   * Escape hands the workstation back.
   *
   * Drawing mode covers the screen with a canvas that takes every click, so
   * while it is on, nothing underneath can be focused or typed into -- and
   * the only way out was a chip on a toolbar that can be dragged anywhere.
   * Somebody who opened the pen, moved on, and then found that Active
   * Directory's dialogs and the interview answer box would not accept a
   * single character had no way to connect the two.
   *
   * Capture phase, because the pen must win over an application's own Escape
   * while it is holding the screen. It only acts in drawing mode, so a plain
   * click-through pen never intercepts anybody's Escape.
   */
  const onEscape = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    if (!drawMode) return;
    e.preventDefault();
    e.stopPropagation();
    setMode(false);
    showToast('Click-through — the applications take clicks again.', { kind: 'info' });
  };
  document.addEventListener('keydown', onEscape, true);
  detachEscape = () => document.removeEventListener('keydown', onEscape, true);

  function button(
    label: string,
    title: string,
    on: boolean,
    onClick: () => void,
    wide = false,
  ): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'da-btn' + (on ? ' on' : '') + (wide ? ' wide' : '');
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderBar(): void {
    bar.innerHTML = '';

    const grip = document.createElement('div');
    grip.className = 'da-grip';
    grip.textContent = '⠿';
    grip.title = 'Drag to move';
    bar.appendChild(grip);

    // Dragging lives on the grip, not the whole bar: dragging from a button
    // would make every tool change feel like a slip.
    let dragging = false;
    let offset = { x: 0, y: 0 };
    grip.addEventListener('mousedown', (e) => {
      dragging = true;
      const rect = bar.getBoundingClientRect();
      offset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      e.preventDefault();
    });
    const move = (e: MouseEvent): void => {
      if (!dragging) return;
      // Clamped, so the toolbar cannot be dragged off the screen and lost.
      const x = Math.min(window.innerWidth - 80, Math.max(0, e.clientX - offset.x));
      const y = Math.min(window.innerHeight - 40, Math.max(0, e.clientY - offset.y));
      bar.style.left = `${x}px`;
      bar.style.top = `${y}px`;
    };
    const drop = (): void => {
      if (!dragging) return;
      dragging = false;
      try {
        localStorage.setItem(
          POSITION_KEY,
          JSON.stringify({ x: parseInt(bar.style.left, 10), y: parseInt(bar.style.top, 10) }),
        );
      } catch {
        /* position lasts the session, which is not fatal */
      }
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', drop);

    for (const t of TOOLS) {
      bar.appendChild(
        button(t.label, t.title, tool === t.id && drawMode, () => {
          tool = t.id;
          if (!drawMode) setMode(true);
          else renderBar();
        }),
      );
    }

    const sep1 = document.createElement('div');
    sep1.className = 'da-sep';
    bar.appendChild(sep1);

    for (const c of COLORS) {
      const sw = document.createElement('button');
      sw.className = 'da-swatch' + (c === color ? ' on' : '');
      sw.style.background = c;
      sw.title = c;
      sw.addEventListener('click', () => {
        color = c;
        renderBar();
      });
      bar.appendChild(sw);
    }

    const sep2 = document.createElement('div');
    sep2.className = 'da-sep';
    bar.appendChild(sep2);

    bar.append(
      button('↶', 'Undo the last mark', false, () => {
        strokes.pop();
        paint();
      }),
      button('Clear', 'Remove every mark', false, () => {
        strokes = [];
        paint();
      }, true),
    );

    const sep3 = document.createElement('div');
    sep3.className = 'da-sep';
    bar.appendChild(sep3);

    bar.appendChild(
      button('\u{1F4F7}', 'Photograph the screen, annotations included', false, () => {
        void screenshot();
      }),
    );

    const rec = button(
      recorder ? `\u23F9 ${formatElapsed(recorder.elapsed())}` : '\u23FA',
      recorder
        ? 'Stop recording and save'
        : 'Record a screen you pick, with your camera and narration',
      Boolean(recorder),
      () => {
        void toggleRecording();
      },
      Boolean(recorder),
    );
    if (recorder) rec.style.color = 'var(--on-accent)';
    bar.appendChild(rec);

    // Camera controls, only where there is a camera to control. The toggle is
    // disabled mid-recording: turning the bubble on halfway through would mean
    // asking for the device while the compositor is already running, and the
    // recording would change shape in the middle.
    if (canRecordCamera()) {
      const cam = button(
        cameraOn ? '\u{1F3A5}' : '\u{1F6AB}',
        recorder
          ? 'The camera cannot be changed while recording'
          : cameraOn
            ? 'Camera bubble on \u2014 click to record the screen alone'
            : 'Camera bubble off \u2014 click to include yourself',
        cameraOn,
        () => {
          if (recorder) {
            showToast('Stop the recording before changing the camera.', { kind: 'warn' });
            return;
          }
          cameraOn = !cameraOn;
          saveCameraPreference(cameraOn);
          renderBar();
        },
      );
      if (recorder) cam.style.opacity = '0.5';
      bar.appendChild(cam);

      if (cameraOn) {
        bar.appendChild(
          button(
            '\u25F3',
            `Camera bubble: ${cameraCorner.replace('-', ' ')} \u2014 click to move it`,
            false,
            cycleCameraCorner,
          ),
        );
      }
    }

    // The mode toggle, which is the control that keeps the desktop usable.
    const mode = document.createElement('button');
    mode.className = 'da-mode' + (drawMode ? ' drawing' : '');
    mode.textContent = drawMode ? '● Drawing' : '○ Click-through';
    mode.title = drawMode
      ? 'The sheet is taking clicks. Switch to let them reach the desktop.'
      : 'Clicks are reaching the desktop. Switch to draw again.';
    mode.addEventListener('click', () => setMode(!drawMode));
    bar.appendChild(mode);

    bar.appendChild(
      button('✕', 'Close the annotator', false, () => {
        // A recording left running when the toolbar goes is a recording
        // nobody can stop.
        if (recorder) void toggleRecording();
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', drop);
        document.removeEventListener('keydown', onEscape, true);
        detachEscape = null;
        window.removeEventListener('resize', sizeCanvas);
        overlay.remove();
        bar.remove();
        active = false;
      }),
    );
  }

  renderBar();
  document.body.append(overlay, bar);
  sizeCanvas();

  showToast(
    'Screen Pen ready, click-through. Pick a tool to draw; Esc gives the desktop back.',
    { kind: 'info' },
  );
}
