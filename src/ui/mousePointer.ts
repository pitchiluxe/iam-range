export type PointerStyle = 'white' | 'black' | 'inverted' | 'color';
export interface PointerPreference { style: PointerStyle; size: number; color: string }
const KEY = 'iam_mouse_pointer';
export const POINTER_COLORS = ['#a3e635', '#38bdf8', '#facc15', '#fb7185', '#c084fc', '#f97316', '#2dd4bf'];
export function normalizePointer(value: Partial<PointerPreference> = {}): PointerPreference {
  return {
    style: ['white', 'black', 'inverted', 'color'].includes(value.style ?? '') ? value.style! : 'white',
    size: Math.max(1, Math.min(5, Math.round(Number(value.size) || 1))),
    color: /^#[\da-f]{6}$/i.test(value.color ?? '') ? value.color! : '#a3e635',
  };
}
export function getPointerPreference(): PointerPreference {
  try { return normalizePointer(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return normalizePointer(); }
}
export function pointerSvg(fill: string, stroke: string, text = false): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${text
    ? `<path d="M10 4h12M16 4v24M10 28h12" fill="none" stroke="${stroke}" stroke-width="4"/><path d="M10 4h12M16 4v24M10 28h12" fill="none" stroke="${fill}" stroke-width="2"/>`
    : `<path d="M4 2v25l7-6 5 10 5-3-5-10h11Z" fill="${fill}" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round"/>`}</svg>`;
}
export function applyPointer(preference = getPointerPreference()): void {
  const p = normalizePointer(preference);
  let style = document.getElementById('iam-pointer-style');
  if (!style) { style = document.createElement('style'); style.id = 'iam-pointer-style'; document.head.appendChild(style); }
  const fill = p.style === 'black' ? '#111111' : p.style === 'color' ? p.color : '#ffffff';
  const stroke = p.style === 'black' ? '#ffffff' : '#111111';
  const size = 24 + (p.size - 1) * 12;
  const url = (text = false): string => `url("data:image/svg+xml,${encodeURIComponent(pointerSvg(fill, stroke, text).replace('width="32" height="32"', `width="${size}" height="${size}"`))}") ${text ? size / 2 : size / 8} ${text ? size / 2 : size / 16}`;
  style.textContent = p.style === 'inverted'
    ? '#desktop-overlay, #desktop-overlay * { cursor:none !important; }'
    : `#desktop-overlay, #desktop-overlay * { cursor:${url()}, auto !important; }
       #desktop-overlay :is(input:not([type=button]):not([type=checkbox]):not([type=range]):not([type=color]), textarea, [contenteditable=true]) { cursor:${url(true)}, text !important; }`;
  const overlay = document.getElementById('iam-inverted-pointer');
  if (overlay) { overlay.style.width = `${size}px`; overlay.style.height = `${size}px`; overlay.style.display = 'none'; }
  document.documentElement.dataset.pointerStyle = p.style;
}
export function setPointerPreference(p: PointerPreference): void {
  localStorage.setItem(KEY, JSON.stringify(normalizePointer(p)));
  applyPointer(p);
}
export function installMousePointer(): void {
  if (document.getElementById('iam-inverted-pointer')) return;
  const overlay = document.createElement('div');
  overlay.id = 'iam-inverted-pointer';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.cssText = 'position:fixed;display:none;pointer-events:none;z-index:2147483647;mix-blend-mode:difference;';
  document.body.appendChild(overlay);
  let previousText: boolean | null = null;
  document.addEventListener('pointermove', event => {
    if (document.documentElement.dataset.pointerStyle !== 'inverted' || !(event.target instanceof Element) || !event.target.closest('#desktop-overlay')) { overlay.style.display = 'none'; return; }
    const text = Boolean(event.target.closest('input,textarea,[contenteditable=true]'));
    if (previousText !== text) {
      overlay.innerHTML = pointerSvg('#ffffff', '#ffffff', text); previousText = text;
      overlay.firstElementChild?.setAttribute('width', '100%'); overlay.firstElementChild?.setAttribute('height', '100%');
    }
    const size = parseFloat(overlay.style.width);
    Object.assign(overlay.style, { display: 'block', left: `${event.clientX - size / (text ? 2 : 8)}px`, top: `${event.clientY - size / (text ? 2 : 16)}px` });
  });
  document.addEventListener('pointerleave', () => { overlay.style.display = 'none'; });
  window.addEventListener('blur', () => { overlay.style.display = 'none'; });
  window.addEventListener('storage', event => { if (event.key === KEY) applyPointer(); });
  applyPointer();
}
