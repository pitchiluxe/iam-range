/**
 * tests/userOu.test.ts — an account lives somewhere too.
 *
 * groupOu.test.ts fixed this for groups: New Group filed everything under
 * CN=Users because `Group` had no `ouId`. The same hole was left open one
 * object type over, and it is the one the tickets actually walk into.
 *
 * The first three tickets in a bare domain are: build Corp/Users, Corp/Groups
 * and the rest; create the security groups; then onboard three starters and
 * "place them in the right OU and groups". A learner does exactly that,
 * selects Corp > Users, chooses New User — and the account appears in
 * CN=Users at the top of the tree instead, because:
 *
 *   - `createUser()` took no ouId and set none,
 *   - `New-ADUser` had no -Path parameter to carry one, and
 *   - New User was the one dialog that never read the selected container.
 *
 * Move-ADObject could put it right afterwards, so the structure was
 * reachable — but the ticket asks the learner to provision into the OU, and
 * the console said that was impossible by silently doing something else.
 *
 * These assert placement at provisioning time, at all three layers.
 */
import { describe, it, expect } from 'vitest';
import { MockAuditLog, MockDirectory, CAPABILITY_BY_CMDLET } from '@/services';
import type { CapabilityContext } from '@/services';
import type { UserId } from '@/domain';

const ACTOR = 'admin-1' as UserId;

const cmd = (name: string) => {
  const c = CAPABILITY_BY_CMDLET[name.toLowerCase()];
  if (!c) throw new Error(`No capability for cmdlet ${name}`);
  return c;
};

/** The structure the first ticket asks for, as far as these tests need it. */
function setup() {
  const audit = new MockAuditLog();
  const dir = new MockDirectory(audit);
  const idp = { seedPasswords: () => {}, resetPassword: () => {} };
  const ctx = { dir, audit, idp, actor: ACTOR } as unknown as CapabilityContext;
  const corp = dir.createOu('Corp', 'Corporate', undefined, ACTOR);
  const usersOu = dir.createOu('Users', 'Staff accounts', corp.id, ACTOR);
  const svcOu = dir.createOu('ServiceAccounts', 'Service accounts', corp.id, ACTOR);
  return { audit, dir, idp, ctx, corp, usersOu, svcOu };
}

describe('a user is placed in an OU at creation', () => {
  const person = {
    username: 'jdoe',
    displayName: 'John Doe',
    email: 'jdoe@omari.test',
    department: 'Help Desk',
    title: 'Service Desk Analyst',
  };

  it('is created into the OU it was asked for', () => {
    const { dir, usersOu } = setup();
    const u = dir.createUser({ ...person, ouId: usersOu.id }, ACTOR);
    expect(u.ouId).toBe(usersOu.id);
  });

  it('has no OU when none is given, which is CN=Users', () => {
    const { dir } = setup();
    expect(dir.createUser(person, ACTOR).ouId).toBeUndefined();
  });

  it('is listed under its OU and not also under CN=Users', () => {
    const { dir, usersOu } = setup();
    dir.createUser({ ...person, ouId: usersOu.id }, ACTOR);
    dir.createUser({ ...person, username: 'loose', email: 'loose@omari.test' }, ACTOR);

    // The console's two branches, expressed as the queries they run.
    const inOu = dir.listUsers().filter((u) => u.ouId === usersOu.id);
    const inUsersContainer = dir.listUsers().filter((u) => !u.ouId);

    expect(inOu.map((u) => u.username)).toEqual(['jdoe']);
    expect(inUsersContainer.map((u) => u.username)).toEqual(['loose']);
  });

  it('refuses an OU that does not exist rather than filing the account loose', () => {
    const { dir } = setup();
    expect(() => dir.createUser({ ...person, ouId: 'ou-nope' as never }, ACTOR)).toThrow(
      /not found/,
    );
    expect(dir.getUserByUsername('jdoe')).toBeUndefined();
  });

  it('keeps its OU from being deleted while the account is in there', () => {
    const { dir, usersOu } = setup();
    dir.createUser({ ...person, ouId: usersOu.id }, ACTOR);
    expect(() => dir.deleteOu(usersOu.id, ACTOR)).toThrow(/not empty/);
  });
});

describe('New-ADUser -Path', () => {
  const args = {
    SamAccountName: 'mchen',
    Name: 'Maya Chen',
    Department: 'HR',
    Title: 'HR Business Partner',
  };

  it('creates the account inside the named OU', () => {
    const { dir, ctx, usersOu } = setup();
    const res = cmd('New-ADUser').run(ctx, { ...args, Path: 'Users' });
    expect('error' in res).toBe(false);
    expect(dir.getUserByUsername('mchen')?.ouId).toBe(usersOu.id);
  });

  it('still creates in CN=Users when no -Path is given', () => {
    const { dir, ctx } = setup();
    const res = cmd('New-ADUser').run(ctx, args);
    expect('error' in res).toBe(false);
    expect(dir.getUserByUsername('mchen')?.ouId).toBeUndefined();
  });

  it('names the OU it could not find rather than filing the account anywhere', () => {
    const { dir, ctx } = setup();
    const res = cmd('New-ADUser').run(ctx, { ...args, Path: 'Nowhere' });
    expect('error' in res).toBe(true);
    if ('error' in res) expect(res.error).toMatch(/Nowhere/);
    // The account must not exist at all: a half-completed provision that
    // reports failure but leaves an account behind is worse than either.
    expect(dir.getUserByUsername('mchen')).toBeUndefined();
  });

  it('says where it put the account, so the destination is checkable', () => {
    const { ctx } = setup();
    const res = cmd('New-ADUser').run(ctx, { ...args, Path: 'ServiceAccounts' });
    expect('error' in res).toBe(false);
    if (!('error' in res)) expect(res.message).toMatch(/ServiceAccounts/);
  });

  it('exposes -Path as a parameter, so the console form and terminal both offer it', () => {
    const param = cmd('New-ADUser').params.find((p) => p.name === 'Path');
    expect(param).toBeDefined();
    expect(param?.required).toBe(false);
  });
});
