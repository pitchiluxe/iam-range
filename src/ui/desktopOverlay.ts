/**
 * ui/desktopOverlay.ts — Windowed desktop OS overlay.
 *
 * Appears when the learner clicks the 3D workstation mesh. Provides a full
 * corporate OS shell (dark theme, taskbar, Start menu, system tray, live clock)
 * with multiple draggable/minimizable/maximizable/closable windows.
 */
import { appsForDepartment } from '@/config/desktopProfiles';
import type { VmServices } from '@/vm/session';
import { renderActiveDirectoryWindow } from './consoles/activeDirectoryWindow';
import { renderTicketConsole } from './consoles/ticketConsole';
import { renderSecOpsDashboard } from './consoles/secOpsDashboard';
import { renderNotepadWindow } from './consoles/notepadWindow';
import { renderCalculatorWindow } from './consoles/calculatorWindow';
import { renderStickyNotesWindow } from './consoles/stickyNotesWindow';
import { renderFileExplorerWindow } from './consoles/fileExplorerWindow';
import { renderAppPortalWindow } from './consoles/appPortalWindow';
import { renderWebBrowserWindow } from './consoles/webBrowserWindow';
import { renderTerminalWindow } from './consoles/terminalWindow';
import { renderScriptEditorWindow } from './consoles/scriptEditorWindow';
import { renderSettingsWindow } from './consoles/settingsWindow';
import { renderControlPanelWindow } from './consoles/controlPanelWindow';
import { renderRecycleBinWindow } from './consoles/recycleBinWindow';
import {
  getIconOrder,
  saveIconOrder,
  getDeletedIcons,
  deleteIcon,
  onDesktopIconsChanged,
} from '@/util/desktopIcons';
import { WALLPAPER_BY_ID, DEFAULT_WALLPAPER_ID, WALLPAPER_STORAGE_KEY } from '@/util/wallpapers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WindowDef {
  id: string;
  title: string;
  icon: string;
  width: number;
  height: number;
  render(conductor: VmServices, body: HTMLElement): void;
}

export interface DesktopOverlay {
  /**
   * @param department Department of the signed-in user. Decides which
   *   applications the desktop contains — see config/desktopProfiles.ts.
   *   Omitted means "everything", which is only right before sign-in.
   */
  show(conductor: VmServices, department?: string): void;
  hide(): void;
  isVisible(): boolean;
  openWindow(id: string, conductor: VmServices): void;
  /** Called whenever the desktop is closed (Exit button or ESC). */
  onExit: (() => void) | null;
}

const DESKTOP_APPS: WindowDef[] = [
  {
    id: 'active-directory',
    title: 'Active Directory Users and Computers',
    icon: '🗄️',
    width: 940,
    height: 620,
    render: (c, b) => renderActiveDirectoryWindow(b, c),
  },
  {
    id: 'ticket-console',
    title: 'Ticket Queue',
    icon: '🎫',
    width: 680,
    height: 560,
    render: (c, b) => renderTicketConsole(b, c),
  },
  {
    id: 'secops-dashboard',
    title: 'SecOps Dashboard',
    icon: '🛡️',
    width: 740,
    height: 600,
    render: (c, b) => renderSecOpsDashboard(b, c),
  },
  {
    id: 'notepad',
    title: 'Notepad',
    icon: '📝',
    width: 560,
    height: 480,
    render: (_c, b) => renderNotepadWindow(b),
  },
  {
    id: 'calculator',
    title: 'Calculator',
    icon: '🧮',
    width: 300,
    height: 420,
    render: (_c, b) => renderCalculatorWindow(b),
  },
  {
    id: 'sticky-notes',
    title: 'Sticky Notes',
    icon: '📌',
    width: 480,
    height: 400,
    render: (_c, b) => renderStickyNotesWindow(b),
  },
  {
    id: 'explorer',
    title: 'File Explorer',
    icon: '📁',
    width: 700,
    height: 500,
    render: (_c, b) => renderFileExplorerWindow(b),
  },
  {
    id: 'terminal',
    title: 'Terminal',
    // Icon markup rather than an emoji: a bordered `>_` reads as a console at
    // a glance. Sized in `em` so it scales with each render site's font-size —
    // 32px on the desktop grid, 20px in the Start menu, 16px in the taskbar
    // and title bar — instead of needing a special case in any of them.
    icon:
      '<span style="display:inline-flex;align-items:center;justify-content:center;' +
      'border:0.07em solid #fff;border-radius:0.16em;padding:0 0.16em 0.04em;' +
      "font-family:Consolas,'Cascadia Mono',Menlo,monospace;font-weight:700;" +
      'font-size:0.62em;line-height:1.3;color:#fff;">&gt;_</span>',
    width: 760,
    height: 520,
    render: (c, b) => renderTerminalWindow(b, c),
  },
  {
    // Not a browser: a mock SSO application launcher (the "MyApps" page an end
    // user lands on after signing in). The globe belongs to the real browser.
    id: 'app-portal',
    title: 'App Portal',
    icon: '🗂️',
    width: 800,
    height: 600,
    render: (c, b) => renderAppPortalWindow(b, c),
  },
  {
    id: 'script-editor',
    title: 'PowerShell ISE',
    icon: '📜',
    width: 900,
    height: 640,
    render: (c, b) => renderScriptEditorWindow(b, c),
  },
  {
    id: 'browser',
    title: 'Browser',
    icon: '🌐',
    width: 900,
    height: 640,
    render: (_c, b) => renderWebBrowserWindow(b),
  },
  {
    id: 'settings',
    title: 'Settings',
    icon: '⚙️',
    width: 640,
    height: 520,
    render: (_c, b) => renderSettingsWindow(b),
  },
  {
    id: 'control-panel',
    title: 'Control Panel',
    icon: '🎛️',
    width: 680,
    height: 520,
    render: (_c, b) => renderControlPanelWindow(b),
  },
  {
    id: 'recycle-bin',
    title: 'Recycle Bin',
    icon: '🗑️',
    width: 480,
    height: 440,
    render: (_c, b) => renderRecycleBinWindow(b),
  },
];

const APP_BY_ID: Record<string, WindowDef> = Object.fromEntries(DESKTOP_APPS.map((a) => [a.id, a]));

/** Windows whose render() actually reads conductor state (users/groups/lab
 * progress/audit log) — these need a forced refresh on VM re-entry so they
 * don't keep showing data from before a lab reset. Notepad, Sticky Notes,
 * File Explorer, Settings, Control Panel, Recycle Bin and the Web Browser
 * ignore their conductor param entirely, so refreshing them would only risk
 * clobbering in-progress local state (e.g. an unsaved Notepad draft) for no
 * benefit. */
const CONDUCTOR_BACKED_WINDOW_IDS = new Set([
  'active-directory',
  'app-portal',
  'script-editor',
  // Rebuilt on VM re-entry so the shell binds to the current lab's services.
  // (Its scrollback is lost on that rebuild, which is the right trade: a shell
  // pointing at a stale directory would silently act on the wrong data.)
  'terminal',
  'ticket-console',
  'secops-dashboard',
]);

/** Apps only an IT workstation has installed — hidden from the desktop
 * icons, Start menu, and default layout on a non-IT zone's "computer". */
/** Applications the signed-in user's department is entitled to. Replaced on
 *  every show(); an empty set would mean "nothing", so it starts as null and
 *  every app is allowed until a profile says otherwise. */
let allowedAppIds: Set<string> | null = null;

const appAllowed = (id: string): boolean => allowedAppIds === null || allowedAppIds.has(id);

// ---------------------------------------------------------------------------
// WindowManager
// ---------------------------------------------------------------------------

interface WinState {
  id: string;
  el: HTMLElement;
  body: HTMLElement;
  minimized: boolean;
  maximized: boolean;
  preMax: DOMRect | null;
}

class WindowManager {
  readonly conductor: VmServices;
  readonly desktop: HTMLElement;
  readonly windows: Map<string, WinState> = new Map();
  zIndex = 200;

  constructor(conductor: VmServices, desktop: HTMLElement) {
    this.conductor = conductor;
    this.desktop = desktop;
    // Windows that can close themselves (the shell's `exit`) ask via an event
    // rather than reaching into the DOM, so the manager stays the single owner
    // of window lifecycle.
    document.addEventListener('apex-close-window', (e) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (id) this.close(id);
    });
  }

  openById(id: string): void {
    const def = APP_BY_ID[id];
    if (def) this.open(def);
  }

  open(def: WindowDef): void {
    if (this.windows.has(def.id)) {
      this.focus(def.id);
      return;
    }
    const win = this.createWindowElement(def);
    this.desktop.appendChild(win.el);
    this.windows.set(def.id, win);
    this.focus(def.id);
    def.render(this.conductor, win.body);
    this.updateTaskbar();
  }

  close(id: string): void {
    const w = this.windows.get(id);
    if (!w) return;
    w.el.remove();
    this.windows.delete(id);
    this.updateTaskbar();
  }

  minimize(id: string): void {
    const w = this.windows.get(id);
    if (!w) return;
    w.el.style.display = 'none';
    w.minimized = true;
    this.updateTaskbar();
  }

  restore(id: string): void {
    const w = this.windows.get(id);
    if (!w) return;
    w.el.style.display = 'flex';
    w.minimized = false;
    this.focus(id);
    this.updateTaskbar();
  }

  toggleMaximize(id: string): void {
    const w = this.windows.get(id);
    if (!w) return;
    if (!w.maximized) {
      w.preMax = w.el.getBoundingClientRect();
      w.el.style.left = '0';
      w.el.style.top = '0';
      w.el.style.width = '100%';
      w.el.style.height = 'calc(100% - 48px)';
      w.maximized = true;
    } else {
      if (w.preMax) {
        w.el.style.left = `${w.preMax.left}px`;
        w.el.style.top = `${w.preMax.top}px`;
        w.el.style.width = `${w.preMax.width}px`;
        w.el.style.height = `${w.preMax.height}px`;
      }
      w.maximized = false;
    }
  }

  focus(id: string): void {
    const w = this.windows.get(id);
    if (!w) return;
    w.el.style.zIndex = String(++this.zIndex);
    this.updateTaskbar();
  }

  getMinimizedIds(): string[] {
    return [...this.windows.values()].filter((w) => w.minimized).map((w) => w.id);
  }

  getOpenIds(): string[] {
    return [...this.windows.keys()];
  }

  /** Re-run a window's render() against the current conductor state — used
   * when re-entering the VM so already-open conductor-backed windows (IAM
   * Console, Objectives, etc.) don't keep showing stale data from before a
   * lab reset/switch instead of being duplicated as brand-new windows. */
  refresh(id: string): void {
    const w = this.windows.get(id);
    const def = APP_BY_ID[id];
    if (!w || !def) return;
    def.render(this.conductor, w.body);
  }

  updateTaskbar(): void {
    const strip = document.getElementById('taskbar-apps');
    if (strip) strip.innerHTML = this.buildTaskbarHTML();
  }

  buildTaskbarHTML(): string {
    const open = this.getOpenIds();
    const minimized = this.getMinimizedIds();
    return DESKTOP_APPS.map((d) => {
      const isOpen = open.includes(d.id);
      const isMin = minimized.includes(d.id);
      if (!isOpen && !isMin) return '';
      const active = isOpen && !isMin ? 'taskbar-app--active' : '';
      const dataAttrs = `data-win="${d.id}" data-min="${isMin}"`;
      return `<button class="taskbar-app ${active}" ${dataAttrs} title="${d.title}">
          <span>${d.icon}</span>
          <span class="taskbar-app-label">${d.title}</span>
        </button>`;
    }).join('');
  }

  private createWindowElement(def: WindowDef): WinState {
    const el = document.createElement('div');
    el.className = 'apex-window';
    el.style.cssText = `
      position: fixed;
      display: flex;
      flex-direction: column;
      width: ${def.width}px;
      height: ${def.height}px;
      left: ${80 + Math.random() * 200}px;
      top: ${60 + Math.random() * 120}px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px 8px 4px 4px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04);
      overflow: hidden;
      resize: both;
    `;

    const titleBar = document.createElement('div');
    titleBar.className = 'apex-window-titlebar';
    titleBar.style.cssText = `
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 12px; background: #1b1f24; border-bottom: 1px solid #2d343d;
      cursor: move; user-select: none; flex-shrink: 0;
    `;

    const titleEl = document.createElement('div');
    titleEl.style.cssText =
      'display:flex;align-items:center;gap:8px;font-size:13px;color:#e6e6e6;font-weight:500;';
    titleEl.innerHTML = `<span>${def.icon}</span><span>${def.title}</span>`;
    titleBar.appendChild(titleEl);

    const lights = document.createElement('div');
    lights.style.cssText = 'display:flex;gap:6px;align-items:center;';
    const lightData = [
      { color: '#d7ba7d', action: 'minimize' as const },
      { color: '#4ec9b0', action: 'maximize' as const },
      { color: '#f48771', action: 'close' as const },
    ];
    for (const ld of lightData) {
      const btn = document.createElement('button');
      btn.style.cssText = `
        width: 12px; height: 12px; border-radius: 50%; border: none; cursor: pointer;
        background: ${ld.color}; opacity: 0.85;
        transition: opacity 0.15s;
      `;
      btn.title = ld.action;
      btn.addEventListener('click', () => {
        if (ld.action === 'close') this.close(def.id);
        else if (ld.action === 'minimize') this.minimize(def.id);
        else this.toggleMaximize(def.id);
      });
      btn.addEventListener('mouseenter', () => {
        btn.style.opacity = '1';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.opacity = '0.85';
      });
      lights.appendChild(btn);
    }
    titleBar.appendChild(lights);
    el.appendChild(titleBar);

    const body = document.createElement('div');
    body.style.cssText = 'flex: 1; overflow: auto; min-height: 0; background: #0e1116;';
    el.appendChild(body);

    // Dragging
    let dragging = false;
    let dx = 0,
      dy = 0;

    titleBar.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      dragging = true;
      const rect = el.getBoundingClientRect();
      dx = e.clientX - rect.left;
      dy = e.clientY - rect.top;
      this.focus(def.id);
    });

    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      const w = this.windows.get(def.id);
      if (!w || w.maximized) return;
      const maxX = window.innerWidth - 60;
      const maxY = window.innerHeight - 60;
      const x = Math.max(0, Math.min(maxX, e.clientX - dx));
      const y = Math.max(0, Math.min(maxY, e.clientY - dy));
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    };
    const onUp = () => {
      dragging = false;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);

    titleBar.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      this.toggleMaximize(def.id);
    });
    titleBar.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      this.focus(def.id);
    });

    return { id: def.id, el, body, minimized: false, maximized: false, preMax: null };
  }
}

// ---------------------------------------------------------------------------
// DesktopOverlay
// ---------------------------------------------------------------------------

export function createDesktopOverlay(): DesktopOverlay {
  const wmCtx = { current: null as WindowManager | null };
  let visible = false;
  let container: HTMLElement | null = null;
  let clockInterval: number | null = null;
  // Whether the current workstation is an IT one (full IAM/SecOps/Ticket
  // tooling) or a plain consumer PC — set on every show() call so exiting an
  // IT zone's VM and entering a non-IT one's swaps the app set correctly.
  let currentDepartment = 'IT';
  let iconColEl: HTMLElement | null = null;
  let renderStartMenuApps: (() => void) | null = null;

  function buildContainer(): HTMLElement {
    const c = document.createElement('div');
    c.id = 'desktop-overlay';
    c.style.cssText = `
      position: fixed; inset: 0; z-index: 90;
      background: rgba(6, 8, 12, 0.82);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      display: none; flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI Variable', 'Segoe UI', sans-serif;
      font-size: 14px; color: #e6e6e6;
    `;
    document.body.appendChild(c);
    return c;
  }

  function buildDesktop(c: HTMLElement): void {
    const bg = document.createElement('div');
    const savedWallpaperId = localStorage.getItem(WALLPAPER_STORAGE_KEY) ?? DEFAULT_WALLPAPER_ID;
    const savedWallpaper =
      WALLPAPER_BY_ID[savedWallpaperId] ?? WALLPAPER_BY_ID[DEFAULT_WALLPAPER_ID]!;
    bg.style.cssText = `
      position: absolute; inset: 0; bottom: 48px;
      background: ${savedWallpaper};
    `;
    document.addEventListener('apex-wallpaper-changed', (e) => {
      bg.style.background = (e as CustomEvent<string>).detail;
    });
    const grid = document.createElement('div');
    grid.style.cssText = `
      position: absolute; inset: 0;
      background-image:
        linear-gradient(rgba(78,201,176,0.04) 1px, transparent 1px),
        linear-gradient(90deg, rgba(78,201,176,0.04) 1px, transparent 1px);
      background-size: 40px 40px;
      pointer-events: none;
    `;
    bg.appendChild(grid);
    c.appendChild(bg);

    // Desktop icons — one per windowed app. Order persists via
    // util/desktopIcons.ts; dragging one onto the Recycle Bin deletes it.
    const iconCol = document.createElement('div');
    // Windows-style layout: fill each column top-to-bottom 6 icons deep,
    // then start a new column to the right, instead of one long strip.
    iconCol.style.cssText = `
      position: absolute; top: 20px; left: 16px;
      display: grid; grid-template-rows: repeat(6, auto); grid-auto-flow: column;
      gap: 8px; justify-items: center;
    `;
    bg.appendChild(iconCol);
    iconColEl = iconCol;
    renderDesktopIcons(iconCol);
    onDesktopIconsChanged(() => renderDesktopIcons(iconCol));
  }

  interface DesktopIconEntry {
    id: string;
    title: string;
    icon: string;
  }

  function allDesktopIconEntries(): DesktopIconEntry[] {
    return DESKTOP_APPS.filter((a) => appAllowed(a.id)).map(
      (a): DesktopIconEntry => ({ id: a.id, title: a.title, icon: a.icon }),
    );
  }

  /** Resolve the visible, ordered, non-deleted list of desktop icons. */
  function resolveIconOrder(): DesktopIconEntry[] {
    const all = allDesktopIconEntries();
    const byId = new Map(all.map((e) => [e.id, e]));
    const deletedIds = new Set(getDeletedIcons().map((d) => d.id));
    const savedOrder = getIconOrder();

    const orderedIds =
      savedOrder && savedOrder.length > 0
        ? [...savedOrder, ...all.map((e) => e.id).filter((id) => !savedOrder.includes(id))]
        : all.map((e) => e.id);

    return orderedIds
      .filter((id) => !deletedIds.has(id) && byId.has(id))
      .map((id) => byId.get(id)!);
  }

  function renderDesktopIcons(iconCol: HTMLElement): void {
    iconCol.innerHTML = '';
    const icons = resolveIconOrder();
    let draggedId: string | null = null;

    for (const entry of icons) {
      const iconBtn = document.createElement('button');
      iconBtn.draggable = true;
      iconBtn.dataset['iconId'] = entry.id;
      iconBtn.style.cssText = `
        background: transparent; border: none; cursor: pointer;
        display: flex; flex-direction: column; align-items: center; gap: 4px;
        padding: 8px; border-radius: 6px; width: 80px;
      `;
      iconBtn.innerHTML = `
        <span style="font-size:32px;line-height:1;">${entry.icon}</span>
        <span style="font-size:11px;color:#c8cdd3;text-align:center;max-width:72px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${entry.title}</span>
      `;
      const activate = () => {
        const def = APP_BY_ID[entry.id];
        if (def) wmCtx.current?.open(def);
      };
      iconBtn.title = `Open ${entry.title} (double-click) · drag to reorder or drop on Recycle Bin to remove`;
      iconBtn.addEventListener('dblclick', activate);
      iconBtn.addEventListener('click', activate);

      // --- Drag to reorder / drop-on-Recycle-Bin to delete ---
      iconBtn.addEventListener('dragstart', (e) => {
        draggedId = entry.id;
        iconBtn.style.opacity = '0.4';
        e.dataTransfer?.setData('text/plain', entry.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      iconBtn.addEventListener('dragend', () => {
        iconBtn.style.opacity = '1';
        draggedId = null;
      });
      iconBtn.addEventListener('dragover', (e) => {
        if (!draggedId || draggedId === entry.id) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        iconBtn.style.background = 'rgba(78,201,176,0.15)';
      });
      iconBtn.addEventListener('dragleave', () => {
        iconBtn.style.background = 'transparent';
      });
      iconBtn.addEventListener('drop', (e) => {
        e.preventDefault();
        iconBtn.style.background = 'transparent';
        const sourceId = e.dataTransfer?.getData('text/plain') || draggedId;
        if (!sourceId || sourceId === entry.id) return;

        if (entry.id === 'recycle-bin') {
          const source = allDesktopIconEntries().find((x) => x.id === sourceId);
          if (source && source.id !== 'recycle-bin') deleteIcon(source);
          return;
        }

        const currentOrder = resolveIconOrder().map((x) => x.id);
        const from = currentOrder.indexOf(sourceId);
        if (from === -1) return;
        currentOrder.splice(from, 1);
        const to = currentOrder.indexOf(entry.id);
        currentOrder.splice(to, 0, sourceId);
        saveIconOrder(currentOrder);
      });

      iconCol.appendChild(iconBtn);
    }
  }

  function buildTaskbar(c: HTMLElement, conductor: VmServices): void {
    const wm = new WindowManager(conductor, c);
    wmCtx.current = wm;

    const tb = document.createElement('div');
    tb.id = 'apex-taskbar';
    tb.style.cssText = `
      position: absolute; bottom: 0; left: 0; right: 0; height: 48px;
      background: rgba(27, 31, 36, 0.85);
      border-top: 1px solid #2d343d;
      backdrop-filter: blur(12px);
      display: flex; align-items: center; gap: 4px;
      padding: 0 8px; z-index: 50;
    `;

    const startBtn = document.createElement('button');
    startBtn.id = 'taskbar-start';
    startBtn.style.cssText = `
      height: 36px; padding: 0 14px; border-radius: 6px; border: none; cursor: pointer;
      background: #232830; color: #4ec9b0; font-size: 13px; font-weight: 600;
      display: flex; align-items: center; gap: 6px;
      transition: background 0.15s;
    `;
    startBtn.innerHTML = `<span style="font-size:16px;">⌂</span><span>Start</span>`;
    startBtn.addEventListener('mouseenter', () => {
      startBtn.style.background = '#2d343d';
    });
    startBtn.addEventListener('mouseleave', () => {
      startBtn.style.background = '#232830';
    });
    startBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleStartMenu();
    });
    tb.appendChild(startBtn);

    const sep = document.createElement('div');
    sep.style.cssText = 'width:1px;height:24px;background:#2d343d;margin:0 4px;';
    tb.appendChild(sep);

    const appsStrip = document.createElement('div');
    appsStrip.id = 'taskbar-apps';
    appsStrip.style.cssText = 'display:flex;gap:4px;flex:1;align-items:center;';
    tb.appendChild(appsStrip);

    const tray = document.createElement('div');
    tray.style.cssText = `
      display: flex; align-items: center; gap: 8px;
      padding: 0 10px; border-radius: 6px;
      background: #232830; height: 36px;
      font-size: 12px; color: #8b95a1;
    `;
    tray.innerHTML = `<span title="Connected" style="font-size:14px;">📶</span>`;
    const clock = document.createElement('button');
    clock.id = 'taskbar-clock';
    clock.title = 'Open calendar';
    clock.style.cssText = `
      font-variant-numeric: tabular-nums; background: transparent; border: none;
      color: inherit; font: inherit; cursor: pointer; padding: 2px 4px; border-radius: 4px;
    `;
    const updateClock = () => {
      const now = new Date();
      clock.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };
    updateClock();
    if (clockInterval) clearInterval(clockInterval);
    clockInterval = window.setInterval(updateClock, 10000);
    clock.addEventListener('mouseenter', () => {
      clock.style.background = '#2d343d';
    });
    clock.addEventListener('mouseleave', () => {
      clock.style.background = 'transparent';
    });
    clock.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCalendarWidget();
    });
    tray.appendChild(clock);

    const logoutBtn = document.createElement('button');
    logoutBtn.style.cssText = `
      margin-left: 4px; height: 32px; padding: 0 12px; border-radius: 4px;
      border: 1px solid #2d343d; background: transparent; color: #8b95a1;
      font-size: 12px; cursor: pointer; transition: all 0.15s;
    `;
    logoutBtn.textContent = '↩ Sign out';
    logoutBtn.title = 'Sign out and return to the lock screen';
    logoutBtn.addEventListener('mouseenter', () => {
      logoutBtn.style.background = '#2d343d';
      logoutBtn.style.color = '#e6e6e6';
    });
    logoutBtn.addEventListener('mouseleave', () => {
      logoutBtn.style.background = 'transparent';
      logoutBtn.style.color = '#8b95a1';
    });
    logoutBtn.addEventListener('click', () => {
      api.hide();
    });
    tray.appendChild(logoutBtn);

    tb.appendChild(tray);
    c.appendChild(tb);

    tb.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.taskbar-app') as HTMLElement | null;
      if (!btn || !wmCtx.current) return;
      const id = btn.dataset['win'] ?? '';
      const isMin = btn.dataset['min'] === 'true';
      if (isMin) wmCtx.current.restore(id);
      else wmCtx.current.focus(id);
    });

    buildStartMenu(c, conductor, wm);
    buildCalendarWidget(c);

    c.addEventListener('click', (e) => {
      const tgt = e.target as HTMLElement;
      if (!tgt.closest('#start-menu') && !tgt.closest('#taskbar-start')) {
        const sm = document.getElementById('start-menu');
        if (sm) sm.style.display = 'none';
      }
      if (!tgt.closest('#calendar-widget') && !tgt.closest('#taskbar-clock')) {
        const cal = document.getElementById('calendar-widget');
        if (cal) cal.style.display = 'none';
      }
    });
  }

  function toggleStartMenu(): void {
    const sm = document.getElementById('start-menu');
    if (sm) sm.style.display = sm.style.display === 'flex' ? 'none' : 'flex';
  }

  function toggleCalendarWidget(): void {
    const cal = document.getElementById('calendar-widget');
    if (cal) cal.style.display = cal.style.display === 'block' ? 'none' : 'block';
  }

  /** A small month-view calendar that pops up above the taskbar clock. */
  function buildCalendarWidget(c: HTMLElement): void {
    const cal = document.createElement('div');
    cal.id = 'calendar-widget';
    cal.style.cssText = `
      display: none; position: absolute; bottom: 52px; right: 8px;
      width: 260px; background: rgba(27, 31, 36, 0.97);
      border: 1px solid #2d343d; border-radius: 8px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.6);
      backdrop-filter: blur(12px);
      z-index: 100; padding: 14px; color: #e6e6e6; font-size: 12px;
    `;
    c.appendChild(cal);

    const MONTH_NAMES = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

    const renderCalendar = () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      const today = now.getDate();
      const firstDow = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();

      let cells = '';
      for (let i = 0; i < firstDow; i++) cells += '<div></div>';
      for (let d = 1; d <= daysInMonth; d++) {
        const isToday = d === today;
        cells += `<div style="text-align:center;padding:4px 0;border-radius:4px;font-size:11px;${
          isToday ? 'background:#4ec9b0;color:#0e1116;font-weight:700;' : 'color:#c8cdd3;'
        }">${d}</div>`;
      }

      cal.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;">
          <strong style="font-size:13px;">${MONTH_NAMES[month]} ${year}</strong>
          <span style="color:#8b95a1;font-size:11px;">${now.toLocaleDateString([], { weekday: 'long' })}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;font-size:10px;color:#8b95a1;margin-bottom:4px;">
          ${DOW.map((d) => `<div style="text-align:center;">${d}</div>`).join('')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;">${cells}</div>
      `;
    };

    renderCalendar();
    // Keep the highlighted day correct if the widget is left open across midnight.
    window.setInterval(renderCalendar, 60000);
  }

  function buildStartMenu(c: HTMLElement, conductor: VmServices, wm: WindowManager): void {
    const sm = document.createElement('div');
    sm.id = 'start-menu';
    sm.style.cssText = `
      display: none; position: absolute; bottom: 52px; left: 8px;
      width: 340px; background: rgba(27, 31, 36, 0.95);
      border: 1px solid #2d343d; border-radius: 8px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.6);
      backdrop-filter: blur(12px);
      z-index: 100; overflow: hidden;
      flex-direction: column;
    `;

    const header = document.createElement('div');
    header.style.cssText = 'padding: 16px 20px 12px; border-bottom: 1px solid #2d343d;';
    header.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:36px;height:36px;background:#4ec9b0;border-radius:8px;display:flex;align-items:center;justify-content:center;">
          <span style="font-size:20px;color:#0e1116;font-weight:bold;">A</span>
        </div>
        <div>
          <div style="font-size:14px;font-weight:600;color:#e6e6e6;">Apex Identity</div>
          <div id="sm-subtitle" style="font-size:11px;color:#8b95a1;">Workstation</div>
        </div>
      </div>
    `;
    sm.appendChild(header);

    const pinnedLabel = document.createElement('div');
    pinnedLabel.style.cssText = `
      padding: 10px 16px 6px;
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.08em; color: #8b95a1;
    `;
    pinnedLabel.textContent = 'Pinned';
    sm.appendChild(pinnedLabel);

    const appsGrid = document.createElement('div');
    appsGrid.style.cssText =
      'padding: 0 8px 8px; display: grid; grid-template-columns: 1fr 1fr; gap: 2px;';
    sm.appendChild(appsGrid);

    // Re-run whenever isIT changes (entering a different zone's VM) so the
    // pinned app list matches what that "computer" actually has installed.
    renderStartMenuApps = () => {
      const subtitle = header.querySelector('#sm-subtitle');
      if (subtitle)
        subtitle.textContent = `${currentDepartment} Workstation`;
      appsGrid.innerHTML = '';
      const apps = DESKTOP_APPS.filter((a) => appAllowed(a.id));
      for (const app of apps) {
        const appBtn = document.createElement('button');
        appBtn.style.cssText = `
          display: flex; align-items: center; gap: 10px;
          padding: 10px 12px; border-radius: 6px; border: none; cursor: pointer;
          background: transparent; color: #e6e6e6; font-size: 13px; text-align: left;
          transition: background 0.15s;
        `;
        appBtn.innerHTML = `<span style="font-size:20px;">${app.icon}</span><span>${app.title}</span>`;
        appBtn.addEventListener('mouseenter', () => {
          appBtn.style.background = '#232830';
        });
        appBtn.addEventListener('mouseleave', () => {
          appBtn.style.background = 'transparent';
        });
        appBtn.addEventListener('click', () => {
          wm.open(app);
          const sm2 = document.getElementById('start-menu');
          if (sm2) sm2.style.display = 'none';
        });
        appsGrid.appendChild(appBtn);
      }
    };
    renderStartMenuApps();

    // Windows 11 style: user account on the left, power button on the right
    const footer = document.createElement('div');
    footer.style.cssText = `
      padding: 10px 16px; border-top: 1px solid #2d343d;
      display: flex; align-items: center; justify-content: space-between;
    `;

    // User account pill (left side)
    const userPill = document.createElement('button');
    userPill.style.cssText = `
      display: flex; align-items: center; gap: 10px; padding: 6px 10px;
      border-radius: 6px; border: none; background: transparent; cursor: pointer;
      transition: background 0.15s; color: #e6e6e6; flex-shrink: 0;
    `;
    userPill.innerHTML = `
      <div style="width:28px;height:28px;background:#4ec9b0;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;color:#0e1116;font-weight:700;flex-shrink:0;">A</div>
      <div style="text-align:left;">
        <div style="font-size:12px;font-weight:500;">admin@northwind.local</div>
        <div style="font-size:10px;color:#8b95a1;">IAM Administrator</div>
      </div>
    `;
    userPill.addEventListener('mouseenter', () => {
      userPill.style.background = '#232830';
    });
    userPill.addEventListener('mouseleave', () => {
      userPill.style.background = 'transparent';
    });
    footer.appendChild(userPill);

    // Power button + dropdown (right side) — Windows 11 style
    const powerWrap = document.createElement('div');
    powerWrap.style.cssText = 'position:relative;';

    const powerBtn = document.createElement('button');
    powerBtn.title = 'Power';
    powerBtn.style.cssText = `
      width: 36px; height: 36px; border-radius: 6px; border: none;
      background: transparent; cursor: pointer; font-size: 18px;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.15s; color: #8b95a1;
    `;
    powerBtn.textContent = '⏻';
    powerBtn.addEventListener('mouseenter', () => {
      powerBtn.style.background = '#232830';
      powerBtn.style.color = '#e6e6e6';
    });
    powerBtn.addEventListener('mouseleave', () => {
      powerBtn.style.background = 'transparent';
      powerBtn.style.color = '#8b95a1';
    });
    powerWrap.appendChild(powerBtn);

    const powerMenu = document.createElement('div');
    powerMenu.style.cssText = `
      display: none; position: absolute; bottom: calc(100% + 4px); right: 0;
      width: 200px; background: rgba(27, 31, 36, 0.97);
      border: 1px solid #2d343d; border-radius: 8px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6); padding: 6px;
      z-index: 200;
    `;

    const powerItems: { icon: string; label: string; action: () => void }[] = [
      {
        icon: '💤',
        label: 'Sleep',
        action: () => {
          powerMenu.style.display = 'none';
          const sm2 = document.getElementById('start-menu');
          if (sm2) sm2.style.display = 'none';
          // Dim the desktop to simulate sleep
          const overlay = document.getElementById('desktop-overlay');
          if (overlay) {
            overlay.style.filter = 'brightness(0.3)';
            setTimeout(() => {
              overlay.style.filter = '';
            }, 1500);
          }
        },
      },
      {
        icon: '🔄',
        label: 'Restart',
        action: () => {
          powerMenu.style.display = 'none';
          const sm2 = document.getElementById('start-menu');
          if (sm2) sm2.style.display = 'none';
          // Brief fade then reload
          document.body.style.transition = 'opacity 0.4s';
          document.body.style.opacity = '0';
          setTimeout(() => {
            window.location.reload();
          }, 400);
        },
      },
      {
        icon: '⏻',
        label: 'Shut down',
        action: () => {
          powerMenu.style.display = 'none';
          const sm2 = document.getElementById('start-menu');
          if (sm2) sm2.style.display = 'none';
          document.body.style.transition = 'opacity 0.6s';
          document.body.style.opacity = '0';
          setTimeout(() => {
            api.hide();
            document.body.style.opacity = '1';
          }, 600);
        },
      },
      {
        icon: '🔒',
        label: 'Sign out',
        action: () => {
          powerMenu.style.display = 'none';
          const sm2 = document.getElementById('start-menu');
          if (sm2) sm2.style.display = 'none';
          api.hide();
        },
      },
    ];

    for (const item of powerItems) {
      const row = document.createElement('button');
      row.style.cssText = `
        display: flex; align-items: center; gap: 10px; width: 100%;
        padding: 8px 10px; border-radius: 6px; border: none;
        background: transparent; cursor: pointer; color: #e6e6e6;
        font-size: 13px; text-align: left; transition: background 0.15s;
      `;
      row.innerHTML = `<span style="font-size:16px;">${item.icon}</span><span>${item.label}</span>`;
      row.addEventListener('mouseenter', () => {
        row.style.background = '#232830';
      });
      row.addEventListener('mouseleave', () => {
        row.style.background = 'transparent';
      });
      row.addEventListener('click', item.action);
      powerMenu.appendChild(row);
    }

    powerWrap.appendChild(powerMenu);
    footer.appendChild(powerWrap);

    // Toggle power dropdown
    powerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      powerMenu.style.display = powerMenu.style.display === 'flex' ? 'none' : 'flex';
    });

    // Close power menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!powerWrap.contains(e.target as Node)) {
        powerMenu.style.display = 'none';
      }
    });

    sm.appendChild(footer);
    c.appendChild(sm);
  }

  /**
   * Open the default VM windows in a consistent 2-pane layout,
   * centered in the viewport with a small gap between them.
   *
   *   Left:  IAM Console  — the primary admin tool (wide)
   *   Right: Objectives — lab checklist and coaching focus (narrow)
   *
   * Positions are pinned so every VM entry looks the same. The AI
   * Supervisor and other apps remain accessible from the Start menu
   * and taskbar but are NOT opened by default to keep the desktop calm.
   */
  function layoutDefaultWindows(wm: WindowManager | null): void {
    if (!wm) return;

    // Helper: open + immediately pin the window to a specific position
    const openPinned = (id: string, x: number, y: number, w: number, h: number) => {
      const def = APP_BY_ID[id];
      if (!def) return;
      wm.open(def);
      // After open() positions the window with random offset, pin it precisely
      const ws = wm.windows.get(id);
      if (ws) {
        ws.el.style.left = `${x}px`;
        ws.el.style.top = `${y}px`;
        ws.el.style.width = `${w}px`;
        ws.el.style.height = `${h}px`;
      }
    };

    // Two-pane opening layout: the directory on the left, the work queue on the
    // right. The 3D lab pairs the console with its Objectives panel; a standing
    // workstation has no objectives, and this is the pairing an operator
    // actually keeps open all day.
    const GAP = 16;
    const iamW = 700;
    const queueW = 460;
    const totalW = iamW + GAP + queueW;
    const x0 = Math.round((window.innerWidth - totalW) / 2);
    const h = Math.min(620, window.innerHeight - 80);
    const y0 = Math.round((window.innerHeight - 48 - h) / 2); // above the taskbar

    openPinned('active-directory', x0, y0, iamW, h);
    openPinned('ticket-console', x0 + iamW + GAP, y0, queueW, h);
  }

  const api: DesktopOverlay = {
    show(conductor: VmServices, department?: string) {
      currentDepartment = department ?? 'IT';
      allowedAppIds = department ? new Set(appsForDepartment(department)) : null;

      if (!container) {
        container = buildContainer();
        buildDesktop(container);
        buildTaskbar(container, conductor);
        // Open the two-pane working layout for people who administer
        // identity. Everyone else starts on a plain desktop — Finance has no
        // use for Active Directory sitting open.
        if (appAllowed('active-directory')) layoutDefaultWindows(wmCtx.current);
      } else {
        // Re-entering the VM: reuse the existing WindowManager and its DOM
        // instead of building a new one. Recreating the WindowManager here
        // (as this used to do) left the old windows orphaned in the DOM —
        // layoutDefaultWindows would then open a second IAM Console +
        // Objectives on top of them every single time the learner exited
        // and re-entered, duplicating windows without bound.
        const wm = wmCtx.current;
        if (wm) {
          // Signing in as someone else: close anything their department is not
          // entitled to, rather than leaving the previous user's windows up.
          for (const id of wm.getOpenIds()) {
            if (!appAllowed(id)) wm.close(id);
          }

          const stillOpen = wm.getOpenIds();
          if (stillOpen.length > 0) {
            // Re-render the service-backed windows so they show current state
            // rather than whatever was there when they were first opened.
            for (const id of stillOpen) {
              if (CONDUCTOR_BACKED_WINDOW_IDS.has(id)) wm.refresh(id);
            }
            wm.updateTaskbar();
          } else if (appAllowed('active-directory')) {
            // Nothing left open — restore the working layout.
            layoutDefaultWindows(wm);
          }
        }
      }

      // The app set depends on the signed-in user's department, which differs
      // between sign-ins — refresh icons and Start menu to match.
      if (iconColEl) renderDesktopIcons(iconColEl);
      renderStartMenuApps?.();

      if (container) container.style.display = 'flex';
      visible = true;
    },
    hide() {
      const overlay = document.getElementById('desktop-overlay');
      if (overlay) overlay.style.display = 'none';
      if (visible) {
        visible = false;
        api.onExit?.();
      }
    },
    isVisible() {
      return visible;
    },
    openWindow(id: string, conductor: VmServices) {
      if (!visible) this.show(conductor);
      // Belt-and-suspenders: even if something (e.g. the File Explorer's
      // Program Files listing) tries to open an IT app by id directly, a
      // consumer desktop still won't actually launch it.
      // Never open something this department is not entitled to.
      if (!appAllowed(id)) return;
      wmCtx.current?.openById(id);
    },
    onExit: null,
  };
  return api;
}
