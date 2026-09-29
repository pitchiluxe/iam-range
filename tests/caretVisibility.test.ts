/**
 * tests/caretVisibility.test.ts — you can always see where you are typing.
 *
 * The caret is the field's own text colour (the colour every field keeps
 * readable), the focused field gets an accent ring that beats inline
 * outline:none, and the Terminal's text no longer follows the theme onto its
 * fixed black background, where the light theme made text and caret vanish.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { THEMES, applyTheme } from '@/ui/themes';

/** Just enough document for applyTheme: one <style>, found by id. */
let styleEl: { id: string; textContent: string } | null;
beforeEach(() => {
  styleEl = null;
  (globalThis as { document?: unknown }).document = {
    getElementById: () => styleEl,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: (el: { id: string; textContent: string }) => { styleEl = el; } },
    documentElement: { setAttribute: () => {} },
  };
});

describe('caret and focus ring', () => {
  it('every theme gives text fields a readable caret and a focus ring', () => {
    for (const theme of THEMES) {
      applyTheme(theme.id);
      const css = styleEl?.textContent ?? '';
      expect(css, theme.id).toMatch(/:where\(input:not\([^{]*\{ caret-color: currentColor; \}/);
      expect(css, theme.id).toContain(`outline: 2px solid ${theme.tokens.accent} !important`);
      expect(css, theme.id).toMatch(/:not\(\[data-caret-only\]\):focus/);
    }
  });
});

describe('terminal colours', () => {
  const src = readFileSync(join('src', 'ui', 'consoles', 'terminalWindow.ts'), 'utf8');

  it('draws console text and caret in a fixed light colour, not the theme colour', () => {
    expect(src).not.toMatch(/var\(--fg\)'?\)?[;,]/);
    expect(src).toMatch(/caret-color:\$\{CONSOLE_FG\}/);
    expect(src).toMatch(/dataset\.caretOnly/);
  });
});
