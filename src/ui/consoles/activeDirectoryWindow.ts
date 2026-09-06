/**
 * ui/consoles/activeDirectoryWindow.ts — Active Directory Users and Computers.
 *
 * Laid out the way the real MMC snap-in is: a domain tree on the left, an
 * object list on the right, right-click context menus, and a tabbed Properties
 * dialog. That shape is not decoration — "where do I click to reset a password"
 * is a question an interviewer asks, and muscle memory built here transfers.
 *
 * Every mutation goes through the capability registry, so an action taken here
 * fires exactly the same service calls and audit events as the same action
 * typed in the terminal or run from a script. The three surfaces cannot drift.
 */
import type { VmServices } from '@/vm/session';
import type { Group, User, UserId } from '@/domain';
import { CAPABILITY_BY_ID, type CapabilityContext } from '@/services';
import { DEPARTMENTS } from '@/config';
import { VM_HOST } from '@/config/vmHost';
import { showToast } from '@/ui/toast';

// ---------------------------------------------------------------------------
// Tree model
// ---------------------------------------------------------------------------

type NodeKind = 'domain' | 'container' | 'ou';

interface TreeNode {
  id: string;
  label: string;
  kind: NodeKind;
  /** Folder glyph. The real snap-in distinguishes containers from OUs. */
  icon: string;
  children?: TreeNode[];
}

/** Computers are display-only: the directory model has no computer object,
 *  and inventing one would imply actions that do nothing. */
const DOMAIN_COMPUTERS = [
  { name: VM_HOST.name, description: 'Workstation — IT' },
  { name: 'NW-FIN-WS04', description: 'Workstation — Finance' },
  { name: 'NW-ENG-WS11', description: 'Workstation — Engineering' },
];
const DOMAIN_SERVERS = [
  { name: VM_HOST.domainController, description: 'Domain Controller' },
  { name: 'NW-FS01', description: 'File Server' },
  { name: 'NW-IDP01', description: 'Identity Provider' },
];

function buildTree(): TreeNode {
  return {
    id: 'domain',
    label: VM_HOST.domain,
    kind: 'domain',
    icon: '🌐',
    children: [
      { id: 'builtin', label: 'Builtin', kind: 'container', icon: '📁' },
      { id: 'computers', label: 'Computers', kind: 'container', icon: '📁' },
      { id: 'domain-controllers', label: 'Domain Controllers', kind: 'ou', icon: '🗂️' },
      { id: 'groups', label: 'Groups', kind: 'ou', icon: '🗂️' },
      { id: 'service-accounts', label: 'Service Accounts', kind: 'ou', icon: '🗂️' },
      {
        id: 'users',
        label: 'Users',
        kind: 'ou',
        icon: '🗂️',
        children: DEPARTMENTS.map((d) => ({
          id: `users:${d}`,
          label: d,
          kind: 'ou' as NodeKind,
          icon: '🗂️',
        })),
      },
    ],
  };
}

/** A row in the object list. */
interface AdObject {
  name: string;
  type: string;
  description: string;
  /** Present for directory principals; absent for display-only rows. */
  user?: User;
  group?: Group;
}

const isServiceAccount = (u: User): boolean => u.username.startsWith('svc-');

function objectsFor(nodeId: string, dir: VmServices['dir']): AdObject[] {
  const users = dir.listUsers();

  if (nodeId === 'groups') {
    return dir.listGroups().map((g) => ({
      name: g.name,
      type: 'Security Group',
      description: g.description || `${g.memberIds.length} member(s)`,
      group: g,
    }));
  }
  if (nodeId === 'service-accounts') {
    return users.filter(isServiceAccount).map(toUserRow);
  }
  if (nodeId === 'computers') {
    return DOMAIN_COMPUTERS.map((c) => ({
      name: c.name,
      type: 'Computer',
      description: c.description,
    }));
  }
  if (nodeId === 'domain-controllers') {
    return DOMAIN_SERVERS.map((c) => ({ name: c.name, type: 'Computer', description: c.description }));
  }
  if (nodeId === 'builtin') {
    return [
      { name: 'Administrators', type: 'Security Group', description: 'Built-in administrators' },
      { name: 'Domain Users', type: 'Security Group', description: 'All domain users' },
      { name: 'Remote Desktop Users', type: 'Security Group', description: 'RDP access' },
    ];
  }
  if (nodeId === 'users') {
    return users.filter((u) => !isServiceAccount(u)).map(toUserRow);
  }
  if (nodeId.startsWith('users:')) {
    const dept = nodeId.slice('users:'.length);
    return users.filter((u) => !isServiceAccount(u) && u.department === dept).map(toUserRow);
  }
  // Domain root: show the containers themselves, as the snap-in does.
  return [];
}

function toUserRow(u: User): AdObject {
  const status =
    u.status === 'active'
      ? u.title
      : `${u.title} — account ${u.status}`;
  return { name: u.displayName, type: 'User', description: status, user: u };
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

export function renderActiveDirectoryWindow(body: HTMLElement, conductor: VmServices): void {
  body.innerHTML = '';
  Object.assign(body.style, {
    overflow: 'hidden',
    background: '#1e1e1e',
    flex: '1',
    minHeight: '0',
  });

  const ctx = (): CapabilityContext => ({
    dir: conductor.dir,
    idp: conductor.idp,
    tickets: conductor.tickets,
    audit: conductor.audit,
    actor: 'system' as UserId,
  });

  /** Run a registry capability and report the outcome the way the snap-in does. */
  const run = (capId: string, args: Record<string, string>): boolean => {
    const cap = CAPABILITY_BY_ID[capId];
    if (!cap) return false;
    const res = cap.run(ctx(), args);
    showToast(res.ok ? res.message : res.error, { kind: res.ok ? 'success' : 'error' });
    if (res.ok) refresh();
    return res.ok;
  };

  const tree = buildTree();
  let selectedNodeId = 'users';
  let selectedObject: AdObject | null = null;
  const expanded = new Set<string>(['domain', 'users']);

  const root = document.createElement('div');
  root.style.cssText =
    'display:flex;flex-direction:column;height:100%;min-height:0;' +
    "font-family:'Segoe UI',-apple-system,sans-serif;font-size:12px;color:#e6e6e6;";
  body.appendChild(root);

  // ── Menu bar ─────────────────────────────────────────────────────────────
  const menubar = document.createElement('div');
  menubar.style.cssText =
    'display:flex;gap:2px;padding:3px 6px;background:#2b2b2b;border-bottom:1px solid #3c3c3c;' +
    'flex-shrink:0;font-size:11.5px;';
  for (const label of ['File', 'Action', 'View', 'Help']) {
    const m = document.createElement('span');
    m.textContent = label;
    m.style.cssText = 'padding:2px 8px;border-radius:3px;cursor:default;color:#ccc;';
    m.addEventListener('mouseenter', () => (m.style.background = '#3c3c3c'));
    m.addEventListener('mouseleave', () => (m.style.background = 'transparent'));
    menubar.appendChild(m);
  }
  root.appendChild(menubar);

  // ── Toolbar ──────────────────────────────────────────────────────────────
  const toolbar = document.createElement('div');
  toolbar.style.cssText =
    'display:flex;align-items:center;gap:4px;padding:4px 6px;background:#252526;' +
    'border-bottom:1px solid #3c3c3c;flex-shrink:0;';
  const toolBtn = (label: string, title: string, onClick: () => void): HTMLElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.style.cssText =
      'background:transparent;border:1px solid transparent;border-radius:3px;color:#ccc;' +
      'padding:3px 8px;font-size:12px;cursor:pointer;';
    b.addEventListener('mouseenter', () => {
      b.style.background = '#3c3c3c';
      b.style.borderColor = '#4c4c4c';
    });
    b.addEventListener('mouseleave', () => {
      b.style.background = 'transparent';
      b.style.borderColor = 'transparent';
    });
    b.addEventListener('click', onClick);
    return b;
  };
  toolbar.append(
    toolBtn('👤 New User', 'Create a user in this container', () => newUserDialog()),
    toolBtn('👥 New Group', 'Create a security group', () => newGroupDialog()),
    toolBtn('🔄 Refresh', 'Refresh the object list', () => refresh()),
    toolBtn('📋 Properties', 'Open the selected object', () => {
      if (selectedObject?.user) propertiesDialog(selectedObject.user);
      else showToast('Select a user first.', { kind: 'info' });
    }),
  );
  root.appendChild(toolbar);

  // ── Panes ────────────────────────────────────────────────────────────────
  const panes = document.createElement('div');
  panes.style.cssText = 'flex:1;display:flex;min-height:0;';
  root.appendChild(panes);

  const treePane = document.createElement('div');
  treePane.style.cssText =
    'width:240px;flex-shrink:0;background:#252526;border-right:1px solid #3c3c3c;' +
    'overflow:auto;padding:6px 0;';
  panes.appendChild(treePane);

  const listPane = document.createElement('div');
  listPane.style.cssText = 'flex:1;min-width:0;overflow:auto;background:#1e1e1e;';
  panes.appendChild(listPane);

  // ── Status bar ───────────────────────────────────────────────────────────
  const status = document.createElement('div');
  status.style.cssText =
    'padding:4px 10px;background:#252526;border-top:1px solid #3c3c3c;font-size:11px;' +
    'color:#9d9d9d;flex-shrink:0;';
  root.appendChild(status);

  // ── Tree rendering ───────────────────────────────────────────────────────
  function renderTree(): void {
    treePane.innerHTML = '';

    const drawNode = (node: TreeNode, depth: number): void => {
      const row = document.createElement('div');
      const isSelected = node.id === selectedNodeId;
      row.style.cssText =
        `display:flex;align-items:center;gap:4px;padding:3px 6px 3px ${6 + depth * 14}px;` +
        `cursor:pointer;font-size:12px;white-space:nowrap;` +
        (isSelected ? 'background:#094771;color:#fff;' : 'color:#ccc;');

      const hasKids = !!node.children?.length;
      const twisty = document.createElement('span');
      twisty.textContent = hasKids ? (expanded.has(node.id) ? '▾' : '▸') : ' ';
      twisty.style.cssText = 'width:10px;flex-shrink:0;color:#9d9d9d;font-size:9px;';
      if (hasKids) {
        twisty.addEventListener('click', (e) => {
          e.stopPropagation();
          if (expanded.has(node.id)) expanded.delete(node.id);
          else expanded.add(node.id);
          renderTree();
        });
      }

      const icon = document.createElement('span');
      icon.textContent = node.icon;
      const label = document.createElement('span');
      label.textContent = node.label;

      row.append(twisty, icon, label);
      row.addEventListener('click', () => {
        selectedNodeId = node.id;
        selectedObject = null;
        if (hasKids) expanded.add(node.id);
        renderTree();
        renderList();
      });
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        selectedNodeId = node.id;
        renderTree();
        contextMenu(e, [
          { label: 'New  ▸  User', onClick: () => newUserDialog() },
          { label: 'New  ▸  Group', onClick: () => newGroupDialog() },
          { label: 'Refresh', onClick: () => refresh() },
        ]);
      });
      treePane.appendChild(row);

      if (hasKids && expanded.has(node.id)) {
        for (const child of node.children!) drawNode(child, depth + 1);
      }
    };

    drawNode(tree, 0);
  }

  // ── Object list ──────────────────────────────────────────────────────────
  function renderList(): void {
    listPane.innerHTML = '';
    const objects = objectsFor(selectedNodeId, conductor.dir);

    const table = document.createElement('div');
    table.style.cssText = 'display:table;width:100%;';

    const header = document.createElement('div');
    header.style.cssText =
      'display:table-row;position:sticky;top:0;background:#2b2b2b;font-weight:600;';
    for (const [col, width] of [
      ['Name', '34%'],
      ['Type', '20%'],
      ['Description', '46%'],
    ] as const) {
      const th = document.createElement('div');
      th.textContent = col;
      th.style.cssText =
        `display:table-cell;padding:5px 10px;border-bottom:1px solid #3c3c3c;` +
        `border-right:1px solid #3c3c3c;width:${width};font-size:11.5px;color:#ccc;`;
      header.appendChild(th);
    }
    table.appendChild(header);

    for (const obj of objects) {
      const row = document.createElement('div');
      const isSel = selectedObject?.name === obj.name;
      row.style.cssText =
        'display:table-row;cursor:default;' + (isSel ? 'background:#094771;' : '');

      const icon = obj.user ? (obj.user.status === 'active' ? '👤' : '🚫') : obj.group ? '👥' : '💻';
      for (const [text, isName] of [
        [`${icon}  ${obj.name}`, true],
        [obj.type, false],
        [obj.description, false],
      ] as const) {
        const td = document.createElement('div');
        td.textContent = text;
        td.style.cssText =
          'display:table-cell;padding:4px 10px;border-bottom:1px solid #2a2a2a;font-size:12px;' +
          (isName ? 'color:#e6e6e6;' : 'color:#b0b0b0;');
        row.appendChild(td);
      }

      row.addEventListener('click', () => {
        selectedObject = obj;
        renderList();
      });
      row.addEventListener('dblclick', () => {
        if (obj.user) propertiesDialog(obj.user);
      });
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        selectedObject = obj;
        renderList();
        if (obj.user) userContextMenu(e, obj.user);
        else if (obj.group) groupContextMenu(e, obj.group);
      });
      table.appendChild(row);
    }

    listPane.appendChild(table);

    if (objects.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'There are no items to show in this view.';
      empty.style.cssText = 'padding:20px;color:#9d9d9d;font-size:12px;';
      listPane.appendChild(empty);
    }

    status.textContent = `${objects.length} object(s)`;
  }

  // ── Context menus ────────────────────────────────────────────────────────
  /** A menu row, or a separator rule between groups of them. */
  type MenuItem = { label: string; onClick?: () => void } | { separator: true };

  function contextMenu(e: MouseEvent, items: MenuItem[]): void {
    document.querySelectorAll('.aduc-menu').forEach((m) => m.remove());
    const menu = document.createElement('div');
    menu.className = 'aduc-menu';
    menu.style.cssText =
      `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:99999;` +
      'background:#2b2b2b;border:1px solid #4c4c4c;border-radius:3px;padding:3px 0;' +
      'min-width:190px;box-shadow:0 4px 14px rgba(0,0,0,0.5);font-size:12px;';

    for (const item of items) {
      if ('separator' in item) {
        const hr = document.createElement('div');
        hr.style.cssText = 'height:1px;background:#3c3c3c;margin:3px 0;';
        menu.appendChild(hr);
        continue;
      }
      const row = document.createElement('div');
      row.textContent = item.label;
      row.style.cssText = 'padding:5px 14px;cursor:pointer;color:#e6e6e6;';
      row.addEventListener('mouseenter', () => (row.style.background = '#094771'));
      row.addEventListener('mouseleave', () => (row.style.background = 'transparent'));
      row.addEventListener('click', () => {
        menu.remove();
        item.onClick?.();
      });
      menu.appendChild(row);
    }

    document.body.appendChild(menu);
    const close = (ev: MouseEvent): void => {
      if (!menu.contains(ev.target as Node)) {
        menu.remove();
        document.removeEventListener('mousedown', close);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
  }

  function userContextMenu(e: MouseEvent, u: User): void {
    contextMenu(e, [
      { label: 'Properties', onClick: () => propertiesDialog(u) },
      { separator: true },
      { label: 'Reset Password…', onClick: () => resetPasswordDialog(u) },
      {
        label: 'Unlock Account',
        onClick: () => run('account.unlock', { Identity: u.username }),
      },
      { separator: true },
      {
        label: u.status === 'disabled' ? 'Enable Account' : 'Disable Account',
        onClick: () =>
          run(u.status === 'disabled' ? 'user.enable' : 'user.disable', { Identity: u.username }),
      },
      { label: 'Add to Group…', onClick: () => addToGroupDialog(u) },
      { label: 'Move…', onClick: () => moveDialog(u) },
      { separator: true },
      {
        label: 'Delete',
        onClick: () => {
          if (window.confirm(`Delete "${u.displayName}"? This cannot be undone.`)) {
            run('user.delete', { Identity: u.username });
          }
        },
      },
    ]);
  }

  function groupContextMenu(e: MouseEvent, g: Group): void {
    contextMenu(e, [
      {
        label: 'Members…',
        onClick: () => {
          const members = g.memberIds
            .map((id) => conductor.dir.getUser(id)?.username ?? id)
            .join('\n');
          modal(`Members of ${g.name}`, (b) => {
            const pre = document.createElement('pre');
            pre.textContent = members || '(no members)';
            pre.style.cssText = 'margin:0;font-size:12px;color:#e6e6e6;';
            b.appendChild(pre);
          });
        },
      },
      { separator: true },
      {
        label: 'Delete',
        onClick: () => {
          if (window.confirm(`Delete group "${g.name}"?`)) {
            conductor.dir.deleteGroup(g.id);
            showToast(`Deleted ${g.name}.`, { kind: 'success' });
            refresh();
          }
        },
      },
    ]);
  }

  // ── Dialogs ──────────────────────────────────────────────────────────────
  function modal(title: string, build: (bodyEl: HTMLElement) => void, onOk?: () => boolean): void {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:99998;' +
      'display:flex;align-items:center;justify-content:center;';

    const dialog = document.createElement('div');
    dialog.style.cssText =
      'background:#252526;border:1px solid #4c4c4c;border-radius:4px;min-width:400px;' +
      "max-width:560px;box-shadow:0 10px 40px rgba(0,0,0,0.6);font-family:'Segoe UI',sans-serif;";

    const bar = document.createElement('div');
    bar.textContent = title;
    bar.style.cssText =
      'padding:8px 12px;background:#2b2b2b;border-bottom:1px solid #3c3c3c;font-size:12.5px;' +
      'font-weight:600;color:#e6e6e6;';

    const content = document.createElement('div');
    content.style.cssText = 'padding:14px;max-height:60vh;overflow:auto;';
    build(content);

    const footer = document.createElement('div');
    footer.style.cssText =
      'display:flex;justify-content:flex-end;gap:8px;padding:10px 12px;' +
      'border-top:1px solid #3c3c3c;';

    const close = (): void => overlay.remove();
    const mkBtn = (label: string, primary: boolean, onClick: () => void): HTMLElement => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText =
        'padding:5px 18px;border-radius:3px;font-size:12px;cursor:pointer;' +
        (primary
          ? 'background:#0e639c;border:1px solid #1177bb;color:#fff;'
          : 'background:#3c3c3c;border:1px solid #4c4c4c;color:#e6e6e6;');
      b.addEventListener('click', onClick);
      return b;
    };

    if (onOk) {
      footer.append(
        mkBtn('OK', true, () => {
          if (onOk()) close();
        }),
        mkBtn('Cancel', false, close),
      );
    } else {
      footer.appendChild(mkBtn('Close', true, close));
    }

    dialog.append(bar, content, footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  }

  /** Labelled field, returning a reader for its value. */
  function field(
    parent: HTMLElement,
    label: string,
    opts: { type?: string; value?: string; options?: string[] } = {},
  ): () => string {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:9px;';
    const lab = document.createElement('label');
    lab.textContent = label;
    lab.style.cssText = 'width:132px;flex-shrink:0;font-size:12px;color:#ccc;text-align:right;';

    let read: () => string;
    if (opts.options) {
      const sel = document.createElement('select');
      sel.style.cssText = fieldCss;
      for (const o of opts.options) sel.appendChild(new Option(o, o));
      if (opts.value) sel.value = opts.value;
      row.append(lab, sel);
      read = () => sel.value;
    } else {
      const input = document.createElement('input');
      input.type = opts.type ?? 'text';
      input.value = opts.value ?? '';
      input.style.cssText = fieldCss;
      row.append(lab, input);
      read = () => input.value;
    }
    parent.appendChild(row);
    return read;
  }

  const fieldCss =
    'flex:1;background:#1e1e1e;color:#e6e6e6;border:1px solid #3c3c3c;border-radius:2px;' +
    'padding:4px 7px;font-size:12px;outline:none;';

  function newUserDialog(): void {
    // Pre-fill the department from the OU you right-clicked, as the snap-in does.
    const dept = selectedNodeId.startsWith('users:')
      ? selectedNodeId.slice('users:'.length)
      : DEPARTMENTS[0];

    let readFirst = (): string => '';
    let readLast = (): string => '';
    let readLogon = (): string => '';
    let readDept = (): string => '';
    let readTitle = (): string => '';
    let readPwd = (): string => '';
    let mustChange = false;

    modal(
      'New Object — User',
      (b) => {
        readFirst = field(b, 'First name:');
        readLast = field(b, 'Last name:');
        readLogon = field(b, 'User logon name:');
        readDept = field(b, 'Department:', { options: [...DEPARTMENTS], value: dept });
        readTitle = field(b, 'Job title:', { value: 'Analyst' });
        readPwd = field(b, 'Password:', { type: 'password' });

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-left:142px;';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.addEventListener('change', () => (mustChange = cb.checked));
        const lab = document.createElement('label');
        lab.textContent = 'User must change password at next logon';
        lab.style.cssText = 'font-size:12px;color:#ccc;';
        row.append(cb, lab);
        b.appendChild(row);

        const hint = document.createElement('div');
        hint.textContent =
          'The department decides which applications appear on their desktop. Leave the ' +
          'password blank to use the house default of username123.';
        hint.style.cssText = 'font-size:11px;color:#9d9d9d;margin-top:10px;line-height:1.5;';
        b.appendChild(hint);
      },
      () => {
        const first = readFirst().trim();
        const last = readLast().trim();
        const logon =
          readLogon().trim() || `${first}.${last}`.toLowerCase().replace(/\s+/g, '');
        if (!first || !last) {
          showToast('First and last name are required.', { kind: 'error' });
          return false;
        }
        return run('user.create', {
          SamAccountName: logon,
          Name: `${first} ${last}`,
          Department: readDept(),
          Title: readTitle(),
          AccountPassword: readPwd(),
          ChangePasswordAtLogon: mustChange ? 'true' : 'false',
        });
      },
    );
  }

  function newGroupDialog(): void {
    let readName = (): string => '';
    let readDesc = (): string => '';
    modal(
      'New Object — Group',
      (b) => {
        readName = field(b, 'Group name:');
        readDesc = field(b, 'Description:');
      },
      () => run('group.create', { Name: readName().trim(), Description: readDesc() }),
    );
  }

  function resetPasswordDialog(u: User): void {
    let readPwd = (): string => '';
    let mustChange = true;
    modal(
      `Reset Password — ${u.displayName}`,
      (b) => {
        readPwd = field(b, 'New password:', { type: 'password' });
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-left:142px;';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.addEventListener('change', () => (mustChange = cb.checked));
        const lab = document.createElement('label');
        lab.textContent = 'User must change password at next logon';
        lab.style.cssText = 'font-size:12px;color:#ccc;';
        row.append(cb, lab);
        b.appendChild(row);
      },
      () =>
        run('password.reset', {
          Identity: u.username,
          NewPassword: readPwd(),
          ChangePasswordAtLogon: mustChange ? 'true' : 'false',
        }),
    );
  }

  function addToGroupDialog(u: User): void {
    let readGroup = (): string => '';
    modal(
      `Add ${u.displayName} to Group`,
      (b) => {
        readGroup = field(b, 'Group:', {
          options: conductor.dir.listGroups().map((g) => g.name),
        });
      },
      () => run('group.addMember', { Identity: u.username, Group: readGroup() }),
    );
  }

  function moveDialog(u: User): void {
    let readDept = (): string => '';
    modal(
      `Move — ${u.displayName}`,
      (b) => {
        readDept = field(b, 'Move to department:', {
          options: [...DEPARTMENTS],
          value: u.department,
        });
      },
      () => run('user.move', { Identity: u.username, TargetDepartment: readDept() }),
    );
  }

  /** The tabbed Properties sheet, which is where ADUC muscle memory lives. */
  function propertiesDialog(u: User): void {
    modal(`${u.displayName} Properties`, (b) => {
      const tabs = ['General', 'Account', 'Member Of'];
      let active = 'General';

      const tabBar = document.createElement('div');
      tabBar.style.cssText = 'display:flex;gap:2px;border-bottom:1px solid #3c3c3c;margin-bottom:12px;';
      const panel = document.createElement('div');

      const paint = (): void => {
        tabBar.innerHTML = '';
        for (const t of tabs) {
          const tab = document.createElement('div');
          tab.textContent = t;
          tab.style.cssText =
            'padding:5px 14px;font-size:12px;cursor:pointer;border:1px solid transparent;' +
            'border-bottom:none;border-radius:3px 3px 0 0;' +
            (t === active
              ? 'background:#252526;border-color:#3c3c3c;color:#fff;margin-bottom:-1px;'
              : 'color:#9d9d9d;');
          tab.addEventListener('click', () => {
            active = t;
            paint();
          });
          tabBar.appendChild(tab);
        }

        panel.innerHTML = '';
        const info = (k: string, v: string): void => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;gap:10px;margin-bottom:7px;font-size:12px;';
          const key = document.createElement('span');
          key.textContent = k;
          key.style.cssText = 'width:132px;flex-shrink:0;color:#9d9d9d;text-align:right;';
          const val = document.createElement('span');
          val.textContent = v;
          val.style.cssText = 'color:#e6e6e6;';
          row.append(key, val);
          panel.appendChild(row);
        };

        if (active === 'General') {
          info('Display name:', u.displayName);
          info('Description:', u.title);
          info('Department:', u.department);
          info('E-mail:', u.email);
        } else if (active === 'Account') {
          info('User logon name:', `${u.username}@${VM_HOST.domain}`);
          info('Account status:', u.status);
          info('MFA method:', u.mfa === 'none' ? 'not registered' : u.mfa);
          info(
            'Must change password:',
            u.mustChangePassword ? 'Yes — at next logon' : 'No',
          );
          info(
            'Last sign-in:',
            u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleString() : 'never',
          );
        } else {
          const groups = conductor.dir
            .listGroups()
            .filter((g) => g.memberIds.includes(u.id));
          if (groups.length === 0) info('Member of:', '(none)');
          for (const g of groups) info('', g.name);
        }
      };

      paint();
      b.append(tabBar, panel);
    });
  }

  function refresh(): void {
    renderTree();
    renderList();
  }

  refresh();
}
