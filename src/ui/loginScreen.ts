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
import { SEED_ADMINS } from '@/config';
import { currentLockScreen } from '@/util/wallpapers';
import { PRODUCT } from '@/config/product';
// The sign-in screen is rebuilt on every present(), so it reads the current
// picture without needing to subscribe to changes.
import { paintAvatar } from '@/util/profilePictures';

/** Shown on the sign-in panel for the built-in account. Read from the seed so
 *  the screen cannot drift from the credential that actually works. */
const BUILTIN_ADMIN_PASSWORD = SEED_ADMINS[0]?.password ?? '';

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
  /**
   * The temporary password the user typed at the sign-in that came back
   * "must change".
   *
   * That attempt authenticated — it was only refused pending a new password —
   * so what they typed is the account's current credential, and clearing the
   * forced change needs it. This used to be guessed as `<username>123`, which
   * was true only of the old seeded accounts; after an administrator reset in
   * ADUC it never matched, and the account could not get past the change
   * prompt at all.
   */
  let temporaryPassword: string | null = null;

  function build(): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;' +
      // The account strip is absolutely positioned, so it takes no part in
      // this centring — the panel sits in the middle of the screen, as it
      // does in Windows, rather than in the space above the strip.
      'justify-content:center;overflow:hidden;' +
      // Gradients rather than photographs: nothing third-party to ship, and
      // the choice is the learner's, made in Settings.
      `background:${currentLockScreen()};` +
      `font-family:${FONT};color:#fff;`;
    return el;
  }

  function renderLock(): void {
    if (!overlay) return;
    overlay.innerHTML = '';

    const wrap = document.createElement('div');
    // Centred, not pinned near the bottom. The overlay is a flex container
    // that already centres its child, so the clock sits in the middle of the
    // screen the way Windows puts it rather than a fifth of the way up.
    wrap.style.cssText = 'text-align:center;user-select:none;';

    const time = document.createElement('div');
    time.style.cssText = 'font-size:68px;font-weight:200;letter-spacing:-1px;line-height:1;';
    const date = document.createElement('div');
    date.style.cssText = 'font-size:19px;font-weight:300;margin-top:6px;opacity:0.92;';

    const tick = (): void => {
      const now = new Date();
      // Seconds included, so the clock is visibly live rather than a
      // screenshot of a time.
      time.textContent = now.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
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

    // The product name sits top-left and the author bottom-right, the way an
    // OEM build of Windows carries both. It is the first thing anyone sees,
    // and on a workstation that ships to other people it should say what it
    // is and who made it.
    const brand = document.createElement('div');
    brand.textContent = PRODUCT.name;
    brand.style.cssText =
      'position:absolute;top:26px;left:30px;font-size:15px;font-weight:600;' +
      'letter-spacing:0.3px;opacity:0.9;';

    const author = document.createElement('div');
    author.textContent = `Created by ${PRODUCT.publisher}`;
    author.style.cssText =
      'position:absolute;bottom:22px;right:28px;font-size:11.5px;opacity:0.55;';

    overlay.append(brand, author);
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

    // On a fresh install there is exactly one account. Windows selects it for
    // you, and leaving it unselected here meant typing the administrator's
    // password and being told to choose an account — with only one to choose.
    if (!selected) {
      const accounts = login.listAccounts();
      if (accounts.length === 1) selected = accounts[0] ?? null;
    }

    const panel = document.createElement('div');
    // Lifted slightly above true centre, which is where Windows puts it.
    panel.style.cssText =
      'text-align:center;width:340px;position:relative;top:-6vh;';

    // Avatar
    const avatar = document.createElement('div');
    avatar.style.cssText =
      'width:104px;height:104px;border-radius:50%;margin:0 auto 16px;' +
      'background:rgba(255,255,255,0.16);display:flex;align-items:center;' +
      'justify-content:center;font-size:42px;font-weight:300;overflow:hidden;' +
      'border:1px solid rgba(255,255,255,0.2);';
    // Their photograph if they have set one, their initial if not — the same
    // rule Windows uses, for the same reason: a face confirms who you are
    // about to sign in as faster than a letter does.
    if (selected) paintAvatar(avatar, selected.username, selected.displayName);
    else avatar.textContent = '👤';

    const name = document.createElement('div');
    name.textContent = selected ? selected.displayName : 'Sign in';
    name.style.cssText = 'font-size:22px;font-weight:400;margin-bottom:4px;';

    const upn = document.createElement('div');
    upn.textContent = selected ? `${selected.username}@${VM_HOST.domain}` : VM_HOST.domain;
    upn.style.cssText = 'font-size:12px;opacity:0.7;margin-bottom:18px;';

    panel.append(avatar, name, upn);
    panel.appendChild(buildAccountPicker());

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
          temporaryPassword ?? '',
          input.value,
        );
        if (!changed) {
          message.textContent =
            'Could not set that password. The temporary password may have changed.';
          errorBeep();
          return;
        }
        mustChangeFor = null;
        temporaryPassword = null;
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
        // Authentication succeeded; only the forced change refused it. Keep
        // the credential so the change can be made without asking for it again.
        temporaryPassword = input.value;
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
      // The old text promised every password was `<username>123`. That was
      // true of the seeded accounts that no longer exist: the directory now
      // starts empty, and every account in it was given a password by whoever
      // created it. Only the built-in administrator has a documented default.
      hint.textContent =
        selected && selected.username === 'admin'
          ? `Built-in administrator. Default password: ${BUILTIN_ADMIN_PASSWORD}`
          : 'Use the password set for this account in Active Directory.';
      hint.style.cssText = 'font-size:11px;opacity:0.5;margin-top:12px;';
      panel.appendChild(hint);
    }

    overlay.appendChild(panel);
    setTimeout(() => input.focus(), 30);
  }

  /**
   * The account picker.
   *
   * A dropdown rather than the strip that used to run along the bottom of the
   * screen. The strip was fine with three accounts; this workstation is meant
   * to be staffed by the learner, and twenty of them became a scrolling band
   * across the bottom third of the display. This also puts the choice next to
   * the password field rather than a screen away from it.
   */
  function buildAccountPicker(): HTMLElement {
    const accounts = login.listAccounts();

    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;margin-bottom:12px;text-align:left;';

    const toggle = document.createElement('button');
    toggle.style.cssText =
      'width:100%;display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:4px;' +
      'background:rgba(255,255,255,0.14);border:1px solid rgba(255,255,255,0.3);color:#fff;' +
      `cursor:pointer;font-size:12.5px;font-family:${FONT};text-align:left;`;

    const toggleAvatar = document.createElement('span');
    toggleAvatar.style.cssText =
      'width:24px;height:24px;border-radius:50%;background:rgba(255,255,255,0.2);flex-shrink:0;' +
      'display:flex;align-items:center;justify-content:center;font-size:11px;overflow:hidden;';

    const toggleLabel = document.createElement('span');
    toggleLabel.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

    const caret = document.createElement('span');
    caret.textContent = '\u25BE';
    caret.style.cssText = 'flex-shrink:0;opacity:0.7;font-size:10px;';

    toggle.append(toggleAvatar, toggleLabel, caret);

    if (selected) {
      paintAvatar(toggleAvatar, selected.username, selected.displayName);
      toggleLabel.textContent = `${selected.displayName} · ${selected.department}`;
    } else {
      toggleAvatar.textContent = '\u{1F464}';
      toggleLabel.textContent =
        accounts.length === 0 ? 'No accounts in the directory' : 'Choose an account';
    }

    const list = document.createElement('div');
    list.hidden = true;
    list.style.cssText =
      'position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:5;max-height:240px;' +
      'overflow-y:auto;border-radius:4px;background:rgba(16,26,38,0.97);' +
      'border:1px solid rgba(255,255,255,0.22);box-shadow:0 8px 28px rgba(0,0,0,0.5);';

    for (const u of accounts) {
      const row = document.createElement('button');
      row.style.cssText =
        'display:flex;align-items:center;gap:9px;width:100%;padding:7px 10px;border:none;' +
        `cursor:pointer;text-align:left;font-family:${FONT};font-size:12px;` +
        'background:transparent;color:#e8e8e8;';
      row.addEventListener('mouseenter', () => {
        row.style.background = 'rgba(255,255,255,0.12)';
      });
      row.addEventListener('mouseleave', () => {
        row.style.background = 'transparent';
      });

      const pic = document.createElement('span');
      pic.style.cssText =
        'width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,0.18);' +
        'display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;' +
        'overflow:hidden;';
      paintAvatar(pic, u.username, u.displayName);

      const text = document.createElement('span');
      text.style.cssText = 'min-width:0;';
      const name = document.createElement('div');
      name.textContent = u.displayName;
      const sub = document.createElement('div');
      // Say plainly when an account will refuse. Seeing "locked" here, then
      // being refused, is the consequence of what you did in Active Directory.
      sub.textContent = u.status === 'active' ? u.department : `${u.department} \u00b7 ${u.status}`;
      sub.style.cssText = `font-size:10.5px;opacity:${u.status === 'active' ? '0.6' : '0.95'};${
        u.status === 'active' ? '' : 'color:#ffb4b4;'
      }`;
      text.append(name, sub);

      row.append(pic, text);
      row.addEventListener('click', () => {
        selected = u;
        mustChangeFor = null;
        // Never carry one account's credential across to another.
        temporaryPassword = null;
        renderSignIn();
      });
      list.appendChild(row);
    }

    if (accounts.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'Create a user in Active Directory and they will appear here.';
      empty.style.cssText = 'padding:10px;font-size:11px;opacity:0.7;line-height:1.5;';
      list.appendChild(empty);
    }

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      list.hidden = !list.hidden;
    });
    // Clicking anywhere else closes it, as a dropdown should.
    overlay?.addEventListener('click', () => {
      list.hidden = true;
    });

    wrap.append(toggle, list);
    return wrap;
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
      temporaryPassword = null;
      selected = null;
      overlay = build();
      document.body.appendChild(overlay);
      renderLock();
    },
    destroy,
  };
}
