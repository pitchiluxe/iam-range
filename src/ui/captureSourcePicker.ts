/**
 * ui/captureSourcePicker.ts — "which screen do you want to share?"
 *
 * In a browser this UI does not exist: getDisplayMedia shows the browser's own
 * picker, which is the right one to show because it is the one users already
 * recognise and it cannot be spoofed by the page.
 *
 * Electron has no such picker on most platforms. Its main process answers the
 * request itself, and without something like this it would have to answer
 * "the whole primary screen" every time — which is the wrong default for
 * somebody recording one window of a tutorial. So the main process sends the
 * source list here and waits.
 *
 * Two properties matter and are easy to lose:
 *
 *   - Cancelling must resolve, not hang. The main process is holding a
 *     permission callback open; a picker that can be dismissed without
 *     answering leaves getDisplayMedia pending forever.
 *   - The list is data from the main process, but the names in it come from
 *     other applications' window titles. They go in as text, never as HTML.
 */

interface CaptureSource {
  id: string;
  name: string;
  kind: string;
  thumbnail: string | null;
}

interface ElectronBridge {
  invoke(cmd: string, ...args: unknown[]): Promise<unknown>;
  onPickCaptureSource?(fn: (sources: CaptureSource[]) => void): () => void;
}

const OVERLAY_ID = 'capture-source-picker';

const STYLES = `
  #${OVERLAY_ID} {
    position: fixed; inset: 0; z-index: 9500; display: flex;
    align-items: center; justify-content: center; background: rgba(0,0,0,0.62);
    font-family: "Segoe UI", system-ui, sans-serif;
  }
  #${OVERLAY_ID} .csp-panel {
    width: min(880px, 92vw); max-height: 82vh; display: flex; flex-direction: column;
    background: var(--panel); color: var(--fg); border: 1px solid var(--border);
    border-radius: 10px; box-shadow: 0 24px 60px rgba(0,0,0,0.55); overflow: hidden;
  }
  #${OVERLAY_ID} .csp-head { padding: 14px 18px 10px; border-bottom: 1px solid var(--border); }
  #${OVERLAY_ID} h2 { margin: 0 0 4px; font-size: 15px; }
  #${OVERLAY_ID} .csp-sub { font-size: 12px; color: var(--muted); line-height: 1.5; }
  #${OVERLAY_ID} .csp-group {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--muted); padding: 12px 18px 6px;
  }
  #${OVERLAY_ID} .csp-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 10px; padding: 0 18px;
  }
  #${OVERLAY_ID} .csp-body { overflow-y: auto; padding-bottom: 14px; }
  #${OVERLAY_ID} .csp-card {
    display: flex; flex-direction: column; gap: 6px; padding: 8px; cursor: pointer;
    background: var(--panel-alt); border: 2px solid transparent; border-radius: 8px;
    color: var(--fg); text-align: left; font: inherit;
  }
  #${OVERLAY_ID} .csp-card:hover, #${OVERLAY_ID} .csp-card:focus-visible {
    border-color: var(--accent); outline: none;
  }
  #${OVERLAY_ID} .csp-thumb {
    width: 100%; aspect-ratio: 16 / 10; object-fit: cover; border-radius: 4px;
    background: #000; display: block;
  }
  #${OVERLAY_ID} .csp-name {
    font-size: 11px; line-height: 1.35; overflow: hidden; text-overflow: ellipsis;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }
  #${OVERLAY_ID} .csp-foot {
    display: flex; justify-content: flex-end; gap: 8px; padding: 12px 18px;
    border-top: 1px solid var(--border); background: var(--panel-alt);
  }
  #${OVERLAY_ID} .csp-btn {
    padding: 6px 14px; border-radius: 4px; border: 1px solid var(--border);
    background: var(--panel); color: var(--fg); font: inherit; font-size: 12px; cursor: pointer;
  }
`;

function bridge(): ElectronBridge | null {
  const g = globalThis as unknown as { electron?: ElectronBridge };
  return g.electron ?? null;
}

/** Show the picker and resolve with the chosen id, or null when cancelled. */
function ask(sources: CaptureSource[]): Promise<string | null> {
  document.getElementById(OVERLAY_ID)?.remove();

  if (!document.getElementById('csp-css')) {
    const style = document.createElement('style');
    style.id = 'csp-css';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;

    let settled = false;
    const close = (id: string | null): void => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(id);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close(null);
    };
    document.addEventListener('keydown', onKey);

    const panel = document.createElement('div');
    panel.className = 'csp-panel';

    const head = document.createElement('div');
    head.className = 'csp-head';
    const h = document.createElement('h2');
    h.textContent = 'Choose what to share';
    const sub = document.createElement('div');
    sub.className = 'csp-sub';
    sub.textContent =
      'Everything visible in the source you pick will be in the recording. Close anything ' +
      'you would not publish before you start.';
    head.append(h, sub);

    const body = document.createElement('div');
    body.className = 'csp-body';

    const section = (label: string, items: CaptureSource[]): void => {
      if (items.length === 0) return;
      const title = document.createElement('div');
      title.className = 'csp-group';
      title.textContent = label;
      const grid = document.createElement('div');
      grid.className = 'csp-grid';
      for (const s of items) {
        const card = document.createElement('button');
        card.className = 'csp-card';
        card.type = 'button';
        if (s.thumbnail) {
          const img = document.createElement('img');
          img.className = 'csp-thumb';
          img.src = s.thumbnail;
          img.alt = '';
          card.appendChild(img);
        } else {
          const blank = document.createElement('div');
          blank.className = 'csp-thumb';
          card.appendChild(blank);
        }
        const name = document.createElement('div');
        name.className = 'csp-name';
        // textContent, not innerHTML: these are other applications' window
        // titles, and a window title is somebody else's string.
        name.textContent = s.name || 'Untitled';
        card.appendChild(name);
        card.addEventListener('click', () => close(s.id));
        grid.appendChild(card);
      }
      body.append(title, grid);
    };

    section(
      'Screens',
      sources.filter((s) => s.kind === 'screen'),
    );
    section(
      'Windows',
      sources.filter((s) => s.kind !== 'screen'),
    );

    const foot = document.createElement('div');
    foot.className = 'csp-foot';
    const cancel = document.createElement('button');
    cancel.className = 'csp-btn';
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => close(null));
    foot.appendChild(cancel);

    panel.append(head, body, foot);
    overlay.appendChild(panel);
    // Clicking the backdrop cancels, which is what every other modal here does.
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
    document.body.appendChild(overlay);
    cancel.focus();
  });
}

/**
 * Answer the main process's screen-share questions for the life of the app.
 *
 * A no-op in the browser build, where the browser asks this question itself.
 */
export function installCaptureSourcePicker(): void {
  const electron = bridge();
  if (!electron?.onPickCaptureSource) return;

  electron.onPickCaptureSource((sources) => {
    void ask(Array.isArray(sources) ? sources : [])
      .then((id) => electron.invoke('capture:sourcePicked', id))
      // The main process is holding a permission callback open on this
      // answer. Failing to send one is worse than sending a cancellation.
      .catch(() => electron.invoke('capture:sourcePicked', null));
  });
}
