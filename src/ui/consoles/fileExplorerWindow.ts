/**
 * ui/consoles/fileExplorerWindow.ts — VM File Explorer window.
 *
 * Mimics Windows Explorer. Left sidebar has Quick Access + This PC.
 * Right pane shows folder contents as icons.
 */
import { FS } from '@/terminal/shellIntrinsics';

export function renderFileExplorerWindow(body: HTMLElement): void {
  body.style.cssText =
    'display:flex;flex-direction:column;height:100%;background:#0e1116;font-family:"Segoe UI Variable","Segoe UI",sans-serif;font-size:12px;color:#c8cdd3;';

  // Current path state
  let currentPath = 'C:\\';
  const history: string[] = ['C:\\'];
  let histIdx = 0;

  const sidebarItems = [
    {
      id: 'qa',
      label: 'Quick Access',
      children: [
        { id: 'documents', label: '📁 Documents', path: 'C:\\Users\\Public\\Documents' },
        { id: 'pictures', label: '🖼️ Pictures', path: 'C:\\Users\\Public\\Pictures' },
        { id: 'downloads', label: '⬇️ Downloads', path: 'C:\\Users\\Public\\Downloads' },
      ],
    },
    {
      id: 'thispc',
      label: 'This PC',
      children: [{ id: 'c_drive', label: '💾 OS (C:)', path: 'C:\\' }],
    },
  ];

  // ── Layout ──────────────────────────────────────────────────────────────
  const main = document.createElement('div');
  main.style.cssText = 'display:flex;flex:1;min-height:0;overflow:hidden;';
  body.appendChild(main);

  // Sidebar
  const sidebar = document.createElement('div');
  sidebar.style.cssText = `
    width:180px;flex-shrink:0;background:#1b1f24;border-right:1px solid #2d343d;
    overflow-y:auto;padding:8px 0;
  `;
  main.appendChild(sidebar);

  for (const group of sidebarItems) {
    const groupEl = document.createElement('div');
    groupEl.style.cssText = 'margin-bottom:4px;';
    const label = document.createElement('div');
    label.style.cssText =
      'font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#8b95a1;padding:6px 14px 4px;cursor:pointer;';
    label.textContent = group.label;
    groupEl.appendChild(label);
    for (const item of group.children) {
      const itemBtn = document.createElement('button');
      itemBtn.style.cssText = `
        display:block;width:100%;text-align:left;padding:6px 14px;
        background:transparent;border:none;cursor:pointer;font-size:12px;
        color:#c8cdd3;transition:background 0.1s;
      `;
      itemBtn.textContent = item.label;
      itemBtn.addEventListener('mouseenter', () => {
        itemBtn.style.background = '#232830';
      });
      itemBtn.addEventListener('mouseleave', () => {
        itemBtn.style.background = 'transparent';
      });
      itemBtn.addEventListener('click', () => navigateTo(item.path));
      groupEl.appendChild(itemBtn);
    }
    sidebar.appendChild(groupEl);
  }

  // Content area
  const content = document.createElement('div');
  content.style.cssText = 'flex:1;display:flex;flex-direction:column;min-width:0;';
  main.appendChild(content);

  // Breadcrumb + view toggle
  const breadcrumb = document.createElement('div');
  breadcrumb.id = 'fe-breadcrumb';
  breadcrumb.style.cssText = `
    height:34px;display:flex;align-items:center;justify-content:space-between;gap:4px;
    padding:0 8px 0 12px;border-bottom:1px solid #2d343d;background:#1b1f24;
    font-size:12px;flex-shrink:0;
  `;
  content.appendChild(breadcrumb);

  const crumbTrail = document.createElement('div');
  crumbTrail.style.cssText = 'display:flex;align-items:center;gap:4px;overflow-x:auto;';
  breadcrumb.appendChild(crumbTrail);

  let viewMode: 'details' | 'icons' = 'details';
  const viewToggle = document.createElement('button');
  viewToggle.style.cssText = `
    flex-shrink:0;background:transparent;border:1px solid #2d343d;border-radius:4px;
    color:#8b95a1;font-size:11px;padding:4px 10px;cursor:pointer;
  `;
  viewToggle.addEventListener('click', () => {
    viewMode = viewMode === 'details' ? 'icons' : 'details';
    renderFolderContents(currentPath);
  });
  breadcrumb.appendChild(viewToggle);

  // Grid (icon view) / table (details view) — one is emptied and hidden at a time
  const grid = document.createElement('div');
  grid.id = 'fe-grid';
  grid.style.cssText =
    'flex:1;padding:12px;display:grid;grid-template-columns:repeat(auto-fill,80px);grid-auto-rows:90px;gap:8px;overflow-y:auto;align-content:start;';
  content.appendChild(grid);

  const table = document.createElement('div');
  table.id = 'fe-table';
  table.style.cssText = 'flex:1;overflow:auto;display:flex;flex-direction:column;';
  content.appendChild(table);

  // Fixed pixel widths for the trailing columns; Name gets the rest but never
  // shrinks below FE_NAME_MIN — narrower windows scroll horizontally instead
  // of collapsing the name column to zero (a CSS grid item with overflow:hidden
  // has an implicit min-width of 0, so without this the text just vanishes).
  const FE_NAME_MIN = 200;
  const FE_COLS = `minmax(${FE_NAME_MIN}px,1fr) 150px 190px 90px`;
  const FE_ROW_MIN_WIDTH = `${FE_NAME_MIN + 150 + 190 + 90 + 24}px`; // + column gaps

  // ── Render helpers ──────────────────────────────────────────────────────

  interface FEItem {
    icon: string;
    name: string;
    type: 'folder' | 'file' | 'app';
    path?: string;
    launch?: string;
    /** Explorer "Type" column — e.g. "File folder", "Microsoft Word Document" */
    kind: string;
    /** Explorer "Size" column, pre-formatted (blank for folders) */
    size: string;
    /** Explorer "Date modified" column, pre-formatted */
    modified: string;
  }

  function renderBreadcrumb(path: string): void {
    const parts = path.split('\\').filter(Boolean);
    crumbTrail.innerHTML = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const seg = document.createElement('span');
      seg.style.cssText = 'cursor:pointer;color:#4ec9b0;white-space:nowrap;';
      seg.textContent = part;
      seg.addEventListener('click', () => {
        const newPath = parts.slice(0, i + 1).join('\\') + '\\';
        navigateTo(newPath);
      });
      crumbTrail.appendChild(seg);
      if (i < parts.length - 1) {
        const arrow = document.createElement('span');
        arrow.style.cssText = 'color:#4a5568;pointer-events:none;';
        arrow.textContent = ' › ';
        crumbTrail.appendChild(arrow);
      }
    }
  }


  function openItem(item: FEItem): void {
    if (item.type === 'folder' && item.path) {
      navigateTo(item.path);
    } else if (item.type === 'app' && item.launch) {
      const __lab = (
        window as unknown as {
          __lab?: {
            desktop?: { openWindow(id: string, c: unknown): void };
            conductor?: unknown;
          };
        }
      ).__lab;
      if (__lab?.desktop && __lab.conductor) {
        __lab.desktop.openWindow(item.launch, __lab.conductor);
      }
    }
  }

  function renderIconsView(items: FEItem[]): void {
    table.style.display = 'none';
    grid.style.display = 'grid';
    grid.innerHTML = '';
    for (const item of items) {
      const cell = document.createElement('button');
      cell.style.cssText = `
        display:flex;flex-direction:column;align-items:center;gap:4px;
        padding:8px 4px;border-radius:6px;border:none;cursor:pointer;
        background:transparent;transition:background 0.1s;
        font-size:11px;color:#c8cdd3;width:80px;
      `;
      cell.innerHTML = `
        <span style="font-size:28px;">${item.icon}</span>
        <span style="text-align:center;line-height:1.3;word-break:break-all;">${item.name}</span>
      `;
      cell.addEventListener('dblclick', () => openItem(item));
      cell.addEventListener('mouseenter', () => {
        cell.style.background = '#232830';
      });
      cell.addEventListener('mouseleave', () => {
        cell.style.background = 'transparent';
      });
      grid.appendChild(cell);
    }
  }

  function renderDetailsView(items: FEItem[]): void {
    grid.style.display = 'none';
    table.style.display = 'flex';
    table.innerHTML = '';

    const header = document.createElement('div');
    header.style.cssText = `
      display:grid;grid-template-columns:${FE_COLS};gap:8px;min-width:${FE_ROW_MIN_WIDTH};
      padding:6px 12px;border-bottom:1px solid #2d343d;background:#181c21;
      font-size:11px;color:#8b95a1;font-weight:600;flex-shrink:0;
    `;
    header.innerHTML = `<span>Name</span><span>Date modified</span><span>Type</span><span style="text-align:right;">Size</span>`;
    table.appendChild(header);

    const rows = document.createElement('div');
    rows.style.cssText = 'flex:1;';
    table.appendChild(rows);

    for (const item of items) {
      const row = document.createElement('button');
      row.style.cssText = `
        display:grid;grid-template-columns:${FE_COLS};gap:8px;min-width:${FE_ROW_MIN_WIDTH};
        width:100%;padding:5px 12px;border:none;background:transparent;cursor:pointer;
        font-size:12px;color:#c8cdd3;text-align:left;align-items:center;
      `;
      row.innerHTML = `
        <span style="display:flex;align-items:center;gap:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          <span>${item.icon}</span><span style="overflow:hidden;text-overflow:ellipsis;">${item.name}</span>
        </span>
        <span style="color:#8b95a1;">${item.modified}</span>
        <span style="color:#8b95a1;">${item.kind}</span>
        <span style="color:#8b95a1;text-align:right;">${item.size}</span>
      `;
      row.addEventListener('dblclick', () => openItem(item));
      row.addEventListener('mouseenter', () => {
        row.style.background = '#232830';
      });
      row.addEventListener('mouseleave', () => {
        row.style.background = 'transparent';
      });
      rows.appendChild(row);
    }
  }

  /** Icons by extension, so the list reads like Explorer rather than a table. */
  const FILE_ICONS: Record<string, string> = {
    txt: '\u{1F4C4}',
    md: '\u{1F4C4}',
    csv: '\u{1F4CA}',
    ps1: '\u{1F4DC}',
    log: '\u{1F4CB}',
    json: '\u{1F5C3}\uFE0F',
  };

  /**
   * The folder's contents, read from the workstation's disk.
   *
   * Explorer used to hold its own map of what each folder contained, so a
   * directory created with mkdir never showed up here and one deleted here was
   * still in the terminal. There is one disk now, and both windows read it.
   */
  function itemsFor(path: string): FEItem[] {
    const entries = FS.list(path);
    if (!entries) return [];
    return entries.map((entry) => {
      const extension = entry.name.includes('.')
        ? entry.name.split('.').pop()!.toLowerCase()
        : '';
      const bytes = (entry.content ?? '').length;
      return {
        icon: entry.kind === 'dir' ? '\u{1F4C1}' : (FILE_ICONS[extension] ?? '\u{1F4C4}'),
        name: entry.name,
        type: entry.kind === 'dir' ? 'folder' : 'file',
        path: `${path.replace(/\\$/, '')}\\${entry.name}`,
        kind: entry.kind === 'dir' ? 'File folder' : `${extension.toUpperCase() || 'File'} file`,
        size: entry.kind === 'dir' ? '' : `${Math.max(1, Math.ceil(bytes / 1024))} KB`,
        modified: new Date(entry.modified).toLocaleString(),
      };
    });
  }

  function renderFolderContents(path: string): void {
    renderBreadcrumb(path);
    viewToggle.textContent = viewMode === 'details' ? '⊞ Large icons' : '☰ Details';

    const items = itemsFor(path);
    if (items.length === 0) {
      grid.style.display = 'none';
      table.style.display = 'flex';
      table.innerHTML = `<div style="padding:20px;color:#8b95a1;text-align:center;">This folder is empty.</div>`;
      return;
    }

    if (viewMode === 'details') renderDetailsView(items);
    else renderIconsView(items);
  }

  function navigateTo(path: string): void {
    currentPath = path;
    histIdx = history.length;
    history.length = histIdx;
    history.push(path);
    renderFolderContents(path);
  }

  // Initial render
  renderFolderContents(currentPath);
}
