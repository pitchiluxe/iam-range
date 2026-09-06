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
import { WALLPAPERS, WALLPAPER_STORAGE_KEY, DEFAULT_WALLPAPER_ID } from '@/util/wallpapers';
import { updateManager, type UpdateStatus } from '@/util/updateManager';

const DENSITY_KEY = 'settings_density';
const THEME_KEY = 'app_theme';

function getTheme(): 'dark' | 'light' {
  try {
    return (localStorage.getItem(THEME_KEY) as 'dark' | 'light') ?? 'dark';
  } catch {
    return 'dark';
  }
}

function setTheme(theme: 'dark' | 'light'): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

type CategoryId =
  'system' | 'personalization' | 'apps' | 'accounts' | 'sound' | 'updates' | 'about';

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
  { id: 'updates', icon: '🔄', label: 'Updates' },
  { id: 'about', icon: 'ℹ️', label: 'About' },
];

/** The Windows 11 System-page hero: device name, edition, and the machine icon. */
function deviceCard(): HTMLElement {
  const card = document.createElement('div');
  card.style.cssText =
    'display:flex;align-items:center;gap:14px;padding:16px;margin-bottom:18px;' +
    'background:#232830;border:1px solid #2d343d;border-radius:8px;';
  const icon = document.createElement('div');
  icon.textContent = '🖥️';
  icon.style.cssText = 'font-size:38px;line-height:1;';
  const text = document.createElement('div');
  const name = document.createElement('div');
  name.textContent = VM_HOST.name;
  name.style.cssText = 'font-size:15px;font-weight:600;color:#e6e6e6;';
  const sub = document.createElement('div');
  sub.textContent = `${VM_HOST.edition} · joined to ${VM_HOST.domain}`;
  sub.style.cssText = 'font-size:11.5px;color:#8b95a1;margin-top:3px;';
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
    padding:14px 0;border-bottom:1px solid #2d343d;
  `;
  const text = document.createElement('div');
  text.innerHTML = `<div style="font-size:13px;color:#e6e6e6;">${label}</div><div style="font-size:11px;color:#8b95a1;margin-top:2px;">${description}</div>`;
  row.appendChild(text);

  const toggle = document.createElement('button');
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-checked', String(checked));
  let state = checked;
  const paint = () => {
    toggle.style.cssText = `
      width:40px;height:22px;border-radius:11px;border:none;cursor:pointer;flex-shrink:0;
      background:${state ? '#4ec9b0' : '#2d343d'};position:relative;transition:background 0.15s;
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
  h.style.cssText = 'font-size:18px;color:#e6e6e6;margin:0 0 16px 0;font-weight:600;';
  return h;
}

function infoRow(label: string, value: string): string {
  return `
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #232830;font-size:12px;">
      <span style="color:#8b95a1;">${label}</span><span style="color:#e6e6e6;">${value}</span>
    </div>
  `;
}

export function renderSettingsWindow(body: HTMLElement): void {
  body.style.cssText =
    'display:flex;height:100%;background:#161a20;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI Variable","Segoe UI",sans-serif;color:#c8cdd3;';

  const sidebar = document.createElement('div');
  sidebar.style.cssText =
    'width:200px;flex-shrink:0;background:#12151a;border-right:1px solid #2d343d;padding:12px 0;overflow-y:auto;';
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
      'width:32px;height:32px;border-radius:50%;background:#4ec9b0;color:#06231d;' +
      'display:flex;align-items:center;justify-content:center;font-size:14px;' +
      'font-weight:700;flex-shrink:0;';
    const who = document.createElement('div');
    who.style.cssText = 'min-width:0;';
    const whoName = document.createElement('div');
    whoName.textContent = VM_HOST.displayName;
    whoName.style.cssText = 'font-size:12px;color:#e6e6e6;font-weight:600;';
    const whoMail = document.createElement('div');
    whoMail.textContent = VM_ACCOUNT;
    whoMail.style.cssText =
      'font-size:10.5px;color:#8b95a1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
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
      'width:100%;box-sizing:border-box;background:#0e1116;color:#e6e6e6;' +
      'border:1px solid #2d343d;border-radius:4px;padding:5px 8px;font-size:11.5px;outline:none;';
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
        background:${isActive ? '#232830' : 'transparent'};
        color:${isActive ? '#e6e6e6' : '#c8cdd3'};
        position:relative;
      `;
      if (isActive) {
        // Windows 11 marks the selected item with a short accent bar, not a
        // full-height border.
        const marker = document.createElement('span');
        marker.style.cssText =
          'position:absolute;left:0;top:50%;transform:translateY(-50%);width:3px;' +
          'height:16px;border-radius:2px;background:#4ec9b0;';
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

      // Theme toggle
      const currentTheme = getTheme();
      content.appendChild(
        toggleRow(
          'Dark / Light theme',
          `Current: ${currentTheme === 'light' ? 'Light' : 'Dark'} theme`,
          currentTheme === 'light',
          (v) => {
            setTheme(v ? 'light' : 'dark');
          },
        ),
      );

      const label = document.createElement('div');
      label.textContent = 'Background';
      label.style.cssText =
        'font-size:12px;color:#8b95a1;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.06em;';
      content.appendChild(label);

      const grid = document.createElement('div');
      grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:14px;';
      const current = localStorage.getItem(WALLPAPER_STORAGE_KEY) ?? DEFAULT_WALLPAPER_ID;
      for (const wp of WALLPAPERS) {
        const card = document.createElement('button');
        const isSel = wp.id === current;
        card.style.cssText = `
          width:120px;height:72px;border-radius:8px;cursor:pointer;
          background:${wp.gradient};border:2px solid ${isSel ? '#4ec9b0' : 'transparent'};
          display:flex;align-items:flex-end;padding:6px;position:relative;
        `;
        card.innerHTML = `<span style="font-size:11px;color:#e6e6e6;text-shadow:0 1px 3px rgba(0,0,0,0.8);">${wp.label}</span>${isSel ? '<span style="position:absolute;top:6px;right:6px;color:#4ec9b0;font-size:14px;">✓</span>' : ''}`;
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
        <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #232830;">
          <span style="font-size:22px;">${a.icon}</span>
          <div style="flex:1;">
            <div style="font-size:13px;color:#e6e6e6;">${a.name}</div>
            <div style="font-size:11px;color:#8b95a1;">${a.size} · v${a.version}</div>
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
      const card = document.createElement('div');
      card.style.cssText =
        'display:flex;align-items:center;gap:14px;padding:16px;background:#1b1f24;border-radius:8px;margin-bottom:16px;';
      card.innerHTML = `
        <div style="width:52px;height:52px;border-radius:50%;background:#4ec9b0;display:flex;align-items:center;justify-content:center;font-size:22px;color:#0e1116;font-weight:700;">A</div>
        <div>
          <div style="font-size:14px;color:#e6e6e6;font-weight:600;">admin@northwind.local</div>
          <div style="font-size:11px;color:#8b95a1;">IAM Administrator</div>
        </div>
      `;
      content.appendChild(card);
      const box = document.createElement('div');
      box.innerHTML =
        infoRow('Account type', 'Administrator') + infoRow('Sign-in method', 'Password + TOTP');
      content.appendChild(box);
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
              <div id="update-title" style="font-size:13px;color:#e6e6e6;font-weight:600;">Checking for updates…</div>
              <div id="update-subtitle" style="font-size:11px;color:#8b95a1;margin-top:2px;"></div>
            </div>
          </div>
          <div id="update-progress-bar" style="display:none;margin-bottom:14px;">
            <div style="height:4px;background:#2d343d;border-radius:2px;overflow:hidden;">
              <div id="update-progress-fill" style="height:100%;background:#4ec9b0;transition:width 0.3s;border-radius:2px;width:0%;"></div>
            </div>
            <div id="update-progress-label" style="font-size:11px;color:#8b95a1;margin-top:4px;text-align:right;"></div>
          </div>
          <div id="update-actions" style="display:flex;gap:8px;flex-wrap:wrap;">
            <button id="update-check-btn" style="background:#4ec9b0;color:#0e1116;border:none;border-radius:6px;padding:8px 16px;font-size:12px;font-weight:600;cursor:pointer;">
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
        infoRow('Edition', 'Apex OS 11 Enterprise') +
        infoRow('Version', '24H2') +
        infoRow('Installed on', '8/12/2026') +
        infoRow('Product ID', '00330-80000-00000-AA457');
      content.appendChild(box);
      const footer = document.createElement('div');
      footer.style.cssText = 'margin-top:16px;font-size:11px;color:#8b95a1;';
      footer.textContent = 'Northwind Holdings — Apex Identity Workstation';
      content.appendChild(footer);
      return;
    }
  }

  renderSidebar();
  renderContent();
}
