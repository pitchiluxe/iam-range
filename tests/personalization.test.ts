/**
 * tests/personalization.test.ts — a Remote Desktop session keeps its own look.
 *
 * Choosing a theme, wallpaper or lock screen in the Settings of a remote
 * computer used to write the workstation's own keys, so the operator's desktop
 * changed with it. The session store must never touch those keys.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  WORKSTATION_PERSONALIZATION,
  SESSION_DEFAULT_THEME_ID,
  SESSION_DEFAULT_WALLPAPER_ID,
  sessionPersonalization,
  sessionTheme,
  sessionWallpaperId,
} from '@/ui/personalization';
import { THEME_STORAGE_KEY } from '@/ui/themes';
import { LOCK_SCREEN_STORAGE_KEY, WALLPAPER_STORAGE_KEY } from '@/util/wallpapers';

function stubBrowser(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal('document', new EventTarget());
  return store;
}

describe('session personalization', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = stubBrowser();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('starts a remote computer on Windows light theme and Bloom', () => {
    const look = sessionPersonalization('WKS-JDOE');
    expect(look.themeId()).toBe(SESSION_DEFAULT_THEME_ID);
    expect(sessionTheme('WKS-JDOE').mode).toBe('light');
    expect(look.wallpaperId()).toBe(SESSION_DEFAULT_WALLPAPER_ID);
  });

  it('never writes the workstation theme, wallpaper or lock screen', () => {
    const look = sessionPersonalization('WKS-JDOE');
    look.setTheme('midnight');
    look.setWallpaper('session-only-wall', 'linear-gradient(#000,#000)');
    look.setLockScreen('deep-blue');

    expect(store.has(THEME_STORAGE_KEY)).toBe(false);
    expect(store.has(WALLPAPER_STORAGE_KEY)).toBe(false);
    expect(store.has(LOCK_SCREEN_STORAGE_KEY)).toBe(false);
    expect(WORKSTATION_PERSONALIZATION.wallpaperId()).not.toBe('session-only-wall');

    expect(sessionTheme('WKS-JDOE').id).toBe('midnight');
    expect(sessionWallpaperId('WKS-JDOE')).toBe('session-only-wall');
  });

  it('keeps each remote computer separate', () => {
    sessionPersonalization('WKS-JDOE').setTheme('midnight');
    expect(sessionTheme('WKS-MCHEN').id).toBe(SESSION_DEFAULT_THEME_ID);
  });

  it('an AI theme made in a session stays in that session', () => {
    const look = sessionPersonalization('WKS-JDOE');
    const base = sessionTheme('WKS-JDOE');
    look.setCustomTheme({ ...base, label: 'Mine' });
    expect(store.has('app_theme_custom')).toBe(false);
    expect(sessionTheme('WKS-JDOE').label).toBe('Mine');
    look.clearCustomTheme();
    expect(sessionTheme('WKS-JDOE').id).toBe(SESSION_DEFAULT_THEME_ID);
  });
});
