/**
 * services/mockPim.ts — Privileged Identity Management.
 *
 * The distinction PIM exists to make is between being *able* to hold a
 * privileged role and *currently holding* it:
 *
 *   eligible  the person may activate this role, but has no rights right now
 *   active    the person holds it, for a bounded window, having said why
 *
 * Standing privilege — permanently active, never reviewed — is what PIM
 * replaces, and it remains representable here on purpose. A lab that cannot
 * express the bad state cannot teach you to find it.
 *
 * Activations expire. Nothing here runs a timer: expiry is evaluated whenever
 * assignments are read, so a lab can move the clock without waiting, and a
 * workstation left open overnight comes back to a correct picture rather than
 * whatever a stale timeout last wrote.
 */
import { nanoid } from 'nanoid';
import type { RoleId, UserId } from '@/domain';
import type { MockAuditLog } from './mockAuditLog';

export type AssignmentState =
  /** May activate; holds nothing now. */
  | 'eligible'
  /** Holds the role, within a time window. */
  | 'active'
  /** Requested activation, waiting for an approver. */
  | 'pending-approval'
  /** Permanently active with no expiry — the thing PIM exists to remove. */
  | 'permanent';

export interface PimAssignment {
  id: string;
  userId: UserId;
  roleId: RoleId;
  state: AssignmentState;
  /** When the current activation began. */
  activatedAt?: number;
  /** When it lapses. Absent for eligible and permanent assignments. */
  expiresAt?: number;
  /** Why the person said they needed it. Required to activate. */
  justification?: string;
  /** Who approved, when the role required approval. */
  approvedBy?: UserId;
  /** Ticket the activation cited, if any. */
  ticketRef?: string;
  createdAt: number;
}

export interface PrivilegedRoleSettings {
  roleId: RoleId;
  /** Longest activation allowed, in minutes. */
  maxDurationMinutes: number;
  /** Activation must be approved by someone else first. */
  requiresApproval: boolean;
  /** The person must state a reason. Almost always true; false exists so a
   *  lab can show what a badly configured role looks like. */
  requiresJustification: boolean;
}

const DEFAULT_SETTINGS: Omit<PrivilegedRoleSettings, 'roleId'> = {
  maxDurationMinutes: 480,
  requiresApproval: false,
  requiresJustification: true,
};

export type PimResult = { ok: true; message: string } | { ok: false; error: string };

export class MockPim {
  private assignments = new Map<string, PimAssignment>();
  private settings = new Map<RoleId, PrivilegedRoleSettings>();

  constructor(private readonly audit: MockAuditLog) {}

  // --- Role configuration ---------------------------------------------------

  configureRole(roleId: RoleId, patch: Partial<Omit<PrivilegedRoleSettings, 'roleId'>>): void {
    this.settings.set(roleId, { ...this.settingsFor(roleId), ...patch, roleId });
  }

  settingsFor(roleId: RoleId): PrivilegedRoleSettings {
    return this.settings.get(roleId) ?? { roleId, ...DEFAULT_SETTINGS };
  }

  /** Roles under PIM management. */
  managedRoles(): PrivilegedRoleSettings[] {
    return Array.from(this.settings.values());
  }

  // --- Assignments ----------------------------------------------------------

  /**
   * Read assignments with expiry applied.
   *
   * Expiry is evaluated here rather than by a timer so the picture is always
   * correct on read, however long the workstation has been idle.
   */
  list(filter?: { userId?: UserId; roleId?: RoleId }): PimAssignment[] {
    const now = Date.now();
    for (const a of this.assignments.values()) {
      if (a.state === 'active' && a.expiresAt && a.expiresAt <= now) {
        a.state = 'eligible';
        delete a.activatedAt;
        delete a.expiresAt;
        delete a.justification;
        this.audit.record({ actorId: a.userId, action: 'pim.expired', targetId: a.roleId });
      }
    }
    return Array.from(this.assignments.values()).filter(
      (a) =>
        (!filter?.userId || a.userId === filter.userId) &&
        (!filter?.roleId || a.roleId === filter.roleId),
    );
  }

  find(userId: UserId, roleId: RoleId): PimAssignment | undefined {
    return this.list({ userId, roleId })[0];
  }

  /** Whether the person holds this role *right now*. */
  isActive(userId: UserId, roleId: RoleId): boolean {
    const a = this.find(userId, roleId);
    return a?.state === 'active' || a?.state === 'permanent';
  }

  /** Make someone eligible: they may activate, but hold nothing yet. */
  makeEligible(userId: UserId, roleId: RoleId, by: UserId): PimResult {
    const existing = this.find(userId, roleId);
    if (existing) return { ok: false, error: 'That assignment already exists.' };
    const a: PimAssignment = {
      id: nanoid(10),
      userId,
      roleId,
      state: 'eligible',
      createdAt: Date.now(),
    };
    this.assignments.set(a.id, a);
    this.audit.record({ actorId: by, action: 'pim.eligible', targetId: roleId, subjectId: userId });
    return { ok: true, message: 'Eligible assignment created.' };
  }

  /**
   * Grant the role permanently — standing privilege.
   *
   * Kept deliberately, because finding and removing it is the point of an
   * access review. The audit action is distinct so a review can spot it.
   */
  grantPermanent(userId: UserId, roleId: RoleId, by: UserId): PimResult {
    const existing = this.find(userId, roleId);
    if (existing) {
      existing.state = 'permanent';
      delete existing.expiresAt;
    } else {
      // One id, used as both the map key and the record identity: generating
      // two meant remove() deleted a key that was never there.
      const id = nanoid(10);
      this.assignments.set(id, {
        id,
        userId,
        roleId,
        state: 'permanent',
        createdAt: Date.now(),
      });
    }
    this.audit.record({
      actorId: by,
      action: 'pim.permanent',
      targetId: roleId,
      subjectId: userId,
    });
    return { ok: true, message: 'Permanent assignment created (standing privilege).' };
  }

  /**
   * Activate an eligible role for a bounded window.
   *
   * Refuses without a justification when the role demands one, refuses a
   * duration beyond the role's maximum, and parks the request for approval
   * when the role requires it — those three refusals are most of what PIM is.
   */
  activate(
    userId: UserId,
    roleId: RoleId,
    opts: { justification?: string; minutes?: number; ticketRef?: string } = {},
  ): PimResult {
    const a = this.find(userId, roleId);
    if (!a) return { ok: false, error: 'No eligible assignment for that role.' };
    if (a.state === 'active') return { ok: false, error: 'That role is already active.' };
    if (a.state === 'permanent') {
      return { ok: false, error: 'That role is permanently assigned; there is nothing to activate.' };
    }
    if (a.state === 'pending-approval') {
      return { ok: false, error: 'An activation request is already awaiting approval.' };
    }

    const cfg = this.settingsFor(roleId);
    const justification = opts.justification?.trim();
    if (cfg.requiresJustification && !justification) {
      return { ok: false, error: 'A justification is required to activate this role.' };
    }

    const minutes = opts.minutes ?? cfg.maxDurationMinutes;
    if (minutes > cfg.maxDurationMinutes) {
      return {
        ok: false,
        error: `Maximum activation for this role is ${cfg.maxDurationMinutes} minutes.`,
      };
    }

    if (justification) a.justification = justification;
    if (opts.ticketRef) a.ticketRef = opts.ticketRef;

    if (cfg.requiresApproval) {
      a.state = 'pending-approval';
      this.audit.record({ actorId: userId, action: 'pim.requested', targetId: roleId });
      return { ok: true, message: 'Activation requested — awaiting approval.' };
    }

    a.state = 'active';
    a.activatedAt = Date.now();
    a.expiresAt = Date.now() + minutes * 60_000;
    this.audit.record({ actorId: userId, action: 'pim.activated', targetId: roleId });
    return { ok: true, message: `Role activated for ${minutes} minutes.` };
  }

  /** Approve a pending request, which starts the activation window. */
  approve(userId: UserId, roleId: RoleId, approver: UserId): PimResult {
    const a = this.find(userId, roleId);
    if (!a || a.state !== 'pending-approval') {
      return { ok: false, error: 'There is no pending request for that role.' };
    }
    // Approving your own request defeats the control the approval exists for.
    if (approver === userId) {
      return { ok: false, error: 'You cannot approve your own activation request.' };
    }
    const cfg = this.settingsFor(roleId);
    a.state = 'active';
    a.approvedBy = approver;
    a.activatedAt = Date.now();
    a.expiresAt = Date.now() + cfg.maxDurationMinutes * 60_000;
    this.audit.record({
      actorId: approver,
      action: 'pim.approved',
      targetId: roleId,
      subjectId: userId,
    });
    return { ok: true, message: `Approved — active for ${cfg.maxDurationMinutes} minutes.` };
  }

  /** End an activation early, returning the person to eligible. */
  deactivate(userId: UserId, roleId: RoleId, by: UserId): PimResult {
    const a = this.find(userId, roleId);
    if (!a) return { ok: false, error: 'No assignment for that role.' };
    if (a.state !== 'active') return { ok: false, error: 'That role is not currently active.' };
    a.state = 'eligible';
    delete a.activatedAt;
    delete a.expiresAt;
    delete a.justification;
    this.audit.record({ actorId: by, action: 'pim.deactivated', targetId: roleId, subjectId: userId });
    return { ok: true, message: 'Role deactivated.' };
  }

  /** Remove the assignment entirely — the remedy for standing privilege. */
  remove(userId: UserId, roleId: RoleId, by: UserId): PimResult {
    const a = this.find(userId, roleId);
    if (!a) return { ok: false, error: 'No assignment for that role.' };
    this.assignments.delete(a.id);
    this.audit.record({ actorId: by, action: 'pim.removed', targetId: roleId, subjectId: userId });
    return { ok: true, message: 'Assignment removed.' };
  }

  /** Standing privilege currently in the tenant — what a review hunts for. */
  standingPrivilege(): PimAssignment[] {
    return this.list().filter((a) => a.state === 'permanent');
  }

  /** Activations still running, oldest first. */
  activeNow(): PimAssignment[] {
    return this.list()
      .filter((a) => a.state === 'active')
      .sort((x, y) => (x.activatedAt ?? 0) - (y.activatedAt ?? 0));
  }

  reset(): void {
    this.assignments.clear();
    this.settings.clear();
  }
}
