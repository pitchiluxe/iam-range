/**
 * ui/themes.ts — the workstation's colour scheme.
 *
 * The windows already referenced `var(--panel)`, `var(--accent)` and friends
 * in about a hundred places, and nothing defined them: every one of those
 * resolved to nothing, and the light/dark toggle in Settings set an attribute
 * no stylesheet responded to. The theme control looked like a feature and was
 * a no-op.
 *
 * This defines the variables, ships several schemes the way Windows does, and
 * applies one by writing a single stylesheet. Because everything reads the
 * variables, changing the theme repaints the whole interface — taskbar, Start
 * menu, windows, context menus — rather than a corner of it.
 */

export interface Theme {
  id: string;
  label: string;
  /** Shown under the name in the picker. */
  note: string;
  /** Light schemes need dark text on the glass; dark ones do not. */
  mode: 'dark' | 'light';
  tokens: {
    /** Window body. Opaque: Aero blurred the frame, never the document. */
    panel: string;
    /** A slightly raised surface — toolbars, list headers. */
    panelAlt: string;
    /** The desktop behind everything, when no wallpaper covers it. */
    bg: string;
    fg: string;
    muted: string;
    border: string;
    accent: string;
    /** Text that sits on the accent colour. */
    onAccent: string;
    err: string;
    warn: string;
    /** Chrome glass: taskbar, title bars, Start menu, context menus. */
    glassTop: string;
    glassBottom: string;
    glassBorder: string;
    glassText: string;
    glassHover: string;
  };
}

export const THEMES: readonly Theme[] = [
  {
    id: 'midnight',
    label: 'Midnight',
    note: 'The default. Dark chrome, teal accent.',
    mode: 'dark',
    tokens: {
      panel: '#0e1116',
      panelAlt: '#161b22',
      bg: '#0a0d12',
      fg: '#e6e6e6',
      muted: '#8b95a1',
      border: '#2d343d',
      accent: '#4ec9b0',
      onAccent: '#04120f',
      err: '#ff9a8a',
      warn: '#e2a03f',
      glassTop: 'rgba(40,52,66,0.62)',
      glassBottom: 'rgba(18,24,32,0.78)',
      glassBorder: 'rgba(255,255,255,0.12)',
      glassText: '#e6e6e6',
      glassHover: 'rgba(255,255,255,0.14)',
    },
  },
  {
    id: 'cobalt',
    label: 'Cobalt',
    note: 'Windows blue, on a deep navy.',
    mode: 'dark',
    tokens: {
      panel: '#0d1420',
      panelAlt: '#141d2c',
      bg: '#080d16',
      fg: '#e4eaf2',
      muted: '#8d9bb0',
      border: '#26314a',
      accent: '#4a9eff',
      onAccent: '#04121f',
      err: '#ff9a8a',
      warn: '#e2a03f',
      glassTop: 'rgba(36,58,92,0.66)',
      glassBottom: 'rgba(12,20,34,0.80)',
      glassBorder: 'rgba(255,255,255,0.14)',
      glassText: '#e4eaf2',
      glassHover: 'rgba(255,255,255,0.15)',
    },
  },
  {
    id: 'graphite',
    label: 'Graphite',
    note: 'Neutral grey, amber accent. Easy on a bright room.',
    mode: 'dark',
    tokens: {
      panel: '#16181b',
      panelAlt: '#1e2125',
      bg: '#0f1113',
      fg: '#e3e3e3',
      muted: '#98999c',
      border: '#32363b',
      accent: '#d7ba7d',
      onAccent: '#1a1508',
      err: '#ff9a8a',
      warn: '#e2a03f',
      glassTop: 'rgba(58,62,68,0.62)',
      glassBottom: 'rgba(22,24,27,0.80)',
      glassBorder: 'rgba(255,255,255,0.12)',
      glassText: '#e3e3e3',
      glassHover: 'rgba(255,255,255,0.13)',
    },
  },
  {
    id: 'plum',
    label: 'Plum',
    note: 'Violet chrome, warmer than the rest.',
    mode: 'dark',
    tokens: {
      panel: '#15101c',
      panelAlt: '#1d1728',
      bg: '#0e0a14',
      fg: '#e8e2f2',
      muted: '#9c92ad',
      border: '#332a45',
      accent: '#b48ef0',
      onAccent: '#150c22',
      err: '#ff9a8a',
      warn: '#e2a03f',
      glassTop: 'rgba(62,46,88,0.64)',
      glassBottom: 'rgba(20,14,30,0.80)',
      glassBorder: 'rgba(255,255,255,0.13)',
      glassText: '#e8e2f2',
      glassHover: 'rgba(255,255,255,0.14)',
    },
  },
  {
    id: 'daylight',
    label: 'Daylight',
    note: 'Light windows, as Windows ships by default.',
    mode: 'light',
    tokens: {
      panel: '#ffffff',
      panelAlt: '#f3f5f7',
      bg: '#e9edf2',
      fg: '#12161c',
      muted: '#5b6672',
      border: '#d3d9e0',
      accent: '#0f6cbd',
      onAccent: '#ffffff',
      err: '#c0392b',
      warn: '#9a6700',
      glassTop: 'rgba(255,255,255,0.74)',
      glassBottom: 'rgba(232,238,245,0.86)',
      glassBorder: 'rgba(0,0,0,0.12)',
      glassText: '#12161c',
      glassHover: 'rgba(0,0,0,0.07)',
    },
  },
  {
    id: 'contrast',
    label: 'High contrast',
    note: 'Maximum separation, for low vision or a projector.',
    mode: 'dark',
    tokens: {
      panel: '#000000',
      panelAlt: '#0d0d0d',
      bg: '#000000',
      fg: '#ffffff',
      muted: '#c8c8c8',
      border: '#ffffff',
      accent: '#ffd700',
      onAccent: '#000000',
      err: '#ff6b6b',
      warn: '#ffd700',
      glassTop: 'rgba(0,0,0,0.94)',
      glassBottom: 'rgba(0,0,0,0.98)',
      glassBorder: '#ffffff',
      glassText: '#ffffff',
      glassHover: '#333333',
    },
  },
];

export const THEME_BY_ID: Record<string, Theme> = Object.fromEntries(
  THEMES.map((t) => [t.id, t]),
);

export const DEFAULT_THEME_ID = 'midnight';
export const THEME_STORAGE_KEY = 'app_theme';
const CHANGE_EVENT = 'apex-theme-changed';
const STYLE_ID = 'vm-theme';

export function currentThemeId(): string {
  let id = DEFAULT_THEME_ID;
  try {
    id = localStorage.getItem(THEME_STORAGE_KEY) ?? DEFAULT_THEME_ID;
  } catch {
    /* private mode — the default is correct */
  }
  return THEME_BY_ID[id] ? id : DEFAULT_THEME_ID;
}

export function currentTheme(): Theme {
  return THEME_BY_ID[currentThemeId()]!;
}

/**
 * Write the theme's variables into the document.
 *
 * One stylesheet, replaced wholesale. Setting each variable individually on
 * documentElement would work too, but a stylesheet can also carry the rules
 * that are not variables — the scrollbars and the selection colour, which
 * otherwise stay dark on a light theme and look like a rendering fault.
 */
export function applyTheme(id: string = currentThemeId()): void {
  const theme = THEME_BY_ID[id] ?? THEME_BY_ID[DEFAULT_THEME_ID]!;
  const t = theme.tokens;

  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }

  style.textContent = `
    :root {
      --panel: ${t.panel};
      --panel-alt: ${t.panelAlt};
      --bg: ${t.bg};
      --fg: ${t.fg};
      --muted: ${t.muted};
      --border: ${t.border};
      --accent: ${t.accent};
      --on-accent: ${t.onAccent};
      --err: ${t.err};
      --warn: ${t.warn};
      --glass-top: ${t.glassTop};
      --glass-bottom: ${t.glassBottom};
      --glass-border: ${t.glassBorder};
      --glass-text: ${t.glassText};
      --glass-hover: ${t.glassHover};
      --menu-bg: ${t.glassBottom};
      --menu-border: ${t.glassBorder};
      --menu-text: ${t.glassText};
      --menu-hover: ${t.glassHover};
      color-scheme: ${theme.mode};
    }
    ::selection { background: ${t.accent}; color: ${t.onAccent}; }
    ::-webkit-scrollbar { width: 12px; height: 12px; }
    ::-webkit-scrollbar-track { background: ${t.panelAlt}; }
    ::-webkit-scrollbar-thumb {
      background: ${t.border}; border-radius: 6px; border: 3px solid ${t.panelAlt};
    }
    ::-webkit-scrollbar-thumb:hover { background: ${t.muted}; }
  `;

  document.documentElement.setAttribute('data-theme', theme.mode);
  document.documentElement.setAttribute('data-theme-id', theme.id);
}

export function setTheme(id: string): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
  applyTheme(id);
  document.dispatchEvent(new CustomEvent<string>(CHANGE_EVENT, { detail: id }));
}

/** Subscribe to theme changes — windows that cache colours re-read them. */
export function onThemeChanged(handler: (id: string) => void): () => void {
  const listener = (e: Event): void => handler((e as CustomEvent<string>).detail);
  document.addEventListener(CHANGE_EVENT, listener);
  return () => document.removeEventListener(CHANGE_EVENT, listener);
}
