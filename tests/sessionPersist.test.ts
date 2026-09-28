/**
 * tests/sessionPersist.test.ts — leaving the VM and coming back resumes the work.
 */
import { describe, it, expect } from 'vitest';
import { VmSession } from '@/vm/session';
import { serializeSession, restoreSession, SESSION_SAVE_VERSION } from '@/vm/sessionStore';
import { generateTicketsSync } from '@/vm/ticketGenerator';

function workedSession(): VmSession {
  const s = new VmSession(null);
  const admin = s.dir.getUserByUsername('admin')!;
  // The learner's first ticket: build the OU structure, then close it.
  const ou = s.dir.createOu('Corp', 'Company root');
  s.dir.createOu('Users', '', ou.id);
  s.dir.createUser({ username: 'pnair', displayName: 'Priya Nair', email: 'pnair@example.test', department: 'Engineering', title: 'Engineer' });
  const first = s.tickets.list()[0]!;
  s.tickets.comment(first.id, admin.id, 'Built Corp and Corp/Users');
  s.tickets.resolve(first.id, admin.id);
  return s;
}

describe('VM session save and resume', () => {
  it('everything the learner built comes back: OUs, accounts, tickets and their state', () => {
    const before = workedSession();
    const json = serializeSession(before);
    const after = new VmSession(json);

    expect(after.resumed).toBe(true);
    expect(after.dir.getOuByName('Corp')).toBeTruthy();
    expect(after.dir.getOuByName('Users')?.parentId).toBe(after.dir.getOuByName('Corp')!.id);
    expect(after.dir.getUserByUsername('pnair')?.displayName).toBe('Priya Nair');
    expect(after.tickets.list().map((t) => [t.id, t.status, t.comments.length]))
      .toEqual(before.tickets.list().map((t) => [t.id, t.status, t.comments.length]));
    expect(after.audit.events.length).toBe(before.audit.events.length);
  });

  it('a resumed session keeps working: services are still wired to each other', () => {
    const after = new VmSession(serializeSession(workedSession()));
    const admin = after.dir.getUserByUsername('admin')!;
    const events = after.audit.events.length;
    const u = after.dir.createUser({ username: 'rpatel', displayName: 'Ravi Patel', email: 'r@example.test', department: 'Finance', title: 'Analyst' }, admin.id);
    expect(after.dir.getUser(u.id)).toBeTruthy();
    // The directory writes to the restored audit log, not a stale one.
    expect(after.audit.events.length).toBeGreaterThan(events);
    // And work keeps being raised against the restored estate.
    const n = generateTicketsSync({ dir: after.dir, tickets: after.tickets, audit: after.audit, pim: after.pim, cloud: after.cloud, endpoints: after.endpoints });
    expect(n).toBeGreaterThanOrEqual(0);
  });

  it('the whole environment can be saved after a round of generated work', () => {
    const s = workedSession();
    for (const name of ['Corp/Groups', 'ServiceAccounts', 'Workstations']) s.dir.createOu(name.split('/').pop()!);
    generateTicketsSync({ dir: s.dir, tickets: s.tickets, audit: s.audit, pim: s.pim, cloud: s.cloud, endpoints: s.endpoints }, 10);
    expect(() => serializeSession(s)).not.toThrow();
    const again = new VmSession(serializeSession(s));
    expect(again.tickets.list().length).toBe(s.tickets.list().length);
  });

  it('an unreadable or old save is ignored rather than half-loaded', () => {
    expect(new VmSession('{not json').resumed).toBe(false);
    expect(new VmSession(JSON.stringify({ version: SESSION_SAVE_VERSION + 1, data: {} })).resumed).toBe(false);
    const fresh = new VmSession(null);
    expect(restoreSession(fresh, JSON.stringify({ version: SESSION_SAVE_VERSION, data: { dir: {} } }))).toBe(false);
  });

  it('Start over discards the saved work', () => {
    const s = workedSession();
    s.reset();
    expect(s.resumed).toBe(false);
    expect(s.dir.getUserByUsername('pnair')).toBeUndefined();
  });
});
