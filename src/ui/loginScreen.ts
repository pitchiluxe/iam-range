/**
 * ui/loginScreen.ts — the lock screen and sign-in prompt.
 *
 * Two states, as Windows has: a lock screen showing the clock, which any key
 * or click dismisses, and the sign-in prompt behind it.
 *
 * The prompt talks to the real IdP, so the refusals are the real ones. Disable
 * an account in Active Directory and it cannot sign in here; lock one and it
 * is refused; reset a password with "must change at next logon" and the screen
 * asks for a new one before letting you through. That loop — change it in the
 * directory, watch it happen at the login screen — is the whole point.
 */
import type { User } from '@/domain';
import type { LoginSession } from '@/vm/loginSession';
import { VM_HOST } from '@/config/vmHost';
import { logonChime, errorBeep } from './sounds';

export interface LoginScreen {
  /** Show the lock screen; resolves once a user has signed in. */
  present(): void;
  destroy(): void;
}

const FONT = "'Segoe UI',-apple-system,BlinkMacSystemFont,sans-serif";

export function createLoginScreen(login: LoginSession, onSignedIn: () => void): LoginScreen {
  let overlay: HTMLElement | null = null;
  let locked = true;
  let selected: User | null = null;
  /** Set when the account must choose a new password before it can proceed. */
  let mustChangeFor: string | null = null;

  function build(): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;' +
      // The account strip is absolutely positioned, so it takes no part in
      // this centring — the panel sits in the middle of the screen, as it
      // does in Windows, rather than in the space above the strip.
      'justify-content:center;overflow:hidden;' +
      // A calm gradient rather than a photo: no third-party image to ship.
      'background:linear-gradient(150deg,#0b3a5e 0%,#123f63 40%,#0e2438 100%);' +
      `font-family:${FONT};color:#fff;`;
    return el;
  }

  function renderLock(): void {
    if (!overlay) return;
    overlay.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.style.cssText =
      'position:absolute;left:0;right:0;bottom:22%;text-align:center;user-select:none;';

    const time = document.createElement('div');
    time.style.cssText = 'font-size:76px;font-weight:200;letter-spacing:-2px;line-height:1;';
    const date = document.createElement('div');
    date.style.cssText = 'font-size:19px;font-weight:300;margin-top:6px;opacity:0.92;';

    const tick = (): void => {
      const now = new Date();
      time.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      date.textContent = now.toLocaleDateString([], {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });
    };
    tick();
    const timer = window.setInterval(() => {
      if (!document.contains(time)) {
        clearInterval(timer);
        return;
      }
      tick();
    }, 1000);

    const hint = document.createElement('div');
    hint.textContent = 'Press any key or click to sign in';
    hint.style.cssText = 'margin-top:26px;font-size:13px;opacity:0.6;';

    wrap.append(time, date, hint);
    overlay.appendChild(wrap);

    const unlock = (): void => {
      locked = false;
      renderSignIn();
    };
    overlay.addEventListener('click', unlock, { once: true });
    const keyUnlock = (): void => {
      document.removeEventListener('keydown', keyUnlock);
      if (locked) unlock();
    };
    document.addEventListener('keydown', keyUnlock);
  }

  function renderSignIn(): void {
    if (!overlay) return;
    overlay.innerHTML = '';

    const panel = document.createElement('div');
    // Lifted slightly above true centre, which is where Windows puts it.
    panel.style.cssText =
      'text-align:center;width:340px;position:relative;top:-6vh;';

    // Avatar
    const avatar = document.createElement('div');
    avatar.textContent = selected ? selected.displayName.slice(0, 1).toUpperCase() : '👤';
    avatar.style.cssText =
      'width:104px;height:104px;border-radius:50%;margin:0 auto 16px;' +
      'background:rgba(255,255,255,0.16);display:flex;align-items:center;' +
      'justify-content:center;font-size:42px;font-weight:300;border:1px solid rgba(255,255,255,0.2);';

    const name = document.createElement('div');
    name.textContent = selected ? selected.displayName : 'Sign in';
    name.style.cssText = 'font-size:22px;font-weight:400;margin-bottom:4px;';

    const upn = document.createElement('div');
    upn.textContent = selected ? `${selected.username}@${VM_HOST.domain}` : VM_HOST.domain;
    upn.style.cssText = 'font-size:12px;opacity:0.7;margin-bottom:18px;';

    panel.append(avatar, name, upn);

    const message = document.createElement('div');
    message.style.cssText =
      'min-height:34px;font-size:12.5px;color:#ffd0d0;margin-bottom:6px;line-height:1.5;';

    const input = document.createElement('input');
    input.type = 'password';
    input.placeholder = mustChangeFor ? 'New password' : 'Password';
    input.style.cssText =
      'width:100%;box-sizing:border-box;padding:9px 12px;border-radius:4px;font-size:13px;' +
      'background:rgba(255,255,255,0.14);border:1px solid rgba(255,255,255,0.3);color:#fff;' +
      `outline:none;font-family:${FONT};`;

    const go = document.createElement('button');
    go.textContent = mustChangeFor ? 'Set password and sign in' : 'Sign in';
    go.style.cssText =
      'width:100%;margin-top:10px;padding:9px;border-radius:4px;border:none;cursor:pointer;' +
      `background:#0e639c;color:#fff;font-size:13px;font-weight:600;font-family:${FONT};`;

    const submit = (): void => {
      if (!selected) {
        message.textContent = 'Choose an account first.';
        return;
      }

      // Clearing a forced change: the old password is the temporary one the
      // administrator set, which the account still knows.
      if (mustChangeFor) {
        const changed = login.changePassword(
          selected.username,
          `${selected.username}123`,
          input.value,
        );
        if (!changed) {
          message.textContent =
            'Could not set that password. The temporary password may have changed.';
          errorBeep();
          return;
        }
        mustChangeFor = null;
        const after = login.signIn(selected.username, input.value);
        if (after.ok) return finish();
        message.textContent = after.message;
        errorBeep();
        return;
      }

      const result = login.signIn(selected.username, input.value);
      if (result.ok) return finish();

      message.textContent = result.message;
      errorBeep();
      if (result.reason === 'must-change-password') {
        mustChangeFor = selected.username;
        renderSignIn();
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    go.addEventListener('click', submit);

    panel.append(message, input, go);

    if (mustChangeFor) {
      const note = document.createElement('div');
      note.textContent =
        'An administrator reset this password. Choose a new one to continue.';
      note.style.cssText = 'font-size:11.5px;opacity:0.75;margin-top:10px;line-height:1.5;';
      panel.appendChild(note);
    } else {
      const hint = document.createElement('div');
      hint.textContent = 'Passwords follow the pattern username123.';
      hint.style.cssText = 'font-size:11px;opacity:0.5;margin-top:12px;';
      panel.appendChild(hint);
    }

    overlay.appendChild(panel);
    overlay.appendChild(buildAccountList());
    setTimeout(() => input.focus(), 30);
  }

  /** The other-users strip along the bottom-left, as Windows shows. */
  function buildAccountList(): HTMLElement {
    const bar = document.createElement('div');
    bar.style.cssText =
      'position:absolute;left:0;right:0;bottom:0;padding:14px 18px;display:flex;' +
      'gap:8px;flex-wrap:wrap;align-items:flex-end;background:rgba(0,0,0,0.18);' +
      'max-height:38%;overflow:auto;';

    for (const u of login.listAccounts()) {
      const chip = document.createElement('button');
      const isSel = selected?.id === u.id;
      chip.style.cssText =
        'display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:4px;' +
        'cursor:pointer;font-size:12px;text-align:left;' +
        `font-family:${FONT};` +
        (isSel
          ? 'background:rgba(255,255,255,0.24);border:1px solid rgba(255,255,255,0.4);color:#fff;'
          : 'background:rgba(255,255,255,0.08);border:1px solid transparent;color:#e8e8e8;');

      const dot = document.createElement('span');
      dot.textContent = u.displayName.slice(0, 1).toUpperCase();
      dot.style.cssText =
        'width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,0.2);' +
        'display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;';

      const text = document.createElement('span');
      const label = document.createElement('div');
      label.textContent = u.displayName;
      const sub = document.createElement('div');
      // Say plainly when an account will refuse — the point is to see the
      // consequence of what you did in Active Directory.
      sub.textContent =
        u.status === 'active' ? u.department : `${u.department} · ${u.status}`;
      sub.style.cssText = `font-size:10.5px;opacity:${u.status === 'active' ? '0.65' : '0.9'};${
        u.status === 'active' ? '' : 'color:#ffb4b4;'
      }`;
      text.append(label, sub);

      chip.append(dot, text);
      chip.addEventListener('click', () => {
        selected = u;
        mustChangeFor = null;
        renderSignIn();
      });
      bar.appendChild(chip);
    }
    return bar;
  }

  function finish(): void {
    logonChime();
    destroy();
    onSignedIn();
  }

  function destroy(): void {
    overlay?.remove();
    overlay = null;
  }

  return {
    present(): void {
      destroy();
      locked = true;
      mustChangeFor = null;
      overlay = build();
      document.body.appendChild(overlay);
      renderLock();
    },
    destroy,
  };
}
