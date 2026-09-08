/**
 * services/mockDirectory.ts — in-memory directory of Users, Groups, and Roles.
 * Every mutation records an audit event and emits a bus event.
 */
import { nanoid } from 'nanoid';
import type {
  User,
  Group,
  RoleRecord,
  GroupId,
  RoleId,
  UserId,
  MfaMethod,
  Application,
  AppId,
  OuId,
  OrganizationalUnit,
} from '@/domain';
import { mkUserId, mkGroupId, mkRoleId, mkOuId, SYSTEM_ACTOR } from '@/domain';
import type { MockAuditLog } from './mockAuditLog';

export class MockDirectory {
  private users = new Map<UserId, User>();
  private groups = new Map<GroupId, Group>();
  private roles = new Map<RoleId, RoleRecord>();
  private appIndex = new Map<string, Application>();
  /** Empty on a fresh domain: the administrator builds the OU structure. */
  private ous = new Map<OuId, OrganizationalUnit>();

  constructor(private readonly audit: MockAuditLog) {}

  // --- ORGANISATIONAL UNITS -------------------------------------------------

  listOus(): OrganizationalUnit[] {
    return Array.from(this.ous.values());
  }
  getOu(id: OuId): OrganizationalUnit | undefined {
    return this.ous.get(id);
  }
  getOuByName(name: string): OrganizationalUnit | undefined {
    const want = name.toLowerCase();
    return Array.from(this.ous.values()).find((o) => o.name.toLowerCase() === want);
  }

  /** OUs directly beneath `parentId`, or beneath the domain root when omitted. */
  childOus(parentId?: OuId): OrganizationalUnit[] {
    return this.listOus().filter((o) => o.parentId === parentId);
  }

  createOu(
    name: string,
    description = '',
    parentId?: OuId,
    actor: UserId = SYSTEM_ACTOR,
  ): OrganizationalUnit {
    // Names are the natural key here as they are for groups, so a duplicate is
    // a mistake worth reporting rather than a second OU with the same label.
    if (this.getOuByName(name)) {
      throw new Error(`[directory] createOu: an OU named '${name}' already exists.`);
    }
    const ou: OrganizationalUnit = {
      id: mkOuId(name),
      name,
      description,
      createdAt: Date.now(),
      ...(parentId ? { parentId } : {}),
    };
    this.ous.set(ou.id, ou);
    this.audit.record({ actorId: actor, action: 'ou.created', targetId: ou.id });
    return ou;
  }

  /** Remove an OU. Refuses while anything still lives in it, as AD does. */
  deleteOu(id: OuId, actor: UserId = SYSTEM_ACTOR): void {
    const ou = this.ous.get(id);
    if (!ou) throw new Error(`[directory] deleteOu: OU ${id} not found`);
    // Groups count. Deleting an OU out from under one would leave it pointing
    // at an OU that no longer exists, which is the drift this project keeps
    // being bitten by.
    const occupied =
      this.listUsers().some((u) => u.ouId === id) ||
      this.listGroups().some((g) => g.ouId === id);
    const hasChildren = this.childOus(id).length > 0;
    if (occupied || hasChildren) {
      throw new Error(`[directory] deleteOu: '${ou.name}' is not empty.`);
    }
    this.ous.delete(id);
    this.audit.record({ actorId: actor, action: 'ou.deleted', targetId: id });
  }

  /**
   * Move a group into an OU (or out to CN=Users with `undefined`).
   *
   * The counterpart to setUserOu. Without it a group created in the wrong
   * place could only be deleted and remade, which is not how the snap-in
   * behaves and not what an operator would do.
   */
  setGroupOu(groupId: GroupId, ouId: OuId | undefined, actor: UserId = SYSTEM_ACTOR): void {
    const g = this.groups.get(groupId);
    if (!g) throw new Error(`[directory] setGroupOu: group ${groupId} not found`);
    if (ouId && !this.ous.has(ouId)) {
      throw new Error(`[directory] setGroupOu: OU ${ouId} not found`);
    }
    if (ouId) g.ouId = ouId;
    else delete g.ouId;
    this.audit.record({ actorId: actor, action: 'group.updated', targetId: groupId });
  }

  /**
   * Move an account into an OU (or out to CN=Users with `undefined`).
   *
   * The OU is checked, as setGroupOu checks it. Without that, an account could
   * be pointed at an OU that does not exist — and such an account appears
   * nowhere in the console at all: not under CN=Users, which lists accounts
   * with no ouId, and not under any OU, because no OU has that id. The account
   * is still in the directory and invisible in the snap-in, which is the worst
   * of both.
   */
  setUserOu(userId: UserId, ouId: OuId | undefined, actor: UserId = SYSTEM_ACTOR): void {
    const u = this.users.get(userId);
    if (!u) throw new Error(`[directory] setUserOu: user ${userId} not found`);
    if (ouId && !this.ous.has(ouId)) {
      throw new Error(`[directory] setUserOu: OU ${ouId} not found`);
    }
    if (ouId) u.ouId = ouId;
    else delete u.ouId;
    this.audit.record({ actorId: actor, action: 'user.moved', targetId: userId });
  }

  // --- USERS ----------------------------------------------------------------

  listUsers(filter?: Partial<Pick<User, 'department' | 'status'>>): User[] {
    const all = Array.from(this.users.values());
    if (!filter) return all;
    return all.filter((u) => {
      if (filter.department && u.department !== filter.department) return false;
      if (filter.status && u.status !== filter.status) return false;
      return true;
    });
  }

  getUser(id: UserId): User | undefined {
    return this.users.get(id);
  }
  /** Case-insensitive, matching real directory behaviour: 'A.Morgan' and
   *  'a.morgan' are the same account, never two. */
  getUserByUsername(username: string): User | undefined {
    const want = username.toLowerCase();
    for (const u of this.users.values()) {
      if (u.username.toLowerCase() === want) return u;
    }
    return undefined;
  }

  createUser(
    input: {
      username: string;
      displayName: string;
      email: string;
      department: string;
      title: string;
      managerId?: UserId;
      mfa?: MfaMethod;
      groupIds?: GroupId[];
      /**
       * Where the account lives. Optional, and absent means CN=Users, which is
       * what a real directory does with an account nobody placed.
       *
       * Last in the shape for the same reason createGroup's is last: the seed
       * and every existing caller predate it and must keep compiling.
       */
      ouId?: OuId;
    },
    actor: UserId = SYSTEM_ACTOR,
  ): User {
    // Usernames are the directory's natural key, so they must be unique. Group
    // ids are derived from the group name and therefore de-duplicate by
    // construction; user ids carry a nanoid suffix and do not, so the check has
    // to be explicit. Without it, provisioning the same joiner twice produced
    // two records for one person and both showed up in the console.
    const existing = this.getUserByUsername(input.username);
    if (existing) {
      throw new Error(`[directory] createUser: a user named '${input.username}' already exists.`);
    }
    // Checked before the account is written, not after. A provision that
    // reports a bad OU but leaves the account behind anyway is the worse of
    // the two failures: the ticket looks done and the account is in the wrong
    // place, which is precisely the bug this parameter exists to fix.
    if (input.ouId && !this.ous.has(input.ouId)) {
      throw new Error(`[directory] createUser: OU ${input.ouId} not found`);
    }
    const id = mkUserId(input.username + '-' + nanoid(6));
    const user: User = {
      id,
      username: input.username,
      displayName: input.displayName,
      email: input.email,
      department: input.department,
      title: input.title,
      status: 'active',
      mfa: input.mfa ?? 'none',
      groupIds: input.groupIds ?? [],
      createdAt: Date.now(),
      ...(input.managerId ? { managerId: input.managerId } : {}),
      ...(input.ouId ? { ouId: input.ouId } : {}),
    };
    this.users.set(id, user);
    this.audit.record({ actorId: actor, action: 'user.created', targetId: id });
    return user;
  }

  /**
   * Idempotent create: returns the existing account when the username is
   * already taken, otherwise provisions it.
   *
   * Seed functions compose — a per-lab seed calls applyBaseline() and a
   * template seed may call it again — so seeding has to be safe to re-run.
   * Before this existed, a second baseline pass duplicated every user, which
   * is what surfaced as repeated names in the IAM Console's user list.
   *
   * Use this in seeds. Use createUser() for learner-driven provisioning, where
   * a duplicate username is a mistake that should be reported, not absorbed.
   */
  ensureUser(input: Parameters<MockDirectory['createUser']>[0], actor?: UserId): User {
    return this.getUserByUsername(input.username) ?? this.createUser(input, actor);
  }

  disableUser(id: UserId, by: UserId, _reason = 'unspecified'): void {
    const u = this.users.get(id);
    if (!u) throw new Error(`[directory] disableUser: user ${id} not found`);
    if (u.status === 'disabled') return;
    u.status = 'disabled';
    u.disabledAt = Date.now();
    this.audit.record({ actorId: by, action: 'user.disabled', targetId: id });
  }

  enableUser(id: UserId, by: UserId): void {
    const u = this.users.get(id);
    if (!u) throw new Error(`[directory] enableUser: user ${id} not found`);
    if (u.status !== 'disabled') return;
    u.status = 'active';
    u.disabledAt = undefined;
    this.audit.record({ actorId: by, action: 'user.unlocked', targetId: id });
  }

  /**
   * Return a locked-out account to service. Deliberately narrow: it only acts
   * on status 'locked', so it can never quietly resurrect an account that was
   * disabled by a leaver or termination ticket. Unlocking and re-enabling are
   * different decisions with different approvals behind them.
   */
  unlockUser(id: UserId, by: UserId): void {
    const u = this.users.get(id);
    if (!u) throw new Error(`[directory] unlockUser: user ${id} not found`);
    if (u.status !== 'locked') return;
    u.status = 'active';
    this.audit.record({ actorId: by, action: 'account.unlock', targetId: id });
  }

  /**
   * Correct an account in place.
   *
   * `username` is here for the same reason the rest are: a logon name is typed
   * by hand at creation and a typo in it used to be unfixable, because the only
   * repair available was Delete and New User. That throws away the account id,
   * and the id is what every group membership, audit entry and ticket points
   * at -- so correcting one character cost the person their history.
   *
   * Renaming does not touch the id. Callers that hold a credential keyed by
   * username must be told separately; MockIdP.renameAccount is the one that
   * matters, and the user.update capability calls both.
   */
  updateUser(
    id: UserId,
    changes: Partial<Pick<User, 'username' | 'displayName' | 'email' | 'department' | 'title'>>,
    actor: UserId = SYSTEM_ACTOR,
  ): void {
    const u = this.users.get(id);
    if (!u) throw new Error(`[directory] updateUser: user ${id} not found`);
    if (changes.username !== undefined && changes.username !== u.username) {
      // Usernames are the directory's natural key, so the same uniqueness rule
      // createUser enforces applies to a rename. Checked before anything is
      // written: a half-applied correction is worse than a refused one.
      const clash = this.getUserByUsername(changes.username);
      if (clash) {
        throw new Error(
          `[directory] updateUser: a user named '${changes.username}' already exists.`,
        );
      }
      u.username = changes.username;
    }
    if (changes.displayName !== undefined) u.displayName = changes.displayName;
    if (changes.email !== undefined) u.email = changes.email;
    if (changes.department !== undefined) u.department = changes.department;
    if (changes.title !== undefined) u.title = changes.title;
    this.audit.record({ actorId: actor, action: 'user.updated', targetId: id });
  }

  deleteUser(id: UserId, actor: UserId = SYSTEM_ACTOR): void {
    const u = this.users.get(id);
    if (!u) throw new Error(`[directory] deleteUser: user ${id} not found`);
    // Remove from all groups first
    for (const gid of [...u.groupIds]) {
      this.removeFromGroup(id, gid, actor);
    }
    this.users.delete(id);
    this.audit.record({ actorId: actor, action: 'user.deleted', targetId: id });
  }

  recordSignIn(id: UserId): void {
    const u = this.users.get(id);
    if (u) u.lastSignInAt = Date.now();
  }

  // --- GROUPS ---------------------------------------------------------------

  listGroups(): Group[] {
    return Array.from(this.groups.values());
  }
  getGroup(id: GroupId): Group | undefined {
    return this.groups.get(id);
  }
  /**
   * Find a group by name, case-insensitively.
   *
   * As getUserByUsername and getOuByName already were, and as a real directory
   * is. This was the one exact-match lookup left, so `Add-ADGroupMember -Group
   * GRP-HR-READERS` reported that the group did not exist while the console
   * listed it two panes away — and the learner has no way to tell a typo from
   * a broken cmdlet.
   */
  getGroupByName(name: string): Group | undefined {
    const want = name.toLowerCase();
    return Array.from(this.groups.values()).find((g) => g.name.toLowerCase() === want);
  }

  /**
   * Create a security group, optionally inside an OU.
   *
   * `ouId` is last and optional so the seed and every existing caller are
   * unchanged: omitting it means CN=Users, which is where AD puts an object
   * nobody placed.
   */
  createGroup(
    name: string,
    description: string,
    actor: UserId = SYSTEM_ACTOR,
    ouId?: OuId,
  ): Group {
    // A group id is its name, so a second group of the same name replaced the
    // first in the map — silently, taking its entire membership with it. The
    // console's Create Group checked for a duplicate first and so never hit
    // it; a seed re-run, a script, or the same name in a different case did.
    // Names are the natural key here as they are for OUs and accounts, and a
    // duplicate is a mistake to report rather than absorb.
    const existing = this.getGroupByName(name);
    if (existing) {
      throw new Error(`[directory] createGroup: a group named '${name}' already exists.`);
    }
    const id = mkGroupId(name);
    const g: Group = { id, name, description, memberIds: [], ...(ouId ? { ouId } : {}) };
    this.groups.set(id, g);
    this.audit.record({ actorId: actor, action: 'group.created', targetId: id });
    return g;
  }

  /**
   * Idempotent create: returns the existing group when the name is taken.
   *
   * The counterpart to ensureUser, and it exists for the same reason. Seeds
   * compose — a per-lab seed calls applyBaseline() and a template seed may
   * call it again — so seeding has to be safe to re-run. Use this in seeds,
   * and createGroup for learner-driven work, where a duplicate name is a
   * mistake that should be reported rather than absorbed.
   */
  ensureGroup(
    name: string,
    description: string,
    actor: UserId = SYSTEM_ACTOR,
    ouId?: OuId,
  ): Group {
    return this.getGroupByName(name) ?? this.createGroup(name, description, actor, ouId);
  }

  updateGroup(
    id: GroupId,
    changes: Partial<Pick<Group, 'name' | 'description'>>,
    actor: UserId = SYSTEM_ACTOR,
  ): void {
    const g = this.groups.get(id);
    if (!g) throw new Error(`[directory] updateGroup: group ${id} not found`);
    if (changes.name !== undefined) g.name = changes.name;
    if (changes.description !== undefined) g.description = changes.description;
    this.audit.record({ actorId: actor, action: 'group.updated', targetId: id });
  }

  deleteGroup(id: GroupId, actor: UserId = SYSTEM_ACTOR): void {
    const g = this.groups.get(id);
    if (!g) throw new Error(`[directory] deleteGroup: group ${id} not found`);
    // Remove all members first
    for (const uid of [...g.memberIds]) {
      this.removeFromGroup(uid, id, actor);
    }
    this.groups.delete(id);
    this.audit.record({ actorId: actor, action: 'group.deleted', targetId: id });
  }

  /**
   * Add an account to a group.
   *
   * The audit event is written only when the membership actually changed.
   * These events are evidence: the ticket reviewer reads `group.add` and
   * `group.remove` to decide whether a transfer was carried out. An event for
   * a change that did not happen is a check that cannot be failed, which is
   * worse than no check because it produces a verdict the learner trusts.
   */
  addToGroup(userId: UserId, groupId: GroupId, by: UserId): void {
    const g = this.groups.get(groupId);
    const u = this.users.get(userId);
    if (!g) throw new Error(`[directory] addToGroup: group ${groupId} not found`);
    if (!u) throw new Error(`[directory] addToGroup: user ${userId} not found`);
    if (g.memberIds.includes(userId) && u.groupIds.includes(groupId)) return;
    if (!g.memberIds.includes(userId)) g.memberIds.push(userId);
    if (!u.groupIds.includes(groupId)) u.groupIds.push(groupId);
    this.audit.record({ actorId: by, action: 'group.add', targetId: groupId, subjectId: userId });
  }

  /**
   * Remove an account from a group.
   *
   * Same rule as addToGroup, and this is the direction where it mattered: the
   * transfer review's "Old access removed" check looks for a `group.remove`
   * event, and this used to write one whether or not the account had ever been
   * in the group. Running the cmdlet against any group at all closed the
   * ticket — which is exactly the half of a transfer the ticket is trying to
   * teach people not to skip.
   */
  removeFromGroup(userId: UserId, groupId: GroupId, by: UserId): void {
    const g = this.groups.get(groupId);
    const u = this.users.get(userId);
    if (!g || !u) return;
    if (!g.memberIds.includes(userId) && !u.groupIds.includes(groupId)) return;
    g.memberIds = g.memberIds.filter((id) => id !== userId);
    u.groupIds = u.groupIds.filter((id) => id !== groupId);
    this.audit.record({
      actorId: by,
      action: 'group.remove',
      targetId: groupId,
      subjectId: userId,
    });
  }

  moveUser(userId: UserId, toDepartment: string, by: UserId): void {
    const u = this.users.get(userId);
    if (!u) throw new Error(`[directory] moveUser: user ${userId} not found`);
    u.department = toDepartment;
    this.audit.record({ actorId: by, action: 'user.moved', targetId: userId });
  }

  // --- ROLES ----------------------------------------------------------------

  listRoles(): RoleRecord[] {
    return Array.from(this.roles.values());
  }
  getRole(id: RoleId): RoleRecord | undefined {
    return this.roles.get(id);
  }
  getRoleByName(name: string): RoleRecord | undefined {
    return Array.from(this.roles.values()).find((r) => r.name === name);
  }

  createRole(
    name: string,
    description: string,
    permissions: string[],
    appId?: AppId,
    actor: UserId = SYSTEM_ACTOR,
  ): RoleRecord {
    const id = mkRoleId(name);
    const r: RoleRecord = appId
      ? { id, name, description, permissions, appId }
      : { id, name, description, permissions };
    this.roles.set(id, r);
    if (appId) {
      const a = this.appIndex.get(appId);
      if (a && !a.requiredRoleIds.includes(id)) a.requiredRoleIds.push(id);
    }
    this.audit.record({ actorId: actor, action: 'role.created', targetId: id });
    return r;
  }

  grantRoleDirect(userId: UserId, roleId: RoleId, by: UserId): void {
    const u = this.users.get(userId);
    if (!u) throw new Error(`[directory] grantRole: user not found`);
    u.directRoleIds ??= [];
    if (!u.directRoleIds.includes(roleId)) u.directRoleIds.push(roleId);
    this.audit.record({ actorId: by, action: 'role.grant', targetId: roleId, subjectId: userId });
  }

  revokeRoleDirect(userId: UserId, roleId: RoleId, by: UserId): void {
    const u = this.users.get(userId);
    if (!u) throw new Error(`[directory] revokeRole: user not found`);
    if (u.directRoleIds) {
      u.directRoleIds = u.directRoleIds.filter((r) => r !== roleId);
    }
    this.audit.record({ actorId: by, action: 'role.revoke', targetId: roleId, subjectId: userId });
  }

  effectiveRoleIds(userId: UserId): RoleId[] {
    const u = this.users.get(userId);
    if (!u) return [];
    // Effective access is group-inherited roles UNION roles granted directly.
    // Direct grants used to be dropped here, so a grant recorded in the audit
    // log had no effect on access — the exact "standing privilege" the RBAC
    // and access-review labs ask the learner to find.
    const ids = new Set<RoleId>();
    for (const gid of u.groupIds) {
      const g = this.groups.get(gid);
      if (g?.ownerRoleId) ids.add(g.ownerRoleId);
    }
    for (const rid of u.directRoleIds ?? []) ids.add(rid);
    return Array.from(ids);
  }

  isDormant(userId: UserId, days: number, now = Date.now()): boolean {
    const u = this.users.get(userId);
    if (!u) return false;
    if (!u.lastSignInAt) return true;
    return now - u.lastSignInAt > days * 24 * 60 * 60 * 1000;
  }

  // --- APP REGISTRY (lightweight) -------------------------------------------

  registerApp(app: Application): void {
    this.appIndex.set(app.id, app);
  }
  getApp(id: string): Application | undefined {
    return this.appIndex.get(id);
  }

  // --- RESET ----------------------------------------------------------------

  reset(): void {
    this.users.clear();
    this.groups.clear();
    this.roles.clear();
    this.appIndex.clear();
    this.ous.clear();
  }
}
