/**
 * config/ollama.ts — where the local model lives, and whether it is answering.
 *
 * One definition, because there were four. The tutor, the ticket generator,
 * the Settings page and the Electron main process each carried their own copy
 * of the host and the model name, and two of them carried their own copy of
 * the availability probe. Changing the model would have meant changing it in
 * three files and finding out later which one was missed — the same drift this
 * project has spent its life removing from the capability registry, the host
 * identity and the company name.
 *
 * The main process keeps its own literal, and has to: it is CommonJS and
 * cannot import a TypeScript module. That copy is checked against this one by
 * tests/ollamaConfig.test.ts rather than trusted.
 */

/** Where Ollama listens by default. */
export const OLLAMA_HOST = 'http://localhost:11434';

/**
 * The model the tutor and the ticket generator ask for.
 *
 * Small on purpose. A learner is asked to install one thing, and it has to be
 * something that runs on an ordinary laptop without a GPU.
 */
export const OLLAMA_MODEL = 'llama3.2';

/** Where to get it. Opened in the real browser from Settings. */
export const OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download';

/** The command Settings tells the learner to run. */
export const OLLAMA_PULL_COMMAND = `ollama pull ${OLLAMA_MODEL}`;

export const OLLAMA_TAGS_URL = `${OLLAMA_HOST}/api/tags`;
export const OLLAMA_GENERATE_URL = `${OLLAMA_HOST}/api/generate`;

/**
 * Whether a local Ollama is answering right now.
 *
 * Asked fresh every time rather than cached: the learner may start it while
 * the workstation is already open, and a cached "no" would tell them their
 * install did not work when it did.
 */
export async function ollamaAvailable(timeoutMs = 1200): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(OLLAMA_TAGS_URL, { signal: ctl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    // Unreachable, refused, aborted — all the same answer to the only
    // question being asked.
    return false;
  }
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

/**
 * POST to /api/generate or /api/chat with stream:true and hand every partial
 * reply to `onText` as it grows, so a long answer from a CPU model appears
 * word by word instead of after minutes of "…".
 *
 * The timeout is an IDLE timeout: it only fires when no token has arrived
 * for `idleMs` (loading a model counts as the first wait). A slow model that
 * keeps producing is never cut off; `totalMs` is a last-resort ceiling.
 *
 * Returns the full text, the partial text if the stream broke midway, or null
 * if nothing arrived — the caller then falls back to its offline reply.
 */
export async function ollamaStream(
  url: string,
  body: Record<string, unknown>,
  onText: (text: string) => void,
  opts: { idleMs?: number; totalMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<string | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ctl = new AbortController();
  let idle = setTimeout(() => ctl.abort(), opts.idleMs ?? 180_000);
  const total = setTimeout(() => ctl.abort(), opts.totalMs ?? 900_000);
  const bump = (): void => {
    clearTimeout(idle);
    idle = setTimeout(() => ctl.abort(), opts.idleMs ?? 180_000);
  };
  let text = '';
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, stream: true }),
      signal: ctl.signal,
    });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bump();
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const chunk = JSON.parse(line) as { response?: string; message?: { content?: string }; done?: boolean };
        const piece = chunk.response ?? chunk.message?.content ?? '';
        if (piece) {
          text += piece;
          onText(text);
        }
      }
    }
    return text.trim() ? text : null;
  } catch {
    return text.trim() ? text : null;
  } finally {
    clearTimeout(idle);
    clearTimeout(total);
  }
}

// ---------------------------------------------------------------------------
// Model selection
// ---------------------------------------------------------------------------

const MODEL_KEY = 'ollama_model';

/**
 * The model every AI feature asks for: the learner's choice from Settings,
 * else OLLAMA_MODEL. Read at call time, so a change in Settings reaches the
 * next question without a restart.
 */
export function getOllamaModel(): string {
  try {
    const v = typeof localStorage === 'undefined' ? null : localStorage.getItem(MODEL_KEY);
    return v && v.trim() ? v.trim() : OLLAMA_MODEL;
  } catch {
    return OLLAMA_MODEL;
  }
}

/** The model the learner explicitly picked in Settings, or null if they never did. */
export function getChosenOllamaModel(): string | null {
  try {
    const v = typeof localStorage === 'undefined' ? null : localStorage.getItem(MODEL_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/** Remember the learner's choice; null goes back to the default. */
export function setOllamaModel(name: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (name && name.trim()) localStorage.setItem(MODEL_KEY, name.trim());
    else localStorage.removeItem(MODEL_KEY);
  } catch {
    // Storage blocked: the default model still works.
  }
}

/**
 * Models installed in the local Ollama, by name (e.g. "llama3.2:latest").
 * Null when Ollama is not answering — distinct from "answering, but empty".
 */
export async function listOllamaModels(
  timeoutMs = 1500,
  fetchImpl: typeof fetch = fetch,
): Promise<string[] | null> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetchImpl(OLLAMA_TAGS_URL, { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { models?: { name?: string }[] };
    return (data.models ?? []).map((m) => m.name ?? '').filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * The installed model to use for `preferred`: an exact or ":latest" match,
 * else any tag of it, else the first installed model, else null. Lets the
 * app work with whatever the learner has pulled instead of insisting on one.
 */
export function pickInstalledModel(installed: readonly string[], preferred: string): string | null {
  const p = preferred.toLowerCase();
  const exact = installed.find((m) => m.toLowerCase() === p || m.toLowerCase() === `${p}:latest`);
  if (exact) return exact;
  const tagged = installed.find((m) => m.toLowerCase().startsWith(`${p}:`));
  if (tagged) return tagged;
  return installed[0] ?? null;
}
