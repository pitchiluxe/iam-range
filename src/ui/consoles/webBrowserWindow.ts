/**
 * ui/consoles/webBrowserWindow.ts — restricted web browser inside the VM.
 *
 * Reaches identity/IAM learning material and nothing else: every navigation is
 * checked against config/webAllowlist.ts first. The lab is meant to stay a
 * focused training environment, so this is deliberately not a general browser.
 *
 * Tabs: each tab owns its page, its history and its status line, and a
 * background tab stays loaded, so the Entra admin center can sit in one tab
 * while Microsoft Learn is open in another. Other windows (the 90-Day
 * Challenge) open their page in a new tab; so do the pop-ups a page asks for,
 * after the same allowlist check.
 *
 * Two rendering paths, because they have different capabilities:
 *   - Electron (desktop build): <webview>, which can load sites that refuse
 *     iframe embedding.
 *   - Web build: <iframe>. Most real sites send X-Frame-Options/CSP and will
 *     refuse to render; the UI says so plainly instead of showing a blank box.
 */
import { BROWSER_HOME, IAM_BOOKMARKS, isAllowedUrl, normalizeUrl } from '@/config/webAllowlist';
import { openExternal } from '@/util/externalLink';
import { onBrowserOpen, takePendingBrowserUrl } from '@/util/appLauncher';

/** True when running inside the Electron shell, where <webview> is available. */
function hasWebview(): boolean {
  const w = window as unknown as { electron?: unknown };
  return Boolean(w.electron) && 'customElements' in window;
}

/** Pop-ups from a page in a webview, forwarded by the main process. */
function onPopupRequest(fn: (url: string) => void): () => void {
  const e = (window as unknown as { electron?: { onBrowserPopup?: (fn: (url: string) => void) => () => void } }).electron;
  return e?.onBrowserPopup ? e.onBrowserPopup(fn) : () => {};
}

/** At most this many tabs: each one is a live page with its own memory. */
const MAX_TABS = 12;

const SEARCH_URL = 'https://www.google.com/search?q=';

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

interface Tab {
  id: number;
  /** The tab's page area; hidden while another tab is active. */
  view: HTMLDivElement;
  /** The tab strip button. */
  button: HTMLDivElement;
  label: HTMLSpanElement;
  url: string;
  title: string;
  status: string;
  history: string[];
  historyPos: number;
}

export function renderWebBrowserWindow(body: HTMLElement): void {
  body.innerHTML = '';
  // Additive — see the note in terminalWindow.ts about cssText and flex sizing.
  Object.assign(body.style, { overflow: 'hidden', flex: '1', minHeight: '0' });

  const root = document.createElement('div');
  root.style.cssText =
    'display:flex;flex-direction:column;height:100%;background:var(--panel);' +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
    'font-size:12px;color:var(--fg);';
  body.appendChild(root);

  // ── Tab strip ─────────────────────────────────────────────────────────────
  const strip = document.createElement('div');
  strip.style.cssText =
    'display:flex;align-items:flex-end;gap:2px;padding:5px 6px 0;background:var(--panel-alt);' +
    'border-bottom:1px solid var(--border);flex-shrink:0;overflow-x:auto;';
  const newTabBtn = document.createElement('button');
  newTabBtn.textContent = '+';
  newTabBtn.title = 'New tab (Ctrl+T)';
  newTabBtn.style.cssText =
    'width:26px;height:24px;margin:0 0 3px 4px;border:none;border-radius:4px;background:transparent;' +
    'color:var(--muted);font-size:16px;cursor:pointer;flex-shrink:0;';
  strip.appendChild(newTabBtn);
  root.appendChild(strip);

  // ── Chrome: nav buttons, URL bar, Go ──────────────────────────────────────
  const chrome = document.createElement('div');
  chrome.style.cssText =
    'display:flex;align-items:center;gap:6px;padding:6px 8px;background:var(--border);' +
    'border-bottom:1px solid var(--border);flex-shrink:0;';

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
  const homeBtn = mkNav('⌂', 'Home');

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

  chrome.append(backBtn, fwdBtn, reloadBtn, homeBtn, urlBar, goBtn, openExt);
  root.appendChild(chrome);

  // ── Bookmarks ─────────────────────────────────────────────────────────────
  const marks = document.createElement('div');
  marks.style.cssText =
    'display:flex;gap:4px;padding:5px 8px;background:var(--panel-alt);border-bottom:1px solid var(--border);' +
    'flex-shrink:0;overflow-x:auto;white-space:nowrap;';
  for (const bm of IAM_BOOKMARKS) {
    const b = document.createElement('button');
    b.textContent = bm.label;
    b.title = 'Click: open here · Ctrl+click: open in a new tab';
    b.style.cssText =
      'background:transparent;border:1px solid var(--border);border-radius:3px;color:var(--muted);' +
      'padding:3px 8px;font-size:11px;cursor:pointer;flex-shrink:0;';
    b.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey) newTab(bm.url);
      else go(bm.url);
    });
    marks.appendChild(b);
  }
  root.appendChild(marks);

  // ── Pages: one view per tab, stacked ──────────────────────────────────────
  const pages = document.createElement('div');
  pages.style.cssText = 'flex:1;position:relative;background:var(--panel);min-height:0;';
  root.appendChild(pages);

  const statusBar = document.createElement('div');
  statusBar.style.cssText =
    'padding:4px 10px;background:var(--panel-alt);border-top:1px solid var(--border);font-size:10.5px;' +
    'color:#6b7280;flex-shrink:0;';
  root.appendChild(statusBar);

  const tabs: Tab[] = [];
  let active: Tab | null = null;
  let nextId = 1;

  const setStatus = (tab: Tab, text: string): void => {
    tab.status = text;
    if (tab === active) statusBar.textContent = text;
  };

  const setTitle = (tab: Tab, title: string): void => {
    tab.title = title;
    tab.label.textContent = title || 'New tab';
    tab.button.title = title ? `${title}\n${tab.url}` : tab.url;
  };

  const paintTabs = (): void => {
    for (const t of tabs) {
      const on = t === active;
      t.view.style.display = on ? 'block' : 'none';
      t.button.style.background = on ? 'var(--panel)' : 'transparent';
      t.button.style.color = on ? 'var(--fg)' : 'var(--muted)';
      t.button.style.borderColor = on ? 'var(--border)' : 'transparent';
    }
    if (active) {
      urlBar.value = active.url;
      statusBar.textContent = active.status;
    }
    newTabBtn.disabled = tabs.length >= MAX_TABS;
    newTabBtn.style.opacity = newTabBtn.disabled ? '0.4' : '1';
  };

  const activate = (tab: Tab): void => {
    active = tab;
    paintTabs();
  };

  const closeTab = (tab: Tab): void => {
    const i = tabs.indexOf(tab);
    if (i < 0) return;
    tabs.splice(i, 1);
    tab.view.remove(); // a webview torn out of the DOM stops loading and frees its page
    tab.button.remove();
    if (tabs.length === 0) {
      newTab(BROWSER_HOME);
      return;
    }
    if (active === tab) active = tabs[Math.min(i, tabs.length - 1)]!;
    paintTabs();
  };

  const createTab = (): Tab => {
    const view = document.createElement('div');
    view.style.cssText = 'position:absolute;inset:0;overflow:auto;background:var(--panel);';
    pages.appendChild(view);

    const button = document.createElement('div');
    button.style.cssText =
      'display:flex;align-items:center;gap:6px;min-width:90px;max-width:190px;height:26px;padding:0 6px 0 10px;' +
      'border:1px solid transparent;border-bottom:none;border-radius:6px 6px 0 0;cursor:pointer;flex-shrink:0;';
    const label = document.createElement('span');
    label.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;';
    label.textContent = 'New tab';
    const close = document.createElement('button');
    close.textContent = '×';
    close.title = 'Close tab (Ctrl+W)';
    close.style.cssText =
      'width:18px;height:18px;border:none;border-radius:3px;background:transparent;color:var(--muted);' +
      'font-size:13px;line-height:1;cursor:pointer;padding:0;';
    button.append(label, close);
    strip.insertBefore(button, newTabBtn);

    const tab: Tab = { id: nextId++, view, button, label, url: '', title: '', status: '', history: [], historyPos: -1 };
    button.addEventListener('click', () => activate(tab));
    // Middle-click closes, as in every desktop browser.
    button.addEventListener('auxclick', (e) => {
      if (e.button === 1) closeTab(tab);
    });
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab);
    });
    tabs.push(tab);
    return tab;
  };

  const showMessage = (tab: Tab, title: string, detail: string, tone: 'info' | 'block'): void => {
    tab.view.innerHTML = '';
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
    tab.view.appendChild(wrap);
  };

  /**
   * Explain a refused embed, and offer the real browser.
   *
   * The desktop build does not need this: a webview loads these sites
   * properly. It is the web build's honest answer.
   */
  const showRefused = (tab: Tab, host: string, target: string): void => {
    tab.view.innerHTML = '';
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
    tab.view.appendChild(wrap);
    setStatus(tab, `${host} refused to be framed.`);
  };

  /** Load an allowlisted URL into a tab, or explain why it was refused. */
  function load(tab: Tab, raw: string, pushHistory = true): void {
    const typed = raw.trim();
    if (!typed) return;
    // A search, when it is not an address.
    const target = looksLikeUrl(typed) ? normalizeUrl(typed) : `${SEARCH_URL}${encodeURIComponent(typed)}`;
    tab.url = target;
    if (tab === active) urlBar.value = target;

    if (!isAllowedUrl(target)) {
      showMessage(
        tab,
        'Blocked — outside the IAM allowlist',
        `This lab's browser only reaches identity and IAM learning resources. ` +
          `"${target}" is not on the allowlist. Use a bookmark above, or add the ` +
          `host to shared/webAllowlist.json if it belongs in the curriculum.`,
        'block',
      );
      setTitle(tab, 'Blocked');
      setStatus(tab, 'Blocked by allowlist.');
      return;
    }

    if (pushHistory) {
      tab.history.splice(tab.historyPos + 1);
      tab.history.push(target);
      tab.historyPos = tab.history.length - 1;
    }

    tab.view.innerHTML = '';
    // <webview> in Electron can render sites that refuse framing; the web build
    // only has <iframe>, which most real sites will decline.
    const frame = document.createElement(hasWebview() ? 'webview' : 'iframe');
    frame.setAttribute('src', target);
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-forms allow-presentation');
    // A webview drops every pop-up without this. With it, the main process's
    // window-open handler sees the request, refuses the window, and hands an
    // allowlisted URL back here as a new tab.
    if (hasWebview()) frame.setAttribute('allowpopups', '');
    // Not 'no-referrer': YouTube validates embeds against the referring origin
    // and answers "Error 153" when it is absent. This sends the origin only —
    // never the path or query — which satisfies the player without leaking
    // what the learner was looking at.
    frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    frame.style.cssText = 'width:100%;height:100%;border:none;background:#fff;';
    tab.view.appendChild(frame);

    const host = new URL(target).hostname;
    setTitle(tab, host);
    setStatus(tab, `Loading ${host}…`);

    if (hasWebview()) {
      frame.addEventListener('did-finish-load', () => setStatus(tab, `Loaded ${host}`));
      frame.addEventListener('page-title-updated', (e) => setTitle(tab, (e as Event & { title?: string }).title ?? host));
      // Sign-in redirects move the page on its own; keep the address bar honest.
      frame.addEventListener('did-navigate', (e) => {
        const url = (e as Event & { url?: string }).url;
        if (url) {
          tab.url = url;
          if (tab === active) urlBar.value = url;
        }
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
      setStatus(tab, `Loaded ${host}`);
    });
    window.setTimeout(() => {
      if (settled || !tab.view.contains(frame)) return;
      showRefused(tab, host, target);
    }, 2500);
  }

  /** Navigate the active tab. */
  function go(raw: string, pushHistory = true): void {
    if (active) load(active, raw, pushHistory);
  }

  /** Open a URL in a new tab and switch to it. */
  function newTab(url: string): void {
    if (tabs.length >= MAX_TABS) {
      if (active) setStatus(active, `At most ${MAX_TABS} tabs — close one first.`);
      return;
    }
    const tab = createTab();
    activate(tab);
    load(tab, url);
  }

  goBtn.addEventListener('click', () => go(urlBar.value));
  urlBar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go(urlBar.value);
  });
  backBtn.addEventListener('click', () => {
    if (active && active.historyPos > 0) go(active.history[--active.historyPos]!, false);
  });
  fwdBtn.addEventListener('click', () => {
    if (active && active.historyPos < active.history.length - 1) go(active.history[++active.historyPos]!, false);
  });
  homeBtn.addEventListener('click', () => go(BROWSER_HOME));
  reloadBtn.addEventListener('click', () => {
    if (active && active.historyPos >= 0) go(active.history[active.historyPos]!, false);
  });
  newTabBtn.addEventListener('click', () => {
    newTab(BROWSER_HOME);
    urlBar.select();
  });

  // Ctrl+T / Ctrl+W / Ctrl+Tab while the browser window has focus.
  root.tabIndex = -1;
  root.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 't') {
      e.preventDefault();
      newTab(BROWSER_HOME);
      urlBar.select();
    } else if (k === 'w') {
      e.preventDefault();
      if (active) closeTab(active);
    } else if (e.key === 'Tab' && active && tabs.length > 1) {
      e.preventDefault();
      const i = tabs.indexOf(active);
      activate(tabs[(i + (e.shiftKey ? tabs.length - 1 : 1)) % tabs.length]!);
    }
  });

  // Another window (the 90-Day Challenge) can ask for a page: it opens in a
  // new tab so whatever the learner had open stays put. The subscriptions
  // remove themselves once this window is gone.
  const unsubscribe = onBrowserOpen((url) => {
    if (!root.isConnected) {
      unsubscribe();
      return;
    }
    takePendingBrowserUrl();
    newTab(url);
  });
  // A page's pop-up (window.open, target=_blank) becomes a tab, still subject
  // to the allowlist in load().
  const unsubscribePopups = onPopupRequest((url) => {
    if (!root.isConnected) {
      unsubscribePopups();
      return;
    }
    newTab(url);
  });

  // The browser opens on the page it was asked for, or its home page.
  newTab(takePendingBrowserUrl() ?? BROWSER_HOME);
}
