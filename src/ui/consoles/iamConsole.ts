/**
 * ui/consoles/iamConsole.ts — IAM Console renderer.
 * Shows: users, groups, applications, and a Create Group / Create User form.
 * Operates against the running VmServices's MockDirectory + MockIdP.
 */
import type { VmServices } from '@/vm/session';
import type { UserId, MfaMethod } from '@/domain';
import { capabilitiesForSection, type CapabilityContext } from '@/services';
import { renderCapabilityForm } from './iam/capabilitySection';
import { describeAuditId } from '@/util/auditLabels';

export function renderIAMConsole(body: HTMLElement, conductor: VmServices) {
  body.innerHTML = '';
  // No "no active lab" path here: the session seeds every service at boot, so
  // the console is always live. The 3D lab needs that guard because its
  // services only exist once a lab starts.
  renderIAMConsoleInner(body, conductor);
}


function renderIAMConsoleInner(body: HTMLElement, conductor: VmServices) {
  // Guard again (conductor may have been reset since last call)
  if (!conductor.dir || !conductor.idp || !conductor.apps || !conductor.audit) {
    renderIAMConsole(body, conductor);
    return;
  }
  const dir = conductor.dir;
  const idp = conductor.idp;
  const apps = conductor.apps;
  const audit = conductor.audit;

  // Explicitly (re)apply the scrollable layout the console needs — the host
  // window (desktopOverlay.ts / consolePanel.ts) sets `flex:1;overflow:auto`
  // on this element, but the "no lab" placeholder path above overwrites that
  // via cssText, and previously this line blanked it back to '' instead of
  // restoring it, which silently killed scrolling once a lab was active.
  body.style.cssText = 'flex:1;overflow-y:auto;min-height:0;padding:12px 14px;background:#0e1116;';

  // Mark body so we can find it later for re-renders
  body.id = 'iam-console-body';

  // Track local MFA policy state (IdP stores policies internally; we expose a toggle)
  let mfaEnabled = false;


  const refresh = () => {
    const users = dir.listUsers();
    const groups = dir.listGroups();
    const appsList = apps.apps();
    body.innerHTML = '';

    /* Summary */
    const head = document.createElement('div');
    head.style.cssText =
      'display:flex;justify-content:space-between;color:var(--muted);font-size:12px;margin-bottom:12px;';
    head.innerHTML = `
      <span>${users.length} users · ${groups.length} groups · ${appsList.length} apps</span>
      <span>audit: ${audit.events.length} events</span>
    `;
    body.appendChild(head);

    /* Users */
    body.appendChild(h2('Users'));
    const userList = document.createElement('div');
    userList.style.cssText =
      'max-height:160px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;margin-bottom:8px;';
    for (const u of users) {
      const row = document.createElement('div');
      row.style.cssText =
        'padding:6px 10px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;font-size:12px;';
      const statusColor =
        u.status === 'active'
          ? 'var(--accent)'
          : u.status === 'disabled'
            ? 'var(--err)'
            : 'var(--warn)';
      const mfaColor = u.mfa !== 'none' ? 'var(--accent)' : 'var(--muted)';
      row.innerHTML = `
        <span><span style="color:${statusColor}">●</span> <strong>${u.username}</strong> <span style="color:var(--muted)">${u.displayName}</span></span>
        <span style="color:var(--muted)">${u.groupIds.length} groups</span>
        <span style="color:${mfaColor}">MFA:${u.mfa}</span>
      `;
      userList.appendChild(row);
    }
    body.appendChild(userList);

    /* Add User form */
    body.appendChild(h2('Provision User'));
    body.appendChild(
      formRow([
        inp('username', 'username'),
        inp('display', 'display name'),
        inp('email', 'email'),
        inp('dept', 'department'),
        inp('title', 'job title'),
        btn('Create User', () => {
          const username = val('username').trim();
          const display = val('display').trim() || username;
          const email = val('email').trim() || `${username}@northwind.example`;
          const dept = val('dept').trim() || 'General';
          const title = val('title').trim() || 'Employee';
          if (!username) return;
          try {
            dir.createUser({
              username,
              displayName: display,
              email,
              department: dept,
              title,
            });
            // seedPasswords() accumulates into the credential map;
            // setPasswordResolver() REPLACES the single resolver, which meant
            // provisioning a second user silently locked the first one out.
            idp.seedPasswords({ [username]: `${username}123` });
          } catch (e) {
            // Most often a duplicate username — surface it rather than letting
            // the learner think the click did nothing.
            showError(body, e instanceof Error ? e.message : String(e));
          }
          refresh();
        }),
      ]),
    );

    /* Edit User form */
    body.appendChild(h2('Edit User'));
    const editUserSelect = sel(
      'euser',
      users.map((u) => ({ v: u.username, t: u.username })),
    );
    body.appendChild(
      formRow([
        editUserSelect,
        btn('Load', () => {
          const username = body.querySelector<HTMLSelectElement>('[data-k="euser"]')!.value;
          const u = dir.getUserByUsername(username);
          if (!u) return;
          body.querySelector<HTMLInputElement>('[data-k="edisplay"]')!.value = u.displayName;
          body.querySelector<HTMLInputElement>('[data-k="eemail"]')!.value = u.email;
          body.querySelector<HTMLInputElement>('[data-k="edept"]')!.value = u.department;
          body.querySelector<HTMLInputElement>('[data-k="etitle"]')!.value = u.title;
        }),
      ]),
    );
    body.appendChild(
      formRow([
        inp('edisplay', 'display name'),
        inp('eemail', 'email'),
        inp('edept', 'department'),
        inp('etitle', 'title'),
        btn('Save Changes', () => {
          const username = body.querySelector<HTMLSelectElement>('[data-k="euser"]')!.value;
          const u = dir.getUserByUsername(username);
          if (!u) return;
          try {
            dir.updateUser(u.id, {
              displayName:
                body.querySelector<HTMLInputElement>('[data-k="edisplay"]')!.value || u.displayName,
              email: body.querySelector<HTMLInputElement>('[data-k="eemail"]')!.value || u.email,
              department:
                body.querySelector<HTMLInputElement>('[data-k="edept"]')!.value || u.department,
              title: body.querySelector<HTMLInputElement>('[data-k="etitle"]')!.value || u.title,
            });
          } catch (e) {
            showError(body, String(e));
          }
          refresh();
        }),
      ]),
    );

    /* Disable / Enable User */
    body.appendChild(h2('Disable / Enable User'));
    body.appendChild(
      formRow([
        sel(
          'tuser',
          users.map((u) => ({ v: u.username, t: `${u.username} (${u.status})` })),
        ),
        btn('Disable', () => {
          const username = body.querySelector<HTMLSelectElement>('[data-k="tuser"]')!.value;
          const u = dir.getUserByUsername(username);
          if (!u) return;
          if (u.status === 'disabled') {
            showError(body, 'User is already disabled.');
            return;
          }
          try {
            dir.disableUser(u.id, 'system' as UserId);
          } catch (e) {
            showError(body, String(e));
          }
          refresh();
        }),
        btn('Enable', () => {
          const username = body.querySelector<HTMLSelectElement>('[data-k="tuser"]')!.value;
          const u = dir.getUserByUsername(username);
          if (!u) return;
          if (u.status !== 'disabled') {
            showError(body, 'User is already active.');
            return;
          }
          try {
            dir.enableUser(u.id, 'system' as UserId);
          } catch (e) {
            showError(body, String(e));
          }
          refresh();
        }),
      ]),
    );

    /* Delete User form */
    body.appendChild(h2('Delete User'));
    body.appendChild(
      formRow([
        sel(
          'duser',
          users.map((u) => ({ v: u.username, t: `${u.username} (${u.status})` })),
        ),
        btn('🗑 Delete', () => {
          const username = body.querySelector<HTMLSelectElement>('[data-k="duser"]')!.value;
          const u = dir.getUserByUsername(username);
          if (!u) return;
          if (
            !confirm(
              `Delete user "${username}"? This removes them from all groups and cannot be undone.`,
            )
          )
            return;
          try {
            dir.deleteUser(u.id, 'system' as UserId);
          } catch (e) {
            showError(body, String(e));
          }
          refresh();
        }),
      ]),
    );

    /* Groups */
    body.appendChild(h2('Groups'));
    const groupList = document.createElement('div');
    groupList.style.cssText =
      'max-height:120px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;margin-bottom:8px;';
    for (const g of groups) {
      const row = document.createElement('div');
      row.style.cssText =
        'padding:6px 10px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;font-size:12px;';
      row.innerHTML = `
        <span><strong>${g.name}</strong></span>
        <span style="color:var(--muted)">${g.memberIds.length} members</span>
      `;
      groupList.appendChild(row);
    }
    body.appendChild(groupList);

    /* Create Group form */
    body.appendChild(
      formRow([
        inp('gname', 'group name'),
        inp('gdesc', 'description'),
        btn('Create Group', () => {
          const name = val('gname').trim();
          const desc = val('gdesc').trim();
          if (!name) return;
          try {
            dir.createGroup(name, desc);
          } catch (e) {
            showError(body, String(e));
          }
          refresh();
        }),
      ]),
    );

    /* Edit Group form */
    body.appendChild(h2('Edit Group'));
    body.appendChild(
      formRow([
        sel(
          'egroup',
          groups.map((g) => ({ v: g.name, t: g.name })),
        ),
        btn('Load', () => {
          const gname = body.querySelector<HTMLSelectElement>('[data-k="egroup"]')!.value;
          const g = dir.getGroupByName(gname);
          if (!g) return;
          body.querySelector<HTMLInputElement>('[data-k="egdesc"]')!.value = g.description;
        }),
      ]),
    );
    body.appendChild(
      formRow([
        inp('egdesc', 'description'),
        btn('Save Changes', () => {
          const gname = body.querySelector<HTMLSelectElement>('[data-k="egroup"]')!.value;
          const g = dir.getGroupByName(gname);
          if (!g) return;
          try {
            dir.updateGroup(g.id, {
              description: body.querySelector<HTMLInputElement>('[data-k="egdesc"]')!.value,
            });
          } catch (e) {
            showError(body, String(e));
          }
          refresh();
        }),
      ]),
    );

    /* Delete Group form */
    body.appendChild(h2('Delete Group'));
    body.appendChild(
      formRow([
        sel(
          'dgroup',
          groups.map((g) => ({ v: g.name, t: `${g.name} (${g.memberIds.length} members)` })),
        ),
        btn('🗑 Delete', () => {
          const gname = body.querySelector<HTMLSelectElement>('[data-k="dgroup"]')!.value;
          const g = dir.getGroupByName(gname);
          if (!g) return;
          if (!confirm(`Delete group "${gname}"? All members will be removed from this group.`))
            return;
          try {
            dir.deleteGroup(g.id, 'system' as UserId);
          } catch (e) {
            showError(body, String(e));
          }
          refresh();
        }),
      ]),
    );

    /* Group membership */
    body.appendChild(h2('Group Membership'));
    body.appendChild(
      formRow([
        sel(
          'msel',
          users.map((u) => ({ v: u.username, t: u.username })),
        ),
        sel(
          'gsel',
          groups.map((g) => ({ v: g.name, t: g.name })),
        ),
        btn('Add to group', () => {
          const username = body.querySelector<HTMLSelectElement>('[data-k="msel"]')!.value;
          const groupname = body.querySelector<HTMLSelectElement>('[data-k="gsel"]')!.value;
          try {
            const u = dir.getUserByUsername(username);
            const g = dir.getGroupByName(groupname);
            if (!u || !g) return;
            dir.addToGroup(u.id, g.id, 'system' as UserId);
          } catch (e) {
            showError(body, String(e));
          }
          refresh();
        }),
        btn('Remove from group', () => {
          const username = body.querySelector<HTMLSelectElement>('[data-k="msel"]')!.value;
          const groupname = body.querySelector<HTMLSelectElement>('[data-k="gsel"]')!.value;
          try {
            const u = dir.getUserByUsername(username);
            const g = dir.getGroupByName(groupname);
            if (!u || !g) return;
            dir.removeFromGroup(u.id, g.id, 'system' as UserId);
          } catch (e) {
            showError(body, String(e));
          }
          refresh();
        }),
      ]),
    );

    /* MFA policy toggle */
    // ── Credentials & Access, generated from the capability registry ────────
    // These close the gaps that made tickets unresolvable: password reset, MFA
    // reset/enrol, account unlock, role grant/revoke, session revoke, and
    // move/transfer. Adding a capability to the registry surfaces it here with
    // no change to this file.
    const capCtx: CapabilityContext = {
      dir,
      idp,
      tickets: conductor.tickets,
      audit,
      actor: 'system' as UserId,
    };
    const capDeps = {
      ctx: capCtx,
      dir,
      // The 3D lab captured evidence here. The audit log is the record now,
      // and each capability already writes to it.
      onSuccess: () => {},
      refresh: () => refresh(),
    };

    for (const [section, heading] of [
      ['users', 'Lifecycle — Move / Transfer'],
      ['credentials', 'Credentials & Recovery'],
      ['access', 'Access & Sessions'],
    ] as const) {
      // Skip anything the bespoke forms above already render, so the generated
      // sections contain exactly what the console was previously missing.
      const caps = capabilitiesForSection(section).filter((c) => !c.legacyConsoleForm);
      if (caps.length === 0) continue;
      body.appendChild(h2(heading));
      for (const cap of caps) renderCapabilityForm(body, cap, capDeps);
    }

    body.appendChild(h2('MFA Policy'));
    const polRow = document.createElement('div');
    polRow.style.cssText =
      'padding:8px 0;display:flex;gap:8px;align-items:center;font-size:12px;flex-wrap:wrap;';
    polRow.innerHTML = `<span style="color:var(--muted)">Require MFA on privileged sign-in:</span> <strong>${mfaEnabled ? 'YES' : 'no'}</strong>`;
    const polBtn = btn(mfaEnabled ? 'Disable MFA enforcement' : 'Enable MFA enforcement', () => {
      mfaEnabled = !mfaEnabled;
      idp.setConditionalPolicy({ requireMfa: mfaEnabled });
      refresh();
    });
    polRow.appendChild(polBtn);
    body.appendChild(polRow);

    /* Applications */
    body.appendChild(h2('Registered Applications'));
    const appList = document.createElement('div');
    appList.style.cssText =
      'max-height:100px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;margin-bottom:8px;';
    for (const a of appsList) {
      const row = document.createElement('div');
      row.style.cssText =
        'padding:6px 10px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;font-size:12px;';
      const statusColor =
        a.status === 'configured'
          ? 'var(--accent)'
          : a.status === 'misconfigured'
            ? 'var(--warn)'
            : 'var(--err)';
      row.innerHTML = `
        <span><strong>${a.name}</strong> <span style="color:var(--muted)">${a.protocol}</span></span>
        <span style="color:${statusColor}">${a.status}</span>
        <span style="color:var(--muted)">${a.mfaRequired ? 'MFA' : ''}</span>
      `;
      appList.appendChild(row);
    }
    body.appendChild(appList);

    /* Recent audit */
    body.appendChild(h2('Recent Audit Events'));
    const auditList = document.createElement('div');
    auditList.style.cssText =
      'max-height:120px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;';
    const recent = audit.events.slice(-15).reverse();
    for (const ev of recent) {
      const row = document.createElement('div');
      row.style.cssText =
        'padding:4px 10px;border-bottom:1px solid var(--border);font-size:11px;color:var(--muted);font-family:monospace;';
      // Readable names, not branded ids — this log is meant to be investigated.
      row.textContent =
        `[${new Date(ev.at).toLocaleTimeString()}] ${ev.action} ` +
        `${describeAuditId(ev.targetId, dir)}` +
        `${ev.subjectId ? ` (subject: ${describeAuditId(ev.subjectId, dir)})` : ''}`;
      auditList.appendChild(row);
    }
    body.appendChild(auditList);

    /* Sign-in verification */
    body.appendChild(h2('Verify Authentication'));
    body.appendChild(
      formRow([
        sel(
          'siuser',
          users.map((u) => ({ v: u.username, t: u.username })),
        ),
        btn('Sign in (verify)', () => {
          const username = body.querySelector<HTMLSelectElement>('[data-k="siuser"]')!.value;
          const result = idp.signIn(username, `${username}123`);
          if (result.ok) {
            if (result.user.mfa !== 'none') {
              const mfa = idp.completeMfa(result.session.id, result.user.mfa as MfaMethod);
              if (!mfa.ok) showError(body, `MFA failed: ${mfa.reason}`);
              else showResult(body, `${username} signed in — MFA (${result.user.mfa}) completed.`);
            } else {
              showResult(body, `${username} signed in successfully.`);
            }
          } else {
            showError(body, `Sign-in failed: ${result.reason}`);
          }
          refresh();
        }),
      ]),
    );
  };

  function val(k: string): string {
    return body.querySelector<HTMLInputElement>(`[data-k="${k}"]`)?.value ?? '';
  }

  refresh();
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */
function h2(text: string): HTMLElement {
  const h = document.createElement('h3');
  h.style.cssText =
    'color:var(--accent);font-size:12px;margin:12px 0 4px 0;letter-spacing:0.05em;text-transform:uppercase;';
  h.textContent = text;
  return h;
}

function inp(key: string, placeholder: string): HTMLElement {
  const i = document.createElement('input');
  i.type = 'text';
  i.setAttribute('data-k', key);
  i.placeholder = placeholder;
  i.style.cssText =
    'background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;padding:4px 8px;font-size:12px;flex:1;min-width:90px;';
  return i;
}

function sel(key: string, options: { v: string; t: string }[]): HTMLElement {
  const s = document.createElement('select');
  s.setAttribute('data-k', key);
  s.style.cssText =
    'background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;padding:4px 6px;font-size:12px;flex:1;min-width:100px;';
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.v;
    opt.textContent = o.t;
    s.appendChild(opt);
  }
  return s;
}

function btn(label: string, onClick: () => void): HTMLElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText =
    'background:var(--accent);color:var(--bg);border:none;border-radius:4px;padding:4px 10px;font-size:12px;cursor:pointer;font-weight:600;white-space:nowrap;';
  b.addEventListener('click', onClick);
  return b;
}

function formRow(children: HTMLElement[]): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0;';
  for (const c of children) row.appendChild(c);
  return row;
}

/** Success counterpart to showError. The lab recorded a successful sign-in as
 *  evidence; with no scoring here, the confirmation has to be visible instead. */
function showResult(body: HTMLElement, msg: string) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText =
    'margin:8px 0;padding:8px 10px;border-radius:4px;font-size:12px;' +
    'background:rgba(78,201,176,0.12);border:1px solid #4ec9b0;color:#4ec9b0;';
  body.appendChild(el);
}

function showError(body: HTMLElement, msg: string) {
  const err = document.createElement('div');
  err.style.cssText =
    'color:var(--err);font-size:12px;margin:4px 0;padding:4px 8px;background:rgba(244,135,113,0.1);border-radius:3px;';
  err.textContent = msg;
  body.appendChild(err);
  setTimeout(() => err.remove(), 4000);
}
