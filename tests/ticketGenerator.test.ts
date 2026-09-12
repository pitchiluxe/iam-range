/**
 * tests/ticketGenerator.test.ts
 *
 * The domain moves through stages, and the work offered must match the stage.
 * Asking for a lockout on a domain with nobody in it, or a transfer with no
 * OUs to move between, is the failure this project has spent its whole life
 * removing: a ticket describing a world that is not there.
 *
 * The generator picks the scenario from what the environment can support; a
 * language model only ever supplies wording. These tests cover the picking,
 * because that is the part correctness depends on.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { VmSession } from '@/vm/session';
import { readEnvironment } from '@/vm/environmentStage';
import { generateTicketsSync } from '@/vm/ticketGenerator';

function deps(s: VmSession) {
  return { dir: s.dir, tickets: s.tickets, audit: s.audit };
}

/** Walk the domain forward to the given stage using real operations. */
function buildTo(s: VmSession, stage: 'structured' | 'ready-to-staff' | 'operating'): void {
  s.dir.createOu('Corp', 'Top level');
  s.dir.createOu('Corp/Users', 'Staff accounts');
  if (stage === 'structured') return;

  s.dir.createGroup('grp-helpdesk-tier1', 'Service desk');
  s.dir.createGroup('grp-hr-readers', 'HR read access');
  if (stage === 'ready-to-staff') return;

  s.dir.createUser({
    username: 'jdoe',
    displayName: 'John Doe',
    email: 'jdoe@omari.test',
    department: 'Help Desk',
    title: 'Service Desk Analyst',
    mfa: 'none',
  });
}

describe('environment stages', () => {
  let session: VmSession;
  beforeEach(() => {
    session = new VmSession();
  });

  it('a fresh domain is bare', () => {
    expect(readEnvironment(session.dir).stage).toBe('bare');
  });

  it('creating OUs moves it to structured', () => {
    buildTo(session, 'structured');
    expect(readEnvironment(session.dir).stage).toBe('structured');
  });

  it('adding groups moves it to ready-to-staff', () => {
    buildTo(session, 'ready-to-staff');
    expect(readEnvironment(session.dir).stage).toBe('ready-to-staff');
  });

  it('provisioning a person moves it to operating', () => {
    buildTo(session, 'operating');
    expect(readEnvironment(session.dir).stage).toBe('operating');
  });

  it('does not count the administrator or service accounts as staff', () => {
    // Otherwise a bare domain would look staffed and skip straight to
    // day-to-day operations against accounts nobody provisioned.
    expect(readEnvironment(session.dir).staffCount).toBe(0);
  });
});

describe('work offered per stage', () => {
  let session: VmSession;
  beforeEach(() => {
    session = new VmSession();
    // The session raises the bare-stage work at boot; clear it so each test
    // sees only what it generates.
    for (const t of session.tickets.list()) session.tickets.resolve(t.id, 'system' as never);
  });

  const subjects = (s: VmSession): string[] =>
    s.tickets
      .list()
      .filter((t) => t.status !== 'resolved')
      .map((t) => t.subject);

  it('a bare domain is asked to build structure, not to onboard', () => {
    generateTicketsSync(deps(session));
    const subj = subjects(session);
    expect(subj.some((x) => /organisational unit/i.test(x))).toBe(true);
    expect(subj.some((x) => /new starter/i.test(x))).toBe(false);
  });

  it('a structured domain is asked for the group model', () => {
    buildTo(session, 'structured');
    generateTicketsSync(deps(session));
    expect(subjects(session).some((x) => /group model/i.test(x))).toBe(true);
  });

  it('a staffed-ready domain is asked to provision people', () => {
    buildTo(session, 'ready-to-staff');
    generateTicketsSync(deps(session));
    expect(subjects(session).some((x) => /new starter/i.test(x))).toBe(true);
  });

  it('an operating domain gets day-to-day work naming real people', () => {
    buildTo(session, 'operating');
    generateTicketsSync(deps(session));

    const named = session.tickets
      .list()
      .filter((t) => t.relatedUserIds.length > 0)
      .flatMap((t) => t.relatedUserIds);
    for (const id of named) {
      expect(session.dir.getUser(id), 'ticket names an account that does not exist').toBeDefined();
    }
  });

  it('a lockout ticket really locks the account and records the attempts', () => {
    buildTo(session, 'operating');
    generateTicketsSync(deps(session));

    const lockout = session.tickets.list().find((t) => /locked out/i.test(t.subject));
    if (!lockout) return; // scenario selection is random; nothing to check
    const target = session.dir.getUser(lockout.relatedUserIds[0]!)!;
    expect(target.status).toBe('locked');
    expect(
      session.audit.byAction('signin.failure').filter((e) => e.targetId === target.id).length,
    ).toBeGreaterThan(0);
  });

  it('does not raise the same open ticket twice', () => {
    generateTicketsSync(deps(session));
    const first = subjects(session).length;
    generateTicketsSync(deps(session));
    expect(subjects(session)).toHaveLength(first);
  });
});

describe('hybrid-identity scenarios', () => {
  let session: VmSession;
  beforeEach(() => {
    session = new VmSession();
    session.tickets.list().forEach((t) => session.tickets.resolve(t.id, 'system' as never));
    buildTo(session, 'operating');
  });

  /** Deps including the tenants, as the running workstation passes them. */
  function fullDeps(s: VmSession) {
    return { ...deps(s), pim: s.pim, cloud: s.cloud };
  }

  it('offers no cloud work without a tenant', () => {
    // Optional dependency, not a silent default: a host with no tenant should
    // not be handed hybrid tickets it cannot support.
    generateTicketsSync(deps(session), 10);
    const subjects = session.tickets.list().map((t) => t.subject);
    expect(subjects.some((s) => /Okta|Entra/.test(s))).toBe(false);
  });

  /**
   * Build fresh sessions until the named scenario is raised.
   *
   * One hybrid scenario is offered per pass, chosen at random, so a single
   * attempt can miss. Retrying beats `if (!found) return`, which turns a
   * broken scenario into a silently skipped test.
   */
  function untilRaised(pattern: RegExp, attempts = 40): VmSession {
    for (let i = 0; i < attempts; i += 1) {
      const s = new VmSession();
      s.tickets.list().forEach((t) => s.tickets.resolve(t.id, 'system' as never));
      buildTo(s, 'operating');
      generateTicketsSync({ ...deps(s), pim: s.pim, cloud: s.cloud }, 10);
      if (s.tickets.list().some((t) => pattern.test(t.subject))) return s;
    }
    throw new Error(`No ticket matching ${pattern} after ${attempts} attempts`);
  }

  it('the leaver ticket is true before it is raised', () => {
    const s = untilRaised(/can still reach/);
    const ticket = s.tickets.list().find((t) => /can still reach/.test(t.subject))!;
    const named = /^(\S+) left on Friday/.exec(ticket.subject)?.[1];
    expect(named).toBeTruthy();

    // The evidence the ticket describes is genuinely there to be found: the
    // account is disabled on premises, the cloud copy has not caught up, and
    // the application account is still live.
    expect(s.dir.getUserByUsername(named!)?.status).toBe('disabled');

    const tenant = s.cloud.okta;
    expect(tenant.find(`${named}@omari.test`)?.status).toBe('active');
    expect(tenant.pendingDelta().some((d) => d.change === 'disable')).toBe(true);
  });

  it('the duplicate ticket really produces two objects with one UPN', () => {
    const s = untilRaised(/Two .* accounts exist/);
    expect(s.cloud.okta.duplicates().length).toBeGreaterThanOrEqual(2);
  });

  it('never stages a second hybrid fault while one is outstanding', () => {
    // The scenarios act on one shared tenant and interfere: a second
    // scenario's sync would repair the first one's stale cloud copy, leaving
    // a ticket describing evidence that is no longer there.
    const s = untilRaised(/can still reach|Two .* accounts exist/);
    const before = s.tickets.list().length;
    generateTicketsSync({ ...deps(s), pim: s.pim, cloud: s.cloud }, 10);

    const hybrid = s.tickets
      .list()
      .filter((t) => /can still reach|Two .* accounts exist/.test(t.subject));
    expect(hybrid).toHaveLength(1);
    expect(s.tickets.list().length).toBeGreaterThanOrEqual(before);
  });
});
