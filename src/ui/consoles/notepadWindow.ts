/**
 * ui/consoles/notepadWindow.ts — VM Notepad window.
 *
 * A simple text editor with line numbers, auto-save to localStorage,
 * and a word-count status bar.
 */
const NOTEPAD_KEY = 'notepad_content';

export function renderNotepadWindow(body: HTMLElement): void {
  body.style.cssText =
    'display:flex;flex-direction:column;height:100%;background:#0e1116;font-family:Consolas,Monaco,"Courier New",monospace;';

  // Load saved content
  const saved = localStorage.getItem(NOTEPAD_KEY) ?? '';

  const editorWrap = document.createElement('div');
  editorWrap.style.cssText = 'display:flex;flex:1;overflow:hidden;min-height:0;';

  // Line numbers
  const lineNums = document.createElement('div');
  lineNums.id = 'np-linenums';
  lineNums.style.cssText = `
    flex-shrink:0;width:40px;background:#0a0d12;border-right:1px solid #2d343d;
    color:#4a5568;font-size:12px;line-height:1.6;text-align:right;
    padding:10px 6px 10px 0;overflow:hidden;user-select:none;
  `;

  // Textarea
  const ta = document.createElement('textarea');
  ta.id = 'np-editor';
  ta.value = saved;
  ta.style.cssText = `
    flex:1;border:none;outline:none;resize:none;background:#0e1116;
    color:#e6e6e6;font-family:Consolas,Monaco,"Courier New",monospace;
    font-size:12px;line-height:1.6;padding:10px 12px;overflow-y:auto;
    tab-size:4;white-space:pre-wrap;word-break:break-all;
  `;

  editorWrap.appendChild(lineNums);
  editorWrap.appendChild(ta);
  body.appendChild(editorWrap);

  // Status bar
  const statusBar = document.createElement('div');
  statusBar.id = 'np-status';
  statusBar.style.cssText = `
    flex-shrink:0;height:26px;background:#1b1f24;border-top:1px solid #2d343d;
    display:flex;align-items:center;padding:0 12px;font-size:11px;color:#8b95a1;
    gap:16px;
  `;
  statusBar.innerHTML = `
    <span id="np-wc">Words: 0</span>
    <span id="np-lc">Lines: 1</span>
    <span id="np-autosave" style="margin-left:auto;color:#4ec9b0;opacity:0;">Saved</span>
  `;
  body.appendChild(statusBar);

  // Update line numbers and counts
  function updateMeta(): void {
    const text = ta.value;
    const lines = text.split('\n');
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const lnEl = document.getElementById('np-linenums');
    const wcEl = document.getElementById('np-wc');
    const lcEl = document.getElementById('np-lc');
    if (lnEl) {
      lnEl.innerHTML = lines.map((_, i) => `${i + 1}`).join('<br>');
    }
    if (wcEl) wcEl.textContent = `Words: ${words}`;
    if (lcEl) lcEl.textContent = `Lines: ${lines.length}`;
  }

  // Auto-save
  let saveTimer: number | null = null;
  function scheduleSave(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      localStorage.setItem(NOTEPAD_KEY, ta.value);
      const el = document.getElementById('np-autosave');
      if (el) {
        el.style.opacity = '1';
        setTimeout(() => {
          el.style.opacity = '0';
        }, 1500);
      }
    }, 600);
  }

  ta.addEventListener('input', () => {
    updateMeta();
    scheduleSave();
  });
  ta.addEventListener('scroll', () => {
    const lnEl = document.getElementById('np-linenums');
    if (lnEl) lnEl.scrollTop = ta.scrollTop;
  });

  updateMeta();
}
