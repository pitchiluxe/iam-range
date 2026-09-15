/**
 * ui/consoles/remoteDesktopWindow.ts — "Remote Desktop Connection" (RDP) app.
 *
 * IT/Help Desk only. Lets the operator verify a directory account without
 * signing out of their own session: this workstation's login screen
 * (ui/loginScreen.ts) already lets anyone sign in as anyone by signing out
 * first, but that costs the operator their own desktop. This is the same
 * verification — real idp.signIn()/completeMfa() calls, so a disabled or
 * locked account is refused for the real reason and a forced password change
 * behaves exactly as it does at the real login screen — run in a small nested
 * session that leaves the operator's own sign-in untouched.
 *
 * The account list is read live from MockDirectory on every render, so a
 * user created or disabled a moment ago (in Active Directory, or by a
 * ticket) shows up immediately.
 */
import type { VmServices } from '@/vm/session';
import type { AppId, Application, User } from '@/domain';
import { MESSAGES } from '@/vm/loginSession';
import { VM_HOST } from '@/config/vmHost';

const STATIC_IP = '10.20.4.50';
const STATIC_HOST = 'ONBOARD-WKS01';

/** Department -> the one line-of-business app that department's remote
 *  session shows. Departments with no dedicated portal fall back to a
 *  generic "My Apps" tile listing everything federated, same as a real
 *  employee would see. */
const DEPT_APP_NAME: Record<string, string> = {
  Finance: 'Finance Portal',
  HR: 'HR Portal',
};

type Screen = 'connect' | 'signin' | 'force-change' | 'session';

export function renderRemoteDesktopWindow(body: HTMLElement, services: VmServices): void {
  body.innerHTML = '';
  Object.assign(body.style, { overflow: 'hidden', background: '#0e1116', flex: '1', minHeight: '0' });

  const root = document.createElement('div');
  root.style.cssText =
    'display:flex;flex-direction:column;height:100%;min-height:0;font-size:12px;color:#c8cdd3;' +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";
  body.appendChild(root);

  let screen: Screen = 'connect';
  let selectedUsername = '';
  let typedPassword = '';
  let sessionUser: User | null = null;
  let error = '';
  let openAppId: AppId | '__account__' | null = null;

  const el = (tag: string, css: string, text?: string): HTMLElement => {
    const e = document.createElement(tag);
    e.style.cssText = css;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  function render(): void {
    root.innerHTML = '';
    if (screen === 'connect') renderConnect();
    else if (screen === 'signin') renderSignIn();
    else if (screen === 'force-change') renderForceChange();
    else renderSession();
  }

  // ── Screen 1: mstsc-style connect dialog ──────────────────────────────────
  function renderConnect(): void {
    const wrap = el(
      'div',
      'flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;',
    );
    wrap.appendChild(el('div', 'font-size:32px;', '🖥️'));
    wrap.appendChild(
      el('div', 'font-size:14px;color:#e6e6e6;font-weight:600;', 'Remote Desktop Connection'),
    );

    const field = el('div', 'display:flex;flex-direction:column;gap:6px;width:280px;');
    field.appendChild(el('div', 'font-size:11px;color:#8b95a1;', 'Computer:'));
    const input = document.createElement('input');
    input.value = `${STATIC_IP} (${STATIC_HOST}.${VM_HOST.domain})`;
    input.readOnly = true;
    input.style.cssText =
      'background:#1a1d22;color:#e6e6e6;border:1px solid #2d343d;border-radius:4px;' +
      'padding:6px 8px;font-size:12px;outline:none;';
    field.appendChild(input);
    wrap.appendChild(field);

    const row = el('div', 'display:flex;gap:10px;');
    row.appendChild(
      mkButton('Connect', true, () => {
        screen = 'signin';
        error = '';
        render();
      }),
    );
    wrap.appendChild(row);

    root.appendChild(wrap);
  }

  // ── Screen 2: sign-in ──────────────────────────────────────────────────────
  function renderSignIn(): void {
    const users = services.dir.listUsers();

    const wrap = el(
      'div',
      'flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;',
    );
    wrap.appendChild(
      el('div', 'font-size:12.5px;color:#8b95a1;', `Connecting to ${STATIC_IP} (${STATIC_HOST})`),
    );

    const form = el('div', 'display:flex;flex-direction:column;gap:10px;width:280px;');

    form.appendChild(el('div', 'font-size:11px;color:#8b95a1;', 'User account:'));
    const picker = document.createElement('select');
    picker.style.cssText =
      'background:#1a1d22;color:#e6e6e6;border:1px solid #2d343d;border-radius:4px;' +
      'padding:6px 8px;font-size:12px;outline:none;';
    for (const u of users) {
      const disabled = u.status === 'disabled';
      const label = `${disabled ? '❌ ' : ''}${u.username}${u.status !== 'active' ? ` (${u.status})` : ''}`;
      const opt = new Option(label, u.username);
      if (disabled) opt.style.color = '#f48771';
      picker.appendChild(opt);
    }
    if (!selectedUsername && users.length > 0) selectedUsername = users[0]!.username;
    picker.value = selectedUsername;
    picker.addEventListener('change', () => {
      selectedUsername = picker.value;
    });
    form.appendChild(picker);

    form.appendChild(el('div', 'font-size:11px;color:#8b95a1;', 'Password:'));
    const pwInput = document.createElement('input');
    pwInput.type = 'password';
    pwInput.style.cssText =
      'background:#1a1d22;color:#e6e6e6;border:1px solid #2d343d;border-radius:4px;' +
      'padding:6px 8px;font-size:12px;outline:none;';
    pwInput.addEventListener('input', () => {
      typedPassword = pwInput.value;
    });
    pwInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') attemptSignIn();
    });
    form.appendChild(pwInput);

    if (error) {
      form.appendChild(el('div', 'font-size:11px;color:#f48771;line-height:1.5;', error));
    }

    const row = el('div', 'display:flex;gap:10px;');
    row.appendChild(mkButton('Sign in', true, attemptSignIn));
    row.appendChild(
      mkButton('Cancel', false, () => {
        screen = 'connect';
        error = '';
        typedPassword = '';
        render();
      }),
    );
    form.appendChild(row);

    wrap.appendChild(form);
    root.appendChild(wrap);
  }

  function attemptSignIn(): void {
    if (!selectedUsername) return;
    const result = services.idp.signIn(selectedUsername, typedPassword);
    if (!result.ok) {
      if (result.reason === 'must-change-password') {
        screen = 'force-change';
        error = '';
        render();
        return;
      }
      error = MESSAGES[result.reason as keyof typeof MESSAGES] ?? MESSAGES.unknown;
      render();
      return;
    }
    if (result.user.mfa !== 'none') {
      services.idp.completeMfa(result.session.id, result.user.mfa);
    }
    sessionUser = result.user;
    typedPassword = '';
    error = '';
    screen = 'session';
    openAppId = null;
    render();
  }

  // ── Screen 3: forced password change (temp-password onboarding case) ─────
  function renderForceChange(): void {
    const wrap = el(
      'div',
      'flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;',
    );
    wrap.appendChild(
      el(
        'div',
        'font-size:12.5px;color:#d7ba7d;text-align:center;max-width:280px;',
        'Your password has expired. You must set a new password before continuing.',
      ),
    );

    const form = el('div', 'display:flex;flex-direction:column;gap:10px;width:280px;');
    form.appendChild(el('div', 'font-size:11px;color:#8b95a1;', 'New password:'));
    const p1 = document.createElement('input');
    p1.type = 'password';
    p1.style.cssText =
      'background:#1a1d22;color:#e6e6e6;border:1px solid #2d343d;border-radius:4px;' +
      'padding:6px 8px;font-size:12px;outline:none;';
    form.appendChild(p1);

    form.appendChild(el('div', 'font-size:11px;color:#8b95a1;', 'Confirm new password:'));
    const p2 = document.createElement('input');
    p2.type = 'password';
    p2.style.cssText = p1.style.cssText;
    form.appendChild(p2);

    if (error) form.appendChild(el('div', 'font-size:11px;color:#f48771;', error));

    const row = el('div', 'display:flex;gap:10px;');
    row.appendChild(
      mkButton('Change password', true, () => {
        const user = services.dir.getUserByUsername(selectedUsername);
        if (!user) return;
        if (!p1.value || p1.value !== p2.value) {
          error = 'Passwords do not match.';
          render();
          return;
        }
        const result = services.idp.changeOwnPassword(user.id, typedPassword, p1.value);
        if (!result.ok) {
          error = 'Could not change password. The temporary password may have changed.';
          render();
          return;
        }
        typedPassword = p1.value;
        attemptSignIn();
      }),
    );
    row.appendChild(
      mkButton('Cancel', false, () => {
        screen = 'connect';
        typedPassword = '';
        error = '';
        render();
      }),
    );
    form.appendChild(row);

    wrap.appendChild(form);
    root.appendChild(wrap);
  }

  // ── Screen 4: the signed-in session ───────────────────────────────────────
  function renderSession(): void {
    const user = sessionUser ? (services.dir.getUser(sessionUser.id) ?? sessionUser) : null;
    if (!user) {
      screen = 'connect';
      render();
      return;
    }

    const bar = el(
      'div',
      'display:flex;align-items:center;gap:10px;padding:8px 12px;background:#232830;' +
        'border-bottom:1px solid #2d343d;flex-shrink:0;',
    );
    bar.appendChild(
      el(
        'div',
        'font-size:12px;color:#4ec9b0;font-weight:600;',
        `${user.username}@${STATIC_HOST} — Remote Desktop`,
      ),
    );
    bar.appendChild(el('div', 'flex:1;'));
    bar.appendChild(
      mkButton('Disconnect', false, () => {
        screen = 'connect';
        sessionUser = null;
        selectedUsername = '';
        openAppId = null;
        render();
      }),
    );
    root.appendChild(bar);

    const content = el('div', 'flex:1;min-height:0;overflow-y:auto;padding:16px;');
    root.appendChild(content);

    if (openAppId) {
      renderAppResult(content, user, openAppId);
      return;
    }

    const grid = el(
      'div',
      'display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;',
    );

    const deptAppName = DEPT_APP_NAME[user.department];
    const deptApp = deptAppName
      ? services.apps.apps().find((a: Application) => a.name === deptAppName)
      : undefined;

    if (deptApp) {
      grid.appendChild(mkTile('🗂️', deptApp.name, () => openApp(deptApp.id)));
    } else {
      for (const app of services.apps.apps()) {
        grid.appendChild(mkTile('🗂️', app.name, () => openApp(app.id)));
      }
    }
    grid.appendChild(mkTile('👤', 'Account', () => openApp('__account__')));
    content.appendChild(grid);

    function openApp(id: AppId | '__account__'): void {
      openAppId = id;
      render();
    }
  }

  function renderAppResult(parent: HTMLElement, user: User, appId: AppId | '__account__'): void {
    const back = document.createElement('button');
    back.textContent = '← Back';
    back.style.cssText =
      'background:transparent;border:none;color:#4ec9b0;cursor:pointer;' +
      'font-size:11.5px;padding:0 0 12px 0;';
    back.addEventListener('click', () => {
      openAppId = null;
      render();
    });
    parent.appendChild(back);

    if (appId === '__account__') {
      renderAccount(parent, user);
      return;
    }

    const app = services.apps.getApp(appId);
    if (!app) {
      parent.appendChild(el('div', 'color:#f48771;', 'That application is no longer registered.'));
      return;
    }
    const result = services.apps.ssoLogin(app.id, user.id);
    const card = el(
      'div',
      'background:#fff;color:#1a1a2e;border-radius:6px;padding:16px;line-height:1.6;',
    );
    if (result.ok) {
      card.appendChild(
        el('div', 'font-size:14px;font-weight:600;color:#0f5132;', `Signed in to ${app.name}`),
      );
    } else {
      card.appendChild(el('div', 'font-size:14px;font-weight:600;color:#f48771;', 'Sign-in failed'));
      card.appendChild(el('div', 'font-size:12px;color:#444;margin-top:6px;', result.reason));
    }
    parent.appendChild(card);
  }

  function renderAccount(parent: HTMLElement, user: User): void {
    const groupNames =
      user.groupIds.map((gid) => services.dir.getGroup(gid)?.name ?? gid).join(', ') || '—';
    const rows: Array<[string, string]> = [
      ['Username', user.username],
      ['Display name', user.displayName],
      ['Department', user.department],
      ['Title', user.title],
      ['Status', user.status],
      ['MFA', user.mfa],
      ['Groups', groupNames],
      ['Password change required', user.mustChangePassword ? 'yes' : 'no'],
      ['Last sign-in', user.lastSignInAt ? new Date(user.lastSignInAt).toLocaleString() : 'never'],
    ];
    const card = el('div', 'background:#1a1d22;border:1px solid #2d343d;border-radius:6px;padding:14px;');
    for (const [k, v] of rows) {
      const row = el(
        'div',
        'display:flex;justify-content:space-between;gap:12px;padding:5px 0;' +
          'border-bottom:1px solid #2d343d;font-size:11.5px;',
      );
      row.append(el('span', 'color:#8b95a1;', k), el('span', 'color:#e6e6e6;', v));
      card.appendChild(row);
    }
    parent.appendChild(card);
  }

  function mkTile(icon: string, label: string, onClick: () => void): HTMLElement {
    const tile = document.createElement('button');
    tile.style.cssText =
      'display:flex;flex-direction:column;align-items:center;gap:8px;background:#1a1d22;' +
      'border:1px solid #2d343d;border-radius:6px;padding:16px 8px;cursor:pointer;color:#c8cdd3;';
    tile.append(el('div', 'font-size:26px;', icon), el('div', 'font-size:11px;', label));
    tile.addEventListener('click', onClick);
    return tile;
  }

  function mkButton(label: string, primary: boolean, onClick: () => void): HTMLElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = primary
      ? 'background:#2b5fb8;color:#fff;border:none;border-radius:4px;padding:7px 16px;' +
        'font-size:12px;cursor:pointer;'
      : 'background:transparent;color:#c8cdd3;border:1px solid #2d343d;border-radius:4px;' +
        'padding:7px 16px;font-size:12px;cursor:pointer;';
    b.addEventListener('click', onClick);
    return b;
  }

  render();
}
