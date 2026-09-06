/**
 * ui/audio.ts — minimal Web Audio synth for game cues.
 * Generates short, soft tones for console activation, step completion, and lab done.
 * AudioContext is created on first user gesture (click) to satisfy autoplay policies.
 */

let ctx: AudioContext | null = null;

const MUTE_KEY = 'settings_sound_muted';
let muted = localStorage.getItem(MUTE_KEY) === 'true';

/** Read the current mute state (mirrors what the Settings app shows). */
export function isMuted(): boolean {
  return muted;
}

/** Set and persist the mute state — used by the Settings app's Sound toggle. */
export function setMuted(v: boolean): void {
  muted = v;
  try {
    localStorage.setItem(MUTE_KEY, String(v));
  } catch {
    /* ignore */
  }
}

function ensureCtx(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const AC =
      (
        window as unknown as {
          AudioContext?: typeof AudioContext;
          webkitAudioContext?: typeof AudioContext;
        }
      ).AudioContext ??
      (
        window as unknown as {
          AudioContext?: typeof AudioContext;
          webkitAudioContext?: typeof AudioContext;
        }
      ).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  } catch {
    return null;
  }
  return ctx;
}

/** A soft short blip. */
export function blip(freq = 440, durMs = 80, vol = 0.05): void {
  if (muted) return;
  const c = ensureCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.frequency.value = freq;
  osc.type = 'sine';
  gain.gain.value = 0;
  gain.gain.linearRampToValueAtTime(vol, c.currentTime + 0.005);
  gain.gain.linearRampToValueAtTime(0, c.currentTime + durMs / 1000);
  osc.connect(gain).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + durMs / 1000);
}

/** A rising triad for "step done". */
export function chime(): void {
  blip(523, 100, 0.06); // C
  setTimeout(() => blip(659, 100, 0.06), 60); // E
  setTimeout(() => blip(784, 140, 0.07), 120); // G
}

/** A descending pair for "lab done". */
export function fanfare(): void {
  blip(523, 120, 0.07);
  setTimeout(() => blip(659, 120, 0.07), 100);
  setTimeout(() => blip(880, 200, 0.08), 220);
}

/** A three-tone ascending alert for a newly-arrived urgent ticket. */
export function urgentAlert(): void {
  blip(880, 150, 0.08);
  setTimeout(() => blip(1100, 150, 0.08), 100);
  setTimeout(() => blip(1320, 200, 0.08), 200);
}

/** A short two-tone blip for a normal/low-priority ticket. */
export function ticketBlip(): void {
  blip(440, 80, 0.04);
}

/** A short gentle confirmation for a successful ticket resolution. */
export function ticketResolved(): void {
  blip(523, 80, 0.04);
  setTimeout(() => blip(659, 100, 0.04), 60);
}

/** A descending sad-tone for a failure/error feedback (e.g. SLA overdue). */
export function errorTone(): void {
  blip(440, 120, 0.06);
  setTimeout(() => blip(330, 160, 0.07), 100);
}
