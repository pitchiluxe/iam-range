/**
 * tests/ticketReview.test.ts — the reviewer has to be hard to fool.
 *
 * Its whole value is refusing to approve work that was not done. A reviewer
 * that passes a half-finished offboarding teaches the learner that a
 * half-finished offboarding is fine, which is worse than having no reviewer at
 * all — so most of these tests are about the failures.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { VmSession } from '@/vm/session';
import { reviewTicketSync } from '@/vm/ticketReview';
import type { Ticket, TicketId, UserId } from '@/domain';

const ACTOR = 'system' as UserId;

function setup() {
  const s = new VmSession();
  s.tickets.list().forEach((t) => s.tickets.resolve(t.id, ACTOR));
  s.dir.createOu('Corp', 'Top level');
  s.dir.createGroup('grp-helpdesk-tier1', 'Service desk');
  return s;
}

function deps(s: VmSession) {
  return { dir: s.dir, audit: s.audit, pim: s.pim, cloud: s.cloud };
}

/** A ticket of a given kind naming one account. */
function ticketFor(s: VmSession, kind: Ticket['kind'], userId: UserId, subject: string): Ticket {
  const admin = s.dir.getUserByUsername('admin')!;
  return s.tickets.create({
    kind: kind as 'onboarding',
    requesterId: admin.id,
    subject,
    body: subject,
    priority: 'normal',
    relatedUserIds: [userId],
    payload: { proposedGroupIds: [], proposedRoleIds: [], startDate: Date.now() } as never,
  });
}

describe('onboarding review', () => {
  let s: VmSession;
  let user: ReturnType<VmSession['dir']['createUser']>;

  beforeEach(() => {
    s = setup();
    user = s.dir.createUser({
      username: 'jdoe',
      displayName: 'John Doe',
      email: 'jdoe@iamlab.com',
      department: 'Help Desk',
      title: 'Analyst',
      mfa: 'none',
    });
  });

  it('refuses an account with no access and no place in the structure', () => {
    // Creating the object is the easy half. This is the state a learner
    // reaches when they stop there.
    const ticket = ticketFor(s, 'onboarding', user.id, 'Onboard jdoe');
    const review = reviewTicketSync(ticket, deps(s), ACTOR);

    expect(review.passed).toBe(false);
    expect(review.checks.filter((c) => !c.passed).map((c) => c.label)).toEqual([
      'Access granted',
      'Placed in the structure',
    ]);
  });

  it('passes once the account is grouped and placed', () => {
    const group = s.dir.getGroupByName('grp-helpdesk-tier1')!;
    s.dir.addToGroup(user.id, group.id, ACTOR);
    const ou = s.dir.listOus()[0]!;
    s.dir.setUserOu(user.id, ou.id, ACTOR);

    const review = reviewTicketSync(ticketFor(s, 'onboarding', user.id, 'Onboard jdoe'), deps(s), ACTOR);
    expect(review.passed).toBe(true);
  });
});

describe('termination review', () => {
  let s: VmSession;
  let user: ReturnType<VmSession['dir']['createUser']>;

  beforeEach(() => {
    s = setup();
    user = s.dir.createUser({
      username: 'rpatel',
      displayName: 'Ravi Patel',
      email: 'rpatel@iamlab.com',
      department: 'Finance',
      title: 'Analyst',
      mfa: 'none',
    });
    s.cloud.okta.connect();
    s.cloud.okta.grantAppAccount('HR Portal', 'rpatel@iamlab.com');
    s.cloud.okta.sync(ACTOR);
    s.cloud.okta.openSession('rpatel@iamlab.com');
  });

  it('refuses an account that is only disabled on premises', () => {
    // The classic half-done leaver: disabled in the directory, still live in
    // the tenant, session open, application account untouched.
    s.dir.disableUser(user.id, ACTOR);
    const review = reviewTicketSync(ticketFor(s, 'termination', user.id, 'Offboard rpatel'), deps(s), ACTOR);

    expect(review.passed).toBe(false);
    const failed = review.checks.filter((c) => !c.passed).map((c) => c.label);
    expect(failed).toContain('Disabled in the tenant');
    expect(failed).toContain('Sessions revoked');
  });

  it('still refuses when the app account survives the sync', () => {
    // SCIM is off, so the tenant deactivates nobody inside the application.
    s.dir.disableUser(user.id, ACTOR);
    s.cloud.okta.sync(ACTOR);
    s.cloud.okta.revokeSessions('rpatel@iamlab.com', ACTOR);

    const review = reviewTicketSync(ticketFor(s, 'termination', user.id, 'Offboard rpatel'), deps(s), ACTOR);
    expect(review.passed).toBe(false);
    expect(review.checks.filter((c) => !c.passed).map((c) => c.label)).toEqual([
      'Applications deprovisioned',
    ]);
  });

  it('passes when every route is closed', () => {
    s.dir.disableUser(user.id, ACTOR);
    s.cloud.okta.setScim('HR Portal', true, ACTOR);
    s.cloud.okta.sync(ACTOR);
    s.cloud.okta.revokeSessions('rpatel@iamlab.com', ACTOR);

    const review = reviewTicketSync(ticketFor(s, 'termination', user.id, 'Offboard rpatel'), deps(s), ACTOR);
    expect(review.passed).toBe(true);
  });
});

describe('transfer review', () => {
  it('refuses when only the additions were done', () => {
    // The half people skip. Adding without removing is how privilege
    // accumulates, so a reviewer that passes it teaches the wrong habit.
    const s = setup();
    const user = s.dir.createUser({
      username: 'mchen',
      displayName: 'Maya Chen',
      email: 'mchen@iamlab.com',
      department: 'HR',
      title: 'Partner',
      mfa: 'none',
    });
    const group = s.dir.getGroupByName('grp-helpdesk-tier1')!;
    s.dir.addToGroup(user.id, group.id, ACTOR);

    const review = reviewTicketSync(ticketFor(s, 'transfer', user.id, 'Move mchen'), deps(s), ACTOR);
    expect(review.passed).toBe(false);
    // The move itself is now checked too. Swapping group membership without
    // moving the account leaves the directory disagreeing with the org chart,
    // which is the other half people skip.
    expect(review.checks.filter((c) => !c.passed).map((c) => c.label)).toEqual([
      'Old access removed',
      'Account was moved',
    ]);
  });

  it('passes when the access was swapped and the account actually moved', () => {
    const s = setup();
    const user = s.dir.createUser({
      username: 'mchen',
      displayName: 'Maya Chen',
      email: 'mchen@iamlab.com',
      department: 'HR',
      title: 'Partner',
      mfa: 'none',
    });
    const oldGroup = s.dir.getGroupByName('grp-helpdesk-tier1')!;
    const newGroup = s.dir.createGroup('grp-hr-readers', 'HR read access', ACTOR);
    s.dir.addToGroup(user.id, oldGroup.id, ACTOR);
    s.dir.removeFromGroup(user.id, oldGroup.id, ACTOR);
    s.dir.addToGroup(user.id, newGroup.id, ACTOR);
    s.dir.moveUser(user.id, 'HR', ACTOR);

    const review = reviewTicketSync(ticketFor(s, 'transfer', user.id, 'Move mchen'), deps(s), ACTOR);
    expect(review.passed).toBe(true);
  });

  it('holds a mover to the same standard as a transfer', () => {
    // Two names for one event. Sharing the branch is what stops them drifting
    // into different standards for identical work -- 'mover' used to fall
    // through to "something happened", which any change at all satisfied.
    const s = setup();
    const user = s.dir.createUser({
      username: 'dpark',
      displayName: 'Dan Park',
      email: 'dpark@iamlab.com',
      department: 'Finance',
      title: 'Analyst',
      mfa: 'none',
    });
    s.dir.addToGroup(user.id, s.dir.getGroupByName('grp-helpdesk-tier1')!.id, ACTOR);

    const review = reviewTicketSync(ticketFor(s, 'mover', user.id, 'Move dpark'), deps(s), ACTOR);
    expect(review.passed).toBe(false);
    expect(review.checks.map((c) => c.label)).toContain('Account was moved');
  });
});

describe('mfa-issue review', () => {
  /*
   * This kind used to fall through to "something in the audit log touched
   * this account", which any change at all satisfied. Renaming the person
   * passed an MFA ticket.
   */
  function withUser() {
    const s = setup();
    const user = s.dir.createUser({
      username: 'lnguyen',
      displayName: 'Linh Nguyen',
      email: 'lnguyen@iamlab.com',
      department: 'Sales',
      title: 'Rep',
      mfa: 'totp',
    });
    return { s, user };
  }

  it('refuses when nothing was reset', () => {
    const { s, user } = withUser();
    const review = reviewTicketSync(ticketFor(s, 'mfa-issue', user.id, 'MFA broken'), deps(s), ACTOR);
    expect(review.passed).toBe(false);
    expect(review.checks.filter((c) => !c.passed).map((c) => c.label)).toContain(
      'Registration was cleared',
    );
  });

  it('refuses when the registration was cleared and left cleared', () => {
    // Clearing the old factor is the fix; stopping there leaves the account
    // weaker than before the ticket was raised.
    //
    // The ticket is raised first on purpose. The rule only counts work done
    // after it was raised -- a reset from last week does not resolve today's
    // ticket -- so doing the work first tests nothing.
    const { s, user } = withUser();
    const ticket = ticketFor(s, 'mfa-issue', user.id, 'MFA broken');
    s.idp.resetMfa(user.id, ACTOR);

    const review = reviewTicketSync(ticket, deps(s), ACTOR);
    expect(review.passed).toBe(false);
    expect(review.checks.filter((c) => !c.passed).map((c) => c.label)).toContain(
      'A second factor is in place',
    );
  });

  it('passes once it is cleared and re-enrolled', () => {
    const { s, user } = withUser();
    const ticket = ticketFor(s, 'mfa-issue', user.id, 'MFA broken');
    s.idp.resetMfa(user.id, ACTOR);
    s.idp.enrollMfa(user.id, 'totp', ACTOR);

    const review = reviewTicketSync(ticket, deps(s), ACTOR);
    expect(review.passed).toBe(true);
  });
});

describe('leaver review', () => {
  it('is held to the same standard as a termination', () => {
    // Two names for one event. 'leaver' used to reach the generic fallback,
    // so disabling the account on premises and stopping there passed — the
    // exact half-done offboarding the termination checks exist to catch.
    const s = setup();
    const user = s.dir.createUser({
      username: 'rpatel',
      displayName: 'Ravi Patel',
      email: 'rpatel@iamlab.com',
      department: 'Finance',
      title: 'Analyst',
      mfa: 'none',
    });
    s.cloud.okta.connect();
    s.cloud.okta.grantAppAccount('HR Portal', 'rpatel@iamlab.com');
    s.cloud.okta.sync(ACTOR);
    s.cloud.okta.openSession('rpatel@iamlab.com');
    s.dir.disableUser(user.id, ACTOR);

    const review = reviewTicketSync(ticketFor(s, 'leaver', user.id, 'Offboard rpatel'), deps(s), ACTOR);
    expect(review.passed).toBe(false);
    const failed = review.checks.filter((c) => !c.passed).map((c) => c.label);
    expect(failed).toContain('Disabled in the tenant');
    expect(failed).toContain('Sessions revoked');
  });
});

describe('the reviewer records what it looked at', () => {
  it('writes every check to the audit log, not only the verdict', () => {
    // A reviewer that says "failed" without saying what it checked is asking
    // to be taken on trust, which is the opposite of what this teaches.
    const s = setup();
    const user = s.dir.createUser({
      username: 'aokafor',
      displayName: 'Ada Okafor',
      email: 'aokafor@iamlab.com',
      department: 'Engineering',
      title: 'Engineer',
      mfa: 'none',
    });

    const before = s.audit.events.length;
    const review = reviewTicketSync(ticketFor(s, 'onboarding', user.id, 'Onboard ada'), deps(s), ACTOR);
    const written = s.audit.events.slice(before).filter((e) => e.action.startsWith('ticket.review'));

    expect(written).toHaveLength(review.checks.length);
    expect(written.every((e) => (e.note ?? '').length > 0)).toBe(true);
  });

  it('says so when the ticket names nobody it can check', () => {
    const s = setup();
    const admin = s.dir.getUserByUsername('admin')!;
    const ticket = s.tickets.create({
      kind: 'onboarding',
      requesterId: admin.id,
      subject: 'Something vague',
      body: 'No account named here.',
      priority: 'normal',
      relatedUserIds: [],
      payload: { proposedGroupIds: [], proposedRoleIds: [], startDate: Date.now() } as never,
    });

    const review = reviewTicketSync(ticket, deps(s), ACTOR);
    expect(review.passed).toBe(false);
    expect(review.checks[0]!.label).toBe('Subject identified');
  });

  it('never reports a pass without having checked something', () => {
    // The failure mode that matters: an empty check list is vacuously "every
    // check passed", which would approve everything.
    const s = setup();
    const admin = s.dir.getUserByUsername('admin')!;
    const review = reviewTicketSync(
      ticketFor(s, 'incident', admin.id as UserId, 'Look at admin'),
      deps(s),
      ACTOR,
    );
    expect(review.checks.length).toBeGreaterThan(0);
  });
});

describe('ticket ids', () => {
  it('the review is filed against the ticket it reviewed', () => {
    const s = setup();
    const user = s.dir.createUser({
      username: 'lsilva',
      displayName: 'Luca Silva',
      email: 'lsilva@iamlab.com',
      department: 'Sales',
      title: 'AE',
      mfa: 'none',
    });
    const ticket = ticketFor(s, 'onboarding', user.id, 'Onboard lsilva');
    const review = reviewTicketSync(ticket, deps(s), ACTOR);
    expect(review.ticketId).toBe(ticket.id as TicketId);
  });
});
