/**
 * util/wallpapers.ts — desktop wallpaper options shared by Settings
 * (personalization picker) and desktopOverlay.ts (applies the gradient +
 * reads the persisted choice on VM open).
 */
import { generateWallpaper, idToSeed } from './wallpaperGenerator';

export interface Wallpaper {
  id: string;
  label: string;
  gradient: string;
}

/** Builds a data-URI SVG background: solid fill + large, low-opacity centered wordmark. */
function wordmarkWallpaper(bgColor: string, word: string, textColor: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1920' height='1080'>
    <rect width='100%' height='100%' fill='${bgColor}'/>
    <text x='50%' y='50%' font-family='Segoe UI, -apple-system, sans-serif' font-size='220'
      font-weight='800' fill='${textColor}' fill-opacity='0.32' text-anchor='middle'
      dominant-baseline='middle' letter-spacing='6'>${word}</text>
  </svg>`;
  return `${bgColor} url("data:image/svg+xml,${encodeURIComponent(svg)}") center/cover no-repeat`;
}

export const WALLPAPERS: Wallpaper[] = [
  {
    id: 'teal',
    label: 'Apex Teal',
    gradient: 'linear-gradient(145deg, #0d1117 0%, #0e1520 60%, #0a1015 100%)',
  },
  {
    id: 'blue',
    label: 'Midnight Blue',
    gradient: 'linear-gradient(145deg, #0a1128 0%, #1a2456 60%, #0a1128 100%)',
  },
  {
    id: 'amber',
    label: 'Warm Amber',
    gradient: 'linear-gradient(145deg, #241a0d 0%, #3d2e10 60%, #1a1000 100%)',
  },
  {
    id: 'purple-haze',
    label: 'Purple Haze',
    gradient: 'linear-gradient(160deg, #1a1029 0%, #3a2468 50%, #1a1029 100%)',
  },
  {
    id: 'forest-green',
    label: 'Forest Green',
    gradient: 'linear-gradient(150deg, #0b1a13 0%, #163626 55%, #0b1a13 100%)',
  },
  {
    id: 'rose-gold',
    label: 'Rose Gold',
    gradient: 'linear-gradient(150deg, #2b181c 0%, #5a333e 50%, #2b181c 100%)',
  },
  {
    id: 'iamlab-dark',
    label: 'OMARI Dark',
    gradient: wordmarkWallpaper('#0a0c10', 'OMARI', '#5a6570'),
  },
  {
    id: 'iamlab-slate',
    label: 'OMARI Slate',
    gradient: wordmarkWallpaper('#10151c', 'OMARI', '#4a5a6a'),
  },
  {
    id: 'iamlab-amber',
    label: 'OMARI Amber',
    gradient: wordmarkWallpaper('#1a1208', 'OMARI', '#8a6a3a'),
  },
  {
    id: 'iamlab-purple',
    label: 'OMARI Purple',
    gradient: wordmarkWallpaper('#130a1c', 'OMARI', '#604080'),
  },
  {
    id: 'iamlab-forest',
    label: 'OMARI Forest',
    gradient: wordmarkWallpaper('#09140f', 'OMARI', '#3a6a4a'),
  },
  {
    id: 'windows-blue',
    label: 'Windows Blue',
    gradient: 'linear-gradient(135deg, #0b3d91 0%, #1e5fbf 35%, #5b8def 70%, #a7c7f2 100%)',
  },
];

export const WALLPAPER_BY_ID: Record<string, string> = Object.fromEntries(
  WALLPAPERS.map((w) => [w.id, w.gradient]),
);

export const DEFAULT_WALLPAPER_ID = 'iamlab-dark';
export const WALLPAPER_STORAGE_KEY = 'settings_wallpaper';

/**
 * Lock screen backgrounds.
 *
 * A separate set from the desktop's, because Windows treats them separately
 * and because they are read at different moments: the lock screen is the first
 * thing anyone sees, before any account has been chosen, so it cannot depend
 * on a signed-in user's preferences.
 */
export const LOCK_SCREENS: Wallpaper[] = [
  {
    id: 'deep-blue',
    label: 'Deep Blue',
    gradient: 'linear-gradient(150deg,#0b3a5e 0%,#123f63 40%,#0e2438 100%)',
  },
  {
    id: 'slate',
    label: 'Slate',
    gradient: 'linear-gradient(150deg,#141a21 0%,#1e262f 45%,#0d1117 100%)',
  },
  {
    id: 'dusk',
    label: 'Dusk',
    gradient: 'linear-gradient(160deg,#2a1b3d 0%,#44318d 45%,#1b1032 100%)',
  },
  {
    id: 'forest',
    label: 'Forest',
    gradient: 'linear-gradient(150deg,#0d2818 0%,#14432a 45%,#08170f 100%)',
  },
  {
    id: 'magenta',
    label: 'Magenta',
    gradient: 'linear-gradient(160deg,#2a0d1e 0%,#5a1e42 45%,#2a0d1e 100%)',
  },
  {
    id: 'obsidian',
    label: 'Obsidian',
    gradient: 'linear-gradient(150deg,#0c0c0c 0%,#1f1f1f 45%,#0c0c0c 100%)',
  },
  {
    id: 'copper',
    label: 'Copper',
    gradient: 'linear-gradient(160deg,#2a1b0e 0%,#5a3a1e 45%,#2a1b0e 100%)',
  },
  {
    id: 'iamlab',
    label: 'OMARI',
    gradient: wordmarkWallpaper('#0a1420', 'OMARI', '#4f6b86'),
  },
  {
    id: 'iamlab-teal',
    label: 'OMARI Teal',
    gradient: wordmarkWallpaper('#07131a', 'OMARI', '#3a6a6a'),
  },
  {
    id: 'iamlab-midnight',
    label: 'OMARI Midnight',
    gradient: wordmarkWallpaper('#080c14', 'OMARI', '#3a4a5a'),
  },
  {
    id: 'iamlab-crimson',
    label: 'OMARI Crimson',
    gradient: wordmarkWallpaper('#1a0a0e', 'OMARI', '#7a3a45'),
  },
  {
    id: 'iamlab-gold',
    label: 'OMARI Gold',
    gradient: wordmarkWallpaper('#141008', 'OMARI', '#8a6a2a'),
  },
];

export const LOCK_SCREEN_BY_ID: Record<string, string> = Object.fromEntries(
  LOCK_SCREENS.map((w) => [w.id, w.gradient]),
);

// ---------------------------------------------------------------------------
// Generated wallpapers
// ---------------------------------------------------------------------------

/** Where the generated queue is kept. Ids only — see wallpaperGenerator. */
export const GENERATED_WALL_KEY = 'settings_wallpapers_generated';
export const GENERATED_LOCK_KEY = 'settings_lock_screens_generated';

const genKey = (kind: 'wall' | 'lock'): string =>
  kind === 'wall' ? GENERATED_WALL_KEY : GENERATED_LOCK_KEY;

/** The ids in the generated queue, oldest first. */
export function generatedIds(kind: 'wall' | 'lock'): string[] {
  try {
    const raw = localStorage.getItem(genKey(kind));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    // Unreadable or not JSON: an empty queue is the right answer, and better
    // than throwing on a cosmetic feature during boot.
    return [];
  }
}

/**
 * How many generated wallpapers the queue holds.
 *
 * Capped because these are kept forever otherwise, and a picker with four
 * hundred thumbnails in it is not a picker. The oldest fall off the end.
 */
export const GENERATED_LIMIT = 24;

export function saveGeneratedIds(kind: 'wall' | 'lock', ids: readonly string[]): void {
  try {
    localStorage.setItem(genKey(kind), JSON.stringify(ids.slice(-GENERATED_LIMIT)));
  } catch {
    /* private mode — the queue lasts this session only, which is not fatal */
  }
}

/** Rebuild the generated queue from its seeds. */
export function generatedWallpapers(kind: 'wall' | 'lock'): Wallpaper[] {
  return generatedIds(kind)
    .map((id) => {
      const parsed = idToSeed(id);
      return parsed ? generateWallpaper(parsed.seed, parsed.kind) : null;
    })
    .filter((w): w is Wallpaper => w !== null);
}

/** Built-in plus generated, which is what a picker should show. */
export function allWallpapers(): Wallpaper[] {
  return [...WALLPAPERS, ...generatedWallpapers('wall')];
}

export function allLockScreens(): Wallpaper[] {
  return [...LOCK_SCREENS, ...generatedWallpapers('lock')];
}

/**
 * Turn a saved id into something to paint.
 *
 * A generated id is regenerated from its own seed rather than looked up, so
 * it resolves even at first paint — before Settings has been opened, and
 * whether or not the id is still in the queue.
 */
function resolve(id: string, table: Record<string, string>, fallbackId: string): string {
  const built = table[id];
  if (built) return built;
  const parsed = idToSeed(id);
  if (parsed) return generateWallpaper(parsed.seed, parsed.kind).gradient;
  return table[fallbackId]!;
}

/** The chosen desktop wallpaper, generated or built-in. */
export function currentWallpaper(): string {
  let id = DEFAULT_WALLPAPER_ID;
  try {
    id = localStorage.getItem(WALLPAPER_STORAGE_KEY) ?? DEFAULT_WALLPAPER_ID;
  } catch {
    /* private mode — the default is correct */
  }
  return resolve(id, WALLPAPER_BY_ID, DEFAULT_WALLPAPER_ID);
}

export const DEFAULT_LOCK_SCREEN_ID = 'deep-blue';
export const LOCK_SCREEN_STORAGE_KEY = 'settings_lock_screen';

/** The chosen lock screen, falling back to the default if the store is
 *  unavailable or holds an id that no longer exists. */
export function currentLockScreen(): string {
  let id = DEFAULT_LOCK_SCREEN_ID;
  try {
    id = localStorage.getItem(LOCK_SCREEN_STORAGE_KEY) ?? DEFAULT_LOCK_SCREEN_ID;
  } catch {
    /* private mode — the default is correct */
  }
  return resolve(id, LOCK_SCREEN_BY_ID, DEFAULT_LOCK_SCREEN_ID);
}
