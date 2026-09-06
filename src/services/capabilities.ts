/**
 * services/capabilities.ts — the single source of truth for what an IAM
 * operator can do in this simulation.
 *
 * Three surfaces consume this one list:
 *   - the IAM Console renders a form per capability
 *   - the PowerShell terminal dispatches cmdlets against it
 *   - ticket kinds declare which capability resolves them
 *
 * Before this existed, each surface kept its own idea of the action set and
 * they drifted: `password-reset` was the most-generated ticket kind in the app
 * and no console control could resolve it. Adding an action here makes it
 * reachable from every surface at once, and `ALL_TICKET_KINDS` plus the
 * drift-guard test makes an unresolvable ticket a build failure.
 *
 * Lives in services/ rather than domain/ because it needs live service
 * instances; domain/ is pure types and must stay that way.
 */
import type { MfaMethod, TicketKind, UserId, ValidatorKind } from '@/domain';
import type { MockAuditLog } from './mockAuditLog';
import type { MockDirectory } from './mockDirectory';
import type { MockIdP } from './mockIdP';
import type { MockTicketQueue } from './mockTicketQueue';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CapabilityContext {
  dir: MockDirectory;
  idp: MockIdP;
  tickets: MockTicketQueue;
  audit: MockAuditLog;
  /** Who is performing the action — the learner's operator identity. */
  actor: UserId;
}

export type ParamKind = 'user' | 'group' | 'role' | 'text' | 'password' | 'enum' | 'bool';

export interface CapabilityParam {
  /** PowerShell parameter name, e.g. 'Identity'. */
  name: string;
  /** Console field label, e.g. 'User'. */
  label: string;
  kind: ParamKind;
  required: boolean;
  options?: readonly string[];
}

export type CapabilityResult =
  { ok: true; message: string; rows?: Record<string, unknown>[] } | { ok: false; error: string };

export type ConsoleSection = 'users' | 'groups' | 'credentials' | 'access' | 'audit';

export interface IamCapability {
  id: string;
  label: string;
  synopsis: string;
  consoleSection: ConsoleSection;
  cmdlet: string;
  params: readonly CapabilityParam[];
  /**
   * Ticket kinds whose *substantive remediation* this performs — not merely
   * "can close the ticket". Closing a ticket without doing the work is exactly
   * the behaviour the drift guard exists to catch, so `ticket.resolve` below
   * deliberately declares none.
   */
  resolvesTicketKinds: readonly TicketKind[];
  /** Lab-step validator this action satisfies, when it maps to one. */
  validator?: ValidatorKind;
  /** True for read-only queries — the console renders these as tables. */
  readOnly?: boolean;
  /**
   * Set when the IAM Console already ships a bespoke, hand-written form for
   * this action. The generated sections render everything WITHOUT this flag,
   * so a newly declared capability appears in the console automatically and
   * cannot be forgotten — which is the drift that started all of this.
   */
  legacyConsoleForm?: boolean;
  run(ctx: CapabilityContext, args: Record<string, string>): CapabilityResult;
}

// ---------------------------------------------------------------------------
// Argument helpers
// ---------------------------------------------------------------------------

const err = (error: string): CapabilityResult => ({ ok: false, error });
const ok = (message: string, rows?: Record<string, unknown>[]): CapabilityResult =>
  rows ? { ok: true, message, rows } : { ok: true, message };

/** Resolve a user by username first, then by raw id — the console passes ids,
 *  the terminal passes what the learner typed. */
function findUser(ctx: CapabilityContext, ident: string) {
  return ctx.dir.getUserByUsername(ident) ?? ctx.dir.getUser(ident as UserId);
}

function findGroup(ctx: CapabilityContext, ident: string) {
  return ctx.dir.getGroupByName(ident) ?? ctx.dir.getGroup(ident as never);
}

function findRole(ctx: CapabilityContext, ident: string) {
  return ctx.dir.getRoleByName(ident) ?? ctx.dir.getRole(ident as never);
}

function truthy(v: string | undefined): boolean {
  if (v === undefined) return false;
  const s = v.trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === '$true' || s === '';
}

const P = {
  identity: { name: 'Identity', label: 'User', kind: 'user', required: true },
  group: { name: 'Group', label: 'Group', kind: 'group', required: true },
  role: { name: 'Role', label: 'Role', kind: 'role', required: true },
} satisfies Record<string, CapabilityParam>;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const CAPABILITIES: readonly IamCapability[] = [
  // ── Users ────────────────────────────────────────────────────────────────
  {
    id: 'user.list',
    legacyConsoleForm: true,
    label: 'Find Users',
    synopsis: 'List directory users, optionally filtered by department.',
    consoleSection: 'users',
    cmdlet: 'Get-ADUser',
    readOnly: true,
    params: [
      { name: 'Department', label: 'Department', kind: 'text', required: false },
      { name: 'Filter', label: 'Filter', kind: 'text', required: false },
    ],
    resolvesTicketKinds: [],
    run(ctx, a) {
      const dept = a.Department?.trim();
      const users = ctx.dir.listUsers(dept ? { department: dept } : undefined);
      return ok(
        `${users.length} user(s).`,
        users.map((u) => ({
          Name: u.displayName,
          SamAccountName: u.username,
          Department: u.department,
          Enabled: u.status === 'active',
          LockedOut: u.status === 'locked',
          MFA: u.mfa,
        })),
      );
    },
  },
  {
    id: 'user.create',
    legacyConsoleForm: true,
    label: 'Provision User',
    synopsis: 'Create a directory account for a new joiner.',
    consoleSection: 'users',
    cmdlet: 'New-ADUser',
    validator: 'user-created',
    params: [
      { name: 'SamAccountName', label: 'Username', kind: 'text', required: true },
      { name: 'Name', label: 'Display name', kind: 'text', required: true },
      { name: 'Department', label: 'Department', kind: 'text', required: true },
      { name: 'Title', label: 'Job title', kind: 'text', required: false },
    ],
    resolvesTicketKinds: ['onboarding'],
    run(ctx, a) {
      if (!a.SamAccountName || !a.Name) return err('SamAccountName and Name are required.');
      if (ctx.dir.getUserByUsername(a.SamAccountName))
        return err(`A user named '${a.SamAccountName}' already exists.`);
      const u = ctx.dir.createUser({
        username: a.SamAccountName,
        displayName: a.Name,
        email: `${a.SamAccountName}@northwind.example`,
        department: a.Department ?? 'Unassigned',
        title: a.Title ?? 'Employee',
        mfa: 'none',
      });
      return ok(`Created ${u.username} (${u.displayName}).`);
    },
  },
  {
    id: 'user.disable',
    legacyConsoleForm: true,
    label: 'Disable User',
    synopsis: 'Disable an account so it can no longer authenticate.',
    consoleSection: 'users',
    cmdlet: 'Disable-ADAccount',
    validator: 'user-disabled',
    params: [P.identity, { name: 'Reason', label: 'Reason', kind: 'text', required: false }],
    resolvesTicketKinds: ['leaver', 'termination'],
    run(ctx, a) {
      const u = findUser(ctx, a.Identity ?? '');
      if (!u) return err(`Cannot find an object with identity '${a.Identity}'.`);
      ctx.dir.disableUser(u.id, ctx.actor, a.Reason ?? 'unspecified');
      return ok(`Disabled ${u.username}.`);
    },
  },
  {
    id: 'user.enable',
    legacyConsoleForm: true,
    label: 'Enable User',
    synopsis: 'Re-enable a disabled account.',
    consoleSection: 'users',
    cmdlet: 'Enable-ADAccount',
    validator: 'user-enabled',
    params: [P.identity],
    resolvesTicketKinds: [],
    run(ctx, a) {
      const u = findUser(ctx, a.Identity ?? '');
      if (!u) return err(`Cannot find an object with identity '${a.Identity}'.`);
      ctx.dir.enableUser(u.id, ctx.actor);
      return ok(`Enabled ${u.username}.`);
    },
  },
  {
    id: 'user.delete',
    legacyConsoleForm: true,
    label: 'Delete User',
    synopsis: 'Permanently remove a directory account.',
    consoleSection: 'users',
    cmdlet: 'Remove-ADUser',
    validator: 'user-deleted',
    params: [P.identity],
    resolvesTicketKinds: [],
    run(ctx, a) {
      const u = findUser(ctx, a.Identity ?? '');
      if (!u) return err(`Cannot find an object with identity '${a.Identity}'.`);
      ctx.dir.deleteUser(u.id, ctx.actor);
      return ok(`Removed ${u.username}.`);
    },
  },
  {
    id: 'user.move',
    label: 'Move / Transfer',
    synopsis: 'Transfer a user to a different department.',
    consoleSection: 'users',
    cmdlet: 'Move-ADObject',
    validator: 'user-moved',
    params: [
      P.identity,
      { name: 'TargetDepartment', label: 'New department', kind: 'text', required: true },
    ],
    resolvesTicketKinds: ['mover', 'transfer'],
    run(ctx, a) {
      const u = findUser(ctx, a.Identity ?? '');
      if (!u) return err(`Cannot find an object with identity '${a.Identity}'.`);
      if (!a.TargetDepartment) return err('TargetDepartment is required.');
      ctx.dir.moveUser(u.id, a.TargetDepartment, ctx.actor);
      return ok(`Moved ${u.username} to ${a.TargetDepartment}.`);
    },
  },

  // ── Credentials ──────────────────────────────────────────────────────────
  {
    id: 'password.reset',
    label: 'Reset Password',
    synopsis: 'Set a new password, optionally forcing a change at next sign-in.',
    consoleSection: 'credentials',
    cmdlet: 'Set-ADAccountPassword',
    validator: 'password-reset',
    params: [
      P.identity,
      { name: 'NewPassword', label: 'New password', kind: 'password', required: true },
      {
        name: 'ChangePasswordAtLogon',
        label: 'Require change at next sign-in',
        kind: 'bool',
        required: false,
      },
    ],
    resolvesTicketKinds: ['password-reset'],
    run(ctx, a) {
      const u = findUser(ctx, a.Identity ?? '');
      if (!u) return err(`Cannot find an object with identity '${a.Identity}'.`);
      if (!a.NewPassword) return err('NewPassword is required.');
      const force = truthy(a.ChangePasswordAtLogon);
      ctx.idp.resetPassword(u.id, a.NewPassword, { forceChangeAtNextLogin: force }, ctx.actor);
      return ok(
        `Password reset for ${u.username}` +
          (force ? ' — user must change it at next sign-in.' : '.'),
      );
    },
  },
  {
    id: 'account.unlock',
    label: 'Unlock Account',
    synopsis: 'Clear a lockout so the user can sign in again.',
    consoleSection: 'credentials',
    cmdlet: 'Unlock-ADAccount',
    validator: 'account-unlocked',
    params: [P.identity],
    resolvesTicketKinds: ['password-reset'],
    run(ctx, a) {
      const u = findUser(ctx, a.Identity ?? '');
      if (!u) return err(`Cannot find an object with identity '${a.Identity}'.`);
      if (u.status !== 'locked') return err(`${u.username} is not locked out.`);
      ctx.dir.unlockUser(u.id, ctx.actor);
      return ok(`Unlocked ${u.username}.`);
    },
  },
  {
    id: 'mfa.reset',
    label: 'Reset MFA',
    synopsis: 'Clear a user MFA registration so they can re-enrol.',
    consoleSection: 'credentials',
    cmdlet: 'Reset-MfaRegistration',
    validator: 'mfa-reset',
    params: [P.identity],
    resolvesTicketKinds: ['mfa-issue'],
    run(ctx, a) {
      const u = findUser(ctx, a.Identity ?? '');
      if (!u) return err(`Cannot find an object with identity '${a.Identity}'.`);
      ctx.idp.resetMfa(u.id, ctx.actor);
      return ok(`MFA registration cleared for ${u.username}.`);
    },
  },
  {
    id: 'mfa.enroll',
    label: 'Enrol MFA',
    synopsis: 'Register an MFA method for a user.',
    consoleSection: 'credentials',
    cmdlet: 'Set-MfaMethod',
    // Enrolment reuses the challenge validator because idp.enrollMfa() records
    // an 'mfa.challenge' audit action — keeping the two consistent.
    validator: 'mfa-challenge-completed',
    params: [
      P.identity,
      {
        name: 'Method',
        label: 'Method',
        kind: 'enum',
        required: true,
        options: ['totp', 'fido2', 'sms', 'push'],
      },
    ],
    resolvesTicketKinds: ['mfa-issue'],
    run(ctx, a) {
      const u = findUser(ctx, a.Identity ?? '');
      if (!u) return err(`Cannot find an object with identity '${a.Identity}'.`);
      const m = (a.Method ?? '') as MfaMethod;
      if (!['totp', 'fido2', 'sms', 'push'].includes(m))
        return err(`'${a.Method}' is not a valid MFA method.`);
      ctx.idp.enrollMfa(u.id, m, ctx.actor);
      return ok(`Enrolled ${u.username} for ${m}.`);
    },
  },

  // ── Groups ───────────────────────────────────────────────────────────────
  {
    id: 'group.list',
    legacyConsoleForm: true,
    label: 'Find Groups',
    synopsis: 'List security groups.',
    consoleSection: 'groups',
    cmdlet: 'Get-ADGroup',
    readOnly: true,
    params: [],
    resolvesTicketKinds: [],
    run(ctx) {
      const groups = ctx.dir.listGroups();
      return ok(
        `${groups.length} group(s).`,
        groups.map((g) => ({ Name: g.name, Description: g.description })),
      );
    },
  },
  {
    id: 'group.members',
    label: 'Group Members',
    synopsis: 'List the members of a group, or the size of every group.',
    consoleSection: 'groups',
    cmdlet: 'Get-ADGroupMember',
    readOnly: true,
    legacyConsoleForm: true,
    params: [{ ...P.group, required: false }],
    resolvesTicketKinds: [],
    run(ctx, a) {
      if (a.Group) {
        const g = findGroup(ctx, a.Group);
        if (!g) return err(`Cannot find a group named '${a.Group}'.`);
        const rows = g.memberIds.map((id) => {
          const u = ctx.dir.getUser(id);
          return {
            SamAccountName: u?.username ?? id,
            Name: u?.displayName ?? '—',
            Department: u?.department ?? '—',
          };
        });
        return ok(`${rows.length} member(s) of ${g.name}.`, rows);
      }
      const groups = ctx.dir.listGroups();
      return ok(
        `${groups.length} group(s).`,
        groups.map((g) => ({ Name: g.name, Members: g.memberIds.length })),
      );
    },
  },
  {
    id: 'group.create',
    legacyConsoleForm: true,
    label: 'Create Group',
    synopsis: 'Create a security group.',
    consoleSection: 'groups',
    cmdlet: 'New-ADGroup',
    validator: 'group-created',
    params: [
      { name: 'Name', label: 'Group name', kind: 'text', required: true },
      { name: 'Description', label: 'Description', kind: 'text', required: false },
    ],
    resolvesTicketKinds: [],
    run(ctx, a) {
      if (!a.Name) return err('Name is required.');
      if (ctx.dir.getGroupByName(a.Name)) return err(`Group '${a.Name}' already exists.`);
      const g = ctx.dir.createGroup(a.Name, a.Description ?? '', ctx.actor);
      return ok(`Created group ${g.name}.`);
    },
  },
  {
    id: 'group.addMember',
    legacyConsoleForm: true,
    label: 'Add to Group',
    synopsis: 'Add a user to a security group.',
    consoleSection: 'groups',
    cmdlet: 'Add-ADGroupMember',
    validator: 'group-added',
    params: [P.identity, P.group],
    resolvesTicketKinds: ['access-request', 'onboarding'],
    run(ctx, a) {
      const u = findUser(ctx, a.Identity ?? '');
      if (!u) return err(`Cannot find an object with identity '${a.Identity}'.`);
      const g = findGroup(ctx, a.Group ?? '');
      if (!g) return err(`Cannot find a group named '${a.Group}'.`);
      ctx.dir.addToGroup(u.id, g.id, ctx.actor);
      return ok(`Added ${u.username} to ${g.name}.`);
    },
  },
  {
    id: 'group.removeMember',
    legacyConsoleForm: true,
    label: 'Remove from Group',
    synopsis: 'Remove a user from a security group.',
    consoleSection: 'groups',
    cmdlet: 'Remove-ADGroupMember',
    validator: 'group-removed',
    params: [P.identity, P.group],
    resolvesTicketKinds: ['mover', 'transfer', 'leaver'],
    run(ctx, a) {
      const u = findUser(ctx, a.Identity ?? '');
      if (!u) return err(`Cannot find an object with identity '${a.Identity}'.`);
      const g = findGroup(ctx, a.Group ?? '');
      if (!g) return err(`Cannot find a group named '${a.Group}'.`);
      ctx.dir.removeFromGroup(u.id, g.id, ctx.actor);
      return ok(`Removed ${u.username} from ${g.name}.`);
    },
  },

  // ── Access ───────────────────────────────────────────────────────────────
  {
    id: 'role.grant',
    label: 'Grant Role',
    synopsis: 'Grant a role directly to a user, outside any group.',
    consoleSection: 'access',
    cmdlet: 'Grant-IamRole',
    validator: 'role-granted',
    params: [P.identity, P.role],
    resolvesTicketKinds: ['access-request'],
    run(ctx, a) {
      const u = findUser(ctx, a.Identity ?? '');
      if (!u) return err(`Cannot find an object with identity '${a.Identity}'.`);
      const r = findRole(ctx, a.Role ?? '');
      if (!r) return err(`Cannot find a role named '${a.Role}'.`);
      ctx.dir.grantRoleDirect(u.id, r.id, ctx.actor);
      return ok(`Granted ${r.name} to ${u.username} (direct grant).`);
    },
  },
  {
    id: 'role.revoke',
    label: 'Revoke Role',
    synopsis: 'Revoke a directly-granted role.',
    consoleSection: 'access',
    cmdlet: 'Revoke-IamRole',
    validator: 'role-revoked',
    params: [P.identity, P.role],
    resolvesTicketKinds: ['termination', 'access-request'],
    run(ctx, a) {
      const u = findUser(ctx, a.Identity ?? '');
      if (!u) return err(`Cannot find an object with identity '${a.Identity}'.`);
      const r = findRole(ctx, a.Role ?? '');
      if (!r) return err(`Cannot find a role named '${a.Role}'.`);
      ctx.dir.revokeRoleDirect(u.id, r.id, ctx.actor);
      return ok(`Revoked ${r.name} from ${u.username}.`);
    },
  },
  {
    id: 'session.list',
    label: 'Active Sessions',
    synopsis: 'List active sign-in sessions.',
    consoleSection: 'access',
    cmdlet: 'Get-UserSession',
    readOnly: true,
    params: [{ ...P.identity, required: false }],
    resolvesTicketKinds: [],
    run(ctx, a) {
      const u = a.Identity ? findUser(ctx, a.Identity) : undefined;
      if (a.Identity && !u) return err(`Cannot find an object with identity '${a.Identity}'.`);
      const sessions = ctx.idp.listSessions(u?.id);
      return ok(
        `${sessions.length} active session(s).`,
        sessions.map((s) => ({
          SessionId: s.id,
          User: ctx.dir.getUser(s.userId)?.username ?? s.userId,
          MfaCompleted: s.mfaCompleted,
          IP: s.ip ?? '—',
        })),
      );
    },
  },
  {
    id: 'session.revoke',
    label: 'Revoke Sessions',
    synopsis: 'Kill every active session for a user.',
    consoleSection: 'access',
    cmdlet: 'Revoke-UserSession',
    validator: 'session-revoked',
    params: [P.identity],
    resolvesTicketKinds: ['termination', 'incident'],
    run(ctx, a) {
      const u = findUser(ctx, a.Identity ?? '');
      if (!u) return err(`Cannot find an object with identity '${a.Identity}'.`);
      const n = ctx.idp.revokeAllSessions(u.id, ctx.actor);
      return ok(`Revoked ${n} session(s) for ${u.username}.`);
    },
  },

  // ── Audit ────────────────────────────────────────────────────────────────
  {
    id: 'audit.list',
    legacyConsoleForm: true,
    label: 'Audit Log',
    synopsis: 'Show recent audit events.',
    consoleSection: 'audit',
    cmdlet: 'Get-IamAuditLog',
    readOnly: true,
    params: [{ name: 'Last', label: 'Entries', kind: 'text', required: false }],
    resolvesTicketKinds: [],
    run(ctx, a) {
      const n = Number(a.Last ?? 20);
      const events = ctx.audit.tail(Number.isFinite(n) && n > 0 ? n : 20);
      return ok(
        `${events.length} event(s).`,
        events.map((e) => ({
          Time: new Date(e.at).toLocaleTimeString(),
          Action: e.action,
          Actor: ctx.dir.getUser(e.actorId)?.username ?? e.actorId,
          Target: e.targetId ?? '—',
        })),
      );
    },
  },
];

// ---------------------------------------------------------------------------
// Derived lookups
// ---------------------------------------------------------------------------

export const CAPABILITY_BY_ID: Record<string, IamCapability> = Object.fromEntries(
  CAPABILITIES.map((c) => [c.id, c]),
);

/** Cmdlet names are matched case-insensitively, as PowerShell does. */
export const CAPABILITY_BY_CMDLET: Record<string, IamCapability> = Object.fromEntries(
  CAPABILITIES.map((c) => [c.cmdlet.toLowerCase(), c]),
);

export function capabilitiesForSection(section: ConsoleSection): IamCapability[] {
  return CAPABILITIES.filter((c) => c.consoleSection === section);
}

/** Every capability whose action is the substantive fix for `kind`. */
export function capabilitiesResolving(kind: TicketKind): IamCapability[] {
  return CAPABILITIES.filter((c) => c.resolvesTicketKinds.includes(kind));
}
