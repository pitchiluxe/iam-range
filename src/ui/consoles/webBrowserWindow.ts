/**
 * ui/consoles/webBrowserWindow.ts — restricted web browser inside the VM.
 *
 * Reaches identity/IAM learning material and nothing else: every navigation is
 * checked against config/webAllowlist.ts first. The lab is meant to stay a
 * focused training environment, so this is deliberately not a general browser.
 *
 * Two rendering paths, because they have different capabilities:
 *   - Electron (desktop build): <webview>, which can load sites that refuse
 *     iframe embedding.
 *   - Web build: <iframe>. Most real sites send X-Frame-Options/CSP and will
 *     refuse to render; the UI says so plainly instead of showing a blank box.
 */
import { IAM_BOOKMARKS, isAllowedUrl, normalizeUrl } from '@/config/webAllowlist';

/** True when running inside the Electron shell, where <webview> is available. */
function hasWebview(): boolean {
  const w = window as unknown as { electron?: unknown };
  return Boolean(w.electron) && 'customElements' in window;
}

export function renderWebBrowserWindow(body: HTMLElement): void {
  body.innerHTML = '';
  // Additive — see the note in terminalWindow.ts about cssText and flex sizing.
  Object.assign(body.style, { overflow: 'hidden', flex: '1', minHeight: '0' });

  const root = document.createElement('div');
  root.style.cssText =
    'display:flex;flex-direction:column;height:100%;background:#1a1d22;' +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
    'font-size:12px;color:var(--fg);';
  body.appendChild(root);

  // ── Chrome: nav buttons, URL bar, Go ──────────────────────────────────────
  const chrome = document.createElement('div');
  chrome.style.cssText =
    'display:flex;align-items:center;gap:6px;padding:6px 8px;background:var(--border);' +
    'border-bottom:1px solid var(--border);flex-shrink:0;';

  const history: string[] = [];
  let historyPos = -1;

  const mkNav = (label: string, title: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.style.cssText =
      'width:28px;height:28px;border-radius:4px;border:none;background:transparent;' +
      'color:var(--muted);font-size:14px;cursor:pointer;';
    return b;
  };
  const backBtn = mkNav('←', 'Back');
  const fwdBtn = mkNav('→', 'Forward');
  const reloadBtn = mkNav('↺', 'Reload');

  const urlBar = document.createElement('input');
  urlBar.type = 'text';
  urlBar.placeholder = 'Search identity docs — only IAM sites are reachable';
  urlBar.style.cssText =
    'flex:1;background:var(--panel);color:var(--fg);border:1px solid var(--border);border-radius:4px;' +
    'padding:5px 10px;font-size:12px;font-family:monospace;outline:none;';

  const goBtn = document.createElement('button');
  goBtn.textContent = 'Go';
  goBtn.style.cssText =
    'background:var(--accent);color:#06231d;border:none;border-radius:4px;padding:5px 12px;' +
    'font-size:12px;font-weight:600;cursor:pointer;';

  // A site that refuses framing renders as a blank box with no explanation.
  // This gives the learner a way out instead of a dead end.
  const openExt = document.createElement('button');
  openExt.textContent = 'Open ↗';
  openExt.title = 'Open this page in your system browser';
  openExt.style.cssText =
    'background:transparent;color:var(--muted);border:1px solid var(--border);border-radius:4px;' +
    'padding:5px 10px;font-size:11px;cursor:pointer;';
  openExt.addEventListener('click', () => {
    const target = normalizeUrl(urlBar.value);
    // Re-check: the allowlist governs what leaves the lab, however it leaves.
    if (isAllowedUrl(target)) window.open(target, '_blank', 'noopener,noreferrer');
  });

  chrome.append(backBtn, fwdBtn, reloadBtn, urlBar, goBtn, openExt);
  root.appendChild(chrome);

  // ── Bookmarks ─────────────────────────────────────────────────────────────
  const marks = document.createElement('div');
  marks.style.cssText =
    'display:flex;gap:4px;padding:5px 8px;background:#1f242b;border-bottom:1px solid var(--border);' +
    'flex-shrink:0;overflow-x:auto;white-space:nowrap;';
  for (const bm of IAM_BOOKMARKS) {
    const b = document.createElement('button');
    b.textContent = bm.label;
    b.style.cssText =
      'background:transparent;border:1px solid var(--border);border-radius:3px;color:var(--muted);' +
      'padding:3px 8px;font-size:11px;cursor:pointer;flex-shrink:0;';
    b.addEventListener('click', () => go(bm.url));
    marks.appendChild(b);
  }
  root.appendChild(marks);

  // ── Viewport ──────────────────────────────────────────────────────────────
  const viewport = document.createElement('div');
  viewport.style.cssText = 'flex:1;position:relative;background:var(--panel);overflow:auto;';
  root.appendChild(viewport);

  const status = document.createElement('div');
  status.style.cssText =
    'padding:4px 10px;background:#1f242b;border-top:1px solid var(--border);font-size:10.5px;' +
    'color:#6b7280;flex-shrink:0;';
  status.textContent = 'Restricted browser — IAM and identity resources only.';
  root.appendChild(status);

  const showMessage = (title: string, detail: string, tone: 'info' | 'block'): void => {
    viewport.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText =
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'height:100%;padding:40px;text-align:center;gap:10px;';
    const h = document.createElement('div');
    h.textContent = title;
    h.style.cssText = `font-size:14px;font-weight:600;color:${tone === 'block' ? 'var(--err)' : 'var(--accent)'};`;
    const p = document.createElement('div');
    p.textContent = detail;
    p.style.cssText = 'font-size:12px;color:var(--muted);max-width:460px;line-height:1.6;';
    wrap.append(h, p);
    viewport.appendChild(wrap);
  };

  /** Load an allowlisted URL, or explain why it was refused. */
  function go(raw: string, pushHistory = true): void {
    const target = normalizeUrl(raw);
    urlBar.value = target;

    if (!isAllowedUrl(target)) {
      showMessage(
        'Blocked — outside the IAM allowlist',
        `This lab's browser only reaches identity and IAM learning resources. ` +
          `"${target}" is not on the allowlist. Use a bookmark above, or add the ` +
          `host to shared/webAllowlist.json if it belongs in the curriculum.`,
        'block',
      );
      status.textContent = 'Blocked by allowlist.';
      return;
    }

    if (pushHistory) {
      history.splice(historyPos + 1);
      history.push(target);
      historyPos = history.length - 1;
    }

    viewport.innerHTML = '';
    // <webview> in Electron can render sites that refuse framing; the web build
    // only has <iframe>, which most real sites will decline.
    const frame = document.createElement(hasWebview() ? 'webview' : 'iframe');
    frame.setAttribute('src', target);
    frame.setAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-popups allow-forms allow-presentation',
    );
    // Not 'no-referrer': YouTube validates embeds against the referring origin
    // and answers "Error 153" when it is absent. This sends the origin only —
    // never the path or query — which satisfies the player without leaking
    // what the learner was looking at.
    frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    frame.style.cssText = 'width:100%;height:100%;border:none;background:#fff;';
    viewport.appendChild(frame);

    status.textContent = hasWebview()
      ? `Loaded ${new URL(target).hostname}`
      : `Loaded ${new URL(target).hostname} — if the page is blank, this site refuses ` +
        `embedding in the web build. Use "Open ↗", or run the desktop app.`;
  }

  goBtn.addEventListener('click', () => go(urlBar.value));
  urlBar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go(urlBar.value);
  });
  backBtn.addEventListener('click', () => {
    if (historyPos > 0) go(history[--historyPos]!, false);
  });
  fwdBtn.addEventListener('click', () => {
    if (historyPos < history.length - 1) go(history[++historyPos]!, false);
  });
  reloadBtn.addEventListener('click', () => {
    if (historyPos >= 0) go(history[historyPos]!, false);
  });

  showMessage(
    'Restricted IAM browser',
    'Pick a bookmark above, or type a URL. Only identity and IAM resources are ' +
      'reachable — everything else is blocked, so the lab stays a focused ' +
      'training environment.',
    'info',
  );
}
