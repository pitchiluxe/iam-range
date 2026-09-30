/**
 * ui/consoles/outlookWindow.ts — Microsoft Outlook, on the admin's workstation
 * and on every staff computer.
 *
 * Built around the mailbox the help desk actually manages. Deleting moves mail
 * to Deleted Items and frees nothing; File > Info > Tools > Mailbox Cleanup,
 * Empty Deleted Items and Clean Up Old Items (archive.pst) free space; at 90 %
 * sending stops and at 100 % mail stops arriving. File > Account Settings >
 * Manage Profiles is the real Mail Setup > Show Profiles dialog, and adding a
 * new profile and making it the default is how a corrupt profile is fixed.
 * File > Options holds the settings that matter here: signature, "Empty
 * Deleted Items folders when exiting Outlook", AutoArchive.
 *
 * On a staff computer every change goes through the endpoint service (so the
 * ticket review and Get-OutlookStatus see it); on the admin's own workstation
 * the same mailbox rules run against a mailbox kept for this browser.
 */
import type { VmServices } from '@/vm/session';
import type { UserId } from '@/domain';
import { OFFICE_CREDENTIAL } from '@/services/mockEndpoints';
import {
  SEND_LIMIT,
  addProfile,
  archiveMail,
  canReceive,
  canSend,
  deleteMail,
  emptyDeleted,
  fmtSize,
  inboxMb,
  percentUsed,
  profilesOf,
  purgeDeleted,
  receiveMail,
  removeProfile,
  sendMail,
  setDefaultProfile,
  type MailResult,
  type OutlookState,
} from '@/services/mailbox';
import { VM_HOST } from '@/config/vmHost';
import { login } from '@/vm/loginSession';
import { notifyEndpointChanged, onEndpointChanged } from '@/util/endpointEvents';
import {
  button,
  checkbox,
  closeDialogsOf,
  el as mk,
  ensureStyles,
  grid,
  listBox,
  messageBox,
  openDialog,
  openMenu,
  radio,
  select,
  textbox,
} from './aduc/ui';

type Folder = 'inbox' | 'drafts' | 'sent' | 'deleted' | 'junk' | 'outbox' | 'archive';

interface Msg {
  id: string;
  folder: Folder;
  from: string;
  to: string;
  subject: string;
  body: string;
  at: number;
  sizeKb: number;
  read: boolean;
  attachment?: string;
  /** Generated to stand for older mail, so folder sizes add up. */
  filler?: boolean;
}

const FOLDERS: [Folder, string][] = [
  ['inbox', 'Inbox'],
  ['drafts', 'Drafts'],
  ['sent', 'Sent Items'],
  ['deleted', 'Deleted Items'],
  ['junk', 'Junk Email'],
  ['outbox', 'Outbox'],
];

const DAY = 86_400_000;
const actor = (): UserId => (login.user?.id ?? 'system') as UserId;
const uid = (): string => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------------------
// Where the mailbox lives
// ---------------------------------------------------------------------------

interface Backend {
  key: string;
  user: string;
  address: string;
  state(): OutlookState | null;
  connected(): boolean;
  staleCredential(): boolean;
  apply(fn: (o: OutlookState) => MailResult, needsProfile?: boolean): MailResult;
}

const LOCAL_KEY = 'outlook.local.v1';

function loadLocal(): OutlookState {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) return JSON.parse(raw) as OutlookState;
  } catch {
    /* blocked storage: a fresh mailbox */
  }
  return {
    profile: 'ok',
    workOffline: false,
    quotaMb: 50 * 1024,
    mailboxUsedMb: 36_900,
    deletedItemsMb: 5_300,
    sentMb: 2_400,
    archivedMb: 0,
    profiles: ['Outlook'],
    defaultProfile: 'Outlook',
  };
}

function backendFor(services: VmServices, computer?: string): Backend {
  const eps = services.endpoints;
  if (computer) {
    const e0 = eps.get(computer);
    const user = e0?.username ?? VM_HOST.user;
    return {
      key: computer,
      user,
      address: `${user}@${VM_HOST.domain}`,
      state: () => eps.get(computer)?.outlook ?? null,
      connected: () => {
        const e = eps.get(computer);
        return e ? eps.onCorpNetwork(e) || e.vpn.connected : false;
      },
      staleCredential: () => !!eps.get(computer)?.credentials.some((c) => c.target === OFFICE_CREDENTIAL && c.stale),
      apply: (fn, needsProfile = true) => {
        const r = eps.outlook(computer, actor(), fn, needsProfile);
        notifyEndpointChanged(computer);
        return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error };
      },
    };
  }
  const user = login.user?.username ?? VM_HOST.user;
  let local = loadLocal();
  return {
    key: `local-${user}`,
    user,
    address: `${user}@${VM_HOST.domain}`,
    state: () => local,
    connected: () => true,
    staleCredential: () => false,
    apply: (fn) => {
      local = loadLocal();
      const r = fn(local);
      try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(local));
      } catch {
        /* not remembered */
      }
      return r;
    },
  };
}

// ---------------------------------------------------------------------------
// Messages: what the folders hold, kept consistent with the mailbox sizes
// ---------------------------------------------------------------------------

const PEOPLE = ['IT Service Desk', 'HR Team', 'Facilities', 'Security Awareness', 'Finance Operations', 'Maya Chen', 'Ravi Patel', 'Ada Okafor', 'Payroll', 'Project Atlas'];

function seedMessages(address: string): Msg[] {
  const now = Date.now();
  const m = (folder: Folder, from: string, subject: string, body: string, ageH: number, sizeKb: number, read = false, attachment?: string): Msg =>
    ({ id: uid(), folder, from, to: address, subject, body, at: now - ageH * 3_600_000, sizeKb, read, ...(attachment ? { attachment } : {}) });
  return [
    m('inbox', 'IT Service Desk', 'Scheduled maintenance this weekend', 'Systems will be unavailable between 10 PM Saturday and 2 AM Sunday. No action is needed.', 1, 38),
    m('inbox', 'HR Team', 'Open enrolment closes Friday', 'Remember to confirm your benefit choices in the HR Portal before Friday 5 PM.', 3, 52),
    m('inbox', 'Security Awareness', 'Report suspicious email with the Report button', 'If a message asks for your password or payment, do not reply. Use Report Message.', 20, 44, true),
    m('inbox', 'Facilities', 'Floor 2 printer toner replaced', 'The Floor 2 multifunction printer is back in service.', 26, 31, true),
    m('inbox', 'Project Atlas', 'Design review deck (final)', 'Attached is the final deck for Thursday. Please review slides 12–20.', 50, 18_400, true, 'Atlas-Design-Review.pptx'),
    m('inbox', 'Finance Operations', 'Q3 expense report template', 'Use the attached template for all Q3 claims.', 72, 2_300, true, 'Q3-Expenses.xlsx'),
    m('sent', address, 'RE: Access request for the Finance share', 'Approved — access will be granted within the hour.', 30, 24, true),
    m('drafts', address, 'Notes from the stand-up', 'Action items: 1) … 2) …', 5, 12, true),
    m('deleted', 'Newsletter', 'Your weekly digest', 'Top stories this week…', 100, 420, true),
    m('junk', 'Prize Center', 'You have won!!!', 'Click here to claim your reward.', 40, 16),
  ];
}

const MSGS_KEY = (k: string): string => `outlook.msgs.v1.${k}`;

function loadMessages(b: Backend): Msg[] {
  try {
    const raw = localStorage.getItem(MSGS_KEY(b.key));
    if (raw) return JSON.parse(raw) as Msg[];
  } catch {
    /* fresh */
  }
  return seedMessages(b.address);
}

function saveMessages(b: Backend, msgs: Msg[]): void {
  try {
    localStorage.setItem(MSGS_KEY(b.key), JSON.stringify(msgs));
  } catch {
    /* not remembered */
  }
}

const FILLER_SUBJECTS = [
  ['Site survey photos', 'Site-Survey-Photos.zip'],
  ['Quarterly board pack', 'Board-Pack.pdf'],
  ['Recording: all-hands meeting', 'AllHands.mp4'],
  ['Project archive export', 'Archive-Export.zip'],
  ['Scanned contracts', 'Contracts-Scan.pdf'],
  ['Marketing video drafts', 'Campaign-Drafts.mov'],
];

/**
 * Make the listed messages add up to the folder's size. Anything bigger than
 * the visible mail is older mail with large attachments, dated months back,
 * which is exactly what Mailbox Cleanup's "older than" and "larger than"
 * searches exist to find.
 */
function reconcile(msgs: Msg[], s: OutlookState, address: string): Msg[] {
  const target: Record<'inbox' | 'sent' | 'deleted' | 'archive', number> = {
    inbox: inboxMb(s),
    sent: s.sentMb ?? 0,
    deleted: s.deletedItemsMb,
    archive: s.archivedMb ?? 0,
  };
  let out = [...msgs];
  const mbOf = (f: Folder): number =>
    out.filter((m) => m.folder === f || (f === 'inbox' && ['drafts', 'junk'].includes(m.folder))).reduce((a, m) => a + m.sizeKb / 1024, 0);
  for (const f of ['inbox', 'sent', 'deleted', 'archive'] as const) {
    // Too much listed (something else freed space): drop the oldest first.
    let listed = mbOf(f);
    if (listed > target[f] + 0.5) {
      const inF = out.filter((m) => m.folder === f).sort((a, b) => a.at - b.at);
      for (const m of inF) {
        if (listed <= target[f] + 0.5) break;
        out = out.filter((x) => x.id !== m.id);
        listed -= m.sizeKb / 1024;
      }
    }
    // Too little: older mail with large attachments.
    let missing = target[f] - mbOf(f);
    let i = 0;
    while (missing > 1 && i < 80) {
      const chunk = Math.min(missing, Math.max(40, Math.min(900, missing / 6)));
      const [subject, file] = FILLER_SUBJECTS[i % FILLER_SUBJECTS.length]!;
      out.push({
        id: uid(),
        folder: f,
        from: f === 'sent' ? address : PEOPLE[(i * 7) % PEOPLE.length]!,
        to: address,
        subject: `${subject}${i >= FILLER_SUBJECTS.length ? ` (${Math.floor(i / FILLER_SUBJECTS.length) + 1})` : ''}`,
        body: 'See attachment.',
        at: Date.now() - (120 + i * 23) * DAY,
        sizeKb: Math.round(chunk * 1024),
        read: true,
        attachment: file,
        filler: true,
      });
      missing -= chunk;
      i++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

export function renderOutlookWindow(body: HTMLElement, services: VmServices, computer?: string): void {
  ensureStyles();
  body.innerHTML = '';
  Object.assign(body.style, { overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#fff' });
  const root = mk('div');
  root.style.cssText =
    "flex:1;min-height:0;display:flex;flex-direction:column;color:#1b1b1b;color-scheme:light;font-family:'Segoe UI',sans-serif;font-size:12px;background:#fff;";
  body.appendChild(root);

  const owner = {};
  const b = backendFor(services, computer);
  let msgs = loadMessages(b);
  let folder: Folder = 'inbox';
  let tab: 'home' | 'send' | 'folder' | 'view' = 'home';
  let backstage: 'info' | 'options' | null = null;
  let selected = new Set<string>();
  let notice: { text: string; kind: 'info' | 'error' } | null = null;
  let search = '';
  let readingPane = true;
  let promptCount = 0;
  let closed = false;

  const watch = window.setInterval(() => {
    if (!root.isConnected) {
      closeDialogsOf(owner);
      window.clearInterval(watch);
    }
  }, 1000);

  const st = (): OutlookState => b.state()!;
  const persist = (): void => saveMessages(b, msgs);
  const sync = (): void => {
    const s = b.state();
    if (s) msgs = reconcile(msgs, s, b.address);
    persist();
  };
  const say = (r: MailResult): boolean => {
    notice = r.ok ? { text: r.message, kind: 'info' } : { text: r.error, kind: 'error' };
    return r.ok;
  };
  const mbOfIds = (ids: string[]): number => msgs.filter((m) => ids.includes(m.id)).reduce((a, m) => a + m.sizeKb / 1024, 0);

  // --- Mail actions (all through the mailbox rules) -------------------------
  function deleteSelected(): void {
    const ids = [...selected];
    if (!ids.length) return;
    if (folder === 'deleted') {
      messageBox(`${ids.length === 1 ? 'This item' : `These ${ids.length} items`} will be permanently deleted. Continue?`, {
        title: 'Microsoft Outlook',
        kind: 'warning',
        yesNo: true,
        onYes: () => {
          if (say(b.apply((o) => purgeDeleted(o, mbOfIds(ids))))) msgs = msgs.filter((m) => !ids.includes(m.id));
          selected.clear();
          sync();
          paint();
        },
      });
      return;
    }
    const counted = msgs.filter((m) => ids.includes(m.id) && ['inbox', 'sent', 'drafts', 'junk'].includes(m.folder));
    const fromSent = counted.filter((m) => m.folder === 'sent');
    const fromInbox = counted.filter((m) => m.folder !== 'sent');
    let r: MailResult = { ok: true, message: 'Moved to Deleted Items.' };
    if (fromInbox.length) r = b.apply((o) => deleteMail(o, mbOfIds(fromInbox.map((m) => m.id)), 'inbox'));
    if (r.ok && fromSent.length) r = b.apply((o) => deleteMail(o, mbOfIds(fromSent.map((m) => m.id)), 'sent'));
    if (say(r)) for (const m of msgs) if (ids.includes(m.id)) m.folder = 'deleted';
    msgs = msgs.filter((m) => !(ids.includes(m.id) && m.folder === 'outbox'));
    selected.clear();
    sync();
    paint();
  }

  function archiveIds(ids: string[]): MailResult {
    const items = msgs.filter((m) => ids.includes(m.id) && ['inbox', 'sent', 'drafts', 'junk'].includes(m.folder));
    const sent = items.filter((m) => m.folder === 'sent');
    const rest = items.filter((m) => m.folder !== 'sent');
    let r: MailResult = { ok: false, error: 'Select messages in Inbox or Sent Items to archive.' };
    if (rest.length) r = b.apply((o) => archiveMail(o, mbOfIds(rest.map((m) => m.id)), 'inbox'));
    if (sent.length && (r.ok || !rest.length)) r = b.apply((o) => archiveMail(o, mbOfIds(sent.map((m) => m.id)), 'sent'));
    if (r.ok) for (const m of items) m.folder = 'archive';
    return r;
  }

  function emptyDeletedFolder(ask = true): void {
    const go = (): void => {
      if (say(b.apply((o) => emptyDeleted(o)))) msgs = msgs.filter((m) => m.folder !== 'deleted');
      sync();
      paint();
    };
    if (!ask) return go();
    messageBox('Everything in the "Deleted Items" folder will be permanently deleted. Continue?', {
      title: 'Microsoft Outlook',
      kind: 'warning',
      yesNo: true,
      onYes: go,
    });
  }

  function sendReceive(): void {
    const connected = b.connected();
    // The Outbox goes first.
    const queued = msgs.filter((m) => m.folder === 'outbox');
    for (const m of queued) {
      const r = b.apply((o) => sendMail(o, m.sizeKb / 1024, connected));
      if (!r.ok || (r as { queued?: boolean }).queued) break;
      m.folder = 'sent';
    }
    const r = b.apply((o) => receiveMail(o, 0.12, connected));
    if (r.ok) {
      const pick = PEOPLE[Math.floor(Math.random() * PEOPLE.length)]!;
      msgs.push({
        id: uid(), folder: 'inbox', from: pick, to: b.address, subject: `Update from ${pick}`,
        body: 'Just a quick update — details in the thread.', at: Date.now(), sizeKb: 120, read: false,
      });
    }
    say(r);
    sync();
    paint();
  }

  function compose(prefill: Partial<Msg> = {}): void {
    const s = st();
    const to = textbox(prefill.to ?? '');
    const cc = textbox('');
    const subject = textbox(prefill.subject ?? '');
    const text = document.createElement('textarea');
    text.rows = 12;
    text.style.width = '100%';
    text.value = `${prefill.body ?? ''}${s.signature ? `\n\n--\n${s.signature}` : ''}`;
    const d = openDialog({
      title: `${subject.value || 'Untitled'} - Message (HTML)`,
      width: 620,
      owner,
      buttons: [
        {
          label: 'Send',
          primary: true,
          onClick: () => {
            if (!to.value.trim()) {
              messageBox('There must be at least one name or contact group in the To, Cc, or Bcc box.', { title: 'Microsoft Outlook', kind: 'warning' });
              return false;
            }
            const sizeMb = (40 + text.value.length / 20) / 1024;
            const r = b.apply((o) => sendMail(o, sizeMb, b.connected()));
            if (!r.ok) {
              messageBox(r.error, { title: 'Microsoft Outlook', kind: 'error' });
              return false;
            }
            const queued = (r as { queued?: boolean }).queued;
            msgs.push({
              id: uid(), folder: queued ? 'outbox' : 'sent', from: b.address, to: to.value.trim(), subject: subject.value.trim() || '(no subject)',
              body: text.value, at: Date.now(), sizeKb: Math.round(sizeMb * 1024), read: true,
            });
            say(r);
            sync();
            paint();
          },
        },
        {
          label: 'Save Draft',
          onClick: () => {
            msgs.push({ id: uid(), folder: 'drafts', from: b.address, to: to.value, subject: subject.value || '(no subject)', body: text.value, at: Date.now(), sizeKb: 8, read: true });
            persist();
            paint();
          },
        },
        { label: 'Discard', cancel: true },
      ],
    });
    subject.addEventListener('input', () => d.setTitle(`${subject.value || 'Untitled'} - Message (HTML)`));
    if (!canSend(s)) {
      const warn = mk('div', undefined, `⚠ Your mailbox is ${percentUsed(s)}% full. You can't send until you free up space.`);
      warn.style.cssText = 'background:#fde7e9;color:#a4262c;padding:6px 8px;margin-bottom:8px;';
      d.body.appendChild(warn);
    }
    d.body.append(grid('60px 1fr', 'To...', to, 'Cc...', cc, 'Subject', subject));
    text.style.marginTop = '8px';
    d.body.appendChild(text);
    queueMicrotask(() => (prefill.to ? text : to).focus());
  }

  // --- Dialogs from File -----------------------------------------------------
  function folderSizeDialog(): void {
    const s = st();
    const rows: [string, number][] = [
      [b.address, s.mailboxUsedMb],
      ['    Inbox (and other folders)', inboxMb(s)],
      ['    Sent Items', s.sentMb ?? 0],
      ['    Deleted Items', s.deletedItemsMb],
    ];
    const d = openDialog({ title: 'Folder Size', width: 460, modal: true, owner, buttons: [{ label: 'Close', primary: true, cancel: true }] });
    const lb = listBox<[string, number]>([{ label: 'Folder Name', render: (r) => r[0], width: '60%' }, { label: 'Total Size', render: (r) => fmtSize(r[1]) }], { height: '150px' });
    lb.setRows(rows);
    d.body.append(mk('div', undefined, `Server Data — mailbox quota ${fmtSize(s.quotaMb)}, ${percentUsed(s)}% used`), lb.el);
    if (s.archivedMb) d.body.appendChild(mk('div', undefined, `Local Data — archive.pst: ${fmtSize(s.archivedMb)} (not counted against the quota)`));
  }

  function findItemsDialog(kind: 'older' | 'larger', value: number): void {
    const now = Date.now();
    const hits = msgs.filter((m) =>
      ['inbox', 'sent', 'drafts', 'junk'].includes(m.folder) &&
      (kind === 'older' ? m.at < now - value * DAY : m.sizeKb > value));
    const d = openDialog({
      title: 'Advanced Find',
      width: 640,
      owner,
      buttons: [{ label: 'Close', primary: true, cancel: true }],
    });
    d.body.appendChild(mk('div', undefined, kind === 'older' ? `Items older than ${value} days: ${hits.length}` : `Items larger than ${value} KB: ${hits.length}`));
    const lb = listBox<Msg>([
      { label: 'From', render: (m) => m.from, width: '24%' },
      { label: 'Subject', render: (m) => `${m.subject}${m.attachment ? '  📎' : ''}`, width: '36%' },
      { label: 'Received', render: (m) => new Date(m.at).toLocaleDateString() },
      { label: 'Size', render: (m) => fmtSize(m.sizeKb / 1024) },
      { label: 'In Folder', render: (m) => FOLDERS.find(([f]) => f === m.folder)?.[1] ?? m.folder },
    ], { height: '240px', multi: true });
    lb.setRows(hits.sort((a, x) => x.sizeKb - a.sizeKb));
    const total = mk('div');
    const refreshTotal = (): void => {
      const sel = lb.selected();
      total.textContent = sel.length ? `${sel.length} selected · ${fmtSize(sel.reduce((a, m) => a + m.sizeKb / 1024, 0))}` : 'Select items (Ctrl+click for several), then delete or archive them.';
    };
    lb.onSelect = refreshTotal;
    refreshTotal();
    const acts = mk('div');
    acts.style.cssText = 'display:flex;gap:8px;margin-top:8px;align-items:center;';
    acts.append(
      button('Delete', () => {
        const ids = lb.selected().map((m) => m.id);
        if (!ids.length) return;
        selected = new Set(ids);
        const prev = folder;
        folder = 'inbox';
        deleteSelected();
        folder = prev;
        d.close();
      }),
      button('Archive', () => {
        const ids = lb.selected().map((m) => m.id);
        if (!ids.length) return;
        say(archiveIds(ids));
        sync();
        paint();
        d.close();
      }),
      total,
    );
    d.body.append(lb.el, acts);
  }

  function autoArchiveDialog(): void {
    const months = select(['1', '3', '6', '12', '24'], '6', '70px');
    const d = openDialog({
      title: 'AutoArchive',
      width: 440,
      modal: true,
      owner,
      buttons: [
        {
          label: 'Run AutoArchive now',
          primary: true,
          onClick: () => {
            const cutoff = Date.now() - Number(months.value) * 30 * DAY;
            const ids = msgs.filter((m) => ['inbox', 'sent'].includes(m.folder) && m.at < cutoff).map((m) => m.id);
            if (!ids.length) {
              messageBox(`Nothing in Inbox or Sent Items is older than ${months.value} months.`, { title: 'AutoArchive', kind: 'info' });
              return false;
            }
            say(archiveIds(ids));
            sync();
            paint();
          },
        },
        { label: 'Cancel', cancel: true },
      ],
    });
    const row = mk('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:center;';
    row.append(mk('span', undefined, 'Clean out items older than'), months, mk('span', undefined, 'months'));
    d.body.append(
      row,
      mk('div', 'ad-note', `Move old items to: C:\\Users\\${b.user}\\Documents\\Outlook Files\\archive.pst`),
      mk('div', 'ad-note', 'Archived items leave the mailbox, so they free space against the quota; they stay searchable in Archives.'),
    );
  }

  function mailboxCleanupDialog(): void {
    const s = st();
    const older = textbox('90', { width: '60px' });
    const larger = textbox('250', { width: '60px' });
    const d = openDialog({ title: 'Mailbox Cleanup', width: 520, modal: true, owner, buttons: [{ label: 'Close', primary: true, cancel: true }] });
    const line = (text: string, ...ctrls: HTMLElement[]): HTMLElement => {
      const r = mk('div');
      r.style.cssText = 'display:grid;grid-template-columns:1fr 150px;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid #e1e1e1;';
      const c = mk('div');
      c.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
      c.append(...ctrls);
      r.append(mk('div', 'ad-note', text), c);
      return r;
    };
    const usage = mk('div', undefined, `Mailbox: ${fmtSize(s.mailboxUsedMb)} of ${fmtSize(s.quotaMb)} (${percentUsed(s)}%) · Deleted Items ${fmtSize(s.deletedItemsMb)}`);
    usage.style.cssText = 'font-weight:600;margin-bottom:4px;';
    const oldRow = mk('div');
    oldRow.style.cssText = 'display:flex;gap:6px;align-items:center;';
    oldRow.append(radio('mc', 'Find items older than', true).el, older, mk('span', undefined, 'days'));
    const bigRow = mk('div');
    bigRow.style.cssText = 'display:flex;gap:6px;align-items:center;';
    const bigRadio = radio('mc', 'Find items larger than', false);
    bigRow.append(bigRadio.el, larger, mk('span', undefined, 'kilobytes'));
    d.body.append(
      mk('div', 'ad-note', 'You can use this tool to manage the size of your mailbox.'),
      usage,
      line('View the total size of your mailbox and of the individual folders within it.', button('View Mailbox Size...', folderSizeDialog)),
      (() => {
        const w = mk('div');
        w.style.cssText = 'padding:8px 0;border-bottom:1px solid #e1e1e1;display:grid;grid-template-columns:1fr 150px;gap:10px;align-items:center;';
        const left = mk('div');
        left.append(oldRow, bigRow);
        w.append(left, button('Find...', () => {
          if (bigRadio.checked) findItemsDialog('larger', Math.max(1, Number(larger.value) || 250));
          else findItemsDialog('older', Math.max(1, Number(older.value) || 90));
        }));
        return w;
      })(),
      line('Clean up your mailbox by moving old items to the archive file on this computer.', button('AutoArchive', autoArchiveDialog)),
      line('Emptying the deleted items folder permanently deletes those items.', button('View Deleted Items Size...', () =>
        messageBox(`Deleted Items: ${fmtSize(st().deletedItemsMb)}. Deleted mail still counts against your mailbox until the folder is emptied.`, { title: 'Deleted Items Size', kind: 'info' })),
        button('Empty', () => { d.close(); emptyDeletedFolder(); })),
    );
  }

  function accountSettingsDialog(startTab: 'email' | 'data' = 'email'): void {
    const s = st();
    const d = openDialog({ title: 'Account Settings', width: 620, modal: true, owner, buttons: [{ label: 'Close', primary: true, cancel: true }] });
    let t = startTab;
    const tabs = mk('div', 'ad-tabrow');
    const panel = mk('div', 'ad-tabpanel');
    panel.style.minHeight = '220px';
    const paintTabs = (): void => {
      tabs.textContent = '';
      for (const [id, label] of [['email', 'Email'], ['data', 'Data Files'], ['rss', 'RSS Feeds'], ['sharepoint', 'SharePoint Lists'], ['cal', 'Internet Calendars']] as const) {
        const x = mk('div', 'ad-tab' + (t === id ? ' sel' : ''), label);
        x.style.flex = '0 0 auto';
        x.addEventListener('mousedown', () => { if (id === 'email' || id === 'data') { t = id; paintTabs(); } });
        tabs.appendChild(x);
      }
      panel.textContent = '';
      if (t === 'email') {
        const bar = mk('div');
        bar.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;';
        bar.append(
          button('New...', () => messageBox('This lab mailbox has one Exchange account. Add a second account with Manage Profiles → a new profile.', { title: 'Add Account', kind: 'info' })),
          button('Repair...', () => {
            messageBox('Outlook is repairing your account. Tests passed: Establish network connection · Search for server settings · Log on to server.', { title: 'Repair Account', kind: 'info' });
          }),
          button('Change...', () => messageBox(`Server: outlook.office365.com\nUser: ${b.address}\nUse Cached Exchange Mode: on (12 months)`, { title: 'Exchange Account Settings', kind: 'info' })),
          button('Set as Default', () => undefined, { disabled: true }),
          button('Remove', () => messageBox('Removing the only account deletes its offline data. Create a new profile instead (File > Account Settings > Manage Profiles).', { title: 'Microsoft Outlook', kind: 'warning' })),
        );
        const lb = listBox<[string, string]>([{ label: 'Name', render: (r) => r[0], width: '60%' }, { label: 'Type', render: (r) => r[1] }], { height: '120px' });
        lb.setRows([[b.address, 'Microsoft Exchange (send from this account by default)']]);
        panel.append(bar, lb.el, mk('div', 'ad-note', `Selected account delivers new messages to: ${b.address}\\Inbox — in data file C:\\Users\\${b.user}\\AppData\\Local\\Microsoft\\Outlook\\${b.address}.ost`));
      } else {
        const lb = listBox<[string, string, string]>([{ label: 'Name', render: (r) => r[0], width: '40%' }, { label: 'Location', render: (r) => r[1] }, { label: 'Size', render: (r) => r[2] }], { height: '150px' });
        const rows: [string, string, string][] = [[b.address, `C:\\Users\\${b.user}\\AppData\\Local\\Microsoft\\Outlook\\${b.address}.ost`, fmtSize(s.mailboxUsedMb)]];
        if (s.archivedMb) rows.push(['Archives', `C:\\Users\\${b.user}\\Documents\\Outlook Files\\archive.pst`, fmtSize(s.archivedMb)]);
        lb.setRows(rows);
        panel.append(lb.el, mk('div', 'ad-note', 'An .ost is a cached copy of the mailbox; deleting it only makes Outlook download it again. archive.pst holds archived mail and is not on the server.'));
      }
    };
    paintTabs();
    const change = button('Change Profile...', () => { d.close(); manageProfilesDialog(); });
    change.style.marginTop = '8px';
    d.body.append(mk('div', 'ad-note', 'You can add or remove an account. You can select an account and change its settings.'), tabs, panel, change);
  }

  /** Control Panel > Mail > Mail Setup, which File > Account Settings > Manage Profiles opens. */
  function manageProfilesDialog(): void {
    const d = openDialog({ title: `Mail Setup - Outlook`, width: 440, modal: true, owner, buttons: [{ label: 'Close', primary: true, cancel: true }] });
    const block = (title: string, text: string, label: string, fn: () => void): HTMLElement => {
      const f = mk('fieldset', 'ad-fs');
      f.appendChild(mk('legend', undefined, title));
      const r = mk('div');
      r.style.cssText = 'display:grid;grid-template-columns:1fr 130px;gap:10px;align-items:center;';
      r.append(mk('div', 'ad-note', text), button(label, fn));
      f.appendChild(r);
      f.style.marginBottom = '8px';
      return f;
    };
    d.body.append(
      block('Email Accounts', 'Setup email accounts and directories.', 'Email Accounts...', () => { d.close(); accountSettingsDialog('email'); }),
      block('Data Files', 'Change settings for the files Outlook uses to store email messages and documents.', 'Data Files...', () => { d.close(); accountSettingsDialog('data'); }),
      block('Profiles', 'Setup multiple profiles of email accounts and data files. Typically, you only need one.', 'Show Profiles...', () => { d.close(); showProfilesDialog(); }),
    );
  }

  function showProfilesDialog(): void {
    const s0 = st();
    let pendingDefault = s0.defaultProfile ?? profilesOf(s0)[0]!;
    const d = openDialog({
      title: 'Mail',
      width: 460,
      modal: true,
      owner,
      buttons: [
        { label: 'OK', primary: true, onClick: () => void applyDefault() },
        { label: 'Cancel', cancel: true },
        { label: 'Apply', onClick: () => { applyDefault(); return false; } },
      ],
    });
    const lb = listBox<string>([{ label: 'The following profiles are set up on this computer:', render: (p) => `${p}${p === (st().defaultProfile ?? profilesOf(st())[0]) && st().profile === 'corrupt' ? '   (cannot be opened)' : ''}` }], { height: '120px' });
    const refresh = (): void => {
      lb.setRows(profilesOf(st()));
      sel.textContent = '';
      for (const p of profilesOf(st())) sel.appendChild(new Option(p, p));
      sel.value = pendingDefault;
    };
    const sel = select([], undefined, '220px');
    sel.addEventListener('change', () => (pendingDefault = sel.value));
    const bar = mk('div');
    bar.style.cssText = 'display:flex;gap:6px;margin:8px 0;';
    bar.append(
      button('Add...', () => {
        const name = textbox(`Outlook ${profilesOf(st()).length + 1}`);
        openDialog({
          title: 'New Profile', width: 340, modal: true, owner,
          buttons: [
            { label: 'OK', primary: true, onClick: () => {
              const r = b.apply((o) => addProfile(o, name.value, false), false);
              if (!r.ok) { messageBox(r.error, { kind: 'error', title: 'Mail' }); return false; }
              pendingDefault = name.value.trim();
              refresh();
              messageBox(`${r.message}\n\nThe account ${b.address} was added to it automatically (Exchange Autodiscover). Choose "Always use this profile" → ${name.value.trim()} and click OK to make Outlook open with it.`, { title: 'Add Account', kind: 'info' });
            } },
            { label: 'Cancel', cancel: true },
          ],
        }).body.append(mk('div', undefined, 'Profile Name:'), name);
      }),
      button('Remove', () => {
        const p = lb.selected()[0];
        if (!p) return;
        messageBox(`Are you sure you want to remove the "${p}" profile? Offline cached content for its accounts will be deleted.`, {
          title: 'Mail', kind: 'warning', yesNo: true,
          onYes: () => {
            const r = b.apply((o) => removeProfile(o, p), false);
            if (!r.ok) messageBox(r.error, { kind: 'error', title: 'Mail' });
            pendingDefault = st().defaultProfile ?? profilesOf(st())[0]!;
            refresh();
          },
        });
      }),
      button('Properties', () => { const p = lb.selected()[0]; if (p) manageProfilesDialog(); }),
      button('Copy...', () => {
        const p = lb.selected()[0];
        if (!p) return;
        const r = b.apply((o) => addProfile(o, `${p} - Copy`, false), false);
        if (!r.ok) messageBox(r.error, { kind: 'error', title: 'Mail' });
        refresh();
      }),
    );
    const prompt = radio('prof', 'Prompt for a profile to be used', false);
    const always = radio('prof', 'Always use this profile', true);
    const alwaysRow = mk('div');
    alwaysRow.style.cssText = 'display:flex;gap:8px;align-items:center;';
    alwaysRow.append(always.el, sel);
    const f = mk('fieldset', 'ad-fs');
    f.appendChild(mk('legend', undefined, 'When starting Microsoft Outlook, use this profile:'));
    f.append(prompt.el, alwaysRow);
    d.body.append(lb.el, bar, f);
    refresh();

    function applyDefault(): void {
      const r = b.apply((o) => {
        const was = o.defaultProfile ?? profilesOf(o)[0];
        const res = setDefaultProfile(o, pendingDefault);
        // Opening with a different profile means a new, healthy data file.
        if (res.ok && was !== pendingDefault) o.profile = 'ok';
        return res;
      }, false);
      say(r);
      paint();
    }
  }

  function optionsDialog(): void {
    const s = st();
    const sig = document.createElement('textarea');
    sig.rows = 5;
    sig.style.width = '100%';
    sig.value = s.signature ?? '';
    const emptyOnExit = checkbox('Empty Deleted Items folders when exiting Outlook', !!s.emptyOnExit);
    const spell = checkbox('Always check spelling before sending', true);
    const d = openDialog({
      title: 'Outlook Options',
      width: 560,
      modal: true,
      owner,
      buttons: [
        {
          label: 'OK',
          primary: true,
          onClick: () => {
            b.apply((o) => {
              o.signature = sig.value.trim() || undefined;
              o.emptyOnExit = emptyOnExit.checked || undefined;
              return { ok: true, message: 'Options saved.' };
            }, false);
            notice = { text: 'Options saved.', kind: 'info' };
            paint();
          },
        },
        { label: 'Cancel', cancel: true },
      ],
    });
    const sec = (title: string, ...kids: HTMLElement[]): HTMLElement => {
      const f = mk('fieldset', 'ad-fs');
      f.appendChild(mk('legend', undefined, title));
      f.append(...kids);
      f.style.marginBottom = '8px';
      return f;
    };
    d.body.append(
      sec('General', grid('120px 1fr', 'User name:', textbox(login.user?.displayName ?? b.user, { readOnly: true }), 'Start Outlook in:', select(['Inbox'], 'Inbox'))),
      sec('Mail — Signature (added to new messages)', sig, spell.el),
      sec('Advanced — Outlook start and exit', emptyOnExit.el),
      sec('Advanced — AutoArchive', button('AutoArchive Settings...', autoArchiveDialog)),
    );
  }

  function exitOutlook(): void {
    if (st().emptyOnExit && st().deletedItemsMb > 0) emptyDeletedFolder(false);
    closed = true;
    closeDialogsOf(owner);
    paint();
  }

  // --- Painting --------------------------------------------------------------
  function ribbonButton(label: string, fn: () => void, opts: { pressed?: boolean; disabled?: boolean; title?: string } = {}): HTMLButtonElement {
    const x = document.createElement('button');
    x.textContent = label;
    x.title = opts.title ?? '';
    x.disabled = !!opts.disabled;
    x.style.cssText =
      `border:1px solid ${opts.pressed ? '#0f6cbd' : 'transparent'};background:${opts.pressed ? '#cfe4fa' : 'transparent'};` +
      'border-radius:3px;padding:5px 9px;font-size:12px;cursor:pointer;color:#1b1b1b;font-family:inherit;' +
      (opts.disabled ? 'opacity:.45;cursor:default;' : '');
    x.addEventListener('mouseenter', () => { if (!opts.pressed && !opts.disabled) x.style.background = '#e8e8e8'; });
    x.addEventListener('mouseleave', () => { if (!opts.pressed) x.style.background = 'transparent'; });
    x.addEventListener('click', () => { if (!opts.disabled) fn(); });
    return x;
  }

  function paint(): void {
    root.textContent = '';
    if (closed) {
      const c = mk('div', undefined, 'Outlook closed. Open it again from the desktop or Start.');
      c.style.cssText = 'margin:auto;color:#707070;';
      const again = button('Open Outlook', () => { closed = false; paint(); });
      const w = mk('div');
      w.style.cssText = 'margin:auto;display:flex;flex-direction:column;gap:10px;align-items:center;';
      w.append(c, again);
      root.appendChild(w);
      return;
    }
    const s = b.state();
    if (!s) {
      root.appendChild(mk('div', undefined, 'This computer has no mailbox.'));
      return;
    }
    if (s.profile === 'corrupt') return void root.appendChild(profileError());
    if (b.staleCredential()) return void root.appendChild(passwordPrompt());
    sync();
    if (backstage) return void root.appendChild(backstageView(s));

    const connected = b.connected();
    const pct = percentUsed(s);
    const full = !canSend(s);

    const top = mk('div');
    top.style.cssText = 'background:#0f6cbd;color:#fff;padding:6px 12px;display:flex;align-items:center;gap:14px;';
    const folderName = FOLDERS.find(([f]) => f === folder)?.[1] ?? 'Archives';
    top.appendChild(mk('div', undefined, `${folderName} - ${b.address} - Outlook`));
    top.firstElementChild!.setAttribute('style', 'font-weight:600;flex:1;');
    const find = document.createElement('input');
    find.placeholder = '🔍 Search';
    find.value = search;
    find.style.cssText = 'width:230px;border:none;border-radius:3px;padding:4px 8px;color:#1b1b1b;background:#fff;';
    find.addEventListener('input', () => { search = find.value; paintList(); });
    top.appendChild(find);
    root.appendChild(top);

    const tabs = mk('div');
    tabs.style.cssText = 'display:flex;gap:2px;background:#f3f3f3;border-bottom:1px solid #e1e1e1;padding:0 8px;';
    const file = document.createElement('button');
    file.textContent = 'File';
    file.style.cssText = 'border:none;background:#0f6cbd;color:#fff;padding:6px 14px;font-size:12px;cursor:pointer;font-family:inherit;';
    file.addEventListener('click', () => { backstage = 'info'; paint(); });
    tabs.appendChild(file);
    for (const [id, label] of [['home', 'Home'], ['send', 'Send / Receive'], ['folder', 'Folder'], ['view', 'View']] as const) {
      const t = document.createElement('button');
      t.textContent = label;
      t.style.cssText = `border:none;background:${tab === id ? '#fff' : 'transparent'};padding:6px 12px;font-size:12px;cursor:pointer;border-bottom:2px solid ${tab === id ? '#0f6cbd' : 'transparent'};color:#1b1b1b;font-family:inherit;`;
      t.addEventListener('click', () => { tab = id; paint(); });
      tabs.appendChild(t);
    }
    root.appendChild(tabs);

    const ribbon = mk('div');
    ribbon.style.cssText = 'display:flex;gap:4px;align-items:center;padding:6px 10px;border-bottom:1px solid #e1e1e1;background:#fafafa;min-height:36px;flex-wrap:wrap;';
    const one = (): Msg | undefined => msgs.find((m) => selected.has(m.id));
    if (tab === 'home') {
      ribbon.append(
        ribbonButton('✉️ New Email', () => compose()),
        ribbonButton('🗑️ Delete', deleteSelected, { disabled: !selected.size }),
        ribbonButton('📦 Archive', () => { say(archiveIds([...selected])); selected.clear(); sync(); paint(); }, { disabled: !selected.size, title: 'Move to archive.pst on this computer (frees mailbox space)' }),
        ribbonButton('↩️ Reply', () => { const m = one(); if (m) compose({ to: m.from, subject: `RE: ${m.subject}`, body: `\n\n----\n${m.body}` }); }, { disabled: selected.size !== 1 }),
        ribbonButton('↪️ Forward', () => { const m = one(); if (m) compose({ subject: `FW: ${m.subject}`, body: `\n\n----\n${m.body}` }); }, { disabled: selected.size !== 1 }),
        ribbonButton('✉ Unread/Read', () => { for (const m of msgs) if (selected.has(m.id)) m.read = !m.read; persist(); paint(); }, { disabled: !selected.size }),
        ribbonButton('📁 Move ▾', () => {
          const btnRect = ribbon.getBoundingClientRect();
          openMenu(btnRect.left + 330, btnRect.bottom, [
            { label: 'Deleted Items', onClick: deleteSelected },
            { label: 'Archive (archive.pst)', onClick: () => { say(archiveIds([...selected])); selected.clear(); sync(); paint(); } },
          ]);
        }, { disabled: !selected.size }),
      );
    } else if (tab === 'send') {
      ribbon.append(
        ribbonButton('🔄 Send/Receive All Folders', sendReceive),
        ribbonButton('📤 Send All', sendReceive, { disabled: !msgs.some((m) => m.folder === 'outbox') }),
        ribbonButton('📴 Work Offline', () => {
          say(b.apply((o) => { o.workOffline = !o.workOffline; return { ok: true, message: `Work Offline turned ${o.workOffline ? 'on' : 'off'}.` }; }));
          paint();
        }, { pressed: s.workOffline }),
      );
    } else if (tab === 'folder') {
      ribbon.append(
        ribbonButton('🧹 Empty Folder', () => (folder === 'deleted' ? emptyDeletedFolder() : undefined), { disabled: folder !== 'deleted', title: 'Empty the Deleted Items folder' }),
        ribbonButton('📏 Folder Properties (size)', folderSizeDialog),
        ribbonButton('🗄️ AutoArchive Settings', autoArchiveDialog),
        ribbonButton('🧰 Mailbox Cleanup…', mailboxCleanupDialog),
      );
    } else {
      ribbon.append(
        ribbonButton(`📖 Reading Pane: ${readingPane ? 'Right' : 'Off'}`, () => { readingPane = !readingPane; paint(); }),
        ribbonButton('🔁 Reset View', () => { search = ''; folder = 'inbox'; readingPane = true; paint(); }),
      );
    }
    root.appendChild(ribbon);

    if (full) {
      const bar = mk('div', undefined, `⚠ Mailbox full: ${pct}% of ${fmtSize(s.quotaMb)}. You can't send messages. Empty Deleted Items or archive older mail (File > Tools > Mailbox Cleanup).`);
      bar.style.cssText = 'background:#fde7e9;color:#a4262c;padding:6px 12px;border-bottom:1px solid #f1bbbc;';
      const fix = button('Mailbox Cleanup', mailboxCleanupDialog);
      fix.style.marginLeft = '10px';
      bar.appendChild(fix);
      root.appendChild(bar);
    } else if (pct >= 80) {
      const bar = mk('div', undefined, `Your mailbox is almost full (${pct}%). Clean up before it reaches ${Math.round(SEND_LIMIT * 100)}% and sending stops.`);
      bar.style.cssText = 'background:#fff4ce;color:#5c4400;padding:6px 12px;border-bottom:1px solid #f0dca0;';
      root.appendChild(bar);
    }
    if (notice) {
      const n = mk('div', undefined, notice.text);
      n.style.cssText = `padding:6px 12px;border-bottom:1px solid #e1e1e1;${notice.kind === 'error' ? 'background:#fde7e9;color:#a4262c;' : 'background:#dff6dd;color:#0e5c0e;'}`;
      root.appendChild(n);
    }

    const panes = mk('div');
    panes.style.cssText = `flex:1;min-height:0;display:grid;grid-template-columns:190px ${readingPane ? '1fr 1.15fr' : '1fr'};`;
    // Folder pane.
    const fp = mk('div');
    fp.style.cssText = 'border-right:1px solid #e1e1e1;padding:8px 0;overflow:auto;background:#fafafa;';
    fp.appendChild(mk('div', undefined, b.address)).setAttribute('style', 'padding:4px 12px;font-weight:600;color:#0f6cbd;overflow:hidden;text-overflow:ellipsis;');
    const sizeOf = (f: Folder): number => msgs.filter((m) => m.folder === f).reduce((a, m) => a + m.sizeKb / 1024, 0);
    const addFolder = (f: Folder, label: string): void => {
      const unread = msgs.filter((m) => m.folder === f && !m.read).length;
      const count = f === 'outbox' || f === 'drafts' ? msgs.filter((m) => m.folder === f).length : unread;
      const row = mk('div');
      row.style.cssText = `display:flex;justify-content:space-between;padding:5px 12px 5px 22px;cursor:pointer;${folder === f ? 'background:#cfe4fa;font-weight:600;' : ''}`;
      row.title = `${label}: ${fmtSize(sizeOf(f))}`;
      row.append(mk('span', undefined, label), mk('span', undefined, count ? String(count) : ''));
      (row.lastChild as HTMLElement).style.cssText = 'color:#0f6cbd;font-size:11px;';
      row.addEventListener('click', () => { folder = f; selected.clear(); paint(); });
      row.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        openMenu(ev.clientX, ev.clientY, [
          { label: 'Empty Folder', disabled: f !== 'deleted', onClick: () => emptyDeletedFolder() },
          { label: 'Mark All as Read', onClick: () => { for (const m of msgs) if (m.folder === f) m.read = true; persist(); paint(); } },
          { separator: true },
          { label: 'Properties (size)', onClick: folderSizeDialog },
        ]);
      });
      fp.appendChild(row);
    };
    for (const [f, label] of FOLDERS) addFolder(f, label);
    if ((s.archivedMb ?? 0) > 0 || msgs.some((m) => m.folder === 'archive')) {
      fp.appendChild(mk('div', undefined, 'Archives')).setAttribute('style', 'padding:10px 12px 4px;font-weight:600;color:#0f6cbd;');
      addFolder('archive', 'Archive (archive.pst)');
    }
    // Quota meter at the foot of the folder pane, as Outlook shows it.
    const meter = mk('div');
    meter.style.cssText = 'margin:14px 12px 4px;font-size:11px;color:#424242;';
    const barOut = mk('div');
    barOut.style.cssText = 'height:6px;background:#e1e1e1;border-radius:3px;overflow:hidden;margin:4px 0;';
    const barIn = mk('div');
    barIn.style.cssText = `height:100%;width:${Math.min(100, pct)}%;background:${full ? '#a4262c' : pct >= 80 ? '#c19c00' : '#0f6cbd'};`;
    barOut.appendChild(barIn);
    meter.append(mk('div', undefined, `${fmtSize(Math.max(0, s.quotaMb - s.mailboxUsedMb))} free of ${fmtSize(s.quotaMb)}`), barOut);
    fp.appendChild(meter);

    const lp = mk('div');
    lp.style.cssText = 'border-right:1px solid #e1e1e1;overflow:auto;';
    lp.tabIndex = 0;
    lp.addEventListener('keydown', (ev) => { if (ev.key === 'Delete') deleteSelected(); });
    const rp = mk('div');
    rp.style.cssText = 'padding:16px;overflow:auto;color:#424242;line-height:1.6;';
    panes.append(fp, lp);
    if (readingPane) panes.appendChild(rp);
    root.appendChild(panes);

    function paintList(): void {
      lp.textContent = '';
      const q = search.trim().toLowerCase();
      const list = msgs
        .filter((m) => m.folder === folder && (!q || `${m.from} ${m.subject} ${m.body}`.toLowerCase().includes(q)))
        .sort((a, x) => x.at - a.at);
      if (!list.length) {
        const e = mk('div', undefined, q ? 'We didn\'t find anything to show here.' : 'We didn\'t find anything to show here.');
        e.style.cssText = 'padding:24px;color:#707070;text-align:center;';
        lp.appendChild(e);
      }
      for (const m of list) {
        const item = mk('div');
        item.style.cssText = `padding:7px 12px;border-bottom:1px solid #f0f0f0;cursor:default;border-left:3px solid ${m.read ? 'transparent' : '#0f6cbd'};${selected.has(m.id) ? 'background:#cfe4fa;' : ''}`;
        const head = mk('div');
        head.style.cssText = 'display:flex;justify-content:space-between;gap:8px;';
        head.append(mk('span', undefined, folder === 'sent' || folder === 'outbox' || folder === 'drafts' ? `To: ${m.to}` : m.from), mk('span', undefined, fmtSize(m.sizeKb / 1024)));
        (head.firstChild as HTMLElement).style.cssText = `font-weight:${m.read ? 400 : 700};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
        (head.lastChild as HTMLElement).style.cssText = 'color:#707070;font-size:11px;white-space:nowrap;';
        const subj = mk('div', undefined, `${m.subject}${m.attachment ? '  📎' : ''}`);
        subj.style.cssText = `color:#0f6cbd;${m.read ? '' : 'font-weight:600;'}overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
        const when = mk('div', undefined, new Date(m.at).toLocaleString());
        when.style.cssText = 'color:#707070;font-size:11px;';
        item.append(head, subj, when);
        item.addEventListener('mousedown', (ev) => {
          if (ev.ctrlKey || ev.metaKey) {
            if (selected.has(m.id)) selected.delete(m.id);
            else selected.add(m.id);
          } else if (!(ev.button === 2 && selected.has(m.id))) {
            selected = new Set([m.id]);
          }
          if (!m.read && selected.size === 1) {
            m.read = true;
            persist();
          }
          paint();
        });
        item.addEventListener('dblclick', () => (folder === 'drafts' ? compose(m) : undefined));
        item.addEventListener('contextmenu', (ev) => {
          ev.preventDefault();
          openMenu(ev.clientX, ev.clientY, [
            { label: 'Reply', onClick: () => compose({ to: m.from, subject: `RE: ${m.subject}` }) },
            { label: 'Forward', onClick: () => compose({ subject: `FW: ${m.subject}`, body: m.body }) },
            { separator: true },
            { label: m.read ? 'Mark as Unread' : 'Mark as Read', onClick: () => { m.read = !m.read; persist(); paint(); } },
            { label: 'Archive', disabled: !['inbox', 'sent'].includes(m.folder), onClick: () => { say(archiveIds([...selected])); selected.clear(); sync(); paint(); } },
            { label: folder === 'deleted' ? 'Delete permanently' : 'Delete', onClick: deleteSelected },
          ]);
        });
        lp.appendChild(item);
      }
      rp.textContent = '';
      const m = msgs.find((x) => selected.has(x.id));
      if (m && selected.size === 1) {
        rp.append(
          mk('div', undefined, m.subject),
          mk('div', undefined, `From: ${m.from}    To: ${m.to}`),
          mk('div', undefined, new Date(m.at).toLocaleString()),
        );
        (rp.children[0] as HTMLElement).style.cssText = 'font-size:16px;font-weight:600;color:#1b1b1b;margin-bottom:4px;';
        (rp.children[1] as HTMLElement).style.cssText = 'color:#424242;';
        (rp.children[2] as HTMLElement).style.cssText = 'color:#707070;font-size:11px;margin-bottom:12px;';
        if (m.attachment) {
          const a = mk('div', undefined, `📎 ${m.attachment}  (${fmtSize(m.sizeKb / 1024)})`);
          a.style.cssText = 'display:inline-block;border:1px solid #d1d1d1;border-radius:4px;padding:4px 8px;margin-bottom:12px;';
          rp.appendChild(a);
        }
        const bodyEl = mk('div', undefined, m.body);
        bodyEl.style.whiteSpace = 'pre-wrap';
        rp.appendChild(bodyEl);
      } else {
        const hint = mk('div', undefined, selected.size > 1 ? `${selected.size} items selected` : 'Select an item to read');
        hint.style.cssText = 'color:#707070;text-align:center;margin-top:40px;';
        rp.appendChild(hint);
      }
    }
    paintList();

    const state = s.workOffline
      ? { text: 'Working Offline', color: '#a4262c' }
      : !connected
        ? { text: 'Disconnected', color: '#a4262c' }
        : full
          ? { text: 'Mailbox Full', color: '#a4262c' }
          : { text: 'Connected to: Microsoft Exchange', color: '#107c10' };
    const status = mk('div');
    status.style.cssText = 'display:flex;justify-content:space-between;padding:4px 12px;background:#f3f3f3;border-top:1px solid #e1e1e1;font-size:11px;';
    const inF = msgs.filter((m) => m.folder === folder);
    status.append(
      mk('span', undefined, `Items: ${inF.length}    Unread: ${inF.filter((m) => !m.read).length}    Mailbox: ${pct}% full`),
      mk('span', undefined, state.text),
    );
    (status.lastChild as HTMLElement).style.cssText = `color:${state.color};font-weight:600;`;
    root.appendChild(status);
  }

  function backstageView(s: OutlookState): HTMLElement {
    const wrap = mk('div');
    wrap.style.cssText = 'flex:1;min-height:0;display:grid;grid-template-columns:170px 1fr;';
    const nav = mk('div');
    nav.style.cssText = 'background:#0f6cbd;color:#fff;display:flex;flex-direction:column;padding-top:8px;';
    const navBtn = (label: string, fn: () => void, active = false): void => {
      const x = document.createElement('button');
      x.textContent = label;
      x.style.cssText = `text-align:left;border:none;background:${active ? '#115ea3' : 'transparent'};color:#fff;padding:9px 18px;font-size:13px;cursor:pointer;font-family:inherit;`;
      x.addEventListener('click', fn);
      nav.appendChild(x);
    };
    navBtn('←  Back', () => { backstage = null; paint(); });
    navBtn('Info', () => { backstage = 'info'; paint(); }, backstage === 'info');
    navBtn('Options', () => optionsDialog());
    navBtn('Exit', () => { backstage = null; exitOutlook(); });
    const main = mk('div');
    main.style.cssText = 'padding:20px 28px;overflow:auto;';
    main.appendChild(mk('div', undefined, 'Account Information')).setAttribute('style', 'font-size:22px;margin-bottom:10px;');
    main.appendChild(mk('div', undefined, `📧 ${b.address} — Microsoft Exchange`)).setAttribute('style', 'margin-bottom:16px;');

    const block = (icon: string, label: string, title: string, text: string, onClick: (ev: MouseEvent) => void, extra?: HTMLElement): void => {
      const r = mk('div');
      r.style.cssText = 'display:grid;grid-template-columns:120px 1fr;gap:18px;padding:14px 0;border-top:1px solid #e1e1e1;';
      const btn = document.createElement('button');
      btn.textContent = `${icon}\n${label}`;
      btn.style.cssText = 'white-space:pre-line;border:1px solid #d1d1d1;background:#fff;padding:10px;font-size:12px;cursor:pointer;min-height:70px;color:#1b1b1b;font-family:inherit;';
      btn.addEventListener('click', onClick);
      const t = mk('div');
      t.append(mk('div', undefined, title), mk('div', undefined, text));
      (t.firstChild as HTMLElement).style.cssText = 'font-size:15px;margin-bottom:4px;';
      (t.lastChild as HTMLElement).style.cssText = 'color:#424242;line-height:1.5;';
      if (extra) t.appendChild(extra);
      r.append(btn, t);
      main.appendChild(r);
    };
    block('⚙️', 'Account Settings ▾', 'Account Settings', 'Change settings for this account or set up more connections.', (ev) => {
      openMenu(ev.clientX, ev.clientY, [
        { label: 'Account Settings...', onClick: () => accountSettingsDialog('email') },
        { label: 'Manage Profiles', onClick: manageProfilesDialog },
        { label: 'Change Profile', onClick: showProfilesDialog },
      ]);
    });
    const meter = mk('div');
    meter.style.cssText = 'margin-top:8px;max-width:360px;';
    const out = mk('div');
    out.style.cssText = 'height:8px;background:#e1e1e1;border-radius:4px;overflow:hidden;';
    const inn = mk('div');
    inn.style.cssText = `height:100%;width:${Math.min(100, percentUsed(s))}%;background:${canSend(s) ? '#0f6cbd' : '#a4262c'};`;
    out.appendChild(inn);
    meter.append(out, mk('div', undefined, `${fmtSize(Math.max(0, s.quotaMb - s.mailboxUsedMb))} free of ${fmtSize(s.quotaMb)} · Deleted Items ${fmtSize(s.deletedItemsMb)}${canReceive(s) ? '' : ' · NOT RECEIVING MAIL'}`));
    block('🧰', 'Tools ▾', 'Mailbox Settings', 'Manage the size of your mailbox by emptying Deleted Items and archiving.', (ev) => {
      openMenu(ev.clientX, ev.clientY, [
        { label: 'Mailbox Cleanup...', onClick: mailboxCleanupDialog },
        { label: 'Empty Deleted Items Folder', onClick: () => emptyDeletedFolder() },
        { label: 'Clean Up Old Items (Archive)...', onClick: autoArchiveDialog },
      ]);
    }, meter);
    block('🏖️', 'Automatic Replies', 'Automatic Replies (Out of Office)', 'Use automatic replies to notify others that you are out of office or not available.', () =>
      messageBox('Automatic replies are off. (Set them in Outlook on the web for this lab mailbox.)', { title: 'Automatic Replies', kind: 'info' }));
    wrap.append(nav, main);
    return wrap;
  }

  function profileError(): HTMLElement {
    const wrap = mk('div');
    wrap.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;background:#f3f3f3;';
    const dialog = mk('div');
    dialog.style.cssText = 'width:420px;background:#fff;border:1px solid #d1d1d1;box-shadow:0 8px 24px rgba(0,0,0,0.18);';
    dialog.appendChild(mk('div', undefined, 'Microsoft Outlook')).setAttribute('style', 'padding:8px 12px;background:#fafafa;border-bottom:1px solid #e1e1e1;');
    const content = mk('div');
    content.style.cssText = 'display:flex;gap:12px;padding:16px;line-height:1.5;';
    content.append(mk('div', undefined, '⛔'), mk('div', undefined, 'Cannot start Microsoft Outlook. Cannot open the Outlook window. The set of folders cannot be opened. The information store could not be opened.'));
    (content.firstChild as HTMLElement).style.fontSize = '26px';
    dialog.appendChild(content);
    const actions = mk('div');
    actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding:0 16px 14px;';
    actions.append(
      button('Mail Setup — Show Profiles…', showProfilesDialog),
      button('OK', () => { closed = true; paint(); }, { primary: true }),
    );
    dialog.appendChild(actions);
    wrap.appendChild(dialog);
    return wrap;
  }

  function passwordPrompt(): HTMLElement {
    const wrap = mk('div');
    wrap.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;background:#f3f3f3;';
    const dialog = mk('div');
    dialog.style.cssText = 'width:380px;background:#fff;border:1px solid #d1d1d1;box-shadow:0 8px 24px rgba(0,0,0,0.18);padding:18px;display:flex;flex-direction:column;gap:10px;';
    dialog.append(mk('div', undefined, 'Windows Security'), mk('div', undefined, 'Microsoft Outlook'), mk('div', undefined, `Connecting to ${b.address}`));
    (dialog.firstChild as HTMLElement).style.cssText = 'font-size:14px;font-weight:600;';
    const input = document.createElement('input');
    input.type = 'password';
    input.placeholder = 'Password';
    input.style.cssText = 'padding:6px 8px;border:1px solid #8a8a8a;background:#fff;color:#1b1b1b;font-family:inherit;';
    const note = mk('div', undefined, promptCount > 0 ? `The prompt came back (${promptCount}×). Outlook is still using a saved credential.` : '');
    note.style.cssText = 'color:#a4262c;font-size:11.5px;min-height:16px;';
    const actions = mk('div');
    actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;';
    actions.append(
      button('Cancel', () => { closed = true; paint(); }),
      // Whatever is typed, the stale saved credential is offered first and
      // fails, so the prompt returns: the symptom the user reported.
      button('OK', () => { promptCount += 1; paint(); }, { primary: true }),
    );
    dialog.append(input, checkbox('Remember my credentials', true).el, note, actions);
    wrap.appendChild(dialog);
    return wrap;
  }

  paint();
  if (computer) onEndpointChanged(root, computer, paint);
}
