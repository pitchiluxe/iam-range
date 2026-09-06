/**
 * vm/seedTickets.ts — the queue an operator finds waiting on Monday morning.
 *
 * A workstation with an empty ticket queue has nothing to do, so the session
 * seeds a small realistic backlog. Every ticket here obeys the rules the 3D lab
 * learned the hard way:
 *
 *   - it names accounts that exist in the directory (except onboarding, whose
 *     whole point is an account that does not exist yet)
 *   - its payload points at the SUBJECT, not whoever raised it
 *   - if the prose claims evidence — failed sign-ins, a lockout — that evidence
 *     is really in the audit log and the account is really in that state
 *
 * A ticket describing something the world does not contain sends the operator
 * looking for evidence that was never there.
 */
import type { GroupId, RoleId, UserId } from '@/domain';
import type { MockAuditLog, MockDirectory, MockTicketQueue } from '@/services';

interface SeedDeps {
  dir: MockDirectory;
  tickets: MockTicketQueue;
  audit: MockAuditLog;
}

/** Record `count` failed sign-ins for a user, so the log matches the story. */
function recordFailedSignIns(
  audit: MockAuditLog,
  userId: UserId,
  count: number,
  ip: string,
): void {
  for (let i = 0; i < count; i++) {
    audit.record({ actorId: userId, action: 'signin.failure', targetId: userId, ip });
  }
}

/**
 * Raise the starting backlog. Safe to call on a freshly seeded directory only —
 * it looks accounts up by username and skips any ticket whose subject is
 * missing rather than inventing one.
 */
export function seedStartingTickets({ dir, tickets, audit }: SeedDeps): void {
  const by = (username: string) => dir.getUserByUsername(username);
  const groupId = (name: string): GroupId | undefined => dir.getGroupByName(name)?.id;

  const helpdesk = by('dan.rivera') ?? by('admin');
  const manager = by('cara.patel') ?? by('admin');
  if (!helpdesk || !manager) return;

  // ── 1. Lockout. The account is genuinely locked and the failures are real,
  //       so Unlock-ADAccount is the correct remedy and the log backs it up.
  const locked = by('greta.olsen');
  if (locked) {
    locked.status = 'locked';
    recordFailedSignIns(audit, locked.id, 5, '10.20.4.88');
    tickets.create({
      kind: 'password-reset',
      requesterId: helpdesk.id,
      subject: 'Account locked out: Greta Olsen (CFO)',
      body:
        'Greta Olsen (greta.olsen) is locked out after repeated failed sign-ins. ' +
        'Check the audit log for the attempts, unlock the account, and reset her ' +
        'password with a forced change at next sign-in. She is the CFO — treat as urgent.',
      priority: 'urgent',
      relatedUserIds: [locked.id],
      payload: { userId: locked.id, method: 'helpdesk' },
    });
  }

  // ── 2. Access request, filed on someone else's behalf.
  const requester = by('erin.cho');
  const payrollRole = dir.getRoleByName('grp-finance-payroll')?.id;
  if (requester) {
    tickets.create({
      kind: 'access-request',
      requesterId: manager.id,
      subject: 'Finance Portal access for Erin Cho',
      body:
        'Erin Cho (erin.cho) needs access to the Finance Portal to cover month-end ' +
        'reporting. Approved by her manager. Grant the minimum that gets the job ' +
        'done and record what you granted.',
      priority: 'normal',
      relatedUserIds: [requester.id],
      payload: {
        userId: requester.id,
        requestedRoleIds: payrollRole ? [payrollRole] : ([] as RoleId[]),
        justification: 'Month-end reporting cover, manager approved.',
      },
    });
  }

  // ── 3. Onboarding. The subject deliberately does not exist yet.
  const financeGroup = groupId('grp-finance-payroll');
  tickets.create({
    kind: 'onboarding',
    requesterId: manager.id,
    subject: 'New starter: Priya Raman (Finance Analyst)',
    body:
      'Priya Raman starts Monday as a Finance Analyst. Create priya.raman, add her ' +
      'to grp-finance-payroll, and confirm she can sign in. Three more starters ' +
      'follow next week — consider doing this in PowerShell ISE rather than by hand.',
    priority: 'normal',
    relatedUserIds: [],
    payload: {
      proposedGroupIds: financeGroup ? [financeGroup] : [],
      proposedRoleIds: payrollRole ? [payrollRole] : [],
      startDate: Date.now() + 3 * 24 * 60 * 60 * 1000,
    },
  });

  // ── 4. MFA device replacement.
  const mfaUser = by('finn.muller');
  if (mfaUser) {
    tickets.create({
      kind: 'mfa-issue',
      requesterId: mfaUser.id,
      subject: 'Lost phone — MFA re-enrolment for Finn Müller',
      body:
        'Finn Müller (finn.muller) lost the phone holding his authenticator. Clear ' +
        'the existing registration so he can enrol on the new device. Clearing the ' +
        'registration is not the same as turning MFA off — do not disable the policy.',
      priority: 'high',
      relatedUserIds: [mfaUser.id],
      payload: { userId: mfaUser.id, symptom: 'lost-device' },
    });
  }

  // ── 5. Leaver.
  const leaver = by('bob.sato');
  if (leaver) {
    tickets.create({
      kind: 'leaver',
      requesterId: manager.id,
      subject: 'Offboarding: Bob Sato — last day today',
      body:
        'Bob Sato (bob.sato) leaves today. Disable the account and revoke his active ' +
        'sessions. Order matters: a disabled account with a live session can still ' +
        'be used until that session is killed.',
      priority: 'high',
      relatedUserIds: [leaver.id],
      payload: { userId: leaver.id, lastDay: Date.now(), revokeSessions: true },
    });
  }

  // ── 6. Department transfer.
  const mover = by('jane.doe');
  if (mover) {
    tickets.create({
      kind: 'transfer',
      requesterId: manager.id,
      subject: 'Transfer: Jane Doe, Finance to Engineering',
      body:
        'Jane Doe (jane.doe) moves to Engineering on Monday. Update her department ' +
        'and adjust group membership. Remember to remove the access she no longer ' +
        'needs, not just add the new — stale access after a move is how privilege creeps.',
      priority: 'normal',
      relatedUserIds: [mover.id],
      payload: {
        userId: mover.id,
        fromDepartment: mover.department,
        toDepartment: 'Engineering',
      },
    });
  }
}
