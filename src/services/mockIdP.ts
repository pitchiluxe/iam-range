/**
 * services/mockIdP.ts — in-memory identity provider.
 */
import { nanoid } from 'nanoid';
import type {
  MfaMethod,
  Session,
  SessionId,
  SignInResult,
  MfaResult,
  User,
  UserId,
  AppId,
  RoleId,
} from '@/domain';
import { mkSessionId, SYSTEM_ACTOR } from '@/domain';
import type { MockAuditLog } from './mockAuditLog';
import type { MockDirectory } from './mockDirectory';
import { IDP_ISSUER } from '@/config';

export type PasswordResolver = (username: string) => string | undefined;

export interface IdPConditionalPolicy {
  /** A name, so a policy can be excluded from or reported on by identity. */
  name?: string;
  userId?: UserId;
  roleId?: RoleId;
  requireMfa: boolean;
  blockIf?: (ctx: { user: User; ip?: string; asn?: string }) => boolean;
  /**
   * Accounts this policy does not apply to.
   *
   * The mechanism of emergency access. A break-glass account is defined by
   * being outside the policies that can lock everybody else out, and without
   * an exclude list that lesson can only be described, never performed.
   */
  excludeUserIds?: UserId[];
}

export class MockIdP {
  private passwords = new Map<string, string>();
  private sessions = new Map<SessionId, Session>();
  private policies: IdPConditionalPolicy[] = [];
  /** Time source — overridable for fault injection. */
  now: () => number = () => Date.now();

  /**
   * When true, every MFA challenge fails.
   *
   * The outage break-glass exists for. Held here rather than in a separate
   * fault service so that completeMfa() cannot forget to consult it.
   */
  private mfaOutage = false;

  constructor(
    private readonly audit: MockAuditLog,
    private readonly dir: MockDirectory,
    private passwordResolver: PasswordResolver = () => undefined,
  ) {}

  setPasswordResolver(r: PasswordResolver) {
    this.passwordResolver = r;
  }
  seedPasswords(map: Record<string, string>): void {
    for (const [u, p] of Object.entries(map)) this.passwords.set(u, p);
  }

  signIn(username: string, password: string, ip?: string, asn?: string): SignInResult {
    const user = this.dir.getUserByUsername(username);
    if (!user) return { ok: false, reason: 'bad-password' };
    if (user.status === 'disabled') return { ok: false, reason: 'disabled' };
    if (user.status === 'locked') return { ok: false, reason: 'locked' };

    const expected = this.passwords.get(username) ?? this.passwordResolver(username);
    if (expected !== password) {
      const sessionId = mkSessionId('failed-' + nanoid(8));
      this.audit.record({
        actorId: user.id,
        action: 'signin.failure',
        targetId: user.id,
        sessionId,
        ip,
      });
      return { ok: false, reason: 'bad-password' };
    }

    // Credential is correct — but an admin reset can still require the user to
    // choose their own password before any session is issued.
    if (user.mustChangePassword) {
      return { ok: false, reason: 'must-change-password' };
    }

    for (const p of this.policies) {
      if (p.userId && p.userId !== user.id) continue;
      if (p.blockIf && p.blockIf({ user, ip, asn })) {
        return { ok: false, reason: 'conditional-block' };
      }
    }

    if (user.mfa !== 'none') {
      const session = this.createSession(user.id, ip, asn, false);
      return { ok: true, session, user };
    }

    const session = this.createSession(user.id, ip, asn, true);
    this.dir.recordSignIn(user.id);
    this.audit.record({
      actorId: user.id,
      action: 'signin.success',
      targetId: user.id,
      sessionId: session.id,
      ip,
    });
    return { ok: true, session, user };
  }

  completeMfa(sessionId: SessionId, _method: MfaMethod): MfaResult {
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, reason: 'session-not-found' };
    // The outage. An account excluded from every MFA policy is never asked to
    // complete a challenge, which is exactly why it can still get in.
    if (this.mfaOutage && !this.isExcludedFromMfa(s.userId)) {
      this.audit.record({
        actorId: s.userId,
        action: 'signin.failure',
        targetId: s.userId,
        note: 'MFA challenge failed: the identity provider is not answering.',
      });
      return { ok: false, reason: 'mfa-provider-unavailable' };
    }
    s.mfaCompleted = true;
    const user = this.dir.getUser(s.userId);
    if (user) {
      this.dir.recordSignIn(user.id);
      this.audit.record({ actorId: user.id, action: 'mfa.challenge', targetId: user.id });
    }
    return { ok: true };
  }

  signOut(sessionId: SessionId, by: UserId): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.audit.record({ actorId: by, action: 'signout', targetId: s.userId, sessionId });
    this.sessions.delete(sessionId);
  }

  revokeAllSessions(userId: UserId, by: UserId): number {
    let n = 0;
    for (const [sid, s] of this.sessions) {
      if (s.userId === userId) {
        this.sessions.delete(sid);
        this.audit.record({
          actorId: by,
          action: 'session.revoked',
          targetId: sid,
          subjectId: userId,
        });
        n++;
      }
    }
    return n;
  }

  /**
   * Admin-initiated password reset — the helpdesk half of a `password-reset`
   * ticket. Replaces the stored credential and, when asked, flags the account
   * so the next sign-in is refused with 'must-change-password'. That refusal is
   * the point: it lets the learner *observe* the reset rather than take it on
   * faith, and mirrors the "user must change password at next logon" checkbox
   * every real helpdesk operator ticks.
   */
  resetPassword(
    userId: UserId,
    newPassword: string,
    opts: { forceChangeAtNextLogin: boolean },
    by: UserId,
  ): void {
    const u = this.dir.getUser(userId);
    if (!u) throw new Error(`[idp] resetPassword: user ${userId} not found`);
    this.passwords.set(u.username, newPassword);
    u.mustChangePassword = opts.forceChangeAtNextLogin;
    this.audit.record({ actorId: by, action: 'password.reset', targetId: userId });
  }

  /**
   * The user picking their own password, which is what clears a forced change.
   * Kept separate from resetPassword() because the actor differs: this one
   * requires the current credential, an admin reset does not.
   */
  changeOwnPassword(userId: UserId, currentPassword: string, newPassword: string): boolean {
    const u = this.dir.getUser(userId);
    if (!u) return false;
    const expected = this.passwords.get(u.username) ?? this.passwordResolver(u.username);
    if (expected !== currentPassword) return false;
    this.passwords.set(u.username, newPassword);
    u.mustChangePassword = false;
    this.audit.record({ actorId: userId, action: 'password.reset', targetId: userId });
    return true;
  }

  resetMfa(userId: UserId, by: UserId): void {
    const u = this.dir.getUser(userId);
    if (!u) return;
    u.mfa = 'none';
    this.audit.record({ actorId: by, action: 'mfa.reset', targetId: userId });
  }

  enrollMfa(userId: UserId, method: MfaMethod, by: UserId): void {
    const u = this.dir.getUser(userId);
    if (!u) return;
    u.mfa = method;
    this.audit.record({ actorId: by, action: 'mfa.challenge', targetId: userId });
  }

  setConditionalPolicy(p: IdPConditionalPolicy, by: UserId = SYSTEM_ACTOR): void {
    this.policies.push(p);
    // Without this, nothing ever fires the conductor's per-event validator
    // check for lab steps that gate on "MFA policy enforced" — setting a
    // policy previously had zero audit trail, so that class of step could
    // never advance no matter what the learner did.
    this.audit.record({ actorId: by, action: 'policy.updated' });
  }
  clearPolicies(): void {
    this.policies = [];
  }
  hasMfaPolicy(): boolean {
    return this.policies.some((p) => p.requireMfa);
  }

  /** Every conditional policy currently in force. */
  listPolicies(): IdPConditionalPolicy[] {
    return [...this.policies];
  }

  /**
   * Whether an account is outside every policy that requires MFA.
   *
   * "Excluded from one of the two" is not emergency access: the policy that
   * still applies is the one that will block the recovery.
   */
  isExcludedFromMfa(userId: UserId): boolean {
    const mfaPolicies = this.policies.filter((p) => p.requireMfa);
    if (mfaPolicies.length === 0) return false;
    return mfaPolicies.every((p) => p.excludeUserIds?.includes(userId) ?? false);
  }

  /** Add an account to a named policy's exclude list. */
  excludeFromPolicy(name: string, userId: UserId, by: UserId = SYSTEM_ACTOR): boolean {
    const policy = this.policies.find((p) => p.name === name);
    if (!policy) return false;
    policy.excludeUserIds = [...(policy.excludeUserIds ?? []), userId].filter(
      (id, i, all) => all.indexOf(id) === i,
    );
    this.audit.record({
      actorId: by,
      action: 'policy.updated',
      subjectId: userId,
      note: `Excluded from "${name}". A break-glass exclusion is a risk accepted on purpose.`,
    });
    return true;
  }

  /**
   * Break or repair MFA across the tenant.
   *
   * Recorded, because an outage nobody can see afterwards is not something a
   * post-incident note can be written about.
   */
  setMfaOutage(broken: boolean, by: UserId = SYSTEM_ACTOR): void {
    if (this.mfaOutage === broken) return;
    this.mfaOutage = broken;
    this.audit.record({
      actorId: by,
      action: 'policy.updated',
      note: broken
        ? 'Identity provider fault: every MFA challenge is now failing.'
        : 'Identity provider recovered: MFA challenges are succeeding again.',
    });
  }

  isMfaBroken(): boolean {
    return this.mfaOutage;
  }

  samlAssertion(
    appId: AppId,
    userId: UserId,
    _sessionId: SessionId,
  ): { ok: true; xml: string } | { ok: false; reason: string } {
    const u = this.dir.getUser(userId);
    if (!u) return { ok: false, reason: 'unknown-user' };
    if (u.status === 'disabled') return { ok: false, reason: 'user-disabled' };
    if (u.mfa === 'none' && this.requiresMfa(appId)) return { ok: false, reason: 'mfa-required' };
    const xml = `<saml:Assertion issuer="${IDP_ISSUER}" subject="${u.username}" roles="${u.groupIds.join(',')}" />`;
    return { ok: true, xml };
  }

  oidcToken(
    appId: AppId,
    userId: UserId,
    _code: string,
  ):
    { ok: true; idToken: string; claims: Record<string, unknown> } | { ok: false; reason: string } {
    const u = this.dir.getUser(userId);
    if (!u) return { ok: false, reason: 'unknown-user' };
    if (u.status === 'disabled') return { ok: false, reason: 'user-disabled' };
    const claims = { sub: u.username, email: u.email, department: u.department, roles: u.groupIds };
    const idToken = btoa(JSON.stringify(claims));
    return { ok: true, idToken, claims };
  }

  getSession(id: SessionId): Session | undefined {
    return this.sessions.get(id);
  }
  listSessions(userId?: UserId): Session[] {
    const all = Array.from(this.sessions.values());
    return userId ? all.filter((s) => s.userId === userId) : all;
  }

  private createSession(userId: UserId, ip?: string, asn?: string, mfaDone = false): Session {
    const id = mkSessionId(nanoid(16));
    const now = this.now();
    const s: Session = {
      id,
      userId,
      createdAt: now,
      expiresAt: now + 8 * 60 * 60 * 1000,
      mfaCompleted: mfaDone,
      ...(ip ? { ip } : {}),
      ...(asn ? { asn } : {}),
    };
    this.sessions.set(id, s);
    return s;
  }

  private requiresMfa(_appId: AppId): boolean {
    return false;
  }

  reset(): void {
    this.passwords.clear();
    this.sessions.clear();
    this.policies = [];
    this.now = () => Date.now();
  }
}
