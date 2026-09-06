/**
 * tests/directoryIntegrity.test.ts
 *
 * A directory that lets two accounts share a username is not a directory. These
 * cover the duplication bug and the credential bug that sat beside it:
 *
 *   - createUser() minted a random id and never checked the username, so
 *     clicking "Create User" twice produced two records for one person.
 *   - The IAM Console called idp.setPasswordResolver(), which REPLACES the
 *     resolver, so only the most recently created user could ever sign in.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockAuditLog, MockDirectory, MockIdP } from '@/services';

describe('username uniqueness', () => {
  let audit: MockAuditLog, dir: MockDirectory;

  beforeEach(() => {
    audit = new MockAuditLog();
    dir = new MockDirectory(audit);
  });

  const make = (username: string) =>
    dir.createUser({
      username,
      displayName: username,
      email: `${username}@northwind.example`,
      department: 'Finance',
      title: 'Analyst',
      mfa: 'none',
    });

  it('refuses a second account with the same username', () => {
    make('alex.morgan');
    expect(() => make('alex.morgan')).toThrow(/already exists/i);
  });

  it('leaves exactly one record after a rejected duplicate', () => {
    make('alex.morgan');
    try {
      make('alex.morgan');
    } catch {
      /* expected */
    }
    expect(dir.listUsers().filter((u) => u.username === 'alex.morgan')).toHaveLength(1);
  });

  it('treats usernames case-insensitively, as a real directory does', () => {
    make('alex.morgan');
    expect(() => make('Alex.Morgan')).toThrow(/already exists/i);
  });

  it('does not record a user.created audit event for the rejected duplicate', () => {
    make('alex.morgan');
    try {
      make('alex.morgan');
    } catch {
      /* expected */
    }
    expect(audit.byAction('user.created')).toHaveLength(1);
  });

  it('allows the username again once the original is deleted', () => {
    const u = make('alex.morgan');
    dir.deleteUser(u.id);
    expect(() => make('alex.morgan')).not.toThrow();
  });

  it('never returns duplicate usernames from listUsers', () => {
    make('a.one');
    make('b.two');
    const names = dir.listUsers().map((u) => u.username);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('credentials for multiple users coexist', () => {
  it('an earlier user can still sign in after a later one is provisioned', () => {
    const audit = new MockAuditLog();
    const dir = new MockDirectory(audit);
    const idp = new MockIdP(audit, dir);

    for (const name of ['ana.silva', 'ben.okafor']) {
      dir.createUser({
        username: name,
        displayName: name,
        email: `${name}@northwind.example`,
        department: 'Finance',
        title: 'Analyst',
        mfa: 'none',
      });
      // The accumulating API the console must use — not setPasswordResolver,
      // which replaces the single resolver and orphans every earlier user.
      idp.seedPasswords({ [name]: `${name}123` });
    }

    expect(idp.signIn('ben.okafor', 'ben.okafor123').ok).toBe(true);
    expect(idp.signIn('ana.silva', 'ana.silva123').ok).toBe(true);
  });
});
