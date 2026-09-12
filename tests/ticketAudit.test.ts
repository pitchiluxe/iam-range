/**
 * tests/ticketAudit.test.ts — an audit of the queue, the reviewer and the
 * directory operations behind them.
 *
 * The theme running through every case here is the one the codebase already
 * names in ticketReview's exhaustiveness guard: *a vacuous check is worse than
 * no check, because it produces a green verdict the learner calibrates on.*
 * That guard was added for one branch. The same failure had been left standing
 * in six other places, and each of them lets a ticket close on evidence that
 * proves nothing:
 *
 *   - a review with no checks at all passes, because `[].every()` is true;
 *   - "Password was reset" accepts a reset from any time, including one from
 *     the last ticket about the same person;
 *   - "New access granted" and "Old access removed" do the same;
 *   - `removeFromGroup` writes the audit event that satisfies "Old access
 *     removed" even when the account was never in the group;
 *   - an account can be moved into an OU that does not exist, which removes it
 *     from the console entirely; and
 *   - a resolved ticket can be silently reopened by assigning it.
 *
 * Plus one that only bites with the model running: the generator de-duplicates
 * on subject text and then lets Ollama rewrite the subject, so every scenario
 * is raised again on the next pass.
 */
import { describe, it, expect } from 'vitest';
import { VmSession } from '@/vm/session';
import { MockAuditLog, MockDirectory, MockTicketQueue } from '@/services';
import { reviewTicketSync } from '@/vm/ticketReview';
import type { Ticket, UserId } from '@/domain';

const ACTOR = 'admin-1' as UserId;

function deps(s: VmSession) {
  return { dir: s.dir, audit: s.audit, pim: s.pim, cloud: s.cloud };
}

/** A staffed domain with one person to raise tickets about. */
function staffed() {
  const s = new VmSession();
  const corp = s.dir.createOu('Corp', 'Corporate', undefined, ACTOR);
  const usersOu = s.dir.createOu('Users', 'Staff', corp.id, ACTOR);
  const groupsOu = s.dir.createOu('Groups', 'Groups', corp.id, ACTOR);
  const oldGroup = s.dir.createGroup('grp-helpdesk-tier1', 'Desk', ACTOR, groupsOu.id);
  const newGroup = s.dir.createGroup('grp-finance-payroll', 'Payroll', ACTOR, groupsOu.id);
  const user = s.dir.createUser(
    {
      username: 'jdoe',
      displayName: 'John Doe',
      email: 'jdoe@omari.test',
      department: 'Help Desk',
      title: 'Analyst',
      ouId: usersOu.id,
    },
    ACTOR,
  );
  return { s, corp, usersOu, groupsOu, oldGroup, newGroup, user };
}

/**
 * Raise a ticket that the directory work must post-date.
 *
 * The reviewer bounds its evidence on `createdAt`, and a test that does the
 * work microseconds before the ticket is raised cannot tell a bound that works
 * from one that does not. Pushing the timestamp forward makes "before the
 * ticket" unambiguous.
 */
function ticketRaisedAfter(
  queue: MockTicketQueue,
  requesterId: UserId,
  t: { kind: Ticket['kind']; subject: string; body: string; relatedUserIds: UserId[] },
): Ticket {
  const ticket = queue.create({
    kind: t.kind as 'onboarding',
    requesterId,
    subject: t.subject,
    body: t.body,
    relatedUserIds: t.relatedUserIds,
    payload: { proposedGroupIds: [], proposedRoleIds: [], startDate: Date.now() },
  });
  (ticket as { createdAt: number }).createdAt = Date.now() + 5_000;
  return ticket;
}

describe('a review with nothing in it', () => {
  it('does not pass', () => {
    // [].every() is true, so a kind whose checks all sat behind an optional
    // service returned a green verdict having examined nothing. An incident
    // ticket on a host with no cloud tenant did exactly that.
    const audit = new MockAuditLog();
    const dir = new MockDirectory(audit);
    const queue = new MockTicketQueue(audit);
    const u = dir.createUser(
      {
        username: 'jdoe',
        displayName: 'John Doe',
        email: 'jdoe@omari.test',
        department: 'Security',
        title: 'Analyst',
      },
      ACTOR,
    );
    const ticket = queue.create({
      kind: 'incident' as 'onboarding',
      requesterId: ACTOR,
      subject: 'Duplicate identity for jdoe',
      body: 'Two objects exist for jdoe.',
      relatedUserIds: [u.id],
      payload: { proposedGroupIds: [], proposedRoleIds: [], startDate: Date.now() },
    });

    // No cloud in deps: the incident branch has nothing to check.
    const review = reviewTicketSync(ticket, { dir, audit }, ACTOR);
    expect(review.checks.length).toBeGreaterThan(0);
    expect(review.passed).toBe(false);
  });
});

describe('evidence has to post-date the ticket', () => {
  it('does not accept a password reset from before the ticket was raised', () => {
    const { s, user } = staffed();
    // A reset from an earlier lockout, already in the log.
    s.idp.resetPassword(user.id, 'Old-Reset-1!', { forceChangeAtNextLogin: false }, ACTOR);

    const ticket = ticketRaisedAfter(s.tickets, ACTOR, {
      kind: 'password-reset',
      subject: 'Account locked out: jdoe',
      body: 'jdoe cannot sign in. Unlock and reset.',
      relatedUserIds: [user.id],
    });

    const review = reviewTicketSync(ticket, deps(s), ACTOR);
    expect(review.checks.find((c) => c.label === 'Password was reset')?.passed).toBe(false);
  });

  it('accepts one done after it', () => {
    const { s, user } = staffed();
    const ticket = s.tickets.create({
      kind: 'password-reset' as 'onboarding',
      requesterId: ACTOR,
      subject: 'Account locked out: jdoe',
      body: 'jdoe cannot sign in.',
      relatedUserIds: [user.id],
      payload: { proposedGroupIds: [], proposedRoleIds: [], startDate: Date.now() },
    });
    s.idp.resetPassword(user.id, 'Recovered-2026!', { forceChangeAtNextLogin: false }, ACTOR);

    const review = reviewTicketSync(ticket, deps(s), ACTOR);
    expect(review.checks.find((c) => c.label === 'Password was reset')?.passed).toBe(true);
  });

  it('does not accept group changes from before the ticket was raised', () => {
    const { s, user, oldGroup, newGroup } = staffed();
    // Onboarding put them in a group, and a previous transfer took one away.
    s.dir.addToGroup(user.id, oldGroup.id, ACTOR);
    s.dir.addToGroup(user.id, newGroup.id, ACTOR);
    s.dir.removeFromGroup(user.id, newGroup.id, ACTOR);

    const ticket = ticketRaisedAfter(s.tickets, ACTOR, {
      kind: 'transfer',
      subject: 'Transfer: jdoe moves department',
      body: 'jdoe is changing team.',
      relatedUserIds: [user.id],
    });

    const review = reviewTicketSync(ticket, deps(s), ACTOR);
    // Every one of these would have passed on history alone.
    expect(review.checks.find((c) => c.label === 'New access granted')?.passed).toBe(false);
    expect(review.checks.find((c) => c.label === 'Old access removed')?.passed).toBe(false);
    expect(review.passed).toBe(false);
  });
});

describe('removing somebody from a group they were never in', () => {
  it('records nothing, so it cannot stand as evidence of a removal', () => {
    // The audit event is what "Old access removed" looks for. Writing one for
    // a removal that removed nothing turns the check into a formality: run
    // the cmdlet against any group at all and the transfer closes.
    const { s, user, newGroup } = staffed();
    const before = s.audit.events.length;
    s.dir.removeFromGroup(user.id, newGroup.id, ACTOR);
    const written = s.audit.events.slice(before).filter((e) => e.action === 'group.remove');
    expect(written).toEqual([]);
  });

  it('still records one when they really were in it', () => {
    const { s, user, oldGroup } = staffed();
    s.dir.addToGroup(user.id, oldGroup.id, ACTOR);
    const before = s.audit.events.length;
    s.dir.removeFromGroup(user.id, oldGroup.id, ACTOR);
    expect(
      s.audit.events.slice(before).filter((e) => e.action === 'group.remove'),
    ).toHaveLength(1);
  });

  it('does not record a second join for somebody already in the group', () => {
    const { s, user, oldGroup } = staffed();
    s.dir.addToGroup(user.id, oldGroup.id, ACTOR);
    const before = s.audit.events.length;
    s.dir.addToGroup(user.id, oldGroup.id, ACTOR);
    expect(s.audit.events.slice(before).filter((e) => e.action === 'group.add')).toEqual([]);
  });
});

describe('moving an account into an OU that does not exist', () => {
  it('is refused, as it is for a group', () => {
    // setGroupOu validates; setUserOu did not. An account with an ouId that
    // matches no OU is in no container the console draws: not in CN=Users,
    // which lists accounts with no ouId, and not in any OU. It disappears.
    const { s, user } = staffed();
    expect(() => s.dir.setUserOu(user.id, 'ou-nope' as never, ACTOR)).toThrow(/not found/);
  });

  it('leaves the account where it was', () => {
    const { s, user, usersOu } = staffed();
    try {
      s.dir.setUserOu(user.id, 'ou-nope' as never, ACTOR);
    } catch {
      /* expected */
    }
    expect(s.dir.getUser(user.id)?.ouId).toBe(usersOu.id);
  });

  it('still allows a move out to CN=Users', () => {
    const { s, user } = staffed();
    s.dir.setUserOu(user.id, undefined, ACTOR);
    expect(s.dir.getUser(user.id)?.ouId).toBeUndefined();
  });

  it('never leaves an account pointing at an OU nobody can see', () => {
    // The property behind all of the above, stated directly.
    const { s } = staffed();
    const ouIds = new Set(s.dir.listOus().map((o) => o.id));
    for (const u of s.dir.listUsers()) {
      if (u.ouId) expect(ouIds.has(u.ouId), `${u.username} → ${u.ouId}`).toBe(true);
    }
  });
});

describe('a resolved ticket stays resolved', () => {
  it('is not reopened by assigning it', () => {
    // 'Assign all to me' is a bulk action over whatever is selected, and
    // assign() set status to 'in-progress' unconditionally — with no audit
    // event, so a closed ticket reopened and nothing recorded that it had.
    const { s, user } = staffed();
    const ticket = s.tickets.create({
      kind: 'password-reset' as 'onboarding',
      requesterId: ACTOR,
      subject: 'Account locked out: jdoe',
      body: 'jdoe cannot sign in.',
      relatedUserIds: [user.id],
      payload: { proposedGroupIds: [], proposedRoleIds: [], startDate: Date.now() },
    });
    s.tickets.resolve(ticket.id, ACTOR);
    s.tickets.assign(ticket.id, ACTOR);
    expect(s.tickets.get(ticket.id)?.status).toBe('resolved');
  });

  it('is not resolved twice in the audit log', () => {
    // The count at the end of a lab is read off these events.
    const { s, user } = staffed();
    const ticket = s.tickets.create({
      kind: 'password-reset' as 'onboarding',
      requesterId: ACTOR,
      subject: 'Account locked out: jdoe',
      body: 'jdoe cannot sign in.',
      relatedUserIds: [user.id],
      payload: { proposedGroupIds: [], proposedRoleIds: [], startDate: Date.now() },
    });
    s.tickets.resolve(ticket.id, ACTOR);
    s.tickets.resolve(ticket.id, ACTOR);
    expect(
      s.audit.events.filter((e) => e.action === 'ticket.resolved' && e.targetId === ticket.id),
    ).toHaveLength(1);
  });
});

describe('which accounts a ticket is about', () => {
  it('does not pull in an account whose name is a fragment of another', () => {
    // Substring matching. `haystack.includes('jdoe')` is true of a ticket
    // about jdoe2, so the review of one account silently graded another —
    // and a check that fails on the wrong person is unanswerable.
    const { s } = staffed();
    const other = s.dir.createUser(
      {
        username: 'jdoe2',
        displayName: 'Jane Doe',
        email: 'jdoe2@omari.test',
        department: 'HR',
        title: 'Advisor',
      },
      ACTOR,
    );
    const ticket = s.tickets.create({
      kind: 'onboarding',
      requesterId: ACTOR,
      subject: 'New starter: jdoe2',
      body: 'Please provision jdoe2 for HR.',
      relatedUserIds: [],
      payload: { proposedGroupIds: [], proposedRoleIds: [], startDate: Date.now() },
    });

    const review = reviewTicketSync(ticket, deps(s), ACTOR);
    const mentioned = review.checks.map((c) => c.detail).join(' ');
    expect(mentioned).toContain('jdoe2');
    // jdoe is a different person and this ticket is not about them.
    expect(mentioned).not.toMatch(/\bjdoe\b/);
    expect(other.username).toBe('jdoe2');
  });

  it('does not read the word "administrator" as the admin account', () => {
    const { s } = staffed();
    const ticket = s.tickets.create({
      kind: 'access-request' as 'onboarding',
      requesterId: ACTOR,
      subject: 'Access request',
      body: 'The administrator should review this request.',
      relatedUserIds: [],
      payload: { proposedGroupIds: [], proposedRoleIds: [], startDate: Date.now() },
    });
    const review = reviewTicketSync(ticket, deps(s), ACTOR);
    // Nobody is named, so the reviewer says so rather than grading admin.
    expect(review.checks.map((c) => c.label)).toContain('Subject identified');
  });
});

describe('a group name is a name, not an exact string', () => {
  it('is found whatever case it is typed in', () => {
    // getUserByUsername and getOuByName were already case-insensitive; this
    // was the last exact-match lookup. `Add-ADGroupMember -Group
    // GRP-HR-READERS` reported that the group did not exist while the console
    // listed it two panes away.
    const { s, groupsOu } = staffed();
    s.dir.createGroup('grp-hr-readers', 'HR', ACTOR, groupsOu.id);
    expect(s.dir.getGroupByName('GRP-HR-READERS')?.name).toBe('grp-hr-readers');
    expect(s.dir.getGroupByName('Grp-Hr-Readers')?.name).toBe('grp-hr-readers');
  });

  it('refuses a second group with the same name', () => {
    // The id is derived from the name, so the second one replaced the first
    // in the map and took its whole membership with it — no error, no audit
    // event, and the members simply gone.
    const { s, user, oldGroup } = staffed();
    s.dir.addToGroup(user.id, oldGroup.id, ACTOR);
    expect(() => s.dir.createGroup('grp-helpdesk-tier1', 'Duplicate', ACTOR)).toThrow(
      /already exists/,
    );
    expect(s.dir.getGroupByName('grp-helpdesk-tier1')?.memberIds).toContain(user.id);
  });

  it('refuses one that differs only in case', () => {
    const { s } = staffed();
    expect(() => s.dir.createGroup('GRP-HELPDESK-TIER1', 'Shouty', ACTOR)).toThrow(
      /already exists/,
    );
  });

  it('lets a seed re-run without destroying what is there', () => {
    // Seeds compose, so applyBaseline can run twice. ensureGroup is the
    // idempotent door, matching ensureUser.
    const { s, user, oldGroup } = staffed();
    s.dir.addToGroup(user.id, oldGroup.id, ACTOR);
    const again = s.dir.ensureGroup('grp-helpdesk-tier1', 'Desk', ACTOR);
    expect(again.id).toBe(oldGroup.id);
    expect(again.memberIds).toContain(user.id);
    expect(s.dir.listGroups().filter((g) => g.name === 'grp-helpdesk-tier1')).toHaveLength(1);
  });
});
