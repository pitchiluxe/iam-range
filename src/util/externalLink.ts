/**
 * util/externalLink.ts — opening a real web page from inside the workstation.
 *
 * The simulated browser inside the OS is deliberately fenced to an allowlist,
 * because a lab that can reach the whole internet is not a lab. But a handful
 * of links genuinely belong on the outside — where to download Ollama, where
 * the project lives — and those must open in the user's actual browser rather
 * than pretend to load in a simulated one.
 *
 * In the packaged app that goes through the main process, which refuses
 * anything that is not http or https. In a browser tab it is a normal new
 * window with `noopener`, so the opened page cannot reach back through
 * `window.opener`.
 */

interface ElectronBridge {
  invoke(cmd: string, ...args: unknown[]): Promise<unknown>;
}

function bridge(): ElectronBridge | null {
  return (window as unknown as { electron?: ElectronBridge }).electron ?? null;
}

/** Whether the workstation is running as an installed desktop application. */
export function isDesktopApp(): boolean {
  return Boolean((window as unknown as { env?: { IS_ELECTRON?: boolean } }).env?.IS_ELECTRON);
}

/**
 * Open a URL outside the workstation.
 *
 * Refuses anything but http and https here as well as in the main process:
 * the renderer should not be able to hand `file:` or `javascript:` to the
 * shell even if a future caller passes one by mistake.
 */
export function openExternal(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;

  const el = bridge();
  if (el) {
    void el.invoke('shell:openExternal', parsed.toString());
    return;
  }
  window.open(parsed.toString(), '_blank', 'noopener,noreferrer');
}

/** Where to get the local model runtime the tutor and ticket generator use. */
export const OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download';

/** The model those features ask for by name. */
export const OLLAMA_MODEL = 'llama3.2';
