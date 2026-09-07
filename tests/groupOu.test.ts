/**
 * tests/groupOu.test.ts — a group lives somewhere.
 *
 * The first tickets in a bare domain build an OU structure and then populate
 * it. A learner did exactly that, selected Corps > Groups, chose New Group,
 * and every group landed in CN=Users instead — because `Group` had no `ouId`
 * at all. The console had nowhere to put one, so it listed every group in the
 * domain under CN=Users unconditionally, and selecting a container changed
 * nothing.
 *
 * The second half is the same failure one layer up. The manual teaches
 * `Move-ADObject -Identity jdoe -TargetPath Users` — "Put it in the right
 * OU." The cmdlet took -TargetDepartment and changed a text attribute;
 * `setUserOu` existed in the directory and was called by nobody. The one
 * operation that gives an OU structure a point was documented twice and
 * implemented never.
 *
 * These assert the placement is real: created into an OU, moved between OUs,
 * listed in exactly one place, and blocking the OU's deletion while it is
 * there.
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
  const groupsOu = dir.createOu('Groups', 'Security groups', corps.id, ACTOR);
  return { audit, dir, ctx, corps, groupsOu };
}

describe('a group is placed in an OU', () => {
  it('is created into the OU it was asked for', () => {
    const { dir, groupsOu } = setup();
    const g = dir.createGroup('grp-hr-readers', 'HR read access', ACTOR, groupsOu.id);
    expect(g.ouId).toBe(groupsOu.id);
  });

  it('has no OU when none is given, which is CN=Users', () => {
    const { dir } = setup();
    expect(dir.createGroup('grp-loose', '', ACTOR).ouId).toBeUndefined();
  });

  it('is listed under its OU and not also under CN=Users', () => {
    const { dir, groupsOu } = setup();
    dir.createGroup('grp-placed', '', ACTOR, groupsOu.id);
    dir.createGroup('grp-loose', '', ACTOR);

    // The console's two branches, expressed as the queries they run.
    const inOu = dir.listGroups().filter((g) => g.ouId === groupsOu.id);
    const inUsersContainer = dir.listGroups().filter((g) => !g.ouId);

    expect(inOu.map((g) => g.name)).toEqual(['grp-placed']);
    expect(inUsersContainer.map((g) => g.name)).toEqual(['grp-loose']);
  });

  it('can be moved back out to CN=Users', () => {
    const { dir, groupsOu } = setup();
    const g = dir.createGroup('grp-hr-readers', '', ACTOR, groupsOu.id);
    dir.setGroupOu(g.id, undefined, ACTOR);
    expect(dir.getGroupByName('grp-hr-readers')?.ouId).toBeUndefined();
  });

  it('refuses to move into an OU that does not exist', () => {
    const { dir } = setup();
    const g = dir.createGroup('grp-hr-readers', '', ACTOR);
    expect(() => dir.setGroupOu(g.id, 'ou-nope' as never, ACTOR)).toThrow(/not found/);
  });

  it('keeps its OU from being deleted while it is in there', () => {
    const { dir, groupsOu } = setup();
    dir.createGroup('grp-hr-readers', '', ACTOR, groupsOu.id);
    // An OU deleted out from under a group would leave the group pointing at
    // an OU that no longer exists.
    expect(() => dir.deleteOu(groupsOu.id, ACTOR)).toThrow(/not empty/);
  });
});

describe('New-ADGroup -Path', () => {
  it('creates the group inside the named OU', () => {
    const { dir, ctx, groupsOu } = setup();
    const res = cmd('New-ADGroup').run(ctx, {
      Name: 'grp-helpdesk-tier1',
      Description: 'HelpDesk',
      Path: 'Groups',
    });
    expect('error' in res).toBe(false);
    expect(dir.getGroupByName('grp-helpdesk-tier1')?.ouId).toBe(groupsOu.id);
  });

  it('names the OU it could not find rather than filing the group anywhere', () => {
    const { dir, ctx } = setup();
    const res = cmd('New-ADGroup').run(ctx, { Name: 'grp-x', Path: 'Nowhere' });
    expect('error' in res).toBe(true);
    if ('error' in res) expect(res.error).toMatch(/Nowhere/);
    expect(dir.getGroupByName('grp-x')).toBeUndefined();
  });
});

describe('Move-ADObject -TargetPath', () => {
  it('moves a group into an OU, which is what the manual documents', () => {
    const { dir, ctx, groupsOu } = setup();
    dir.createGroup('grp-hr-readers', '', ACTOR);
    const res = cmd('Move-ADObject').run(ctx, {
      Identity: 'grp-hr-readers',
      TargetPath: 'Groups',
    });
    expect('error' in res).toBe(false);
    expect(dir.getGroupByName('grp-hr-readers')?.ouId).toBe(groupsOu.id);
  });

  it('moves an account into an OU — setUserOu had no caller at all', () => {
    const { dir, ctx, corps } = setup();
    const u = dir.createUser({
      username: 'jdoe',
      displayName: 'J Doe',
      email: 'jdoe@iamlab.com',
      department: 'Finance',
      title: 'Analyst',
      mfa: 'none',
    });
    const res = cmd('Move-ADObject').run(ctx, { Identity: 'jdoe', TargetPath: 'Corps' });
    expect('error' in res).toBe(false);
    expect(dir.getUser(u.id)?.ouId).toBe(corps.id);
  });

  it('still transfers a department, so the mover tickets are untouched', () => {
    const { dir, ctx } = setup();
    const u = dir.createUser({
      username: 'jdoe',
      displayName: 'J Doe',
      email: 'jdoe@iamlab.com',
      department: 'Finance',
      title: 'Analyst',
      mfa: 'none',
    });
    const res = cmd('Move-ADObject').run(ctx, {
      Identity: 'jdoe',
      TargetDepartment: 'Engineering',
    });
    expect('error' in res).toBe(false);
    expect(dir.getUser(u.id)?.department).toBe('Engineering');
  });

  it('asks for one of the two rather than silently doing nothing', () => {
    const { dir, ctx } = setup();
    dir.createUser({
      username: 'jdoe',
      displayName: 'J Doe',
      email: 'jdoe@iamlab.com',
      department: 'Finance',
      title: 'Analyst',
      mfa: 'none',
    });
    const res = cmd('Move-ADObject').run(ctx, { Identity: 'jdoe' });
    expect('error' in res).toBe(true);
    if ('error' in res) expect(res.error).toMatch(/TargetPath or TargetDepartment/);
  });
});
