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
      email: 't@northwind.example',
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
    expect(tickets().length).toBeGreaterThanOrEqual(5);
  });

  it('covers a spread of ticket kinds', () => {
    const kinds = new Set(tickets().map((t) => t.kind));
    for (const k of ['password-reset', 'access-request', 'onboarding', 'leaver'] as const) {
      expect(kinds).toContain(k);
    }
  });

  it('links every ticket except onboarding to a real account', () => {
    const unlinked = tickets()
      .filter((t) => t.kind !== 'onboarding')
      .filter((t) => t.relatedUserIds.length === 0 || !session.dir.getUser(t.relatedUserIds[0]!))
      .map((t) => t.subject);

    expect(unlinked).toEqual([]);
  });

  it('points each payload at the subject, not the requester', () => {
    for (const t of tickets()) {
      if (t.kind === 'onboarding' || t.kind === 'incident') continue;
      const payloadUser = (t.payload as { userId?: string }).userId;
      expect(payloadUser, `${t.subject} has no payload subject`).toBeDefined();
      expect(t.relatedUserIds).toContain(payloadUser);
    }
  });

  it('names only accounts the directory has, except for the new starter', () => {
    const known = new Set(session.dir.listUsers().map((u) => u.username.toLowerCase()));
    const dangling: string[] = [];

    for (const t of tickets()) {
      if (t.kind === 'onboarding') continue; // names the account to be created
      const text = `${t.subject} ${t.body}`;
      for (const m of text.matchAll(/\b[a-z]+\.[a-z]+\b/g)) {
        const tok = m[0];
        if (/\.(example|com|net|org)$/.test(tok)) continue;
        if (!known.has(tok)) dangling.push(`${t.subject} -> ${tok}`);
      }
    }

    expect(dangling).toEqual([]);
  });

  it('a ticket claiming a lockout has a genuinely locked account', () => {
    const wrong = tickets()
      .filter((t) => /\block(ed|out)\b/i.test(`${t.subject} ${t.body}`))
      .filter((t) => session.dir.getUser(t.relatedUserIds[0]!)?.status !== 'locked')
      .map((t) => t.subject);

    expect(wrong).toEqual([]);
  });

  it('a ticket claiming failed sign-ins has them in the audit log', () => {
    const failures = session.audit.byAction('signin.failure');

    const unsupported = tickets()
      .filter((t) => /failed sign-?ins?|failed login/i.test(`${t.subject} ${t.body}`))
      .filter((t) => !failures.some((e) => t.relatedUserIds.includes(e.targetId as never)))
      .map((t) => t.subject);

    expect(unsupported).toEqual([]);
  });

  it('the onboarding subject really is absent, so there is something to create', () => {
    const onboarding = tickets().find((t) => t.kind === 'onboarding');
    expect(onboarding).toBeDefined();
    expect(session.dir.getUserByUsername('priya.raman')).toBeUndefined();
  });
});
