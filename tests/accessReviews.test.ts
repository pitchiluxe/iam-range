/**
 * tests/accessReviews.test.ts — a review that changes nothing is paperwork.
 *
 * The service existed with two holes, and both are the difference between a
 * certification and a form. Nothing was audited, so a campaign's decisions
 * could not be shown to an auditor — which is the entire reason certification
 * exists. And a revoke decision did nothing: you could mark every membership
 * in the estate for removal, close the campaign, and everybody would still
 * have everything.
 *
 * The behaviour that carries the lesson is asserted hardest: decisions alone
 * change no access, completion is what applies them, and a campaign with
 * undecided rows refuses to complete rather than approving them by default.
 */
import { describe, it, expect } from 'vitest';
import { MockAuditLog, MockDirectory, MockAccessReviews } from '@/services';
import { PENDING } from '@/services/mockAccessReviews';
import type { UserId } from '@/domain';

const ACTOR = 'admin-1' as UserId;

function setup() {
  const audit = new MockAuditLog();
  const dir = new MockDirectory(audit);
  const reviews = new MockAccessReviews(audit);

  const group = dir.createGroup('grp-finance-payroll', 'Payroll', ACTOR);
  const other = dir.createGroup('grp-hr-readers', 'HR read', ACTOR);
  const mk = (username: string) =>
    dir.createUser({
      username,
      displayName: username,
      email: `${username}@iamlab.com`,
      department: 'Finance',
      title: 'Analyst',
      mfa: 'none',
    });
  const stayer = mk('jdoe');
  const leaver = mk('mchen');
  dir.addToGroup(stayer.id, group.id, ACTOR);
  dir.addToGroup(leaver.id, group.id, ACTOR);
  dir.addToGroup(leaver.id, other.id, ACTOR);

  const campaign = reviews.openCampaign(
    { campaign: 'Q3-2026', openedAt: Date.now(), dueAt: Date.now() + 86_400_000 },
    ACTOR,
  );
  return { audit, dir, reviews, campaign, group, other, stayer, leaver };
}

describe('scoping a campaign', () => {
  it('covers every membership in the directory', () => {
    const { reviews, campaign, dir } = setup();
    const count = reviews.scopeToDirectory(campaign.id, dir);
    // Three memberships were granted across two groups.
    expect(count).toBe(3);
    expect(reviews.get(campaign.id)?.decisions).toHaveLength(3);
  });

  it('leaves every row undecided', () => {
    const { reviews, campaign, dir } = setup();
    reviews.scopeToDirectory(campaign.id, dir);
    expect(reviews.pending(campaign.id)).toHaveLength(3);
  });
});

describe('deciding', () => {
  it('changes no access on its own', () => {
    // The heart of it. A decision is an intention until the campaign is
    // completed, which is how Entra and Okta both behave.
    const { reviews, campaign, dir, group, leaver } = setup();
    reviews.scopeToDirectory(campaign.id, dir);

    reviews.recordDecision(
      campaign.id,
      { userId: leaver.id, groupId: group.id, decision: 'revoke', decidedBy: ACTOR },
      dir,
    );

    expect(dir.listGroups().find((g) => g.id === group.id)?.memberIds).toContain(leaver.id);
  });

  it('records who decided what, for the auditor', () => {
    const { reviews, campaign, dir, group, leaver, audit } = setup();
    reviews.scopeToDirectory(campaign.id, dir);
    reviews.recordDecision(
      campaign.id,
      { userId: leaver.id, groupId: group.id, decision: 'revoke', decidedBy: ACTOR },
      dir,
    );

    const events = audit.byAction('review.revoked');
    expect(events).toHaveLength(1);
    // Names, not ids: an auditor cannot read user-a4f1.
    expect(events[0]!.note).toContain('mchen');
    expect(events[0]!.note).toContain('grp-finance-payroll');
  });

  it('refuses once the campaign is closed', () => {
    const { reviews, campaign, dir, group, stayer } = setup();
    reviews.scopeToDirectory(campaign.id, dir);
    for (const d of reviews.get(campaign.id)!.decisions) {
      reviews.recordDecision(
        campaign.id,
        { userId: d.userId, groupId: d.groupId, decision: 'approve', decidedBy: ACTOR },
        dir,
      );
    }
    reviews.complete(campaign.id, ACTOR, dir);

    expect(() =>
      reviews.recordDecision(
        campaign.id,
        { userId: stayer.id, groupId: group.id, decision: 'revoke', decidedBy: ACTOR },
        dir,
      ),
    ).toThrow(/already closed/);
  });
});

describe('completing', () => {
  function decideAll(
    s: ReturnType<typeof setup>,
    pick: (userId: UserId) => 'approve' | 'revoke',
  ): void {
    for (const d of s.reviews.get(s.campaign.id)!.decisions) {
      s.reviews.recordDecision(
        s.campaign.id,
        { userId: d.userId, groupId: d.groupId, decision: pick(d.userId), decidedBy: ACTOR },
        s.dir,
      );
    }
  }

  it('applies the revocations', () => {
    const s = setup();
    s.reviews.scopeToDirectory(s.campaign.id, s.dir);
    decideAll(s, (userId) => (userId === s.leaver.id ? 'revoke' : 'approve'));

    const result = s.reviews.complete(s.campaign.id, ACTOR, s.dir);

    expect(result.error).toBeUndefined();
    expect(result.revoked).toHaveLength(2);
    expect(result.approved).toBe(1);
    // The leaver is out of both groups; the stayer keeps theirs.
    expect(s.dir.listGroups().find((g) => g.id === s.group.id)?.memberIds).not.toContain(
      s.leaver.id,
    );
    expect(s.dir.listGroups().find((g) => g.id === s.group.id)?.memberIds).toContain(s.stayer.id);
  });

  it('refuses while any row is undecided', () => {
    // Defaulting undecided rows to approve is rubber-stamping with extra
    // steps, and it is the habit certification exists to break.
    const s = setup();
    s.reviews.scopeToDirectory(s.campaign.id, s.dir);
    s.reviews.recordDecision(
      s.campaign.id,
      { userId: s.stayer.id, groupId: s.group.id, decision: 'approve', decidedBy: ACTOR },
      s.dir,
    );

    const result = s.reviews.complete(s.campaign.id, ACTOR, s.dir);
    expect(result.error).toMatch(/still have no decision/);
    expect(s.reviews.get(s.campaign.id)?.status).not.toBe('closed');
  });

  it('records the outcome so the campaign can be evidenced', () => {
    const s = setup();
    s.reviews.scopeToDirectory(s.campaign.id, s.dir);
    decideAll(s, (userId) => (userId === s.leaver.id ? 'revoke' : 'approve'));
    s.reviews.complete(s.campaign.id, ACTOR, s.dir);

    const done = s.audit.byAction('review.completed');
    expect(done).toHaveLength(1);
    expect(done[0]!.note).toMatch(/2 revoked, 1 approved/);
  });

  it('leaves each removal in the log, not just the summary', () => {
    // The summary says two were revoked; the directory events say which.
    const s = setup();
    s.reviews.scopeToDirectory(s.campaign.id, s.dir);
    decideAll(s, (userId) => (userId === s.leaver.id ? 'revoke' : 'approve'));
    const before = s.audit.byAction('group.remove').length;
    s.reviews.complete(s.campaign.id, ACTOR, s.dir);
    expect(s.audit.byAction('group.remove').length).toBe(before + 2);
  });

  it('cannot be completed twice', () => {
    const s = setup();
    s.reviews.scopeToDirectory(s.campaign.id, s.dir);
    decideAll(s, () => 'approve');
    s.reviews.complete(s.campaign.id, ACTOR, s.dir);
    expect(s.reviews.complete(s.campaign.id, ACTOR, s.dir).error).toMatch(/already closed/);
  });

  it('says so rather than pretending when there is no directory to change', () => {
    const s = setup();
    s.reviews.scopeToDirectory(s.campaign.id, s.dir);
    decideAll(s, () => 'revoke');
    // Without a directory the campaign still closes and reports what it would
    // have removed, rather than silently claiming success.
    const result = s.reviews.complete(s.campaign.id, ACTOR);
    expect(result.revoked).toHaveLength(3);
    expect(s.dir.listGroups().find((g) => g.id === s.group.id)?.memberIds).toContain(s.stayer.id);
  });
});

describe('the campaign itself is recorded', () => {
  it('logs the opening with its due date', () => {
    const { audit } = setup();
    const opened = audit.byAction('review.opened');
    expect(opened).toHaveLength(1);
    expect(opened[0]!.note).toContain('Q3-2026');
  });

  it('marks undecided rows with the pending sentinel, not a real actor', () => {
    const { reviews, campaign, dir } = setup();
    reviews.scopeToDirectory(campaign.id, dir);
    expect(reviews.get(campaign.id)!.decisions.every((d) => d.decidedBy === PENDING)).toBe(true);
  });
});
