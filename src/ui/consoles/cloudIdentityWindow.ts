/**
 * ui/consoles/cloudIdentityWindow.ts — the tenants in front of the domain.
 *
 * One pane per vendor, showing the four things that go wrong in a hybrid
 * estate where they can actually be seen: how long ago the last cycle ran and
 * which accounts it has not caught up on, which objects are synced copies and
 * which were made in the cloud, which applications the tenant can deprovision,
 * and where one person has ended up with two identities.
 *
 * Every button runs a registry capability, so the console and the terminal do
 * the same thing — including the refusals. Disabling a synced account fails
 * here for the same reason and with the same message as `Disable-CloudUser`.
 */
import type { VmServices } from '@/vm/session';
import type { UserId } from '@/domain';
import { CAPABILITY_BY_ID, VENDORS, type CapabilityContext, type CloudVendor } from '@/services';
import { showToast } from '@/ui/toast';

const VENDOR_IDS: CloudVendor[] = ['okta', 'entra'];

export function renderCloudIdentityWindow(body: HTMLElement, conductor: VmServices): void {
  body.innerHTML = '';
  body.style.cssText =
    'display:flex;flex-direction:column;height:100%;background:var(--panel);color:var(--fg);' +
    'font-family:"Segoe UI",system-ui,sans-serif;font-size:12.5px;';

  let vendor: CloudVendor = 'okta';

  const ctx = (): CapabilityContext => ({
    dir: conductor.dir,
    idp: conductor.idp,
    tickets: conductor.tickets,
    audit: conductor.audit,
    pim: conductor.pim,
    cloud: conductor.cloud,
    actor: 'system' as UserId,
  });

  /** Run a capability and report it the way the console does elsewhere. */
  const run = (capId: string, args: Record<string, string>): void => {
    const cap = CAPABILITY_BY_ID[capId];
    if (!cap) return;
    const res = cap.run(ctx(), args);
    showToast(res.ok ? res.message : res.error, { kind: res.ok ? 'success' : 'error' });
    render();
  };

  // --- Vendor tabs ----------------------------------------------------------
  const tabs = document.createElement('div');
  tabs.style.cssText =
    'flex-shrink:0;display:flex;gap:2px;padding:8px 10px 0;background:var(--panel-alt);' +
    'border-bottom:1px solid var(--border);';
  body.appendChild(tabs);

  const pane = document.createElement('div');
  pane.style.cssText = 'flex:1;overflow-y:auto;padding:14px 16px;';
  body.appendChild(pane);

  // --- Small builders -------------------------------------------------------
  function section(title: string, note?: string): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:18px;';
    const h = document.createElement('div');
    h.textContent = title;
    h.style.cssText =
      'font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);' +
      'margin-bottom:6px;';
    wrap.appendChild(h);
    if (note) {
      const n = document.createElement('div');
      n.textContent = note;
      n.style.cssText = 'color:var(--muted);margin-bottom:8px;line-height:1.5;';
      wrap.appendChild(n);
    }
    pane.appendChild(wrap);
    return wrap;
  }

  function button(label: string, onClick: () => void, tone: 'primary' | 'plain' = 'plain'): HTMLElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      'padding:6px 12px;border-radius:4px;cursor:pointer;font-size:11.5px;margin-right:6px;' +
      (tone === 'primary'
        ? 'background:#2563eb;color:#fff;border:1px solid #2563eb;'
        : 'background:var(--panel-alt);color:var(--fg);border:1px solid var(--border);');
    b.addEventListener('click', onClick);
    return b;
  }

  function table(headers: string[], rows: (string | number)[][], empty: string): HTMLElement {
    if (rows.length === 0) {
      const e = document.createElement('div');
      e.textContent = empty;
      e.style.cssText = 'color:var(--muted);font-style:italic;';
      return e;
    }
    const t = document.createElement('table');
    t.style.cssText = 'width:100%;border-collapse:collapse;font-size:11.5px;';
    const thead = document.createElement('tr');
    for (const h of headers) {
      const th = document.createElement('th');
      th.textContent = h;
      th.style.cssText =
        'text-align:left;padding:5px 8px;border-bottom:1px solid var(--border);color:var(--muted);' +
        'font-weight:500;';
      thead.appendChild(th);
    }
    t.appendChild(thead);
    for (const row of rows) {
      const tr = document.createElement('tr');
      for (const cell of row) {
        const td = document.createElement('td');
        td.textContent = String(cell);
        td.style.cssText = 'padding:5px 8px;border-bottom:1px solid #1b2027;';
        tr.appendChild(td);
      }
      t.appendChild(tr);
    }
    return t;
  }

  function warning(text: string): HTMLElement {
    const w = document.createElement('div');
    w.textContent = text;
    w.style.cssText =
      'background:#3a2018;border:1px solid #7a3b23;color:#ffcbb0;border-radius:4px;' +
      'padding:8px 10px;margin-bottom:10px;line-height:1.5;';
    return w;
  }

  // --- Render ---------------------------------------------------------------
  function render(): void {
    tabs.innerHTML = '';
    for (const id of VENDOR_IDS) {
      const tab = document.createElement('button');
      const on = id === vendor;
      tab.textContent = VENDORS[id].label;
      tab.style.cssText =
        'padding:7px 14px;border:none;cursor:pointer;font-size:12px;border-radius:4px 4px 0 0;' +
        (on ? 'background:var(--panel);color:#fff;' : 'background:transparent;color:var(--muted);');
      tab.addEventListener('click', () => {
        vendor = id;
        render();
      });
      tabs.appendChild(tab);
    }

    pane.innerHTML = '';
    const tenant = conductor.cloud[vendor];
    const profile = VENDORS[vendor];

    // Connection
    const conn = section('Tenant', profile.tenantName);
    if (!tenant.isConnected()) {
      conn.appendChild(
        warning(
          `Not connected. Every other action refuses until a session is open — ` +
            `the same gate the real module has. Run ${profile.connectCmdlet} or use the button.`,
        ),
      );
      conn.appendChild(
        button(
          `Connect to ${profile.label}`,
          () => run(vendor === 'okta' ? 'cloud.connect.okta' : 'cloud.connect.entra', {}),
          'primary',
        ),
      );
      return; // Nothing below this is meaningful without a session.
    }

    const connected = document.createElement('div');
    connected.textContent = `● Connected to ${profile.tenantName}`;
    connected.style.cssText = 'color:var(--accent);';
    conn.appendChild(connected);

    // Sync
    const mins = tenant.minutesSinceSync();
    const pending = tenant.pendingDelta();
    const sync = section(
      'Directory synchronisation',
      mins === null
        ? 'No cycle has ever run. The tenant knows nothing about the domain yet.'
        : `Last cycle ${mins} minute(s) ago. Scheduled every ${tenant.getCycleMinutes()} minutes.`,
    );
    if (pending.length > 0) {
      sync.appendChild(
        warning(
          `${pending.length} account(s) are out of date. Until a cycle runs, the cloud still ` +
            'enforces the old state — which is what "I disabled them and they can still get ' +
            'in" actually is.',
        ),
      );
    }
    sync.appendChild(
      table(
        ['UPN', 'Pending change', 'Detail'],
        pending.map((d) => [d.upn, d.change, d.detail]),
        'The tenant matches the directory.',
      ),
    );
    const syncActions = document.createElement('div');
    syncActions.style.cssText = 'margin-top:8px;';
    syncActions.appendChild(
      button('Run sync cycle now', () => run('cloud.sync', { Provider: vendor }), 'primary'),
    );
    sync.appendChild(syncActions);

    // Duplicates
    const dupes = tenant.duplicates();
    if (dupes.length > 0) {
      const d = section('Duplicate identities');
      d.appendChild(
        warning(
          `${dupes.length} objects share a UPN. A soft match failed, so one person has more ` +
            'than one identity — and which one they land in is not predictable.',
        ),
      );
      d.appendChild(
        table(
          ['UPN', 'Name', 'Origin', 'Status'],
          dupes.map((u) => [u.upn, u.displayName, u.origin, u.status]),
          '',
        ),
      );
    }

    // Accounts
    const accounts = tenant.list();
    const acc = section(
      'Accounts',
      'Synced objects are copies: the directory is authoritative and changes belong there. ' +
        'Cloud-only objects have no owner on premises.',
    );
    acc.appendChild(
      table(
        ['UPN', 'Name', 'Origin', 'Status', 'Sessions'],
        accounts.map((u) => [u.upn, u.displayName, u.origin, u.status, u.sessions]),
        'No accounts in this tenant yet. Run a sync cycle.',
      ),
    );

    // Sessions still open on disabled accounts — the gap after offboarding.
    const liveOnDisabled = accounts.filter((u) => u.status === 'disabled' && u.sessions > 0);
    if (liveOnDisabled.length > 0) {
      const s = section('Live sessions on disabled accounts');
      s.appendChild(
        warning(
          'Disabling an account does not end sessions already open. Until these are revoked, ' +
            'the window is exactly as long as the session lifetime.',
        ),
      );
      for (const u of liveOnDisabled) {
        s.appendChild(
          button(`Revoke ${u.sessions} session(s) for ${u.upn}`, () =>
            run('cloud.revoke', { Provider: vendor, Upn: u.upn }),
          ),
        );
      }
    }

    // Applications and SCIM
    const orphans = tenant.orphanedAppAccounts();
    const apps = section(
      'Applications',
      'SCIM lets the tenant create and deactivate accounts inside an application. Without it, ' +
        'deprovisioning stops at the identity provider.',
    );
    if (orphans.length > 0) {
      apps.appendChild(
        warning(
          `${orphans.length} account(s) are still active inside applications for people who ` +
            'are disabled upstream. This is the leaver gap an auditor asks about.',
        ),
      );
    }
    for (const app of tenant.listApps()) {
      const row = document.createElement('div');
      row.style.cssText =
        'display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #1b2027;';
      const name = document.createElement('span');
      name.textContent = app.name;
      name.style.cssText = 'flex:1;';
      const state = document.createElement('span');
      state.textContent = app.scim ? 'SCIM on' : 'SCIM off';
      state.style.cssText = `font-size:11px;color:${app.scim ? 'var(--accent)' : '#e2a03f'};`;
      const count = document.createElement('span');
      count.textContent = `${app.accounts.size} account(s)`;
      count.style.cssText = 'font-size:11px;color:var(--muted);';
      row.append(name, count, state);
      row.appendChild(
        button(app.scim ? 'Disable SCIM' : 'Enable SCIM', () =>
          run('cloud.scim', { Provider: vendor, App: app.name, Enabled: app.scim ? 'false' : 'true' }),
        ),
      );
      apps.appendChild(row);
    }

    if (orphans.length > 0) {
      apps.appendChild(
        table(
          ['Application', 'UPN'],
          orphans.map((o) => [o.app, o.upn]),
          '',
        ),
      );
    }
  }

  render();
}
