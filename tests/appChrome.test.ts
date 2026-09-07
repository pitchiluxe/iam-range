/**
 * tests/appChrome.test.ts — one operating system, not twenty-six applications.
 *
 * Measured across every window, ordinary toolbar buttons ranged from 18px to
 * 36px tall in five font sizes and six corner radii. On screen that reads as a
 * collection of web pages behind a shared title bar rather than as a machine.
 *
 * The specificity assertion is the one that matters, because it caught a real
 * defect. The baseline rule was written as a plain descendant selector, which
 * outranks a bare class — so it silently overrode the very component styles it
 * exists to support, holding every migrated button at its container's font
 * size. Nothing failed; the buttons just quietly kept the wrong size until a
 * measurement in the running app found it. `:where()` contributes no
 * specificity, and that is the whole reason it is there.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = readFileSync(join(process.cwd(), 'src', 'ui', 'appChrome.ts'), 'utf8');

/** The windows migrated onto the shared chrome. */
const MIGRATED = [
  'sheetWindow',
  'slidesWindow',
  'auditQueryWindow',
  'accessReviewWindow',
  'breakGlassWindow',
  'interviewWindow',
  'projectWindow',
];

function consoleSource(name: string): string {
  return readFileSync(join(process.cwd(), 'src', 'ui', 'consoles', `${name}.ts`), 'utf8');
}

describe('the baseline', () => {
  it('wraps its selectors in :where(), so it cannot outrank a component class', () => {
    // Written plainly this rule beats .app-btn and overrides the styles it is
    // meant to support. That is not theoretical — it happened.
    const baseline = SOURCE.slice(SOURCE.indexOf('---- Baseline'), SOURCE.indexOf('---- Components'));
    const selectors = baseline.match(/^\s*\.apex-window-body[^{]*\{/gm) ?? [];
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      // A focus ring is allowed to be specific; font rules are not.
      if (selector.includes(':focus-visible')) continue;
      expect(selector, selector.trim()).toContain(':where(');
    }
  });

  it('fixes the font inheritance browsers get wrong', () => {
    // Form controls do not inherit font. Without this a button with none of
    // its own renders in the browser's 13.33px Arial.
    expect(SOURCE).toMatch(/font-family:\s*inherit/);
    expect(SOURCE).toMatch(/font-size:\s*inherit/);
  });
});

describe('the component metrics', () => {
  it('uses one height, one radius and one size for a toolbar button', () => {
    const block = SOURCE.slice(SOURCE.indexOf('.app-btn {'), SOURCE.indexOf('.app-btn:hover'));
    expect(block).toMatch(/height:\s*28px/);
    expect(block).toMatch(/border-radius:\s*4px/);
    expect(block).toMatch(/font-size:\s*12px/);
  });

  it('gives inputs and selects the same height as buttons', () => {
    // A 28px button beside a 24px select is the drift this exists to remove.
    const block = SOURCE.slice(SOURCE.indexOf('.app-input, .app-select'));
    expect(block.slice(0, 200)).toMatch(/height:\s*28px/);
  });
});

describe('the migrated windows', () => {
  it('build their buttons through the shared helper', () => {
    for (const name of MIGRATED) {
      expect(consoleSource(name), name).toContain("from '@/ui/appChrome'");
    }
  });

  it('no longer style their toolbar buttons by descendant selector', () => {
    // `.xx-bar button` is a class plus an element, so it outranks .app-btn and
    // wins. Leaving one behind means a window that carries the shared class
    // and none of its styling.
    //
    // Scoped to toolbars on purpose. Compact in-row controls — the Keep and
    // Revoke buttons inside a review grid, for one — are deliberately not
    // 28px toolbar buttons, and flattening them into the house style would
    // make a table row three times taller for no reason.
    for (const name of MIGRATED) {
      const css = consoleSource(name);
      const offenders = (css.match(/^\s*\.[a-z-]*(bar|toolbar|ribbon)[a-z-]* button[^{]*\{/gm) ?? [])
        .map((x) => x.trim());
      expect(offenders, `${name}: ${offenders.join(' ')}`).toEqual([]);
    }
  });
});

describe('installation', () => {
  it('is idempotent, and installed once at boot rather than per window', () => {
    expect(SOURCE).toMatch(/if \(document\.getElementById\(STYLE_ID\)\) return;/);
    const main = readFileSync(join(process.cwd(), 'src', 'main.ts'), 'utf8');
    expect(main).toContain('installAppChrome()');
  });
});
