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
import { openExternal } from '@/util/externalLink';

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
  urlBar.placeholder = 'Search Google, or type an address';
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

  /**
   * Whether what was typed looks like an address rather than a question.
   *
   * "okta.com" and "https://…" are addresses; "how does SAML work" is not.
   * Guessing wrong in the harmless direction — searching for something that
   * was meant as a host — beats a "site not found" for a plain question.
   */
  function looksLikeUrl(raw: string): boolean {
    const text = raw.trim();
    if (/^[a-z]+:\/\//i.test(text)) return true;
    if (/\s/.test(text)) return false;
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(text);
  }

  const SEARCH_URL = 'https://www.google.com/search?q=';

  /** Load an allowlisted URL, or explain why it was refused. */
  function go(raw: string, pushHistory = true): void {
    const typed = raw.trim();
    if (!typed) return;
    // A search, when it is not an address.
    const target = looksLikeUrl(typed)
      ? normalizeUrl(typed)
      : `${SEARCH_URL}${encodeURIComponent(typed)}`;
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

    const host = new URL(target).hostname;
    status.textContent = hasWebview() ? `Loading ${host}…` : `Loading ${host}…`;

    if (hasWebview()) {
      frame.addEventListener('did-finish-load', () => {
        status.textContent = `Loaded ${host}`;
      });
      return;
    }

    // In a browser tab this is an iframe, and Google, Microsoft and most
    // others answer X-Frame-Options: DENY. The frame stays blank and the load
    // event never distinguishes that from a slow page, so rather than leave
    // the learner staring at a white rectangle, say what happened and offer
    // the thing that does work.
    let settled = false;
    frame.addEventListener('load', () => {
      settled = true;
      status.textContent = `Loaded ${host}`;
    });
    window.setTimeout(() => {
      if (settled) return;
      showRefused(host, target);
    }, 2500);
  }

  /**
   * Explain a refused embed, and offer the real browser.
   *
   * The desktop build does not need this: a webview loads these sites
   * properly. It is the web build's honest answer.
   */
  function showRefused(host: string, target: string): void {
    viewport.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText =
      'height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'gap:12px;text-align:center;padding:32px;';

    const h = document.createElement('div');
    h.textContent = `${host} will not display inside a frame`;
    h.style.cssText = 'font-size:14px;color:var(--fg);font-weight:600;';

    const p = document.createElement('div');
    p.textContent =
      `${host} sends X-Frame-Options: DENY, which tells every browser not to ` +
      'render it inside another page. That is their server, not a limit of this ' +
      'lab — the installed desktop app renders it properly, because it uses a ' +
      'real browser view rather than a frame.';
    p.style.cssText = 'font-size:12px;color:var(--muted);max-width:460px;line-height:1.65;';

    const open = document.createElement('button');
    open.textContent = 'Open in my browser ↗';
    open.style.cssText =
      'padding:8px 16px;border-radius:5px;border:1px solid var(--accent);background:var(--accent);' +
      'color:var(--on-accent);font-size:12px;cursor:pointer;font-family:inherit;';
    open.addEventListener('click', () => openExternal(target));

    wrap.append(h, p, open);
    viewport.appendChild(wrap);
    status.textContent = `${host} refused to be framed.`;
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
    'Browser',
    'Type a question to search, or an address to go straight there. Reachable ' +
      'hosts are limited to search engines and identity documentation, so the ' +
      'lab stays a lab — but you can look things up the way you would at work.',
    'info',
  );
}
