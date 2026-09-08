/**
 * tests/editUser.test.ts — fixing a typo without deleting the person.
 *
 * Creating an account takes free text, so a mistyped logon name or surname was
 * routine. Nothing could change either afterwards: Properties renders spans,
 * not fields, and the only correction available was Delete followed by New
 * User. That loses the account's group memberships, its OU, its password and
 * its place in the audit log, all to fix one character -- and it teaches the
 * wrong habit, because a real operator runs Set-ADUser.
 *
 * The edge that makes this more than a form: the IdP keys passwords by
 * username string, not by user id. Renaming the account in the directory
 * alone would leave the password filed under the old name, and the person
 * would be unable to sign in -- a repair that silently breaks the thing it
 * repaired. The rename has to move the credential with it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MockAuditLog, MockDirectory, MockIdP } from '@/services';
import { CAPABILITIES } from '@/services/capabilities';
import type { CapabilityContext } from '@/services/capabilities';
import type { UserId } from '@/domain';

const ACTOR = 'admin' as UserId;

describe('MockDirectory.updateUser renaming the logon name', () => {
  let dir: MockDirectory;

  beforeEach(() => {
    dir = new MockDirectory(new MockAuditLog());
    dir.createUser({
      username: 'praman',
      displayName: 'Priya Ramanx',
      email: 'praman@iamlab.com',
      department: 'IT',
      title: 'Analyst',
    });
  });

  it('changes the username and finds the account under the new one', () => {
    const u = dir.getUserByUsername('praman')!;
    dir.updateUser(u.id, { username: 'p.raman' }, ACTOR);

    expect(dir.getUserByUsername('p.raman')?.id).toBe(u.id);
    expect(dir.getUserByUsername('praman')).toBeUndefined();
  });

  it('keeps the account id, so group membership and the audit trail survive', () => {
    const before = dir.getUserByUsername('praman')!;
    dir.updateUser(before.id, { username: 'p.raman' }, ACTOR);
    // The id is what every other record points at. A correction that changed
    // it would be a delete-and-recreate wearing a different name.
    expect(dir.getUser(before.id)?.username).toBe('p.raman');
  });

  it('refuses a logon name that is already taken', () => {
    dir.createUser({
      username: 'taken',
      displayName: 'Someone Else',
      email: 'taken@iamlab.com',
      department: 'IT',
      title: 'Analyst',
    });
    const u = dir.getUserByUsername('praman')!;
    expect(() => dir.updateUser(u.id, { username: 'taken' }, ACTOR)).toThrow(/already exists/);
    // And the failed rename left nothing behind.
    expect(dir.getUserByUsername('praman')).toBeDefined();
  });

  it('allows a no-op rename to the account\'s own name', () => {
    const u = dir.getUserByUsername('praman')!;
    expect(() => dir.updateUser(u.id, { username: 'praman' }, ACTOR)).not.toThrow();
  });

  it('still updates the ordinary attributes', () => {
    const u = dir.getUserByUsername('praman')!;
    dir.updateUser(u.id, { displayName: 'Priya Raman', title: 'Senior Analyst' }, ACTOR);
    const after = dir.getUser(u.id)!;
    expect(after.displayName).toBe('Priya Raman');
    expect(after.title).toBe('Senior Analyst');
  });
});

describe('MockIdP.renameAccount', () => {
  it('moves the password, so the account can still sign in', () => {
    const audit = new MockAuditLog();
    const dir = new MockDirectory(audit);
    const idp = new MockIdP(audit, dir);
    const u = dir.createUser({
      username: 'praman',
      displayName: 'Priya Raman',
      email: 'praman@iamlab.com',
      department: 'IT',
      title: 'Analyst',
    });
    idp.seedPasswords({ praman: 'Password123!' });

    idp.renameAccount('praman', 'p.raman');
    dir.updateUser(u.id, { username: 'p.raman' }, ACTOR);

    // This is the assertion the whole feature turns on.
    expect(idp.signIn('p.raman', 'Password123!').ok).toBe(true);
  });

  it('leaves nothing under the old name', () => {
    const audit = new MockAuditLog();
    const dir = new MockDirectory(audit);
    const idp = new MockIdP(audit, dir);
    const u = dir.createUser({
      username: 'praman',
      displayName: 'Priya Raman',
      email: 'praman@iamlab.com',
      department: 'IT',
      title: 'Analyst',
    });
    idp.seedPasswords({ praman: 'Password123!' });
    idp.renameAccount('praman', 'p.raman');
    dir.updateUser(u.id, { username: 'p.raman' }, ACTOR);

    expect(idp.signIn('praman', 'Password123!').ok).toBe(false);
  });
});

describe('the user.update capability', () => {
  const cap = CAPABILITIES.find((c) => c.id === 'user.update');

  /** Enough of a context for a directory-and-IdP capability. */
  function makeCtx(): { ctx: CapabilityContext; dir: MockDirectory; idp: MockIdP } {
    const audit = new MockAuditLog();
    const dir = new MockDirectory(audit);
    const idp = new MockIdP(audit, dir);
    dir.createUser({
      username: 'praman',
      displayName: 'Priya Ramanx',
      email: 'praman@iamlab.com',
      department: 'IT',
      title: 'Analyst',
    });
    idp.seedPasswords({ praman: 'Password123!' });
    return { ctx: { dir, idp, audit, actor: ACTOR } as unknown as CapabilityContext, dir, idp };
  }

  it('is registered, so the console and the terminal both get it', () => {
    expect(cap).toBeDefined();
  });

  it('is Set-ADUser, which is what the manual teaches', () => {
    expect(cap?.cmdlet).toBe('Set-ADUser');
  });

  it('takes the attributes a typo lands in', () => {
    const names = cap?.params.map((p) => p.name) ?? [];
    expect(names).toContain('Identity');
    expect(names).toContain('SamAccountName');
    expect(names).toContain('DisplayName');
    expect(names).toContain('Title');
    expect(names).toContain('EmailAddress');
  });

  it('corrects a surname without touching anything else', () => {
    const { ctx, dir } = makeCtx();
    const res = cap!.run(ctx, { Identity: 'praman', DisplayName: 'Priya Raman' });
    expect(res.ok).toBe(true);
    expect(dir.getUserByUsername('praman')?.displayName).toBe('Priya Raman');
  });

  it('renames the logon and the sign-in follows it', () => {
    const { ctx, dir, idp } = makeCtx();
    const res = cap!.run(ctx, { Identity: 'praman', SamAccountName: 'p.raman' });
    expect(res.ok).toBe(true);
    expect(dir.getUserByUsername('p.raman')).toBeDefined();
    expect(idp.signIn('p.raman', 'Password123!').ok).toBe(true);
  });

  it('carries the derived e-mail across a rename', () => {
    // Created as praman@iamlab.com by user.create. Nobody edited it, so it
    // should follow the logon name rather than be left pointing at a name
    // that no longer exists.
    const { ctx, dir } = makeCtx();
    cap!.run(ctx, { Identity: 'praman', SamAccountName: 'p.raman' });
    expect(dir.getUserByUsername('p.raman')?.email).toBe('p.raman@iamlab.com');
  });

  it('carries the derived e-mail even when the console echoes it back', () => {
    /*
     * The console pre-fills every field and sends all of them, so
     * -EmailAddress arrives holding the address as it was rather than absent.
     * Testing only the omitted case passed while the running application left
     * the address pointing at a logon name that no longer existed. What makes
     * an address derived is its shape, not whether the caller mentioned it.
     */
    const { ctx, dir } = makeCtx();
    cap!.run(ctx, {
      Identity: 'praman',
      SamAccountName: 'p.raman',
      EmailAddress: 'praman@iamlab.com',
    });
    expect(dir.getUserByUsername('p.raman')?.email).toBe('p.raman@iamlab.com');
  });

  it('keeps a hand-written e-mail when the logon name changes', () => {
    const { ctx, dir } = makeCtx();
    const u = dir.getUserByUsername('praman')!;
    dir.updateUser(u.id, { email: 'priya@partner.example' }, ACTOR);
    cap!.run(ctx, {
      Identity: 'praman',
      SamAccountName: 'p.raman',
      EmailAddress: 'priya@partner.example',
    });
    expect(dir.getUserByUsername('p.raman')?.email).toBe('priya@partner.example');
  });

  it('reports a clash rather than throwing at the console', () => {
    const { ctx, dir } = makeCtx();
    dir.createUser({
      username: 'taken',
      displayName: 'Someone Else',
      email: 'taken@iamlab.com',
      department: 'IT',
      title: 'Analyst',
    });
    const res = cap!.run(ctx, { Identity: 'praman', SamAccountName: 'taken' });
    expect(res.ok).toBe(false);
  });

  it('says so when the account does not exist', () => {
    const { ctx } = makeCtx();
    expect(cap!.run(ctx, { Identity: 'nobody', Title: 'Analyst' }).ok).toBe(false);
  });

  it('resolves no ticket kinds — a correction is not a workflow', () => {
    expect(cap?.resolvesTicketKinds).toEqual([]);
  });
});

describe('Active Directory offers Edit on the object itself', () => {
  const code = readFileSync(
    join(process.cwd(), 'src', 'ui', 'consoles', 'activeDirectoryWindow.ts'),
    'utf8',
  );

  it('has an Edit item on the right-click menu', () => {
    // The reported gap: right-clicking a user offered Delete but no way to fix
    // a typo, so the only repair was to destroy the account and start again.
    expect(code).toMatch(/label: 'Edit…'/);
  });

  it('opens a dialog that can write the change', () => {
    expect(code).toMatch(/function editUserDialog/);
    expect(code).toMatch(/'user\.update'/);
  });
});
