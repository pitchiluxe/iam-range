/**
 * ui/consoles/controlPanelWindow.ts — VM Control Panel (classic Windows style).
 *
 * A grid of applet icons; clicking one opens a detail pane with plausible
 * fake system info, same "fake but realistic" approach as File Explorer's
 * folder contents and Settings' System page.
 */

interface Applet {
  id: string;
  icon: string;
  label: string;
  render(): string;
}

const APPLETS: Applet[] = [
  {
    id: 'programs',
    icon: '📦',
    label: 'Programs and Features',
    render: () => `
      <h3 style="margin:0 0 12px 0;color:#e6e6e6;font-size:14px;">Uninstall or change a program</h3>
      ${row('IAM Console', 'Apex Identity Solutions', '54.1 MB', '8/12/2026')}
      ${row('Ticket Queue', 'Apex Identity Solutions', '38.7 MB', '8/12/2026')}
      ${row('SecOps Dashboard', 'Apex Identity Solutions', '61.3 MB', '8/12/2026')}
    `,
  },
  {
    id: 'network',
    icon: '🌐',
    label: 'Network and Sharing Center',
    render: () => `
      <h3 style="margin:0 0 12px 0;color:#e6e6e6;font-size:14px;">Network status</h3>
      ${kv('Connection', 'Northwind-Corp (Ethernet)')}
      ${kv('IPv4 address', '10.42.8.114')}
      ${kv('DNS server', '10.42.0.10')}
      ${kv('Status', '<span style="color:#4ec9b0;">Connected</span>')}
    `,
  },
  {
    id: 'firewall',
    icon: '🛡️',
    label: 'Windows Defender Firewall',
    render: () => `
      <h3 style="margin:0 0 12px 0;color:#e6e6e6;font-size:14px;">Firewall status</h3>
      ${kv('Domain network', '<span style="color:#4ec9b0;">On</span>')}
      ${kv('Private network', '<span style="color:#4ec9b0;">On</span>')}
      ${kv('Public network', '<span style="color:#4ec9b0;">On</span>')}
      <p style="color:#8b95a1;font-size:11px;margin-top:12px;">Managed centrally by Northwind IT — local changes are disabled.</p>
    `,
  },
  {
    id: 'users',
    icon: '👤',
    label: 'User Accounts',
    render: () => `
      <h3 style="margin:0 0 12px 0;color:#e6e6e6;font-size:14px;">Manage accounts</h3>
      ${row('admin', 'Administrator', '', '')}
      <p style="color:#8b95a1;font-size:11px;margin-top:12px;">Account changes are managed through the IAM Console, not locally.</p>
    `,
  },
  {
    id: 'devices',
    icon: '🖱️',
    label: 'Devices and Printers',
    render: () => `
      <h3 style="margin:0 0 12px 0;color:#e6e6e6;font-size:14px;">Devices</h3>
      ${row('APEX-OPS-01', 'This PC', '', '')}
      ${row('Northwind-Print-02', 'Printer · Ready', '', '')}
      ${row('USB Input Device', 'Keyboard', '', '')}
    `,
  },
  {
    id: 'system',
    icon: '🖥️',
    label: 'System',
    render: () => `
      <h3 style="margin:0 0 12px 0;color:#e6e6e6;font-size:14px;">System properties</h3>
      ${kv('Computer name', 'APEX-OPS-01')}
      ${kv('Domain', 'northwind.local')}
      ${kv('Processor', 'Apex vCPU @ 3.2 GHz')}
      ${kv('RAM', '16.0 GB')}
      ${kv('Edition', 'Apex OS 11 Enterprise')}
    `,
  },
  {
    id: 'power',
    icon: '🔋',
    label: 'Power Options',
    render: () => `
      <h3 style="margin:0 0 12px 0;color:#e6e6e6;font-size:14px;">Power plan</h3>
      ${kv('Active plan', 'Balanced')}
      ${kv('Sleep after', '30 minutes')}
      ${kv('Display off after', '15 minutes')}
    `,
  },
  {
    id: 'date',
    icon: '🕐',
    label: 'Date and Time',
    render: () => `
      <h3 style="margin:0 0 12px 0;color:#e6e6e6;font-size:14px;">Date and time</h3>
      ${kv('Current time', new Date().toLocaleString())}
      ${kv('Time zone', Intl.DateTimeFormat().resolvedOptions().timeZone)}
      ${kv('Sync', '<span style="color:#4ec9b0;">Synchronized</span>')}
    `,
  },
];

function kv(label: string, value: string): string {
  return `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #232830;font-size:12px;"><span style="color:#8b95a1;">${label}</span><span style="color:#e6e6e6;">${value}</span></div>`;
}

function row(name: string, publisher: string, size: string, date: string): string {
  return `
    <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #232830;font-size:12px;">
      <div style="flex:1;">
        <div style="color:#e6e6e6;">${name}</div>
        <div style="color:#8b95a1;font-size:11px;">${publisher}</div>
      </div>
      ${size ? `<span style="color:#8b95a1;width:70px;text-align:right;">${size}</span>` : ''}
      ${date ? `<span style="color:#8b95a1;width:90px;text-align:right;">${date}</span>` : ''}
    </div>
  `;
}

export function renderControlPanelWindow(body: HTMLElement): void {
  body.style.cssText =
    'display:flex;height:100%;background:#eef2f6;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI Variable","Segoe UI",sans-serif;color:#1f2933;';

  const sidebar = document.createElement('div');
  sidebar.style.cssText =
    'width:220px;flex-shrink:0;background:#f7f9fb;border-right:1px solid #d8dee5;padding:10px;overflow-y:auto;';
  body.appendChild(sidebar);

  const content = document.createElement('div');
  content.style.cssText = 'flex:1;padding:20px 24px;overflow-y:auto;background:#ffffff;';
  body.appendChild(content);

  const header = document.createElement('div');
  header.style.cssText =
    'font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7684;padding:6px 8px 10px;';
  header.textContent = 'All Control Panel Items';
  sidebar.appendChild(header);

  let activeId = APPLETS[0]!.id;

  function renderApplets(): void {
    sidebar.querySelectorAll('.cp-applet').forEach((el) => el.remove());
    for (const applet of APPLETS) {
      const btn = document.createElement('button');
      btn.className = 'cp-applet';
      const isActive = applet.id === activeId;
      btn.style.cssText = `
        display:flex;align-items:center;gap:10px;width:100%;text-align:left;
        padding:8px 10px;border:none;cursor:pointer;font-size:12px;border-radius:4px;
        background:${isActive ? '#dbeafe' : 'transparent'};
        color:${isActive ? '#1d4ed8' : '#1f2933'};
      `;
      btn.innerHTML = `<span style="font-size:16px;">${applet.icon}</span><span>${applet.label}</span>`;
      btn.addEventListener('click', () => {
        activeId = applet.id;
        renderApplets();
        renderContent();
      });
      sidebar.appendChild(btn);
    }
  }

  function renderContent(): void {
    const applet = APPLETS.find((a) => a.id === activeId)!;
    content.innerHTML = applet.render();
  }

  renderApplets();
  renderContent();
}
