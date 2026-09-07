/**
 * tests/screenRecorder.test.ts — record this window, and ask nobody else's
 * permission for it.
 *
 * Recording a lab means two new capabilities: something that produces video,
 * and a microphone. Both are the kind of thing that is easy to over-grant and
 * impossible to withdraw once a build has shipped.
 *
 * The video is built from repeated capturePage frames rather than
 * getDisplayMedia or desktopCapturer, so it can only ever contain this window
 * — by construction, not by policy. That is asserted here because it is the
 * property somebody would quietly lose while "improving the frame rate".
 *
 * The microphone is granted to the workstation's own document and to nothing
 * else. This window renders arbitrary pages inside a webview, and before the
 * recorder there was no permission handler at all, so the default applied to
 * whatever a learner browsed to.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canRecord } from '@/util/screenRecorder';

/** Source with comments removed: prose about an API is not a use of it. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const MAIN = readFileSync(join(process.cwd(), 'electron', 'main.cjs'), 'utf8');
const RECORDER = readFileSync(join(process.cwd(), 'src', 'util', 'screenRecorder.ts'), 'utf8');

describe('what the recorder can see', () => {
  it('never reaches for the whole screen', () => {
    // getDisplayMedia and desktopCapturer both hand over everything behind
    // the window. Somebody recording a lab is not consenting to publish
    // their mail.
    const source = code(RECORDER);
    expect(source).not.toContain('getDisplayMedia');
    expect(source).not.toContain('desktopCapturer');
  });

  it('builds its video from the window capture that already exists', () => {
    expect(RECORDER).toContain('captureScreen');
    expect(RECORDER).toContain('captureStream');
  });

  it('asks only for audio when it asks for a device', () => {
    // getUserMedia({ video: true }) would turn on the webcam, which is not
    // what "record my lab" means to anybody.
    const calls = code(RECORDER).match(/getUserMedia\([^)]*\)/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('audio');
    expect(calls[0]).not.toContain('video');
  });
});

describe('who may use the microphone', () => {
  it('has a permission handler at all', () => {
    // There was none before this. The default applied to every page the
    // in-VM browser loads.
    expect(MAIN).toContain('setPermissionRequestHandler');
    expect(MAIN).toContain('setPermissionCheckHandler');
  });

  it('grants only media, and only to the application itself', () => {
    const handler = MAIN.slice(
      MAIN.indexOf('setPermissionRequestHandler'),
      MAIN.indexOf('setPermissionCheckHandler'),
    );
    expect(handler).toContain("'media'");
    expect(handler).toContain('file://');
    // Everything else is refused rather than falling through to a default.
    expect(handler).toContain('callback(false)');
  });

  it('applies the same rule to the synchronous check', () => {
    // Two handlers that disagree is a hole that only shows up in one code
    // path, which is the worst kind.
    const check = MAIN.slice(MAIN.indexOf('setPermissionCheckHandler'));
    expect(check.slice(0, 400)).toContain("'media'");
    expect(check.slice(0, 400)).toContain('file://');
  });
});

describe('availability', () => {
  it('reports honestly when the runtime cannot record', () => {
    // No MediaRecorder in the test environment, which is the same answer a
    // browser without it would give. The caller shows a message rather than
    // offering a button that fails.
    expect(canRecord()).toBe(false);
  });
});

describe('the recording itself', () => {
  it('keeps the frame rate inside what capturePage can sustain', () => {
    // capturePage is far heavier than a compositor tap. Asking for sixty
    // would queue frames faster than they can be produced.
    expect(RECORDER).toMatch(/Math\.min\(15/);
  });

  it('paces with setTimeout rather than setInterval', () => {
    // An interval does not wait for the previous frame, so a slow capture
    // stacks work until the window stops responding.
    const loop = RECORDER.slice(RECORDER.indexOf('const pump'));
    expect(loop).toContain('setTimeout');
    expect(loop).not.toContain('setInterval');
  });

  it('still records when the microphone is refused', () => {
    // Losing the walkthrough because narration was declined would be the
    // wrong trade.
    expect(RECORDER).toMatch(/micStream = null;/);
  });

  it('stops every track it started', () => {
    // A live microphone track after the recording ends is a light left on.
    const stop = RECORDER.slice(RECORDER.indexOf('recorder.onstop'));
    expect(stop).toContain('track.stop()');
    expect(stop).toContain('micStream?.getTracks()');
  });
});
