/**
 * ui/consoles/endpointApps.ts — the parts of an end user's computer a
 * help-desk technician works in: Outlook, the VPN client, Software Center, and
 * the Printers, Network, Storage and Credential Manager pages of Settings.
 *
 * Every control calls the endpoint service, the same one the terminal's repair
 * cmdlets and the ticket review use. So a printer brought back online here is
 * online for Get-Printer and for the review, and nothing here decides whether
 * a fault is fixed: each panel only shows the computer's state and changes it.
 *
 * On the admin's own workstation there is no managed endpoint, so Outlook,
 * Corp VPN and Software Center show a working, read-only picture of that
 * machine rather than someone else's broken one.
 */
import type { VmServices } from '@/vm/session';
import type { UserId } from '@/domain';
import type { Endpoint, EndpointResult } from '@/services';
import {
  CORP_WIFI,
  GUEST_WIFI,
  OFFICE_CREDENTIAL,
  PDF_PRINTER,
  SHARE_DRIVE,
  SOFTWARE_CATALOG,
  sharePath,
} from '@/services/mockEndpoints';
import { VM_HOST } from '@/config/vmHost';
import { login } from '@/vm/loginSession';
import { notifyEndpointChanged, onEndpointChanged } from '@/util/endpointEvents';

/** Which computer a panel acts on. */
export interface EndpointUi {
  services: VmServices;
  computer: string;
}

const actor = (): UserId => (login.user?.id ?? 'system') as UserId;

const el = (tag: string, css: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text !== undefined) e.textContent = text;
  return e;
};

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = primary
    ? 'padding:6px 14px;border-radius:4px;border:1px solid #2563eb;background:#2563eb;color:#fff;font-size:12px;cursor:pointer;font-family:inherit;'
    : 'padding:6px 12px;border-radius:4px;border:1px solid var(--border);background:var(--panel-alt);color:var(--fg);font-size:12px;cursor:pointer;font-family:inherit;';
  b.addEventListener('click', onClick);
  return b;
}

/** A line under a control saying what just happened, in words from the computer. */
function feedback(host: HTMLElement): (r: EndpointResult) => void {
  return (r) => {
    host.textContent = r.ok ? r.message : r.error;
    host.style.color = r.ok ? 'var(--accent)' : 'var(--err)';
  };
}

function card(title: string, subtitle?: string): { box: HTMLElement; body: HTMLElement } {
  const box = el(
    'div',
    'background:var(--panel-alt);border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:12px;',
  );
  box.appendChild(el('div', 'font-size:13px;font-weight:600;color:var(--fg);', title));
  if (subtitle) box.appendChild(el('div', 'font-size:11.5px;color:var(--muted);margin-top:2px;', subtitle));
  const body = el('div', 'margin-top:10px;display:flex;flex-direction:column;gap:8px;');
  box.appendChild(body);
  return { box, body };
}

function row(label: string, value: string, valueColor = 'var(--fg)'): HTMLElement {
  const r = el('div', 'display:flex;justify-content:space-between;gap:12px;font-size:12px;');
  r.append(el('span', 'color:var(--muted);', label), el('span', `color:${valueColor};text-align:right;`, value));
  return r;
}

/**
 * Render `draw` into `container`, and again whenever the computer changes.
 * Every panel is drawn this way, so none of them shows a stale state.
 */
function live(container: HTMLElement, ui: EndpointUi, draw: (e: Endpoint) => void): void {
  const paint = (): void => {
    const e = ui.services.endpoints.get(ui.computer);
    container.innerHTML = '';
    if (!e) {
      container.appendChild(el('div', 'color:var(--muted);font-size:12px;', `${ui.computer} is not a managed computer.`));
      return;
    }
    draw(e);
  };
  paint();
  onEndpointChanged(container, ui.computer, paint);
}

/** Run a repair, then tell every window on this computer. */
function act(ui: EndpointUi, fn: () => EndpointResult, show?: (r: EndpointResult) => void): void {
  const r = fn();
  notifyEndpointChanged(ui.computer);
  show?.(r);
}

// ---------------------------------------------------------------------------
// Settings pages
// ---------------------------------------------------------------------------

export function renderPrintersSettings(container: HTMLElement, ui: EndpointUi): void {
  const eps = ui.services.endpoints;
  const status = el('div', 'font-size:11.5px;min-height:16px;margin-bottom:8px;');
  const list = el('div', '');
  container.append(status, list);
  const say = feedback(status);

  live(list, ui, (e) => {
    const spooler = eps.service(e, 'Spooler');
    const svc = card('Print Spooler service', 'Every job on this computer goes through it.');
    svc.body.appendChild(
      row('Status', spooler?.status ?? 'Missing', spooler?.status === 'Running' ? 'var(--accent)' : 'var(--err)'),
    );
    if (spooler?.status !== 'Running') {
      svc.body.appendChild(
        el('div', 'font-size:11.5px;color:var(--err);', 'The printer list cannot be managed while the spooler is stopped.'),
      );
    }
    svc.body.appendChild(
      button(spooler?.status === 'Running' ? 'Restart service' : 'Start service', () =>
        act(ui, () => eps.setServiceState(e.name, 'Spooler', 'restart', actor()), say),
      ),
    );
    list.appendChild(svc.box);

    if (spooler?.status !== 'Running') return;

    for (const p of e.printers) {
      const c = card(
        `🖨️ ${p.name}${p.isDefault ? '  (Default)' : ''}`,
        p.name === PDF_PRINTER ? 'Saves documents as PDF files instead of printing them.' : 'Office multifunction printer, floor 2.',
      );
      c.body.appendChild(row('Status', p.online ? 'Ready' : 'Offline', p.online ? 'var(--accent)' : 'var(--err)'));
      c.body.appendChild(row('Jobs in queue', String(p.jobs.length), p.jobs.some((j) => j.status === 'Error') ? 'var(--err)' : 'var(--fg)'));

      if (p.jobs.length > 0) {
        const q = el('div', 'border:1px solid var(--border);border-radius:4px;overflow:hidden;');
        for (const j of p.jobs) {
          const jr = el(
            'div',
            'display:grid;grid-template-columns:1fr 70px 60px;gap:8px;padding:5px 8px;font-size:11.5px;border-bottom:1px solid var(--border);',
          );
          jr.append(
            el('span', 'color:var(--fg);', j.document),
            el('span', `color:${j.status === 'Error' ? 'var(--err)' : 'var(--muted)'};`, j.status === 'Error' ? 'Error - Printing' : j.status),
            el('span', 'color:var(--muted);text-align:right;', `${j.pages} page${j.pages > 1 ? 's' : ''}`),
          );
          q.appendChild(jr);
        }
        c.body.appendChild(q);
      }

      const controls = el('div', 'display:flex;gap:6px;flex-wrap:wrap;');
      if (!p.isDefault) {
        controls.appendChild(button('Set as default', () => act(ui, () => eps.setDefaultPrinter(e.name, p.name, actor()), say)));
      }
      if (p.name !== PDF_PRINTER) {
        // Windows hides this under "See what's printing" > Printer menu.
        const offline = document.createElement('label');
        offline.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;color:var(--fg);cursor:pointer;';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = !p.online;
        box.addEventListener('change', () => act(ui, () => eps.setPrinterOnline(e.name, p.name, !box.checked, actor()), say));
        offline.append(box, document.createTextNode('Use printer offline'));
        controls.appendChild(offline);
      }
      if (p.jobs.length > 0) {
        controls.appendChild(button('Cancel all documents', () => act(ui, () => eps.clearPrintQueue(e.name, p.name, actor()), say)));
      }
      c.body.appendChild(controls);
      list.appendChild(c.box);
    }

    const test = card('Print a test page', 'Sends a page to the default printer and reports what happened.');
    test.body.appendChild(button('Print test page', () => act(ui, () => eps.printTestPage(e.name, actor()), say), true));
    list.appendChild(test.box);
  });
}

export function renderNetworkSettings(container: HTMLElement, ui: EndpointUi): void {
  const eps = ui.services.endpoints;
  const status = el('div', 'font-size:11.5px;min-height:16px;margin-bottom:8px;');
  const list = el('div', '');
  container.append(status, list);
  const say = feedback(status);

  live(list, ui, (e) => {
    const n = e.network;
    const corp = eps.onCorpNetwork(e);
    const headline = !n.adapterEnabled
      ? 'Wi-Fi is turned off'
      : !n.ssid
        ? 'Not connected'
        : n.ipv4.startsWith('169.254.')
          ? `${n.ssid} — No internet`
          : corp
            ? `${n.ssid} — Connected, secured`
            : `${n.ssid} — Connected (limited access)`;

    const adapter = card('📶 Wi-Fi', headline);
    const toggle = document.createElement('label');
    toggle.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;color:var(--fg);cursor:pointer;';
    const sw = document.createElement('input');
    sw.type = 'checkbox';
    sw.checked = n.adapterEnabled;
    sw.addEventListener('change', () => act(ui, () => eps.setAdapterEnabled(e.name, sw.checked, actor()), say));
    toggle.append(sw, document.createTextNode(n.adapterEnabled ? 'On' : 'Off'));
    adapter.body.appendChild(toggle);
    list.appendChild(adapter.box);

    if (n.adapterEnabled) {
      const nets = card('Available networks');
      for (const ssid of [CORP_WIFI, GUEST_WIFI]) {
        const r = el('div', 'display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;');
        const label = el('span', 'color:var(--fg);', `${ssid === CORP_WIFI ? '🔒' : '🔓'} ${ssid}${n.ssid === ssid ? '  (connected)' : ''}`);
        r.appendChild(label);
        if (n.ssid !== ssid) r.appendChild(button('Connect', () => act(ui, () => eps.connectWifi(e.name, ssid, actor()), say)));
        nets.body.appendChild(r);
      }
      list.appendChild(nets.box);
    }

    const props = card('Hardware and connection properties');
    props.body.append(
      row('IPv4 address', n.ipv4, n.ipv4.startsWith('169.254.') || n.ipv4 === '0.0.0.0' ? 'var(--err)' : 'var(--fg)'),
      row('Default gateway', n.gateway || '(none)'),
      row('DNS server', n.dnsServer || '(none)'),
      row('Physical address (MAC)', e.mac),
    );
    list.appendChild(props.box);

    const trouble = card('Network troubleshooting', 'The same as ipconfig /release, /renew and /flushdns.');
    const bar = el('div', 'display:flex;gap:6px;flex-wrap:wrap;');
    bar.append(
      button('Renew IP address', () =>
        act(ui, () => {
          const released = eps.releaseIp(e.name, actor());
          return released.ok ? eps.renewIp(e.name, actor()) : released;
        }, say),
      ),
      button('Clear DNS cache', () => act(ui, () => eps.flushDns(e.name, actor()), say)),
    );
    trouble.body.appendChild(bar);
    list.appendChild(trouble.box);
  });
}

export function renderStorageSettings(container: HTMLElement, ui: EndpointUi): void {
  const eps = ui.services.endpoints;
  const status = el('div', 'font-size:11.5px;min-height:16px;margin-bottom:8px;');
  const list = el('div', '');
  container.append(status, list);
  const say = feedback(status);

  live(list, ui, (e) => {
    const used = e.disk.totalGb - e.disk.freeGb;
    const pct = Math.round((used / e.disk.totalGb) * 100);
    const c = card('Local Disk (C:)', `${used.toFixed(1)} GB used of ${e.disk.totalGb} GB`);
    const barOuter = el('div', 'height:10px;border-radius:5px;background:var(--border);overflow:hidden;');
    barOuter.appendChild(el('div', `height:100%;width:${pct}%;background:${e.disk.freeGb < 10 ? 'var(--err)' : 'var(--accent)'};`));
    c.body.append(
      barOuter,
      row('Free space', `${e.disk.freeGb.toFixed(1)} GB`, e.disk.freeGb < 10 ? 'var(--err)' : 'var(--fg)'),
      row('Temporary files', `${e.disk.tempGb.toFixed(1)} GB`),
      button('Clean up temporary files', () => act(ui, () => eps.cleanupDisk(e.name, actor()), say), true),
    );
    list.appendChild(c.box);
  });
}

export function renderCredentialManager(container: HTMLElement, ui: EndpointUi): void {
  const eps = ui.services.endpoints;
  const status = el('div', 'font-size:11.5px;min-height:16px;margin:6px 0;');
  const list = el('div', '');
  container.append(el('div', 'font-size:12px;color:var(--muted);margin:22px 0 10px;text-transform:uppercase;letter-spacing:0.06em;', 'Credential Manager — Windows credentials'), list, status);
  const say = feedback(status);

  live(list, ui, (e) => {
    if (e.credentials.length === 0) {
      list.appendChild(el('div', 'font-size:12px;color:var(--muted);', 'No stored credentials.'));
      return;
    }
    for (const c of e.credentials) {
      const r = el(
        'div',
        'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;',
      );
      const text = el('div', 'min-width:0;');
      text.append(
        el('div', 'font-size:12px;color:var(--fg);word-break:break-all;', c.target),
        el('div', 'font-size:11px;color:var(--muted);', `${c.user} · Modified: ${c.stale ? 'before the last password change' : 'recently'}`),
      );
      r.append(text, button('Remove', () => act(ui, () => eps.removeCredential(e.name, c.target, actor()), say)));
      list.appendChild(r);
    }
  });
}

// ---------------------------------------------------------------------------
// Outlook
// ---------------------------------------------------------------------------

const MAIL = [
  { from: 'IT Service Desk', subject: 'Scheduled maintenance this weekend', time: '9:12 AM' },
  { from: 'HR Team', subject: 'Open enrolment closes Friday', time: '8:47 AM' },
  { from: 'Facilities', subject: 'Floor 2 printer toner replaced', time: 'Yesterday' },
  { from: 'Security Awareness', subject: 'Report suspicious email with the Report button', time: 'Yesterday' },
];

export function renderOutlookWindow(body: HTMLElement, services: VmServices, computer?: string): void {
  body.innerHTML = '';
  Object.assign(body.style, { overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#fff' });
  const root = el('div', "flex:1;min-height:0;display:flex;flex-direction:column;color:#1b1b1b;color-scheme:light;font-family:'Segoe UI',sans-serif;font-size:12px;");
  body.appendChild(root);

  const eps = services.endpoints;
  let tab: 'home' | 'send' | 'file' = 'home';
  let promptCount = 0;
  let notice = '';
  const ui: EndpointUi | null = computer ? { services, computer } : null;

  const paint = (): void => {
    root.innerHTML = '';
    const e = computer ? eps.get(computer) : undefined;
    const user = e ? e.username : (login.user?.username ?? VM_HOST.user);
    const address = `${user}@${VM_HOST.domain}`;

    // Outlook will not even open with a corrupt profile.
    if (e && e.outlook.profile === 'corrupt') {
      root.appendChild(profileError(e));
      return;
    }
    if (e && e.credentials.some((c) => c.target === OFFICE_CREDENTIAL && c.stale)) {
      root.appendChild(passwordPrompt(address));
      return;
    }

    const offline = e?.outlook.workOffline ?? false;
    const connected = e ? eps.onCorpNetwork(e) || e.vpn.connected : true;
    const full = e ? e.outlook.mailboxUsedMb / e.outlook.quotaMb >= 0.9 : false;

    // Title and ribbon.
    const top = el('div', 'background:#0f6cbd;color:#fff;padding:6px 12px;display:flex;align-items:center;gap:14px;');
    top.appendChild(el('div', 'font-weight:600;', `Inbox - ${address} - Outlook`));
    root.appendChild(top);
    const tabs = el('div', 'display:flex;gap:2px;background:#f3f3f3;border-bottom:1px solid #e1e1e1;padding:0 8px;');
    for (const [id, label] of [['file', 'File'], ['home', 'Home'], ['send', 'Send / Receive']] as const) {
      const t = document.createElement('button');
      t.textContent = label;
      t.style.cssText = `border:none;background:${tab === id ? '#fff' : 'transparent'};padding:6px 12px;font-size:12px;cursor:pointer;border-bottom:2px solid ${tab === id ? '#0f6cbd' : 'transparent'};color:#1b1b1b;font-family:inherit;`;
      t.addEventListener('click', () => {
        tab = id;
        notice = '';
        paint();
      });
      tabs.appendChild(t);
    }
    root.appendChild(tabs);

    const ribbon = el('div', 'display:flex;gap:8px;align-items:center;padding:8px 12px;border-bottom:1px solid #e1e1e1;background:#fafafa;min-height:34px;flex-wrap:wrap;');
    const rb = (label: string, fn: () => void, pressed = false): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = `border:1px solid ${pressed ? '#0f6cbd' : '#d1d1d1'};background:${pressed ? '#cfe4fa' : '#fff'};border-radius:4px;padding:5px 10px;font-size:12px;cursor:pointer;color:#1b1b1b;font-family:inherit;`;
      b.addEventListener('click', fn);
      return b;
    };
    if (tab === 'home') {
      ribbon.appendChild(
        rb('✉️ New Email', () => {
          notice = full
            ? 'Your mailbox is full. You cannot send messages until you free up space.'
            : offline || !connected
              ? 'The message was placed in the Outbox and will be sent when Outlook is connected.'
              : 'Message sent.';
          paint();
        }),
      );
    } else if (tab === 'send') {
      ribbon.appendChild(
        rb('📴 Work Offline', () => {
          if (!ui || !e) return;
          act(ui, () => eps.setWorkOffline(e.name, !offline, actor()));
        }, offline),
      );
      ribbon.appendChild(rb('🔄 Send/Receive All Folders', () => { notice = offline ? 'Outlook is working offline.' : connected ? 'Send/Receive complete.' : 'Cannot connect to the server.'; paint(); }));
    } else {
      ribbon.appendChild(rb('⚙️ Account Settings: Manage Profiles…', () => { if (e) { root.innerHTML = ''; root.appendChild(profileDialog(e, false)); } }));
      ribbon.appendChild(
        rb('🧹 Mailbox Cleanup: Empty Deleted Items', () => {
          if (!ui || !e) return;
          act(ui, () => eps.emptyDeletedItems(e.name, actor()), (r) => { notice = r.ok ? r.message : r.error; });
          paint();
        }),
      );
    }
    root.appendChild(ribbon);

    if (full) {
      root.appendChild(el('div', 'background:#fde7e9;color:#a4262c;padding:6px 12px;border-bottom:1px solid #f1bbbc;', '⚠ Your mailbox is full. You can\'t send messages. Empty Deleted Items or archive older mail.'));
    }
    if (notice) root.appendChild(el('div', 'background:#fff4ce;color:#5c4400;padding:6px 12px;border-bottom:1px solid #f0dca0;', notice));

    // Three panes.
    const panes = el('div', 'flex:1;min-height:0;display:grid;grid-template-columns:170px 1fr 1.2fr;');
    const folders = el('div', 'border-right:1px solid #e1e1e1;padding:8px 0;overflow:auto;background:#fafafa;');
    const deleted = e ? `${(e.outlook.deletedItemsMb / 1024).toFixed(1)} GB` : '120 MB';
    for (const [name, extra] of [['Inbox', '4'], ['Drafts', ''], ['Sent Items', ''], ['Deleted Items', deleted], ['Archive', ''], ['Outbox', offline || !connected ? '1' : '']]) {
      const f = el('div', `display:flex;justify-content:space-between;padding:5px 14px;${name === 'Inbox' ? 'background:#cfe4fa;font-weight:600;' : ''}`);
      f.append(el('span', '', name), el('span', 'color:#0f6cbd;font-size:11px;', extra));
      folders.appendChild(f);
    }
    const listPane = el('div', 'border-right:1px solid #e1e1e1;overflow:auto;');
    for (const m of MAIL) {
      const item = el('div', 'padding:8px 12px;border-bottom:1px solid #f0f0f0;');
      item.append(el('div', 'font-weight:600;', m.from), el('div', 'color:#0f6cbd;', m.subject), el('div', 'color:#707070;font-size:11px;', m.time));
      listPane.appendChild(item);
    }
    const reading = el('div', 'padding:16px;overflow:auto;color:#424242;line-height:1.6;');
    reading.append(el('div', 'font-size:15px;font-weight:600;color:#1b1b1b;margin-bottom:6px;', MAIL[0]!.subject), el('div', '', 'Systems will be unavailable between 10 PM Saturday and 2 AM Sunday. No action is needed.'));
    panes.append(folders, listPane, reading);
    root.appendChild(panes);

    // The status bar is where Outlook tells the truth about its connection.
    const state = offline
      ? { text: 'Working Offline', color: '#a4262c' }
      : !connected
        ? { text: 'Disconnected', color: '#a4262c' }
        : full
          ? { text: 'Mailbox Full', color: '#a4262c' }
          : { text: 'Connected to: Microsoft Exchange', color: '#107c10' };
    const status = el('div', 'display:flex;justify-content:space-between;padding:4px 12px;background:#f3f3f3;border-top:1px solid #e1e1e1;font-size:11px;');
    status.append(el('span', '', 'Items: 4    Unread: 4'), el('span', `color:${state.color};font-weight:600;`, state.text));
    root.appendChild(status);
  };

  function profileError(e: Endpoint): HTMLElement {
    const wrap = el('div', 'flex:1;display:flex;align-items:center;justify-content:center;background:#f3f3f3;');
    const dialog = el('div', 'width:420px;background:#fff;border:1px solid #d1d1d1;box-shadow:0 8px 24px rgba(0,0,0,0.18);');
    dialog.appendChild(el('div', 'padding:8px 12px;background:#fafafa;border-bottom:1px solid #e1e1e1;', 'Microsoft Outlook'));
    const content = el('div', 'display:flex;gap:12px;padding:16px;line-height:1.5;');
    content.append(el('div', 'font-size:26px;', '⛔'), el('div', '', 'Cannot start Microsoft Outlook. Cannot open the Outlook window. The set of folders cannot be opened. The information store could not be opened.'));
    dialog.appendChild(content);
    const actions = el('div', 'display:flex;justify-content:flex-end;gap:8px;padding:0 16px 14px;');
    const manage = document.createElement('button');
    manage.textContent = 'Mail Setup — Show Profiles…';
    manage.style.cssText = 'padding:5px 12px;border:1px solid #d1d1d1;background:#fff;color:#1b1b1b;cursor:pointer;font-family:inherit;';
    manage.addEventListener('click', () => {
      wrap.replaceWith(profileDialog(e, true));
    });
    const okBtn = document.createElement('button');
    okBtn.textContent = 'OK';
    okBtn.style.cssText = 'padding:5px 18px;border:1px solid #0f6cbd;background:#0f6cbd;color:#fff;cursor:pointer;font-family:inherit;';
    okBtn.addEventListener('click', () => {
      wrap.replaceChildren(el('div', 'color:#707070;', 'Outlook closed. Open it again from the desktop or Start.'));
    });
    actions.append(manage, okBtn);
    dialog.appendChild(actions);
    wrap.appendChild(dialog);
    return wrap;
  }

  /** Control Panel > Mail > Show Profiles, the real place a profile is rebuilt. */
  function profileDialog(e: Endpoint, broken: boolean): HTMLElement {
    const wrap = el('div', 'flex:1;display:flex;align-items:center;justify-content:center;background:#f3f3f3;');
    const dialog = el('div', 'width:420px;background:#fff;border:1px solid #d1d1d1;box-shadow:0 8px 24px rgba(0,0,0,0.18);');
    dialog.appendChild(el('div', 'padding:8px 12px;background:#fafafa;border-bottom:1px solid #e1e1e1;', 'Mail'));
    const content = el('div', 'padding:14px 16px;display:flex;flex-direction:column;gap:8px;');
    content.appendChild(el('div', '', 'The following profiles are set up on this computer:'));
    const listBox = el('div', 'border:1px solid #d1d1d1;min-height:48px;padding:6px 8px;');
    listBox.appendChild(el('div', `${broken ? 'color:#a4262c;' : ''}`, `Outlook${broken ? '   (cannot be opened)' : ''}`));
    content.appendChild(listBox);
    const msg = el('div', 'min-height:16px;font-size:11.5px;');
    content.appendChild(msg);
    const actions = el('div', 'display:flex;gap:8px;flex-wrap:wrap;');
    const add = document.createElement('button');
    add.textContent = 'Add… (new profile, set as default)';
    add.style.cssText = 'padding:5px 12px;border:1px solid #0f6cbd;background:#0f6cbd;color:#fff;cursor:pointer;font-family:inherit;';
    add.addEventListener('click', () => {
      if (!ui) return;
      act(ui, () => eps.repairOutlookProfile(e.name, actor()), (r) => {
        msg.textContent = r.ok ? r.message : r.error;
        msg.style.color = r.ok ? '#107c10' : '#a4262c';
      });
    });
    const close = document.createElement('button');
    close.textContent = 'Close';
    close.style.cssText = 'padding:5px 18px;border:1px solid #d1d1d1;background:#fff;color:#1b1b1b;cursor:pointer;font-family:inherit;';
    close.addEventListener('click', () => paint());
    actions.append(add, close);
    content.appendChild(actions);
    dialog.appendChild(content);
    wrap.appendChild(dialog);
    return wrap;
  }

  function passwordPrompt(address: string): HTMLElement {
    const wrap = el('div', 'flex:1;display:flex;align-items:center;justify-content:center;background:#f3f3f3;');
    const dialog = el('div', 'width:380px;background:#fff;border:1px solid #d1d1d1;box-shadow:0 8px 24px rgba(0,0,0,0.18);padding:18px;display:flex;flex-direction:column;gap:10px;');
    dialog.append(
      el('div', 'font-size:14px;font-weight:600;', 'Windows Security'),
      el('div', '', 'Microsoft Outlook'),
      el('div', 'color:#424242;', `Connecting to ${address}`),
    );
    const input = document.createElement('input');
    input.type = 'password';
    input.placeholder = 'Password';
    input.style.cssText = 'padding:6px 8px;border:1px solid #8a8a8a;background:#fff;color:#1b1b1b;font-family:inherit;';
    const remember = document.createElement('label');
    remember.style.cssText = 'display:flex;gap:6px;align-items:center;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    remember.append(cb, document.createTextNode('Remember my credentials'));
    const note = el('div', 'color:#a4262c;font-size:11.5px;min-height:16px;', promptCount > 0 ? `The prompt came back (${promptCount}×). Outlook is still using a saved credential.` : '');
    const actions = el('div', 'display:flex;justify-content:flex-end;gap:8px;');
    const okBtn = document.createElement('button');
    okBtn.textContent = 'OK';
    okBtn.style.cssText = 'padding:5px 18px;border:1px solid #0f6cbd;background:#0f6cbd;color:#fff;cursor:pointer;font-family:inherit;';
    okBtn.addEventListener('click', () => {
      // Whatever is typed, the stale saved credential is offered first and
      // fails, so the prompt returns. That is the symptom the user reported.
      promptCount += 1;
      paint();
    });
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.style.cssText = 'padding:5px 14px;border:1px solid #d1d1d1;background:#fff;color:#1b1b1b;cursor:pointer;font-family:inherit;';
    cancel.addEventListener('click', () => {
      wrap.replaceChildren(el('div', 'color:#707070;text-align:center;line-height:1.6;', 'Outlook: Need Password. Disconnected.'));
    });
    actions.append(cancel, okBtn);
    dialog.append(input, remember, note, actions);
    wrap.appendChild(dialog);
    return wrap;
  }

  paint();
  if (computer) onEndpointChanged(root, computer, paint);
}

// ---------------------------------------------------------------------------
// Corp VPN
// ---------------------------------------------------------------------------

export function renderVpnClientWindow(body: HTMLElement, services: VmServices, computer?: string): void {
  body.innerHTML = '';
  Object.assign(body.style, { overflow: 'auto', background: 'var(--panel)' });
  const root = el('div', 'padding:18px;display:flex;flex-direction:column;gap:12px;color:var(--fg);font-size:12px;');
  body.appendChild(root);
  const eps = services.endpoints;
  let message = '';
  let ok = true;

  const paint = (): void => {
    root.innerHTML = '';
    root.appendChild(el('div', 'font-size:16px;font-weight:600;', '🛡️ Corp VPN'));
    const e = computer ? eps.get(computer) : undefined;
    if (!e) {
      const c = card('Status', 'This workstation is on the corporate network and does not need the VPN.');
      c.body.appendChild(row('Connection', 'Not required', 'var(--accent)'));
      root.appendChild(c.box);
      return;
    }
    const expired = e.vpn.certExpiresAt <= Date.now();
    const status = card('Status');
    status.body.append(
      row('Connection', e.vpn.connected ? 'Connected' : 'Disconnected', e.vpn.connected ? 'var(--accent)' : 'var(--muted)'),
      row('Gateway', 'vpn.omari.test'),
    );
    if (e.vpn.lastAttemptFailed && !e.vpn.connected) {
      status.body.appendChild(el('div', 'color:var(--err);font-size:11.5px;', 'Last attempt failed: IKE authentication credentials are unacceptable (error 13801).'));
    }
    const bar = el('div', 'display:flex;gap:6px;');
    bar.appendChild(
      button(e.vpn.connected ? 'Disconnect' : 'Connect', () => {
        if (e.vpn.connected) {
          e.vpn.connected = false;
          notifyEndpointChanged(e.name);
          return;
        }
        act({ services, computer: e.name }, () => eps.connectVpn(e.name, actor()), (r) => {
          message = r.ok ? r.message : r.error;
          ok = r.ok;
        });
      }, true),
    );
    status.body.appendChild(bar);
    root.appendChild(status.box);

    const cert = card('Certificate', 'Machine certificate used to authenticate to the VPN gateway.');
    cert.body.append(
      row('Issued to', `${e.username}@${VM_HOST.domain}`),
      row('Expires', new Date(e.vpn.certExpiresAt).toLocaleDateString(), expired ? 'var(--err)' : 'var(--fg)'),
      row('State', expired ? 'Expired' : 'Valid', expired ? 'var(--err)' : 'var(--accent)'),
      button('Renew certificate', () =>
        act({ services, computer: e.name }, () => eps.renewVpnCertificate(e.name, actor()), (r) => {
          message = r.ok ? r.message : r.error;
          ok = r.ok;
        }),
      ),
    );
    root.appendChild(cert.box);
    if (message) root.appendChild(el('div', `font-size:11.5px;color:${ok ? 'var(--accent)' : 'var(--err)'};`, message));
  };

  paint();
  if (computer) onEndpointChanged(root, computer, paint);
}

// ---------------------------------------------------------------------------
// Software Center
// ---------------------------------------------------------------------------

export function renderSoftwareCenterWindow(body: HTMLElement, services: VmServices, computer?: string): void {
  body.innerHTML = '';
  Object.assign(body.style, { overflow: 'auto', background: 'var(--panel)' });
  const root = el('div', 'padding:18px;display:flex;flex-direction:column;gap:12px;color:var(--fg);font-size:12px;');
  body.appendChild(root);
  const eps = services.endpoints;
  let message = '';
  let ok = true;

  const paint = (): void => {
    root.innerHTML = '';
    root.appendChild(el('div', 'font-size:16px;font-weight:600;', '📦 Software Center'));
    root.appendChild(el('div', 'color:var(--muted);', 'Applications approved for this computer. Installing needs no admin rights.'));
    const e = computer ? eps.get(computer) : undefined;
    const grid = el('div', 'display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;');
    for (const app of SOFTWARE_CATALOG) {
      const installed = e ? e.installed.includes(app) : true;
      const tile = el('div', 'border:1px solid var(--border);border-radius:8px;padding:12px;background:var(--panel-alt);display:flex;flex-direction:column;gap:8px;');
      tile.append(el('div', 'font-weight:600;', app), el('div', 'color:var(--muted);font-size:11px;', installed ? 'Installed' : 'Available'));
      if (e && !installed) {
        tile.appendChild(
          button('Install', () =>
            act({ services, computer: e.name }, () => eps.installSoftware(e.name, app, actor()), (r) => {
              message = r.ok ? r.message : r.error;
              ok = r.ok;
            }), true),
        );
      }
      grid.appendChild(tile);
    }
    root.appendChild(grid);
    if (message) root.appendChild(el('div', `font-size:11.5px;color:${ok ? 'var(--accent)' : 'var(--err)'};`, message));
  };

  paint();
  if (computer) onEndpointChanged(root, computer, paint);
}

// ---------------------------------------------------------------------------
// This PC: drives
// ---------------------------------------------------------------------------

/** The mapped drives section of This PC, with Map network drive. */
export function renderDrivesPanel(container: HTMLElement, ui: EndpointUi): void {
  const eps = ui.services.endpoints;
  const status = el('div', 'font-size:11.5px;min-height:16px;');
  const list = el('div', 'display:flex;flex-direction:column;gap:8px;color-scheme:light;');
  container.append(list, status);
  const say = (r: EndpointResult): void => {
    status.textContent = r.ok ? r.message : r.error;
    status.style.color = r.ok ? '#107c10' : '#a4262c';
  };

  live(list, ui, (e) => {
    list.appendChild(el('div', 'font-weight:600;', 'Network locations'));
    if (e.drives.length === 0) list.appendChild(el('div', 'color:#5f5f5f;', 'No network drives are mapped.'));
    for (const d of e.drives) {
      const r = el('div', 'display:flex;align-items:center;gap:10px;');
      const text = el('div', 'flex:1;');
      text.append(el('div', '', `${e.homeShare} (${sharePath(e.homeShare).slice(2).split('\\')[0]}) (${d.letter})`), el('div', 'color:#5f5f5f;font-size:11px;', d.path));
      const open = document.createElement('button');
      open.textContent = 'Open';
      open.style.cssText = 'padding:3px 10px;border:1px solid #d0d0d0;background:#fff;border-radius:4px;cursor:pointer;font-family:inherit;';
      open.addEventListener('click', () => {
        const share = ui.services.dir.getShare(d.path.split('\\').pop() ?? '');
        const access = share ? ui.services.dir.getEffectiveAccess(share.name, e.username) : 'None';
        say(
          access === 'None' || access === 'Deny'
            ? { ok: false, error: `${d.letter}\\ is not accessible. Access is denied.` }
            : { ok: true, message: `${d.letter}\\ opened (${access} access).` },
        );
      });
      r.append(el('span', 'font-size:24px;', '🗄️'), text, open);
      list.appendChild(r);
    }

    const map = el('div', 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px;');
    const letter = document.createElement('input');
    letter.value = SHARE_DRIVE;
    letter.style.cssText = 'width:44px;padding:4px 6px;border:1px solid #d0d0d0;border-radius:4px;font-family:inherit;';
    const path = document.createElement('input');
    path.placeholder = '\\\\FS01\\Share';
    path.style.cssText = 'flex:1;min-width:160px;padding:4px 6px;border:1px solid #d0d0d0;border-radius:4px;font-family:inherit;';
    const go = document.createElement('button');
    go.textContent = 'Map network drive';
    go.style.cssText = 'padding:4px 12px;border:1px solid #005fb8;background:#005fb8;color:#fff;border-radius:4px;cursor:pointer;font-family:inherit;';
    go.addEventListener('click', () => act(ui, () => eps.mapDrive(e.name, letter.value, path.value, actor()), say));
    map.append(letter, path, go);
    list.appendChild(map);
  });
}
