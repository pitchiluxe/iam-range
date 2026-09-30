/**
 * tests/desktopLayout.test.ts — icons stay where you drop them, and every
 * Remote Desktop session has a terminal.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { layoutIcons } from '@/util/desktopIcons';

describe('desktop icon layout', () => {
  it('keeps a dropped icon in its cell and flows the rest around it', () => {
    const cells = layoutIcons(['a', 'b', 'c'], 2, { c: { col: 0, row: 0 } }, false);
    expect(cells.c).toEqual({ col: 0, row: 0 });
    expect(cells.a).toEqual({ col: 0, row: 1 });
    expect(cells.b).toEqual({ col: 1, row: 0 });
  });

  it('never stacks two icons in one cell, and ignores cells off the screen', () => {
    const cells = layoutIcons(['a', 'b'], 3, { a: { col: 4, row: 1 }, b: { col: 4, row: 1 } }, false);
    expect(cells.a).toEqual({ col: 4, row: 1 });
    expect(cells.b).not.toEqual(cells.a);
    expect(layoutIcons(['a'], 3, { a: { col: 0, row: 9 } }, false).a).toEqual({ col: 0, row: 0 });
  });

  it('auto arrange packs icons in order, whatever was saved', () => {
    const cells = layoutIcons(['a', 'b', 'c'], 2, { a: { col: 5, row: 1 } }, true);
    expect(cells).toEqual({ a: { col: 0, row: 0 }, b: { col: 0, row: 1 }, c: { col: 1, row: 0 } });
  });
});

describe('Remote Desktop sessions', () => {
  it('always offer the terminal, pinned to the taskbar', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'ui', 'consoles', 'remoteSessionDesktop.ts'), 'utf8');
    expect(src).toMatch(/\.\.\.appsForDepartment\(user\.department\),\s*\/\/[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*'terminal',/);
    expect(src).toMatch(/TASKBAR_PINS = \[[^\]]*'terminal'/);
  });
});
