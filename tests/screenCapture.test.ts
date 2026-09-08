/**
 * tests/screenCapture.test.ts — two captures, and the fence around the wider one.
 *
 * This file used to assert that the application could never photograph
 * anything but its own window: no desktopCapturer, no getDisplayMedia, no
 * exceptions. That was the right call for an evidence tool and the wrong one
 * for the workstation people actually record tutorials on, where the whole
 * point is to show a real screen. Snip also did nothing at all on the web
 * build, because the window capture is Electron-only and there was no
 * fallback.
 *
 * So the capability is now present, and what is asserted is the shape of it:
 *
 *   - the silent window capture still exists and is still preferred, because
 *     it is the one that needs no picker and can contain nothing else;
 *   - the wider capture cannot happen without the user choosing a source, and
 *     the choice is never made for them;
 *   - a capture written to the real disk cannot escape the folder it belongs
 *     in, whatever filename the renderer sends.
 *
 * The last one is the part a bug would be quiet about. Everything else fails
 * loudly the first time somebody tries it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  canCaptureScreen,
  canCaptureWindow,
  captureWindow,
  captureScreen,
} from '@/util/screenCapture';

/** Source with comments removed: prose about an API is not a use of it. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const MAIN = readFileSync(join(process.cwd(), 'electron', 'main.cjs'), 'utf8');
const PRELOAD = readFileSync(join(process.cwd(), 'electron', 'preload.cjs'), 'utf8');
const CAPTURE = readFileSync(join(process.cwd(), 'src', 'util', 'screenCapture.ts'), 'utf8');

type W = typeof globalThis & { electron?: { invoke: (c: string) => Promise<unknown> } };

afterEach(() => {
  delete (globalThis as W).electron;
});

describe('the window capture', () => {
  it('is still capturePage, so it can contain nothing but this window', () => {
    expect(MAIN).toContain('capturePage');
  });

  it('returns nothing rather than throwing when there is no window', () => {
    const handler = MAIN.slice(MAIN.indexOf("ipcMain.handle('capture:screen'"));
    expect(handler.slice(0, 700)).toMatch(/isDestroyed\(\)/);
    expect(handler.slice(0, 700)).toMatch(/catch/);
  });

  it('is preferred over the picker, so evidence needs no share indicator', () => {
    // captureScreen falls through to the picker only when the window capture
    // gave nothing. Reversing these would put a permission prompt in front of
    // every snip in the installed application.
    const fn = code(CAPTURE).slice(code(CAPTURE).indexOf('export async function captureScreen'));
    expect(fn.indexOf('captureWindow')).toBeLessThan(fn.indexOf('captureDisplay'));
  });
});

describe('the screen picker', () => {
  it('never chooses a source itself', () => {
    // The main process asks the renderer and waits. A handler that picked
    // sources[0] would be a screen share the user never agreed to.
    const handler = MAIN.slice(MAIN.indexOf('setDisplayMediaRequestHandler'));
    expect(handler).toContain('askRendererToPick');
    // Nothing is granted when nothing came back.
    expect(handler).toContain('callback({})');
  });

  it('denies rather than hangs when the renderer never answers', () => {
    // This promise gates a permission callback. Without the timeout,
    // getDisplayMedia would stay pending forever with no way out.
    const ask = MAIN.slice(MAIN.indexOf('function askRendererToPick'));
    expect(ask.slice(0, 900)).toContain('setTimeout');
    expect(ask.slice(0, 900)).toContain('resolve(null)');
  });

  it('stops every track after taking its one frame', () => {
    const fn = CAPTURE.slice(CAPTURE.indexOf('export async function captureDisplay'));
    expect(fn).toContain('track.stop()');
    expect(fn).toContain('finally');
  });
});

describe('writing a capture to the real disk', () => {
  const handler = MAIN.slice(MAIN.indexOf("ipcMain.handle('capture:save'"));

  it('reduces the name it was given to a bare filename', () => {
    // The name arrives from the renderer, and a name is not a path.
    expect(handler.slice(0, 900)).toContain('path.basename');
    expect(handler.slice(0, 900)).toMatch(/replace\(\/\[\^A-Za-z0-9\._-\]\/g/);
  });

  it('writes only the two things the capture tools produce', () => {
    expect(handler.slice(0, 900)).toMatch(/png\|webm/);
  });

  it('confines the reveal to the folder it writes into', () => {
    // "Show me this file" must not become "show me any file on the disk".
    const reveal = MAIN.slice(MAIN.indexOf("ipcMain.handle('capture:reveal'"));
    expect(reveal.slice(0, 700)).toContain('startsWith');
    expect(reveal.slice(0, 700)).toContain('path.resolve');
  });
});

describe('the preload surface', () => {
  it('adds only the picker question, and no capture function of its own', () => {
    // Capture still rides the generic invoke channel. The one addition is an
    // event, because the question originates in the main process.
    const source = code(PRELOAD);
    expect(source).toContain('onPickCaptureSource');
    expect(source).not.toContain('captureScreen');
    expect(source).not.toContain('desktopCapturer');
  });
});

describe('in a browser, where there is no window capture', () => {
  it('reports that it cannot capture the window', () => {
    expect(canCaptureWindow()).toBe(false);
  });

  it('resolves null from the window capture instead of throwing', async () => {
    await expect(captureWindow()).resolves.toBeNull();
  });

  it('reports no capture at all when there is no getDisplayMedia either', () => {
    // Which is this test environment: no navigator.mediaDevices.
    expect(canCaptureScreen()).toBe(false);
  });

  it('resolves null rather than throwing when neither route exists', async () => {
    // The caller offers "open or paste an image" on null. An exception would
    // make the tool look broken rather than unavailable.
    await expect(captureScreen()).resolves.toBeNull();
  });
});

describe('in the installed application', () => {
  it('reports that it can capture', () => {
    (globalThis as W).electron = { invoke: async () => null };
    expect(canCaptureWindow()).toBe(true);
    expect(canCaptureScreen()).toBe(true);
  });

  it('passes a PNG data URL through', async () => {
    const png = 'data:image/png;base64,AAAA';
    (globalThis as W).electron = { invoke: async () => png };
    await expect(captureWindow()).resolves.toBe(png);
  });

  it('refuses anything that is not an image data URL', async () => {
    // The renderer sets this straight onto an <img> src. Whatever the main
    // process returns, only a data image is honoured.
    for (const bad of ['https://example.com/x.png', 'javascript:alert(1)', '', 42, null]) {
      (globalThis as W).electron = { invoke: async () => bad };
      await expect(captureWindow(), String(bad)).resolves.toBeNull();
    }
  });

  it('resolves null when the bridge rejects', async () => {
    (globalThis as W).electron = {
      invoke: async () => {
        throw new Error('main process went away');
      },
    };
    await expect(captureWindow()).resolves.toBeNull();
  });
});
