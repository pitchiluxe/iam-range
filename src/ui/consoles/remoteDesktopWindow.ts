/**
 * ui/consoles/remoteDesktopWindow.ts — "Remote Desktop Connection" (RDP) app.
 *
 * IT/Help Desk only. Two jobs, the two reasons a service desk opens mstsc:
 *
 *   Help a user. Connect to a staff member's computer (WKS-<USERNAME>) with
 *   your OWN admin credentials, and land on their desktop to fix what the
 *   ticket describes — their printer, their Outlook, their Wi-Fi. A real desk
 *   never knows the user's password, so it is never asked for.
 *
 *   Verify a sign-in. Sign in to a test workstation AS a directory account, to
 *   prove it works without giving up your own session. Real idp.signIn() and
 *   completeMfa() calls, so a disabled or locked account is refused for the
 *   real reason and a forced password change behaves exactly as it does at the
 *   real login screen.
 *
 * Either way the session is a full Windows desktop — see
 * remoteSessionDesktop.ts. A help-desk ticket's "Connect" button opens this
 * window already pointed at the right computer (util/remoteTarget.ts).
 */
import type { VmServices } from '@/vm/session';
import type { SessionId, User, UserId } from '@/domain';
import { ENDPOINT_TICKET_KINDS } from '@/domain';
import { MESSAGES, login } from '@/vm/loginSession';
import { VM_HOST } from '@/config/vmHost';
import { onRemoteTarget, takePendingRemoteTarget } from '@/util/remoteTarget';
import {
  renderRemoteSession,
  type RemoteAppEntry,
  type SessionEnd,
} from './remoteSessionDesktop';

const STATIC_IP = '10.20.4.50';
const STATIC_HOST = 'ONBOARD-WKS01';

type Screen = 'connect' | 'credentials' | 'signin' | 'force-change' | 'session' | 'ended';
type Mode = 'help' | 'verify';

/** The window controls Remote Desktop needs from whoever hosts it. */
export interface RemoteWindowFrame {
  close(): void;
  minimize(): void;
  setFullscreen(on: boolean): void;
}

const windowCommand = (action: 'minimize' | 'fullscreen-on' | 'fullscreen-off'): void => {
  document.dispatchEvent(
    new CustomEvent('apex-window-command', { detail: { id: 'remote-desktop', action } }),
  );
};

/** Hosted directly on the workstation: the overlay's window manager answers. */
const WORKSTATION_FRAME: RemoteWindowFrame = {
  close: () =>
    document.dispatchEvent(new CustomEvent('apex-close-window', { detail: { id: 'remote-desktop' } })),
  minimize: () => windowCommand('minimize'),
  setFullscreen: (on) => windowCommand(on ? 'fullscreen-on' : 'fullscreen-off'),
};

const isStaff = (u: User): boolean => u.username !== 'admin' && !u.username.startsWith('svc-');

/**
 * @param catalog The workstation's app table. Passed in rather than imported
 *   because desktopOverlay.ts, which owns it, imports this file.
 */
export function renderRemoteDesktopWindow(
  body: HTMLElement,
  services: VmServices,
  catalog: readonly RemoteAppEntry[] = [],
  /** This window's own controls. Default: ask the workstation's window
   *  manager; a Remote Desktop hosted inside another session passes its own. */
  frame: RemoteWindowFrame = WORKSTATION_FRAME,
): void {
  let fullscreen = false;
  const setFullscreen = (on: boolean): void => {
    fullscreen = on;
    frame.setFullscreen(on);
  };
  body.innerHTML = '';
  Object.assign(body.style, { overflow: 'hidden', background: '#0e1116', flex: '1', minHeight: '0' });

  const root = document.createElement('div');
  root.style.cssText =
    'display:flex;flex-direction:column;height:100%;min-height:0;font-size:12px;color:#c8cdd3;' +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";
  body.appendChild(root);

  let screen: Screen = 'connect';
  let mode: Mode = 'help';
  /** Help mode: the computer being connected to. */
  let targetComputer = '';
  /** Verify mode: the account being signed in as. */
  let selectedUsername = '';
  let typedPassword = '';
  let sessionUser: User | null = null;
  /** The IdP session behind this connection: the account's in verify mode,
   *  the operator's own in help mode. */
  let sessionId: SessionId | null = null;
  let sessionOwner: UserId | null = null;
  /** Who and where the last session was, and how it ended, for the ended screen. */
  let ended: { how: SessionEnd; username: string; host: string; mode: Mode } | null = null;
  let error = '';

  // A ticket's Connect button may have opened this window.
  const pending = takePendingRemoteTarget();
  if (pending) pointAt(pending);
  const stopListening = onRemoteTarget((computer) => {
    if (!root.isConnected) {
      stopListening();
      return;
    }
    // Never tear down a live session because another ticket was clicked.
    if (screen === 'session') return;
    pointAt(computer);
    render();
  });

  function pointAt(computer: string): void {
    mode = 'help';
    targetComputer = computer.toUpperCase();
    error = '';
    screen = 'credentials';
  }

  const el = (tag: string, css: string, text?: string): HTMLElement => {
    const e = document.createElement(tag);
    e.style.cssText = css;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  const inputCss =
    'background:#1a1d22;color:#e6e6e6;border:1px solid #2d343d;border-radius:4px;' +
    'padding:6px 8px;font-size:12px;outline:none;';

  function render(): void {
    root.innerHTML = '';
    // Full screen belongs to a connected session. Every other screen needs the
    // title bar and taskbar back, or there would be no way out of it.
    if (screen !== 'session' && fullscreen) setFullscreen(false);
    if (screen === 'connect') renderConnect();
    else if (screen === 'credentials') renderCredentials();
    else if (screen === 'signin') renderSignIn();
    else if (screen === 'force-change') renderForceChange();
    else if (screen === 'ended') renderEnded();
    else renderSession();
  }

  /** Open help-desk tickets per computer, for the picker. */
  function openTicketsByComputer(): Map<string, number> {
    const kinds: readonly string[] = ENDPOINT_TICKET_KINDS;
    const counts = new Map<string, number>();
    for (const t of services.tickets.list()) {
      if (t.status === 'resolved' || !kinds.includes(t.kind)) continue;
      const c = (t.payload as { computer?: string }).computer?.toUpperCase();
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return counts;
  }

  // ── Screen 1: connect ──────────────────────────────────────────────────────
  function renderConnect(): void {
    const wrap = el('div', 'flex:1;overflow:auto;display:flex;justify-content:center;padding:28px 16px;');
    const column = el('div', 'width:min(460px,100%);display:flex;flex-direction:column;gap:16px;');
    wrap.appendChild(column);

    const head = el('div', 'display:flex;align-items:center;gap:12px;');
    head.append(
      el('div', 'font-size:30px;', '🖥️'),
      el('div', 'font-size:15px;color:#e6e6e6;font-weight:600;', 'Remote Desktop Connection'),
    );
    column.appendChild(head);

    // Help a user.
    const help = el('div', 'background:#161a20;border:1px solid #2d343d;border-radius:8px;padding:14px;display:flex;flex-direction:column;gap:10px;');
    help.append(
      el('div', 'font-size:13px;color:#e6e6e6;font-weight:600;', 'Help a user — connect to their computer'),
      el('div', 'font-size:11.5px;color:#8b95a1;line-height:1.5;', 'Sign in with your own admin account and work on their desktop. Computers with open help-desk tickets are listed first.'),
    );
    const staff = services.dir.listUsers().filter(isStaff);
    const computers = staff
      .map((u) => services.endpoints.ensureFor(u.id))
      .filter((e): e is NonNullable<typeof e> => Boolean(e));
    const open = openTicketsByComputer();
    computers.sort((a, b) => (open.get(b.name) ?? 0) - (open.get(a.name) ?? 0) || a.name.localeCompare(b.name));

    if (computers.length === 0) {
      help.appendChild(
        el('div', 'font-size:11.5px;color:#d7ba7d;line-height:1.5;', 'No staff computers yet. Each person you onboard gets one (WKS-<USERNAME>).'),
      );
    } else {
      help.appendChild(el('div', 'font-size:11px;color:#8b95a1;', 'Computer:'));
      const picker = document.createElement('select');
      picker.style.cssText = inputCss;
      for (const c of computers) {
        const n = open.get(c.name) ?? 0;
        picker.appendChild(new Option(`${c.name} — ${c.username}${n ? `  🎫 ${n} open ticket${n > 1 ? 's' : ''}` : ''}`, c.name));
      }
      picker.value = computers.some((c) => c.name === targetComputer) ? targetComputer : computers[0]!.name;
      help.appendChild(picker);
      const row = el('div', 'display:flex;gap:10px;');
      row.appendChild(mkButton('Connect', true, () => {
        pointAt(picker.value);
        render();
      }));
      help.appendChild(row);
    }
    column.appendChild(help);

    // Verify a sign-in.
    const verify = el('div', 'background:#161a20;border:1px solid #2d343d;border-radius:8px;padding:14px;display:flex;flex-direction:column;gap:10px;');
    verify.append(
      el('div', 'font-size:13px;color:#e6e6e6;font-weight:600;', 'Verify a sign-in — test an account'),
      el('div', 'font-size:11.5px;color:#8b95a1;line-height:1.5;', `Sign in AS a directory account on ${STATIC_HOST} (${STATIC_IP}) to prove it works, without signing out of your own session.`),
    );
    const vrow = el('div', 'display:flex;gap:10px;');
    vrow.appendChild(mkButton(`Connect to ${STATIC_HOST}`, false, () => {
      mode = 'verify';
      screen = 'signin';
      error = '';
      render();
    }));
    verify.appendChild(vrow);
    column.appendChild(verify);

    root.appendChild(wrap);
  }

  // ── Screen 2a: your credentials, for a user's computer ────────────────────
  function renderCredentials(): void {
    const endpoint = services.endpoints.get(targetComputer);
    const operator = login.user;
    const wrap = el('div', 'flex:1;display:flex;align-items:center;justify-content:center;padding:16px;');
    const dialog = el('div', 'width:min(380px,100%);background:#fff;color:#1b1b1b;border-radius:8px;overflow:hidden;box-shadow:0 16px 40px rgba(0,0,0,0.5);font-family:"Segoe UI",sans-serif;color-scheme:light;');
    dialog.appendChild(el('div', 'padding:9px 14px;background:#f3f3f3;font-size:12px;', 'Windows Security'));
    const content = el('div', 'padding:16px 18px;display:flex;flex-direction:column;gap:10px;');
    dialog.appendChild(content);

    if (!endpoint) {
      content.append(
        el('div', 'font-size:13px;font-weight:600;', 'Remote Desktop can\'t connect to the remote computer'),
        el('div', 'font-size:12px;color:#444;line-height:1.5;', `No computer named ${targetComputer} was found on the network. Check the name in the ticket.`),
      );
      const row = el('div', 'display:flex;justify-content:flex-end;');
      row.appendChild(lightButton('OK', true, () => { screen = 'connect'; render(); }));
      content.appendChild(row);
      wrap.appendChild(dialog);
      root.appendChild(wrap);
      return;
    }

    content.append(
      el('div', 'font-size:14px;font-weight:600;', 'Enter your credentials'),
      el('div', 'font-size:12px;color:#444;', `These credentials will be used to connect to ${endpoint.name} (${endpoint.username}'s computer).`),
    );
    const account = document.createElement('input');
    account.value = operator ? `${VM_HOST.netbiosDomain}\\${operator.username}` : '';
    account.readOnly = true;
    account.style.cssText = 'padding:7px 9px;border:1px solid #8a8a8a;border-radius:4px;font-size:12px;background:#f5f5f5;color:#1b1b1b;';
    const pw = document.createElement('input');
    pw.type = 'password';
    pw.placeholder = 'Password';
    pw.style.cssText = 'padding:7px 9px;border:1px solid #8a8a8a;border-radius:4px;font-size:12px;color:#1b1b1b;';
    const connect = (): void => {
      if (!operator) {
        error = 'You are not signed in to this workstation.';
        render();
        return;
      }
      const result = services.idp.signIn(operator.username, pw.value);
      if (!result.ok) {
        error =
          result.reason === 'must-change-password'
            ? 'Your own password has expired. Change it at the lock screen first.'
            : (MESSAGES[result.reason as keyof typeof MESSAGES] ?? MESSAGES.unknown);
        render();
        return;
      }
      if (result.user.mfa !== 'none') services.idp.completeMfa(result.session.id, result.user.mfa);
      sessionId = result.session.id;
      sessionOwner = result.user.id;
      sessionUser = services.dir.getUser(endpoint.userId) ?? null;
      services.audit.record({
        actorId: result.user.id,
        action: 'rdp.connected',
        targetId: endpoint.name,
        note: `${operator.username} connected to ${endpoint.name} (${endpoint.username}'s computer).`,
      });
      error = '';
      screen = 'session';
      render();
    };
    pw.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') connect();
    });
    content.append(account, pw);
    if (error) content.appendChild(el('div', 'font-size:11.5px;color:#a4262c;line-height:1.5;', error));
    const row = el('div', 'display:flex;justify-content:flex-end;gap:8px;margin-top:4px;');
    row.append(
      lightButton('Cancel', false, () => { screen = 'connect'; error = ''; render(); }),
      lightButton('OK', true, connect),
    );
    content.appendChild(row);
    wrap.appendChild(dialog);
    root.appendChild(wrap);
    pw.focus();
  }

  // ── Screen 2b: sign in as an account (verify mode) ────────────────────────
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
    picker.style.cssText = inputCss;
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
    pwInput.style.cssText = inputCss;
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
    sessionId = result.session.id;
    sessionOwner = result.user.id;
    typedPassword = '';
    error = '';
    screen = 'session';
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
    p1.style.cssText = inputCss;
    form.appendChild(p1);

    form.appendChild(el('div', 'font-size:11px;color:#8b95a1;', 'Confirm new password:'));
    const p2 = document.createElement('input');
    p2.type = 'password';
    p2.style.cssText = inputCss;
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

  // ── Screen 4: the session ─────────────────────────────────────────────────
  function renderSession(): void {
    const user = sessionUser ? (services.dir.getUser(sessionUser.id) ?? sessionUser) : null;
    const endpoint = mode === 'help' ? services.endpoints.get(targetComputer) : undefined;
    if (!user || (mode === 'help' && !endpoint)) {
      screen = 'connect';
      render();
      return;
    }
    const host = endpoint?.name ?? STATIC_HOST;

    renderRemoteSession(root, {
      services,
      user,
      host,
      ip: endpoint?.network.ipv4 ?? STATIC_IP,
      ...(endpoint ? { endpoint: endpoint.name } : {}),
      ...(mode === 'help' && login.user
        ? { operator: `${VM_HOST.netbiosDomain}\\${login.user.username}` }
        : {}),
      catalog,
      isFullscreen: () => fullscreen,
      onFullscreen: setFullscreen,
      onMinimize: () => frame.minimize(),
      onEnd: (how) => {
        // Disconnecting an RDP window leaves the session signed in on the
        // server; signing out is what ends it, and what the audit log records.
        if (how === 'signout' && sessionId && sessionOwner) services.idp.signOut(sessionId, sessionOwner);
        if (mode === 'help' && sessionOwner) {
          services.audit.record({
            actorId: sessionOwner,
            action: 'rdp.disconnected',
            targetId: host,
            note: how === 'signout' ? `Signed out of ${host}.` : `Disconnected from ${host}.`,
          });
        }
        ended = { how, username: user.username, host, mode };
        screen = 'ended';
        sessionUser = null;
        sessionId = null;
        sessionOwner = null;
        selectedUsername = '';
        render();
      },
    });
  }

  // ── Screen 5: session ended ───────────────────────────────────────────────
  // Where mstsc tells you the remote session is over. Close is the way back to
  // the lab: it closes this window, leaving the operator's own desktop as it was.
  function renderEnded(): void {
    const info = ended ?? { how: 'signout' as const, username: '', host: STATIC_HOST, mode: 'verify' as const };
    const wrap = el(
      'div',
      'flex:1;display:flex;align-items:center;justify-content:center;background:#0e1116;padding:16px;',
    );
    const dialog = el(
      'div',
      'width:min(400px,100%);background:#fff;color:#1b1b1b;border-radius:8px;overflow:hidden;' +
        'box-shadow:0 16px 40px rgba(0,0,0,0.5);font-family:"Segoe UI",sans-serif;',
    );
    dialog.appendChild(
      el('div', 'padding:9px 14px;background:#f3f3f3;font-size:12px;', 'Remote Desktop Connection'),
    );
    const content = el('div', 'display:flex;gap:14px;padding:18px 18px 8px;');
    content.appendChild(el('div', 'font-size:30px;line-height:1;', info.how === 'signout' ? '✅' : 'ℹ️'));
    const text = el('div', 'display:flex;flex-direction:column;gap:6px;line-height:1.5;');
    const headline = info.how === 'signout' ? 'Your remote session has ended.' : 'Your remote session was disconnected.';
    const detail =
      info.mode === 'help'
        ? info.how === 'signout'
          ? `You signed out of ${info.host}. Add a work note to the ticket, then resolve it from the Ticket Queue — the review checks ${info.username}'s computer.`
          : `You disconnected from ${info.host}. Your session there is still open. Resolve the ticket from the Ticket Queue once the work is done.`
        : info.how === 'signout'
          ? `${info.username} was signed out of ${info.host}. The sign-in session is closed and recorded in the audit log.`
          : `${info.username} is still signed in on ${info.host}. Reconnect and choose Sign out to end the session.`;
    text.append(el('div', 'font-size:13px;font-weight:600;', headline), el('div', 'font-size:12px;color:#444;', detail));
    content.appendChild(text);
    dialog.appendChild(content);

    const row = el('div', 'display:flex;justify-content:flex-end;gap:8px;padding:12px 18px 16px;');
    row.appendChild(
      lightButton('Reconnect', false, () => {
        if (info.mode === 'help') pointAt(info.host);
        else screen = 'connect';
        ended = null;
        render();
      }),
    );
    const close = lightButton('Close', true, () => frame.close());
    row.appendChild(close);
    dialog.appendChild(row);

    wrap.appendChild(dialog);
    root.appendChild(wrap);
    close.focus();
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

  /** A button for the white Windows dialogs. */
  function lightButton(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = primary
      ? 'background:#005fb8;color:#fff;border:none;border-radius:4px;padding:6px 20px;font-size:12px;cursor:pointer;'
      : 'background:#fff;color:#1b1b1b;border:1px solid #d0d0d0;border-radius:4px;padding:6px 16px;font-size:12px;cursor:pointer;';
    b.addEventListener('click', onClick);
    return b;
  }

  render();
}
