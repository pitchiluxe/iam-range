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

let active = false;

/** Whether the desktop annotator is currently up. */
export function annotatorActive(): boolean {
  return active;
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
  let drawMode = true;
  let strokes: Stroke[] = [];
  let current: Stroke | null = null;

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'draw';

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

  function setMode(next: boolean): void {
    drawMode = next;
    overlay.className = next ? 'draw' : 'click-through';
    renderBar();
  }

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
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', drop);
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
    'Drawing over the desktop. Switch to click-through when you need the applications back.',
    { kind: 'info' },
  );
}
