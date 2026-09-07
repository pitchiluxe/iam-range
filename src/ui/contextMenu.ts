/**
 * ui/contextMenu.ts — the right-click menu, shared.
 *
 * Active Directory Users and Computers grew one of these, and then the
 * desktop, the taskbar and File Explorer each needed the same thing. Rather
 * than four menus that drift apart in padding, colour and dismiss behaviour,
 * there is one — and it reads the theme, so a menu opened on a light desktop
 * is a light menu.
 *
 * Behaviour follows Windows: it opens at the pointer, flips when it would run
 * off the screen, closes on any click elsewhere or on Escape, and never opens
 * two at once.
 */

export type MenuItem =
  | {
      label: string;
      onClick?: () => void;
      /** Shown greyed and unclickable — the item exists but not here. */
      disabled?: boolean;
      /** A tick to the left, for toggles like "Show desktop icons". */
      checked?: boolean;
      /** Right-aligned hint, e.g. a keyboard shortcut. */
      hint?: string;
      /** Nested items, drawn as a flyout. */
      submenu?: MenuItem[];
    }
  | { separator: true };

const MENU_CLASS = 'vm-context-menu';

/** Close every open menu. Exported because a window closing should take its
 *  menus with it rather than leaving one floating over the desktop. */
export function closeContextMenus(): void {
  document.querySelectorAll(`.${MENU_CLASS}`).forEach((m) => m.remove());
}

/** Close flyouts at this depth and below, leaving the parents open. */
function closeFrom(depth: number): void {
  document.querySelectorAll<HTMLElement>(`.${MENU_CLASS}`).forEach((m) => {
    if (Number(m.dataset['depth'] ?? '0') >= depth) m.remove();
  });
}

function buildMenu(items: MenuItem[], depth: number): HTMLElement {
  const menu = document.createElement('div');
  menu.className = MENU_CLASS;
  menu.style.cssText =
    'position:fixed;z-index:99999;min-width:200px;padding:5px 0;border-radius:8px;' +
    'font-size:12.5px;font-family:"Segoe UI",system-ui,sans-serif;' +
    // Acrylic, like the rest of the chrome.
    'background:var(--menu-bg,rgba(40,50,64,0.86));' +
    'border:1px solid var(--menu-border,rgba(255,255,255,0.14));' +
    'backdrop-filter:blur(28px) saturate(160%);-webkit-backdrop-filter:blur(28px) saturate(160%);' +
    'box-shadow:0 14px 40px rgba(0,0,0,0.55),inset 0 1px 0 rgba(255,255,255,0.14);' +
    'color:var(--menu-text,var(--fg));';
  menu.dataset['depth'] = String(depth);

  for (const item of items) {
    if ('separator' in item) {
      const hr = document.createElement('div');
      hr.style.cssText =
        'height:1px;background:var(--menu-border,rgba(255,255,255,0.12));margin:4px 8px;';
      menu.appendChild(hr);
      continue;
    }

    const row = document.createElement('div');
    row.style.cssText =
      'display:flex;align-items:center;gap:8px;padding:6px 12px 6px 10px;cursor:pointer;' +
      (item.disabled ? 'opacity:0.42;cursor:default;' : '');

    const tick = document.createElement('span');
    tick.textContent = item.checked ? '✓' : '';
    tick.style.cssText = 'width:12px;flex-shrink:0;font-size:11px;opacity:0.9;';

    const label = document.createElement('span');
    label.textContent = item.label;
    label.style.cssText = 'flex:1;white-space:nowrap;';

    const hint = document.createElement('span');
    hint.textContent = item.submenu ? '›' : (item.hint ?? '');
    hint.style.cssText = 'opacity:0.55;font-size:11px;flex-shrink:0;';

    row.append(tick, label, hint);

    if (!item.disabled) {
      row.addEventListener('mouseenter', () => {
        row.style.background = 'var(--menu-hover,rgba(255,255,255,0.14))';
        // One flyout at a time, at this depth or deeper.
        closeFrom(depth + 1);
        if (item.submenu) {
          const sub = buildMenu(item.submenu, depth + 1);
          const box = row.getBoundingClientRect();
          // Appended to the body, not inside this menu. backdrop-filter makes
          // an element a containing block for fixed-position descendants, so a
          // flyout nested inside the blurred parent was positioned relative to
          // the parent instead of the viewport — which put it a long way from
          // the item it belonged to.
          document.body.appendChild(sub);
          place(sub, box.right - 4, box.top - 5);
        }
      });
      row.addEventListener('mouseleave', () => {
        row.style.background = 'transparent';
      });
      if (!item.submenu) {
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          closeContextMenus();
          item.onClick?.();
        });
      }
    }

    menu.appendChild(row);
  }

  return menu;
}

/** Position a menu, flipping it when it would run off the edge. */
function place(menu: HTMLElement, x: number, y: number): void {
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const box = menu.getBoundingClientRect();
  if (box.right > window.innerWidth - 4) {
    menu.style.left = `${Math.max(4, x - box.width)}px`;
  }
  if (box.bottom > window.innerHeight - 4) {
    menu.style.top = `${Math.max(4, window.innerHeight - box.height - 4)}px`;
  }
}

/**
 * Open a context menu at the pointer.
 *
 * Call it from a `contextmenu` handler; it calls preventDefault for you, since
 * every caller wants that and forgetting it shows the browser's own menu on
 * top of a simulated operating system.
 */
export function openContextMenu(e: MouseEvent, items: MenuItem[]): void {
  e.preventDefault();
  e.stopPropagation();
  closeContextMenus();

  const menu = buildMenu(items, 0);
  document.body.appendChild(menu);
  place(menu, e.clientX, e.clientY);

  const dismiss = (ev: Event): void => {
    if (ev instanceof KeyboardEvent && ev.key !== 'Escape') return;
    // Any open menu, since flyouts live on the body rather than inside their
    // parent — a click in a submenu must not close the whole stack.
    if (
      ev instanceof MouseEvent &&
      Array.from(document.querySelectorAll(`.${MENU_CLASS}`)).some((m) =>
        m.contains(ev.target as Node),
      )
    ) {
      return;
    }
    closeContextMenus();
    document.removeEventListener('mousedown', dismiss);
    document.removeEventListener('keydown', dismiss);
  };
  // Deferred, or the click that opened the menu closes it again.
  setTimeout(() => {
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', dismiss);
  }, 0);
}
