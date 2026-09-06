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
import { FIRST_DAY_STARTERS } from '@/vm/seedTickets';

describe('VmSession boot', () => {
  let session: VmSession;
  beforeEach(() => {
    session = new VmSession();
  });

  it('seeds a populated directory', () => {
    expect(session.dir.listUsers().length).toBeGreaterThan(0);
    expect(session.dir.listGroups().length).toBeGreaterThan(0);
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
    expect(tickets().length).toBeGreaterThanOrEqual(3);
  });

  it('opens with provisioning work, because nobody exists yet', () => {
    // A fresh domain cannot raise a lockout or an offboarding ticket: there is
    // nobody to lock out. Day one is creating the staff.
    const kinds = new Set(tickets().map((t) => t.kind));
    expect(kinds).toEqual(new Set(['onboarding']));
  });

  it('seeds only the administrator and the service accounts', () => {
    // Service accounts are real directory objects and belong on a fresh
    // domain; people do not, because provisioning them is the work.
    const people = session.dir.listUsers().filter((u) => !u.username.startsWith('svc-'));
    expect(people.map((u) => u.username)).toEqual(['erickomari']);
  });

  it('the administrator can sign in with the shipped password', () => {
    expect(session.idp.signIn('erickomari', 'Admin123!').ok).toBe(true);
  });

  it('every starter named in a ticket is genuinely absent from the directory', () => {
    // The whole task is creating them; if the seed made them first, the ticket
    // would be complete before it was read.
    for (const s of FIRST_DAY_STARTERS) {
      expect(session.dir.getUserByUsername(s.logon)).toBeUndefined();
    }
  });

  it('names groups that exist, so the starter can actually be placed', () => {
    for (const s of FIRST_DAY_STARTERS) {
      expect(session.dir.getGroupByName(s.group), `missing group ${s.group}`).toBeDefined();
    }
  });
});
