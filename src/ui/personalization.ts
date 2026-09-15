/**
 * ui/personalization.ts — where a theme, wallpaper or lock screen choice goes.
 *
 * Settings used to write every choice straight into the workstation's own
 * storage. That was right on the workstation and wrong in a Remote Desktop
 * session: picking a wallpaper on a user's computer repainted the operator's
 * desktop, which no real RDP session can do. Settings now writes through a
 * store — the workstation's, or one that belongs to the remote computer — so
 * each machine keeps its own look.
 */
import {
  THEME_BY_ID,
  CUSTOM_THEME_ID,
  currentThemeId,
  getCustomTheme,
  setCustomTheme,
  clearCustomTheme,
  setTheme,
  type Theme,
} from './themes';
import {
  DEFAULT_LOCK_SCREEN_ID,
  DEFAULT_WALLPAPER_ID,
  LOCK_SCREEN_STORAGE_KEY,
  WALLPAPER_STORAGE_KEY,
} from '@/util/wallpapers';

export interface PersonalizationStore {
  themeId(): string;
  setTheme(id: string): void;
  customTheme(): Theme | null;
  setCustomTheme(theme: Theme): void;
  clearCustomTheme(): void;
  wallpaperId(): string;
  setWallpaper(id: string, gradient: string): void;
  lockScreenId(): string;
  setLockScreen(id: string): void;
  /** Words under the lock screen picker, since the two stores apply it differently. */
  lockScreenNote: string;
}

const read = (key: string, fallback: string): string => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode — the choice still applies until reload */
  }
};

/** The workstation itself: the behaviour Settings always had. */
export const WORKSTATION_PERSONALIZATION: PersonalizationStore = {
  themeId: currentThemeId,
  setTheme,
  customTheme: getCustomTheme,
  setCustomTheme,
  clearCustomTheme,
  wallpaperId: () => read(WALLPAPER_STORAGE_KEY, DEFAULT_WALLPAPER_ID),
  setWallpaper: (id, gradient) => {
    write(WALLPAPER_STORAGE_KEY, id);
    document.dispatchEvent(new CustomEvent('apex-wallpaper-changed', { detail: gradient }));
  },
  lockScreenId: () => read(LOCK_SCREEN_STORAGE_KEY, DEFAULT_LOCK_SCREEN_ID),
  setLockScreen: (id) => write(LOCK_SCREEN_STORAGE_KEY, id),
  lockScreenNote: 'Shown the next time you sign out or lock the workstation.',
};

// ---------------------------------------------------------------------------
// A remote computer's own look
// ---------------------------------------------------------------------------

/** Windows 11's "Bloom", approximated in gradients so nothing is fetched. */
export const WINDOWS_BLOOM =
  'radial-gradient(30% 42% at 56% 56%, rgba(255,255,255,0.9) 0%, rgba(175,215,255,0.6) 35%, rgba(60,140,235,0) 75%),' +
  'radial-gradient(48% 62% at 52% 60%, #3d8ff0 0%, #1d66d9 38%, rgba(18,80,200,0) 76%),' +
  'radial-gradient(60% 80% at 26% 96%, rgba(10,58,168,0.7) 0%, rgba(10,58,168,0) 70%),' +
  'radial-gradient(50% 70% at 86% 20%, rgba(120,180,245,0.7) 0%, rgba(120,180,245,0) 70%),' +
  'linear-gradient(160deg, #d3e6f8 0%, #a8cbf0 34%, #78ade8 62%, #4a8adb 100%)';

/** Windows 11's own defaults: light apps on the Bloom wallpaper. */
export const SESSION_DEFAULT_THEME_ID = 'daylight';
export const SESSION_DEFAULT_WALLPAPER_ID = 'windows-bloom';

interface SessionLook {
  themeId?: string;
  custom?: Theme;
  wallpaperId?: string;
  lockScreenId?: string;
}

const SESSION_EVENT = 'apex-session-look-changed';
const sessionKey = (computer: string): string => `rds_personalization:${computer.toUpperCase()}`;

function readLook(computer: string): SessionLook {
  try {
    const raw = localStorage.getItem(sessionKey(computer));
    return raw ? (JSON.parse(raw) as SessionLook) : {};
  } catch {
    return {};
  }
}

function writeLook(computer: string, patch: Partial<SessionLook>): void {
  const next = { ...readLook(computer), ...patch };
  try {
    localStorage.setItem(sessionKey(computer), JSON.stringify(next));
  } catch {
    /* ignore */
  }
  document.dispatchEvent(new CustomEvent<string>(SESSION_EVENT, { detail: computer.toUpperCase() }));
}

/** The theme a remote computer is showing, resolved to its colours. */
export function sessionTheme(computer: string): Theme {
  const look = readLook(computer);
  if (look.themeId === CUSTOM_THEME_ID && look.custom) return look.custom;
  return THEME_BY_ID[look.themeId ?? SESSION_DEFAULT_THEME_ID] ?? THEME_BY_ID[SESSION_DEFAULT_THEME_ID]!;
}

/** Personalization that only ever changes `computer`. */
export function sessionPersonalization(computer: string): PersonalizationStore {
  return {
    themeId: () => {
      const look = readLook(computer);
      if (look.themeId === CUSTOM_THEME_ID) return look.custom ? CUSTOM_THEME_ID : SESSION_DEFAULT_THEME_ID;
      return look.themeId && THEME_BY_ID[look.themeId] ? look.themeId : SESSION_DEFAULT_THEME_ID;
    },
    setTheme: (id) => writeLook(computer, { themeId: id }),
    customTheme: () => readLook(computer).custom ?? null,
    setCustomTheme: (theme) => writeLook(computer, { custom: { ...theme, id: CUSTOM_THEME_ID }, themeId: CUSTOM_THEME_ID }),
    clearCustomTheme: () => {
      const look = readLook(computer);
      const { custom: _drop, ...rest } = look;
      try {
        localStorage.setItem(
          sessionKey(computer),
          JSON.stringify({ ...rest, ...(look.themeId === CUSTOM_THEME_ID ? { themeId: SESSION_DEFAULT_THEME_ID } : {}) }),
        );
      } catch {
        /* ignore */
      }
      document.dispatchEvent(new CustomEvent<string>(SESSION_EVENT, { detail: computer.toUpperCase() }));
    },
    wallpaperId: () => readLook(computer).wallpaperId ?? SESSION_DEFAULT_WALLPAPER_ID,
    setWallpaper: (id) => writeLook(computer, { wallpaperId: id }),
    lockScreenId: () => readLook(computer).lockScreenId ?? DEFAULT_LOCK_SCREEN_ID,
    setLockScreen: (id) => writeLook(computer, { lockScreenId: id }),
    lockScreenNote: `Applies to ${computer.toUpperCase()} only. Your own workstation keeps its lock screen.`,
  };
}

/** Repaint whenever `computer`'s look changes, for as long as `owner` is on the page. */
export function onSessionLookChanged(owner: HTMLElement, computer: string, handler: () => void): void {
  const want = computer.toUpperCase();
  const listener = (e: Event): void => {
    if (!owner.isConnected) {
      document.removeEventListener(SESSION_EVENT, listener);
      return;
    }
    if ((e as CustomEvent<string>).detail === want) handler();
  };
  document.addEventListener(SESSION_EVENT, listener);
}

/** The session's wallpaper id, for the session desktop to paint. */
export function sessionWallpaperId(computer: string): string {
  return readLook(computer).wallpaperId ?? SESSION_DEFAULT_WALLPAPER_ID;
}

/** CSS custom properties for a theme, to set on an element rather than :root. */
export function themeVariables(theme: Theme): Record<string, string> {
  const t = theme.tokens;
  return {
    '--panel': t.panel,
    '--panel-alt': t.panelAlt,
    '--bg': t.bg,
    '--fg': t.fg,
    '--muted': t.muted,
    '--border': t.border,
    '--accent': t.accent,
    '--on-accent': t.onAccent,
    '--err': t.err,
    '--warn': t.warn,
    '--glass-top': t.glassTop,
    '--glass-bottom': t.glassBottom,
    '--glass-border': t.glassBorder,
    '--glass-text': t.glassText,
    '--glass-hover': t.glassHover,
    '--menu-bg': t.glassBottom,
    '--menu-border': t.glassBorder,
    '--menu-text': t.glassText,
    '--menu-hover': t.glassHover,
  };
}
