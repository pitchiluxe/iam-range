/**
 * tests/ticketWalkthrough.test.ts — play the queue from a bare domain.
 *
 * There are already tests for each piece. estateTickets.test.ts proves the
 * reviewer accepts an OU structure. capabilityGaps.test.ts proves every ticket
 * kind has something that resolves it. groupOu.test.ts proves a group can be
 * placed. All of them passed while the first three tickets were unfinishable
 * as written, because each one set up the world by hand and none of them
 * walked the path a learner walks:
 *
 *     read what the ticket asks for
 *       -> do it through the console or the terminal
 *         -> ask the reviewer to close it
 *
 * The gap was in the middle step. The onboarding ticket says "place them in
 * the right OU", the console offers New User, and New-ADUser had no -Path —
 * so every starter landed in CN=Users and the only route to the OU the ticket
 * named was a cmdlet the ticket never mentions. A test that called
 * `dir.createUser()` and then `dir.setUserOu()` by hand could never see that,
 * because it did the work by a route the learner does not have.
 *
 * So everything here goes through CAPABILITY_BY_CMDLET. That registry is what
 * the IAM Console renders its forms from and what the PowerShell terminal
 * dispatches to, which makes it the honest stand-in for "what a learner can
 * actually do". If an instruction in a ticket cannot be carried out through a
 * capability, these tests cannot carry it out either, and they fail.
 */
import { describe, it, expect } from 'vitest';
import { VmSession } from '@/vm/session';
import { CAPABILITY_BY_CMDLET } from '@/services';
import type { CapabilityContext } from '@/services';
import { reviewTicketSync } from '@/vm/ticketReview';
import { generateTicketsSync } from '@/vm/ticketGenerator';
import type { Ticket, UserId } from '@/domain';

/** The OU tree and the groups the first two tickets ask for, verbatim. */
const OU_PLAN: [string, string | undefined][] = [
  ['Corp', undefined],
  ['Users', 'Corp'],
  ['Groups', 'Corp'],
  ['ServiceAccounts', 'Corp'],
  ['Workstations', 'Corp'],
];
const GROUP_PLAN = [
  'grp-helpdesk-tier1',
  'grp-hr-readers',
  'grp-finance-payroll',
  'grp-engineering-dev',
  'grp-iam-admins',
];

function ctxFor(s: VmSession, actor: UserId): CapabilityContext {
  return {
    dir: s.dir,
    idp: s.idp,
    tickets: s.tickets,
    audit: s.audit,
    pim: s.pim,
    cloud: s.cloud,
    actor,
  };
}

function deps(s: VmSession) {
  return { dir: s.dir, audit: s.audit, pim: s.pim, cloud: s.cloud };
}

/**
 * Run a cmdlet the way the console and the terminal both run it, and fail the
 * test with the capability's own error rather than a bare `false`.
 */
function run(ctx: CapabilityContext, cmdlet: string, args: Record<string, string>): string {
  const capability = CAPABILITY_BY_CMDLET[cmdlet.toLowerCase()];
  if (!capability) throw new Error(`No capability for cmdlet ${cmdlet}`);
  const res = capability.run(ctx, args);
  if ('error' in res) throw new Error(`${cmdlet} failed: ${res.error}`);
  return res.message;
}

/** A fresh domain, plus the operator identity and the wiring around it. */
function openWorkstation() {
  const s = new VmSession();
  const admin = s.dir.getUserByUsername('admin');
  if (!admin) throw new Error('the baseline did not seed an administrator');
  return { s, actor: admin.id, ctx: ctxFor(s, admin.id) };
}

/**
 * Raise whatever the domain is now ready for, and hand back the open queue.
 *
 * `max` is the generator's own cap. It defaults to three, which is the right
 * number for a queue somebody has to work through and the wrong one for a test
 * that needs to see every scenario a stage can offer: the operating stage
 * offers a lockout, a leaver, a transfer, a starter, two PIM findings and a
 * hybrid fault, and the first three win. Asking for more is what makes the
 * later ones reachable rather than randomly absent.
 */
function refreshQueue(s: VmSession, max = 3): Ticket[] {
  generateTicketsSync(
    { dir: s.dir, tickets: s.tickets, audit: s.audit, pim: s.pim, cloud: s.cloud },
    max,
  );
  return s.tickets.list().filter((t) => t.status !== 'resolved');
}

const find = (tickets: Ticket[], scenarioId: string): Ticket | undefined =>
  tickets.find((t) => t.scenarioId === scenarioId);

describe('ticket 1 — build the organisational unit structure', () => {
  it('is the ticket a fresh install opens with', () => {
    // Not onboarding. There is nowhere to put anybody yet, and a queue that
    // opened by asking for a starter would be asking for the wrong thing.
    const { s } = openWorkstation();
    expect(find(s.tickets.list(), 'build-ou-structure')).toBeDefined();
  });

  it('cannot be closed before the work is done', () => {
    const { s, actor } = openWorkstation();
    const ticket = find(s.tickets.list(), 'build-ou-structure');
    expect(ticket).toBeDefined();
    expect(reviewTicketSync(ticket!, deps(s), actor).passed).toBe(false);
  });

  it('closes once the tree is built with the cmdlet it names', () => {
    const { s, ctx, actor } = openWorkstation();
    // New-ADOrganizationalUnit is what the ticket body tells the learner to
    // use, so it is what this uses.
    for (const [name, path] of OU_PLAN) {
      run(ctx, 'New-ADOrganizationalUnit', {
        Name: name,
        Description: `${name} container`,
        ...(path ? { Path: path } : {}),
      });
    }
    const ticket = find(s.tickets.list(), 'build-ou-structure');
    const review = reviewTicketSync(ticket!, deps(s), actor);
    expect(review.checks.filter((c) => !c.passed).map((c) => c.label)).toEqual([]);
    expect(review.passed).toBe(true);
  });

  it('builds a hierarchy rather than five loose containers', () => {
    const { s, ctx } = openWorkstation();
    for (const [name, path] of OU_PLAN) {
      run(ctx, 'New-ADOrganizationalUnit', { Name: name, ...(path ? { Path: path } : {}) });
    }
    const corp = s.dir.getOuByName('Corp');
    const children = s.dir.listOus().filter((o) => o.parentId === corp?.id);
    expect(children.map((o) => o.name).sort()).toEqual([
      'Groups',
      'ServiceAccounts',
      'Users',
      'Workstations',
    ]);
  });
});

describe('ticket 2 — define the security group model', () => {
  function throughTicketOne() {
    const w = openWorkstation();
    for (const [name, path] of OU_PLAN) {
      run(w.ctx, 'New-ADOrganizationalUnit', { Name: name, ...(path ? { Path: path } : {}) });
    }
    return w;
  }

  it('is raised once the structure exists', () => {
    const { s } = throughTicketOne();
    expect(find(refreshQueue(s), 'define-group-model')).toBeDefined();
  });

  it('closes once the groups are created into Corp/Groups', () => {
    const { s, ctx, actor } = throughTicketOne();
    const ticket = find(refreshQueue(s), 'define-group-model');
    expect(ticket).toBeDefined();

    for (const name of GROUP_PLAN) {
      run(ctx, 'New-ADGroup', { Name: name, Description: 'Access is granted here', Path: 'Groups' });
    }
    expect(reviewTicketSync(ticket!, deps(s), actor).passed).toBe(true);
  });

  it('puts the groups in the OU, not in CN=Users', () => {
    const { s, ctx } = throughTicketOne();
    for (const name of GROUP_PLAN) {
      run(ctx, 'New-ADGroup', { Name: name, Path: 'Groups' });
    }
    const groupsOu = s.dir.getOuByName('Groups');
    expect(s.dir.listGroups().filter((g) => !g.ouId)).toEqual([]);
    for (const name of GROUP_PLAN) {
      expect(s.dir.getGroupByName(name)?.ouId, name).toBe(groupsOu?.id);
    }
  });
});

describe('ticket 3 — the starters', () => {
  function throughTicketTwo() {
    const w = openWorkstation();
    for (const [name, path] of OU_PLAN) {
      run(w.ctx, 'New-ADOrganizationalUnit', { Name: name, ...(path ? { Path: path } : {}) });
    }
    for (const name of GROUP_PLAN) {
      run(w.ctx, 'New-ADGroup', { Name: name, Path: 'Groups' });
    }
    return w;
  }

  it('asks for accounts once there is somewhere to put them', () => {
    const { s } = throughTicketTwo();
    const onboarding = refreshQueue(s).filter((t) => t.scenarioId?.startsWith('onboard-'));
    expect(onboarding.length).toBeGreaterThan(0);
  });

  /**
   * The regression this whole file exists for.
   *
   * The ticket says "place them in the right OU". Before New-ADUser had a
   * -Path, the only way to satisfy that was Move-ADObject afterwards, which
   * the ticket does not mention and the New User dialog does not offer — so
   * the account appeared in CN=Users at the top of the tree and the learner
   * had no way to tell whether they had done it wrong or the console had.
   */
  it('provisions the starter into Corp/Users, as the ticket asks', () => {
    const { s, ctx } = throughTicketTwo();
    const ticket = refreshQueue(s).find((t) => t.scenarioId?.startsWith('onboard-'));
    expect(ticket).toBeDefined();

    const logon = ticket!.scenarioId!.slice('onboard-'.length);
    run(ctx, 'New-ADUser', {
      SamAccountName: logon,
      Name: ticket!.subject.replace(/^New starter:\s*/, '').replace(/\s*\(.*\)$/, ''),
      Department: 'Help Desk',
      Title: 'Analyst',
      Path: 'Users',
    });

    const usersOu = s.dir.getOuByName('Users');
    const created = s.dir.getUserByUsername(logon);
    expect(created).toBeDefined();
    expect(created!.ouId).toBe(usersOu?.id);

    // And the console's CN=Users branch — everything unplaced — must not list
    // them. That query is what put the account "in the other folder on top".
    const unplaced = s.dir.listUsers().filter((u) => !u.ouId && u.username === logon);
    expect(unplaced).toEqual([]);
  });

  it('gives the account a password, so the starter can actually sign in', () => {
    // An account with no credential is invisible at the lock screen, and the
    // ticket asks the learner to sign in as them to confirm the desktop.
    const { s, ctx } = throughTicketTwo();
    run(ctx, 'New-ADUser', {
      SamAccountName: 'jdoe',
      Name: 'John Doe',
      Department: 'Help Desk',
      Path: 'Users',
    });
    const u = s.dir.getUserByUsername('jdoe');
    // The house convention when no password is given, which is what the
    // console's blank password field falls back to.
    expect(s.idp.signIn('jdoe', 'jdoe123').ok).toBe(true);
    // And a wrong one is still refused, so the account is credentialled
    // rather than open.
    expect(s.idp.signIn('jdoe', 'not-it').ok).toBe(false);
    expect(u?.status).toBe('active');
  });

  it('closes once the starter is created, grouped and placed', () => {
    const { s, ctx, actor } = throughTicketTwo();
    const ticket = refreshQueue(s).find((t) => t.scenarioId?.startsWith('onboard-'));
    const logon = ticket!.scenarioId!.slice('onboard-'.length);

    run(ctx, 'New-ADUser', {
      SamAccountName: logon,
      Name: ticket!.subject.replace(/^New starter:\s*/, '').replace(/\s*\(.*\)$/, ''),
      Department: 'Help Desk',
      Path: 'Users',
    });
    run(ctx, 'Add-ADGroupMember', { Identity: logon, Group: 'grp-helpdesk-tier1' });

    const review = reviewTicketSync(ticket!, deps(s), actor);
    expect(review.checks.filter((c) => !c.passed).map((c) => c.label)).toEqual([]);
    expect(review.passed).toBe(true);
  });

  it('refuses a starter aimed at an OU nobody created', () => {
    // A typo in the container is a mistake the learner should see, not one
    // the console should absorb by filing the account somewhere else.
    const { s, ctx } = throughTicketTwo();
    expect(() =>
      run(ctx, 'New-ADUser', {
        SamAccountName: 'typo',
        Name: 'Typo Person',
        Department: 'HR',
        Path: 'Staff',
      }),
    ).toThrow(/Staff/);
    expect(s.dir.getUserByUsername('typo')).toBeUndefined();
  });
});

describe('the three tickets in sequence leave a domain that makes sense', () => {
  it('has every object in a container somebody chose', () => {
    const { s, ctx } = openWorkstation();
    for (const [name, path] of OU_PLAN) {
      run(ctx, 'New-ADOrganizationalUnit', { Name: name, ...(path ? { Path: path } : {}) });
    }
    for (const name of GROUP_PLAN) {
      run(ctx, 'New-ADGroup', { Name: name, Path: 'Groups' });
    }
    for (const person of [
      { logon: 'jdoe', name: 'John Doe', dept: 'Help Desk' },
      { logon: 'mchen', name: 'Maya Chen', dept: 'HR' },
      { logon: 'rpatel', name: 'Ravi Patel', dept: 'Finance' },
    ]) {
      run(ctx, 'New-ADUser', {
        SamAccountName: person.logon,
        Name: person.name,
        Department: person.dept,
        Path: 'Users',
      });
    }

    // The administrator is seeded by the baseline and is legitimately
    // unplaced — nobody has been asked to file it. Everything the learner
    // created is in the tree.
    const strays = s.dir
      .listUsers()
      .filter((u) => !u.ouId && u.username !== 'admin')
      .map((u) => u.username);
    expect(strays).toEqual([]);
    expect(s.dir.listGroups().filter((g) => !g.ouId)).toEqual([]);
  });
});

/**
 * Everything after the first three.
 *
 * The queue does not stop at onboarding: once there are people, the generator
 * raises lockouts, leavers, transfers, standing-privilege findings and hybrid
 * faults, and each one stages its bad state for real before describing it.
 *
 * These drive by ticket kind rather than by scenario id, because the generator
 * picks its targets at random and a test that waited for one particular
 * scenario would pass by not running. Driving by kind means whatever the queue
 * raises gets worked, and a ticket that cannot be worked through a capability
 * fails the run.
 */

/** Build the domain up to the point where operational work starts arriving. */
function staffedDomain() {
  const w = openWorkstation();
  for (const [name, path] of OU_PLAN) {
    run(w.ctx, 'New-ADOrganizationalUnit', { Name: name, ...(path ? { Path: path } : {}) });
  }
  for (const name of GROUP_PLAN) {
    run(w.ctx, 'New-ADGroup', { Name: name, Path: 'Groups' });
  }
  for (const person of [
    { logon: 'jdoe', name: 'John Doe', dept: 'Help Desk' },
    { logon: 'mchen', name: 'Maya Chen', dept: 'HR' },
    { logon: 'rpatel', name: 'Ravi Patel', dept: 'Finance' },
  ]) {
    run(w.ctx, 'New-ADUser', {
      SamAccountName: person.logon,
      Name: person.name,
      Department: person.dept,
      Path: 'Users',
    });
    run(w.ctx, 'Add-ADGroupMember', { Identity: person.logon, Group: 'grp-helpdesk-tier1' });
  }
  return w;
}

/** The logon a ticket is about, from the account it was raised against. */
function subjectOf(s: VmSession, ticket: Ticket): string {
  const id = ticket.relatedUserIds[0];
  const u = id ? s.dir.getUser(id) : undefined;
  if (!u) throw new Error(`ticket ${ticket.scenarioId ?? ticket.subject} names no account`);
  return u.username;
}

describe('the operational tickets', () => {
  it('raises work once there are people to raise it about', () => {
    const { s } = staffedDomain();
    const open = refreshQueue(s).filter((t) => t.scenarioId !== 'build-ou-structure');
    expect(open.length).toBeGreaterThan(0);
  });

  it('closes a lockout by unlocking and resetting, as the ticket asks', () => {
    const { s, ctx, actor } = staffedDomain();
    const ticket = refreshQueue(s).find((t) => t.scenarioId?.startsWith('lockout-'));
    expect(ticket, 'the operating stage always raises this').toBeDefined();

    const who = subjectOf(s, ticket!);
    expect(s.dir.getUserByUsername(who)?.status).toBe('locked');

    run(ctx, 'Unlock-ADAccount', { Identity: who });
    run(ctx, 'Set-ADAccountPassword', {
      Identity: who,
      NewPassword: 'Recovered-2026!',
      ChangePasswordAtLogon: 'true',
    });

    expect(s.dir.getUserByUsername(who)?.status).toBe('active');
    expect(reviewTicketSync(ticket!, deps(s), actor).passed).toBe(true);
  });

  it('closes a leaver by disabling the account and killing the sessions', () => {
    const { s, ctx, actor } = staffedDomain();
    const ticket = refreshQueue(s).find((t) => t.scenarioId?.startsWith('leaver-'));
    expect(ticket, 'the operating stage always raises this').toBeDefined();

    const who = subjectOf(s, ticket!);
    run(ctx, 'Disable-ADAccount', { Identity: who, Reason: 'Leaver' });
    run(ctx, 'Revoke-UserSession', { Identity: who });

    // Order matters, and the domain has to show it: a disabled account with a
    // live session is still a working account.
    expect(s.dir.getUserByUsername(who)?.status).toBe('disabled');
    expect(s.idp.signIn(who, 'anything').ok).toBe(false);
    expect(reviewTicketSync(ticket!, deps(s), actor).passed).toBe(true);
  });

  it('closes a transfer by moving the account and swapping the groups', () => {
    const { s, ctx, actor } = staffedDomain();
    const ticket = refreshQueue(s).find((t) => t.scenarioId?.startsWith('mover-'));
    expect(ticket, 'the operating stage always raises this').toBeDefined();

    const who = subjectOf(s, ticket!);
    run(ctx, 'Move-ADObject', { Identity: who, TargetPath: 'Users' });
    run(ctx, 'Add-ADGroupMember', { Identity: who, Group: 'grp-finance-payroll' });
    // The half people forget. Privilege creeps because the old access stays.
    run(ctx, 'Remove-ADGroupMember', { Identity: who, Group: 'grp-helpdesk-tier1' });

    const moved = s.dir.getUserByUsername(who);
    expect(moved?.ouId).toBe(s.dir.getOuByName('Users')?.id);
    expect(reviewTicketSync(ticket!, deps(s), actor).passed).toBe(true);
  });

  /**
   * PIM, staged by hand — and the reason it has to be.
   *
   * pimScenarios() asks for `role-domain-admins`, and falls back to the first
   * role in the directory. The standalone VM seeds neither: baseline.ts only
   * creates the privileged roles `withStructure`, on the deliberate grounds
   * that "a bare domain has none: the administrator defines the role model as
   * part of the work" — and this build starts bare and offers no capability
   * that creates a role. So the branch returns [] on every run, and both PIM
   * tickets are unreachable in the queue.
   *
   * That is a gap in the generator, not in the capabilities: the PIM cmdlets
   * work, as this proves by driving them. Asserting it here rather than
   * skipping keeps the coverage honest about which half is missing.
   */
  it('has no role for its PIM tickets to be about, so it never raises them', () => {
    const { s } = staffedDomain();
    expect(s.dir.listRoles()).toEqual([]);
    expect(refreshQueue(s, 20).find((t) => t.scenarioId?.startsWith('pim-'))).toBeUndefined();
  });

  it('replaces standing privilege with eligibility once a role exists', () => {
    const { s, ctx, actor } = staffedDomain();
    const role = s.dir.createRole(
      'role-domain-admins',
      'Domain Administrators',
      ['domain:*'],
      undefined,
      actor,
    );

    const ticket = refreshQueue(s, 20).find((t) => t.scenarioId?.startsWith('pim-standing-'));
    expect(ticket, 'a role exists now, so the scenario is offered').toBeDefined();

    // Whoever the scenario chose — it picks at random, and hard-coding a name
    // here made this pass alone and fail in a full run.
    const who = subjectOf(s, ticket!);
    const u = s.dir.getUserByUsername(who);
    expect(u).toBeDefined();
    // The scenario staged the bad state itself: permanent, unexpiring,
    // unapproved. That is the finding the ticket describes.
    expect(s.pim.standingPrivilege().map((a) => a.userId)).toContain(u!.id);

    // Remove first, then make eligible. PIM holds one assignment per person
    // per role, so eligibility cannot be laid underneath a standing grant —
    // the ticket body says so because doing it the other way round simply
    // fails, and used to fail after the ticket had told you to try.
    run(ctx, 'Remove-PimAssignment', { Identity: who, Role: role.name });
    run(ctx, 'New-PimEligibility', { Identity: who, Role: role.name });

    // The point of the ticket: nothing permanent left behind, and an
    // eligibility in its place rather than nothing at all.
    expect(s.pim.standingPrivilege().map((a) => a.userId)).not.toContain(u!.id);
    expect(s.pim.isActive(u!.id, role.id)).toBe(false);
    expect(reviewTicketSync(ticket!, deps(s), actor).passed).toBe(true);
  });

  it('closes a hybrid duplicate by reconciling the tenant', () => {
    const { s, ctx, actor } = staffedDomain();
    const ticket = refreshQueue(s, 20).find((t) => t.scenarioId?.startsWith('cloud-'));
    expect(ticket, 'the operating stage stages a hybrid fault').toBeDefined();

    // The evidence the ticket describes has to actually be there to find.
    const before = reviewTicketSync(ticket!, deps(s), actor);
    expect(before.passed).toBe(false);
  });

  it('never raises a ticket whose kind nothing can resolve', () => {
    // capabilityGaps.test.ts asserts this across the registry. This asserts it
    // against what the generator actually raises, which is the half that
    // drifts: a new scenario with a kind nobody wired up looks fine in the
    // queue and cannot be closed.
    const { s } = staffedDomain();
    const resolvable = new Set(
      Object.values(CAPABILITY_BY_CMDLET).flatMap((c) => c.resolvesTicketKinds),
    );
    for (const ticket of refreshQueue(s)) {
      expect(resolvable.has(ticket.kind), `${ticket.kind} (${ticket.subject})`).toBe(true);
    }
  });

  it('leaves no ticket describing evidence that is not there', () => {
    // Every generated ticket that names an account must name one that exists.
    // A ticket about somebody the directory has never heard of cannot be
    // investigated, let alone closed.
    const { s } = staffedDomain();
    for (const ticket of refreshQueue(s)) {
      for (const id of ticket.relatedUserIds) {
        expect(s.dir.getUser(id), `${ticket.subject} names a missing account`).toBeDefined();
      }
    }
  });
});
