/**
 * ui/appChrome.ts — one operating system, not twenty-six applications.
 *
 * The windows were built over many sessions and drifted, which a measurement
 * across all of them made plain: ordinary toolbar buttons ranged from 18px to
 * 36px tall, in five different font sizes and six different corner radii. On
 * screen that reads as a collection of web pages behind a shared title bar
 * rather than as a machine, which undercuts the whole premise of a workstation
 * a learner is supposed to recognise.
 *
 * Two layers, and the first matters more than the second.
 *
 * The baseline normalises what browsers get wrong by default. Form controls do
 * not inherit font from their container — a `<button>` with no font set renders
 * in the browser's own 13.33px Arial, which is why App Portal measured
 * differently from everything around it. One rule fixes typography in all
 * twenty-six windows without any of them being edited, and without fighting
 * the inline styles they already carry.
 *
 * The component classes are what new and migrated windows use so they agree on
 * height, radius and spacing. They are deliberately low-specificity so an app
 * with a genuine reason to differ still can — the terminal is monospace, the
 * Control Panel imitates Windows' own light chrome, and neither should be
 * flattened into a house style that fits neither.
 */

const STYLE_ID = 'app-chrome-css';

/**
 * Windows' own metrics, near enough. A 28px control with 4px corners at
 * 12px type is what the shell this imitates actually uses, and matching it is
 * the point.
 */
const CSS = `
  /* ---- Baseline -------------------------------------------------------- */
  /* Form controls do not inherit font. Without this a button with no font of
     its own renders in the browser's 13.33px Arial, which is why one window
     measured differently from every other. */
  /* :where() contributes no specificity, which is the whole point here.
     Written as a plain descendant selector this baseline outranks .app-btn —
     a class alone — and overrides the component styles it exists to support.
     That is not hypothetical: it silently held every migrated button at its
     container's font size until a measurement caught it. */
  .apex-window-body :where(button, input, select, textarea) {
    font-family: inherit;
    font-size: inherit;
  }
  .apex-window-body :where(button) { cursor: pointer; }
  .apex-window-body :where(button:disabled) { cursor: not-allowed; opacity: 0.5; }
  .apex-window-body :focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  /* ---- Components ------------------------------------------------------ */
  .app-toolbar {
    flex-shrink: 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 8px 12px; background: var(--panel-alt);
    border-bottom: 1px solid var(--border);
  }
  .app-btn {
    height: 28px; padding: 0 12px; border-radius: 4px; box-sizing: border-box;
    display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
    font-family: inherit; font-size: 12px; line-height: 1; cursor: pointer;
    background: var(--panel); color: var(--fg); border: 1px solid var(--border);
    transition: background 0.12s, border-color 0.12s;
  }
  .app-btn:hover:not(:disabled) { background: var(--border); }
  .app-btn.primary {
    background: var(--accent); color: var(--on-accent); border-color: var(--accent);
    font-weight: 600;
  }
  .app-btn.primary:hover:not(:disabled) { filter: brightness(1.08); background: var(--accent); }
  .app-btn.danger { background: var(--err); color: #12161c; border-color: var(--err); font-weight: 600; }
  .app-btn.quiet { background: transparent; color: var(--muted); }
  .app-btn.quiet:hover:not(:disabled) { background: var(--border); color: var(--fg); }
  .app-btn:disabled { opacity: 0.45; cursor: not-allowed; }

  .app-input, .app-select {
    height: 28px; padding: 0 9px; border-radius: 4px; box-sizing: border-box;
    font-family: inherit; font-size: 12px;
    background: var(--panel); color: var(--fg); border: 1px solid var(--border);
  }
  .app-select { cursor: pointer; }
  .app-input:focus, .app-select:focus { outline: none; border-color: var(--accent); }

  .app-status {
    flex-shrink: 0; display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
    padding: 5px 12px; background: var(--panel-alt);
    border-top: 1px solid var(--border); color: var(--muted); font-size: 11px;
  }

  .app-label {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em;
    color: var(--muted); font-weight: 600;
  }
`;

/**
 * Install the shared chrome once.
 *
 * Idempotent, and called at boot rather than per window: twenty-six windows
 * each injecting their own copy is twenty-six stylesheets the browser has to
 * reconcile, and a rule that only exists once the right window has been opened
 * is a rule that does not exist.
 */
export function installAppChrome(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

/** Build a toolbar button in the house style. */
export function appButton(
  label: string,
  onClick: () => void,
  opts: { variant?: 'primary' | 'danger' | 'quiet'; title?: string; disabled?: boolean } = {},
): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'app-btn' + (opts.variant ? ` ${opts.variant}` : '');
  b.textContent = label;
  if (opts.title) b.title = opts.title;
  if (opts.disabled) b.disabled = true;
  b.addEventListener('click', onClick);
  return b;
}
