/**
 * util/desktopIcons.ts — persisted desktop icon order + Recycle Bin state.
 *
 * Shared between desktopOverlay.ts (renders + drag-reorders the icons, and
 * drop-onto-Recycle-Bin deletes one) and recycleBinWindow.ts (lists/restores/
 * empties deleted icons). Both sides listen for 'apex-desktop-icons-changed'
 * on `document` to stay in sync without a shared store dependency.
 */

export interface DesktopIconRef {
  id: string;
  title: string;
  icon: string;
}

const ORDER_KEY = 'desktop_icon_order';
const DELETED_KEY = 'desktop_icon_deleted';
const CHANGE_EVENT = 'apex-desktop-icons-changed';

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota errors */
  }
}

function notifyChanged(): void {
  document.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/** Subscribe to icon-order or Recycle-Bin changes. Returns an unsubscribe function. */
export function onDesktopIconsChanged(handler: () => void): () => void {
  document.addEventListener(CHANGE_EVENT, handler);
  return () => document.removeEventListener(CHANGE_EVENT, handler);
}

/** Saved custom order of icon ids, or null if the user never reordered. */
export function getIconOrder(): string[] | null {
  return readJSON<string[] | null>(ORDER_KEY, null);
}

export function saveIconOrder(order: string[]): void {
  writeJSON(ORDER_KEY, order);
  notifyChanged();
}

/** Icons currently in the Recycle Bin. */
export function getDeletedIcons(): DesktopIconRef[] {
  return readJSON<DesktopIconRef[]>(DELETED_KEY, []);
}

/** Move an icon to the Recycle Bin (also removes it from the saved order). */
export function deleteIcon(ref: DesktopIconRef): void {
  const deleted = getDeletedIcons();
  if (!deleted.some((d) => d.id === ref.id)) deleted.push(ref);
  writeJSON(DELETED_KEY, deleted);

  const order = getIconOrder();
  if (order)
    writeJSON(
      ORDER_KEY,
      order.filter((id) => id !== ref.id),
    );

  notifyChanged();
}

/** Restore one icon from the Recycle Bin back to the desktop (appended to the end). */
export function restoreIcon(id: string): void {
  const deleted = getDeletedIcons();
  const remaining = deleted.filter((d) => d.id !== id);
  writeJSON(DELETED_KEY, remaining);

  const order = getIconOrder();
  if (order && !order.includes(id)) writeJSON(ORDER_KEY, [...order, id]);

  notifyChanged();
}

/** Permanently remove one icon from the Recycle Bin (no restore possible). */
export function permanentlyDelete(id: string): void {
  writeJSON(
    DELETED_KEY,
    getDeletedIcons().filter((d) => d.id !== id),
  );
  notifyChanged();
}

/** Empty the Recycle Bin entirely. */
export function emptyRecycleBin(): void {
  writeJSON(DELETED_KEY, []);
  notifyChanged();
}
