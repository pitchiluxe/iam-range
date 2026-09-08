/**
 * tests/screenRecorder.test.ts — recording a walkthrough, and cleaning up after.
 *
 * The recorder used to be built from repeated window captures, and this file
 * asserted it could never be anything else: no getDisplayMedia, no camera, one
 * getUserMedia call and audio only. That produced ten frames a second of the
 * application's own window, which is not a tutorial — the screen being
 * explained is the real one, and the person explaining it should be visible.
 *
 * So both capabilities are now used, and what is asserted is the discipline
 * around them. Three things, in order of how quietly they would break:
 *
 *   1. Every device this opens gets stopped. A camera left running after a
 *      recording ends is a light on somebody's face with nothing recording it,
 *      and it is invisible in every test that only checks the output file.
 *   2. The share ending from outside — the browser's own "stop sharing" bar —
 *      finalises the recording. Unhandled, the canvas compositor keeps drawing
 *      the last frame it saw and the file ends in a still image.
 *   3. The webview fence is untouched. Widening what the workstation's own
 *      document may do must not widen what a page loaded in the in-VM browser
 *      may do, and those two go through the same permission handler.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canRecord, canRecordCamera } from '@/util/screenRecorder';

/** Source with comments removed: prose about an API is not a use of it. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const MAIN = readFileSync(join(process.cwd(), 'electron', 'main.cjs'), 'utf8');
const RECORDER = readFileSync(join(process.cwd(), 'src', 'util', 'screenRecorder.ts'), 'utf8');
const SOURCE = code(RECORDER);

describe('what the recorder composes', () => {
  it('records the screen the user picked', () => {
    expect(SOURCE).toContain('getDisplayMedia');
  });

  it('draws both tracks into one canvas, because a recorder writes one video', () => {
    // MediaRecorder cannot be handed two video tracks and told to overlay
    // one. The canvas is what makes the picture-in-picture possible at all.
    expect(SOURCE).toContain('captureStream');
    expect(SOURCE).toContain('requestAnimationFrame');
  });

  it('asks for the camera and the microphone separately', () => {
    // One combined getUserMedia would mean a refused camera costs the
    // narration too, which is the more valuable of the two.
    const calls = SOURCE.match(/getUserMedia\(\{[\s\S]*?\}\)/g) ?? [];
    expect(calls.length).toBe(2);
    expect(calls.some((c) => c.includes('video') && c.includes('audio: false'))).toBe(true);
    expect(calls.some((c) => c.includes('echoCancellation'))).toBe(true);
  });

  it('records without the camera when it is refused', () => {
    // Losing the walkthrough over a declined webcam would be the wrong trade.
    expect(SOURCE).toMatch(/cameraVideo = null;/);
  });

  it('records without narration when the microphone is refused', () => {
    expect(SOURCE).toMatch(/micStream = null;/);
  });

  it('mixes system audio under the voice rather than over it', () => {
    // Two audio tracks, one output. Full-level system audio talks over the
    // person explaining what is on screen.
    expect(SOURCE).toContain('createMediaStreamDestination');
    expect(SOURCE).toMatch(/sysGain\.gain\.value = 0\.\d/);
  });
});

describe('cleaning up', () => {
  it('stops every stream it opened, camera included', () => {
    // cleanup collects the screen, the camera and the microphone, and stopAll
    // is what turns the camera light off.
    expect(SOURCE).toContain('const cleanup: MediaStream[]');
    expect(SOURCE).toMatch(/for \(const s of cleanup\) for \(const t of s\.getTracks\(\)\) t\.stop\(\)/);
    const finish = SOURCE.slice(SOURCE.indexOf('const finish'));
    expect(finish).toContain('stopAll()');
    expect(finish).toContain('cancelAnimationFrame');
  });

  it('closes the audio graph', () => {
    // An AudioContext left open holds the audio device awake.
    expect(SOURCE).toContain('audioCtx?.close()');
  });

  it('finalises when the user stops sharing from the browser bar', () => {
    // Otherwise the compositor keeps painting the last frame it saw and the
    // recording ends in a freeze rather than at the moment it stopped.
    expect(SOURCE).toContain("addEventListener('ended'");
    expect(SOURCE).toContain('opts.onEnded');
  });

  it('stops only once, however many ways stop is reached', () => {
    // The toolbar button and the 'ended' handler can both fire. A second
    // recorder.stop() on an inactive recorder throws.
    expect(SOURCE).toContain('if (stopped) return stopped;');
  });
});

describe('who may use the camera and microphone', () => {
  it('has a permission handler at all', () => {
    // There was none before the recorder existed. The default applied to
    // every page the in-VM browser loads.
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
    // No MediaRecorder and no mediaDevices in the test environment, which is
    // the same answer a browser without them would give. The caller shows a
    // message rather than offering a button that fails.
    expect(canRecord()).toBe(false);
    expect(canRecordCamera()).toBe(false);
  });
});
