/**
 * tests/deleteObjects.test.ts — undoing what you built.
 *
 * An OU could be created and never removed. There was no
 * Remove-ADOrganizationalUnit in the registry at all, so neither the console
 * nor the shell could do it, while `deleteOu` sat in the directory carefully
 * refusing to delete a non-empty OU with no caller anywhere. Getting the
 * structure wrong on the first attempt meant Reset Environment.
 *
 * A group's Delete called `dir.deleteGroup` straight from the console,
 * bypassing the capability registry that CLAUDE.md names as the single source
 * of truth for operator actions. That private path is exactly why there was
 * no Remove-ADGroup: the console never needed one, so nobody noticed the
 * shell could not delete a group.
 *
 * The refusal on a non-empty OU is asserted as carefully as the success. In
 * AD you empty an OU before you remove it, and being told so is the lesson --
 * a delete that silently took the contents with it would teach the opposite.
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

function setup() {
  const audit = new MockAuditLog();
  const dir = new MockDirectory(audit);
  const ctx = { dir, audit, actor: ACTOR } as unknown as CapabilityContext;
  const corps = dir.createOu('Corps', 'Corporate', undefined, ACTOR);
  const mkUser = (username: string) =>
    dir.createUser({
      username,
      displayName: username,
      email: `${username}@omari.test`,
      department: 'Finance',
      title: 'Analyst',
      mfa: 'none',
    });
  return { audit, dir, ctx, corps, mkUser };
}

describe('Remove-ADGroup', () => {
  it('removes the group', () => {
    const { dir, ctx } = setup();
    dir.createGroup('grp-hr-readers', '', ACTOR);
    const res = cmd('Remove-ADGroup').run(ctx, { Name: 'grp-hr-readers' });
    expect('error' in res).toBe(false);
    expect(dir.getGroupByName('grp-hr-readers')).toBeUndefined();
  });

  it('takes the memberships with it, and audits each one', () => {
    const { dir, ctx, audit, mkUser } = setup();
    const u = mkUser('jdoe');
    const g = dir.createGroup('grp-hr-readers', '', ACTOR);
    dir.addToGroup(u.id, g.id, ACTOR);

    cmd('Remove-ADGroup').run(ctx, { Name: 'grp-hr-readers' });

    expect(dir.getUser(u.id)?.groupIds).not.toContain(g.id);
    // The membership loss is a recorded event, not something that vanished
    // when the group did.
    expect(audit.byAction('group.remove')).toHaveLength(1);
    expect(audit.byAction('group.deleted')).toHaveLength(1);
  });

  it('names the group it could not find', () => {
    const { ctx } = setup();
    const res = cmd('Remove-ADGroup').run(ctx, { Name: 'grp-nope' });
    expect('error' in res).toBe(true);
    if ('error' in res) expect(res.error).toMatch(/grp-nope/);
  });
});

describe('Remove-ADOrganizationalUnit', () => {
  it('removes an empty OU', () => {
    const { dir, ctx } = setup();
    const res = cmd('Remove-ADOrganizationalUnit').run(ctx, { Name: 'Corps' });
    expect('error' in res).toBe(false);
    expect(dir.getOuByName('Corps')).toBeUndefined();
  });

  it('refuses while an account is still in it, and says so readably', () => {
    const { dir, ctx, corps, mkUser } = setup();
    const u = mkUser('jdoe');
    dir.setUserOu(u.id, corps.id, ACTOR);

    const res = cmd('Remove-ADOrganizationalUnit').run(ctx, { Name: 'Corps' });
    expect('error' in res).toBe(true);
    if ('error' in res) {
      expect(res.error).toMatch(/not empty/);
      // The internal prefix is stripped: an operator reads this, not a log.
      expect(res.error).not.toMatch(/\[directory\]/);
    }
    expect(dir.getOuByName('Corps')).toBeDefined();
  });

  it('refuses while a group is still in it', () => {
    const { dir, ctx, corps } = setup();
    dir.createGroup('grp-hr-readers', '', ACTOR, corps.id);
    const res = cmd('Remove-ADOrganizationalUnit').run(ctx, { Name: 'Corps' });
    expect('error' in res).toBe(true);
    expect(dir.getOuByName('Corps')).toBeDefined();
  });

  it('refuses while a child OU is still in it', () => {
    const { dir, ctx, corps } = setup();
    dir.createOu('Groups', '', corps.id, ACTOR);
    const res = cmd('Remove-ADOrganizationalUnit').run(ctx, { Name: 'Corps' });
    expect('error' in res).toBe(true);
    expect(dir.getOuByName('Corps')).toBeDefined();
  });

  it('succeeds once the OU has been emptied', () => {
    const { dir, ctx, corps } = setup();
    const g = dir.createGroup('grp-hr-readers', '', ACTOR, corps.id);
    expect('error' in cmd('Remove-ADOrganizationalUnit').run(ctx, { Name: 'Corps' })).toBe(true);

    dir.setGroupOu(g.id, undefined, ACTOR);
    expect('error' in cmd('Remove-ADOrganizationalUnit').run(ctx, { Name: 'Corps' })).toBe(false);
    expect(dir.getOuByName('Corps')).toBeUndefined();
  });

  it('names the OU it could not find', () => {
    const { ctx } = setup();
    const res = cmd('Remove-ADOrganizationalUnit').run(ctx, { Name: 'Nowhere' });
    expect('error' in res).toBe(true);
    if ('error' in res) expect(res.error).toMatch(/Nowhere/);
  });
});

describe('every object type can be removed from the shell', () => {
  it('has a Remove cmdlet for accounts, groups and OUs', () => {
    // The console grew a Delete for each of these at different times; two of
    // them had no cmdlet, so the same action was possible in one interface
    // and impossible in the other.
    for (const name of ['Remove-ADUser', 'Remove-ADGroup', 'Remove-ADOrganizationalUnit']) {
      expect(CAPABILITY_BY_CMDLET[name.toLowerCase()], name).toBeDefined();
    }
  });
});
