/**
 * tests/wallpapers.test.ts — built-in wallpaper and lock screen registry.
 */
import { describe, it, expect } from 'vitest';
import { WALLPAPERS, LOCK_SCREENS, WALLPAPER_BY_ID, LOCK_SCREEN_BY_ID } from '@/util/wallpapers';

describe('wallpaper collection', () => {
  it('has a set of IAMLab watermarked desktop wallpapers in several colors', () => {
    const iamlab = WALLPAPERS.filter((w) => w.label.startsWith('IAMLab'));
    expect(iamlab.length).toBeGreaterThanOrEqual(6);
    for (const w of iamlab) {
      expect(w.gradient).toContain('IAMLab');
      expect(w.gradient).toContain('data:image/svg+xml');
    }
  });

  it('has a set of IAMLab watermarked lock screens', () => {
    const iamlab = LOCK_SCREENS.filter((w) => w.label.startsWith('IAMLab'));
    expect(iamlab.length).toBeGreaterThanOrEqual(5);
    for (const w of iamlab) {
      expect(w.gradient).toContain('IAMLab');
      expect(w.gradient).toContain('data:image/svg+xml');
    }
  });

  it('has unique ids in each collection and in the lookup tables', () => {
    const wallIds = WALLPAPERS.map((w) => w.id);
    const lockIds = LOCK_SCREENS.map((w) => w.id);
    expect(new Set(wallIds).size).toBe(wallIds.length);
    expect(new Set(lockIds).size).toBe(lockIds.length);
    expect(Object.keys(WALLPAPER_BY_ID).length).toBe(wallIds.length);
    expect(Object.keys(LOCK_SCREEN_BY_ID).length).toBe(lockIds.length);
  });
});
