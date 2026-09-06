/**
 * tests/capabilityGaps.test.ts
 *
 * Stage 1 of the capability-registry work. Covers the two new service methods
 * (password reset, account unlock) and the three latent correctness bugs the
 * audit turned up:
 *
 *   - grantRoleDirect/revokeRoleDirect were no-ops that only wrote audit rows
 *   - moveUser logged a department transfer as 'group.remove'
 *   - createRole logged 'role.grant'
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockAuditLog, MockDirectory, MockIdP } from '@/services';
import type { UserId, RoleId } from '@/domain';

describe('Stage 1 — credential and account recovery', () => {
  let audit: MockAuditLog, dir: MockDirectory, idp: MockIdP;
  let userId: UserId;

  beforeEach(() => {
    audit = new MockAuditLog();
    dir = new MockDirectory(audit);
    idp = new MockIdP(audit, dir);
    const u = dir.createUser({
      username: 'alice',
      displayName: 'Alice',
      email: 'a@northwind.example',
      department: 'Finance',
      title: 'Analyst',
      mfa: 'none',
    });
    userId = u.id;
    idp.seedPasswords({ alice: 'secret' });
  });

  describe('resetPassword', () => {
    it('sets the new credential so the old one stops working', () => {
      idp.resetPassword(userId, 'NewPass123', { forceChangeAtNextLogin: false }, userId);
      expect(idp.signIn('alice', 'secret').ok).toBe(false);
      expect(idp.signIn('alice', 'NewPass123').ok).toBe(true);
    });

    it('records a password.reset audit event', () => {
      idp.resetPassword(userId, 'NewPass123', { forceChangeAtNextLogin: false }, userId);
      expect(audit.byAction('password.reset')).toHaveLength(1);
    });

    it('forces a change at next login when asked', () => {
      idp.resetPassword(userId, 'NewPass123', { forceChangeAtNextLogin: true }, userId);
      const r = idp.signIn('alice', 'NewPass123');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('must-change-password');
    });

    it('clears the force-change flag once the user sets their own password', () => {
      idp.resetPassword(userId, 'Temp123', { forceChangeAtNextLogin: true }, userId);
      idp.changeOwnPassword(userId, 'Temp123', 'Chosen456');
      expect(idp.signIn('alice', 'Chosen456').ok).toBe(true);
    });
  });

  describe('unlockUser', () => {
    it('returns a locked account to active so it can sign in again', () => {
      dir.getUser(userId)!.status = 'locked';
      expect(idp.signIn('alice', 'secret').ok).toBe(false);

      dir.unlockUser(userId, userId);

      expect(dir.getUser(userId)!.status).toBe('active');
      expect(idp.signIn('alice', 'secret').ok).toBe(true);
    });

    it('records an account.unlock audit event', () => {
      dir.getUser(userId)!.status = 'locked';
      dir.unlockUser(userId, userId);
      expect(audit.byAction('account.unlock')).toHaveLength(1);
    });

    it('does not resurrect a disabled account', () => {
      dir.getUser(userId)!.status = 'disabled';
      dir.unlockUser(userId, userId);
      expect(dir.getUser(userId)!.status).toBe('disabled');
    });
  });
});

describe('Stage 1 — audit bug fixes', () => {
  let audit: MockAuditLog, dir: MockDirectory;
  let userId: UserId, roleId: RoleId;

  beforeEach(() => {
    audit = new MockAuditLog();
    dir = new MockDirectory(audit);
    const u = dir.createUser({
      username: 'bob',
      displayName: 'Bob',
      email: 'b@northwind.example',
      department: 'Finance',
      title: 'Analyst',
      mfa: 'none',
    });
    userId = u.id;
    roleId = dir.createRole('payroll-admin', 'Payroll admin', ['payroll:write']).id;
  });

  describe('direct role grants actually take effect', () => {
    it('grantRoleDirect adds the role to effective access', () => {
      expect(dir.effectiveRoleIds(userId)).not.toContain(roleId);
      dir.grantRoleDirect(userId, roleId, userId);
      expect(dir.effectiveRoleIds(userId)).toContain(roleId);
    });

    it('revokeRoleDirect removes it again', () => {
      dir.grantRoleDirect(userId, roleId, userId);
      dir.revokeRoleDirect(userId, roleId, userId);
      expect(dir.effectiveRoleIds(userId)).not.toContain(roleId);
    });

    it('granting the same role twice does not duplicate it', () => {
      dir.grantRoleDirect(userId, roleId, userId);
      dir.grantRoleDirect(userId, roleId, userId);
      expect(dir.effectiveRoleIds(userId).filter((r) => r === roleId)).toHaveLength(1);
    });

    it('revokeRoleDirect throws for a missing user', () => {
      expect(() => dir.revokeRoleDirect('nope' as UserId, roleId, userId)).toThrow();
    });
  });

  it('moveUser records user.moved, not group.remove', () => {
    dir.moveUser(userId, 'Engineering', userId);
    const actions = audit.tail(100).map((e) => e.action);
    expect(actions).toContain('user.moved');
    expect(actions).not.toContain('group.remove');
    expect(dir.getUser(userId)!.department).toBe('Engineering');
  });

  it('createRole records role.created, not role.grant', () => {
    const fresh = new MockAuditLog();
    const d2 = new MockDirectory(fresh);
    d2.createRole('auditor', 'Read only', ['audit:read']);
    const actions = fresh.tail(100).map((e) => e.action);
    expect(actions).toContain('role.created');
    expect(actions).not.toContain('role.grant');
  });
});
