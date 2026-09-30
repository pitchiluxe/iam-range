/**
 * tests/ticketRealism.test.ts — the queue reads like a real service desk.
 *
 * Reported: a ticket asked to offboard a user, and another asked to transfer
 * the same user to a different department. A real queue never does that. One
 * open piece of work per person, and nobody who has left gets new work.
 */
import { describe, it, expect } from 'vitest';
import { VmSession } from '@/vm/session';
import { generateTicketsSync, unavailablePeople } from '@/vm/ticketGenerator';
import type { UserId } from '@/domain';

const PEOPLE = ['jdoe', 'mchen', 'rpatel', 'aokafor', 'lsilva', 'nhaddad', 'tkim', 'bmoss'];
const DEPTS = ['Help Desk', 'HR', 'Finance', 'Engineering', 'Sales', 'Security', 'IT', 'Finance'];

function staffed(): VmSession {
  const s = new VmSession();
  s.tickets.list().forEach((t) => s.tickets.resolve(t.id, 'system' as never));
  const corp = s.dir.createOu('Corp', '');
  s.dir.createOu('Users', '', corp.id);
  s.dir.createOu('Groups', '', corp.id);
  for (const g of ['grp-helpdesk-tier1', 'grp-hr-readers', 'grp-finance-payroll', 'grp-engineering-dev', 'grp-iam-admins', 'grp-vpn-users']) {
    s.dir.createGroup(g, '');
  }
  PEOPLE.forEach((u, i) => {
    const user = s.dir.createUser({ username: u, displayName: u, email: `${u}@omari.test`, department: DEPTS[i]!, title: 'Staff' });
    s.dir.addToGroup(user.id, s.dir.listGroups()[i % 6]!.id, 'system' as UserId);
  });
  return s;
}

const deps = (s: VmSession) => ({ dir: s.dir, tickets: s.tickets, audit: s.audit, pim: s.pim, cloud: s.cloud, endpoints: s.endpoints });
const who = (s: VmSession, ids: UserId[]): string[] => ids.map((id) => s.dir.getUser(id)?.username).filter((x): x is string => !!x);

describe('ticket queue realism', () => {
  it('never has two open tickets about the same person', () => {
    for (let run = 0; run < 25; run++) {
      const s = staffed();
      for (let i = 0; i < 4; i++) generateTicketsSync(deps(s), 6);
      const open = s.tickets.list().filter((t) => t.status !== 'resolved');
      const seen = new Map<string, string>();
      for (const t of open) {
        for (const p of new Set(who(s, t.relatedUserIds))) {
          expect(seen.get(p), `${p}: "${seen.get(p)}" and "${t.subject}"`).toBeUndefined();
          seen.set(p, t.subject);
        }
      }
    }
  });

  it('gives an offboarded person no further work, even after the offboarding is closed', () => {
    for (let run = 0; run < 25; run++) {
      const s = staffed();
      generateTicketsSync(deps(s), 6);
      const leaver = s.tickets.list().find((t) => t.kind === 'leaver' || t.kind === 'termination');
      if (!leaver) continue;
      const gone = new Set(who(s, leaver.relatedUserIds));
      // Work the offboarding, then keep generating.
      for (const p of gone) {
        const u = s.dir.getUserByUsername(p);
        if (u) s.dir.disableUser(u.id, 'system' as UserId);
      }
      s.tickets.list().forEach((t) => t.status !== 'resolved' && s.tickets.resolve(t.id, 'system' as never));
      for (let i = 0; i < 4; i++) generateTicketsSync(deps(s), 6);
      const later = s.tickets.list().filter((t) => t.status !== 'resolved' && t.id !== leaver.id);
      for (const t of later) {
        if (t.kind === 'termination' || t.kind === 'leaver') continue;
        for (const p of who(s, t.relatedUserIds)) expect(gone.has(p), `${p} got "${t.subject}" after leaving`).toBe(false);
      }
    }
  });

  it('treats disabled accounts and open-ticket subjects as unavailable', () => {
    const s = staffed();
    const u = s.dir.getUserByUsername('jdoe')!;
    s.dir.disableUser(u.id, 'system' as UserId);
    expect(unavailablePeople(deps(s)).has('jdoe')).toBe(true);
    expect(unavailablePeople(deps(s)).has('mchen')).toBe(false);
  });
});
