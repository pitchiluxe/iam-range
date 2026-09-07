/**
 * tests/wallpaperGenerator.test.ts — wallpapers the machine draws for itself.
 *
 * There is no image model in this product. Ollama runs llama3.2, which writes
 * text, and a diffusion model is a multi-gigabyte download the workstation
 * deliberately does not carry. These are drawn from a seed instead, which is
 * instant, offline, identical everywhere, and unbounded.
 *
 * Determinism is the load-bearing property, not a nicety: a generated
 * wallpaper is stored as its seed alone — eight characters rather than a
 * hundred kilobytes of data URI — and re-rendered on the next launch. If the
 * same seed ever produced a different picture, a chosen wallpaper would
 * silently become a different one.
 */
import { describe, it, expect } from 'vitest';
import {
  generateWallpaper,
  generateBatch,
  seedToId,
  idToSeed,
  randomSeed,
} from '@/util/wallpaperGenerator';

describe('the same seed is the same wallpaper', () => {
  it('renders identically every time', () => {
    expect(generateWallpaper(12345).gradient).toBe(generateWallpaper(12345).gradient);
  });

  it('renders differently for a different seed', () => {
    expect(generateWallpaper(1).gradient).not.toBe(generateWallpaper(2).gradient);
  });

  it('draws a lock screen differently from a desktop of the same seed', () => {
    // A lock screen is looked at head-on with text over it; a desktop spends
    // its life behind windows. Same seed, quieter picture.
    expect(generateWallpaper(99, 'lock').gradient).not.toBe(
      generateWallpaper(99, 'wall').gradient,
    );
  });
});

describe('the id carries the seed', () => {
  it('survives a round trip', () => {
    for (const seed of [0, 1, 4096, 123456789, 0xffffffff]) {
      const id = seedToId(seed, 'wall');
      expect(idToSeed(id)).toEqual({ seed: seed >>> 0, kind: 'wall' });
    }
  });

  it('keeps the two kinds apart', () => {
    expect(seedToId(7, 'wall')).not.toBe(seedToId(7, 'lock'));
    expect(idToSeed(seedToId(7, 'lock'))?.kind).toBe('lock');
  });

  it('does not mistake a built-in id for a generated one', () => {
    // resolve() falls back to the built-in table on null, so a false positive
    // here would replace a chosen built-in wallpaper with a random picture.
    for (const id of ['teal', 'iamlab-dark', 'windows-blue', 'deep-blue', '']) {
      expect(idToSeed(id)).toBeNull();
    }
  });
});

describe('what a generated wallpaper is', () => {
  it('is a CSS background with an inline SVG, needing no network', () => {
    const wp = generateWallpaper(2024);
    expect(wp.gradient).toContain('data:image/svg+xml,');
    // Anything fetched over the wire would leave the wallpaper blank offline,
    // which is the state this product is designed to run in.
    expect(wp.gradient).not.toMatch(/https?:\/\//);
  });

  it('has a label a person can tell apart in a picker', () => {
    const wp = generateWallpaper(31337);
    expect(wp.label).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });

  it('paints a solid colour behind the image', () => {
    // The SVG covers the screen, but a background-colour underneath means a
    // half-painted frame is never white.
    expect(generateWallpaper(5).gradient).toMatch(/^#[0-9a-f]{6} url\(/);
  });
});

describe('generating a batch', () => {
  it('returns the number asked for', () => {
    expect(generateBatch(6, 'wall')).toHaveLength(6);
  });

  it('does not repeat within the batch', () => {
    const ids = generateBatch(12, 'wall').map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not repeat what the queue already holds', () => {
    // The failure this prevents: press Generate, get the same six pictures,
    // conclude the button is broken.
    const first = generateBatch(6, 'wall');
    const second = generateBatch(6, 'wall', first.map((w) => w.id));
    const overlap = second.filter((w) => first.some((f) => f.id === w.id));
    expect(overlap).toEqual([]);
  });

  it('produces a seed inside the 32-bit range', () => {
    for (let i = 0; i < 50; i += 1) {
      const seed = randomSeed();
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(seed)).toBe(true);
    }
  });
});
