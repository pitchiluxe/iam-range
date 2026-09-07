/**
 * ui/updateNotifier.ts — telling people an update exists.
 *
 * The updater already checked on launch and broadcast its state, and nothing
 * watched it: unless you happened to open Settings and choose Updates, a new
 * version could sit there indefinitely. A silent updater is the same failure
 * as a silent audit log — the work happened and nobody was told.
 *
 * This is deliberately not a modal. Someone mid-way through an offboarding
 * should not be interrupted by a dialog they have to dismiss before they can
 * carry on; the notification sits in the corner, waits, and can be ignored
 * until they are ready. Windows does the same thing.
 */
import { updateManager, type UpdateStatus } from '@/util/updateManager';
import { notifyPing } from '@/ui/sounds';

const CARD_ID = 'vm-update-toast';
/** Versions the user has told us to stop mentioning, so it asks once. */
const DISMISSED_KEY = 'update_dismissed_version';

function dismissedVersion(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function dismissVersion(version: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    /* private mode — it will mention it again next launch, which is not fatal */
  }
}

function removeCard(): void {
  document.getElementById(CARD_ID)?.remove();
}

function button(label: string, primary: boolean, onClick: () => void): HTMLElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText =
    'padding:6px 13px;border-radius:5px;cursor:pointer;font-size:11.5px;font-family:inherit;' +
    (primary
      ? 'background:var(--accent);color:var(--on-accent);border:1px solid var(--accent);'
      : 'background:transparent;color:var(--muted);border:1px solid var(--border);');
  b.addEventListener('click', onClick);
  return b;
}

/**
 * Show the card for the current state.
 *
 * Only three states are worth interrupting for: an update exists, it is
 * downloading, and it is ready. "Checking" and "no update" are not news.
 */
function render(status: UpdateStatus): void {
  const version = status.info?.version ?? '';

  if (status.state === 'available' && version === dismissedVersion()) {
    removeCard();
    return;
  }
  if (status.state !== 'available' && status.state !== 'downloading' && status.state !== 'downloaded') {
    removeCard();
    return;
  }

  const existing = document.getElementById(CARD_ID);
  const card = existing ?? document.createElement('div');
  if (!existing) {
    card.id = CARD_ID;
    card.style.cssText =
      'position:fixed;right:16px;bottom:64px;z-index:6000;width:320px;padding:14px 16px;' +
      'border-radius:10px;font-family:"Segoe UI",system-ui,sans-serif;font-size:12.5px;' +
      'color:var(--glass-text);background:linear-gradient(180deg,var(--glass-top),var(--glass-bottom));' +
      'border:1px solid var(--glass-border);' +
      'backdrop-filter:blur(28px) saturate(160%);-webkit-backdrop-filter:blur(28px) saturate(160%);' +
      'box-shadow:0 16px 44px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.14);';
    document.body.appendChild(card);
    notifyPing();
  }
  card.innerHTML = '';

  const title = document.createElement('div');
  title.style.cssText = 'font-weight:600;margin-bottom:5px;';
  const body = document.createElement('div');
  body.style.cssText = 'color:var(--muted);line-height:1.6;margin-bottom:12px;';
  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:8px;';

  if (status.state === 'available') {
    title.textContent = `IAM Range ${version} is available`;
    body.textContent =
      'Downloading happens in the background and nothing restarts until you say so.';
    actions.append(
      button('Download', true, () => {
        void updateManager.downloadUpdate();
      }),
      button('Not now', false, () => {
        // Asked once per version, rather than every launch forever.
        if (version) dismissVersion(version);
        removeCard();
      }),
    );
  } else if (status.state === 'downloading') {
    const percent = status.info?.progress;
    title.textContent = 'Downloading the update';
    body.textContent =
      percent === undefined ? 'Starting…' : `${percent}% — you can carry on working.`;
  } else {
    title.textContent = `IAM Range ${version} is ready`;
    body.textContent =
      'It installs when the app restarts. Your documents, notes and desktop layout are kept.';
    actions.append(
      button('Restart now', true, () => updateManager.installUpdate()),
      button('On next launch', false, removeCard),
    );
  }

  card.append(title, body);
  if (actions.childElementCount > 0) card.appendChild(actions);
}

/**
 * Watch for updates and say so.
 *
 * Also re-checks periodically. Checking only at launch means somebody who
 * leaves the workstation open for a week never hears about anything, which is
 * the case where an update matters most.
 */
export function startUpdateNotifier(): void {
  if (!updateManager.isAvailable()) return; // Browser build: nothing to update.

  // Wire up the bridge subscription. This was only ever called when somebody
  // opened Settings and chose Updates, so the main process broadcast its
  // status into a void: the updater worked, and the news went nowhere unless
  // you went looking for it.
  updateManager.install();
  updateManager.subscribe(render);

  const SIX_HOURS = 6 * 60 * 60 * 1000;
  window.setInterval(() => {
    void updateManager.checkForUpdates();
  }, SIX_HOURS);
}
