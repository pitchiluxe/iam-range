import { describe, expect, it } from 'vitest';
import { THEME_BY_ID } from '@/ui/themes';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(index => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return r! * 0.2126 + g! * 0.7152 + b! * 0.0722;
}

function contrast(a: string, b: string): number {
  const first = luminance(a), second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

describe('Windows and security themes', () => {
  for (const id of ['windows-light', 'windows-dark', 'security-operations']) {
    it(`${id} keeps reading text and button labels legible`, () => {
      const theme = THEME_BY_ID[id]!;
      expect(theme).toBeDefined();
      const t = theme.tokens;
      expect(contrast(t.fg, t.panel)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.muted, t.panelAlt)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.onAccent, t.accent)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
