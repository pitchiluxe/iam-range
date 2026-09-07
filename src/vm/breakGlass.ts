/**
 * vm/breakGlass.ts — emergency access, and proving it works.
 *
 * A break-glass account is the identity you use when the normal way in has
 * failed: the IdP is rejecting every MFA challenge, the admins are locked out,
 * and somebody still has to turn the policy off. It is deliberately outside
 * the controls that protect everyone else, which makes it the single most
 * valuable account in the estate and the one most worth watching.
 *
 * LAB_13_BREAK_GLASS.md specified this and nothing in the workstation
 * implemented it. Two things were missing underneath before it could exist at
 * all: a conditional access policy had no exclude list, so an account could
 * not be placed outside it, and there was no way to break MFA, so the outage
 * the whole practice exists for could not be reached. Both are in the IdP now.
 *
 * The posture below is checked rather than asserted, in the same way ticket
 * reviews and lab progress are. You cannot tick "we have emergency access";
 * you either have two excluded accounts with strong auth and an alert on
 * them, or the drill will show you that you do not.
 *
 * Why two accounts, which is the question an interviewer asks: one account is
 * a single point of failure. If its credential is lost, expired, or held by
 * the person on a plane, the recovery path is gone at the moment it is needed.
 */
import type { User, UserId } from '@/domain';
import type { VmServices } from './session';

/** The names the lab specifies, so the manual and the console agree. */
export const BREAK_GLASS_NAMES = ['bg-emergency-1', 'bg-emergency-2'] as const;

/** Credentials older than this should have been rotated. */
export const MAX_CREDENTIAL_AGE_DAYS = 90;

export interface PostureCheck {
  label: string;
  passed: boolean;
  detail: string;
  /** What to do about it, when it has not passed. */
  fix: string;
}

export interface Posture {
  checks: PostureCheck[];
  ready: boolean;
}

const pass = (label: string, detail: string): PostureCheck => ({
  label,
  passed: true,
  detail,
  fix: '',
});
const fail = (label: string, detail: string, fix: string): PostureCheck => ({
  label,
  passed: false,
  detail,
  fix,
});

/** The break-glass accounts that exist, in the order the lab names them. */
export function breakGlassAccounts(s: VmServices): User[] {
  return BREAK_GLASS_NAMES.map((n) => s.dir.getUserByUsername(n)).filter(
    (u): u is User => u !== undefined,
  );
}

/**
 * Assess emergency access.
 *
 * Every check is a real property of the estate. None of them can be satisfied
 * by saying so.
 */
export function assessPosture(s: VmServices): Posture {
  const checks: PostureCheck[] = [];
  const accounts = breakGlassAccounts(s);

  checks.push(
    accounts.length >= 2
      ? pass('Two accounts exist', `${accounts.map((a) => a.username).join(' and ')}.`)
      : fail(
          'Two accounts exist',
          accounts.length === 0
            ? 'No break-glass account exists.'
            : `Only ${accounts[0]!.username} exists.`,
          `Create ${BREAK_GLASS_NAMES.join(' and ')}. One account is a single point of failure — ` +
            'if its credential is lost or its holder is unreachable, the recovery path is gone ' +
            'at the moment it is needed.',
        ),
  );

  const enabled = accounts.filter((a) => a.status === 'active');
  checks.push(
    accounts.length > 0 && enabled.length === accounts.length
      ? pass('Both are usable', 'Neither account is disabled or locked.')
      : fail(
          'Both are usable',
          accounts.length === 0
            ? 'Nothing to check yet.'
            : `${accounts.length - enabled.length} account(s) are not active.`,
          'An emergency account that is disabled is not emergency access. Enable it.',
        ),
  );

  // Strong auth. FIDO2 is what the lab asks for: it is phishing-resistant and
  // does not depend on the phone network or an authenticator app that may be
  // enrolled on a device nobody can reach.
  const strong = accounts.filter((a) => a.mfa === 'fido2');
  checks.push(
    accounts.length > 0 && strong.length === accounts.length
      ? pass('Strong authentication', 'Both accounts are enrolled for FIDO2.')
      : fail(
          'Strong authentication',
          accounts.length === 0
            ? 'Nothing to check yet.'
            : `${accounts.length - strong.length} account(s) are not on FIDO2.`,
          'Enrol both for FIDO2. It is phishing-resistant and does not depend on a phone ' +
            'network or an app enrolled on a device nobody can reach.',
        ),
  );

  // The mechanism itself.
  const excluded = accounts.filter((a) => s.idp.isExcludedFromMfa(a.id));
  const mfaPolicies = s.idp.listPolicies().filter((p) => p.requireMfa);
  if (mfaPolicies.length === 0) {
    checks.push(
      fail(
        'Excluded from MFA policy',
        'No conditional access policy requires MFA, so there is nothing to be excluded from.',
        'Create the MFA policy first. Emergency access only means something once there is a ' +
          'control it is exempt from.',
      ),
    );
  } else {
    checks.push(
      accounts.length > 0 && excluded.length === accounts.length
        ? pass(
            'Excluded from MFA policy',
            `Both accounts are outside all ${mfaPolicies.length} MFA policy(ies).`,
          )
        : fail(
            'Excluded from MFA policy',
            accounts.length === 0
              ? 'Nothing to check yet.'
              : `${accounts.length - excluded.length} account(s) are still inside an MFA policy.`,
            'Exclude both from every policy that requires MFA. Excluded from one of two is not ' +
              'emergency access — the policy that still applies is the one that blocks the ' +
              'recovery.',
          ),
    );
  }

  // Watching them is the price of exempting them.
  const alerted = s.audit.events.some((e) => e.action === 'policy.updated' && /alert/i.test(e.note ?? ''));
  checks.push(
    alerted
      ? pass('Sign-in alerting', 'An alert on break-glass sign-in is configured.')
      : fail(
          'Sign-in alerting',
          'No alert is configured on these accounts.',
          'Turn on alerting. An account exempt from the controls has to be the most watched ' +
            'account in the estate — that is the trade being made.',
        ),
  );

  const now = Date.now();
  const stale = accounts.filter(
    (a) => now - a.createdAt > MAX_CREDENTIAL_AGE_DAYS * 86_400_000,
  );
  checks.push(
    accounts.length > 0 && stale.length === 0
      ? pass('Credentials in date', `Rotated within ${MAX_CREDENTIAL_AGE_DAYS} days.`)
      : fail(
          'Credentials in date',
          accounts.length === 0
            ? 'Nothing to check yet.'
            : `${stale.length} credential(s) are older than ${MAX_CREDENTIAL_AGE_DAYS} days.`,
          'Rotate them. A break-glass credential nobody has tested is a credential nobody knows ' +
            'still works.',
        ),
  );

  return { checks, ready: checks.every((c) => c.passed) };
}

export type DrillState = 'idle' | 'outage' | 'recovered';

export interface DrillStatus {
  state: DrillState;
  /** What the learner should do next. */
  next: string;
}

/**
 * Where the recovery drill stands.
 *
 * Read from the estate rather than held in a variable, so closing the window
 * mid-drill does not lose it — and so the state cannot disagree with what the
 * IdP is actually doing.
 */
export function drillStatus(s: VmServices): DrillStatus {
  if (s.idp.isMfaBroken()) {
    const ready = assessPosture(s).ready;
    return {
      state: 'outage',
      next: ready
        ? 'MFA is failing for every account except the excluded ones. Recover: sign in with a ' +
          'break-glass account, then end the outage.'
        : 'MFA is failing and emergency access is not ready. This is the situation the posture ' +
          'checks above exist to prevent — note what you cannot do right now.',
    };
  }
  const recovered = s.audit.events.some(
    (e) => e.action === 'policy.updated' && /recovered/i.test(e.note ?? ''),
  );
  return recovered
    ? {
        state: 'recovered',
        next:
          'Recovered. Rotate the break-glass credentials now — they have been used, and a used ' +
          'emergency credential is a spent one.',
      }
    : { state: 'idle', next: 'Emergency access is not being exercised. Start a drill to test it.' };
}

/** Break MFA across the tenant. */
export function startOutage(s: VmServices, by: UserId): void {
  s.idp.setMfaOutage(true, by);
  // Critical is this model's top severity; the lab calls the same thing P0.
  s.incidents.open({
    title: 'Identity provider fault — every MFA challenge failing',
    severity: 'critical',
    summary:
      'Standard administrative accounts cannot complete sign-in. Recovery depends on an ' +
      'account excluded from the MFA policy.',
    affectedUserIds: [],
    affectedAppIds: [],
    indicators: ['mfa.challenge failing tenant-wide', 'signin.failure on privileged accounts'],
  });
}

/** End it. */
export function endOutage(s: VmServices, by: UserId): void {
  s.idp.setMfaOutage(false, by);
}
