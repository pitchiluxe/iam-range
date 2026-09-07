/**
 * ui/consoles/settingsWindow.ts — VM Settings app (Windows 11 style).
 *
 * Sidebar of categories + a content pane. Only the Sound toggle has a real
 * effect (wired to ui/audio.ts's mute flag); the rest mirror real Settings
 * categories with plausible read-only info, consistent with how File
 * Explorer and Control Panel present fake-but-realistic system data.
 *
 * The "Updates" category shows real auto-update status from electron-updater
 * when running inside Electron, and gracefully degrades to a "Not available"
 * message in browser/dev mode.
 */
import { VM_ACCOUNT, VM_HOST } from '@/config/vmHost';
import { isMuted, setMuted, blip } from '@/ui/audio';
import { WALLPAPERS, WALLPAPER_STORAGE_KEY, DEFAULT_WALLPAPER_ID,
  LOCK_SCREENS,
  LOCK_SCREEN_STORAGE_KEY,
  DEFAULT_LOCK_SCREEN_ID,
} from '@/util/wallpapers';
import { updateManager, type UpdateStatus } from '@/util/updateManager';
import { tutorAvailable } from '@/vm/tutor';
import { openExternal, OLLAMA_DOWNLOAD_URL, OLLAMA_MODEL } from '@/util/externalLink';
import { PRODUCT } from '@/config/product';
import { login } from '@/vm/loginSession';
import { COMPANY } from '@/config';
import { isIdentityAdmin } from '@/config/desktopProfiles';
import {
  paintAvatar,
  getProfilePicture,
  setProfilePicture,
  clearProfilePicture,
  readImageAsAvatar,
} from '@/util/profilePictures';
import { THEMES, currentThemeId, setTheme } from '@/ui/themes';

const DENSITY_KEY = 'settings_density';

type CategoryId =
  | 'system'
  | 'personalization'
  | 'apps'
  | 'accounts'
  | 'sound'
  | 'assistant'
  | 'updates'
  | 'about';

interface Category {
  id: CategoryId;
  icon: string;
  label: string;
}

const CATEGORIES: Category[] = [
  { id: 'system', icon: '🖥️', label: 'System' },
  { id: 'personalization', icon: '🎨', label: 'Personalization' },
  { id: 'apps', icon: '📦', label: 'Apps' },
  { id: 'accounts', icon: '👤', label: 'Accounts' },
  { id: 'sound', icon: '🔊', label: 'Sound' },
  { id: 'assistant', icon: '🎓', label: 'AI Assistant' },
  { id: 'updates', icon: '🔄', label: 'Updates' },
  { id: 'about', icon: 'ℹ️', label: 'About' },
];

/** The Windows 11 System-page hero: device name, edition, and the machine icon. */
function deviceCard(): HTMLElement {
  const card = document.createElement('div');
  card.style.cssText =
    'display:flex;align-items:center;gap:14px;padding:16px;margin-bottom:18px;' +
    'background:var(--border);border:1px solid var(--border);border-radius:8px;';
  const icon = document.createElement('div');
  icon.textContent = '🖥️';
  icon.style.cssText = 'font-size:38px;line-height:1;';
  const text = document.createElement('div');
  const name = document.createElement('div');
  name.textContent = VM_HOST.name;
  name.style.cssText = 'font-size:15px;font-weight:600;color:var(--fg);';
  const sub = document.createElement('div');
  sub.textContent = `${VM_HOST.edition} · joined to ${VM_HOST.domain}`;
  sub.style.cssText = 'font-size:11.5px;color:var(--muted);margin-top:3px;';
  text.append(name, sub);
  card.append(icon, text);
  return card;
}

function toggleRow(
  label: string,
  description: string,
  checked: boolean,
  onChange: (v: boolean) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = `
    display:flex;align-items:center;justify-content:space-between;gap:12px;
    padding:14px 0;border-bottom:1px solid var(--border);
  `;
  const text = document.createElement('div');
  text.innerHTML = `<div style="font-size:13px;color:var(--fg);">${label}</div><div style="font-size:11px;color:var(--muted);margin-top:2px;">${description}</div>`;
  row.appendChild(text);

  const toggle = document.createElement('button');
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-checked', String(checked));
  let state = checked;
  const paint = () => {
    toggle.style.cssText = `
      width:40px;height:22px;border-radius:11px;border:none;cursor:pointer;flex-shrink:0;
      background:${state ? 'var(--accent)' : 'var(--border)'};position:relative;transition:background 0.15s;
    `;
    toggle.innerHTML = `<span style="position:absolute;top:2px;left:${state ? '20px' : '2px'};width:18px;height:18px;border-radius:50%;background:#fff;transition:left 0.15s;"></span>`;
  };
  paint();
  toggle.addEventListener('click', () => {
    state = !state;
    paint();
    onChange(state);
  });
  row.appendChild(toggle);
  return row;
}

function sectionTitle(text: string): HTMLElement {
  const h = document.createElement('h2');
  h.textContent = text;
  h.style.cssText = 'font-size:18px;color:var(--fg);margin:0 0 16px 0;font-weight:600;';
  return h;
}

function infoRow(label: string, value: string): string {
  return `
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;">
      <span style="color:var(--muted);">${label}</span><span style="color:var(--fg);">${value}</span>
    </div>
  `;
}

export function renderSettingsWindow(body: HTMLElement): void {
  body.style.cssText =
    'display:flex;height:100%;background:#161a20;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI Variable","Segoe UI",sans-serif;color:var(--fg);';

  const sidebar = document.createElement('div');
  sidebar.style.cssText =
    'width:200px;flex-shrink:0;background:#12151a;border-right:1px solid var(--border);padding:12px 0;overflow-y:auto;';
  body.appendChild(sidebar);

  const content = document.createElement('div');
  content.style.cssText = 'flex:1;padding:24px 28px;overflow-y:auto;';
  body.appendChild(content);

  let active: CategoryId = 'system';

  /** Text typed into the sidebar's "Find a setting" box. */
  let filter = '';

  function renderSidebar(): void {
    sidebar.innerHTML = '';

    // Windows 11 puts the signed-in account above the category list.
    const account = document.createElement('div');
    account.style.cssText = 'display:flex;align-items:center;gap:10px;padding:6px 16px 14px;';
    const avatar = document.createElement('div');
    avatar.textContent = VM_HOST.user.slice(0, 1).toUpperCase();
    avatar.style.cssText =
      'width:32px;height:32px;border-radius:50%;background:var(--accent);color:#06231d;' +
      'display:flex;align-items:center;justify-content:center;font-size:14px;' +
      'font-weight:700;flex-shrink:0;';
    const who = document.createElement('div');
    who.style.cssText = 'min-width:0;';
    const whoName = document.createElement('div');
    whoName.textContent = VM_HOST.displayName;
    whoName.style.cssText = 'font-size:12px;color:var(--fg);font-weight:600;';
    const whoMail = document.createElement('div');
    whoMail.textContent = VM_ACCOUNT;
    whoMail.style.cssText =
      'font-size:10.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    who.append(whoName, whoMail);
    account.append(avatar, who);
    sidebar.appendChild(account);

    // "Find a setting" — filters the category list, as Windows does.
    const searchWrap = document.createElement('div');
    searchWrap.style.cssText = 'padding:0 12px 12px;';
    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = 'Find a setting';
    search.value = filter;
    search.style.cssText =
      'width:100%;box-sizing:border-box;background:var(--panel);color:var(--fg);' +
      'border:1px solid var(--border);border-radius:4px;padding:5px 8px;font-size:11.5px;outline:none;';
    search.addEventListener('input', () => {
      filter = search.value;
      renderSidebar();
      // Keep the caret in the box across the re-render.
      const again = sidebar.querySelector<HTMLInputElement>('input[type=text]');
      again?.focus();
      again?.setSelectionRange(again.value.length, again.value.length);
    });
    searchWrap.appendChild(search);
    sidebar.appendChild(searchWrap);

    const shown = CATEGORIES.filter((c) =>
      c.label.toLowerCase().includes(filter.trim().toLowerCase()),
    );
    if (shown.length === 0) {
      const none = document.createElement('div');
      none.textContent = 'No matching settings';
      none.style.cssText = 'padding:8px 16px;font-size:11px;color:#6b7280;';
      sidebar.appendChild(none);
    }

    for (const cat of shown) {
      const btn = document.createElement('button');
      const isActive = cat.id === active;
      btn.style.cssText = `
        display:flex;align-items:center;gap:10px;width:calc(100% - 16px);
        margin:1px 8px;text-align:left;border-radius:4px;
        padding:8px 10px;border:none;cursor:pointer;font-size:12.5px;
        background:${isActive ? 'var(--border)' : 'transparent'};
        color:${isActive ? 'var(--fg)' : 'var(--fg)'};
        position:relative;
      `;
      if (isActive) {
        // Windows 11 marks the selected item with a short accent bar, not a
        // full-height border.
        const marker = document.createElement('span');
        marker.style.cssText =
          'position:absolute;left:0;top:50%;transform:translateY(-50%);width:3px;' +
          'height:16px;border-radius:2px;background:var(--accent);';
        btn.appendChild(marker);
      }
      const ico = document.createElement('span');
      ico.textContent = cat.icon;
      ico.style.cssText = 'font-size:15px;';
      const lbl = document.createElement('span');
      lbl.textContent = cat.label;
      btn.append(ico, lbl);
      btn.addEventListener('click', () => {
        active = cat.id;
        renderSidebar();
        renderContent();
      });
      sidebar.appendChild(btn);
    }
  }

  function renderContent(): void {
    content.innerHTML = '';

    if (active === 'system') {
      content.appendChild(sectionTitle('System'));
      // Windows 11 leads its System page with a device hero card.
      content.appendChild(deviceCard());
      const box = document.createElement('div');
      // Values come from config/vmHost.ts, the same source the terminal's
      // hostname/systeminfo read, so the two cannot disagree about this machine.
      box.innerHTML =
        infoRow('Device name', VM_HOST.name) +
        infoRow('Processor', VM_HOST.processor) +
        infoRow('Installed RAM', VM_HOST.ram) +
        infoRow('Edition', VM_HOST.edition) +
        infoRow('OS build', VM_HOST.osBuild) +
        infoRow('System type', VM_HOST.systemType) +
        infoRow('Domain', VM_HOST.domain);
      content.appendChild(box);
      content.appendChild(
        toggleRow(
          'Reduce motion',
          'Minimizes animations across the desktop (cosmetic preference).',
          localStorage.getItem('settings_reduce_motion') === 'true',
          (v) => {
            try {
              localStorage.setItem('settings_reduce_motion', String(v));
            } catch {
              /* ignore */
            }
          },
        ),
      );
      return;
    }

    if (active === 'personalization') {
      content.appendChild(sectionTitle('Personalization'));

      // Themes. This was a light/dark switch that set an attribute no
      // stylesheet responded to — the control looked like a feature and did
      // nothing. Choosing one here repaints the whole interface.
      const themeLabel = document.createElement('div');
      themeLabel.textContent = 'Theme';
      themeLabel.style.cssText =
        'font-size:12px;color:var(--muted);margin-bottom:10px;text-transform:uppercase;' +
        'letter-spacing:0.06em;';
      content.appendChild(themeLabel);

      const themeGrid = document.createElement('div');
      themeGrid.style.cssText =
        'display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px;' +
        'margin-bottom:24px;';
      const activeTheme = currentThemeId();

      for (const theme of THEMES) {
        const card = document.createElement('button');
        const isSel = theme.id === activeTheme;
        card.style.cssText =
          'display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:7px;' +
          'cursor:pointer;text-align:left;font-family:inherit;' +
          `background:${theme.tokens.panelAlt};` +
          `border:2px solid ${isSel ? theme.tokens.accent : 'transparent'};` +
          `color:${theme.tokens.fg};`;

        // A swatch built from the theme's own colours, so the card previews
        // the scheme rather than describing it.
        const swatch = document.createElement('span');
        swatch.style.cssText =
          'width:30px;height:30px;border-radius:5px;flex-shrink:0;display:grid;' +
          'grid-template-columns:1fr 1fr;overflow:hidden;' +
          `border:1px solid ${theme.tokens.border};`;
        for (const colour of [
          theme.tokens.panel,
          theme.tokens.accent,
          theme.tokens.panelAlt,
          theme.tokens.muted,
        ]) {
          const cell = document.createElement('span');
          cell.style.cssText = `background:${colour};`;
          swatch.appendChild(cell);
        }

        const text = document.createElement('span');
        const name = document.createElement('div');
        name.textContent = theme.label;
        name.style.cssText = 'font-size:12.5px;font-weight:600;';
        const note = document.createElement('div');
        note.textContent = theme.note;
        note.style.cssText = `font-size:10.5px;color:${theme.tokens.muted};line-height:1.4;`;
        text.append(name, note);

        card.append(swatch, text);
        card.addEventListener('click', () => {
          setTheme(theme.id);
          renderContent();
        });
        themeGrid.appendChild(card);
      }
      content.appendChild(themeGrid);

      const label = document.createElement('div');
      label.textContent = 'Background';
      label.style.cssText =
        'font-size:12px;color:var(--muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.06em;';
      content.appendChild(label);

      const grid = document.createElement('div');
      grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:14px;';
      const current = localStorage.getItem(WALLPAPER_STORAGE_KEY) ?? DEFAULT_WALLPAPER_ID;
      for (const wp of WALLPAPERS) {
        const card = document.createElement('button');
        const isSel = wp.id === current;
        card.style.cssText = `
          width:120px;height:72px;border-radius:8px;cursor:pointer;
          background:${wp.gradient};border:2px solid ${isSel ? 'var(--accent)' : 'transparent'};
          display:flex;align-items:flex-end;padding:6px;position:relative;
        `;
        card.innerHTML = `<span style="font-size:11px;color:var(--fg);text-shadow:0 1px 3px rgba(0,0,0,0.8);">${wp.label}</span>${isSel ? '<span style="position:absolute;top:6px;right:6px;color:var(--accent);font-size:14px;">✓</span>' : ''}`;
        card.addEventListener('click', () => {
          try {
            localStorage.setItem(WALLPAPER_STORAGE_KEY, wp.id);
          } catch {
            /* ignore */
          }
          document.dispatchEvent(
            new CustomEvent('apex-wallpaper-changed', { detail: wp.gradient }),
          );
          renderContent();
        });
        grid.appendChild(card);
      }
      content.appendChild(grid);

      // Lock screen — a separate choice from the desktop's, as Windows has it.
      const lockLabel = document.createElement('div');
      lockLabel.textContent = 'Lock screen';
      lockLabel.style.cssText =
        'font-size:12px;color:var(--muted);margin:22px 0 10px;text-transform:uppercase;' +
        'letter-spacing:0.06em;';
      content.appendChild(lockLabel);

      const lockGrid = document.createElement('div');
      lockGrid.style.cssText = 'display:flex;flex-wrap:wrap;gap:14px;';
      let currentLock = DEFAULT_LOCK_SCREEN_ID;
      try {
        currentLock = localStorage.getItem(LOCK_SCREEN_STORAGE_KEY) ?? DEFAULT_LOCK_SCREEN_ID;
      } catch {
        /* private mode — the default is correct */
      }
      for (const ls of LOCK_SCREENS) {
        const card = document.createElement('button');
        const isSel = ls.id === currentLock;
        card.style.cssText = `
          width:120px;height:72px;border-radius:8px;cursor:pointer;
          background:${ls.gradient};border:2px solid ${isSel ? 'var(--accent)' : 'transparent'};
          display:flex;align-items:flex-end;padding:6px;position:relative;
        `;
        const name = document.createElement('span');
        name.textContent = ls.label;
        name.style.cssText =
          'font-size:11px;color:var(--fg);text-shadow:0 1px 3px rgba(0,0,0,0.8);';
        card.appendChild(name);
        if (isSel) {
          const tick = document.createElement('span');
          tick.textContent = '✓';
          tick.style.cssText = 'position:absolute;top:6px;right:6px;color:var(--accent);font-size:14px;';
          card.appendChild(tick);
        }
        card.addEventListener('click', () => {
          try {
            localStorage.setItem(LOCK_SCREEN_STORAGE_KEY, ls.id);
          } catch {
            /* ignore */
          }
          // Applied the next time the screen locks, which is when it is seen.
          renderContent();
        });
        lockGrid.appendChild(card);
      }
      content.appendChild(lockGrid);

      const lockNote = document.createElement('div');
      lockNote.textContent = 'Shown the next time you sign out or lock the workstation.';
      lockNote.style.cssText = 'font-size:11px;color:var(--muted);margin-top:8px;';
      content.appendChild(lockNote);

      content.appendChild(
        toggleRow(
          'Compact taskbar',
          'Reduces the taskbar height for a denser layout.',
          localStorage.getItem(DENSITY_KEY) === 'compact',
          (v) => {
            try {
              localStorage.setItem(DENSITY_KEY, v ? 'compact' : 'normal');
            } catch {
              /* ignore */
            }
          },
        ),
      );
      return;
    }

    if (active === 'apps') {
      content.appendChild(sectionTitle('Installed apps'));
      const list = [
        { icon: '🔐', name: 'IAM Console', size: '54.1 MB', version: '1.45.1' },
        { icon: '🎫', name: 'Ticket Queue', size: '38.7 MB', version: '1.45.1' },
        { icon: '🛡️', name: 'SecOps Dashboard', size: '61.3 MB', version: '1.45.1' },
        { icon: '📝', name: 'Notepad', size: '2.1 MB', version: '11.2409' },
      ];
      const rows = list
        .map(
          (a) => `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);">
          <span style="font-size:22px;">${a.icon}</span>
          <div style="flex:1;">
            <div style="font-size:13px;color:var(--fg);">${a.name}</div>
            <div style="font-size:11px;color:var(--muted);">${a.size} · v${a.version}</div>
          </div>
        </div>
      `,
        )
        .join('');
      const wrap = document.createElement('div');
      wrap.innerHTML = rows;
      content.appendChild(wrap);
      return;
    }

    if (active === 'accounts') {
      content.appendChild(sectionTitle('Accounts'));

      const user = login.user;
      const initial = (user?.displayName ?? 'A').charAt(0).toUpperCase();

      const card = document.createElement('div');
      card.style.cssText =
        'display:flex;align-items:center;gap:14px;padding:16px;background:var(--panel-alt);' +
        'border-radius:8px;margin-bottom:16px;';
      const avatar = document.createElement('div');
      avatar.style.cssText =
        'width:52px;height:52px;border-radius:50%;background:var(--accent);display:flex;' +
        'align-items:center;justify-content:center;font-size:22px;color:var(--panel);' +
        'font-weight:700;overflow:hidden;flex-shrink:0;';
      if (user) paintAvatar(avatar, user.username, user.displayName);
      else avatar.textContent = initial;
      const who = document.createElement('div');
      const line1 = document.createElement('div');
      line1.textContent = user?.displayName ?? VM_HOST.displayName;
      line1.style.cssText = 'font-size:14px;color:var(--fg);font-weight:600;';
      const line2 = document.createElement('div');
      // The real account, not a fixed string. Signing in as somebody else and
      // finding the administrator's address here would be a lie the rest of
      // the workstation does not tell.
      line2.textContent = user ? `${user.username}@${COMPANY.domain}` : VM_HOST.email;
      line2.style.cssText = 'font-size:11px;color:var(--muted);';
      who.append(line1, line2);
      card.append(avatar, who);
      content.appendChild(card);

      if (user) {
        const picRow = document.createElement('div');
        picRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:16px;';

        // A hidden file input driven by a button: the browser's own control is
        // unstyleable and says "No file chosen" next to it forever.
        const file = document.createElement('input');
        file.type = 'file';
        file.accept = 'image/*';
        file.hidden = true;

        const choose = document.createElement('button');
        choose.textContent = getProfilePicture(user.username)
          ? 'Change picture'
          : 'Choose a picture';
        choose.style.cssText =
          'padding:6px 12px;border-radius:4px;border:1px solid var(--border);background:var(--panel-alt);' +
          'color:var(--fg);font-size:11.5px;cursor:pointer;font-family:inherit;';
        choose.addEventListener('click', () => file.click());

        const picMessage = document.createElement('span');
        picMessage.style.cssText = 'font-size:11px;color:var(--muted);';
        picMessage.textContent = 'Shown on the sign-in screen.';

        file.addEventListener('change', () => {
          const chosen = file.files?.[0];
          if (!chosen) return;
          readImageAsAvatar(chosen)
            .then((dataUri) => {
              if (!setProfilePicture(user.username, dataUri)) {
                picMessage.textContent = 'Not enough room in local storage to save it.';
                picMessage.style.color = '#ff9a8a';
                return;
              }
              renderContent();
            })
            .catch((err: Error) => {
              picMessage.textContent = err.message;
              picMessage.style.color = '#ff9a8a';
            });
        });

        picRow.append(choose, file, picMessage);

        if (getProfilePicture(user.username)) {
          const remove = document.createElement('button');
          remove.textContent = 'Remove';
          remove.style.cssText =
            'padding:6px 12px;border-radius:4px;border:1px solid var(--border);background:var(--panel-alt);' +
            'color:var(--fg);font-size:11.5px;cursor:pointer;font-family:inherit;';
          remove.addEventListener('click', () => {
            clearProfilePicture(user.username);
            renderContent();
          });
          picRow.insertBefore(remove, picMessage);
        }

        content.appendChild(picRow);
      }

      const box = document.createElement('div');
      box.innerHTML =
        infoRow('Account type', user && isIdentityAdmin(user.department) ? 'Administrator' : 'Standard user') +
        infoRow('Department', user?.department ?? '—') +
        infoRow('Title', user?.title ?? '—') +
        infoRow('Sign-in method', user?.mfa === 'totp' ? 'Password + TOTP' : 'Password');
      content.appendChild(box);

      // --- Change password ---------------------------------------------------
      const pwTitle = document.createElement('div');
      pwTitle.textContent = 'Password';
      pwTitle.style.cssText =
        'font-size:12px;color:var(--muted);margin:22px 0 10px;text-transform:uppercase;' +
        'letter-spacing:0.06em;';
      content.appendChild(pwTitle);

      const blurb = document.createElement('div');
      blurb.style.cssText = 'font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.6;';
      blurb.textContent = user
        ? 'Changing it here goes through the identity provider, which checks your current ' +
          'password first — the same path a real self-service change takes, and it is ' +
          'written to the audit log.'
        : 'Sign in to change a password.';
      content.appendChild(blurb);

      if (user) {
        const form = document.createElement('div');
        form.style.cssText = 'max-width:340px;display:flex;flex-direction:column;gap:8px;';

        const field = (placeholder: string): HTMLInputElement => {
          const i = document.createElement('input');
          i.type = 'password';
          i.placeholder = placeholder;
          i.style.cssText =
            'padding:8px 10px;border-radius:4px;border:1px solid var(--border);background:var(--panel);' +
            'color:var(--fg);font-size:12.5px;outline:none;font-family:inherit;';
          return i;
        };
        const currentPw = field('Current password');
        const newPw = field('New password');
        const confirmPw = field('Confirm new password');

        const message = document.createElement('div');
        message.style.cssText = 'font-size:11.5px;min-height:17px;line-height:1.5;';

        const submit = document.createElement('button');
        submit.textContent = 'Change password';
        submit.style.cssText =
          'padding:8px 14px;border-radius:4px;border:1px solid #2563eb;background:#2563eb;' +
          'color:#fff;font-size:12px;cursor:pointer;font-family:inherit;align-self:flex-start;';

        const fail = (text: string): void => {
          message.textContent = text;
          message.style.color = '#ff9a8a';
        };

        submit.addEventListener('click', () => {
          const current = currentPw.value;
          const next = newPw.value;

          if (!current || !next) return fail('Enter your current password and a new one.');
          if (next !== confirmPw.value) return fail('The new passwords do not match.');
          if (next === current) return fail('The new password must differ from the current one.');
          // Deliberately mild. A lab that enforces a corporate policy here
          // would spend the learner's attention on inventing a password
          // instead of on the directory.
          if (next.length < 4) return fail('Use at least four characters.');

          const changed = login.changePassword(user.username, current, next);
          if (!changed) {
            return fail('That is not your current password.');
          }

          currentPw.value = '';
          newPw.value = '';
          confirmPw.value = '';
          message.textContent = 'Password changed. Use the new one at the next sign-in.';
          message.style.color = 'var(--accent)';
        });

        form.append(currentPw, newPw, confirmPw, submit, message);
        content.appendChild(form);
      }
      return;
    }

    if (active === 'sound') {
      content.appendChild(sectionTitle('Sound'));
      content.appendChild(
        toggleRow(
          'Play UI sounds',
          'Console activations, step completion chimes, and workstation blips.',
          !isMuted(),
          (v) => {
            setMuted(!v);
            if (v) blip(660, 60, 0.05);
          },
        ),
      );
      return;
    }

    if (active === 'assistant') {
      content.appendChild(sectionTitle('AI Assistant'));

      const intro = document.createElement('div');
      intro.style.cssText = 'font-size:12.5px;color:var(--fg);line-height:1.65;margin-bottom:16px;';
      intro.textContent =
        'The IAM Tutor and the ticket generator both run against Ollama, a local model ' +
        'runtime. Nothing is sent anywhere: the model runs on this machine. Both features ' +
        'work without it — the tutor quotes the documentation instead of composing an ' +
        'answer, and tickets use their built-in wording — so this is optional, not required.';
      content.appendChild(intro);

      const statusCard = document.createElement('div');
      statusCard.style.cssText =
        'border:1px solid var(--border);border-radius:6px;padding:14px 16px;background:var(--panel-alt);' +
        'margin-bottom:16px;';
      const statusLine = document.createElement('div');
      statusLine.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:4px;';
      statusLine.textContent = 'Checking for Ollama\u2026';
      const statusDetail = document.createElement('div');
      statusDetail.style.cssText = 'font-size:11.5px;color:var(--muted);line-height:1.6;';
      statusCard.append(statusLine, statusDetail);
      content.appendChild(statusCard);

      // Asked live rather than cached: the point of this page is to be
      // correct at the moment somebody is looking at it, including right
      // after they have installed it in another window.
      void tutorAvailable().then((up) => {
        statusLine.textContent = up ? '\u25CF Ollama is running' : '\u25CB Ollama is not running';
        statusLine.style.color = up ? 'var(--accent)' : '#e2a03f';
        statusDetail.textContent = up
          ? `The tutor will compose answers from the documentation, and generated tickets ` +
            `will be written by the model. Model requested: ${OLLAMA_MODEL}.`
          : 'The tutor will quote the documentation and generated tickets will use their ' +
            'built-in wording. Everything else in the workstation is unaffected.';
      });

      const steps = document.createElement('div');
      steps.style.cssText = 'font-size:12px;color:var(--fg);line-height:1.8;margin-bottom:14px;';
      steps.innerHTML =
        '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;' +
        'color:var(--muted);margin-bottom:8px;">To enable it</div>' +
        '<div>1. Install Ollama for your platform.</div>' +
        `<div>2. Pull the model: <code style="background:var(--panel);border:1px solid var(--border);` +
        `border-radius:3px;padding:1px 6px;">ollama pull ${OLLAMA_MODEL}</code></div>` +
        '<div>3. Leave it running and reopen the IAM Tutor.</div>';
      content.appendChild(steps);

      const dl = document.createElement('button');
      dl.textContent = 'Open the Ollama download page';
      dl.style.cssText =
        'padding:8px 14px;border-radius:4px;border:1px solid #2563eb;background:#2563eb;' +
        'color:#fff;font-size:12px;cursor:pointer;font-family:inherit;';
      // Opens in the real browser. The workstation's own browser is fenced to
      // an allowlist on purpose, and a genuine download is outside the lab.
      dl.addEventListener('click', () => openExternal(OLLAMA_DOWNLOAD_URL));
      content.appendChild(dl);

      const note = document.createElement('div');
      note.style.cssText = 'font-size:11px;color:var(--muted);margin-top:14px;line-height:1.6;';
      note.textContent =
        'A small local model gets details wrong sometimes. That is why the tutor cites the ' +
        'article it used: open it from the reply and check.';
      content.appendChild(note);
    }

    if (active === 'updates') {
      content.appendChild(sectionTitle('Windows Update'));
      const updateContainer = document.createElement('div');
      updateContainer.id = 'update-panel';
      updateContainer.innerHTML = `
        <div style="padding:16px 0;">
          <div id="update-status-row" style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
            <span id="update-spinner" style="font-size:20px;display:none;">⏳</span>
            <span id="update-icon" style="font-size:20px;"></span>
            <div>
              <div id="update-title" style="font-size:13px;color:var(--fg);font-weight:600;">Checking for updates…</div>
              <div id="update-subtitle" style="font-size:11px;color:var(--muted);margin-top:2px;"></div>
            </div>
          </div>
          <div id="update-progress-bar" style="display:none;margin-bottom:14px;">
            <div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden;">
              <div id="update-progress-fill" style="height:100%;background:var(--accent);transition:width 0.3s;border-radius:2px;width:0%;"></div>
            </div>
            <div id="update-progress-label" style="font-size:11px;color:var(--muted);margin-top:4px;text-align:right;"></div>
          </div>
          <div id="update-actions" style="display:flex;gap:8px;flex-wrap:wrap;">
            <button id="update-check-btn" style="background:var(--accent);color:var(--panel);border:none;border-radius:6px;padding:8px 16px;font-size:12px;font-weight:600;cursor:pointer;">
              Check for updates
            </button>
          </div>
        </div>
      `;
      content.appendChild(updateContainer);

      // Wire up the update manager
      updateManager.install();

      const titleEl = updateContainer.querySelector('#update-title') as HTMLElement;
      const subtitleEl = updateContainer.querySelector('#update-subtitle') as HTMLElement;
      const iconEl = updateContainer.querySelector('#update-icon') as HTMLElement;
      const spinnerEl = updateContainer.querySelector('#update-spinner') as HTMLElement;
      const progressBar = updateContainer.querySelector('#update-progress-bar') as HTMLElement;
      const progressFill = updateContainer.querySelector('#update-progress-fill') as HTMLElement;
      const progressLabel = updateContainer.querySelector('#update-progress-label') as HTMLElement;
      const checkBtn = updateContainer.querySelector('#update-check-btn') as HTMLButtonElement;
      const actionsEl = updateContainer.querySelector('#update-actions') as HTMLElement;

      function renderStatus(status: UpdateStatus): void {
        const isAvailable = updateManager.isAvailable();

        if (!isAvailable) {
          titleEl.textContent = 'Auto-update not available';
          subtitleEl.textContent =
            'Running in browser mode — updates are only available in the desktop app.';
          iconEl.textContent = '🌐';
          spinnerEl.style.display = 'none';
          progressBar.style.display = 'none';
          checkBtn.textContent = 'Check for updates';
          checkBtn.disabled = true;
          actionsEl.innerHTML = '';
          return;
        }

        spinnerEl.style.display = status.state === 'checking' ? 'inline' : 'none';

        switch (status.state) {
          case 'error':
            // Surfaced explicitly so a broken feed reads as broken, not as
            // "up to date". The message names the actual cause.
            iconEl.textContent = '⚠️';
            titleEl.textContent = 'Update check failed';
            subtitleEl.textContent =
              status.error ?? 'The update check could not complete. Check your connection.';
            progressBar.style.display = 'none';
            checkBtn.textContent = 'Try again';
            checkBtn.disabled = false;
            actionsEl.innerHTML = '';
            break;
          case 'idle':
            iconEl.textContent = '✅';
            titleEl.textContent = "You're up to date";
            subtitleEl.textContent = status.info?.version
              ? `Version ${status.info.version} is installed.`
              : 'No updates are available right now.';
            progressBar.style.display = 'none';
            checkBtn.textContent = 'Check for updates';
            checkBtn.disabled = false;
            actionsEl.innerHTML = '';
            break;
          case 'checking':
            iconEl.textContent = '';
            titleEl.textContent = 'Checking for updates…';
            subtitleEl.textContent = 'Looking for new versions on GitHub…';
            checkBtn.textContent = 'Checking…';
            checkBtn.disabled = true;
            actionsEl.innerHTML = '';
            break;
          case 'available':
            iconEl.textContent = '🔽';
            titleEl.textContent = `Update available: v${status.info?.version ?? 'new'}`;
            subtitleEl.textContent = 'A new version is ready to download.';
            progressBar.style.display = 'none';
            checkBtn.textContent = 'Download update';
            checkBtn.disabled = false;
            checkBtn.onclick = () => void updateManager.downloadUpdate();
            actionsEl.innerHTML = '';
            break;
          case 'downloading':
            iconEl.textContent = '⬇️';
            titleEl.textContent = `Downloading update…`;
            subtitleEl.textContent = status.info?.version
              ? `v${status.info.version} — ${Math.round(status.info.progress ?? 0)}% complete`
              : 'Download in progress…';
            progressBar.style.display = 'block';
            progressFill.style.width = `${Math.round(status.info?.progress ?? 0)}%`;
            progressLabel.textContent = `${Math.round(status.info?.progress ?? 0)}%`;
            checkBtn.textContent = 'Downloading…';
            checkBtn.disabled = true;
            actionsEl.innerHTML = '';
            break;
          case 'downloaded':
            iconEl.textContent = '✅';
            titleEl.textContent = `Update ready to install`;
            subtitleEl.textContent = status.info?.version
              ? `Version ${status.info.version} has been downloaded. Restart to apply.`
              : 'Restart the app to apply the update.';
            progressBar.style.display = 'none';
            checkBtn.textContent = 'Restart and update';
            checkBtn.disabled = false;
            checkBtn.onclick = () => updateManager.installUpdate();
            actionsEl.innerHTML = '';
            break;
          case 'unsupported':
          default:
            iconEl.textContent = '🌐';
            titleEl.textContent = 'Auto-update not available';
            subtitleEl.textContent =
              'Auto-updates require the desktop app. Install it from GitHub releases.';
            spinnerEl.style.display = 'none';
            progressBar.style.display = 'none';
            checkBtn.textContent = 'Check for updates';
            checkBtn.disabled = true;
            actionsEl.innerHTML = '';
            break;
        }
      }

      // Subscribe to status changes
      const unsub = updateManager.subscribe(renderStatus);

      // Also re-render when the update panel is revisited
      const observer = new MutationObserver(() => {
        if (document.contains(updateContainer)) {
          renderStatus(updateManager.getStatus());
        } else {
          observer.disconnect();
          unsub();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      // Check button handler
      checkBtn.addEventListener('click', () => {
        void updateManager.checkForUpdates();
      });

      return;
    }

    if (active === 'about') {
      content.appendChild(sectionTitle('About'));
      const box = document.createElement('div');
      box.innerHTML =
        infoRow('Edition', VM_HOST.edition) +
        infoRow('Version', '24H2') +
        infoRow('Installed on', '8/12/2026') +
        infoRow('Product ID', '00330-80000-00000-AA457');
      content.appendChild(box);
      const footer = document.createElement('div');
      footer.style.cssText = 'margin-top:16px;font-size:11px;color:var(--muted);';
      footer.textContent = `${PRODUCT.name} — ${PRODUCT.publisher}`;
      content.appendChild(footer);
      return;
    }
  }

  renderSidebar();
  renderContent();
}
