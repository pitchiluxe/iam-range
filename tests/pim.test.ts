/**
 * tests/pim.test.ts — Privileged Identity Management.
 *
 * The refusals are most of what PIM is, so they get the coverage: activating
 * without a justification, asking for longer than the role allows, approving
 * your own request, and activating something already active. A PIM that says
 * yes to everything teaches the opposite of the lesson.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockAuditLog, MockDirectory, MockPim } from '@/services';
import type { RoleId, UserId } from '@/domain';

describe('PIM assignments', () => {
  let audit: MockAuditLog;
  let dir: MockDirectory;
  let pim: MockPim;
  let alice: UserId;
  let bob: UserId;
  let role: RoleId;

  beforeEach(() => {
    audit = new MockAuditLog();
    dir = new MockDirectory(audit);
    pim = new MockPim(audit);

    const mk = (username: string): UserId =>
      dir.createUser({
        username,
        displayName: username,
        email: `${username}@omari.test`,
        department: 'IT',
        title: 'Engineer',
        mfa: 'none',
      }).id;
    alice = mk('alice');
    bob = mk('bob');
    role = dir.createRole('role-domain-admins', 'Domain Admins', ['*']).id;
  });

  it('eligible is not the same as holding the role', () => {
    pim.makeEligible(alice, role, bob);
    expect(pim.find(alice, role)?.state).toBe('eligible');
    // The whole point of PIM: eligibility grants nothing until activated.
    expect(pim.isActive(alice, role)).toBe(false);
  });

  it('activation grants the role for a bounded window', () => {
    pim.makeEligible(alice, role, bob);
    const res = pim.activate(alice, role, { justification: 'Incident 4471', minutes: 60 });

    expect(res.ok).toBe(true);
    expect(pim.isActive(alice, role)).toBe(true);
    const a = pim.find(alice, role)!;
    expect(a.expiresAt).toBeGreaterThan(Date.now());
    expect(a.justification).toBe('Incident 4471');
  });

  it('refuses activation without a justification', () => {
    pim.makeEligible(alice, role, bob);
    const res = pim.activate(alice, role, {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/justification/i);
    expect(pim.isActive(alice, role)).toBe(false);
  });

  it('refuses a window longer than the role permits', () => {
    pim.configureRole(role, { maxDurationMinutes: 60 });
    pim.makeEligible(alice, role, bob);
    const res = pim.activate(alice, role, { justification: 'why', minutes: 600 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/maximum/i);
  });

  it('cannot activate a role you are not eligible for', () => {
    const res = pim.activate(alice, role, { justification: 'why' });
    expect(res.ok).toBe(false);
    expect(pim.isActive(alice, role)).toBe(false);
  });

  it('cannot activate twice', () => {
    pim.makeEligible(alice, role, bob);
    pim.activate(alice, role, { justification: 'first' });
    expect(pim.activate(alice, role, { justification: 'second' }).ok).toBe(false);
  });

  it('an expired activation lapses back to eligible on read', () => {
    pim.makeEligible(alice, role, bob);
    pim.activate(alice, role, { justification: 'short', minutes: 1 });

    // Wind the clock past the window rather than waiting for it.
    pim.find(alice, role)!.expiresAt = Date.now() - 1000;

    expect(pim.isActive(alice, role)).toBe(false);
    expect(pim.find(alice, role)?.state).toBe('eligible');
    expect(audit.byAction('pim.expired')).toHaveLength(1);
  });

  it('an expired activation drops its justification with the access', () => {
    pim.makeEligible(alice, role, bob);
    pim.activate(alice, role, { justification: 'Incident 4471', minutes: 1 });
    pim.find(alice, role)!.expiresAt = Date.now() - 1000;
    pim.list();
    // A stale reason attached to no access would read as current authority.
    expect(pim.find(alice, role)?.justification).toBeUndefined();
  });
});

describe('PIM approvals', () => {
  let audit: MockAuditLog;
  let dir: MockDirectory;
  let pim: MockPim;
  let alice: UserId;
  let bob: UserId;
  let role: RoleId;

  beforeEach(() => {
    audit = new MockAuditLog();
    dir = new MockDirectory(audit);
    pim = new MockPim(audit);
    const mk = (u: string): UserId =>
      dir.createUser({
        username: u,
        displayName: u,
        email: `${u}@omari.test`,
        department: 'IT',
        title: 'Engineer',
        mfa: 'none',
      }).id;
    alice = mk('alice');
    bob = mk('bob');
    role = dir.createRole('role-domain-admins', 'Domain Admins', ['*']).id;
    pim.configureRole(role, { requiresApproval: true });
    pim.makeEligible(alice, role, bob);
  });

  it('an approval-gated role parks the request instead of activating', () => {
    const res = pim.activate(alice, role, { justification: 'Incident 4471' });
    expect(res.ok).toBe(true);
    expect(pim.find(alice, role)?.state).toBe('pending-approval');
    expect(pim.isActive(alice, role)).toBe(false);
  });

  it('approval starts the window and records who approved', () => {
    pim.activate(alice, role, { justification: 'Incident 4471' });
    const res = pim.approve(alice, role, bob);

    expect(res.ok).toBe(true);
    expect(pim.isActive(alice, role)).toBe(true);
    expect(pim.find(alice, role)?.approvedBy).toBe(bob);
  });

  it('you cannot approve your own request', () => {
    // Self-approval defeats the only control the approval exists to provide.
    pim.activate(alice, role, { justification: 'Incident 4471' });
    const res = pim.approve(alice, role, alice);
    expect(res.ok).toBe(false);
    expect(pim.isActive(alice, role)).toBe(false);
  });

  it('cannot request twice while one is pending', () => {
    pim.activate(alice, role, { justification: 'first' });
    expect(pim.activate(alice, role, { justification: 'second' }).ok).toBe(false);
  });
});

describe('standing privilege', () => {
  let dir: MockDirectory;
  let pim: MockPim;
  let alice: UserId;
  let role: RoleId;

  beforeEach(() => {
    const audit = new MockAuditLog();
    dir = new MockDirectory(audit);
    pim = new MockPim(audit);
    alice = dir.createUser({
      username: 'alice',
      displayName: 'Alice',
      email: 'alice@omari.test',
      department: 'IT',
      title: 'Engineer',
      mfa: 'none',
    }).id;
    role = dir.createRole('role-domain-admins', 'Domain Admins', ['*']).id;
  });

  it('is representable, because a lab must be able to show the bad state', () => {
    pim.grantPermanent(alice, role, alice);
    expect(pim.isActive(alice, role)).toBe(true);
    expect(pim.standingPrivilege()).toHaveLength(1);
  });

  it('never expires, which is exactly the problem', () => {
    pim.grantPermanent(alice, role, alice);
    pim.list();
    expect(pim.find(alice, role)?.state).toBe('permanent');
    expect(pim.find(alice, role)?.expiresAt).toBeUndefined();
  });

  it('has nothing to activate — it is already permanently held', () => {
    pim.grantPermanent(alice, role, alice);
    expect(pim.activate(alice, role, { justification: 'why' }).ok).toBe(false);
  });

  it('is removed rather than deactivated', () => {
    pim.grantPermanent(alice, role, alice);
    expect(pim.deactivate(alice, role, alice).ok).toBe(false);
    expect(pim.remove(alice, role, alice).ok).toBe(true);
    expect(pim.standingPrivilege()).toHaveLength(0);
  });

  it('a time-bound tenant reports no standing privilege', () => {
    pim.makeEligible(alice, role, alice);
    pim.activate(alice, role, { justification: 'Incident 4471' });
    expect(pim.standingPrivilege()).toHaveLength(0);
  });
});
