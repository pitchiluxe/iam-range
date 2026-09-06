/**
 * ui/consoles/fileExplorerWindow.ts — VM File Explorer window.
 *
 * Mimics Windows Explorer. Left sidebar has Quick Access + This PC.
 * Right pane shows folder contents as icons.
 */

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

  // Define the "contents" of each simulated folder, with fake but plausible
  // Explorer metadata (type/size/modified) so the Details view reads as real.
  const folderContents: Record<string, FEItem[]> = {
    'C:\\': [
      {
        icon: '📁',
        name: 'Program Files',
        type: 'folder',
        path: 'C:\\Program Files',
        kind: 'File folder',
        size: '',
        modified: '8/12/2026 9:14 AM',
      },
      {
        icon: '📁',
        name: 'Program Files (x86)',
        type: 'folder',
        path: 'C:\\Program Files (x86)',
        kind: 'File folder',
        size: '',
        modified: '8/12/2026 9:14 AM',
      },
      {
        icon: '📁',
        name: 'Users',
        type: 'folder',
        path: 'C:\\Users',
        kind: 'File folder',
        size: '',
        modified: '9/2/2026 5:47 PM',
      },
      {
        icon: '📁',
        name: 'Windows',
        type: 'folder',
        path: 'C:\\Windows',
        kind: 'File folder',
        size: '',
        modified: '8/12/2026 9:10 AM',
      },
    ],
    'C:\\Program Files': [
      {
        icon: '📁',
        name: 'Apex Identity',
        type: 'folder',
        path: 'C:\\Program Files\\Apex Identity',
        kind: 'File folder',
        size: '',
        modified: '8/12/2026 9:16 AM',
      },
    ],
    'C:\\Program Files (x86)': [
      {
        icon: '📁',
        name: 'Apex Identity',
        type: 'folder',
        path: 'C:\\Program Files (x86)\\Apex Identity',
        kind: 'File folder',
        size: '',
        modified: '8/12/2026 9:16 AM',
      },
    ],
    'C:\\Users': [
      {
        icon: '📁',
        name: 'Public',
        type: 'folder',
        path: 'C:\\Users\\Public',
        kind: 'File folder',
        size: '',
        modified: '9/2/2026 5:47 PM',
      },
    ],
    'C:\\Users\\Public': [
      {
        icon: '📁',
        name: 'Documents',
        type: 'folder',
        path: 'C:\\Users\\Public\\Documents',
        kind: 'File folder',
        size: '',
        modified: '9/1/2026 11:02 AM',
      },
      {
        icon: '📁',
        name: 'Pictures',
        type: 'folder',
        path: 'C:\\Users\\Public\\Pictures',
        kind: 'File folder',
        size: '',
        modified: '8/28/2026 4:30 PM',
      },
      {
        icon: '📁',
        name: 'Downloads',
        type: 'folder',
        path: 'C:\\Users\\Public\\Downloads',
        kind: 'File folder',
        size: '',
        modified: '9/2/2026 5:47 PM',
      },
    ],
    'C:\\Users\\Public\\Documents': [
      {
        icon: '📄',
        name: 'policy.docx',
        type: 'file',
        kind: 'Microsoft Word Document',
        size: '48 KB',
        modified: '8/20/2026 3:11 PM',
      },
      {
        icon: '📄',
        name: 'onboarding_checklist.pdf',
        type: 'file',
        kind: 'Adobe Acrobat Document',
        size: '212 KB',
        modified: '8/22/2026 10:05 AM',
      },
      {
        icon: '📄',
        name: 'rbac_guide.docx',
        type: 'file',
        kind: 'Microsoft Word Document',
        size: '96 KB',
        modified: '9/1/2026 11:02 AM',
      },
    ],
    'C:\\Users\\Public\\Pictures': [
      {
        icon: '🖼️',
        name: 'banner.png',
        type: 'file',
        kind: 'PNG File',
        size: '1.2 MB',
        modified: '8/28/2026 4:30 PM',
      },
      {
        icon: '📁',
        name: 'screenshots',
        type: 'folder',
        path: 'C:\\Users\\Public\\Pictures\\Screenshots',
        kind: 'File folder',
        size: '',
        modified: '8/28/2026 4:31 PM',
      },
    ],
    'C:\\Users\\Public\\Pictures\\Screenshots': [
      {
        icon: '🖼️',
        name: 'sso_error_2026-08-28.png',
        type: 'file',
        kind: 'PNG File',
        size: '340 KB',
        modified: '8/28/2026 4:31 PM',
      },
    ],
    'C:\\Users\\Public\\Downloads': [
      {
        icon: '📦',
        name: 'agent_install.zip',
        type: 'file',
        kind: 'Compressed (zipped) Folder',
        size: '18.4 MB',
        modified: '9/2/2026 5:47 PM',
      },
      {
        icon: '📄',
        name: 'readme.txt',
        type: 'file',
        kind: 'Text Document',
        size: '2 KB',
        modified: '9/2/2026 5:47 PM',
      },
    ],
    'C:\\Program Files\\Apex Identity': [
      {
        icon: '🔐',
        name: 'IAM Console.exe',
        type: 'app',
        launch: 'iam-console',
        kind: 'Application',
        size: '54.1 MB',
        modified: '8/12/2026 9:16 AM',
      },
      {
        icon: '🎫',
        name: 'Ticket Queue.exe',
        type: 'app',
        launch: 'ticket-console',
        kind: 'Application',
        size: '38.7 MB',
        modified: '8/12/2026 9:16 AM',
      },
      {
        icon: '🛡️',
        name: 'SecOps Dashboard.exe',
        type: 'app',
        launch: 'secops-dashboard',
        kind: 'Application',
        size: '61.3 MB',
        modified: '8/12/2026 9:16 AM',
      },
    ],
    'C:\\Windows': [
      {
        icon: '📁',
        name: 'System32',
        type: 'folder',
        kind: 'File folder',
        size: '',
        modified: '8/12/2026 9:10 AM',
      },
      {
        icon: '📄',
        name: 'explorer.exe',
        type: 'file',
        kind: 'Application',
        size: '5.1 MB',
        modified: '8/12/2026 9:10 AM',
      },
    ],
    'C:\\Program Files (x86)\\Apex Identity': [
      {
        icon: '📄',
        name: 'updater.exe',
        type: 'file',
        kind: 'Application',
        size: '2.8 MB',
        modified: '8/12/2026 9:16 AM',
      },
    ],
  };

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

  function renderFolderContents(path: string): void {
    renderBreadcrumb(path);
    viewToggle.textContent = viewMode === 'details' ? '⊞ Large icons' : '☰ Details';

    const items = folderContents[path] ?? [];
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
