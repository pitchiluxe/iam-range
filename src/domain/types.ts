/**
 * domain/types.ts — all shared TypeScript interfaces and types for the IAM lab.
 * No implementation; only types that are imported across services, stores, and labs.
 */

// ---------------------------------------------------------------------------
// Primitive brand aliases — prevent mixing e.g. UserId with TicketId
// ---------------------------------------------------------------------------
export type UserId = string & { readonly __brand: 'UserId' };
export type GroupId = string & { readonly __brand: 'GroupId' };
export type RoleId = string & { readonly __brand: 'RoleId' };
export type OuId = string & { readonly __brand: 'OuId' };
export type AppId = string & { readonly __brand: 'AppId' };
export type TicketId = string & { readonly __brand: 'TicketId' };
export type AuditId = string & { readonly __brand: 'AuditId' };
export type IncidentId = string & { readonly __brand: 'IncidentId' };
export type ReviewId = string & { readonly __brand: 'ReviewId' };
export type LabId = string & { readonly __brand: 'LabId' };
export type EvidenceId = string & { readonly __brand: 'EvidenceId' };
export type SessionId = string & { readonly __brand: 'SessionId' };

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------
export type Role =
  | 'Employee'
  | 'Manager'
  | 'HR'
  | 'Finance'
  | 'HelpDesk'
  | 'IAMAdmin'
  | 'SecOps'
  | 'ServerAdmin'
  | 'Auditor'
  | 'AppOwner'
  | 'Executive'
  | 'ServiceAccount';

export type TicketKind =
  | 'onboarding'
  | 'mover'
  | 'leaver'
  | 'access-request'
  | 'password-reset'
  | 'mfa-issue'
  | 'transfer'
  | 'termination'
  | 'incident';

/**
 * Runtime list of every ticket kind. `satisfies` keeps it honest: omit a kind
 * and this stops type-checking. The capability registry's drift-guard test
 * walks this list to prove every ticket a lab can raise is one the learner can
 * actually resolve from the IAM Console or the terminal.
 */
export const ALL_TICKET_KINDS = [
  'onboarding',
  'mover',
  'leaver',
  'access-request',
  'password-reset',
  'mfa-issue',
  'transfer',
  'termination',
  'incident',
] as const satisfies readonly TicketKind[];

export type TicketStatus =
  'open' | 'in-progress' | 'pending-approval' | 'resolved' | 'closed' | 'cancelled';

export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';

export type FaultKind =
  | 'wrong-redirect-uri'
  | 'expired-cert'
  | 'wrong-issuer'
  | 'wrong-client-secret'
  | 'wrong-claim-mapping'
  | 'missing-role'
  | 'clock-skew'
  | 'dns-resolution'
  | 'mfa-prompt-loop'
  | 'suspicious-signin'
  | 'excessive-permissions'
  | 'dormant-account'
  | 'legacy-auth-misconfiguration'
  | 'sync-soft-match-conflict'
  | 'idp-mfa-outage';

export type AuthProtocol = 'SAML' | 'OIDC';

export type MfaMethod = 'totp' | 'fido2' | 'sms' | 'push' | 'none';

export type EvidenceKind = 'snapshot' | 'log-excerpt' | 'config-diff' | 'ticket' | 'audit-event';

// ---------------------------------------------------------------------------
// Directory entities
// ---------------------------------------------------------------------------
export interface User {
  id: UserId;
  username: string;
  displayName: string;
  email: string;
  department: string;
  title: string;
  managerId?: UserId;
  status: 'active' | 'disabled' | 'locked' | 'pending-creation';
  mfa: MfaMethod;
  groupIds: GroupId[];
  /** Unix ms timestamp; absent = never signed in */
  lastSignInAt?: number;
  createdAt: number;
  disabledAt?: number;
  /** Set by an admin password reset; sign-in is refused until the user picks
   *  their own password. Absent = no forced change pending. */
  mustChangePassword?: boolean;
  /** The OU this account sits in. Absent means directly under the domain. */
  ouId?: OuId;
  /** Roles granted straight to the user, outside any group. Optional so the
   *  seed-data literal needs no change; readers treat undefined as empty. */
  directRoleIds?: RoleId[];
}

/**
 * An organisational unit. A fresh domain has none: building the OU structure is
 * the administrator's first task, exactly as it is on a new forest.
 */
export interface OrganizationalUnit {
  id: OuId;
  name: string;
  /** Parent OU, or undefined for one directly under the domain root. */
  parentId?: OuId;
  description: string;
  createdAt: number;
}

export interface Group {
  id: GroupId;
  name: string; // e.g. 'grp-finance-payroll'
  description: string;
  memberIds: UserId[];
  ownerRoleId?: RoleId;
}

export interface RoleRecord {
  id: RoleId;
  name: string; // e.g. 'role-payroll-reader'
  description: string;
  permissions: string[]; // e.g. ['payroll:read', 'journal:post']
  appId?: AppId; // role scoped to an app; undefined = global
}

// ---------------------------------------------------------------------------
// Applications & IdP
// ---------------------------------------------------------------------------
export interface Application {
  id: AppId;
  name: string; // 'HR Portal', 'Finance Portal', …
  protocol: AuthProtocol;
  redirectUri: string;
  clientId: string;
  entityId?: string; // SAML-only
  issuer?: string; // OIDC-only
  requiredRoleIds: RoleId[];
  mfaRequired: boolean;
  status: 'configured' | 'misconfigured' | 'offline';
  /** Set by FaultService to record a deliberate deviation from baseline */
  configDiffFromBaseline?: Record<string, { expected: unknown; actual: unknown }>;
}

export interface Session {
  id: SessionId;
  userId: UserId;
  createdAt: number;
  expiresAt: number;
  ip?: string;
  asn?: string;
  mfaCompleted: boolean;
}

export type SignInResult =
  | { ok: true; session: Session; user: User }
  | {
      ok: false;
      reason:
        | 'bad-password'
        | 'disabled'
        | 'locked'
        | 'mfa-required'
        | 'conditional-block'
        | 'must-change-password';
    };

export type MfaResult = { ok: boolean; reason?: string };

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------
export interface TicketApproval {
  approverRole: Role;
  approved: boolean;
  note?: string;
  at: number;
}

export interface TicketComment {
  authorId: UserId;
  at: number;
  body: string;
}

interface TicketBase {
  id: TicketId;
  kind: TicketKind;
  status: TicketStatus;
  priority: TicketPriority;
  requesterId: UserId;
  assigneeId?: UserId;
  subject: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  approvals: TicketApproval[];
  comments: TicketComment[];
  relatedUserIds: UserId[];
}

export type Ticket =
  | (TicketBase & {
      kind: 'onboarding';
      payload: { proposedGroupIds: GroupId[]; proposedRoleIds: RoleId[]; startDate: number };
    })
  | (TicketBase & {
      kind: 'mover';
      payload: { userId: UserId; fromGroupIds: GroupId[]; toGroupIds: GroupId[] };
    })
  | (TicketBase & {
      kind: 'leaver';
      payload: { userId: UserId; lastDay: number; revokeSessions: boolean };
    })
  | (TicketBase & {
      kind: 'transfer';
      payload: { userId: UserId; fromDepartment: string; toDepartment: string };
    })
  | (TicketBase & {
      kind: 'termination';
      payload: { userId: UserId; reason: string; immediate: boolean };
    })
  | (TicketBase & {
      kind: 'access-request';
      payload: { userId: UserId; requestedRoleIds: RoleId[]; justification: string };
    })
  | (TicketBase & {
      kind: 'password-reset';
      payload: { userId: UserId; method: 'helpdesk' | 'self-service' };
    })
  | (TicketBase & {
      kind: 'mfa-issue';
      payload: { userId: UserId; symptom: 'repeated-prompts' | 'lost-device' | 'locked-out' };
    })
  | (TicketBase & {
      kind: 'incident';
      payload: { incidentId: IncidentId; affectedUserId?: UserId; affectedAppId?: AppId };
    });

// ---------------------------------------------------------------------------
// Audit events (tagged-union)
// ---------------------------------------------------------------------------
/**
 * Flat audit-event shape. We collapse the discriminated union to a single
 * type with optional fields — at runtime we only ever read fields by name,
 * and the action discriminator lives on the `action` field.
 */
export interface AuditEvent {
  id: AuditId;
  at: number;
  actorId: UserId;
  action:
    | 'user.created'
    | 'user.disabled'
    | 'user.unlocked'
    | 'user.updated'
    | 'user.deleted'
    | 'group.created'
    | 'group.add'
    | 'group.remove'
    | 'group.updated'
    | 'group.deleted'
    | 'role.created'
    | 'role.grant'
    | 'role.revoke'
    | 'password.reset'
    | 'account.unlock'
    | 'user.moved'
    | 'ou.created'
    | 'ou.deleted'
    | 'app.config.changed'
    | 'signin.success'
    | 'signin.failure'
    | 'signout'
    | 'mfa.challenge'
    | 'mfa.reset'
    | 'policy.updated'
    | 'session.revoked'
    | 'ticket.created'
    | 'ticket.resolved'
    | 'ticket.escalated';
  /** Polysemous target: UserId | GroupId | RoleId | AppId | TicketId | SessionId */
  targetId?: string;
  /** For events that involve a subject distinct from the actor/target (group/role grants). */
  subjectId?: string;
  /** For signin/session events. */
  sessionId?: SessionId;
  /** For app.config.changed events. */
  diff?: Record<string, unknown>;
  /** For signin events. */
  ip?: string;
  mfaUsed?: MfaMethod;
}

// ---------------------------------------------------------------------------
// Incidents & access reviews
// ---------------------------------------------------------------------------
export interface Incident {
  id: IncidentId;
  title: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'contained' | 'eradicated' | 'recovered' | 'closed';
  detectedAt: number;
  containedAt?: number;
  closedAt?: number;
  affectedUserIds: UserId[];
  affectedAppIds: AppId[];
  summary: string;
  indicators: string[];
  containmentActions: { at: number; actorId: UserId; action: string }[];
  reportBody?: string;
}

export interface AccessReview {
  id: ReviewId;
  campaign: string; // e.g. 'Q3-2026'
  openedAt: number;
  dueAt: number;
  status: 'open' | 'in-progress' | 'closed';
  decisions: AccessReviewDecision[];
}

export interface AccessReviewDecision {
  userId: UserId;
  groupId: GroupId;
  roleId?: RoleId;
  decision: 'approve' | 'revoke';
  decidedBy: UserId;
  decidedAt: number;
  note?: string;
}

// ---------------------------------------------------------------------------
// Labs
// ---------------------------------------------------------------------------
export type ValidatorKind =
  | 'ticket-resolved'
  | 'user-disabled'
  | 'user-created'
  | 'group-created'
  | 'group-added'
  | 'group-removed'
  | 'role-granted'
  | 'role-revoked'
  | 'app-config-fixed'
  | 'signin-succeeded'
  | 'mfa-challenge-completed'
  | 'mfa-policy-enforced'
  | 'session-revoked'
  | 'review-decisions-recorded'
  | 'evidence-collected'
  | 'fault-cleared'
  | 'audit-note-written'
  | 'user-enabled'
  | 'user-moved'
  | 'user-deleted'
  | 'password-reset'
  | 'mfa-reset'
  | 'account-unlocked'
  /** N accounts provisioned into a named group — the bulk-automation labs.
   *  Counted by group membership rather than raw user count, so the baseline's
   *  existing users cannot satisfy it by accident. */
  | 'users-provisioned'
  /** An organisational unit was created — the first task on a bare domain. */
  | 'ou-created';

export interface LabStep {
  id: string;
  title: string;
  brief: string;
  validator: { kind: ValidatorKind; params: Record<string, unknown> };
  evidence: EvidenceRequirement[];
  tutorPrompts: string[];
  hintIds: string[];
  points?: ScorePoints;
}

export interface EvidenceRequirement {
  kind: EvidenceKind;
  capture: 'auto' | 'manual';
  params?: Record<string, unknown>;
}

export interface LabObjective {
  id: string;
  description: string;
  points: number;
  category: ScoreCategory;
}

export interface FaultInjection {
  id: string;
  kind: FaultKind;
  applyAtStep: string;
  params: Record<string, unknown>;
  targetAppId?: AppId;
  targetUserId?: UserId;
}

export interface Lab {
  id: LabId;
  number: number;
  title: string;
  brief: string;
  durationMinutes: number;
  zoneIds: string[];
  startingZone: string;
  startingSeed: string; // 'baseline' | 'after-lab01' | …
  objectives: LabObjective[];
  steps: LabStep[];
  faults: FaultInjection[];
  debriefQuestions: string[];
}

// ---------------------------------------------------------------------------
// Evidence & scoring
// ---------------------------------------------------------------------------
export type ScoreCategory =
  'exec' | 'troubleshoot' | 'least-privilege' | 'docs' | 'evidence' | 'comms';

export interface ScorePoints {
  exec?: number;
  troubleshoot?: number;
  'least-privilege'?: number;
  docs?: number;
  evidence?: number;
  comms?: number;
}

export interface Evidence {
  id: EvidenceId;
  labId: LabId;
  stepId: string;
  kind: EvidenceKind;
  capturedAt: number;
  payload: unknown;
  label: string;
}

export interface ScoreBreakdown {
  labId: LabId;
  exec: number;
  troubleshoot: number;
  'least-privilege': number;
  docs: number;
  evidence: number;
  comms: number;
  total: number;
  notes: string[];
}
