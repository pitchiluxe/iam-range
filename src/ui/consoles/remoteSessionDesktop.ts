/**
 * ui/consoles/remoteSessionDesktop.ts — the desktop a Remote Desktop session
 * lands on.
 *
 * Signing in over RDP puts you on a Windows desktop, not a list of tiles: the
 * wallpaper, the icons that account's profile gives it, a taskbar with Start,
 * the tray and the clock. Drawing that is the point — "what does their desktop
 * actually have" is the diagnostic question (config/desktopProfiles.ts), and
 * the answer should look like the machine the user sits at.
 *
 * Deliberately light-mode Windows 11 whatever the operator's theme is, so the
 * nested session never reads as the operator's own desktop.
 *
 * Every app is the real one: the catalog carries the workstation's own
 * renderers, so Calculator, Settings, the Ticket Queue and the rest behave in
 * the session exactly as they do on the main desktop. Which apps appear is the
 * remote account's department profile, never the operator's. Settings shows
 * the remote account; the department portal shortcut runs an SSO sign-in as
 * that account.
 */
import type { VmServices } from '@/vm/session';
import type { AppId, Application, Ticket, User, UserId } from '@/domain';
import { ENDPOINT_TICKET_KINDS } from '@/domain';
import { ticketStore } from '@/stores';
import { login } from '@/vm/loginSession';
import { onEndpointChanged } from '@/util/endpointEvents';
import { renderDrivesPanel } from './endpointApps';
import { appsForDepartment } from '@/config/desktopProfiles';
import { VM_HOST } from '@/config/vmHost';
import { paintAvatar } from '@/util/profilePictures';

/** What a hosted app is told about the session it is running in. */
export interface RemoteAppContext {
  /** The account signed in to the remote session. */
  user: User;
  /** The remote computer's name. */
  host: string;
  /** Set when that computer is a managed end-user computer (help-desk work). */
  endpoint?: string;
  /** Close this app's window inside the session. */
  close(): void;
  /** Minimize this app's window inside the session. */
  minimize(): void;
  /** Maximize (true) or restore (false) this app's window inside the session. */
  setMaximized(on: boolean): void;
}

/** One launchable app, as the workstation's own desktop defines it. */
export interface RemoteAppEntry {
  id: string;
  title: string;
  /** An emoji, or trusted icon markup from desktopOverlay's app table. */
  icon: string;
  width?: number;
  height?: number;
  /** The same renderer the workstation's own window uses. */
  render?: (body: HTMLElement, ctx: RemoteAppContext) => void;
  /** For things that are not windows (Screen Pen), run instead of opening one. */
  launch?: () => void;
}

/** How the session ended. Disconnect leaves the IdP session alive, exactly as
 *  closing an RDP window does; Sign out ends it. */
export type SessionEnd = 'disconnect' | 'signout';

export interface RemoteSessionOptions {
  services: VmServices;
  user: User;
  host: string;
  ip: string;
  catalog: readonly RemoteAppEntry[];
  /** Set when `host` is a managed end-user computer: apps act on it, and the
   *  session shows that computer's help-desk tickets. */
  endpoint?: string;
  /** Who connected, e.g. OMARI\admin, when that is not the desktop's owner. */
  operator?: string;
  onEnd(how: SessionEnd): void;
  /** The hosting window's controls, for the connection bar. */
  onMinimize?(): void;
  onFullscreen?(on: boolean): void;
  isFullscreen?(): boolean;
}

/** Department -> the line-of-business app that department's desktop has a
 *  shortcut to. Departments with no dedicated portal reach everything through
 *  App Portal, same as a real employee would. */
const DEPT_APP_NAME: Record<string, string> = {
  Finance: 'Finance Portal',
  HR: 'HR Portal',
};

const THIS_PC: RemoteAppEntry = { id: 'this-pc', title: 'This PC', icon: '💻' };
const PORTAL_PREFIX = 'portal:';
/** Apps pinned to the taskbar, left to right, when the profile has them. */
const TASKBAR_PINS = ['explorer', 'browser', 'app-portal'];

const TASKBAR_H = 48;
/** The remote desktop's resolution: a common laptop panel. Smaller windows
 *  draw it scaled down; larger ones draw it 1:1. */
const VIRTUAL_W = 1366;
const VIRTUAL_H = 768;

// ── Icons ────────────────────────────────────────────────────────────────────
const SVG_START =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' +
  '<rect x="2" y="2" width="9.6" height="9.6" rx="1.2" fill="#0a74d6"/>' +
  '<rect x="12.4" y="2" width="9.6" height="9.6" rx="1.2" fill="#1d97f0"/>' +
  '<rect x="2" y="12.4" width="9.6" height="9.6" rx="1.2" fill="#0a64c2"/>' +
  '<rect x="12.4" y="12.4" width="9.6" height="9.6" rx="1.2" fill="#0a84e0"/></svg>';
const SVG_SEARCH =
  '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="#1b1b1b" stroke-width="1.8" aria-hidden="true">' +
  '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21" stroke-linecap="round"/></svg>';
const SVG_TASKVIEW =
  '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="#1b1b1b" stroke-width="1.6" aria-hidden="true">' +
  '<rect x="3" y="6" width="12" height="12" rx="2"/><path d="M18 8.5h1a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-1"/></svg>';
const SVG_CHEVRON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#1b1b1b" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M6 15l6-6 6 6"/></svg>';
const SVG_WIFI =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#1b1b1b" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M5.5 12.5a9.5 9.5 0 0 1 13 0"/><path d="M8.7 16a5 5 0 0 1 6.6 0"/>' +
  '<circle cx="12" cy="19.3" r="1" fill="#1b1b1b" stroke="none"/></svg>';
const SVG_VOLUME =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#1b1b1b" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18.5 6.5a8 8 0 0 1 0 11"/></svg>';
const SVG_POWER =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#1b1b1b" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M12 3v9"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/></svg>';
const SVG_MIN =
  '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5.5h10" stroke="currentColor"/></svg>';
const SVG_MAX =
  '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" rx="1" fill="none" stroke="currentColor"/></svg>';
const SVG_RESTORE =
  '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="2.5" width="7" height="7" rx="1" fill="none" stroke="currentColor"/><path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" fill="none" stroke="currentColor"/></svg>';
const SVG_CLOSE =
  '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor"/></svg>';

/** Windows 11's "Bloom", approximated in gradients so nothing is fetched. */
const WALLPAPER =
  'radial-gradient(30% 42% at 56% 56%, rgba(255,255,255,0.9) 0%, rgba(175,215,255,0.6) 35%, rgba(60,140,235,0) 75%),' +
  'radial-gradient(48% 62% at 52% 60%, #3d8ff0 0%, #1d66d9 38%, rgba(18,80,200,0) 76%),' +
  'radial-gradient(60% 80% at 26% 96%, rgba(10,58,168,0.7) 0%, rgba(10,58,168,0) 70%),' +
  'radial-gradient(50% 70% at 86% 20%, rgba(120,180,245,0.7) 0%, rgba(120,180,245,0) 70%),' +
  'linear-gradient(160deg, #d3e6f8 0%, #a8cbf0 34%, #78ade8 62%, #4a8adb 100%)';

const STYLE = `
.rds-root { position:relative; flex:1; min-height:0; overflow:hidden; user-select:none;
  font-family:'Segoe UI Variable','Segoe UI',-apple-system,BlinkMacSystemFont,sans-serif;
  color:#1b1b1b; font-size:12px; }
.rds-root button { font-family:inherit; }
.rds-icon { position:relative; width:74px; height:72px; padding:3px 1px 2px; box-sizing:border-box;
  border:1px solid transparent; border-radius:2px; background:transparent; display:flex; flex-direction:column;
  align-items:center; justify-content:flex-start; gap:3px; cursor:default; color:#fff; }
.rds-icon:hover { background:rgba(255,255,255,0.16); border-color:rgba(255,255,255,0.22); }
.rds-icon.sel { background:rgba(255,255,255,0.3); border-color:rgba(255,255,255,0.5); }
.rds-icon-glyph { font-size:30px; line-height:1; height:32px; display:flex; align-items:center;
  filter:drop-shadow(0 1px 2px rgba(0,0,0,0.35)); }
.rds-icon-label { font-size:11px; line-height:1.2; text-align:center; max-width:70px; overflow:hidden;
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; text-shadow:0 1px 2px rgba(0,0,0,0.8); }
.rds-tb-btn { position:relative; width:40px; height:40px; border:none; border-radius:4px; background:transparent;
  display:flex; align-items:center; justify-content:center; font-size:20px; line-height:1; cursor:default; color:#1b1b1b; }
.rds-tb-btn:hover { background:rgba(0,0,0,0.055); }
.rds-tb-btn:active > * { transform:scale(0.9); }
.rds-tb-btn.open { background:rgba(0,0,0,0.04); }
.rds-tb-btn.running::after { content:''; position:absolute; bottom:2px; left:50%; transform:translateX(-50%);
  width:6px; height:3px; border-radius:2px; background:#858585; transition:width .15s; }
.rds-tb-btn.active { background:rgba(0,0,0,0.055); }
.rds-tb-btn.active::after { width:16px; background:#005fb8; }
.rds-tray-btn { height:40px; border:none; border-radius:4px; background:transparent; display:flex; align-items:center;
  gap:8px; padding:0 8px; cursor:default; color:#1b1b1b; }
.rds-tray-btn:hover { background:rgba(0,0,0,0.055); }
.rds-sm-app { border:none; background:transparent; border-radius:4px; padding:10px 2px 8px; display:flex;
  flex-direction:column; align-items:center; gap:7px; cursor:default; color:#1b1b1b; }
.rds-sm-app:hover { background:rgba(255,255,255,0.7); }
.rds-sm-app span:first-child { font-size:26px; line-height:1; }
.rds-sm-app span:last-child { font-size:11.5px; max-width:84px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rds-pill { border:1px solid rgba(0,0,0,0.08); background:rgba(255,255,255,0.7); border-radius:4px; padding:3px 10px;
  font-size:11.5px; cursor:default; color:#1b1b1b; }
.rds-pill:hover { background:#fff; }
.rds-menu { position:absolute; z-index:20000; min-width:180px; padding:4px; background:rgba(249,249,249,0.97);
  border:1px solid rgba(0,0,0,0.1); border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,0.2); }
.rds-menu button { display:flex; align-items:center; gap:10px; width:100%; border:none; background:transparent;
  padding:7px 12px; border-radius:4px; text-align:left; font-size:12px; color:#1b1b1b; cursor:default; }
.rds-menu button:hover { background:rgba(0,0,0,0.055); }
.rds-win { position:absolute; display:flex; flex-direction:column; background:#fff; border:1px solid rgba(0,0,0,0.14);
  border-radius:8px; box-shadow:0 12px 34px rgba(0,0,0,0.28); overflow:hidden; min-width:320px; min-height:200px;
  resize:both; }
/* The hosted app body fills its window, whatever stylesheet the host page has. */
.rds-win > .apex-window-body { flex:1 1 auto; min-height:0; overflow:auto; }
.rds-win.inactive { box-shadow:0 6px 18px rgba(0,0,0,0.18); }
.rds-win.max { border-radius:0; border:none; }
.rds-titlebar { height:32px; flex-shrink:0; display:flex; align-items:center; background:#f3f3f3; }
.rds-win.inactive .rds-titlebar { color:#777; }
.rds-winctl { width:46px; height:32px; border:none; background:transparent; display:flex; align-items:center;
  justify-content:center; color:#1b1b1b; cursor:default; }
.rds-winctl:hover { background:rgba(0,0,0,0.06); }
.rds-winctl.close:hover { background:#c42b1c; color:#fff; }
.rds-row { display:flex; justify-content:space-between; gap:16px; padding:7px 0; border-bottom:1px solid #ececec; }
.rds-row span:first-child { color:#5f5f5f; }
.rds-row span:last-child { text-align:right; word-break:break-word; }
.rds-card { background:#fbfbfb; border:1px solid #e5e5e5; border-radius:6px; padding:4px 14px; }
.rds-link { border:none; background:transparent; color:#005fb8; cursor:pointer; padding:0; font-size:12px; }
.rds-primary { border:none; background:#005fb8; color:#fff; border-radius:4px; padding:6px 16px; font-size:12px; cursor:default; }
.rds-primary:hover { background:#1a6fc0; }
.rds-nav { border:none; background:transparent; text-align:left; padding:7px 10px; border-radius:4px; font-size:12px;
  color:#1b1b1b; cursor:default; display:flex; gap:10px; align-items:center; width:100%; }
.rds-nav:hover { background:rgba(0,0,0,0.04); }
.rds-nav.on { background:rgba(0,0,0,0.055); font-weight:600; }
.rds-tile { border:1px solid #e5e5e5; background:#fff; border-radius:6px; padding:14px 8px; display:flex;
  flex-direction:column; align-items:center; gap:8px; cursor:pointer; color:#1b1b1b; font-size:11.5px; }
.rds-tile:hover { border-color:#005fb8; background:#f5f9fd; }
@keyframes rds-spin { to { transform:rotate(360deg); } }
`;

/**
 * Draw the signed-in session into `root`. The caller replaces root's contents
 * to leave the session; the clock stops itself once root is detached.
 */
export function renderRemoteSession(root: HTMLElement, opts: RemoteSessionOptions): void {
  const { services, host, ip } = opts;
  const endpointName = opts.endpoint;
  const liveUser = (): User => services.dir.getUser(opts.user.id) ?? opts.user;
  const user = liveUser();

  const el = (tag: string, css: string, text?: string): HTMLElement => {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  // ── What this account's desktop contains ──────────────────────────────────
  const byId = new Map(opts.catalog.map((a) => [a.id, a]));
  const allowed = appsForDepartment(user.department)
    .map((id) => byId.get(id))
    .filter((a): a is RemoteAppEntry => a !== undefined);

  const deptAppName = DEPT_APP_NAME[user.department];
  const deptApp = deptAppName
    ? services.apps.apps().find((a: Application) => a.name === deptAppName)
    : undefined;
  const deptShortcut: RemoteAppEntry | null = deptApp
    ? { id: `${PORTAL_PREFIX}${deptApp.id}`, title: deptApp.name, icon: '🏢' }
    : null;

  const recycle = allowed.find((a) => a.id === 'recycle-bin');
  const desktopIcons: RemoteAppEntry[] = [
    THIS_PC,
    ...(recycle ? [recycle] : []),
    ...(deptShortcut ? [deptShortcut] : []),
    ...allowed.filter((a) => a.id !== 'recycle-bin'),
  ];
  const startApps: RemoteAppEntry[] = [
    ...(deptShortcut ? [deptShortcut] : []),
    ...allowed.filter((a) => a.id !== 'recycle-bin'),
    THIS_PC,
  ];
  const lookup = new Map(desktopIcons.map((a) => [a.id, a]));
  const pins = TASKBAR_PINS.map((id) => lookup.get(id)).filter(
    (a): a is RemoteAppEntry => a !== undefined,
  );

  /** Icon markup drawn for white (desktop) or light (taskbar, Start) grounds.
   *  Markup icons are drawn in white for the dark operator desktop, so on a
   *  light surface they sit on a dark chip to stay visible. */
  const iconHtml = (entry: RemoteAppEntry, onLight: boolean): string =>
    onLight && entry.icon.includes('<')
      ? `<span style="display:inline-flex;align-items:center;justify-content:center;background:#1f1f1f;border-radius:0.2em;padding:0.1em 0.12em;">${entry.icon}</span>`
      : entry.icon;

  // ── Frame ─────────────────────────────────────────────────────────────────
  root.innerHTML = '';
  const style = document.createElement('style');
  style.textContent = STYLE;
  root.appendChild(style);

  const shell = el(
    'div',
    `background:${WALLPAPER};position:absolute;left:0;top:0;flex:none;transform-origin:0 0;`,
  );
  shell.className = 'rds-root';
  shell.tabIndex = 0;
  root.style.position = 'relative';
  root.style.overflow = 'hidden';
  root.appendChild(shell);

  // Smart sizing, as mstsc does it: the remote machine has a real desktop
  // resolution, drawn scaled into however large the window is. Without it a
  // 1024px window showed apps at the size they have on a full monitor, so the
  // session looked zoomed in. Full screen on a large display is 1:1.
  let scale = 1;
  const fit = (): void => {
    const w = root.clientWidth;
    const h = root.clientHeight;
    if (!w || !h) return;
    scale = Math.min(1, w / VIRTUAL_W, h / VIRTUAL_H);
    shell.style.width = `${w / scale}px`;
    shell.style.height = `${h / scale}px`;
    shell.style.transform = scale === 1 ? '' : `scale(${scale})`;
  };
  const resizeWatch = new ResizeObserver(() => {
    if (!shell.isConnected) resizeWatch.disconnect();
    else fit();
  });
  resizeWatch.observe(root);
  fit();
  /** Screen (client) coordinates -> coordinates inside the scaled session. */
  const toLocal = (clientX: number, clientY: number): { x: number; y: number } => {
    const r = shell.getBoundingClientRect();
    return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
  };

  const desktop = el('div', `position:absolute;left:0;top:0;right:0;bottom:${TASKBAR_H}px;`);
  shell.appendChild(desktop);

  const iconGrid = el(
    'div',
    // Windows' own desktop grid: one fixed cell per icon, filled top to
    // bottom and then the next column, with no gutter between cells.
    'position:absolute;top:4px;left:2px;bottom:2px;display:grid;grid-auto-flow:column;' +
      'grid-template-rows:repeat(auto-fill,74px);grid-auto-columns:76px;gap:0;' +
      'align-content:start;justify-items:center;',
  );
  desktop.appendChild(iconGrid);

  const winLayer = el('div', 'position:absolute;inset:0;pointer-events:none;');
  desktop.appendChild(winLayer);

  // ── Desktop icons ─────────────────────────────────────────────────────────
  function renderIcons(): void {
    iconGrid.innerHTML = '';
    for (const entry of desktopIcons) {
      const b = document.createElement('button');
      b.className = 'rds-icon';
      b.title = entry.title;
      b.innerHTML = `<span class="rds-icon-glyph">${iconHtml(entry, false)}</span><span class="rds-icon-label"></span>`;
      (b.lastElementChild as HTMLElement).textContent = entry.title;
      if (entry.id.startsWith(PORTAL_PREFIX)) {
        // The little shortcut arrow Windows draws on a .lnk.
        b.appendChild(
          el(
            'span',
            'position:absolute;left:20px;top:22px;width:13px;height:13px;background:#fff;border:1px solid #999;' +
              'border-radius:2px;font-size:9px;line-height:11px;color:#0a64c2;text-align:center;',
            '↗',
          ),
        );
      }
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        closePopups();
        iconGrid.querySelectorAll('.rds-icon.sel').forEach((n) => n.classList.remove('sel'));
        b.classList.add('sel');
        b.focus();
      });
      b.addEventListener('dblclick', () => openApp(entry));
      b.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') openApp(entry);
      });
      iconGrid.appendChild(b);
    }
  }

  desktop.addEventListener('click', (e) => {
    if (e.target !== desktop && e.target !== iconGrid) return;
    iconGrid.querySelectorAll('.rds-icon.sel').forEach((n) => n.classList.remove('sel'));
    closePopups();
  });
  desktop.addEventListener('contextmenu', (e) => {
    if (e.target !== desktop && e.target !== iconGrid) return;
    e.preventDefault();
    showMenu(e.clientX, e.clientY, [
      ['🔄', 'Refresh', renderIcons],
      ['🖥️', 'Display settings', () => openApp(settingsEntry())],
      ['🎨', 'Personalize', () => openApp(settingsEntry())],
    ]);
  });

  const settingsEntry = (): RemoteAppEntry =>
    lookup.get('settings') ?? { id: 'settings', title: 'Settings', icon: '⚙️' };

  // ── Windows inside the session ────────────────────────────────────────────
  interface Win {
    entry: RemoteAppEntry;
    el: HTMLElement;
    minimized: boolean;
    maximized: boolean;
  }
  const wins = new Map<string, Win>();
  let zTop = 10;
  let activeId: string | null = null;

  function openApp(entry: RemoteAppEntry): void {
    closePopups();
    if (entry.launch) {
      entry.launch();
      return;
    }
    const existing = wins.get(entry.id);
    if (existing) {
      existing.minimized = false;
      existing.el.style.display = 'flex';
      focusWin(entry.id);
      return;
    }

    const size: [number, number] =
      entry.width && entry.height ? [entry.width, entry.height] : (WINDOW_SIZES[entry.id] ?? [560, 400]);
    const area = { width: desktop.clientWidth, height: desktop.clientHeight };
    const w = Math.min(size[0], Math.max(320, area.width - 40));
    const h = Math.min(size[1], Math.max(200, area.height - 30));
    const offset = (wins.size % 6) * 26;
    const left = Math.max(0, Math.round((area.width - w) / 2) - 60 + offset);
    const top = Math.max(0, Math.round((area.height - h) / 2) - 40 + offset);

    const winEl = el('div', `left:${left}px;top:${top}px;width:${w}px;height:${h}px;pointer-events:auto;`);
    winEl.className = 'rds-win';

    const bar = el('div', '');
    bar.className = 'rds-titlebar';
    const title = el('div', 'flex:1;display:flex;align-items:center;gap:8px;padding-left:10px;min-width:0;');
    const glyph = el('span', 'font-size:14px;line-height:1;');
    glyph.innerHTML = iconHtml(entry, true);
    title.append(
      glyph,
      el('span', 'font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;', entry.title),
    );
    const ctl = (svg: string, cls: string, label: string, fn: () => void): HTMLElement => {
      const b = document.createElement('button');
      b.className = `rds-winctl ${cls}`;
      b.title = label;
      b.innerHTML = svg;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
      return b;
    };
    bar.append(
      title,
      ctl(SVG_MIN, '', 'Minimize', () => minimizeWin(entry.id)),
      ctl(SVG_MAX, '', 'Maximize', () => toggleMax(entry.id)),
      ctl(SVG_CLOSE, 'close', 'Close', () => closeWin(entry.id)),
    );
    bar.addEventListener('dblclick', () => toggleMax(entry.id));
    enableDrag(bar, winEl, entry.id);

    // The workstation's own window body: same class, so the shared app chrome
    // (appChrome.ts) styles the hosted app exactly as it does on the desktop.
    const body = el(
      'div',
      entry.render
        ? 'background:var(--panel);color:var(--fg);font-size:14px;user-select:text;'
        : 'flex:1;min-height:0;overflow:auto;background:#fff;user-select:text;',
    );
    if (entry.render) body.className = 'apex-window-body';
    winEl.append(bar, body);
    winEl.addEventListener('pointerdown', () => focusWin(entry.id));
    winLayer.appendChild(winEl);

    wins.set(entry.id, { entry, el: winEl, minimized: false, maximized: false });
    renderAppBody(entry, body);
    focusWin(entry.id);
  }

  // Apps that close themselves (the terminal's `exit`) raise a bubbling event
  // from their own body. Answer it here, for this session's window.
  winLayer.addEventListener('apex-close-window', (e) => {
    const id = (e as CustomEvent<{ id?: string }>).detail?.id;
    if (!id) return;
    e.stopPropagation();
    closeWin(id);
  });

  function focusWin(id: string): void {
    const w = wins.get(id);
    if (!w) return;
    activeId = id;
    w.el.style.zIndex = String(++zTop);
    for (const [otherId, other] of wins) other.el.classList.toggle('inactive', otherId !== id);
    renderTaskbarApps();
  }

  function minimizeWin(id: string): void {
    const w = wins.get(id);
    if (!w) return;
    w.minimized = true;
    w.el.style.display = 'none';
    if (activeId === id) activeId = null;
    renderTaskbarApps();
  }

  function toggleMax(id: string): void {
    const w = wins.get(id);
    if (!w) return;
    w.maximized = !w.maximized;
    w.el.classList.toggle('max', w.maximized);
    if (w.maximized) {
      w.el.dataset['restore'] = [w.el.style.left, w.el.style.top, w.el.style.width, w.el.style.height].join('|');
      Object.assign(w.el.style, { left: '0', top: '0', width: '100%', height: '100%' });
    } else {
      const [l, t, wd, ht] = (w.el.dataset['restore'] ?? '').split('|');
      Object.assign(w.el.style, { left: l, top: t, width: wd, height: ht });
    }
  }

  function closeWin(id: string): void {
    const w = wins.get(id);
    if (!w) return;
    w.el.remove();
    wins.delete(id);
    if (activeId === id) activeId = null;
    renderTaskbarApps();
  }

  function enableDrag(handle: HTMLElement, winEl: HTMLElement, id: string): void {
    handle.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button') || wins.get(id)?.maximized) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const startL = winEl.offsetLeft;
      const startT = winEl.offsetTop;
      const area = { width: desktop.clientWidth, height: desktop.clientHeight };
      handle.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent): void => {
        // Pointer travel is in screen pixels; the session is scaled.
        const dx = (ev.clientX - startX) / scale;
        const dy = (ev.clientY - startY) / scale;
        // Keep the title bar reachable, as Windows does.
        const l = Math.min(area.width - 80, Math.max(80 - winEl.offsetWidth, startL + dx));
        const t = Math.min(area.height - 32, Math.max(0, startT + dy));
        winEl.style.left = `${l}px`;
        winEl.style.top = `${t}px`;
      };
      const up = (ev: PointerEvent): void => {
        move(ev);
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  // ── Taskbar ───────────────────────────────────────────────────────────────
  const taskbar = el(
    'div',
    `position:absolute;left:0;right:0;bottom:0;height:${TASKBAR_H}px;display:grid;` +
      'grid-template-columns:1fr auto 1fr;align-items:center;z-index:10000;' +
      'background:rgba(238,242,247,0.86);backdrop-filter:blur(30px) saturate(170%);' +
      '-webkit-backdrop-filter:blur(30px) saturate(170%);border-top:1px solid rgba(0,0,0,0.08);',
  );
  shell.appendChild(taskbar);
  taskbar.appendChild(el('div', ''));

  const center = el('div', 'display:flex;align-items:center;gap:4px;');
  taskbar.appendChild(center);

  const startBtn = document.createElement('button');
  startBtn.className = 'rds-tb-btn';
  startBtn.title = 'Start';
  startBtn.innerHTML = SVG_START;
  startBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleStart();
  });

  const searchBtn = document.createElement('button');
  searchBtn.className = 'rds-tb-btn';
  searchBtn.title = 'Search';
  searchBtn.innerHTML = SVG_SEARCH;
  searchBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleStart(true);
  });

  const taskViewBtn = document.createElement('button');
  taskViewBtn.className = 'rds-tb-btn';
  taskViewBtn.title = 'Task view';
  taskViewBtn.innerHTML = SVG_TASKVIEW;
  taskViewBtn.addEventListener('click', () => {
    // Show desktop / bring everything back — the nearest honest equivalent.
    const anyVisible = [...wins.values()].some((w) => !w.minimized);
    for (const id of wins.keys()) {
      if (anyVisible) minimizeWin(id);
      else openApp(wins.get(id)!.entry);
    }
  });

  const appsStrip = el('div', 'display:flex;align-items:center;gap:4px;');
  center.append(startBtn, searchBtn, taskViewBtn, appsStrip);

  function renderTaskbarApps(): void {
    appsStrip.innerHTML = '';
    const shown = [...pins, ...[...wins.values()].map((w) => w.entry).filter((e) => !pins.includes(e))];
    for (const entry of shown) {
      const w = wins.get(entry.id);
      const b = document.createElement('button');
      b.className = 'rds-tb-btn';
      if (w) b.classList.add('running');
      if (w && !w.minimized && activeId === entry.id) b.classList.add('active');
      b.title = entry.title;
      b.innerHTML = `<span>${iconHtml(entry, true)}</span>`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        closePopups();
        if (!w) openApp(entry);
        else if (w.minimized || activeId !== entry.id) openApp(entry);
        else minimizeWin(entry.id);
      });
      appsStrip.appendChild(b);
    }
  }

  const tray = el('div', 'display:flex;align-items:center;justify-content:flex-end;gap:2px;height:100%;');
  taskbar.appendChild(tray);

  const chevron = document.createElement('button');
  chevron.className = 'rds-tray-btn';
  chevron.title = 'Show hidden icons';
  chevron.style.padding = '0 6px';
  chevron.innerHTML = SVG_CHEVRON;

  const quick = document.createElement('button');
  quick.className = 'rds-tray-btn';
  // On a managed computer the Wi-Fi icon tells the truth, the way the real
  // tray does: it is often the first clue on a network ticket.
  const paintNetwork = (): void => {
    const e = endpointName ? services.endpoints.get(endpointName) : undefined;
    let state = { title: `${VM_HOST.domain}\nInternet access`, badge: '' };
    if (e) {
      const n = e.network;
      state = !n.adapterEnabled
        ? { title: 'Wi-Fi is turned off', badge: '✕' }
        : !n.ssid
          ? { title: 'Not connected', badge: '✕' }
          : n.ipv4.startsWith('169.254.')
            ? { title: `${n.ssid}\nNo internet`, badge: '!' }
            : services.endpoints.onCorpNetwork(e)
              ? { title: `${n.ssid}\nInternet access`, badge: '' }
              : { title: `${n.ssid}\nLimited access`, badge: '!' };
    }
    quick.title = state.title;
    quick.innerHTML = SVG_WIFI + SVG_VOLUME;
    if (state.badge) {
      const b = el(
        'span',
        'position:absolute;margin-left:9px;margin-top:9px;width:9px;height:9px;border-radius:50%;background:#c42b1c;' +
          'color:#fff;font-size:7px;line-height:9px;text-align:center;font-weight:700;',
        state.badge,
      );
      quick.insertBefore(b, quick.children[1] ?? null);
    }
  };
  paintNetwork();
  if (endpointName) onEndpointChanged(quick, endpointName, paintNetwork);
  quick.addEventListener('click', (e) => {
    e.stopPropagation();
    const settings = lookup.get('settings');
    if (settings) openApp(settings);
  });

  // The ticket this session is for, beside the work rather than a window away.
  const ticketsBtn = document.createElement('button');
  ticketsBtn.className = 'rds-tray-btn';
  ticketsBtn.title = 'Tickets for this computer';
  ticketsBtn.style.cssText = 'position:relative;font-size:16px;';
  ticketsBtn.textContent = '🎫';
  ticketsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTicketPanel();
  });

  const clock = document.createElement('button');
  clock.className = 'rds-tray-btn';
  clock.style.cssText = 'flex-direction:column;align-items:flex-end;justify-content:center;gap:0;line-height:1.35;font-size:11.5px;';
  const tickClock = (): void => {
    const now = new Date();
    clock.innerHTML = '';
    clock.append(
      el('span', '', now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })),
      el('span', '', now.toLocaleDateString([], { month: 'numeric', day: 'numeric', year: 'numeric' })),
    );
    clock.title = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  };
  tickClock();
  const clockTimer = window.setInterval(() => {
    if (!shell.isConnected) window.clearInterval(clockTimer);
    else tickClock();
  }, 10_000);

  // The sliver at the far right that shows the desktop.
  const showDesktop = el('div', 'width:8px;height:100%;margin-left:6px;border-left:1px solid rgba(0,0,0,0.12);');
  showDesktop.title = 'Show desktop';
  showDesktop.addEventListener('click', () => {
    for (const id of wins.keys()) minimizeWin(id);
  });
  tray.append(chevron, ticketsBtn, quick, clock, showDesktop);

  // ── RDP connection bar ────────────────────────────────────────────────────
  const connBar = el(
    'div',
    'position:absolute;top:0;left:50%;transform:translateX(-50%);z-index:30000;height:24px;' +
      'display:flex;align-items:center;gap:10px;padding:0 4px 0 10px;border-radius:0 0 6px 6px;' +
      'background:rgba(34,58,96,0.94);color:#fff;font-size:11.5px;box-shadow:0 2px 8px rgba(0,0,0,0.3);',
  );
  connBar.append(
    el('span', 'opacity:0.8;', '📌'),
    el(
      'span',
      'font-weight:600;letter-spacing:0.02em;',
      opts.operator ? `${host}  ·  ${ip}  ·  as ${opts.operator}` : `${ip}  ·  ${host}`,
    ),
  );
  // Minimize, full screen / restore, disconnect — mstsc's connection bar, the
  // one set of controls still reachable when the session covers the screen.
  const connBtn = (svg: string, title: string, hover: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.title = title;
    b.innerHTML = svg;
    b.style.cssText =
      'width:28px;height:20px;border:none;border-radius:4px;background:transparent;color:#fff;display:flex;' +
      'align-items:center;justify-content:center;cursor:default;';
    b.addEventListener('mouseenter', () => (b.style.background = hover));
    b.addEventListener('mouseleave', () => (b.style.background = 'transparent'));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
    });
    return b;
  };
  const fsTitle = (): string => (opts.isFullscreen?.() ? 'Restore down' : 'Full screen');
  const fsIcon = (): string => (opts.isFullscreen?.() ? SVG_RESTORE : SVG_MAX);
  if (opts.onMinimize) {
    connBar.appendChild(connBtn(SVG_MIN, 'Minimize', 'rgba(255,255,255,0.18)', opts.onMinimize));
  }
  if (opts.onFullscreen) {
    const onFs = opts.onFullscreen;
    const fsBtn = connBtn(fsIcon(), fsTitle(), 'rgba(255,255,255,0.18)', () => {
      onFs(!opts.isFullscreen?.());
      fsBtn.innerHTML = fsIcon();
      fsBtn.title = fsTitle();
    });
    connBar.appendChild(fsBtn);
  }
  connBar.appendChild(
    connBtn(SVG_CLOSE, 'Disconnect (the session stays signed in)', '#c42b1c', () => opts.onEnd('disconnect')),
  );
  shell.appendChild(connBar);

  // ── Start menu ────────────────────────────────────────────────────────────
  const start = el(
    'div',
    `display:none;position:absolute;left:50%;bottom:${TASKBAR_H + 8}px;transform:translateX(-50%);` +
      'width:min(600px,calc(100% - 24px));height:min(620px,calc(100% - 76px));z-index:20000;' +
      'flex-direction:column;background:rgba(238,241,246,0.94);backdrop-filter:blur(40px) saturate(170%);' +
      '-webkit-backdrop-filter:blur(40px) saturate(170%);border:1px solid rgba(0,0,0,0.1);border-radius:8px;' +
      'box-shadow:0 16px 48px rgba(0,0,0,0.3);overflow:hidden;',
  );
  start.addEventListener('click', (e) => e.stopPropagation());
  shell.appendChild(start);

  const searchWrap = el('div', 'padding:22px 28px 6px;');
  const search = document.createElement('input');
  search.placeholder = 'Search for apps, settings, and documents';
  search.style.cssText =
    'width:100%;box-sizing:border-box;height:34px;border-radius:17px;border:1px solid rgba(0,0,0,0.08);' +
    'border-bottom:2px solid #005fb8;background:#fff;padding:0 16px;font-size:12px;outline:none;color:#1b1b1b;';
  searchWrap.appendChild(search);
  start.appendChild(searchWrap);

  const startBody = el('div', 'flex:1;min-height:0;overflow-y:auto;padding:10px 28px 12px;');
  start.appendChild(startBody);
  let showAllApps = false;

  function renderStartBody(): void {
    startBody.innerHTML = '';
    const q = search.value.trim().toLowerCase();

    if (q) {
      const hits = startApps.filter((a) => a.title.toLowerCase().includes(q));
      startBody.appendChild(el('div', 'font-weight:600;font-size:13px;margin:6px 0 10px;', 'Best matches'));
      if (hits.length === 0) {
        startBody.appendChild(el('div', 'color:#5f5f5f;padding:8px 0;', `No results for "${search.value}"`));
      }
      for (const a of hits) startBody.appendChild(listRow(a));
      return;
    }

    const head = el('div', 'display:flex;align-items:center;justify-content:space-between;margin:6px 0 8px;');
    head.appendChild(el('div', 'font-weight:600;font-size:13px;', showAllApps ? 'All apps' : 'Pinned'));
    const toggle = document.createElement('button');
    toggle.className = 'rds-pill';
    toggle.textContent = showAllApps ? '‹  Back' : 'All apps  ›';
    toggle.addEventListener('click', () => {
      showAllApps = !showAllApps;
      renderStartBody();
    });
    head.appendChild(toggle);
    startBody.appendChild(head);

    if (showAllApps) {
      let letter = '';
      for (const a of [...startApps].sort((x, y) => x.title.localeCompare(y.title))) {
        const first = a.title.charAt(0).toUpperCase();
        if (first !== letter) {
          letter = first;
          startBody.appendChild(el('div', 'font-size:12px;font-weight:600;color:#005fb8;padding:10px 8px 4px;', letter));
        }
        startBody.appendChild(listRow(a));
      }
      return;
    }

    const grid = el('div', 'display:grid;grid-template-columns:repeat(6,1fr);gap:4px;');
    for (const a of startApps.slice(0, 18)) {
      const b = document.createElement('button');
      b.className = 'rds-sm-app';
      b.title = a.title;
      b.innerHTML = `<span>${iconHtml(a, true)}</span><span></span>`;
      (b.lastElementChild as HTMLElement).textContent = a.title;
      b.addEventListener('click', () => openApp(a));
      grid.appendChild(b);
    }
    startBody.appendChild(grid);

    startBody.appendChild(el('div', 'font-weight:600;font-size:13px;margin:18px 0 8px;', 'Recommended'));
    const rec = el('div', 'display:grid;grid-template-columns:1fr 1fr;gap:4px;');
    const u = liveUser();
    const recItem = (icon: string, titleText: string, sub: string, entry: RemoteAppEntry): HTMLElement => {
      const b = document.createElement('button');
      b.className = 'rds-nav';
      b.style.padding = '8px 10px';
      b.append(
        el('span', 'font-size:22px;', icon),
        (() => {
          const col = el('span', 'display:flex;flex-direction:column;min-width:0;');
          col.append(
            el('span', 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;', titleText),
            el('span', 'font-size:11px;color:#5f5f5f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;', sub),
          );
          return col;
        })(),
      );
      b.addEventListener('click', () => openApp(entry));
      return b;
    };
    rec.append(
      recItem('✨', 'Get Started', 'Welcome to Windows', THIS_PC),
      recItem('👤', 'Your account', u.email || `${u.username}@${VM_HOST.domain}`, settingsEntry()),
    );
    startBody.appendChild(rec);
  }

  function listRow(a: RemoteAppEntry): HTMLElement {
    const b = document.createElement('button');
    b.className = 'rds-nav';
    b.innerHTML = `<span style="font-size:20px;width:26px;text-align:center;">${iconHtml(a, true)}</span><span></span>`;
    (b.lastElementChild as HTMLElement).textContent = a.title;
    b.addEventListener('click', () => openApp(a));
    return b;
  }

  search.addEventListener('input', renderStartBody);
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = search.value.trim().toLowerCase();
    const hit = q && startApps.find((a) => a.title.toLowerCase().includes(q));
    if (hit) openApp(hit);
  });

  const footer = el(
    'div',
    'flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:10px 40px;' +
      'background:rgba(0,0,0,0.035);border-top:1px solid rgba(0,0,0,0.07);',
  );
  const who = document.createElement('button');
  who.className = 'rds-nav';
  who.style.width = 'auto';
  who.title = 'Account settings';
  const avatar = el(
    'span',
    'width:32px;height:32px;border-radius:50%;background:#6b7c93;color:#fff;display:flex;align-items:center;' +
      'justify-content:center;font-size:14px;font-weight:600;flex-shrink:0;',
  );
  paintAvatar(avatar, user.username, user.displayName);
  who.append(avatar, el('span', '', user.displayName || user.username));
  who.addEventListener('click', () => openApp(settingsEntry()));

  const power = document.createElement('button');
  power.className = 'rds-tb-btn';
  power.title = 'Power';
  power.innerHTML = SVG_POWER;
  power.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = power.getBoundingClientRect();
    const at = toLocal(r.left, r.top);
    showMenu(at.x - 120, at.y - 88, [
      ['🔌', 'Disconnect', () => opts.onEnd('disconnect')],
      ['↩️', 'Sign out', signOut],
    ], true);
  });
  footer.append(who, power);
  start.appendChild(footer);

  /** Windows' "Signing out" screen, then the session actually ends. */
  function signOut(): void {
    closePopups();
    const overlay = el(
      'div',
      'position:absolute;inset:0;z-index:40000;display:flex;flex-direction:column;align-items:center;' +
        'justify-content:center;gap:22px;background:#0b5cad;color:#fff;',
    );
    overlay.append(
      el(
        'div',
        'width:34px;height:34px;border-radius:50%;border:3px solid rgba(255,255,255,0.25);' +
          'border-top-color:#fff;animation:rds-spin 0.9s linear infinite;',
      ),
      el('div', 'font-size:22px;font-weight:300;', 'Signing out'),
    );
    shell.appendChild(overlay);
    window.setTimeout(() => {
      if (shell.isConnected) opts.onEnd('signout');
    }, 1200);
  }

  function toggleStart(focusSearch = false): void {
    const opening = start.style.display !== 'flex' || focusSearch;
    closePopups();
    if (!opening) return;
    search.value = '';
    showAllApps = false;
    renderStartBody();
    start.style.display = 'flex';
    startBtn.classList.add('open');
    search.focus();
  }

  // ── Ticket panel ──────────────────────────────────────────────────────────
  // The tickets for this computer and its user, with work notes, docked beside
  // the desktop so the technician is not flipping back to the queue. Resolving
  // stays on the Ticket Queue: it runs the review, and that belongs on the
  // operator's own desktop, after the session.
  let ticketPanel: HTMLElement | null = null;
  const noteDrafts = new Map<string, string>();

  function relevantTickets(): Ticket[] {
    const kinds: readonly string[] = ENDPOINT_TICKET_KINDS;
    return services.tickets.list().filter((t) => {
      if (t.status === 'resolved') return false;
      const computer = kinds.includes(t.kind) ? (t.payload as { computer?: string }).computer : undefined;
      return computer?.toUpperCase() === host.toUpperCase() || t.relatedUserIds.includes(user.id);
    });
  }

  function paintTicketBadge(): void {
    const n = relevantTickets().length;
    ticketsBtn.querySelector('.rds-badge')?.remove();
    if (n > 0) {
      const b = el(
        'span',
        'position:absolute;top:5px;right:2px;min-width:14px;height:14px;padding:0 3px;border-radius:7px;background:#c42b1c;' +
          'color:#fff;font-size:9px;line-height:14px;text-align:center;font-weight:700;box-sizing:border-box;',
        String(n),
      );
      b.className = 'rds-badge';
      ticketsBtn.appendChild(b);
    }
  }

  function toggleTicketPanel(): void {
    if (ticketPanel) {
      ticketPanel.remove();
      ticketPanel = null;
      return;
    }
    closePopups();
    ticketPanel = el(
      'div',
      `position:absolute;top:0;right:0;bottom:${TASKBAR_H}px;width:min(380px,100%);z-index:25000;` +
        'background:#f9f9f9;border-left:1px solid rgba(0,0,0,0.12);box-shadow:-8px 0 24px rgba(0,0,0,0.15);' +
        'display:flex;flex-direction:column;user-select:text;color-scheme:light;color:#1b1b1b;',
    );
    ticketPanel.addEventListener('click', (e) => e.stopPropagation());
    shell.appendChild(ticketPanel);
    paintTicketPanel();
  }

  function paintTicketPanel(): void {
    const panel = ticketPanel;
    if (!panel) return;
    panel.innerHTML = '';
    const head = el('div', 'display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #e5e5e5;background:#fff;');
    head.append(el('div', 'font-size:18px;', '🎫'), el('div', 'flex:1;font-size:14px;font-weight:600;', `Tickets — ${host}`));
    const close = document.createElement('button');
    close.className = 'rds-winctl close';
    close.style.cssText = 'width:32px;height:28px;border-radius:4px;';
    close.innerHTML = SVG_CLOSE;
    close.title = 'Close';
    close.addEventListener('click', () => toggleTicketPanel());
    head.appendChild(close);
    panel.appendChild(head);

    const list = el('div', 'flex:1;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:12px;');
    panel.appendChild(list);
    const tickets = relevantTickets();
    if (tickets.length === 0) {
      list.appendChild(el('div', 'color:#5f5f5f;line-height:1.6;', `No open tickets for ${host} or ${user.username}.`));
    }
    for (const t of tickets) {
      const c = el('div', 'background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:8px;');
      const meta = el('div', 'display:flex;justify-content:space-between;gap:8px;font-size:11px;color:#5f5f5f;');
      meta.append(el('span', '', `${t.kind} · ${t.priority}`), el('span', '', new Date(t.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })));
      c.append(meta, el('div', 'font-weight:600;font-size:13px;', t.subject), el('div', 'color:#333;line-height:1.55;white-space:pre-wrap;', t.body));

      if (t.comments.length > 0) {
        const notes = el('div', 'display:flex;flex-direction:column;gap:6px;border-top:1px solid #eee;padding-top:8px;');
        notes.appendChild(el('div', 'font-size:11px;font-weight:600;color:#5f5f5f;', 'Work notes'));
        for (const n of t.comments) {
          const who = services.dir.getUser(n.authorId)?.username ?? 'you';
          const row = el('div', 'font-size:11.5px;line-height:1.5;');
          row.append(el('span', 'color:#5f5f5f;', `${who} · ${new Date(n.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} — `), document.createTextNode(n.body));
          notes.appendChild(row);
        }
        c.appendChild(notes);
      }

      const draft = document.createElement('textarea');
      draft.rows = 3;
      draft.placeholder = 'Work note: the symptom, the cause you found, what you changed…';
      draft.value = noteDrafts.get(t.id) ?? '';
      draft.style.cssText = 'width:100%;box-sizing:border-box;resize:vertical;border:1px solid #d0d0d0;border-radius:4px;padding:6px 8px;font-family:inherit;font-size:12px;color:#1b1b1b;';
      draft.addEventListener('input', () => noteDrafts.set(t.id, draft.value));
      const save = document.createElement('button');
      save.className = 'rds-primary';
      save.textContent = 'Add work note';
      save.style.alignSelf = 'flex-start';
      save.addEventListener('click', () => {
        const by = (login.user?.id ?? 'system') as UserId;
        if (!services.tickets.addWorkNote(t.id, by, draft.value)) return;
        noteDrafts.delete(t.id);
        ticketStore.getState().setTickets(services.tickets.list());
        paintTicketPanel();
      });
      c.append(draft, save);
      list.appendChild(c);
    }

    panel.appendChild(
      el(
        'div',
        'padding:10px 14px;border-top:1px solid #e5e5e5;background:#fff;color:#5f5f5f;font-size:11px;line-height:1.5;',
        'Resolve tickets from the Ticket Queue on your own desktop. The review checks this computer and your work note.',
      ),
    );
  }

  paintTicketBadge();

  // ── Popups ────────────────────────────────────────────────────────────────
  let menuEl: HTMLElement | null = null;

  /** A small light context menu. Coordinates are client coordinates unless
   *  `local` says they are already relative to the session. */
  function showMenu(
    x: number,
    y: number,
    items: Array<[string, string, () => void]>,
    local = false,
  ): void {
    menuEl?.remove();
    const s = { width: shell.clientWidth, height: shell.clientHeight };
    const m = el('div', '');
    m.className = 'rds-menu';
    for (const [icon, label, fn] of items) {
      const b = document.createElement('button');
      b.append(el('span', 'width:18px;text-align:center;', icon), el('span', '', label));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        closePopups();
        fn();
      });
      m.appendChild(b);
    }
    shell.appendChild(m);
    const p = local ? { x, y } : toLocal(x, y);
    const lx = p.x;
    const ly = p.y;
    m.style.left = `${Math.max(4, Math.min(lx, s.width - m.offsetWidth - 4))}px`;
    m.style.top = `${Math.max(4, Math.min(ly, s.height - m.offsetHeight - 4))}px`;
    menuEl = m;
  }

  function closePopups(): void {
    start.style.display = 'none';
    startBtn.classList.remove('open');
    menuEl?.remove();
    menuEl = null;
  }

  shell.addEventListener('click', closePopups);
  shell.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePopups();
  });

  // ── App bodies ────────────────────────────────────────────────────────────
  function renderAppBody(entry: RemoteAppEntry, body: HTMLElement): void {
    if (entry.id.startsWith(PORTAL_PREFIX)) {
      renderSsoAttempt(body, entry.id.slice(PORTAL_PREFIX.length) as AppId, null);
      return;
    }
    if (entry.id === THIS_PC.id) {
      renderThisPc(body);
      return;
    }
    if (entry.render) {
      entry.render(body, {
        user: liveUser(),
        host,
        ...(endpointName ? { endpoint: endpointName } : {}),
        close: () => closeWin(entry.id),
        minimize: () => minimizeWin(entry.id),
        setMaximized: (on) => {
          if (Boolean(wins.get(entry.id)?.maximized) !== on) toggleMax(entry.id);
        },
      });
      return;
    }
    renderInstalled(body, entry);
  }

  function accountRows(u: User): Array<[string, string]> {
    const groupNames = u.groupIds.map((gid) => services.dir.getGroup(gid)?.name ?? gid).join(', ') || '—';
    return [
      ['Username', u.username],
      ['Display name', u.displayName],
      ['Department', u.department],
      ['Title', u.title],
      ['Status', u.status],
      ['MFA', u.mfa],
      ['Groups', groupNames],
      ['Password change required', u.mustChangePassword ? 'yes' : 'no'],
      ['Last sign-in', u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleString() : 'never'],
    ];
  }

  function rowsCard(rows: Array<[string, string]>): HTMLElement {
    const card = el('div', '');
    card.className = 'rds-card';
    rows.forEach(([k, v], i) => {
      const row = el('div', i === rows.length - 1 ? 'border-bottom:none;' : '');
      row.className = 'rds-row';
      row.append(el('span', '', k), el('span', '', v));
      card.appendChild(row);
    });
    return card;
  }

  function renderThisPc(body: HTMLElement): void {
    const u = liveUser();
    const wrap = el('div', 'padding:18px 22px;display:flex;flex-direction:column;gap:14px;color-scheme:light;');
    const head = el('div', 'display:flex;align-items:center;gap:14px;');
    head.append(el('div', 'font-size:40px;', '💻'));
    const names = el('div', '');
    names.append(
      el('div', 'font-size:18px;font-weight:600;', host),
      el('div', 'color:#5f5f5f;', VM_HOST.edition),
    );
    head.appendChild(names);
    wrap.appendChild(head);

    wrap.appendChild(
      rowsCard([
        ['Device name', host],
        ['Full computer name', `${host}.${VM_HOST.domain}`],
        ['Domain', VM_HOST.domain],
        ['IP address', ip],
        ['Signed in as', `${VM_HOST.netbiosDomain}\\${u.username}`],
        ['Connection', 'Remote Desktop (RDP)'],
      ]),
    );

    wrap.appendChild(el('div', 'font-weight:600;margin-top:4px;', 'Signed-in account'));
    wrap.appendChild(rowsCard(accountRows(u)));

    wrap.appendChild(el('div', 'font-weight:600;margin-top:4px;', 'Devices and drives'));
    const disk = endpointName ? services.endpoints.get(endpointName)?.disk : undefined;
    const total = disk?.totalGb ?? 237;
    const free = disk?.freeGb ?? 146;
    const drive = el('div', 'display:flex;align-items:center;gap:12px;');
    const meter = el('div', 'flex:1;');
    const barOuter = el('div', 'height:12px;background:#e6e6e6;border:1px solid #d0d0d0;margin:4px 0;');
    const low = free < 10;
    barOuter.appendChild(
      el('div', `height:100%;width:${Math.round(((total - free) / total) * 100)}%;background:${low ? '#da3b01' : '#26a0da'};`),
    );
    meter.append(
      el('div', '', 'Local Disk (C:)'),
      barOuter,
      el('div', `color:${low ? '#da3b01' : '#5f5f5f'};font-size:11px;`, `${free.toFixed(1)} GB free of ${total} GB`),
    );
    drive.append(el('div', 'font-size:30px;', '🖴'), meter);
    wrap.appendChild(drive);

    if (endpointName) {
      // The user's mapped drives, and Map network drive, as This PC offers.
      renderDrivesPanel(wrap, { services, computer: endpointName });
    }
    body.appendChild(wrap);
  }

  /** The real verification: an SSO sign-in to `appId` as the remote user. */
  function renderSsoAttempt(body: HTMLElement, appId: AppId, back: (() => void) | null): void {
    const u = liveUser();
    const wrap = el('div', 'padding:18px 22px;display:flex;flex-direction:column;gap:12px;');
    if (back) {
      const b = document.createElement('button');
      b.className = 'rds-link';
      b.textContent = '← My Apps';
      b.style.alignSelf = 'flex-start';
      b.addEventListener('click', back);
      wrap.appendChild(b);
    }
    const app = services.apps.getApp(appId);
    if (!app) {
      wrap.appendChild(el('div', 'color:#c42b1c;', 'That application is no longer registered.'));
      body.appendChild(wrap);
      return;
    }
    const result = services.apps.ssoLogin(app.id, u.id);
    const card = el('div', 'border-radius:6px;padding:16px;line-height:1.6;border:1px solid;');
    if (result.ok) {
      card.style.cssText += 'background:#eff8f1;border-color:#b7dfc1;';
      card.append(
        el('div', 'font-size:15px;font-weight:600;color:#0f5132;', `✔ Signed in to ${app.name}`),
        el('div', 'color:#3d5a45;', `as ${u.username} via ${app.protocol.toUpperCase()}`),
      );
    } else {
      card.style.cssText += 'background:#fdf1f0;border-color:#f1c2bd;';
      card.append(
        el('div', 'font-size:15px;font-weight:600;color:#a4262c;', `✖ Sign-in to ${app.name} failed`),
        el('div', 'color:#5f2b27;', result.reason),
      );
    }
    wrap.appendChild(card);
    const retry = document.createElement('button');
    retry.className = 'rds-primary';
    retry.textContent = 'Try again';
    retry.style.alignSelf = 'flex-start';
    retry.addEventListener('click', () => {
      body.innerHTML = '';
      renderSsoAttempt(body, appId, back);
    });
    wrap.appendChild(retry);
    body.appendChild(wrap);
  }

  function renderInstalled(body: HTMLElement, entry: RemoteAppEntry): void {
    const u = liveUser();
    const wrap = el('div', 'height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;text-align:center;box-sizing:border-box;');
    const icon = el('div', 'font-size:44px;line-height:1;');
    icon.innerHTML = iconHtml(entry, true);
    wrap.append(
      icon,
      el('div', 'font-size:15px;font-weight:600;', entry.title),
      el('div', 'color:#5f5f5f;max-width:380px;line-height:1.55;', `Installed for ${u.username} by the ${u.department} desktop profile.`),
      el(
        'div',
        'color:#5f5f5f;max-width:380px;line-height:1.55;font-size:11.5px;',
        'This remote session is for verifying the account — its sign-in, its apps and its access. Do the work itself from your own desktop.',
      ),
    );
    body.appendChild(wrap);
  }

  // ── Welcome, then the desktop ─────────────────────────────────────────────
  renderIcons();
  renderTaskbarApps();

  const welcome = el(
    'div',
    'position:absolute;inset:0;z-index:40000;display:flex;flex-direction:column;align-items:center;' +
      'justify-content:center;gap:22px;background:#0b5cad;color:#fff;transition:opacity .35s;',
  );
  const spinner = el(
    'div',
    'width:34px;height:34px;border-radius:50%;border:3px solid rgba(255,255,255,0.25);border-top-color:#fff;' +
      'animation:rds-spin 0.9s linear infinite;',
  );
  const welcomeAvatar = el(
    'div',
    'width:96px;height:96px;border-radius:50%;background:rgba(255,255,255,0.18);display:flex;align-items:center;' +
      'justify-content:center;font-size:40px;font-weight:300;',
  );
  paintAvatar(welcomeAvatar, user.username, user.displayName);
  welcome.append(
    welcomeAvatar,
    el('div', 'font-size:14px;font-weight:600;', user.displayName || user.username),
    spinner,
    el('div', 'font-size:22px;font-weight:300;', 'Welcome'),
  );
  shell.appendChild(welcome);
  window.setTimeout(() => {
    welcome.style.opacity = '0';
    window.setTimeout(() => welcome.remove(), 380);
  }, 1100);
  shell.focus();
}

/** Default window sizes per app, before being fitted to the session. */
const WINDOW_SIZES: Record<string, [number, number]> = {
  'this-pc': [560, 460],
  settings: [760, 520],
  'app-portal': [640, 440],
  explorer: [680, 420],
  notepad: [520, 380],
  'recycle-bin': [460, 320],
};
