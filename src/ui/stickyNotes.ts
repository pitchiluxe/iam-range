export const NOTE_COLORS = [['Yellow', '#fff2ab'], ['Green', '#cbf1c4'], ['Pink', '#ffd4e5'], ['Purple', '#e5d5ff'], ['Blue', '#cce9ff'], ['Gray', '#e8e8e8'], ['Charcoal', '#333333']] as const;
export interface StickyNote {
  id: string; text: string; html: string; color: string;
  left: number; top: number; width: number; height: number; open: boolean; updatedAt: number;
}
export function createStickyNote(offset = 0): StickyNote {
  return { id: crypto.randomUUID(), text: '', html: '', color: '#fff2ab', left: 12 + offset % 4 * 24,
    top: 12 + offset % 4 * 24, width: 280, height: 280, open: true, updatedAt: Date.now() };
}
export function normalizeNotes(raw: unknown): StickyNote[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(n => n && typeof n === 'object' && typeof n.text === 'string').map((n, i) => ({
    ...createStickyNote(i), id: typeof n.id === 'string' ? n.id : crypto.randomUUID(),
    text: n.text, html: typeof n.html === 'string' ? n.html : '',
    color: /^#[\da-f]{6}$/i.test(n.color ?? '') ? n.color : '#fff2ab',
    left: Math.max(0, Number(n.left) || 12), top: Math.max(0, Number(n.top) || 12),
    width: Math.max(240, Math.min(700, Number(n.width) || 280)), height: Math.max(200, Math.min(700, Number(n.height) || 280)),
    open: n.open !== false, updatedAt: Number(n.updatedAt) || Date.now(),
  }));
}
/** Only note formatting and embedded raster pictures may survive persistence/paste. */
export function safeNoteHtml(html: string): string {
  const source = document.createElement('template'); source.innerHTML = html;
  const target = document.createElement('div');
  const copy = (node: Node, parent: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) { parent.appendChild(document.createTextNode(node.textContent ?? '')); return; }
    if (!(node instanceof HTMLElement)) return;
    if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT'].includes(node.tagName)) return;
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') ?? '';
      if (/^data:image\/(png|jpeg|webp);base64,[a-z\d+/=]+$/i.test(src) && src.length < 1_500_000) {
        const img = document.createElement('img'); img.src = src; img.alt = node.getAttribute('alt') ?? 'Note picture'; parent.appendChild(img);
      }
      return;
    }
    const allowed = ['DIV', 'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'UL', 'OL', 'LI'];
    const next = allowed.includes(node.tagName) ? document.createElement(node.tagName.toLowerCase()) : parent;
    if (next !== parent) parent.appendChild(next);
    node.childNodes.forEach(child => copy(child, next));
  };
  source.content.childNodes.forEach(node => copy(node, target));
  return target.innerHTML;
}
