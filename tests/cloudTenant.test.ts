/**
 * tests/cloudTenant.test.ts — the hybrid estate.
 *
 * The four things this exists to teach are the four things asserted here:
 * authority has a direction, sync is not instant, deprovisioning stops where
 * provisioning stopped, and soft match fails. Each of them is a real incident
 * pattern, so each of them has to be reproducible on demand.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockAuditLog, MockDirectory, MockCloudTenant, CAPABILITY_BY_CMDLET } from '@/services';
import type { CapabilityContext } from '@/services';
import type { UserId } from '@/domain';

const ACTOR = 'admin-1' as UserId;

/** The registry keys cmdlets case-insensitively, as the dispatcher does. */
const cmd = (name: string) => {
  const c = CAPABILITY_BY_CMDLET[name.toLowerCase()];
  if (!c) throw new Error(`No capability for cmdlet ${name}`);
  return c;
};

function setup() {
  const audit = new MockAuditLog();
  const dir = new MockDirectory(audit);
  const okta = new MockCloudTenant('okta', dir, audit);
  const mk = (username: string, displayName: string): UserId =>
    dir.createUser({
      username,
      displayName,
      email: `${username}@omari.test`,
      department: 'Finance',
      title: 'Analyst',
      mfa: 'none',
    }).id;
  return { audit, dir, okta, mk };
}

describe('connection gate', () => {
  it('refuses every action until connected, and names the cmdlet to run', () => {
    const { okta } = setup();
    const res = okta.sync(ACTOR);
    expect('error' in res).toBe(true);
    if ('error' in res) expect(res.error).toMatch(/Connect-Okta/);
  });

  it('works once connected', () => {
    const { okta, mk } = setup();
    mk('rpatel', 'Ravi Patel');
    okta.connect();
    const res = okta.sync(ACTOR);
    expect('created' in res && res.created).toBe(1);
  });
});

describe('authority has a direction', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
    ctx.mk('rpatel', 'Ravi Patel');
    ctx.okta.connect();
    ctx.okta.sync(ACTOR);
  });

  it('refuses to disable a synced account in the cloud', () => {
    // In a real tenant this either fails or is silently reverted at the next
    // cycle. Refusing teaches where the change belongs.
    const res = ctx.okta.disable('rpatel@omari.test', ACTOR);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Active Directory/);
    expect(ctx.okta.find('rpatel@omari.test')?.status).toBe('active');
  });

  it('allows disabling a cloud-only account, which nothing on premises owns', () => {
    ctx.okta.createCloudOnly('contractor@omari.test', 'Temp Contractor', ACTOR);
    expect(ctx.okta.disable('contractor@omari.test', ACTOR).ok).toBe(true);
    expect(ctx.okta.find('contractor@omari.test')?.status).toBe('disabled');
  });

  it('a disable on premises reaches the cloud through a sync', () => {
    const u = ctx.dir.getUserByUsername('rpatel')!;
    ctx.dir.disableUser(u.id, ACTOR);
    ctx.okta.sync(ACTOR);
    expect(ctx.okta.find('rpatel@omari.test')?.status).toBe('disabled');
  });
});

describe('sync is not instant', () => {
  it('the cloud copy stays enabled until a cycle runs', () => {
    const { dir, okta, mk } = setup();
    mk('rpatel', 'Ravi Patel');
    okta.connect();
    okta.sync(ACTOR);

    dir.disableUser(dir.getUserByUsername('rpatel')!.id, ACTOR);

    // This is "I disabled them and they can still get in", reproduced: the
    // cloud is not lagging in some abstract sense, it is genuinely enabled.
    expect(okta.find('rpatel@omari.test')?.status).toBe('active');
  });

  it('names the accounts the tenant has not caught up on', () => {
    const { dir, okta, mk } = setup();
    mk('rpatel', 'Ravi Patel');
    okta.connect();
    okta.sync(ACTOR);
    dir.disableUser(dir.getUserByUsername('rpatel')!.id, ACTOR);

    const delta = okta.pendingDelta();
    expect(delta).toHaveLength(1);
    expect(delta[0]!.upn).toBe('rpatel@omari.test');
    expect(delta[0]!.change).toBe('disable');
  });

  it('reports an account that has never been synced as pending creation', () => {
    const { okta, mk } = setup();
    mk('newjoiner', 'New Joiner');
    okta.connect();
    expect(okta.pendingDelta().map((d) => d.change)).toContain('create');
  });

  it('nothing is pending once the cycle has run', () => {
    const { okta, mk } = setup();
    mk('rpatel', 'Ravi Patel');
    okta.connect();
    okta.sync(ACTOR);
    expect(okta.pendingDelta()).toHaveLength(0);
  });
});

describe('deprovisioning stops where provisioning stopped', () => {
  function leaverWith(scim: boolean) {
    const { dir, okta, mk } = setup();
    mk('rpatel', 'Ravi Patel');
    okta.connect();
    okta.registerApp('Payroll', scim);
    okta.grantAppAccount('Payroll', 'rpatel@omari.test');
    okta.sync(ACTOR);

    dir.disableUser(dir.getUserByUsername('rpatel')!.id, ACTOR);
    okta.sync(ACTOR);
    return { dir, okta };
  }

  it('without SCIM the app account keeps working after the person is disabled', () => {
    const { okta } = leaverWith(false);
    expect(okta.find('rpatel@omari.test')?.status).toBe('disabled');
    // Disabled at the IdP, still live inside the application. This is the
    // leaver gap an auditor asks about, and it is invisible from the tenant.
    expect(okta.getApp('Payroll')?.accounts.get('rpatel@omari.test')).toBe('active');
    expect(okta.orphanedAppAccounts()).toHaveLength(1);
  });

  it('with SCIM the deactivation reaches inside the app', () => {
    const { okta } = leaverWith(true);
    expect(okta.getApp('Payroll')?.accounts.get('rpatel@omari.test')).toBe('deactivated');
    expect(okta.orphanedAppAccounts()).toHaveLength(0);
  });

  it('switching SCIM on afterwards closes the gap that was already open', () => {
    // Otherwise enabling it would be a setting rather than a remediation, and
    // the accounts missed while it was off would stay missed.
    const { okta } = leaverWith(false);
    expect(okta.orphanedAppAccounts()).toHaveLength(1);

    okta.setScim('Payroll', true, ACTOR);
    expect(okta.orphanedAppAccounts()).toHaveLength(0);
  });
});

describe('soft match fails', () => {
  it('a cloud-only account with the same UPN becomes a duplicate on sync', () => {
    const { okta, mk } = setup();
    okta.connect();
    okta.createCloudOnly('rpatel@omari.test', 'Ravi Patel (cloud)', ACTOR);
    mk('rpatel', 'Ravi Patel');

    const res = okta.sync(ACTOR);
    expect('conflicts' in res && res.conflicts).toContain('rpatel@omari.test');
    expect(okta.duplicates()).toHaveLength(2);
  });

  it('a clean tenant reports no duplicates', () => {
    const { okta, mk } = setup();
    mk('rpatel', 'Ravi Patel');
    okta.connect();
    okta.sync(ACTOR);
    expect(okta.duplicates()).toHaveLength(0);
  });
});

describe('sessions outlive the account', () => {
  it('disabling does not end an open session; revoking does', () => {
    const { dir, okta, mk } = setup();
    mk('rpatel', 'Ravi Patel');
    okta.connect();
    okta.sync(ACTOR);
    okta.openSession('rpatel@omari.test');

    dir.disableUser(dir.getUserByUsername('rpatel')!.id, ACTOR);
    okta.sync(ACTOR);
    // The window between disabling and session expiry is exactly this.
    expect(okta.find('rpatel@omari.test')?.sessions).toBe(1);

    expect(okta.revokeSessions('rpatel@omari.test', ACTOR).ok).toBe(true);
    expect(okta.find('rpatel@omari.test')?.sessions).toBe(0);
  });
});

describe('cloud cmdlets', () => {
  function ctxFor(): { ctx: CapabilityContext; okta: MockCloudTenant } {
    const { audit, dir, okta, mk } = setup();
    mk('rpatel', 'Ravi Patel');
    const ctx = {
      dir,
      audit,
      cloud: { okta },
      actor: ACTOR,
    } as unknown as CapabilityContext;
    return { ctx, okta };
  }

  it('requires a provider rather than guessing one', () => {
    // In a hybrid estate, "which tenant did you change" is the diagnosis.
    const { ctx } = ctxFor();
    const res = cmd('Get-CloudUser').run(ctx, {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Provider is required/);
  });

  it('rejects an unknown provider by name', () => {
    const { ctx } = ctxFor();
    const res = cmd('Get-CloudUser').run(ctx, { Provider: 'ping' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/okta or entra/);
  });

  it('refuses a tenant this host does not have', () => {
    const { ctx } = ctxFor();
    const res = cmd('Get-CloudUser').run(ctx, { Provider: 'entra' });
    expect(res.ok).toBe(false);
  });

  it('Connect-Okta then Start-DirectorySync creates the cloud copies', () => {
    const { ctx, okta } = ctxFor();
    expect(cmd('Connect-Okta').run(ctx, {}).ok).toBe(true);
    const res = cmd('Start-DirectorySync').run(ctx, { Provider: 'okta' });
    expect(res.ok).toBe(true);
    expect(okta.list()).toHaveLength(1);
  });

  it('Get-DirectorySyncStatus explains what is out of date rather than just saying stale', () => {
    const { ctx, okta } = ctxFor();
    cmd('Connect-Okta').run(ctx, {});
    cmd('Start-DirectorySync').run(ctx, { Provider: 'okta' });
    ctx.dir.disableUser(ctx.dir.getUserByUsername('rpatel')!.id, ACTOR);

    const res = cmd('Get-DirectorySyncStatus').run(ctx, { Provider: 'okta' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.rows).toHaveLength(1);
      expect(res.message).toMatch(/out of date/);
    }
    expect(okta.find('rpatel@omari.test')?.status).toBe('active');
  });

  it('Set-ScimProvisioning defaults to switching it on', () => {
    // The cmdlet exists to close a gap; requiring -Enabled true to do the
    // obvious thing would be a trap rather than a lesson.
    const { ctx, okta } = ctxFor();
    cmd('Connect-Okta').run(ctx, {});
    okta.registerApp('Payroll', false);
    const res = cmd('Set-ScimProvisioning').run(ctx, {
      Provider: 'okta',
      App: 'Payroll',
    });
    expect(res.ok).toBe(true);
    expect(okta.getApp('Payroll')?.scim).toBe(true);
  });

  it('Disable-CloudUser refuses a synced account through the cmdlet too', () => {
    const { ctx } = ctxFor();
    cmd('Connect-Okta').run(ctx, {});
    cmd('Start-DirectorySync').run(ctx, { Provider: 'okta' });
    const res = cmd('Disable-CloudUser').run(ctx, {
      Provider: 'okta',
      Upn: 'rpatel@omari.test',
    });
    expect(res.ok).toBe(false);
  });
});
