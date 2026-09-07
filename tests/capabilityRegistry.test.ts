/**
 * tests/capabilityRegistry.test.ts
 *
 * The drift guard. Every ticket the simulation can raise must have at least one
 * capability that actually performs its remediation — otherwise a learner picks
 * up the ticket, opens the console, and finds nothing to click. That is the
 * exact failure this whole change exists to make impossible.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockAuditLog, MockDirectory, MockIdP, MockTicketQueue } from '@/services';
import {
  CAPABILITIES,
  CAPABILITY_BY_CMDLET,
  CAPABILITY_BY_ID,
  capabilitiesResolving,
  type CapabilityContext,
} from '@/services/capabilities';
import { ALL_TICKET_KINDS, type UserId } from '@/domain';

describe('capability registry — drift guard', () => {
  it('every ticket kind has at least one capability that resolves it', () => {
    const orphaned = ALL_TICKET_KINDS.filter((k) => capabilitiesResolving(k).length === 0);
    expect(orphaned).toEqual([]);
  });

  it('names the resolving capability for each kind (documents the mapping)', () => {
    const map = Object.fromEntries(
      ALL_TICKET_KINDS.map((k) => [k, capabilitiesResolving(k).map((c) => c.id)]),
    );
    expect(map['password-reset']).toContain('password.reset');
    expect(map['mfa-issue']).toContain('mfa.reset');
    expect(map['transfer']).toContain('user.move');
    expect(map['termination']).toContain('session.revoke');
  });

  it('has no duplicate capability ids or cmdlet names', () => {
    expect(Object.keys(CAPABILITY_BY_ID)).toHaveLength(CAPABILITIES.length);
    expect(Object.keys(CAPABILITY_BY_CMDLET)).toHaveLength(CAPABILITIES.length);
  });

  it('every ticket kind is reachable from a console form, legacy or generated', () => {
    // Stronger than the drift guard above: a capability could resolve a ticket
    // kind and still be unreachable if no console section renders it. Every
    // capability is either a bespoke legacy form or picked up by the generated
    // sections, so this asserts the console genuinely covers each kind.
    const unreachable = ALL_TICKET_KINDS.filter((k) =>
      capabilitiesResolving(k).every((c) => !c.legacyConsoleForm && !c.consoleSection),
    );
    expect(unreachable).toEqual([]);
  });

  it('generated sections cover the capabilities the legacy console lacks', () => {
    const generated = CAPABILITIES.filter((c) => !c.legacyConsoleForm).map((c) => c.id);
    for (const id of [
      'password.reset',
      'account.unlock',
      'mfa.reset',
      'mfa.enroll',
      'user.move',
      'role.grant',
      'role.revoke',
      'session.revoke',
    ]) {
      expect(generated).toContain(id);
    }
  });

  it('gives every mutating capability a validator so lab steps can gate on it', () => {
    // Opening a session against a tenant changes no directory state, so there
    // is nothing for a lab step to assert afterwards. Named individually
    // rather than loosening the rule: anything else that mutates must still
    // be gateable, which is what this guard exists to force.
    const SESSION_ONLY = new Set(['cloud.connect.okta', 'cloud.connect.entra']);
    const missing = CAPABILITIES.filter(
      (c) => !c.readOnly && !c.validator && !SESSION_ONLY.has(c.id),
    ).map((c) => c.id);
    expect(missing).toEqual([]);
  });
});

describe('capability registry — execution', () => {
  let ctx: CapabilityContext;
  let actor: UserId;

  beforeEach(() => {
    const audit = new MockAuditLog();
    const dir = new MockDirectory(audit);
    const idp = new MockIdP(audit, dir);
    const tickets = new MockTicketQueue(audit);
    const admin = dir.createUser({
      username: 'admin',
      displayName: 'Admin',
      email: 'admin@northwind.example',
      department: 'IT',
      title: 'IAM Admin',
      mfa: 'none',
    });
    actor = admin.id;
    ctx = { dir, idp, tickets, audit, actor };
    dir.createUser({
      username: 'carla',
      displayName: 'Carla Nunes',
      email: 'c@northwind.example',
      department: 'Finance',
      title: 'Analyst',
      mfa: 'totp',
    });
    idp.seedPasswords({ carla: 'old-secret' });
  });

  const run = (id: string, args: Record<string, string>) => CAPABILITY_BY_ID[id]!.run(ctx, args);

  it('password.reset changes the credential', () => {
    const r = run('password.reset', { Identity: 'carla', NewPassword: 'Fresh123' });
    expect(r.ok).toBe(true);
    expect(ctx.idp.signIn('carla', 'Fresh123').ok).toBe(true);
  });

  it('account.unlock refuses when the account is not locked', () => {
    const r = run('account.unlock', { Identity: 'carla' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not locked/i);
  });

  it('account.unlock clears a real lockout', () => {
    ctx.dir.getUserByUsername('carla')!.status = 'locked';
    expect(run('account.unlock', { Identity: 'carla' }).ok).toBe(true);
    expect(ctx.dir.getUserByUsername('carla')!.status).toBe('active');
  });

  it('mfa.reset clears the registration', () => {
    expect(run('mfa.reset', { Identity: 'carla' }).ok).toBe(true);
    expect(ctx.dir.getUserByUsername('carla')!.mfa).toBe('none');
  });

  it('mfa.enroll rejects an unknown method', () => {
    const r = run('mfa.enroll', { Identity: 'carla', Method: 'carrier-pigeon' });
    expect(r.ok).toBe(false);
  });

  it('user.move transfers the department', () => {
    expect(run('user.move', { Identity: 'carla', TargetDepartment: 'Engineering' }).ok).toBe(true);
    expect(ctx.dir.getUserByUsername('carla')!.department).toBe('Engineering');
  });

  it('user.list returns rows the terminal can tabulate', () => {
    const r = run('user.list', {});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows!.length).toBeGreaterThan(0);
      expect(r.rows![0]).toHaveProperty('SamAccountName');
    }
  });

  it('reports a PowerShell-shaped error for an unknown identity', () => {
    const r = run('password.reset', { Identity: 'ghost', NewPassword: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Cannot find an object with identity/);
  });

  it('every capability is reachable by its cmdlet name, case-insensitively', () => {
    expect(CAPABILITY_BY_CMDLET['set-adaccountpassword']?.id).toBe('password.reset');
    expect(CAPABILITY_BY_CMDLET['unlock-adaccount']?.id).toBe('account.unlock');
  });
});
