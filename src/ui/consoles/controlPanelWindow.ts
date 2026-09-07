/**
 * ui/consoles/controlPanelWindow.ts — the classic Windows Control Panel.
 *
 * Rebuilt because the old one wore a light shell over dark content: white
 * panes with var(--fg) text on them, which is the workstation's desktop palette
 * applied to the one window that is supposed to look like the operating
 * system's own. It read as "a dark app pretending", which is the opposite of
 * what this window is for.
 *
 * The layout is the real one: an address bar with a breadcrumb you can click,
 * a search box, a left rail with the view switcher, and either the category
 * landing page or the flat icon grid. Applets open in place and the breadcrumb
 * grows a segment, exactly as the snap-in does.
 *
 * The values it shows come from config where the workstation knows them —
 * the host name, the domain, the publisher — and are plausible fiction where
 * it does not. Nothing here reads the real machine: reporting the learner's
 * actual hostname or IP would be wrong for a lab and a privacy problem.
 */
import { PRODUCT } from '@/config/product';
import { COMPANY } from '@/config';
import { VM_HOST } from '@/config/vmHost';

type ViewMode = 'category' | 'icons';

interface Applet {
  id: string;
  icon: string;
  label: string;
  /** One line under the name in category view. */
  blurb: string;
  category: CategoryId;
  render(): string;
}

type CategoryId = 'system' | 'network' | 'accounts' | 'appearance' | 'clock';

interface Category {
  id: CategoryId;
  icon: string;
  label: string;
  blurb: string;
}

const CATEGORIES: readonly Category[] = [
  {
    id: 'system',
    icon: '🖥️',
    label: 'System and Security',
    blurb: 'Review your computer’s status, firewall, power and installed programs.',
  },
  {
    id: 'network',
    icon: '🌐',
    label: 'Network and Internet',
    blurb: 'View network status and tasks.',
  },
  {
    id: 'accounts',
    icon: '👤',
    label: 'User Accounts',
    blurb: 'Change account type and credentials.',
  },
  {
    id: 'appearance',
    icon: '🖼️',
    label: 'Hardware and Devices',
    blurb: 'View devices and printers.',
  },
  { id: 'clock', icon: '🕐', label: 'Clock and Region', blurb: 'Set the date, time and time zone.' },
];

// --- Presentation helpers ----------------------------------------------------

/** A label/value row, as the real property pages lay them out. */
function kv(label: string, value: string): string {
  return `<div class="cp-kv"><span class="cp-kv-label">${label}</span><span class="cp-kv-value">${value}</span></div>`;
}

/**
 * Wrap a value the clock tick rewrites.
 *
 * The applet renders to a string, so there is no element to hold on to. The
 * attribute is the handle.
 */
function liveClock(which: 'time' | 'date', initial: string): string {
  return `<span data-cp-clock="${which}">${initial}</span>`;
}

/** A row in the Programs and Features list. */
function row(name: string, publisher: string, size: string, date: string): string {
  return `
    <div class="cp-row">
      <div class="cp-row-main">
        <div class="cp-row-name">${name}</div>
        <div class="cp-row-sub">${publisher}</div>
      </div>
      ${size ? `<span class="cp-row-col">${size}</span>` : ''}
      ${date ? `<span class="cp-row-col wide">${date}</span>` : ''}
    </div>`;
}

function heading(text: string): string {
  return `<h3 class="cp-heading">${text}</h3>`;
}

function ok(text: string): string {
  return `<span class="cp-ok">${text}</span>`;
}

function note(text: string): string {
  return `<p class="cp-note">${text}</p>`;
}

const APPLETS: readonly Applet[] = [
  {
    id: 'system',
    icon: '🖥️',
    label: 'System',
    blurb: 'View basic information about your computer',
    category: 'system',
    render: () =>
      heading('View basic information about your computer') +
      kv('Computer name', VM_HOST.name) +
      kv('Full computer name', `${VM_HOST.name}.${VM_HOST.domain}`) +
      kv('Domain', VM_HOST.domain) +
      kv('Edition', VM_HOST.edition) +
      kv('Version', VM_HOST.osVersion) +
      kv('Build', VM_HOST.osBuild) +
      kv('Processor', VM_HOST.processor) +
      kv('Installed RAM', VM_HOST.ram) +
      kv('System type', VM_HOST.systemType) +
      note(
        'This describes the simulated workstation, not the machine you are running on. ' +
          'Nothing here reads your real hardware.',
      ),
  },
  {
    id: 'programs',
    icon: '📦',
    label: 'Programs and Features',
    blurb: 'Uninstall a program',
    category: 'system',
    render: () =>
      heading('Uninstall or change a program') +
      `<div class="cp-list-head"><span>Name</span><span class="cp-row-col">Size</span><span class="cp-row-col wide">Installed on</span></div>` +
      row('Active Directory Users and Computers', PRODUCT.publisher, '54.1 MB', '8/12/2026') +
      row('Ticket Queue', PRODUCT.publisher, '38.7 MB', '8/12/2026') +
      row('SecOps Dashboard', PRODUCT.publisher, '61.3 MB', '8/12/2026') +
      row('Cloud Identity', PRODUCT.publisher, '44.9 MB', '8/12/2026') +
      row('IAM Tutor', PRODUCT.publisher, '27.4 MB', '8/12/2026') +
      row('Writer', PRODUCT.publisher, '18.2 MB', '8/12/2026') +
      note('Uninstalling is disabled on a managed workstation.'),
  },
  {
    id: 'firewall',
    icon: '🛡️',
    label: 'Windows Defender Firewall',
    blurb: 'Check firewall status',
    category: 'system',
    render: () =>
      heading('Help protect your PC with Windows Defender Firewall') +
      kv('Domain networks', ok('Connected')) +
      kv('Firewall state', ok('On')) +
      kv('Incoming connections', 'Block all connections to apps that are not on the allowed list') +
      kv('Active domain networks', `${VM_HOST.netbiosDomain}-Corp`) +
      kv('Notification state', 'Notify me when a new app is blocked'),
  },
  {
    id: 'power',
    icon: '🔋',
    label: 'Power Options',
    blurb: 'Change power-saving settings',
    category: 'system',
    render: () =>
      heading('Choose or customise a power plan') +
      kv('Selected plan', 'Balanced (recommended)') +
      kv('Turn off the display', 'After 15 minutes') +
      kv('Put the computer to sleep', 'After 30 minutes') +
      note('Power settings are managed by your organisation.'),
  },
  {
    id: 'network',
    icon: '🌐',
    label: 'Network and Sharing Center',
    blurb: 'View network status and tasks',
    category: 'network',
    render: () =>
      heading('View your basic network information') +
      kv('Connection', `${VM_HOST.netbiosDomain}-Corp (Ethernet)`) +
      kv('Access type', ok('Internet')) +
      kv('IPv4 address', VM_HOST.ip) +
      kv('Default gateway', VM_HOST.gateway) +
      kv('DNS server', VM_HOST.dns) +
      kv('Physical address', VM_HOST.mac) +
      kv('Domain controller', VM_HOST.domainController),
  },
  {
    id: 'users',
    icon: '👤',
    label: 'User Accounts',
    blurb: 'Change account type',
    category: 'accounts',
    render: () =>
      heading('Make changes to your user account') +
      kv('Signed in as', `${VM_HOST.netbiosDomain}\\${VM_HOST.user}`) +
      kv('Account type', 'Administrator') +
      kv('Domain', COMPANY.domain) +
      note(
        'Accounts are managed in Active Directory Users and Computers. To change your own ' +
          'password, open Settings and choose Accounts.',
      ),
  },
  {
    id: 'devices',
    icon: '🖨️',
    label: 'Devices and Printers',
    blurb: 'View devices and printers',
    category: 'appearance',
    render: () =>
      heading('Devices and Printers') +
      row(VM_HOST.name, 'This PC', '', '') +
      row(`${VM_HOST.netbiosDomain}-PRINT-02`, 'Printer · Ready', '', '') +
      row('Generic Monitor', 'Display · Connected', '', '') +
      row('Standard Keyboard', 'Input · Connected', '', ''),
  },
  {
    id: 'date',
    icon: '🕐',
    label: 'Date and Time',
    blurb: 'Set the time and date',
    category: 'clock',
    render: () =>
      heading('Date and Time') +
      // Marked so the tick can find them. Everything else on this page is
      // static; these two are the only things that move.
      kv('Current time', liveClock('time', new Date().toLocaleTimeString())) +
      kv('Current date', liveClock('date', new Date().toLocaleDateString())) +
      kv('Time zone', Intl.DateTimeFormat().resolvedOptions().timeZone) +
      kv('Synchronised with', ok(`${VM_HOST.domainController} (domain time)`)),
  },
];

const APPLET_BY_ID: Record<string, Applet> = Object.fromEntries(APPLETS.map((a) => [a.id, a]));

/** Windows chrome, kept in one place so the panes cannot drift apart again. */
const STYLES = `
  .cp-root { display:flex; flex-direction:column; height:100%; background:#f0f0f0;
    font-family:"Segoe UI Variable","Segoe UI",-apple-system,BlinkMacSystemFont,sans-serif;
    color:#000; font-size:12px; }
  .cp-addressbar { flex-shrink:0; display:flex; align-items:center; gap:8px;
    padding:8px 10px; background:#f0f0f0; border-bottom:1px solid #dfdfdf; }
  .cp-crumbs { flex:1; display:flex; align-items:center; gap:4px; background:#fff;
    border:1px solid #7a7a7a; border-radius:2px; padding:4px 8px; min-width:0;
    overflow:hidden; white-space:nowrap; }
  .cp-crumb { color:#000; cursor:pointer; }
  .cp-crumb:hover { color:#0066cc; text-decoration:underline; }
  .cp-crumb.current { cursor:default; }
  .cp-crumb.current:hover { color:#000; text-decoration:none; }
  .cp-sep { color:#767676; }
  .cp-search { width:180px; background:#fff; border:1px solid #7a7a7a; border-radius:2px;
    padding:4px 8px; font-size:12px; font-family:inherit; outline:none; color:#000; }
  .cp-search::placeholder { color:#767676; }

  .cp-body { flex:1; display:flex; min-height:0; }
  .cp-rail { width:190px; flex-shrink:0; background:#f0f0f0; border-right:1px solid #dfdfdf;
    padding:16px 14px; overflow-y:auto; }
  .cp-rail h4 { margin:0 0 8px; font-size:12px; font-weight:600; color:#000; }
  .cp-rail a { display:block; color:#0066cc; cursor:pointer; padding:3px 0; }
  .cp-rail a:hover { text-decoration:underline; }
  .cp-rail .divider { height:1px; background:#dfdfdf; margin:14px 0; }

  .cp-pane { flex:1; overflow-y:auto; background:#fff; padding:18px 22px; }
  .cp-title { font-size:16px; color:#003399; margin:0 0 4px; font-weight:400; }
  .cp-subtitle { color:#767676; margin:0 0 18px; }

  .cp-categories { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr));
    gap:20px 28px; }
  .cp-cat { display:flex; gap:12px; align-items:flex-start; }
  .cp-cat .glyph { font-size:30px; line-height:1; flex-shrink:0; }
  .cp-cat .name { color:#0066cc; cursor:pointer; font-size:13px; }
  .cp-cat .name:hover { text-decoration:underline; }
  .cp-cat .blurb { color:#444; margin-top:2px; }
  .cp-cat .child { color:#0066cc; cursor:pointer; display:block; margin-top:3px; }
  .cp-cat .child:hover { text-decoration:underline; }

  .cp-icons { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:6px; }
  .cp-icon { display:flex; align-items:center; gap:9px; padding:6px 8px; border-radius:3px;
    cursor:pointer; }
  .cp-icon:hover { background:#e5f3ff; outline:1px solid #cce8ff; }
  .cp-icon .glyph { font-size:22px; }
  .cp-icon .name { color:#0066cc; }

  .cp-heading { font-size:15px; color:#003399; font-weight:400; margin:0 0 14px; }
  .cp-kv { display:flex; justify-content:space-between; gap:20px; padding:6px 0;
    border-bottom:1px solid #ededed; }
  .cp-kv-label { color:#444; }
  .cp-kv-value { color:#000; text-align:right; }
  .cp-ok { color:#107c10; }
  .cp-note { color:#767676; margin-top:14px; line-height:1.6; }

  .cp-list-head { display:flex; gap:12px; padding:6px 0; border-bottom:1px solid #c9c9c9;
    color:#444; font-weight:600; }
  .cp-list-head span:first-child { flex:1; }
  .cp-row { display:flex; align-items:center; gap:12px; padding:7px 0;
    border-bottom:1px solid #ededed; }
  .cp-row:hover { background:#f5faff; }
  .cp-row-main { flex:1; }
  .cp-row-name { color:#000; }
  .cp-row-sub { color:#767676; font-size:11px; }
  .cp-row-col { width:74px; text-align:right; color:#444; }
  .cp-row-col.wide { width:96px; }
`;

export function renderControlPanelWindow(body: HTMLElement): void {
  body.innerHTML = '';
  body.style.cssText = 'height:100%;overflow:hidden;';

  const style = document.createElement('style');
  style.textContent = STYLES;
  body.appendChild(style);

  const root = document.createElement('div');
  root.className = 'cp-root';
  body.appendChild(root);

  /** null = the landing page; a CategoryId = that category; else an applet id. */
  let openApplet: string | null = null;
  let openCategory: CategoryId | null = null;
  let view: ViewMode = 'category';
  let query = '';

  // --- Address bar ----------------------------------------------------------
  const addressbar = document.createElement('div');
  addressbar.className = 'cp-addressbar';
  const crumbs = document.createElement('div');
  crumbs.className = 'cp-crumbs';
  const search = document.createElement('input');
  search.className = 'cp-search';
  search.type = 'search';
  search.placeholder = 'Search Control Panel';
  search.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    // Searching is a flat list of matches, as it is in Windows.
    if (query) {
      openApplet = null;
      openCategory = null;
    }
    render();
  });
  addressbar.append(crumbs, search);
  root.appendChild(addressbar);

  const bodyRow = document.createElement('div');
  bodyRow.className = 'cp-body';
  const rail = document.createElement('div');
  rail.className = 'cp-rail';
  const pane = document.createElement('div');
  pane.className = 'cp-pane';
  bodyRow.append(rail, pane);
  root.appendChild(bodyRow);

  function goHome(): void {
    openApplet = null;
    openCategory = null;
    query = '';
    search.value = '';
    render();
  }

  function crumb(label: string, onClick?: () => void): HTMLElement {
    const el = document.createElement('span');
    el.className = onClick ? 'cp-crumb' : 'cp-crumb current';
    el.textContent = label;
    if (onClick) el.addEventListener('click', onClick);
    return el;
  }

  function separator(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cp-sep';
    el.textContent = '›';
    return el;
  }

  function renderCrumbs(): void {
    crumbs.innerHTML = '';
    crumbs.appendChild(crumb('Control Panel', openApplet || openCategory ? goHome : undefined));

    if (openCategory) {
      const cat = CATEGORIES.find((c) => c.id === openCategory)!;
      crumbs.append(
        separator(),
        crumb(cat.label, openApplet ? () => {
          openApplet = null;
          render();
        } : undefined),
      );
    } else if (openApplet && view === 'icons') {
      crumbs.append(separator(), crumb('All Control Panel Items', () => {
        openApplet = null;
        render();
      }));
    }

    if (openApplet) {
      crumbs.append(separator(), crumb(APPLET_BY_ID[openApplet]!.label));
    }
  }

  function renderRail(): void {
    rail.innerHTML = '';

    const home = document.createElement('a');
    home.textContent = 'Control Panel Home';
    home.addEventListener('click', goHome);
    rail.appendChild(home);

    const divider = document.createElement('div');
    divider.className = 'divider';
    rail.appendChild(divider);

    const viewTitle = document.createElement('h4');
    viewTitle.textContent = 'View by';
    rail.appendChild(viewTitle);

    for (const [mode, label] of [
      ['category', 'Category'],
      ['icons', 'Large icons'],
    ] as const) {
      const a = document.createElement('a');
      a.textContent = view === mode ? `● ${label}` : label;
      a.addEventListener('click', () => {
        view = mode;
        openApplet = null;
        openCategory = null;
        render();
      });
      rail.appendChild(a);
    }

    const divider2 = document.createElement('div');
    divider2.className = 'divider';
    rail.appendChild(divider2);

    const seeAlso = document.createElement('h4');
    seeAlso.textContent = 'See also';
    rail.appendChild(seeAlso);
    for (const label of ['Settings', 'Active Directory Users and Computers']) {
      const a = document.createElement('a');
      a.textContent = label;
      // Not wired: the rail in the real Control Panel links out to places
      // this window does not own, and pretending otherwise would be a button
      // that lies about what it does.
      a.style.color = '#767676';
      a.style.cursor = 'default';
      rail.appendChild(a);
    }
  }

  function paneTitle(title: string, subtitle?: string): void {
    const h = document.createElement('h2');
    h.className = 'cp-title';
    h.textContent = title;
    pane.appendChild(h);
    if (subtitle) {
      const p = document.createElement('p');
      p.className = 'cp-subtitle';
      p.textContent = subtitle;
      pane.appendChild(p);
    }
  }

  function openAppletById(id: string): void {
    openApplet = id;
    openCategory = APPLET_BY_ID[id]!.category;
    render();
  }

  /**
   * Keep Date and Time honest.
   *
   * Started once and self-cancelling when the window goes away, so a closed
   * Control Panel does not leave a timer running. Only the marked nodes are
   * touched -- rewriting the pane once a second would fight the scroll
   * position and any open applet, which is the mistake the ticket console
   * already made and corrected.
   */
  let clockTick: number | null = null;
  function startClockTick(): void {
    if (clockTick !== null) return;
    clockTick = window.setInterval(() => {
      if (!document.contains(pane)) {
        if (clockTick !== null) {
          clearInterval(clockTick);
          clockTick = null;
        }
        return;
      }
      const now = new Date();
      for (const el of pane.querySelectorAll<HTMLElement>('[data-cp-clock]')) {
        el.textContent =
          el.dataset.cpClock === 'date' ? now.toLocaleDateString() : now.toLocaleTimeString();
      }
    }, 1000);
  }

  function renderPane(): void {
    pane.innerHTML = '';
    pane.scrollTop = 0;
    startClockTick();

    // An open applet.
    if (openApplet) {
      const applet = APPLET_BY_ID[openApplet]!;
      const wrap = document.createElement('div');
      wrap.innerHTML = applet.render();
      pane.appendChild(wrap);
      return;
    }

    // Search results.
    if (query) {
      const hits = APPLETS.filter(
        (a) =>
          a.label.toLowerCase().includes(query) ||
          a.blurb.toLowerCase().includes(query) ||
          a.id.includes(query),
      );
      paneTitle(
        `Search results for “${search.value.trim()}”`,
        hits.length === 0 ? 'No items match your search.' : `${hits.length} item(s)`,
      );
      const grid = document.createElement('div');
      grid.className = 'cp-icons';
      for (const a of hits) grid.appendChild(iconTile(a));
      pane.appendChild(grid);
      return;
    }

    // Inside a category.
    if (openCategory) {
      const cat = CATEGORIES.find((c) => c.id === openCategory)!;
      paneTitle(cat.label, cat.blurb);
      const grid = document.createElement('div');
      grid.className = 'cp-icons';
      for (const a of APPLETS.filter((x) => x.category === cat.id)) grid.appendChild(iconTile(a));
      pane.appendChild(grid);
      return;
    }

    // Landing page.
    if (view === 'icons') {
      paneTitle('All Control Panel Items', 'Adjust your computer’s settings');
      const grid = document.createElement('div');
      grid.className = 'cp-icons';
      for (const a of APPLETS) grid.appendChild(iconTile(a));
      pane.appendChild(grid);
      return;
    }

    paneTitle('Adjust your computer’s settings', `Viewing ${VM_HOST.name} · ${VM_HOST.domain}`);
    const grid = document.createElement('div');
    grid.className = 'cp-categories';
    for (const cat of CATEGORIES) {
      const wrap = document.createElement('div');
      wrap.className = 'cp-cat';

      const glyph = document.createElement('div');
      glyph.className = 'glyph';
      glyph.textContent = cat.icon;

      const text = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = cat.label;
      name.addEventListener('click', () => {
        openCategory = cat.id;
        render();
      });
      const blurb = document.createElement('div');
      blurb.className = 'blurb';
      blurb.textContent = cat.blurb;
      text.append(name, blurb);

      // The task links Windows shows under each category heading.
      for (const applet of APPLETS.filter((a) => a.category === cat.id).slice(0, 2)) {
        const child = document.createElement('span');
        child.className = 'child';
        child.textContent = applet.blurb;
        child.addEventListener('click', () => openAppletById(applet.id));
        text.appendChild(child);
      }

      wrap.append(glyph, text);
      grid.appendChild(wrap);
    }
    pane.appendChild(grid);
  }

  function iconTile(applet: Applet): HTMLElement {
    const tile = document.createElement('div');
    tile.className = 'cp-icon';
    const glyph = document.createElement('span');
    glyph.className = 'glyph';
    glyph.textContent = applet.icon;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = applet.label;
    tile.append(glyph, name);
    tile.addEventListener('click', () => openAppletById(applet.id));
    return tile;
  }

  function render(): void {
    renderCrumbs();
    renderRail();
    renderPane();
  }

  render();
}
