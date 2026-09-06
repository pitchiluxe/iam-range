/**
 * util/wallpapers.ts — desktop wallpaper options shared by Settings
 * (personalization picker) and desktopOverlay.ts (applies the gradient +
 * reads the persisted choice on VM open).
 */
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
    id: 'iamlab-dark',
    label: 'IAMLab Dark',
    gradient: wordmarkWallpaper('#0a0c10', 'IAMLab', '#5a6570'),
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
