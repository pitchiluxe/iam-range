/**
 * vm/seedTickets.ts — the queue on a freshly installed domain.
 *
 * The directory starts with the administrator and nobody else, so the opening
 * work is what it would really be on day one: create the staff. Tickets that
 * depend on existing people — lockouts, transfers, offboarding — cannot be
 * seeded here, because there is nobody to lock out yet. They arrive once the
 * directory has people in it, generated against accounts that actually exist.
 *
 * That constraint is the same rule the labs enforce: a ticket must never
 * describe a world that is not there.
 */
import type { MockAuditLog, MockDirectory, MockTicketQueue } from '@/services';
import { COMPANY } from '@/config';

interface SeedDeps {
  dir: MockDirectory;
  tickets: MockTicketQueue;
  audit: MockAuditLog;
}

/** New starters waiting to be provisioned on a fresh domain. */
export const FIRST_DAY_STARTERS = [
  {
    logon: 'jdoe',
    display: 'John Doe',
    department: 'Help Desk',
    title: 'Service Desk Analyst',
    group: 'grp-helpdesk-tier1',
  },
  {
    logon: 'mchen',
    display: 'Maya Chen',
    department: 'HR',
    title: 'HR Business Partner',
    group: 'grp-hr-readers',
  },
  {
    logon: 'rpatel',
    display: 'Ravi Patel',
    department: 'Finance',
    title: 'Payroll Analyst',
    group: 'grp-finance-payroll',
  },
] as const;

export function seedStartingTickets({ dir, tickets }: SeedDeps): void {
  const admin = dir.listUsers()[0];
  if (!admin) return;

  const groupId = (name: string) => dir.getGroupByName(name)?.id;

  // One ticket per starter, so each can be worked and closed on its own — and
  // so the queue shows what a real intake looks like rather than one lump.
  for (const s of FIRST_DAY_STARTERS) {
    const g = groupId(s.group);
    tickets.create({
      kind: 'onboarding',
      requesterId: admin.id,
      subject: `New starter: ${s.display} (${s.title})`,
      body:
        `${s.display} joins the ${s.department} team. Create the account ${s.logon} in ` +
        `Active Directory, set a password, and add them to ${s.group}. ` +
        `Then sign out and sign in as ${s.logon} to confirm the account works and that ` +
        `their desktop has the right tools for ${s.department}.`,
      priority: 'normal',
      relatedUserIds: [],
      payload: {
        proposedGroupIds: g ? [g] : [],
        proposedRoleIds: [],
        startDate: Date.now(),
      },
    });
  }

  // A standing note rather than a task: it explains the environment.
  tickets.create({
    kind: 'onboarding',
    requesterId: admin.id,
    subject: `Welcome — ${COMPANY.name} domain is ready`,
    body:
      `The ${COMPANY.domain} domain has been built and you are the only account in it. ` +
      `Everyone you create in Active Directory can sign in at the lock screen with the ` +
      `password you set, and their desktop is decided by the department you put them in. ` +
      `Work the onboarding tickets first — the rest of the queue needs people to exist.`,
    priority: 'low',
    relatedUserIds: [],
    payload: { proposedGroupIds: [], proposedRoleIds: [], startDate: Date.now() },
  });
}
