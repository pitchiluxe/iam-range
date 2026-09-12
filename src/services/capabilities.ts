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
import { COMPANY } from '@/config';
import type { MockAuditLog } from './mockAuditLog';
import type { MockDirectory, ShareAccess } from './mockDirectory';
import type { MockIdP } from './mockIdP';
import type { MockTicketQueue } from './mockTicketQueue';
import type { MockPim } from './mockPim';
import type { MockCloudTenant, CloudVendor } from './mockCloudTenant';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CapabilityContext {
  dir: MockDirectory;
  /** Privileged Identity Management. Optional so hosts without PIM still
   *  satisfy the contract; the PIM capabilities refuse cleanly when absent. */
  pim?: MockPim;
  /** Cloud tenants in front of the domain, keyed by vendor. Optional for the
   *  same reason as PIM: a host without them refuses cleanly rather than
   *  pretending the estate is hybrid. */
  cloud?: Partial<Record<CloudVendor, MockCloudTenant>>;
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

export type ConsoleSection =
  | 'users'
  | 'groups'
  | 'credentials'
  | 'access'
  /** Okta and Entra, and the sync between them and the domain. */
  | 'cloud'
  | 'audit';

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

/**
 * Resolve the tenant a cloud cmdlet was aimed at.
 *
 * `-Provider` is required rather than defaulted: in a hybrid estate the answer
 * to "where did you make that change" is the whole diagnosis, and a cmdlet
 * that silently picks one tenant would let the learner skip the question.
 */
function tenantFor(
  ctx: CapabilityContext,
  provider: string | undefined,
): { tenant: MockCloudTenant } | { error: string } {
  const key = (provider ?? '').trim().toLowerCase();
  if (!key) return { error: 'Provider is required: okta or entra.' };
  if (key !== 'okta' && key !== 'entra') {
    return { error: `Unknown provider '${provider}'. Use okta or entra.` };
  }
  const tenant = ctx.cloud?.[key];
  if (!tenant) return { error: `No ${key} tenant is configured on this host.` };
  return { tenant };
}

const P = {
  identity: { name: 'Identity', label: 'User', kind: 'user', required: true },
  provider: {
    name: 'Provider',
    label: 'Provider (okta | entra)',
    kind: 'text',
    required: true,
  },
  upn: { name: 'Upn', label: 'User principal name', kind: 'text', required: true },
  group: { name: 'Group', label: 'Group', kind: 'group', required: true },
  role: { name: 'Role', label: 'Role', kind: 'role', required: true },
  name: { name: 'Name', label: 'Name', kind: 'text', required: true },
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
      { name: 'AccountPassword', label: 'Password', kind: 'password', required: false },
      {
        name: 'ChangePasswordAtLogon',
        label: 'Must change at next sign-in',
        kind: 'bool',
        required: false,
      },
      // Named to match New-ADUser -Path, and resolved the way New-ADGroup and
      // New-ADOrganizationalUnit resolve theirs. Without it the onboarding
      // tickets — "place them in the right OU" — could not be done from the
      // console or the terminal at all: every account landed in CN=Users and
      // had to be rescued afterwards with Move-ADObject.
      { name: 'Path', label: 'Target OU', kind: 'text', required: false },
    ],
    resolvesTicketKinds: ['onboarding'],
    run(ctx, a) {
      if (!a.SamAccountName || !a.Name) return err('SamAccountName and Name are required.');
      if (ctx.dir.getUserByUsername(a.SamAccountName))
        return err(`A user named '${a.SamAccountName}' already exists.`);
      // Resolved before anything is written, so a typo in the OU name fails
      // the whole provision rather than half of it.
      const target = a.Path ? ctx.dir.getOuByName(a.Path) : undefined;
      if (a.Path && !target) return err(`Cannot find an OU named '${a.Path}'.`);
      const u = ctx.dir.createUser({
        username: a.SamAccountName,
        displayName: a.Name,
        email: `${a.SamAccountName}@${COMPANY.domain}`,
        department: a.Department ?? 'Unassigned',
        title: a.Title ?? 'Employee',
        mfa: 'none',
        ...(target ? { ouId: target.id } : {}),
      });

      // An account with no credential cannot sign in, which makes the new user
      // invisible at the lock screen and the ticket impossible to finish.
      const explicitPassword = a.AccountPassword?.trim();
      if (explicitPassword) {
        const res = ctx.idp.resetPassword(u.id, explicitPassword, { forceChangeAtNextLogin: truthy(a.ChangePasswordAtLogon) }, ctx.actor);
        if (!res.ok) return err(res.reason);
      } else {
        // Default to the house convention so provisioning always yields a
        // usable account. A generated default bypasses the live policy so the
        // account can always be created; the user must change it before using it.
        ctx.idp.seedPasswords({ [u.username]: `${a.SamAccountName}123` });
      }

      // The destination is named on the way out. "Created jdoe" with no
      // container is what made the wrong placement invisible until somebody
      // went looking in the tree for an account that was not there.
      return ok(
        `Created ${u.username} (${u.displayName}) in ${target ? target.name : 'CN=Users'}. ` +
          'Password set.',
      );
    },
  },
  {
    /*
     * Correct an account that was created wrong.
     *
     * Every attribute here is typed by hand at creation, so every one of them
     * can carry a typo, and until this existed none of them could be changed
     * afterwards -- Properties is a read-only sheet, and the only repair on
     * offer was Delete followed by New User. That costs the account its id,
     * and with it every group membership, audit entry and ticket that points
     * at the id. Fixing one character should not cost a person their history,
     * and a real operator would reach for Set-ADUser rather than start again.
     *
     * Department is deliberately absent: a change of department is a transfer,
     * which is a business event with an approval behind it, and user.move
     * already models it. Mixing the two would let a transfer be performed as
     * though it were a spelling correction.
     */
    id: 'user.update',
    label: 'Edit User',
    synopsis: 'Correct an account’s name, logon name, title or e-mail.',
    consoleSection: 'users',
    cmdlet: 'Set-ADUser',
    validator: 'user-updated',
    params: [
      P.identity,
      { name: 'SamAccountName', label: 'New logon name', kind: 'text', required: false },
      { name: 'DisplayName', label: 'Display name', kind: 'text', required: false },
      { name: 'Title', label: 'Job title', kind: 'text', required: false },
      { name: 'EmailAddress', label: 'E-mail', kind: 'text', required: false },
    ],
    // A correction is not a workflow: nothing in the queue is asking for it.
    resolvesTicketKinds: [],
    run(ctx, a) {
      const u = findUser(ctx, a.Identity ?? '');
      if (!u) return err(`Cannot find an object with identity '${a.Identity}'.`);

      const oldUsername = u.username;
      const newUsername = (a.SamAccountName ?? '').trim() || oldUsername;
      const renaming = newUsername !== oldUsername;

      if (renaming && findUser(ctx, newUsername)) {
        return err(`A user named '${newUsername}' already exists.`);
      }

      /*
       * The address follows the logon name while it still looks derived.
       *
       * user.create writes `<logon>@<domain>`, so after a rename an untouched
       * address points at a name that no longer exists. Rewriting one an
       * operator actually typed would be wrong the other way round, so the
       * test is the address's shape: does it still equal what the system
       * generated for the old name?
       *
       * Shape rather than "did the caller pass -EmailAddress", because the
       * console pre-fills every field and sends them all -- so the address
       * arrives echoed back rather than absent, and a check on absence left
       * the running application pointing at the old name while the unit test,
       * which omitted the parameter, passed.
       */
      const derived = `${oldUsername}@${COMPANY.domain}`;
      const typed = (a.EmailAddress ?? '').trim();
      const stale = renaming && (typed === derived || (!typed && u.email === derived));
      const email = stale
        ? `${newUsername}@${COMPANY.domain}`
        : typed || u.email;

      const display = (a.DisplayName ?? '').trim() || u.displayName;
      const title = (a.Title ?? '').trim() || u.title;

      if (
        !renaming &&
        display === u.displayName &&
        title === u.title &&
        email === u.email
      ) {
        return ok(`Nothing to change on ${u.username}.`);
      }

      try {
        ctx.dir.updateUser(
          u.id,
          { username: newUsername, displayName: display, email, title },
          ctx.actor,
        );
      } catch (e) {
        // The directory throws on a clash; the console shows a message.
        return err(e instanceof Error ? e.message.replace(/^\[directory\] \w+: /, '') : String(e));
      }

      // The credential is filed under the username, so it has to move too, or
      // the account this just repaired can no longer sign in.
      if (renaming) ctx.idp.renameAccount(oldUsername, newUsername);

      const what = renaming
        ? `Renamed ${oldUsername} to ${newUsername}.`
        : `Updated ${u.username}.`;
      return ok(what);
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
    synopsis: 'Move an object into an OU, or transfer a user to another department.',
    consoleSection: 'users',
    cmdlet: 'Move-ADObject',
    validator: 'user-moved',
    params: [
      P.identity,
      // -TargetPath is what the manual teaches and what real AD uses to place
      // an object in an OU. It was documented in two places and implemented in
      // none: the cmdlet only ever changed a department attribute, so the OU
      // structure the first tickets ask you to build could not be populated.
      { name: 'TargetPath', label: 'Target OU', kind: 'text', required: false },
      { name: 'TargetDepartment', label: 'New department', kind: 'text', required: false },
    ],
    resolvesTicketKinds: ['mover', 'transfer'],
    run(ctx, a) {
      // An OU move applies to any object, so groups are resolved too -- a
      // group is a directory object placed in an OU exactly as an account is.
      if (a.TargetPath) {
        const ou = ctx.dir.getOuByName(a.TargetPath);
        if (!ou) return err(`Cannot find an OU named '${a.TargetPath}'.`);

        const user = findUser(ctx, a.Identity ?? '');
        if (user) {
          ctx.dir.setUserOu(user.id, ou.id, ctx.actor);
          return ok(`Moved ${user.username} to ${ou.name}.`);
        }
        const group = ctx.dir.getGroupByName(a.Identity ?? '');
        if (group) {
          ctx.dir.setGroupOu(group.id, ou.id, ctx.actor);
          return ok(`Moved ${group.name} to ${ou.name}.`);
        }
        return err(`Cannot find an object with identity '${a.Identity}'.`);
      }

      const u = findUser(ctx, a.Identity ?? '');
      if (!u) return err(`Cannot find an object with identity '${a.Identity}'.`);
      if (!a.TargetDepartment) return err('TargetPath or TargetDepartment is required.');
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
      const res = ctx.idp.resetPassword(u.id, a.NewPassword, { forceChangeAtNextLogin: force }, ctx.actor);
      if (!res.ok) return err(res.reason);
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
      ctx.idp.clearFailedAttempts(u.id);
      return ok(`Unlocked ${u.username}.`);
    },
  },
  {
    id: 'password.policy.set',
    label: 'Set Password Policy',
    synopsis: 'Configure minimum length, complexity and maximum age for passwords.',
    consoleSection: 'credentials',
    cmdlet: 'Set-PasswordPolicy',
    validator: 'password-policy-set',
    params: [
      { name: 'MinimumLength', label: 'Minimum length', kind: 'text', required: false },
      { name: 'ComplexityEnabled', label: 'Require complexity', kind: 'bool', required: false },
      { name: 'MaximumAge', label: 'Maximum age (days)', kind: 'text', required: false },
    ],
    resolvesTicketKinds: [],
    run(ctx, a) {
      ctx.idp.setPasswordPolicy(
        {
          minimumLength: a.MinimumLength ? Number(a.MinimumLength) : undefined,
          complexityEnabled: a.ComplexityEnabled !== undefined ? truthy(a.ComplexityEnabled) : undefined,
          maximumAge: a.MaximumAge ? Number(a.MaximumAge) : undefined,
        },
        ctx.actor,
      );
      const p = ctx.idp.getPasswordPolicy();
      return ok(`Password policy set: minimum ${p.minimumLength}, complexity ${p.complexityEnabled}, max age ${p.maximumAge}.`);
    },
  },
  {
    id: 'password.policy.get',
    label: 'Get Password Policy',
    synopsis: 'Show the current password policy.',
    consoleSection: 'credentials',
    cmdlet: 'Get-PasswordPolicy',
    readOnly: true,
    params: [],
    resolvesTicketKinds: [],
    run(ctx) {
      const p = ctx.idp.getPasswordPolicy();
      return ok(`Minimum ${p.minimumLength}, complexity ${p.complexityEnabled}, max age ${p.maximumAge}.`);
    },
  },
  {
    id: 'lockout.policy.set',
    label: 'Set Account Lockout Policy',
    synopsis: 'Configure how many failed sign-ins lock an account and for how long.',
    consoleSection: 'credentials',
    cmdlet: 'Set-AccountLockoutPolicy',
    validator: 'lockout-policy-set',
    params: [
      { name: 'Threshold', label: 'Failed attempts before lockout', kind: 'text', required: false },
      { name: 'Duration', label: 'Lockout duration (minutes)', kind: 'text', required: false },
    ],
    resolvesTicketKinds: [],
    run(ctx, a) {
      ctx.idp.setLockoutPolicy(
        {
          threshold: a.Threshold ? Number(a.Threshold) : undefined,
          duration: a.Duration ? Number(a.Duration) : undefined,
        },
        ctx.actor,
      );
      const p = ctx.idp.getLockoutPolicy();
      return ok(`Lockout policy set: threshold ${p.threshold}, duration ${p.duration} minutes.`);
    },
  },
  {
    id: 'lockout.policy.get',
    label: 'Get Account Lockout Policy',
    synopsis: 'Show the current lockout policy.',
    consoleSection: 'credentials',
    cmdlet: 'Get-AccountLockoutPolicy',
    readOnly: true,
    params: [],
    resolvesTicketKinds: [],
    run(ctx) {
      const p = ctx.idp.getLockoutPolicy();
      return ok(`Threshold ${p.threshold}, duration ${p.duration} minutes.`);
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
  // ── Organisational units ─────────────────────────────────────────────────
  {
    id: 'ou.delete',
    legacyConsoleForm: true,
    label: 'Delete Organizational Unit',
    synopsis: 'Remove an empty organisational unit.',
    consoleSection: 'users',
    cmdlet: 'Remove-ADOrganizationalUnit',
    validator: 'ou-deleted',
    params: [{ name: 'Name', label: 'OU name', kind: 'text', required: true }],
    resolvesTicketKinds: [],
    run(ctx, a) {
      const ou = ctx.dir.getOuByName(a.Name ?? '');
      if (!ou) return err(`Cannot find an OU named '${a.Name}'.`);
      try {
        // deleteOu refuses while accounts, groups or child OUs are still in
        // there. Surfacing that refusal is the point: in AD you empty an OU
        // before you remove it, and finding that out is part of the lesson.
        ctx.dir.deleteOu(ou.id, ctx.actor);
      } catch (e) {
        return err(e instanceof Error ? e.message.replace('[directory] deleteOu: ', '') : String(e));
      }
      return ok(`Removed OU ${ou.name}.`);
    },
  },
  {
    id: 'ou.create',
    label: 'New Organizational Unit',
    synopsis: 'Create an organisational unit under the domain or another OU.',
    consoleSection: 'users',
    cmdlet: 'New-ADOrganizationalUnit',
    validator: 'ou-created',
    params: [
      { name: 'Name', label: 'OU name', kind: 'text', required: true },
      { name: 'Path', label: 'Parent OU', kind: 'text', required: false },
      { name: 'Description', label: 'Description', kind: 'text', required: false },
    ],
    resolvesTicketKinds: [],
    run(ctx, a) {
      if (!a.Name) return err('Name is required.');
      const parent = a.Path ? ctx.dir.getOuByName(a.Path) : undefined;
      if (a.Path && !parent) return err(`Cannot find an OU named '${a.Path}'.`);
      try {
        const ou = ctx.dir.createOu(a.Name, a.Description ?? '', parent?.id, ctx.actor);
        return ok(`Created OU ${ou.name}${parent ? ` under ${parent.name}` : ''}.`);
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  },
  {
    id: 'ou.list',
    label: 'Organizational Units',
    synopsis: 'List the organisational units in the domain.',
    consoleSection: 'users',
    cmdlet: 'Get-ADOrganizationalUnit',
    readOnly: true,
    legacyConsoleForm: true,
    params: [],
    resolvesTicketKinds: [],
    run(ctx) {
      const ous = ctx.dir.listOus();
      return ok(
        `${ous.length} organisational unit(s).`,
        ous.map((o) => ({
          Name: o.name,
          Parent: o.parentId ? (ctx.dir.getOu(o.parentId)?.name ?? '—') : 'domain root',
          Description: o.description || '—',
        })),
      );
    },
  },
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
    id: 'user.memberships',
    label: 'Group Membership',
    synopsis: 'List the groups a person belongs to — the check after a transfer.',
    consoleSection: 'groups',
    cmdlet: 'Get-ADPrincipalGroupMembership',
    readOnly: true,
    params: [P.identity],
    resolvesTicketKinds: [],
    run(ctx, a) {
      const u = findUser(ctx, a.Identity ?? '');
      if (!u) return err(`Cannot find an object with identity '${a.Identity}'.`);
      const rows = ctx.dir
        .listGroups()
        .filter((g) => g.memberIds.includes(u.id))
        .map((g) => ({ Name: g.name, Description: g.description || '-' }));
      return ok(
        rows.length === 0
          ? `${u.username} is not a member of any group.`
          : `${u.username} is a member of ${rows.length} group(s). After a transfer, the old ` +
            'role should not be among them.',
        rows,
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
  // ── Shares ───────────────────────────────────────────────────────────────
  {
    id: 'share.create',
    label: 'Create File Share',
    synopsis: 'Create an NTFS-style share that groups or users can be granted access to.',
    consoleSection: 'groups',
    cmdlet: 'New-Share',
    validator: 'share-created',
    params: [P.name, { name: 'Path', label: 'UNC or local path', kind: 'text', required: true }],
    resolvesTicketKinds: [],
    run(ctx, a) {
      const name = a.Name?.trim();
      const path = a.Path?.trim();
      if (!name) return err('Name is required.');
      if (!path) return err('Path is required.');
      if (ctx.dir.getShare(name)) return err(`A share named '${name}' already exists.`);
      ctx.dir.createShare(name, path, ctx.actor);
      return ok(`Created share ${name}.`);
    },
  },
  {
    id: 'share.delete',
    label: 'Delete File Share',
    synopsis: 'Remove a share.',
    consoleSection: 'groups',
    cmdlet: 'Remove-Share',
    validator: 'share-deleted',
    params: [P.name],
    resolvesTicketKinds: [],
    run(ctx, a) {
      const name = a.Name?.trim();
      if (!name) return err('Name is required.');
      try {
        ctx.dir.deleteShare(name, ctx.actor);
        return ok(`Deleted share ${name}.`);
      } catch (e) {
        return err(String(e));
      }
    },
  },
  {
    id: 'share.list',
    label: 'List File Shares',
    synopsis: 'List shares and their permissions.',
    consoleSection: 'groups',
    cmdlet: 'Get-Share',
    readOnly: true,
    params: [],
    resolvesTicketKinds: [],
    run(ctx) {
      const shares = ctx.dir.listShares();
      return ok(`${shares.length} share(s).`, shares.map((s) => ({
        Name: s.name,
        Path: s.path,
        Permissions: s.permissions.map((p) => `${p.type} ${p.access} for ${p.trusteeName}`).join(', '),
      })));
    },
  },
  {
    id: 'share.grant',
    label: 'Grant Share Permission',
    synopsis: 'Allow or deny access to a share for a user or group.',
    consoleSection: 'groups',
    cmdlet: 'Grant-SharePermission',
    validator: 'share-permission-granted',
    params: [
      { name: 'Name', label: 'Share name', kind: 'text', required: true },
      { name: 'Trustee', label: 'User or group name', kind: 'text', required: true },
      {
        name: 'Access',
        label: 'Access level',
        kind: 'enum',
        required: true,
        options: ['Read', 'Modify', 'Full'],
      },
      {
        name: 'Type',
        label: 'Allow or Deny',
        kind: 'enum',
        required: false,
        options: ['Allow', 'Deny'],
      },
    ],
    resolvesTicketKinds: [],
    run(ctx, a) {
      const name = a.Name?.trim();
      const trustee = a.Trustee?.trim();
      const access = a.Access as ShareAccess;
      const type = (a.Type as 'Allow' | 'Deny') ?? 'Allow';
      if (!name) return err('Name is required.');
      if (!trustee) return err('Trustee is required.');
      if (!access || !['Read', 'Modify', 'Full'].includes(access)) return err('Access must be Read, Modify or Full.');
      if (!['Allow', 'Deny'].includes(type)) return err('Type must be Allow or Deny.');
      const s = ctx.dir.getShare(name);
      if (!s) return err(`Cannot find a share named '${name}'.`);
      // Verify the trustee exists as a user or group so the permission is not a typo.
      const u = ctx.dir.getUserByUsername(trustee);
      const g = ctx.dir.getGroupByName(trustee);
      if (!u && !g) return err(`Cannot find a user or group named '${trustee}'.`);
      ctx.dir.grantSharePermission(name, trustee, access, type, ctx.actor);
      return ok(`Granted ${type} ${access} on ${name} to ${trustee}.`);
    },
  },
  {
    id: 'share.revoke',
    label: 'Revoke Share Permission',
    synopsis: 'Remove all share permissions for a trustee.',
    consoleSection: 'groups',
    cmdlet: 'Revoke-SharePermission',
    validator: 'share-revoked',
    params: [
      { name: 'Name', label: 'Share name', kind: 'text', required: true },
      { name: 'Trustee', label: 'User or group name', kind: 'text', required: true },
    ],
    resolvesTicketKinds: [],
    run(ctx, a) {
      const name = a.Name?.trim();
      const trustee = a.Trustee?.trim();
      if (!name) return err('Name is required.');
      if (!trustee) return err('Trustee is required.');
      try {
        ctx.dir.revokeSharePermission(name, trustee, ctx.actor);
        return ok(`Revoked permissions on ${name} for ${trustee}.`);
      } catch (e) {
        return err(String(e));
      }
    },
  },
  {
    id: 'share.effective',
    label: 'Effective Access',
    synopsis: 'Show the access a user has to a share after group membership is resolved.',
    consoleSection: 'groups',
    cmdlet: 'Get-EffectiveAccess',
    readOnly: true,
    validator: 'effective-access-checked',
    params: [
      { name: 'Name', label: 'Share name', kind: 'text', required: true },
      P.identity,
    ],
    resolvesTicketKinds: [],
    run(ctx, a) {
      const name = a.Name?.trim();
      const identity = a.Identity ?? '';
      if (!name) return err('Name is required.');
      const u = findUser(ctx, identity);
      if (!u) return err(`Cannot find an object with identity '${identity}'.`);
      try {
        const effective = ctx.dir.getEffectiveAccess(name, u.username);
        ctx.audit.record({
          actorId: ctx.actor,
          action: 'share.effective.checked',
          targetId: name,
          subjectId: u.id,
          note: `${u.username} has ${effective} on ${name}.`,
        });
        return ok(`${u.username} has ${effective} on ${name}.`);
      } catch (e) {
        return err(String(e));
      }
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
      // Named to match New-ADGroup -Path, and resolved the same way
      // New-ADOrganizationalUnit resolves its parent.
      { name: 'Path', label: 'Target OU', kind: 'text', required: false },
    ],
    resolvesTicketKinds: [],
    run(ctx, a) {
      if (!a.Name) return err('Name is required.');
      if (ctx.dir.getGroupByName(a.Name)) return err(`Group '${a.Name}' already exists.`);
      const target = a.Path ? ctx.dir.getOuByName(a.Path) : undefined;
      if (a.Path && !target) return err(`Cannot find an OU named '${a.Path}'.`);
      const g = ctx.dir.createGroup(a.Name, a.Description ?? '', ctx.actor, target?.id);
      return ok(`Created group ${g.name}${target ? ` in ${target.name}` : ''}.`);
    },
  },
  {
    id: 'group.delete',
    legacyConsoleForm: true,
    label: 'Delete Group',
    synopsis: 'Permanently remove a security group.',
    consoleSection: 'groups',
    cmdlet: 'Remove-ADGroup',
    validator: 'group-deleted',
    params: [{ name: 'Name', label: 'Group name', kind: 'text', required: true }],
    resolvesTicketKinds: [],
    run(ctx, a) {
      const g = ctx.dir.getGroupByName(a.Name ?? '');
      if (!g) return err(`Cannot find a group named '${a.Name}'.`);
      // Members are removed first by deleteGroup, so every membership loss is
      // audited rather than vanishing with the group.
      ctx.dir.deleteGroup(g.id, ctx.actor);
      return ok(`Removed group ${g.name}.`);
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
    id: 'role.create',
    label: 'Create Role',
    synopsis: 'Create a privileged role that can be assigned or made eligible.',
    consoleSection: 'access',
    cmdlet: 'New-IamRole',
    validator: 'role-created',
    params: [P.name, { name: 'Description', label: 'Description', kind: 'text', required: true }, { name: 'Permissions', label: 'Permissions (comma or space separated)', kind: 'text', required: false }],
    resolvesTicketKinds: [],
    run(ctx, a) {
      const name = a.Name?.trim();
      if (!name) return err('Name is required.');
      if (ctx.dir.getRoleByName(name)) return err(`A role named '${name}' already exists.`);
      const permissions = (a.Permissions?.split(/[,\s]+/) ?? ['*']).filter((p) => p.length > 0);
      const description = a.Description?.trim() || name;
      const r = ctx.dir.createRole(name, description, permissions, undefined, ctx.actor);
      return ok(`Created role ${r.name}.`);
    },
  },
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

  // -- Cloud identity: Okta and Entra ID ------------------------------------
  {
    id: 'cloud.connect.okta',
    label: 'Connect to Okta',
    synopsis: 'Open a session against the Okta tenant. Other cloud cmdlets need it.',
    consoleSection: 'cloud',
    cmdlet: 'Connect-Okta',
    params: [],
    resolvesTicketKinds: [],
    run(ctx) {
      const t = ctx.cloud?.okta;
      if (!t) return err('No Okta tenant is configured on this host.');
      const res = t.connect();
      return res.ok ? ok(res.message) : err(res.error);
    },
  },
  {
    id: 'cloud.connect.entra',
    label: 'Connect to Entra ID',
    synopsis: 'Open a session against the Microsoft Entra ID tenant.',
    consoleSection: 'cloud',
    cmdlet: 'Connect-Entra',
    params: [],
    resolvesTicketKinds: [],
    run(ctx) {
      const t = ctx.cloud?.entra;
      if (!t) return err('No Entra tenant is configured on this host.');
      const res = t.connect();
      return res.ok ? ok(res.message) : err(res.error);
    },
  },
  {
    id: 'cloud.users',
    label: 'Cloud Accounts',
    synopsis: 'List accounts in a tenant, showing which are synced and which are cloud-only.',
    consoleSection: 'cloud',
    cmdlet: 'Get-CloudUser',
    readOnly: true,
    params: [P.provider, { ...P.upn, required: false }],
    resolvesTicketKinds: [],
    run(ctx, a) {
      const r = tenantFor(ctx, a.Provider);
      if ('error' in r) return err(r.error);
      const all = r.tenant.list();
      const rows = (a.Upn ? all.filter((u) => u.upn.toLowerCase() === a.Upn!.toLowerCase()) : all)
        .map((u) => ({
          UPN: u.upn,
          Name: u.displayName,
          Origin: u.origin,
          Status: u.status,
          Sessions: u.sessions,
          LastSynced: u.lastSyncedAt ? new Date(u.lastSyncedAt).toLocaleTimeString() : 'never',
        }));
      return ok(`${rows.length} account(s) in ${r.tenant.vendor.tenantName}.`, rows);
    },
  },
  {
    id: 'cloud.syncstatus',
    label: 'Sync Status',
    synopsis: 'When the last cycle ran, and which accounts the tenant has not caught up on.',
    consoleSection: 'cloud',
    cmdlet: 'Get-DirectorySyncStatus',
    readOnly: true,
    params: [P.provider],
    resolvesTicketKinds: [],
    run(ctx, a) {
      const r = tenantFor(ctx, a.Provider);
      if ('error' in r) return err(r.error);
      const mins = r.tenant.minutesSinceSync();
      const pending = r.tenant.pendingDelta();
      const rows = pending.map((d) => ({ UPN: d.upn, Change: d.change, Detail: d.detail }));
      const when = mins === null ? 'never run' : `${mins} minute(s) ago`;
      return ok(
        pending.length === 0
          ? `Last cycle ${when}. The tenant matches the directory.`
          : `Last cycle ${when}. ${pending.length} account(s) are out of date — ` +
            'until a cycle runs, the cloud still enforces the old state.',
        rows,
      );
    },
  },
  {
    id: 'cloud.sync',
    label: 'Run Sync Cycle',
    synopsis: 'Push directory state to the tenant now, instead of waiting for the schedule.',
    consoleSection: 'cloud',
    cmdlet: 'Start-DirectorySync',
    validator: 'cloud-synced',
    params: [P.provider],
    resolvesTicketKinds: ['termination', 'transfer'],
    run(ctx, a) {
      const r = tenantFor(ctx, a.Provider);
      if ('error' in r) return err(r.error);
      const res = r.tenant.sync(ctx.actor);
      if ('error' in res) return err(res.error);
      const conflictNote =
        res.conflicts.length > 0
          ? ` ${res.conflicts.length} soft-match conflict(s): ${res.conflicts.join(', ')} now has ` +
            'more than one object. Resolve the duplicate before anyone signs in with it.'
          : '';
      return ok(
        `Sync complete: ${res.created} created, ${res.updated} updated.${conflictNote}`,
      );
    },
  },
  {
    id: 'cloud.newuser',
    label: 'New Cloud-Only Account',
    synopsis: 'Create an account directly in the tenant, owned by nothing on premises.',
    consoleSection: 'cloud',
    cmdlet: 'New-CloudOnlyUser',
    validator: 'cloud-user-created',
    params: [
      P.provider,
      P.upn,
      { name: 'DisplayName', label: 'Display name', kind: 'text', required: true },
    ],
    resolvesTicketKinds: [],
    run(ctx, a) {
      const r = tenantFor(ctx, a.Provider);
      if ('error' in r) return err(r.error);
      if (!a.Upn || !a.DisplayName) return err('Upn and DisplayName are required.');
      const res = r.tenant.createCloudOnly(a.Upn, a.DisplayName, ctx.actor);
      return res.ok ? ok(res.message) : err(res.error);
    },
  },
  {
    id: 'cloud.disable',
    label: 'Disable Cloud Account',
    synopsis: 'Disable an account in the tenant. Refused for accounts synced from the domain.',
    consoleSection: 'cloud',
    cmdlet: 'Disable-CloudUser',
    validator: 'cloud-user-disabled',
    params: [P.provider, P.upn],
    resolvesTicketKinds: [],
    run(ctx, a) {
      const r = tenantFor(ctx, a.Provider);
      if ('error' in r) return err(r.error);
      if (!a.Upn) return err('Upn is required.');
      const res = r.tenant.disable(a.Upn, ctx.actor);
      return res.ok ? ok(res.message) : err(res.error);
    },
  },
  {
    id: 'cloud.revoke',
    label: 'Revoke Cloud Sessions',
    synopsis: 'End live sessions. Disabling an account does not close the ones already open.',
    consoleSection: 'cloud',
    cmdlet: 'Revoke-CloudSession',
    validator: 'session-revoked',
    params: [P.provider, P.upn],
    resolvesTicketKinds: [],
    run(ctx, a) {
      const r = tenantFor(ctx, a.Provider);
      if ('error' in r) return err(r.error);
      if (!a.Upn) return err('Upn is required.');
      const res = r.tenant.revokeSessions(a.Upn, ctx.actor);
      return res.ok ? ok(res.message) : err(res.error);
    },
  },
  {
    id: 'cloud.scim',
    label: 'SCIM Provisioning',
    synopsis: 'Switch application provisioning on, so deprovisioning reaches inside the app.',
    consoleSection: 'cloud',
    cmdlet: 'Set-ScimProvisioning',
    validator: 'scim-enabled',
    params: [
      P.provider,
      { name: 'App', label: 'Application', kind: 'text', required: true },
      { name: 'Enabled', label: 'Enabled', kind: 'bool', required: false },
    ],
    resolvesTicketKinds: ['termination'],
    run(ctx, a) {
      const r = tenantFor(ctx, a.Provider);
      if ('error' in r) return err(r.error);
      if (!a.App) return err('App is required.');
      // Absent means on: the cmdlet exists to close a provisioning gap, and
      // requiring -Enabled true to do the obvious thing is a trap.
      const enabled = a.Enabled === undefined ? true : truthy(a.Enabled);
      const res = r.tenant.setScim(a.App, enabled, ctx.actor);
      return res.ok ? ok(res.message) : err(res.error);
    },
  },
  {
    id: 'cloud.orphans',
    label: 'Orphaned App Accounts',
    synopsis: 'Accounts still working inside applications for people disabled upstream.',
    consoleSection: 'cloud',
    cmdlet: 'Get-OrphanedAppAccount',
    readOnly: true,
    params: [P.provider],
    resolvesTicketKinds: [],
    run(ctx, a) {
      const r = tenantFor(ctx, a.Provider);
      if ('error' in r) return err(r.error);
      const rows = r.tenant.orphanedAppAccounts().map((o) => ({ Application: o.app, UPN: o.upn }));
      return ok(
        rows.length === 0
          ? 'No orphaned application accounts — deprovisioning reached every app.'
          : `${rows.length} account(s) still active in applications after the person was disabled.`,
        rows,
      );
    },
  },
  {
    id: 'cloud.duplicates',
    label: 'Duplicate Identities',
    synopsis: 'Objects sharing a UPN — what a failed soft match leaves behind.',
    consoleSection: 'cloud',
    cmdlet: 'Get-CloudDuplicate',
    readOnly: true,
    params: [P.provider],
    resolvesTicketKinds: [],
    run(ctx, a) {
      const r = tenantFor(ctx, a.Provider);
      if ('error' in r) return err(r.error);
      const rows = r.tenant.duplicates().map((u) => ({
        UPN: u.upn,
        Name: u.displayName,
        Origin: u.origin,
        Status: u.status,
      }));
      return ok(
        rows.length === 0
          ? 'No duplicate identities in this tenant.'
          : `${rows.length} object(s) share a UPN. One person, more than one identity.`,
        rows,
      );
    },
  },

  // -- Privileged Identity Management ---------------------------------------
  {
    id: 'pim.list',
    label: 'Privileged Assignments',
    synopsis: 'Show who is eligible for, or currently holding, a privileged role.',
    consoleSection: 'access',
    cmdlet: 'Get-PimAssignment',
    readOnly: true,
    params: [{ ...P.identity, required: false }],
    resolvesTicketKinds: [],
    run(ctx, a) {
      if (!ctx.pim) return err('PIM is not available on this host.');
      const u = a.Identity ? findUser(ctx, a.Identity) : undefined;
      if (a.Identity && !u) return err(`Cannot find an object with identity '${a.Identity}'.`);
      const rows = ctx.pim.list(u ? { userId: u.id } : undefined).map((x) => ({
        User: ctx.dir.getUser(x.userId)?.username ?? x.userId,
        Role: ctx.dir.getRole(x.roleId)?.name ?? x.roleId,
        State: x.state,
        Expires: x.expiresAt ? new Date(x.expiresAt).toLocaleTimeString() : '-',
        Justification: x.justification ?? '-',
      }));
      return ok(`${rows.length} assignment(s).`, rows);
    },
  },
  {
    id: 'pim.eligible',
    label: 'Make Eligible',
    synopsis: 'Allow someone to activate a privileged role, without granting it now.',
    consoleSection: 'access',
    cmdlet: 'New-PimEligibility',
    validator: 'pim-eligible',
    params: [P.identity, P.role],
    resolvesTicketKinds: ['access-request'],
    run(ctx, a) {
      if (!ctx.pim) return err('PIM is not available on this host.');
      const u = findUser(ctx, a.Identity ?? '');
      if (!u) return err(`Cannot find an object with identity '${a.Identity}'.`);
      const r = findRole(ctx, a.Role ?? '');
      if (!r) return err(`Cannot find a role named '${a.Role}'.`);
      const res = ctx.pim.makeEligible(u.id, r.id, ctx.actor);
      return res.ok ? ok(`${u.username} is now eligible for ${r.name}.`) : err(res.error);
    },
  },
  {
    id: 'pim.activate',
    label: 'Activate Role',
    synopsis: 'Take up an eligible role for a bounded window, stating why.',
    consoleSection: 'access',
    cmdlet: 'Enable-PimRole',
    validator: 'pim-activated',
    params: [
      P.identity,
      P.role,
      { name: 'Justification', label: 'Reason', kind: 'text', required: true },
      { name: 'Minutes', label: 'Duration (minutes)', kind: 'text', required: false },
    ],
    resolvesTicketKinds: [],
    run(ctx, a) {
      if (!ctx.pim) return err('PIM is not available on this host.');
      const u = findUser(ctx, a.Identity ?? '');
      if (!u) return err(`Cannot find an object with identity '${a.Identity}'.`);
      const r = findRole(ctx, a.Role ?? '');
      if (!r) return err(`Cannot find a role named '${a.Role}'.`);
      const minutes = a.Minutes ? Number(a.Minutes) : undefined;
      if (a.Minutes && !Number.isFinite(minutes)) return err('Minutes must be a number.');
      const res = ctx.pim.activate(u.id, r.id, {
        ...(a.Justification ? { justification: a.Justification } : {}),
        ...(minutes !== undefined ? { minutes } : {}),
      });
      return res.ok ? ok(`${u.username} -> ${r.name}: ${res.message}`) : err(res.error);
    },
  },
  {
    id: 'pim.approve',
    label: 'Approve Activation',
    synopsis: 'Approve a pending activation request raised by someone else.',
    consoleSection: 'access',
    cmdlet: 'Approve-PimRequest',
    validator: 'pim-approved',
    params: [P.identity, P.role],
    resolvesTicketKinds: [],
    run(ctx, a) {
      if (!ctx.pim) return err('PIM is not available on this host.');
      const u = findUser(ctx, a.Identity ?? '');
      if (!u) return err(`Cannot find an object with identity '${a.Identity}'.`);
      const r = findRole(ctx, a.Role ?? '');
      if (!r) return err(`Cannot find a role named '${a.Role}'.`);
      const res = ctx.pim.approve(u.id, r.id, ctx.actor);
      return res.ok ? ok(`${u.username} -> ${r.name}: ${res.message}`) : err(res.error);
    },
  },
  {
    id: 'pim.deactivate',
    label: 'Deactivate Role',
    synopsis: 'End an activation early, returning the person to eligible.',
    consoleSection: 'access',
    cmdlet: 'Disable-PimRole',
    validator: 'pim-deactivated',
    params: [P.identity, P.role],
    resolvesTicketKinds: [],
    run(ctx, a) {
      if (!ctx.pim) return err('PIM is not available on this host.');
      const u = findUser(ctx, a.Identity ?? '');
      if (!u) return err(`Cannot find an object with identity '${a.Identity}'.`);
      const r = findRole(ctx, a.Role ?? '');
      if (!r) return err(`Cannot find a role named '${a.Role}'.`);
      const res = ctx.pim.deactivate(u.id, r.id, ctx.actor);
      return res.ok ? ok(`${u.username} -> ${r.name}: ${res.message}`) : err(res.error);
    },
  },
  {
    id: 'pim.remove',
    label: 'Remove Standing Privilege',
    synopsis: 'Remove a privileged assignment entirely - the fix for standing access.',
    consoleSection: 'access',
    cmdlet: 'Remove-PimAssignment',
    validator: 'pim-removed',
    params: [P.identity, P.role],
    resolvesTicketKinds: ['access-request'],
    run(ctx, a) {
      if (!ctx.pim) return err('PIM is not available on this host.');
      const u = findUser(ctx, a.Identity ?? '');
      if (!u) return err(`Cannot find an object with identity '${a.Identity}'.`);
      const r = findRole(ctx, a.Role ?? '');
      if (!r) return err(`Cannot find a role named '${a.Role}'.`);
      const res = ctx.pim.remove(u.id, r.id, ctx.actor);
      return res.ok ? ok(`Removed ${r.name} from ${u.username}.`) : err(res.error);
    },
  },
  {
    id: 'pim.standing',
    label: 'Standing Privilege',
    synopsis: 'List permanently assigned privileged roles - what a review hunts for.',
    consoleSection: 'access',
    cmdlet: 'Get-PimStandingPrivilege',
    readOnly: true,
    params: [],
    resolvesTicketKinds: [],
    run(ctx) {
      if (!ctx.pim) return err('PIM is not available on this host.');
      const rows = ctx.pim.standingPrivilege().map((x) => ({
        User: ctx.dir.getUser(x.userId)?.username ?? x.userId,
        Role: ctx.dir.getRole(x.roleId)?.name ?? x.roleId,
        Since: new Date(x.createdAt).toLocaleDateString(),
      }));
      return ok(
        rows.length === 0
          ? 'No standing privilege - every privileged assignment is time-bound.'
          : `${rows.length} standing assignment(s). Each is permanent access nobody re-approves.`,
        rows,
      );
    },
  },

  // -- Audit ----------------------------------------------------------------
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
  {
    id: 'dormant.users',
    label: 'Dormant Accounts',
    synopsis: 'List accounts that have not signed in recently — a common risk in access reviews.',
    consoleSection: 'audit',
    cmdlet: 'Get-DormantAccount',
    readOnly: true,
    params: [{ name: 'Days', label: 'Days since last sign-in', kind: 'text', required: false }],
    resolvesTicketKinds: [],
    run(ctx, a) {
      const days = Number(a.Days ?? 90);
      const threshold = ctx.idp.now() - days * 24 * 60 * 60 * 1000;
      const users = ctx.dir
        .listUsers()
        .filter((u) => u.status === 'active')
        .filter((u) => !u.lastSignInAt || u.lastSignInAt < threshold)
        .map((u) => ({
          User: u.username,
          Department: u.department,
          'Last sign-in': u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleDateString() : 'Never',
          Created: new Date(u.createdAt).toLocaleDateString(),
        }));
      ctx.audit.record({
        actorId: ctx.actor,
        action: 'dormant.reviewed',
        note: `Reviewed ${users.length} account(s) older than ${days} days.`,
      });
      return ok(`${users.length} dormant account(s).`, users);
    },
  },
  {
    id: 'audit.export',
    label: 'Export Audit Log',
    synopsis: 'Export recent audit events as CSV for spreadsheet analysis.',
    consoleSection: 'audit',
    cmdlet: 'Export-IamAuditLog',
    readOnly: true,
    params: [
      { name: 'Last', label: 'Entries', kind: 'text', required: false },
      { name: 'Filter', label: 'Action contains', kind: 'text', required: false },
    ],
    resolvesTicketKinds: [],
    run(ctx, a) {
      const n = Number(a.Last ?? 100);
      const filter = a.Filter?.toLowerCase() ?? '';
      const events = ctx.audit
        .tail(Number.isFinite(n) && n > 0 ? n : 100)
        .filter((e) => !filter || e.action.toLowerCase().includes(filter));
      const header = 'Time,Action,Actor,Target,Note';
      const rows = events.map((e) =>
        [
          new Date(e.at).toISOString(),
          e.action,
          ctx.dir.getUser(e.actorId)?.username ?? e.actorId,
          e.targetId ?? '',
          (e.note ?? '').replace(/,/g, ';'),
        ].join(','),
      );
      const csv = [header, ...rows].join('\n');
      ctx.audit.record({
        actorId: ctx.actor,
        action: 'iam.audit.exported',
        note: `Exported ${events.length} event(s) with filter "${filter}".`,
      });
      return ok(`${events.length} event(s) exported. Copy the CSV below and open it in Sheets.`, [{ CSV: csv }]);
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
