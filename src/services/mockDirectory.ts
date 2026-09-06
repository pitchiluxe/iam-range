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
    const occupied = this.listUsers().some((u) => u.ouId === id);
    const hasChildren = this.childOus(id).length > 0;
    if (occupied || hasChildren) {
      throw new Error(`[directory] deleteOu: '${ou.name}' is not empty.`);
    }
    this.ous.delete(id);
    this.audit.record({ actorId: actor, action: 'ou.deleted', targetId: id });
  }

  /** Move an account into an OU. */
  setUserOu(userId: UserId, ouId: OuId | undefined, actor: UserId = SYSTEM_ACTOR): void {
    const u = this.users.get(userId);
    if (!u) throw new Error(`[directory] setUserOu: user ${userId} not found`);
    u.ouId = ouId;
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

  updateUser(
    id: UserId,
    changes: Partial<Pick<User, 'displayName' | 'email' | 'department' | 'title'>>,
    actor: UserId = SYSTEM_ACTOR,
  ): void {
    const u = this.users.get(id);
    if (!u) throw new Error(`[directory] updateUser: user ${id} not found`);
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
  getGroupByName(name: string): Group | undefined {
    return Array.from(this.groups.values()).find((g) => g.name === name);
  }

  createGroup(name: string, description: string, actor: UserId = SYSTEM_ACTOR): Group {
    const id = mkGroupId(name);
    const g: Group = { id, name, description, memberIds: [] };
    this.groups.set(id, g);
    this.audit.record({ actorId: actor, action: 'group.created', targetId: id });
    return g;
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

  addToGroup(userId: UserId, groupId: GroupId, by: UserId): void {
    const g = this.groups.get(groupId);
    const u = this.users.get(userId);
    if (!g) throw new Error(`[directory] addToGroup: group ${groupId} not found`);
    if (!u) throw new Error(`[directory] addToGroup: user ${userId} not found`);
    if (!g.memberIds.includes(userId)) g.memberIds.push(userId);
    if (!u.groupIds.includes(groupId)) u.groupIds.push(groupId);
    this.audit.record({ actorId: by, action: 'group.add', targetId: groupId, subjectId: userId });
  }

  removeFromGroup(userId: UserId, groupId: GroupId, by: UserId): void {
    const g = this.groups.get(groupId);
    const u = this.users.get(userId);
    if (!g || !u) return;
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
