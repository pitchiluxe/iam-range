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
