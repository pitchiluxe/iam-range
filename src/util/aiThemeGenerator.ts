/**
 * util/aiThemeGenerator.ts — ask the local model for a colour scheme.
 *
 * The wallpaper generator (wallpaperGenerator.ts) draws from a seed because
 * there is no image model behind this app and never will be — Ollama only
 * returns text. A theme, unlike a wallpaper, *is* text: fifteen colour
 * strings and a light/dark flag, which is exactly the shape `Theme.tokens`
 * already is. So this asks Ollama for that JSON directly, in Ollama's own
 * `format: "json"` mode, and applies it through the same `Theme` type every
 * preset uses — no new rendering path, no image, no lie about what "AI
 * generated" means here.
 *
 * No text prompt from the learner — one button, like the wallpaper
 * generator's. A random style hint picked locally (never shown as the
 * theme's name) seeds variety across clicks; the model still invents the
 * actual palette and names it itself, so the result reads as the model's
 * idea, not an echo of a word we picked.
 *
 * Unlike the tutor, a failure here does not fall back to something else. The
 * tutor's job is to answer a question, and an offline answer is still an
 * answer. This button's only job is to generate a theme; if it can't, the
 * caller needs to know why, not receive a quiet no-op.
 */
import { OLLAMA_GENERATE_URL, getOllamaModel, ollamaAvailable } from '@/config/ollama';
import type { Theme } from '@/ui/themes';

const TOKEN_KEYS = [
  'panel',
  'panelAlt',
  'bg',
  'fg',
  'muted',
  'border',
  'accent',
  'onAccent',
  'err',
  'warn',
  'glassTop',
  'glassBottom',
  'glassBorder',
  'glassText',
  'glassHover',
] as const;

export type AiThemeResult = { ok: true; theme: Theme } | { ok: false; error: string };

/** Inspiration only — never surfaced as the theme's name. One is picked at
 *  random per call so repeated clicks don't converge on the same palette. */
const STYLE_HINTS = [
  'cyberpunk neon',
  'desert sunset',
  'arctic ice',
  'retro terminal green',
  'coral reef',
  'volcanic ember',
  'lavender fields',
  'film noir',
  'brutalist concrete',
  'cherry blossom',
  'deep space',
  'autumn forest',
  'neon Tokyo night',
  'monochrome ink',
  'copper industrial',
  'tropical dusk',
  'glacier blue',
  'aurora borealis',
  'moss and stone',
  'vaporwave',
];

function randomHint(): string {
  return STYLE_HINTS[Math.floor(Math.random() * STYLE_HINTS.length)]!;
}

const SYSTEM = [
  'You design colour themes for a desktop operating system UI.',
  'Reply with ONLY a JSON object, no prose, no markdown fences, matching this exact shape:',
  '{',
  '  "name": "a short 2-4 word evocative name for this theme",',
  '  "mode": "dark" or "light",',
  '  "panel": "#rrggbb",       // window body background',
  '  "panelAlt": "#rrggbb",    // a slightly raised surface (toolbars)',
  '  "bg": "#rrggbb",          // desktop background behind windows',
  '  "fg": "#rrggbb",          // primary text colour',
  '  "muted": "#rrggbb",       // secondary/dim text colour',
  '  "border": "#rrggbb",      // hairline borders',
  '  "accent": "#rrggbb",      // the theme\'s signature colour',
  '  "onAccent": "#rrggbb",    // text/icon colour placed ON TOP of accent',
  '  "err": "#rrggbb",         // error colour, must read clearly as a warning',
  '  "warn": "#rrggbb",        // warning colour',
  '  "glassTop": "rgba(r,g,b,a)",    // taskbar/titlebar gradient top',
  '  "glassBottom": "rgba(r,g,b,a)", // taskbar/titlebar gradient bottom',
  '  "glassBorder": "rgba(r,g,b,a)", // taskbar/titlebar border',
  '  "glassText": "#rrggbb",         // text on the taskbar/titlebar',
  '  "glassHover": "rgba(r,g,b,a)"   // hover state on the taskbar/titlebar',
  '}',
  'Every colour must have real contrast against what it sits on — fg readable on panel/bg,',
  'onAccent readable on accent, glassText readable on the glass gradient. Pick "mode": "light"',
  'only if panel/bg are genuinely light colours; otherwise use "dark".',
].join('\n');

function buildPrompt(hint: string): string {
  return (
    `${SYSTEM}\n\nInvent an original desktop theme loosely inspired by the mood of ` +
    `"${hint}" — do not name it after that phrase, invent your own name for what you design.\n\nJSON:`
  );
}

/** True if the string is a plausible CSS colour — hex or rgb/rgba(). Loose on
 *  purpose: this rejects garbage (empty string, prose, a stray word) without
 *  policing every legal CSS colour syntax the model might reasonably use. */
function looksLikeColor(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0 && /^(#|rgba?\()/i.test(v.trim());
}

/** Pull the first {...} block out of the reply. `format: 'json'` almost
 *  always makes this unnecessary, but a small local model still sometimes
 *  wraps the object in a sentence or a code fence. */
function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('no JSON object in the reply');
  return JSON.parse(text.slice(start, end + 1));
}

function validateTokens(raw: unknown): Theme['tokens'] {
  if (typeof raw !== 'object' || raw === null) throw new Error('reply was not a JSON object');
  const obj = raw as Record<string, unknown>;
  const missing = TOKEN_KEYS.filter((k) => !looksLikeColor(obj[k]));
  if (missing.length > 0) throw new Error(`missing or invalid colour(s): ${missing.join(', ')}`);
  const tokens = {} as Theme['tokens'];
  for (const k of TOKEN_KEYS) tokens[k] = (obj[k] as string).trim();
  return tokens;
}

function validateMode(raw: unknown): 'dark' | 'light' {
  return raw === 'light' ? 'light' : 'dark';
}

/** The model names its own creation; this only guards against an empty or
 *  absurdly long reply, it does not second-guess the model's wording. */
function validateName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) return 'AI Theme';
  return name.length > 32 ? `${name.slice(0, 31).trimEnd()}…` : name;
}

export async function generateThemeWithAI(
  opts: { timeoutMs?: number } = {},
): Promise<AiThemeResult> {
  if (!(await ollamaAvailable())) {
    return { ok: false, error: 'Ollama is not running. Start it, then try again.' };
  }

  const hint = randomHint();

  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 60_000);
    const res = await fetch(OLLAMA_GENERATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: getOllamaModel(),
        prompt: buildPrompt(hint),
        format: 'json',
        stream: false,
        // Higher temperature than the tutor's: repeated clicks on the same
        // hint pool should not keep landing on the same few palettes.
        options: { temperature: 0.95, num_predict: 400 },
      }),
      signal: ctl.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return { ok: false, error: `Ollama returned an error (HTTP ${res.status}).` };

    const data = (await res.json()) as { response?: string };
    if (!data.response?.trim()) return { ok: false, error: 'Ollama returned an empty reply.' };

    const parsed = extractJson(data.response);
    const tokens = validateTokens(parsed);
    const record = parsed as Record<string, unknown>;
    const mode = validateMode(record.mode);
    const name = validateName(record.name);

    const theme: Theme = {
      id: 'ai-custom',
      label: name,
      note: `AI-generated · inspired by "${hint}"`,
      mode,
      tokens,
    };
    return { ok: true, theme };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      return { ok: false, error: 'Ollama took too long to respond.' };
    }
    return { ok: false, error: e instanceof Error ? e.message : 'Could not generate a theme.' };
  }
}
