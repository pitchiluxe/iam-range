/**
 * tests/mailbox.test.ts — Outlook's space rules, as Exchange counts them.
 */
import { describe, it, expect } from 'vitest';
import {
  addProfile, archiveMail, canSend, deleteMail, emptyDeleted, inboxMb, purgeDeleted, receiveMail,
  removeProfile, sendMail, setDefaultProfile, type OutlookState,
} from '@/services/mailbox';
import { VmSession } from '@/vm/session';

const full = (): OutlookState => ({ profile: 'ok', workOffline: false, quotaMb: 1000, mailboxUsedMb: 950, deletedItemsMb: 200, sentMb: 50 });

describe('mailbox space', () => {
  it('blocks sending at 90% and receiving at 100%', () => {
    const s = full();
    expect(canSend(s)).toBe(false);
    expect(sendMail(s, 1, true).ok).toBe(false);
    s.mailboxUsedMb = 1000;
    expect(receiveMail(s, 1, true).ok).toBe(false);
  });

  it('deleting frees nothing until Deleted Items is emptied', () => {
    const s = full();
    expect(deleteMail(s, 100).ok).toBe(true);
    expect(s.mailboxUsedMb).toBe(950);
    expect(s.deletedItemsMb).toBe(300);
    expect(emptyDeleted(s).ok).toBe(true);
    expect(s.mailboxUsedMb).toBe(650);
    expect(s.deletedItemsMb).toBe(0);
    expect(canSend(s)).toBe(true);
    expect(sendMail(s, 1, true).ok).toBe(true);
    expect(s.sentMb).toBe(51);
  });

  it('archiving moves mail out of the mailbox to archive.pst', () => {
    const s = full();
    const before = inboxMb(s);
    expect(archiveMail(s, 200).ok).toBe(true);
    expect(inboxMb(s)).toBe(before - 200);
    expect(s.mailboxUsedMb).toBe(750);
    expect(s.archivedMb).toBe(200);
  });

  it('purges selected deleted items and queues mail while offline', () => {
    const s = full();
    expect(purgeDeleted(s, 50).ok).toBe(true);
    expect(s.mailboxUsedMb).toBe(900);
    s.mailboxUsedMb = 100;
    s.workOffline = true;
    const r = sendMail(s, 1, true);
    expect(r.ok && (r as { queued?: boolean }).queued).toBe(true);
  });
});

describe('mail profiles', () => {
  it('a new default profile replaces a corrupt one; the last profile cannot be removed', () => {
    const s = full();
    s.profile = 'corrupt';
    expect(removeProfile(s, 'Outlook').ok).toBe(false);
    expect(addProfile(s, 'Outlook2', false).ok).toBe(true);
    expect(addProfile(s, 'outlook2', false).ok).toBe(false);
    expect(setDefaultProfile(s, 'Outlook2').ok).toBe(true);
    expect(addProfile(s, 'Fresh', true).ok).toBe(true);
    expect(s.profile).toBe('ok');
    expect(removeProfile(s, 'Outlook').ok).toBe(true);
  });
});

describe('staff computers', () => {
  it('fix the mailbox-full ticket through the same rules', () => {
    const v = new VmSession(null);
    const u = v.dir.createUser({ username: 'kim.lee', displayName: 'Kim Lee', email: 'kim.lee@omari.test', department: 'HR', title: 'Staff' });
    const e = v.endpoints.ensureFor(u.id)!;
    e.outlook.deletedItemsMb = 9800;
    e.outlook.mailboxUsedMb = e.outlook.quotaMb - 60;
    const actor = v.dir.getUserByUsername('admin')!.id;
    expect(v.endpoints.outlook(e.name, actor, (o) => sendMail(o, 1, true)).ok).toBe(false);
    expect(v.endpoints.emptyDeletedItems(e.name, actor).ok).toBe(true);
    expect(v.endpoints.outlook(e.name, actor, (o) => sendMail(o, 1, true)).ok).toBe(true);
  });
});
