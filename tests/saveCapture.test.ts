/**
 * tests/saveCapture.test.ts — "Saved." has to mean a file exists.
 *
 * The two capture tools both reported success unconditionally. What they
 * actually did was write the literal string "[png image] evidence-....png"
 * into the in-VM filesystem and click an <a download> that was never attached
 * to the document. So the toast said Saved, File Explorer listed a name with
 * nothing behind it, and in the packaged application the download frequently
 * went nowhere at all. Three ways to end up with no file and no indication.
 *
 * These assert the three things that were wrong:
 *
 *   1. the in-VM copy holds the real bytes, as a data URL, rather than a
 *      description of them;
 *   2. the message follows what happened rather than being written in
 *      advance; and
 *   3. a failure on one route does not take the other down with it.
 *
 * The environment here has no FileReader and no DOM, which is exactly the
 * shape of the awkward case: saveCapture has to survive a route being
 * unavailable and still do the rest.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { saveCapture, describeSave, toDataUrl } from '@/util/saveCapture';
import { FS } from '@/terminal/shellIntrinsics';

/**
 * The globals this module reaches for, as optional properties.
 *
 * `typeof globalThis &` would inherit the DOM's own declarations, which are
 * neither optional nor satisfied by a stub — the point here is that none of
 * them exist in node and the code has to cope.
 */
interface Global {
  FileReader?: unknown;
  document?: unknown;
  window?: unknown;
  electron?: { invoke: (cmd: string, payload?: unknown) => Promise<unknown> };
}

const g = globalThis as unknown as Global;

/** The FileReader the browser has and node does not. */
class StubFileReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(blob: Blob): void {
    void blob.arrayBuffer().then((buf) => {
      const b64 = Buffer.from(buf).toString('base64');
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${b64}`;
      this.onload?.();
    });
  }
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (): Blob => new Blob([PNG_BYTES], { type: 'image/png' });

beforeEach(() => {
  g.FileReader = StubFileReader;
});

afterEach(() => {
  delete g.FileReader;
  delete g.electron;
  delete g.document;
  delete g.window;
  vi.restoreAllMocks();
});

describe('reading a capture', () => {
  it('produces a data URL carrying the real bytes', async () => {
    const url = await toDataUrl(png());
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    const b64 = url.slice(url.indexOf(',') + 1);
    expect(Buffer.from(b64, 'base64').equals(Buffer.from(PNG_BYTES))).toBe(true);
  });
});

describe('in the installed application', () => {
  it('writes the real file and reports the path it wrote', async () => {
    const seen: { name?: string; base64?: string } = {};
    g.electron = {
      invoke: async (cmd, payload) => {
        expect(cmd).toBe('capture:save');
        Object.assign(seen, payload);
        return 'C:\\Users\\erick\\Documents\\IAM Range\\evidence.png';
      },
    };

    const result = await saveCapture(png(), 'evidence.png');
    expect(result.path).toBe('C:\\Users\\erick\\Documents\\IAM Range\\evidence.png');
    // No download when a real file was written: two copies of the same
    // capture in two places is a mess, not a safety net.
    expect(result.downloaded).toBe(false);
    // Bare base64 crosses the bridge, not a data URL the main process would
    // have to parse.
    expect(seen.name).toBe('evidence.png');
    expect(Buffer.from(seen.base64 ?? '', 'base64').equals(Buffer.from(PNG_BYTES))).toBe(true);
  });

  it('names the real path in the message', async () => {
    const result = { path: 'C:\\x\\y.png', downloaded: false, inVm: true };
    expect(describeSave(result, 'y.png')).toContain('C:\\x\\y.png');
  });
});

describe('the copy the lab can see', () => {
  it('holds the image itself, not a description of it', async () => {
    // The old behaviour wrote "[png image] evidence.png" — a filename inside
    // a file, which File Explorer listed and nothing could open.
    g.electron = { invoke: async () => 'C:\\somewhere\\evidence.png' };
    await saveCapture(png(), 'evidence.png');

    const written = FS.readFile('C:\\Users\\admin\\Documents\\evidence.png');
    expect(written).not.toContain('[png image]');
    expect(written?.startsWith('data:image/png;base64,')).toBe(true);
  });
});

describe('when a route is unavailable', () => {
  it('still writes the in-VM copy when the real write fails', async () => {
    g.electron = {
      invoke: async () => {
        throw new Error('main process went away');
      },
    };
    const result = await saveCapture(png(), 'fallback.png');
    expect(result.path).toBeUndefined();
    expect(result.inVm).toBe(true);
    expect(FS.readFile('C:\\Users\\admin\\Documents\\fallback.png')).toContain('base64,');
  });

  it('never throws when there is no DOM to download into', async () => {
    // No electron and no document: both routes gone. The caller shows a
    // message and carries on rather than the tool appearing to crash.
    await expect(saveCapture(png(), 'nowhere.png')).resolves.toMatchObject({
      downloaded: false,
    });
  });

  it('says nothing was saved rather than claiming success', () => {
    // The specific bug: "Saved." printed whatever happened.
    expect(describeSave({ downloaded: false, inVm: false }, 'x.png')).toMatch(/could not be saved/);
  });
});
