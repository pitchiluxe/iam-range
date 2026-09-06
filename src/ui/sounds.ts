/**
 * ui/sounds.ts — system sounds for the workstation.
 *
 * Synthesised with the Web Audio API rather than shipped as files: no assets
 * to bundle, nothing copied from another operating system, and the whole
 * palette is a few dozen lines.
 *
 * Every sound is short and quiet. A workstation that chimes loudly on every
 * click is one the user mutes, and then hears nothing when it matters.
 */

let ctx: AudioContext | null = null;

/** Browsers refuse to start audio before a user gesture; that is fine, the
 *  first click creates it and everything before then is silently skipped. */
function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

const MUTE_KEY = 'vm_sounds_muted';

export function soundsMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setSoundsMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, String(muted));
  } catch {
    /* ignore */
  }
}

interface ToneStep {
  /** Hz. */
  freq: number;
  /** Seconds from the start of the sequence. */
  at: number;
  /** Seconds. */
  dur: number;
  gain?: number;
  type?: OscillatorType;
}

/** Play a short sequence of tones. */
function play(steps: ToneStep[]): void {
  if (soundsMuted()) return;
  const a = audio();
  if (!a) return;

  const now = a.currentTime;
  for (const s of steps) {
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = s.type ?? 'sine';
    osc.frequency.value = s.freq;

    // Short attack and exponential release: a square-edged tone clicks.
    const peak = s.gain ?? 0.08;
    gain.gain.setValueAtTime(0.0001, now + s.at);
    gain.gain.exponentialRampToValueAtTime(peak, now + s.at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + s.at + s.dur);

    osc.connect(gain).connect(a.destination);
    osc.start(now + s.at);
    osc.stop(now + s.at + s.dur + 0.02);
  }
}

/** Signing in — a rising four-note figure. */
export function logonChime(): void {
  play([
    { freq: 587.33, at: 0, dur: 0.18 }, // D5
    { freq: 783.99, at: 0.12, dur: 0.18 }, // G5
    { freq: 987.77, at: 0.24, dur: 0.2 }, // B5
    { freq: 1174.66, at: 0.36, dur: 0.34, gain: 0.06 }, // D6
  ]);
}

/** Signing out — the same figure descending. */
export function logoffChime(): void {
  play([
    { freq: 987.77, at: 0, dur: 0.16 },
    { freq: 783.99, at: 0.11, dur: 0.16 },
    { freq: 587.33, at: 0.22, dur: 0.28, gain: 0.06 },
  ]);
}

/** A refused action: two flat low tones, deliberately unpleasant. */
export function errorBeep(): void {
  play([
    { freq: 220, at: 0, dur: 0.14, gain: 0.09, type: 'triangle' },
    { freq: 207, at: 0.14, dur: 0.2, gain: 0.09, type: 'triangle' },
  ]);
}

/** Something completed. */
export function successChime(): void {
  play([
    { freq: 880, at: 0, dur: 0.1 },
    { freq: 1318.51, at: 0.08, dur: 0.18, gain: 0.06 },
  ]);
}

/** A dialog or notification appearing. */
export function notifyPing(): void {
  play([{ freq: 1046.5, at: 0, dur: 0.12, gain: 0.05 }]);
}

/** Window minimised, closed, or a soft UI transition. */
export function uiClick(): void {
  play([{ freq: 660, at: 0, dur: 0.05, gain: 0.03 }]);
}
