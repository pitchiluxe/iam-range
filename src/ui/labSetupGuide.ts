/**
 * ui/labSetupGuide.ts — how to get the two real VMs, in one place.
 *
 * The AD Enterprise Lab's "Real VMs" mode and the IAM Portfolio's VM track
 * both run on the same two VirtualBox machines, built by the kit in
 * omari-lab/10-AD-ENTERPRISE-VBOX from the free Microsoft evaluation ISOs.
 * The kit finds the ISOs by exact file name and names everything it builds, so
 * a learner has to know those names before anything works. This guide is
 * opened from both windows, so the two can never give different instructions.
 */
import diagramSvg from '../../docs/images/ad-lab-network.svg?raw';
import { openExternal } from '@/util/externalLink';

export const DOWNLOADS = {
  virtualbox: 'https://www.virtualbox.org/wiki/Downloads',
  server: 'https://www.microsoft.com/en-us/evalcenter/download-windows-server-2022',
  client: 'https://www.microsoft.com/en-us/evalcenter/download-windows-11-enterprise',
} as const;

export const ISO_FOLDER = '%USERPROFILE%\\Downloads\\ADLab-ISOs';
export const ISO_NAMES = {
  server: 'WindowsServer2022-Eval.iso',
  client: 'Windows11-Enterprise-Eval.iso',
} as const;

/** The names the kit uses, and that the checks and snapshots rely on. */
export const NAMING: readonly [string, string][] = [
  ['ISO folder', ISO_FOLDER],
  ['Server ISO', ISO_NAMES.server],
  ['Client ISO', ISO_NAMES.client],
  ['VirtualBox group', '/TechnoBiz-ADLab'],
  ['Domain controller VM', 'ADLab-DC01  (computer name DC01)'],
  ['Client VM', 'ADLab-CLIENT01  (computer name CLIENT01)'],
  ['DC01 network adapters', '"Internet" (NAT) and "Internal" (TechnoBiz-LAN)'],
  ['CLIENT01 network adapter', '"Ethernet" (TechnoBiz-LAN)'],
  ['Internal network', 'TechnoBiz-LAN · 172.16.0.0/24'],
  ['DC01 internal address', '172.16.0.1 / 255.255.255.0 · DNS 127.0.0.1 · no gateway'],
  ['DHCP scope', '"TechnoBiz LAN" · 172.16.0.100 – 172.16.0.200 · router + DNS 172.16.0.1'],
  ['Domain', 'corp.technobiz.local  (NetBIOS: CORP)'],
  ['Sign-in', 'Administrator, then CORP\\Administrator after promotion. Password: adminPassword in adlab.vbox.json'],
  ['AD Lab snapshots', 'Lab01-Start, Lab02-Start … (one per lab)'],
  ['Portfolio snapshot', 'Portfolio-Base (made by "Prepare DC01")'],
  ['Portfolio OUs', 'Enterprise_Root → Tier0_Admins · Tier1_Systems · Tier2_Staff (one OU per department)'],
  ['Portfolio groups', 'GG-<Department> (people) · GS-<Resource>-RW/RO (access) · Role-* / Res-* (Project 2)'],
  ['Portfolio work folders', 'C:\\IAM\\<project> (scripts, logs, reports) · C:\\Shares\\<Department>'],
];

const MOVE_COMMANDS = [
  `New-Item -ItemType Directory -Force "$env:USERPROFILE\\Downloads\\ADLab-ISOs"`,
  `Move-Item "$env:USERPROFILE\\Downloads\\*SERVER_EVAL*.iso" "$env:USERPROFILE\\Downloads\\ADLab-ISOs\\${ISO_NAMES.server}"`,
  `Move-Item "$env:USERPROFILE\\Downloads\\*CLIENTENTERPRISEEVAL*.iso" "$env:USERPROFILE\\Downloads\\ADLab-ISOs\\${ISO_NAMES.client}"`,
].join('\n');

/** Where the kit is when the app cannot say (a browser tab, or an older app). */
const KIT_HINT = '<IAM Range install folder>\\resources\\omari-lab\\10-AD-ENTERPRISE-VBOX';

const buildCommands = (kitDir: string): string =>
  [
    `cd "${kitDir}"`,
    'powershell -ExecutionPolicy Bypass -File .\\01-New-AdLabVMs.ps1',
    'powershell -ExecutionPolicy Bypass -File .\\02-Initialize-AdLabGuests.ps1',
  ].join('\n');

type Bridge = { invoke: (cmd: string, ...args: unknown[]) => Promise<unknown> };
function bridge(): Bridge | null {
  const e = (window as unknown as { electron?: { invoke?: Bridge['invoke'] } }).electron;
  return e?.invoke ? { invoke: e.invoke } : null;
}

const HYPERVISOR_COMMANDS = 'bcdedit /set hypervisorlaunchtype off';

const STYLE_ID = 'lab-setup-guide-styles';
const STYLES = `
.lsg-back{position:fixed;inset:0;z-index:100000;background:rgba(3,7,18,.62);display:flex;align-items:flex-start;justify-content:center;padding:32px 16px;overflow:auto;}
.lsg{width:min(980px,100%);background:var(--panel,#111827);color:var(--fg,#e5e7eb);border:1px solid var(--border,#334155);border-radius:12px;box-shadow:0 24px 64px rgba(0,0,0,.5);font:13px/1.55 "Segoe UI",system-ui,sans-serif;}
.lsg-top{display:flex;align-items:flex-start;gap:12px;padding:18px 22px 12px;border-bottom:1px solid var(--border,#334155);}
.lsg-top h2{margin:0;font-size:19px;}
.lsg-top p{margin:4px 0 0;color:var(--muted,#94a3b8);}
.lsg-x{margin-left:auto;white-space:nowrap;flex-shrink:0;background:transparent;border:1px solid var(--border,#334155);color:var(--fg,#e5e7eb);border-radius:6px;padding:4px 10px;cursor:pointer;font:inherit;}
.lsg-body{padding:6px 22px 22px;}
.lsg-step{display:grid;grid-template-columns:30px 1fr;gap:12px;padding:14px 0;border-bottom:1px dashed var(--border,#334155);}
.lsg-step:last-of-type{border-bottom:none;}
.lsg-n{width:28px;height:28px;border-radius:50%;background:var(--accent,#22c55e);color:#06231d;display:flex;align-items:center;justify-content:center;font-weight:800;}
.lsg-step h3{margin:2px 0 6px;font-size:15px;}
.lsg-step p,.lsg-step li{margin:4px 0;color:var(--fg,#e5e7eb);}
.lsg-step ul{margin:4px 0;padding-left:18px;}
.lsg-muted{color:var(--muted,#94a3b8);}
.lsg-links{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0;}
.lsg-link{background:var(--accent,#22c55e);color:#06231d;border:none;border-radius:6px;padding:7px 12px;font:inherit;font-weight:700;cursor:pointer;}
.lsg-link.alt{background:transparent;color:var(--fg,#e5e7eb);border:1px solid var(--border,#334155);font-weight:600;}
.lsg-code{position:relative;margin:8px 0;}
.lsg-code pre{margin:0;background:#0b1220;color:#d1e7ff;border:1px solid #1e293b;border-radius:8px;padding:10px 12px;overflow-x:auto;font:12px/1.5 Consolas,ui-monospace,monospace;white-space:pre;}
.lsg-copy{position:absolute;top:6px;right:6px;font:11px "Segoe UI",sans-serif;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:5px;padding:3px 8px;cursor:pointer;}
.lsg-table{width:100%;border-collapse:collapse;margin:6px 0;font-size:12.5px;}
.lsg-table td{border-bottom:1px solid var(--border,#334155);padding:6px 8px;vertical-align:top;}
.lsg-table td:first-child{color:var(--muted,#94a3b8);white-space:nowrap;width:1%;}
.lsg-table td:last-child{font-family:Consolas,ui-monospace,monospace;}
.lsg-diagram{margin:8px 0;border-radius:12px;overflow:hidden;border:1px solid var(--border,#334155);}
.lsg-diagram svg{display:block;width:100%;height:auto;}
.lsg-note{border-left:3px solid #f59e0b;background:rgba(245,158,11,.08);padding:8px 12px;border-radius:6px;margin:8px 0;}
`;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function code(text: string): HTMLElement {
  const wrap = h('div', 'lsg-code');
  const pre = h('pre', undefined, text);
  const copy = h('button', 'lsg-copy', 'Copy');
  copy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(text).then(
      () => { copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1500); },
      () => { copy.textContent = 'Select and copy'; },
    );
  });
  wrap.append(pre, copy);
  return wrap;
}

function link(label: string, url: string, alt = false): HTMLElement {
  const b = h('button', `lsg-link${alt ? ' alt' : ''}`, label);
  b.title = url;
  b.addEventListener('click', () => openExternal(url));
  return b;
}

function step(n: number, title: string, ...content: (HTMLElement | string)[]): HTMLElement {
  const s = h('div', 'lsg-step');
  const body = h('div');
  body.append(h('h3', undefined, title));
  for (const c of content) body.append(typeof c === 'string' ? h('p', undefined, c) : c);
  s.append(h('div', 'lsg-n', String(n)), body);
  return s;
}

function bullets(...items: string[]): HTMLElement {
  const ul = h('ul');
  for (const i of items) ul.append(h('li', undefined, i));
  return ul;
}

/** Open the guide over whatever is on screen. Esc or ✕ closes it. */
export function openLabSetupGuide(from: 'adlab' | 'portfolio' = 'adlab'): void {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLES;
    document.head.appendChild(style);
  }
  document.querySelector('.lsg-back')?.remove();

  const back = h('div', 'lsg-back');
  const box = h('div', 'lsg');
  back.append(box);

  const top = h('div', 'lsg-top');
  const titles = h('div');
  titles.append(
    h('h2', undefined, '📘 Set up the real VMs (Windows Server + Windows client)'),
    h('p', undefined,
      'Needed for the AD Enterprise Lab in "Real VMs" mode and for the IAM Portfolio\'s real-VM track. ' +
      'The simulated labs need none of this. Both use the same two VirtualBox machines, so you build them once.'),
  );
  const close = h('button', 'lsg-x', '✕ Close');
  top.append(titles, close);

  const bodyEl = h('div', 'lsg-body');

  // The kit folder depends on where IAM Range was installed; the desktop app knows.
  const buildBlock = h('div');
  buildBlock.append(code(buildCommands(KIT_HINT)));
  const b = bridge();
  if (b) {
    void b
      .invoke('adlab:kit-folder')
      .then((dir) => {
        if (typeof dir !== 'string' || !dir) return;
        const links = h('div', 'lsg-links');
        const open = h('button', 'lsg-link alt', '📂 Open the kit folder');
        open.addEventListener('click', () => void b.invoke('adlab:open-kit-folder'));
        links.append(open);
        buildBlock.replaceChildren(code(buildCommands(dir)), links);
      })
      .catch(() => undefined);
  }

  const diagram = h('div', 'lsg-diagram');
  // A static asset bundled with the app (docs/images/ad-lab-network.svg), parsed as SVG, not HTML.
  const svgDoc = new DOMParser().parseFromString(diagramSvg, 'image/svg+xml');
  if (svgDoc.documentElement.nodeName === 'svg') diagram.append(document.importNode(svgDoc.documentElement, true));

  bodyEl.append(
    diagram,
    step(1, 'Check your PC',
      bullets(
        'Windows 10 or 11, 64-bit. 16 GB of RAM is comfortable (each VM uses 4 GB); 8 GB works slowly.',
        'About 140 GB of free disk space, and virtualization (Intel VT-x / AMD-V) enabled in the BIOS.',
        'Turn Windows\' own hypervisor off, or VirtualBox runs very slowly: Windows Security → Device security → Core isolation → Memory integrity: Off; turn off "Virtual Machine Platform" in Windows Features; then run this in an administrator PowerShell and restart:',
      ),
      code(HYPERVISOR_COMMANDS),
    ),
    step(2, 'Install VirtualBox 7',
      'Download "Windows hosts" and install with the default options (the kit expects C:\\Program Files\\Oracle\\VirtualBox).',
      (() => { const l = h('div', 'lsg-links'); l.append(link('Download VirtualBox ↗', DOWNLOADS.virtualbox)); return l; })(),
    ),
    step(3, 'Download the two Windows ISOs (free 180-day evaluations)',
      bullets(
        'Windows Server 2022 (the domain controller, DC01): fill in the short form, then choose English (United States) → "ISO downloads" → 64-bit edition.',
        'Windows 11 Enterprise (the client, CLIENT01): choose English (United States) → "ISO – Enterprise download" → 64-bit edition. Not the LTSC one.',
      ),
      (() => {
        const l = h('div', 'lsg-links');
        l.append(link('Windows Server 2022 ISO ↗', DOWNLOADS.server), link('Windows 11 Enterprise ISO ↗', DOWNLOADS.client));
        return l;
      })(),
      h('p', 'lsg-muted', 'Both are official Microsoft Evaluation Center downloads, about 5 GB each. No product key is needed.'),
    ),
    step(4, 'Name them exactly like this, in this folder',
      (() => {
        const t = h('table', 'lsg-table');
        for (const [k, v] of [['Folder', ISO_FOLDER], ['Server ISO', ISO_NAMES.server], ['Client ISO', ISO_NAMES.client]] as const) {
          const tr = h('tr');
          tr.append(h('td', undefined, k), h('td', undefined, v));
          t.append(tr);
        }
        return t;
      })(),
      'The kit finds the ISOs by these exact names. Rename them by hand, or run this in PowerShell after both downloads finish:',
      code(MOVE_COMMANDS),
      h('p', 'lsg-muted', 'Stored them somewhere else? Change the two paths under "isos" in adlab.vbox.json instead.'),
    ),
    step(5, 'Build the VMs (once)',
      'Open PowerShell and run the kit that ships with IAM Range. It installs both machines unattended and names everything for you. Allow 30–90 minutes; leave the VirtualBox windows alone while it works.',
      buildBlock,
      h('p', 'lsg-muted', 'Working from the source code instead? The same scripts are in omari-lab\\10-AD-ENTERPRISE-VBOX in the repository.'),
      bullets(
        '01-New-AdLabVMs.ps1 creates ADLab-DC01 and ADLab-CLIENT01 in the VirtualBox group /TechnoBiz-ADLab and installs Windows on both.',
        '02-Initialize-AdLabGuests.ps1 names the network adapters and saves the snapshot Lab01-Start, so you can always start over.',
      ),
    ),
    step(6, 'Use them',
      bullets(
        'AD Enterprise Lab: pick "Real VMs (VirtualBox)" at the top, do each lab inside the VM windows, then press Check. "Start over" restores the LabNN-Start snapshots.',
        'IAM Portfolio: finish AD Lab 01 on the real DC01 first, then press "1. Prepare DC01 (once)". It makes DC01 the domain controller for corp.technobiz.local, builds the company baseline and saves the snapshot Portfolio-Base. Then, per project: "2. Set up this project" → do the work in DC01 → "3. Check my work".',
      ),
      h('div', 'lsg-note', 'Sign in to the VMs as Administrator (CORP\\Administrator once the domain exists). The lab password is the "adminPassword" value in adlab.vbox.json. Change it there before building if you like; it is only for these two lab machines.'),
    ),
  );

  const naming = h('div', 'lsg-step');
  const namingBody = h('div');
  const table = h('table', 'lsg-table');
  for (const [k, v] of NAMING) {
    const tr = h('tr');
    tr.append(h('td', undefined, k), h('td', undefined, v));
    table.append(tr);
  }
  namingBody.append(
    h('h3', undefined, 'Naming convention'),
    h('p', 'lsg-muted', 'Everything below is created by the kit and the labs. Keep these names: the checks, snapshots and scripts look for them.'),
    table,
  );
  naming.append(h('div', 'lsg-n', '★'), namingBody);
  bodyEl.append(naming);

  box.append(top, bodyEl);
  document.body.append(back);

  const shut = (): void => {
    back.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') shut();
  };
  close.addEventListener('click', shut);
  back.addEventListener('click', (e) => { if (e.target === back) shut(); });
  document.addEventListener('keydown', onKey);
  close.focus();
  void from;
}
