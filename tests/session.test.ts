/**
 * tests/session.test.ts
 *
 * The boot environment, and the starting ticket backlog.
 *
 * The accuracy rules here are the ones the 3D lab arrived at after tickets were
 * found describing evidence that never existed: a ticket must name accounts the
 * directory has, point its payload at the subject rather than the requester,
 * and — if its prose claims failed sign-ins or a lockout — those must be true
 * of the world. An operator who cannot find what the ticket describes cannot do
 * the job.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { VmSession } from '@/vm/session';
import type { Ticket } from '@/domain';
import { readEnvironment } from '@/vm/environmentStage';

describe('VmSession boot', () => {
  let session: VmSession;
  beforeEach(() => {
    session = new VmSession();
  });

  it('seeds a bare domain: the administrator and the federated apps, nothing else', () => {
    // A newly promoted domain has no OUs, no groups and no staff. Building
    // that structure is the work; pre-building it teaches none of it.
    expect(session.dir.listUsers()).toHaveLength(1);
    expect(session.dir.listGroups()).toHaveLength(0);
    expect(session.dir.listOus()).toHaveLength(0);
    // Applications are SaaS the organisation already subscribes to, not
    // directory objects the administrator creates.
    expect(session.apps.apps().length).toBeGreaterThan(0);
  });

  it('exposes every service the windows expect', () => {
    for (const key of ['dir', 'idp', 'apps', 'tickets', 'audit', 'reviews', 'incidents'] as const) {
      expect(session[key], `missing service: ${key}`).toBeDefined();
    }
    expect(typeof session.reset).toBe('function');
  });

  it('has no duplicate usernames', () => {
    const names = session.dir.listUsers().map((u) => u.username);
    expect(new Set(names).size).toBe(names.length);
  });

  it('reset re-seeds and discards work', () => {
    session.dir.createUser({
      username: 'temp.person',
      displayName: 'Temp',
      email: 't@iamlab.com',
      department: 'IT',
      title: 'Temp',
      mfa: 'none',
    });
    expect(session.dir.getUserByUsername('temp.person')).toBeDefined();

    session.reset();

    expect(session.dir.getUserByUsername('temp.person')).toBeUndefined();
    expect(session.dir.listUsers().length).toBeGreaterThan(0);
  });

  it('reset replaces the services rather than clearing them', () => {
    // Windows must resolve services per action: a captured reference would
    // survive a reset and quietly mutate an orphaned directory.
    const before = session.dir;
    session.reset();
    expect(session.dir).not.toBe(before);
  });
});

describe('starting ticket backlog', () => {
  let session: VmSession;
  beforeEach(() => {
    session = new VmSession();
  });

  const tickets = (): Ticket[] => session.tickets.list();

  it('gives the operator work to do on boot', () => {
    expect(tickets().length).toBeGreaterThan(0);
  });

  it('opens on the bare stage, because the domain has no structure yet', () => {
    expect(readEnvironment(session.dir).stage).toBe('bare');
  });

  it('the opening work is building structure, not onboarding people', () => {
    // There is nowhere to put anyone yet, so asking for a new starter would be
    // asking for work the domain cannot support.
    const subjects = tickets().map((t) => t.subject);
    expect(subjects.some((s) => /organisational unit/i.test(s))).toBe(true);
    expect(subjects.some((s) => /new starter/i.test(s))).toBe(false);
  });


  it('seeds only the administrator and the service accounts', () => {
    // Service accounts are real directory objects and belong on a fresh
    // domain; people do not, because provisioning them is the work.
    const people = session.dir.listUsers().filter((u) => !u.username.startsWith('svc-'));
    expect(people.map((u) => u.username)).toEqual(['admin']);
  });

  it('the administrator can sign in with the shipped password', () => {
    expect(session.idp.signIn('admin', '123!').ok).toBe(true);
  });


});
