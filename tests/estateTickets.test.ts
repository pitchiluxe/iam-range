/**
 * tests/estateTickets.test.ts — every ticket the generator raises must be
 * closeable by doing what it asks.
 *
 * The first ticket a new learner meets asks for an OU structure. It names no
 * account, because there is no account to name. The reviewer's opening move
 * was to look for a person and give up without one — fair advice while the
 * review was advisory, and a wall the moment the review started deciding
 * whether a ticket may close. Build the OUs, press Resolve, get told the work
 * is outstanding. Forever.
 *
 * Nothing caught it because every existing test fed the reviewer a ticket
 * about somebody. The gap was between the generator and the reviewer, and
 * neither side's tests looked across it.
 *
 * So the test that matters here is the last one: walk every scenario the
 * generator can raise, do the work, and assert the reviewer accepts it. That
 * is the property a learner actually depends on.
 */
import { describe, it, expect } from 'vitest';
import { VmSession } from '@/vm/session';
import { reviewTicketSync } from '@/vm/ticketReview';
import type { Ticket, UserId } from '@/domain';

const ACTOR = 'admin-1' as UserId;

function bare(): VmSession {
  return new VmSession();
}

function deps(s: VmSession) {
  return { dir: s.dir, audit: s.audit, pim: s.pim, cloud: s.cloud };
}

/** The estate ticket the generator raises on a bare domain. */
function ouTicket(s: VmSession): Ticket {
  const admin = s.dir.getUserByUsername('admin')!;
  return s.tickets.create({
    kind: 'onboarding',
    scenarioId: 'build-ou-structure',
    requesterId: admin.id,
    subject: 'Build the organisational unit structure',
    body: 'Create the OU hierarchy before anything else.',
    priority: 'high',
    relatedUserIds: [],
    payload: { proposedGroupIds: [], proposedRoleIds: [], startDate: Date.now() },
  });
}

function groupTicket(s: VmSession): Ticket {
  const admin = s.dir.getUserByUsername('admin')!;
  return s.tickets.create({
    kind: 'access-request',
    scenarioId: 'define-group-model',
    requesterId: admin.id,
    subject: 'Define the security group model',
    body: 'Create the security groups access will be granted through.',
    priority: 'high',
    relatedUserIds: [],
    payload: { requestedGroupIds: [], justification: 'model' },
  } as never);
}

describe('the ticket that asks for an OU structure', () => {
  it('is refused while the domain is still flat', () => {
    const s = bare();
    const review = reviewTicketSync(ouTicket(s), deps(s), ACTOR);
    expect(review.passed).toBe(false);
    expect(review.checks.map((c) => c.label)).toContain('Structure exists');
  });

  it('is not judged by looking for a person', () => {
    // The bug. It named no account, so the reviewer said "this ticket names
    // no account that exists" and there was nothing anybody could do about it.
    const s = bare();
    const review = reviewTicketSync(ouTicket(s), deps(s), ACTOR);
    expect(review.checks.map((c) => c.label)).not.toContain('Subject identified');
  });

  it('passes once the hierarchy is built', () => {
    const s = bare();
    const corp = s.dir.createOu('Corp', 'Corporate', undefined, ACTOR);
    s.dir.createOu('Users', 'People', corp.id, ACTOR);
    s.dir.createOu('Groups', 'Groups', corp.id, ACTOR);

    const review = reviewTicketSync(ouTicket(s), deps(s), ACTOR);
    expect(review.passed).toBe(true);
  });

  it('still wants a hierarchy rather than one flat container', () => {
    // Delegation and Group Policy follow the tree, so the point of the
    // structure is what sits beneath what.
    const s = bare();
    s.dir.createOu('Corp', 'Corporate', undefined, ACTOR);
    s.dir.createOu('Other', 'Also top level', undefined, ACTOR);

    const review = reviewTicketSync(ouTicket(s), deps(s), ACTOR);
    expect(review.passed).toBe(false);
    expect(review.checks.find((c) => c.label === 'It is a hierarchy')?.passed).toBe(false);
  });
});

describe('the ticket that asks for a group model', () => {
  it('is refused while there are no groups', () => {
    const s = bare();
    const review = reviewTicketSync(groupTicket(s), deps(s), ACTOR);
    expect(review.passed).toBe(false);
    expect(review.checks.map((c) => c.label)).not.toContain('Subject identified');
  });

  it('passes once the groups exist and are placed', () => {
    const s = bare();
    const corp = s.dir.createOu('Corp', 'Corporate', undefined, ACTOR);
    const groupsOu = s.dir.createOu('Groups', 'Groups', corp.id, ACTOR);
    for (const name of ['grp-helpdesk-tier1', 'grp-hr-readers', 'grp-finance-payroll']) {
      s.dir.createGroup(name, 'Security group', ACTOR, groupsOu.id);
    }

    const review = reviewTicketSync(groupTicket(s), deps(s), ACTOR);
    expect(review.passed).toBe(true);
  });
});

describe('the scenario id survives the trip', () => {
  it('is stored on the ticket the queue creates', () => {
    // It was being discarded, which left the reviewer nothing to branch on.
    const s = bare();
    expect(ouTicket(s).scenarioId).toBe('build-ou-structure');
  });

  it('falls back to the subject for tickets raised before it was carried', () => {
    // Somebody with the queue already open when they update should not be
    // left holding a ticket they still cannot close.
    const s = bare();
    const corp = s.dir.createOu('Corp', 'Corporate', undefined, ACTOR);
    s.dir.createOu('Users', 'People', corp.id, ACTOR);

    const admin = s.dir.getUserByUsername('admin')!;
    const legacy = s.tickets.create({
      kind: 'onboarding',
      requesterId: admin.id,
      subject: 'Build the organisational unit structure',
      body: 'Create the OU hierarchy before anything else.',
      relatedUserIds: [],
      payload: { proposedGroupIds: [], proposedRoleIds: [], startDate: Date.now() },
    });
    expect(legacy.scenarioId).toBeUndefined();
    expect(reviewTicketSync(legacy, deps(s), ACTOR).passed).toBe(true);
  });
});

describe('a ticket about a person is unaffected', () => {
  it('still refuses when the account is not there', () => {
    // The estate branch must not swallow ordinary tickets.
    const s = bare();
    const admin = s.dir.getUserByUsername('admin')!;
    const t = s.tickets.create({
      kind: 'onboarding',
      scenarioId: 'onboard-jdoe',
      requesterId: admin.id,
      subject: 'Onboarding: John Doe (jdoe)',
      body: 'Create the account with logon name jdoe.',
      relatedUserIds: [],
      payload: { proposedGroupIds: [], proposedRoleIds: [], startDate: Date.now() },
    });
    const review = reviewTicketSync(t, deps(s), ACTOR);
    expect(review.passed).toBe(false);
    expect(review.checks.map((c) => c.label)).toContain('Subject identified');
  });

  it('passes once that person is created, grouped and placed', () => {
    const s = bare();
    const corp = s.dir.createOu('Corp', 'Corporate', undefined, ACTOR);
    const groupsOu = s.dir.createOu('Groups', 'Groups', corp.id, ACTOR);
    const g = s.dir.createGroup('grp-helpdesk-tier1', 'Desk', ACTOR, groupsOu.id);
    const admin = s.dir.getUserByUsername('admin')!;
    const t = s.tickets.create({
      kind: 'onboarding',
      scenarioId: 'onboard-jdoe',
      requesterId: admin.id,
      subject: 'Onboarding: John Doe (jdoe)',
      body: 'Create the account with logon name jdoe.',
      relatedUserIds: [],
      payload: { proposedGroupIds: [], proposedRoleIds: [], startDate: Date.now() },
    });

    const u = s.dir.createUser({
      username: 'jdoe',
      displayName: 'John Doe',
      email: 'jdoe@iamlab.com',
      department: 'Help Desk',
      title: 'Analyst',
      mfa: 'none',
    });
    s.dir.addToGroup(u.id, g.id, ACTOR);
    s.dir.setUserOu(u.id, corp.id, ACTOR);

    expect(reviewTicketSync(t, deps(s), ACTOR).passed).toBe(true);
  });
});
