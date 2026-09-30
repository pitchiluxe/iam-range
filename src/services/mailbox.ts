/**
 * services/mailbox.ts — how an Exchange mailbox fills up and frees space.
 *
 * One set of rules for every Outlook in the app: the admin's own and each
 * staff computer's. Space is what the help desk manages, so it is modelled
 * the way Exchange counts it:
 *
 *   - Deleting a message MOVES it to Deleted Items. The mailbox is no smaller.
 *   - Emptying Deleted Items frees the space.
 *   - Archiving (AutoArchive / Clean Up Old Items) moves items to a local
 *     archive.pst, outside the mailbox — that frees space too.
 *   - At 90 % of quota sending is prohibited; at 100 % receiving stops.
 *
 * All sizes are MB. The functions mutate the state they are given and return
 * a message, so the endpoint service can audit them and the admin's local
 * Outlook can use them unchanged.
 */

export interface OutlookState {
  profile: 'ok' | 'corrupt';
  workOffline: boolean;
  /** Everything in the mailbox, Deleted Items included. */
  mailboxUsedMb: number;
  deletedItemsMb: number;
  quotaMb: number;
  /** Sent Items. Absent in saves from before it was tracked (treated as 0). */
  sentMb?: number;
  /** In archive.pst on the computer, not in the mailbox. */
  archivedMb?: number;
  /** Mail profiles on the computer, and which one Outlook opens. */
  profiles?: string[];
  defaultProfile?: string;
  /** File > Options > Advanced: "Empty Deleted Items folders when exiting Outlook". */
  emptyOnExit?: boolean;
  /** File > Options > Mail > Signatures. */
  signature?: string;
}

export type MailResult = { ok: true; message: string } | { ok: false; error: string };

const ok = (message: string): MailResult => ({ ok: true, message });
const no = (error: string): MailResult => ({ ok: false, error });

export const SEND_LIMIT = 0.9;

const round = (mb: number): number => Math.round(mb * 100) / 100;
export const fmtSize = (mb: number): string =>
  mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : mb >= 1 ? `${Math.round(mb)} MB` : `${Math.max(1, Math.round(mb * 1024))} KB`;

/** Inbox and other folders = everything that is not Sent or Deleted. */
export function inboxMb(s: OutlookState): number {
  return Math.max(0, round(s.mailboxUsedMb - s.deletedItemsMb - (s.sentMb ?? 0)));
}

export function percentUsed(s: OutlookState): number {
  return Math.round((s.mailboxUsedMb / s.quotaMb) * 100);
}

export const canSend = (s: OutlookState): boolean => s.mailboxUsedMb / s.quotaMb < SEND_LIMIT;
export const canReceive = (s: OutlookState): boolean => s.mailboxUsedMb < s.quotaMb;

export function profilesOf(s: OutlookState): string[] {
  return s.profiles && s.profiles.length ? s.profiles : ['Outlook'];
}

/** Move mail from Inbox (or Sent Items) to Deleted Items. Frees nothing. */
export function deleteMail(s: OutlookState, mb: number, from: 'inbox' | 'sent' = 'inbox'): MailResult {
  const have = from === 'sent' ? s.sentMb ?? 0 : inboxMb(s);
  const move = round(Math.min(mb, have));
  if (move <= 0) return no('There is nothing to delete there.');
  if (from === 'sent') s.sentMb = round((s.sentMb ?? 0) - move);
  s.deletedItemsMb = round(s.deletedItemsMb + move);
  return ok(`Moved ${fmtSize(move)} to Deleted Items. The mailbox is the same size until Deleted Items is emptied.`);
}

/** Permanently delete part of Deleted Items (selected items). */
export function purgeDeleted(s: OutlookState, mb: number): MailResult {
  const gone = round(Math.min(mb, s.deletedItemsMb));
  if (gone <= 0) return no('Deleted Items is already empty.');
  s.deletedItemsMb = round(s.deletedItemsMb - gone);
  s.mailboxUsedMb = round(Math.max(0, s.mailboxUsedMb - gone));
  return ok(`Permanently deleted ${fmtSize(gone)}.`);
}

export function emptyDeleted(s: OutlookState): MailResult {
  const freed = s.deletedItemsMb;
  if (freed <= 0) return ok('Deleted Items is already empty.');
  s.mailboxUsedMb = round(Math.max(0, s.mailboxUsedMb - freed));
  s.deletedItemsMb = 0;
  return ok(`Emptied Deleted Items: ${fmtSize(freed)} freed.`);
}

/** Move mail out of the mailbox into archive.pst. */
export function archiveMail(s: OutlookState, mb: number, from: 'inbox' | 'sent' = 'inbox'): MailResult {
  const have = from === 'sent' ? s.sentMb ?? 0 : inboxMb(s);
  const move = round(Math.min(mb, have));
  if (move <= 0) return no('There is nothing to archive there.');
  if (from === 'sent') s.sentMb = round((s.sentMb ?? 0) - move);
  s.mailboxUsedMb = round(s.mailboxUsedMb - move);
  s.archivedMb = round((s.archivedMb ?? 0) + move);
  return ok(`Archived ${fmtSize(move)} to archive.pst on this computer.`);
}

export function sendMail(s: OutlookState, mb: number, connected: boolean): MailResult & { queued?: boolean } {
  if (!canSend(s)) {
    return no(
      `Your mailbox is ${percentUsed(s)}% full and has reached its send limit. Delete items and empty Deleted Items, ` +
        'or archive older mail, before you send.',
    );
  }
  if (s.workOffline || !connected) {
    return { ok: true, queued: true, message: 'The message was placed in the Outbox. It will be sent when Outlook is connected.' };
  }
  s.mailboxUsedMb = round(s.mailboxUsedMb + mb);
  s.sentMb = round((s.sentMb ?? 0) + mb);
  return ok('Message sent.');
}

export function receiveMail(s: OutlookState, mb: number, connected: boolean): MailResult {
  if (s.workOffline) return no('Outlook is working offline. Turn off Work Offline to send and receive.');
  if (!connected) return no('Cannot connect to Microsoft Exchange. Check the network or VPN.');
  if (!canReceive(s)) return no('Your mailbox is full. New messages cannot be delivered until you free up space.');
  const add = round(Math.min(mb, s.quotaMb - s.mailboxUsedMb));
  s.mailboxUsedMb = round(s.mailboxUsedMb + add);
  return ok('Send/Receive complete.');
}

export function addProfile(s: OutlookState, name: string, makeDefault: boolean): MailResult {
  const n = name.trim();
  if (!n) return no('Type a profile name.');
  const list = profilesOf(s);
  if (list.some((p) => p.toLowerCase() === n.toLowerCase())) return no(`A profile named ${n} already exists.`);
  s.profiles = [...list, n];
  if (makeDefault) {
    s.defaultProfile = n;
    // A new profile is a new, healthy .ost: this is how a corrupt one is fixed.
    s.profile = 'ok';
  }
  return ok(`Created profile ${n}${makeDefault ? ' and set it as the default' : ''}.`);
}

export function removeProfile(s: OutlookState, name: string): MailResult {
  const list = profilesOf(s);
  if (list.length <= 1) return no('You cannot remove the only profile. Add a new one first.');
  if (!list.includes(name)) return no(`There is no profile named ${name}.`);
  s.profiles = list.filter((p) => p !== name);
  if ((s.defaultProfile ?? list[0]) === name) s.defaultProfile = s.profiles[0];
  return ok(`Removed profile ${name}.`);
}

export function setDefaultProfile(s: OutlookState, name: string): MailResult {
  if (!profilesOf(s).includes(name)) return no(`There is no profile named ${name}.`);
  s.defaultProfile = name;
  return ok(`Outlook will open with the ${name} profile.`);
}
