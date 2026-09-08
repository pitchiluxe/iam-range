/**
 * ui/consoles/annotateWindow.ts — Snip & Annotate.
 *
 * Evidence carries fifteen points in the rubric, and the way an identity
 * engineer actually files it is a screenshot with the relevant field circled.
 * "Show me you disabled the account" is answered with a picture of the console
 * after the change, not with a sentence claiming it.
 *
 * Redaction is the reason this is a tool rather than a toy. A screenshot of a
 * directory console is full of other people's names, addresses and group
 * memberships, and it is about to be attached to a ticket that support
 * contractors can read. Removing what should not travel is part of producing
 * evidence, and most people have never been taught to do it properly.
 *
 * Which is why redaction here paints an opaque block and not a blur. A blur is
 * a filter over pixels that are still underneath: it can be reversed, and
 * text under a light blur can often simply be read. Newspapers, courts and
 * more than one breach notification have learned this the expensive way. The
 * block is flattened into the exported PNG, so what is removed is gone.
 *
 * Capture uses the main process's capturePage, which photographs this window
 * only. desktopCapturer would let a page photograph the user's real desktop,
 * which is not a capability a training VM should hold.
 */
import {
  captureWindow,
  captureDisplay,
  canCaptureWindow,
  canCaptureDisplay,
} from '@/util/screenCapture';
import { appButton } from '@/ui/appChrome';
import { saveCapture, describeSave } from '@/util/saveCapture';
import { showToast } from '@/ui/toast';

type Tool = 'arrow' | 'box' | 'highlight' | 'pen' | 'text' | 'redact';

interface Shape {
  tool: Tool;
  color: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** Freehand points, for the pen. */
  points?: { x: number; y: number }[];
  text?: string;
}

const TOOL_LABEL: Record<Tool, string> = {
  arrow: '↗ Arrow',
  box: '▭ Box',
  highlight: '▤ Highlight',
  pen: '✎ Pen',
  text: 'T Text',
  redact: '█ Redact',
};

const TOOL_HINT: Record<Tool, string> = {
  arrow: 'Point at the thing that changed.',
  box: 'Frame the field somebody should look at.',
  highlight: 'Translucent — the text underneath stays readable.',
  pen: 'Freehand, for circling something awkwardly shaped.',
  text: 'A short label. Click, then type.',
  redact: 'Opaque, and flattened into the saved file. Not a blur — a blur can be undone.',
};

const COLORS = ['#ff5f56', '#ffbd2e', '#4ec9b0', '#5b8def', '#ffffff', '#111111'];

const STYLES = `
  .an-root {
    display: flex; flex-direction: column; height: 100%; background: var(--panel);
    color: var(--fg); font-family: "Segoe UI", system-ui, sans-serif; font-size: 12px;
  }
  .an-tools {
    flex-shrink: 0; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    padding: 8px 12px; background: var(--panel-alt); border-bottom: 1px solid var(--border);
  }
  .an-sep { width: 1px; height: 20px; background: var(--border); margin: 0 4px; }
  .an-tool.on { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
  .an-swatch {
    width: 20px; height: 20px; border-radius: 4px; cursor: pointer; padding: 0;
    border: 2px solid transparent;
  }
  .an-swatch.on { border-color: var(--fg); }
  .an-stage {
    flex: 1 1 auto; min-height: 0; overflow: auto; display: flex;
    align-items: center; justify-content: center; padding: 14px; background: var(--bg);
  }
  .an-canvas { max-width: 100%; box-shadow: 0 6px 26px rgba(0,0,0,0.5); cursor: crosshair; }
  .an-empty { color: var(--muted); line-height: 1.8; max-width: 560px; text-align: center; }
  .an-empty h3 { color: var(--fg); margin: 0 0 8px; font-size: 15px; }
  .an-hint {
    flex-shrink: 0; padding: 6px 12px; background: var(--panel-alt);
    border-top: 1px solid var(--border); color: var(--muted); font-size: 11px;
  }
`;

export function renderAnnotateWindow(body: HTMLElement): void {
  if (!document.getElementById('annotate-css')) {
    const style = document.createElement('style');
    style.id = 'annotate-css';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  let image: HTMLImageElement | null = null;
  let shapes: Shape[] = [];
  let tool: Tool = 'arrow';
  let color = COLORS[0]!;
  let drawing: Shape | null = null;

  const root = document.createElement('div');
  root.className = 'an-root';
  const tools = document.createElement('div');
  tools.className = 'an-tools';
  const stage = document.createElement('div');
  stage.className = 'an-stage';
  const hint = document.createElement('div');
  hint.className = 'an-hint';
  root.append(tools, stage, hint);

  const canvas = document.createElement('canvas');
  canvas.className = 'an-canvas';

  // ---- Drawing -----------------------------------------------------------

  function drawArrow(
    ctx: CanvasRenderingContext2D,
    s: Shape,
  ): void {
    const { from, to } = s;
    const head = 14;
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - head * Math.cos(angle - Math.PI / 7), to.y - head * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(to.x - head * Math.cos(angle + Math.PI / 7), to.y - head * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fillStyle = s.color;
    ctx.fill();
  }

  function drawShape(ctx: CanvasRenderingContext2D, s: Shape): void {
    ctx.save();
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const w = s.to.x - s.from.x;
    const h = s.to.y - s.from.y;

    switch (s.tool) {
      case 'arrow':
        drawArrow(ctx, s);
        break;
      case 'box':
        ctx.strokeRect(s.from.x, s.from.y, w, h);
        break;
      case 'highlight':
        // Translucent on purpose: a highlight that hides the text is a
        // redaction nobody asked for.
        ctx.globalAlpha = 0.32;
        ctx.fillRect(s.from.x, s.from.y, w, h);
        break;
      case 'redact':
        // Opaque, and flattened into the export. This is the difference
        // between removing information and hiding it.
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#000000';
        ctx.fillRect(s.from.x, s.from.y, w, h);
        break;
      case 'pen':
        if (s.points && s.points.length > 1) {
          ctx.beginPath();
          ctx.moveTo(s.points[0]!.x, s.points[0]!.y);
          for (const p of s.points.slice(1)) ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }
        break;
      case 'text':
        if (s.text) {
          ctx.font = '600 18px "Segoe UI", system-ui, sans-serif';
          ctx.textBaseline = 'top';
          // A dark plate behind the label so it stays readable over any
          // screenshot, light or dark.
          const metrics = ctx.measureText(s.text);
          ctx.globalAlpha = 0.72;
          ctx.fillStyle = '#000000';
          ctx.fillRect(s.from.x - 5, s.from.y - 4, metrics.width + 10, 26);
          ctx.globalAlpha = 1;
          ctx.fillStyle = s.color;
          ctx.fillText(s.text, s.from.x, s.from.y);
        }
        break;
    }
    ctx.restore();
  }

  function paint(): void {
    if (!image) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const s of shapes) drawShape(ctx, s);
    if (drawing) drawShape(ctx, drawing);
  }

  function loadImage(src: string, note: string): void {
    const img = new Image();
    img.onload = () => {
      image = img;
      shapes = [];
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      render();
      showToast(note, { kind: 'success' });
    };
    img.onerror = () => showToast('That image could not be read.', { kind: 'error' });
    img.src = src;
  }

  // ---- Pointer -----------------------------------------------------------

  function pointAt(e: MouseEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    // The canvas is scaled to fit the window, so screen pixels have to be
    // converted back to image pixels or every mark lands in the wrong place.
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  canvas.addEventListener('mousedown', (e) => {
    if (!image) return;
    const at = pointAt(e);

    if (tool === 'text') {
      const text = window.prompt('Label:');
      if (text && text.trim()) {
        shapes.push({ tool: 'text', color, from: at, to: at, text: text.trim() });
        paint();
      }
      return;
    }

    drawing = { tool, color, from: at, to: at, ...(tool === 'pen' ? { points: [at] } : {}) };
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!drawing || !image) return;
    const at = pointAt(e);
    drawing.to = at;
    if (drawing.tool === 'pen') drawing.points?.push(at);
    paint();
  });

  const finish = (): void => {
    if (!drawing) return;
    // A click with no drag leaves nothing behind rather than a dot nobody
    // meant to make.
    const moved =
      Math.abs(drawing.to.x - drawing.from.x) > 3 || Math.abs(drawing.to.y - drawing.from.y) > 3;
    if (moved || (drawing.points?.length ?? 0) > 2) shapes.push(drawing);
    drawing = null;
    paint();
  };
  canvas.addEventListener('mouseup', finish);
  canvas.addEventListener('mouseleave', finish);

  // ---- Actions -----------------------------------------------------------

  /**
   * Photograph the workstation.
   *
   * Prefers the silent window capture, because that is the evidence case: a
   * picture of this console after a change, with no picker and no share
   * indicator. On the web build there is no window capture, so it falls
   * through to the screen picker rather than reporting itself unavailable —
   * which is what it used to do, and why Snip did nothing in a browser.
   */
  async function snip(): Promise<void> {
    const dataUrl = (await captureWindow()) ?? (await captureDisplay());
    if (!dataUrl) {
      showToast(
        canCaptureDisplay()
          ? 'Nothing was captured. Pick a screen or window, or open an image instead.'
          : 'Screen capture is not available here. Open an image or paste one instead.',
        { kind: 'warn' },
      );
      return;
    }
    loadImage(dataUrl, 'Captured. Mark it up, and redact anything that should not travel.');
  }

  /** Photograph a screen, window or tab the user picks. */
  async function snipScreen(): Promise<void> {
    const dataUrl = await captureDisplay();
    if (!dataUrl) {
      // Cancelling the picker is the common case and is not a failure.
      showToast('No screen was captured.', { kind: 'info' });
      return;
    }
    loadImage(dataUrl, 'Captured. Redact anything that should not travel.');
  }

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => loadImage(String(reader.result), `Opened ${file.name}.`);
    reader.readAsDataURL(file);
    fileInput.value = '';
  });

  /** Paste an image straight from the clipboard, as every other tool allows. */
  function onPaste(e: ClipboardEvent): void {
    if (!root.isConnected) {
      document.removeEventListener('paste', onPaste);
      return;
    }
    const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
    if (!item) return;
    const file = item.getAsFile();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => loadImage(String(reader.result), 'Pasted from the clipboard.');
    reader.readAsDataURL(file);
  }
  document.addEventListener('paste', onPaste);

  /**
   * Write the marked-up picture out.
   *
   * Exported from the same canvas the marks were drawn on, so a redaction
   * block is pixels in the file rather than a layer somebody can peel off.
   *
   * This used to click a detached <a download> and write the literal string
   * "[png image] evidence-....png" into the in-VM filesystem, then report
   * "Saved." either way. Neither produced a file anybody could open. The toast
   * now names where the file actually went, and claims success only when it
   * went somewhere.
   */
  async function save(): Promise<void> {
    if (!image) {
      showToast('Nothing to save yet.', { kind: 'warn' });
      return;
    }
    const name = `evidence-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png'),
    );
    if (!blob) {
      showToast('The image could not be encoded.', { kind: 'error' });
      return;
    }
    const result = await saveCapture(blob, name);
    const saved = Boolean(result.path) || result.downloaded || result.inVm;
    showToast(describeSave(result, name), { kind: saved ? 'success' : 'error' });
  }

  // ---- Views -------------------------------------------------------------

  function renderTools(): void {
    tools.innerHTML = '';

    tools.append(
      appButton('📸 Snip', () => void snip(), {
        variant: 'primary',
        title: canCaptureWindow()
          ? 'Capture this workstation — no picker, no share indicator'
          : 'Capture a screen or window you pick',
      }),
      ...(canCaptureDisplay()
        ? [
            appButton('🖥️ Snip screen', () => void snipScreen(), {
              title: 'Pick a screen, window or tab to capture',
            }),
          ]
        : []),
      appButton('📂 Open', () => fileInput.click()),
      fileInput,
    );

    const sep1 = document.createElement('div');
    sep1.className = 'an-sep';
    tools.appendChild(sep1);

    for (const t of Object.keys(TOOL_LABEL) as Tool[]) {
      const b = appButton(TOOL_LABEL[t], () => {
        tool = t;
        render();
      });
      b.classList.add('an-tool');
      if (t === tool) b.classList.add('on');
      b.title = TOOL_HINT[t];
      tools.appendChild(b);
    }

    const sep2 = document.createElement('div');
    sep2.className = 'an-sep';
    tools.appendChild(sep2);

    for (const c of COLORS) {
      const sw = document.createElement('button');
      sw.className = 'an-swatch' + (c === color ? ' on' : '');
      sw.style.background = c;
      sw.title = c;
      sw.addEventListener('click', () => {
        color = c;
        render();
      });
      tools.appendChild(sw);
    }

    const sep3 = document.createElement('div');
    sep3.className = 'an-sep';
    tools.appendChild(sep3);

    tools.append(
      appButton('↶ Undo', () => {
        shapes.pop();
        paint();
      }, { variant: 'quiet' }),
      appButton('Clear marks', () => {
        shapes = [];
        paint();
      }, { variant: 'quiet' }),
      appButton('💾 Save PNG', () => void save()),
    );
  }

  function render(): void {
    renderTools();
    stage.innerHTML = '';

    if (!image) {
      const empty = document.createElement('div');
      empty.className = 'an-empty';
      const h = document.createElement('h3');
      h.textContent = 'Nothing captured yet';
      const p1 = document.createElement('p');
      p1.textContent =
        'Snip this workstation, open an image, or paste one from the clipboard. Then point at ' +
        'what changed and label it — a screenshot with the relevant field circled is how "show ' +
        'me you disabled the account" is answered.';
      const p2 = document.createElement('p');
      p2.textContent =
        'Redact before you attach anything. A directory console is full of other people’s ' +
        'names and group memberships, and the ticket is readable by more people than you think.';
      empty.append(h, p1, p2);
      stage.appendChild(empty);
    } else {
      stage.appendChild(canvas);
      paint();
    }

    hint.textContent = `${TOOL_LABEL[tool]} — ${TOOL_HINT[tool]}`;
  }

  render();
  body.innerHTML = '';
  body.appendChild(root);
}
