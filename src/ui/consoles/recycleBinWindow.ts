/**
 * ui/consoles/recycleBinWindow.ts — VM Recycle Bin window.
 *
 * Lists desktop icons the learner dragged onto the Recycle Bin (see
 * desktopOverlay.ts's drag-and-drop handling). Restore puts an icon back on
 * the desktop; Delete / Empty Recycle Bin removes it for good. Backed by
 * util/desktopIcons.ts so state survives closing/reopening the window.
 */
import {
  getDeletedIcons,
  restoreIcon,
  permanentlyDelete,
  emptyRecycleBin,
  onDesktopIconsChanged,
  type DesktopIconRef,
} from '@/util/desktopIcons';

export function renderRecycleBinWindow(body: HTMLElement): void {
  body.style.cssText =
    'display:flex;flex-direction:column;height:100%;background:var(--panel);font-family:"Segoe UI Variable","Segoe UI",sans-serif;font-size:12px;color:var(--fg);';

  const toolbar = document.createElement('div');
  toolbar.style.cssText =
    'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--border);background:var(--panel-alt);flex-shrink:0;';
  const title = document.createElement('div');
  title.style.cssText = 'font-size:12px;color:var(--muted);';
  toolbar.appendChild(title);
  const emptyBtn = document.createElement('button');
  emptyBtn.textContent = '🗑 Empty Recycle Bin';
  emptyBtn.style.cssText =
    'background:transparent;border:1px solid var(--border);color:var(--err);font-size:11px;padding:5px 10px;border-radius:4px;cursor:pointer;';
  emptyBtn.addEventListener('click', () => {
    emptyRecycleBin();
  });
  toolbar.appendChild(emptyBtn);
  body.appendChild(toolbar);

  const list = document.createElement('div');
  list.style.cssText = 'flex:1;overflow-y:auto;padding:12px;';
  body.appendChild(list);

  function render(): void {
    const items = getDeletedIcons();
    title.textContent =
      items.length === 0
        ? 'Recycle Bin is empty'
        : `${items.length} item${items.length === 1 ? '' : 's'}`;
    emptyBtn.style.opacity = items.length === 0 ? '0.4' : '1';
    emptyBtn.disabled = items.length === 0;

    if (items.length === 0) {
      list.innerHTML = `
        <div style="text-align:center;color:var(--muted);padding:40px 20px;">
          <div style="font-size:40px;margin-bottom:10px;">🗑️</div>
          <div>Drag a desktop icon here to remove it.</div>
        </div>
      `;
      return;
    }

    list.innerHTML = '';
    for (const item of items) {
      list.appendChild(makeRow(item));
    }
  }

  function makeRow(item: DesktopIconRef): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText =
      'display:flex;align-items:center;gap:12px;padding:10px 8px;border-bottom:1px solid var(--border);';

    const iconEl = document.createElement('span');
    iconEl.style.cssText = 'font-size:24px;';
    iconEl.textContent = item.icon;
    row.appendChild(iconEl);

    const label = document.createElement('div');
    label.style.cssText = 'flex:1;';
    label.textContent = item.title;
    row.appendChild(label);

    const restoreBtn = document.createElement('button');
    restoreBtn.textContent = '↺ Restore';
    restoreBtn.style.cssText =
      'background:transparent;border:1px solid var(--accent);color:var(--accent);font-size:11px;padding:4px 10px;border-radius:4px;cursor:pointer;';
    restoreBtn.addEventListener('click', () => {
      restoreIcon(item.id);
    });
    row.appendChild(restoreBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '🗑';
    deleteBtn.title = 'Delete permanently';
    deleteBtn.style.cssText =
      'background:transparent;border:1px solid var(--border);color:var(--err);font-size:11px;padding:4px 8px;border-radius:4px;cursor:pointer;';
    deleteBtn.addEventListener('click', () => {
      permanentlyDelete(item.id);
    });
    row.appendChild(deleteBtn);

    return row;
  }

  render();
  onDesktopIconsChanged(render);
}
