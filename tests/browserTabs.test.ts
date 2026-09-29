/**
 * tests/browserTabs.test.ts — the in-VM browser has tabs, and a page's pop-ups
 * become tabs only through the allowlist.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const browser = readFileSync(join('src', 'ui', 'consoles', 'webBrowserWindow.ts'), 'utf8');
const main = readFileSync(join('electron', 'main.cjs'), 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { build: { files: string[] } };

describe('browser tabs', () => {
  it('opens, closes and switches tabs, each with its own history', () => {
    expect(browser).toMatch(/function newTab\(/);
    expect(browser).toMatch(/const closeTab = /);
    expect(browser).toMatch(/history: \[\], historyPos: -1/);
    expect(browser).toMatch(/k === 't'/);
    expect(browser).toMatch(/k === 'w'/);
    expect(browser).toMatch(/MAX_TABS/);
    // Without it a webview drops every pop-up silently.
    expect(browser).toContain("setAttribute('allowpopups', '')");
  });

  it('opens requests from other windows in a new tab', () => {
    expect(browser).toMatch(/onBrowserOpen\(\(url\) => \{[\s\S]*?newTab\(url\)/);
  });

  it('turns webview pop-ups into tabs only for allowlisted URLs', () => {
    expect(main).toMatch(/require\('\.\.\/shared\/allowlistCheck\.cjs'\)/);
    expect(main).toMatch(/did-attach-webview[\s\S]*?setWindowOpenHandler[\s\S]*?urlAllowed\(url\)[\s\S]*?action: 'deny'/);
    expect(pkg.build.files).toContain('shared/**/*'); // or the require fails in the installed app
  });
});
