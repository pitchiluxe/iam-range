/**
 * tests/screenCapture.test.ts — photograph this window, and nothing else.
 *
 * The capability being added here is a page taking a picture. The difference
 * between capturePage and desktopCapturer is the difference between
 * photographing the training VM and photographing whatever else the user has
 * open — their mail, their password manager, their bank. One of those is a
 * feature and the other is a camera pointed at somebody's desk, and a training
 * application has no business holding it.
 *
 * So the first assertions are about the main process never offering the wider
 * capability, not about the picture. The rest are the fallback: in a browser
 * there is no capture, and the tool has to say so rather than throw, because a
 * tool that raises an exception for running in a tab looks broken.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canCaptureScreen, captureScreen } from '@/util/screenCapture';

/** Source with comments removed: prose about an API is not a use of it. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const MAIN = readFileSync(join(process.cwd(), 'electron', 'main.cjs'), 'utf8');
const PRELOAD = readFileSync(join(process.cwd(), 'electron', 'preload.cjs'), 'utf8');

type W = typeof globalThis & { electron?: { invoke: (c: string) => Promise<unknown> } };

afterEach(() => {
  delete (globalThis as W).electron;
});

describe('what the main process will photograph', () => {
  it('captures this window and never the desktop', () => {
    expect(MAIN).toContain('capturePage');
    // Comments stripped first: main.cjs explains at length why it does not
    // use desktopCapturer, and a naive match reads that explanation as the
    // very thing it rules out.
    const source = code(MAIN);
    expect(source).not.toContain('desktopCapturer');
    expect(source).not.toContain('getUserMedia');
  });

  it('returns nothing rather than throwing when there is no window', () => {
    const handler = MAIN.slice(MAIN.indexOf("ipcMain.handle('capture:screen'"));
    expect(handler.slice(0, 700)).toMatch(/isDestroyed\(\)/);
    expect(handler.slice(0, 700)).toMatch(/catch/);
  });

  it('exposes no new surface in the preload beyond the existing invoke', () => {
    // Capture rides the channel that already exists. A dedicated bridge
    // function would be one more thing to get wrong.
    expect(code(PRELOAD)).not.toContain('capture');
  });
});

describe('in a browser, where there is no capture', () => {
  it('reports that it cannot capture', () => {
    expect(canCaptureScreen()).toBe(false);
  });

  it('resolves null instead of throwing', async () => {
    // The caller offers "open or paste an image" on null. An exception would
    // make the tool look broken rather than unavailable.
    await expect(captureScreen()).resolves.toBeNull();
  });
});

describe('in the installed application', () => {
  it('reports that it can capture', () => {
    (globalThis as W).electron = { invoke: async () => null };
    expect(canCaptureScreen()).toBe(true);
  });

  it('passes a PNG data URL through', async () => {
    const png = 'data:image/png;base64,AAAA';
    (globalThis as W).electron = { invoke: async () => png };
    await expect(captureScreen()).resolves.toBe(png);
  });

  it('refuses anything that is not an image data URL', async () => {
    // The renderer sets this straight onto an <img> src. Whatever the main
    // process returns, only a data image is honoured.
    for (const bad of ['https://example.com/x.png', 'javascript:alert(1)', '', 42, null]) {
      (globalThis as W).electron = { invoke: async () => bad };
      await expect(captureScreen(), String(bad)).resolves.toBeNull();
    }
  });

  it('resolves null when the bridge rejects', async () => {
    (globalThis as W).electron = {
      invoke: async () => {
        throw new Error('main process went away');
      },
    };
    await expect(captureScreen()).resolves.toBeNull();
  });
});
