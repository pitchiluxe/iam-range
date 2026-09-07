/**
 * tests/breakGlass.test.ts — the recovery path has to actually work.
 *
 * LAB_13_BREAK_GLASS.md specified emergency access and nothing implemented
 * it. Two things were missing underneath before it could exist at all: a
 * conditional access policy had no exclude list, so an account could not be
 * put outside it, and there was no way to break MFA, so the outage the whole
 * practice exists for could not be reached.
 *
 * The assertion that carries the lesson is the last one: during the outage an
 * excluded account can complete a sign-in and an ordinary admin cannot. If
 * that ever stops being true the drill teaches the opposite of what it should
 * — that emergency access is decoration.
 */
import { describe, it, expect } from 'vitest';
import { VmSession } from '@/vm/session';
import {
  BREAK_GLASS_NAMES,
  assessPosture,
  breakGlassAccounts,
  drillStatus,
  endOutage,
  startOutage,
} from '@/vm/breakGlass';
import type { UserId } from '@/domain';

const ACTOR = 'admin-1' as UserId;

function bare(): VmSession {
  return new VmSession();
}

/** A fully prepared estate: two accounts, excluded, alerted on. */
function prepared(): VmSession {
  const s = bare();
  for (const name of BREAK_GLASS_NAMES) {
    s.dir.createUser({
      username: name,
      displayName: name,
      email: `${name}@iamlab.com`,
      department: 'IT',
      title: 'Emergency access',
      mfa: 'fido2',
    });
  }
  s.idp.setConditionalPolicy({ name: 'CA-002', requireMfa: true }, ACTOR);
  for (const a of breakGlassAccounts(s)) s.idp.excludeFromPolicy('CA-002', a.id, ACTOR);
  s.audit.record({
    actorId: ACTOR,
    action: 'policy.updated',
    note: 'P0 alert configured on break-glass sign-in.',
  });
  return s;
}

describe('posture on an estate with no emergency access', () => {
  it('is not ready, and says why', () => {
    const posture = assessPosture(bare());
    expect(posture.ready).toBe(false);
    expect(posture.checks.find((c) => c.label === 'Two accounts exist')?.passed).toBe(false);
  });

  it('gives every failed check something to do about it', () => {
    // A posture panel that says "no" without saying "do this" is a scoreboard.
    for (const check of assessPosture(bare()).checks) {
      if (check.passed) continue;
      expect(check.fix.length, check.label).toBeGreaterThan(20);
    }
  });

  it('says one account is not enough', () => {
    const s = bare();
    s.dir.createUser({
      username: BREAK_GLASS_NAMES[0],
      displayName: 'only one',
      email: 'one@iamlab.com',
      department: 'IT',
      title: 'Emergency access',
      mfa: 'fido2',
    });
    const check = assessPosture(s).checks.find((c) => c.label === 'Two accounts exist');
    expect(check?.passed).toBe(false);
    expect(check?.fix).toMatch(/single point of failure/);
  });
});

describe('exclusion is the mechanism', () => {
  it('is not satisfied by being excluded from only one of two policies', () => {
    // The policy that still applies is the one that blocks the recovery.
    const s = prepared();
    s.idp.setConditionalPolicy({ name: 'CA-003', requireMfa: true }, ACTOR);
    const check = assessPosture(s).checks.find((c) => c.label === 'Excluded from MFA policy');
    expect(check?.passed).toBe(false);
  });

  it('means nothing when no policy requires MFA', () => {
    const s = bare();
    for (const name of BREAK_GLASS_NAMES) {
      s.dir.createUser({
        username: name,
        displayName: name,
        email: `${name}@iamlab.com`,
        department: 'IT',
        title: 'Emergency access',
        mfa: 'fido2',
      });
    }
    const check = assessPosture(s).checks.find((c) => c.label === 'Excluded from MFA policy');
    expect(check?.passed).toBe(false);
    expect(check?.detail).toMatch(/nothing to be excluded from/);
  });

  it('records the exclusion as a risk accepted on purpose', () => {
    const s = prepared();
    const notes = s.audit.byAction('policy.updated').map((e) => e.note ?? '');
    expect(notes.some((n) => /risk accepted on purpose/.test(n))).toBe(true);
  });
});

describe('a prepared estate', () => {
  it('passes every posture check', () => {
    expect(assessPosture(prepared()).ready).toBe(true);
  });
});

describe('the drill', () => {
  it('starts idle', () => {
    expect(drillStatus(bare()).state).toBe('idle');
  });

  it('opens a critical incident when the outage begins', () => {
    const s = prepared();
    startOutage(s, ACTOR);
    expect(drillStatus(s).state).toBe('outage');
    const incident = s.incidents.list().find((i) => /MFA challenge failing/.test(i.title));
    expect(incident?.severity).toBe('critical');
  });

  it('locks out an ordinary account and lets the excluded one in', () => {
    // The whole lab, in one assertion. If this ever passes for the ordinary
    // account the drill teaches that emergency access is decoration.
    const s = prepared();
    const ordinary = s.dir.createUser({
      username: 'jdoe',
      displayName: 'John Doe',
      email: 'jdoe@iamlab.com',
      department: 'IT',
      title: 'Administrator',
      mfa: 'totp',
    });
    const emergency = breakGlassAccounts(s)[0]!;
    startOutage(s, ACTOR);

    expect(s.idp.isExcludedFromMfa(ordinary.id)).toBe(false);
    expect(s.idp.isExcludedFromMfa(emergency.id)).toBe(true);
  });

  it('records the failed challenge, so the outage can be investigated', () => {
    const s = prepared();
    expect(s.idp.isMfaBroken()).toBe(false);
    startOutage(s, ACTOR);
    expect(s.idp.isMfaBroken()).toBe(true);
    expect(
      s.audit.byAction('policy.updated').some((e) => /every MFA challenge is now failing/.test(e.note ?? '')),
    ).toBe(true);
  });

  it('ends, and then tells you to rotate what was used', () => {
    const s = prepared();
    startOutage(s, ACTOR);
    endOutage(s, ACTOR);
    const status = drillStatus(s);
    expect(status.state).toBe('recovered');
    // A used emergency credential is a spent one.
    expect(status.next).toMatch(/[Rr]otate/);
  });

  it('can be run on an unprepared estate, and says what that means', () => {
    // Deliberately allowed. Finding out you cannot get in is the lesson, and
    // refusing to start the drill would withhold it.
    const s = bare();
    startOutage(s, ACTOR);
    expect(drillStatus(s).next).toMatch(/not ready/);
  });
});
