/**
 * util/copyText.ts — clipboard copy with an execCommand fallback.
 *
 * navigator.clipboard is only available in secure contexts (https/localhost)
 * and even then can be denied. A hidden textarea + execCommand still works in
 * every browser and in the Electron shell when the webview is not focused.
 */
function legacyCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText =
    'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1;';
  document.body.appendChild(ta);
  ta.focus();
  ta.setSelectionRange(0, ta.value.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

export async function copyText(text: string): Promise<boolean> {
  const desktop = typeof window === 'undefined' ? undefined :
    (window as unknown as { electron?: { invoke?: (command: string, ...args: unknown[]) => Promise<unknown> } }).electron;
  if (desktop?.invoke) {
    try { if (await desktop.invoke('clipboard:writeText', text) === true) return true; } catch { /* older desktop build: use browser fallback */ }
  }
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard
      .writeText(text)
      .then(() => true)
      .catch(() => Promise.resolve(legacyCopy(text)));
  }
  return Promise.resolve(legacyCopy(text));
}
