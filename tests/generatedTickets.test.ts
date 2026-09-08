/**
 * tests/generatedTickets.test.ts — the tickets Ollama rewrites.
 *
 * The generator picks a scenario, stages its state for real, and then — when a
 * model is running — asks it to reword the ticket so it reads like something a
 * colleague sent. The scenario decides what the ticket is about; the model only
 * supplies the prose.
 *
 * Two things go wrong at that seam, and both are invisible without a model
 * running, which is why neither showed up in a test suite that never had one:
 *
 *   1. De-duplication keys on the subject line, and the model rewrites the
 *      subject line. So the check "is this scenario already open?" compares the
 *      original wording against a queue full of rewritten wording, matches
 *      nothing, and raises every scenario again on the next pass. Leave the
 *      queue open with Ollama running and it fills with the same three tickets
 *      under different headlines, each with its own staged state.
 *
 *   2. The guard on the rewrite only protects staff logons. A ticket that names
 *      groups or OUs — "create grp-helpdesk-tier1, grp-hr-readers…" — could
 *      come back naming something else entirely, and the learner would be told
 *      to build a group model that does not match what the reviewer checks for.
 *
 * The model is stubbed here through fetch. The point is the plumbing around it,
 * not the model.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { VmSession } from '@/vm/session';
import { generateTickets, generateTicketsSync } from '@/vm/ticketGenerator';
import type { UserId } from '@/domain';

const ACTOR = 'admin-1' as UserId;

function deps(s: VmSession) {
  return { dir: s.dir, tickets: s.tickets, audit: s.audit, pim: s.pim, cloud: s.cloud };
}

/**
 * Stand in for Ollama.
 *
 * `rewrite` receives the prompt and returns the JSON body the model would.
 * Both the availability probe and the generate call go through fetch, so both
 * are answered here.
 */
function stubOllama(rewrite: (prompt: string) => { subject?: string; body?: string }): void {
  vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => {
    const target = String(url);
    // The availability probe.
    if (!target.includes('/api/generate')) {
      return { ok: true, json: async () => ({ models: [{ name: 'stub' }] }) } as never;
    }
    const sent = JSON.parse(init?.body ?? '{}') as { prompt?: string };
    return {
      ok: true,
      json: async () => ({ response: JSON.stringify(rewrite(sent.prompt ?? '')) }),
    } as never;
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A bare domain with an empty queue.
 *
 * The boot ticket is cleared on purpose. It is raised by the synchronous
 * generator with the original wording, and while it sits there the
 * de-duplication check matches on that original wording and hides the bug —
 * which is how this went unnoticed. The duplication only appears once a
 * rewritten subject is what is stored, so the first async pass has to be the
 * one that raises it.
 */
function bare(): VmSession {
  const s = new VmSession();
  s.tickets.reset();
  return s;
}

describe('a rewritten ticket is still the same ticket', () => {
  it('is not raised a second time under its new subject', async () => {
    const s = bare();
    // The model rewrites the headline, which is what it is for.
    stubOllama(() => ({
      subject: 'Can you get the OU tree set up before we start adding people?',
      body: 'We need the Corp structure in place first. Thanks!',
    }));

    await generateTickets(deps(s), { useOllama: true });
    await generateTickets(deps(s), { useOllama: true });
    await generateTickets(deps(s), { useOllama: true });

    const structural = s.tickets
      .list()
      .filter((t) => t.scenarioId === 'build-ou-structure' && t.status !== 'resolved');
    expect(structural).toHaveLength(1);
  });

  it('does not re-raise a scenario the sync generator already raised', async () => {
    // Boot raises it synchronously with the original wording; the console's
    // refresh then runs the async path with the model. Different code paths,
    // same scenario, and the queue should not end up with both.
    const s = bare();
    stubOllama(() => ({ subject: 'Rewritten headline', body: 'Rewritten body.' }));

    await generateTickets(deps(s), { useOllama: true });
    const ids = s.tickets.list().map((t) => t.scenarioId);
    expect(ids.filter((id) => id === 'build-ou-structure')).toHaveLength(1);
  });

  it('still de-duplicates when the model is off', () => {
    const s = bare();
    generateTicketsSync(deps(s));
    generateTicketsSync(deps(s));
    expect(
      s.tickets.list().filter((t) => t.scenarioId === 'build-ou-structure'),
    ).toHaveLength(1);
  });

  it('raises it again once the first one is resolved and the domain moves on', () => {
    // De-duplication must not become "this scenario can never recur". The OU
    // ticket does not come back, but the queue has to keep producing work.
    const s = bare();
    generateTicketsSync(deps(s));
    const first = s.tickets.list().find((t) => t.scenarioId === 'build-ou-structure');
    expect(first).toBeDefined();

    const corp = s.dir.createOu('Corp', 'Corporate', undefined, ACTOR);
    s.dir.createOu('Users', 'Staff', corp.id, ACTOR);
    s.tickets.resolve(first!.id, ACTOR);

    expect(generateTicketsSync(deps(s))).toBeGreaterThan(0);
  });
});

describe('what the model is allowed to change', () => {
  it('keeps the original when the rewrite drops an account it was told to name', async () => {
    const s = bare();
    const corp = s.dir.createOu('Corp', 'Corporate', undefined, ACTOR);
    const usersOu = s.dir.createOu('Users', 'Staff', corp.id, ACTOR);
    const groupsOu = s.dir.createOu('Groups', 'Groups', corp.id, ACTOR);
    s.dir.createGroup('grp-helpdesk-tier1', 'Desk', ACTOR, groupsOu.id);
    s.dir.createUser(
      {
        username: 'jdoe',
        displayName: 'John Doe',
        email: 'jdoe@iamlab.com',
        department: 'Help Desk',
        title: 'Analyst',
        ouId: usersOu.id,
      },
      ACTOR,
    );

    stubOllama(() => ({
      subject: 'Someone cannot log in',
      body: 'A user is having trouble signing in. Please take a look.',
    }));

    await generateTickets(deps(s), { useOllama: true, max: 12 });
    const about = s.tickets.list().filter((t) => t.scenarioId?.startsWith('lockout-'));
    // The rewrite named nobody, so the original wording is kept — a ticket
    // that says "a user" is one nobody can action.
    for (const t of about) expect(`${t.subject} ${t.body}`).toContain('jdoe');
  });

  it('keeps the original when the rewrite drops a group it was told to name', async () => {
    const s = bare();
    const corp = s.dir.createOu('Corp', 'Corporate', undefined, ACTOR);
    s.dir.createOu('Users', 'Staff', corp.id, ACTOR);

    stubOllama(() => ({
      subject: 'Set up the groups',
      body: 'Please create the security groups we agreed on in the meeting.',
    }));

    await generateTickets(deps(s), { useOllama: true, max: 12 });
    const groupTicket = s.tickets.list().find((t) => t.scenarioId === 'define-group-model');
    expect(groupTicket).toBeDefined();
    // The reviewer checks for real groups; a ticket that names none of them
    // cannot be followed.
    expect(groupTicket!.body).toContain('grp-helpdesk-tier1');
  });

  it('accepts a rewrite that keeps every name', async () => {
    const s = bare();
    stubOllama(() => ({
      subject: 'Please build out the OU structure',
      body:
        'Before we onboard anyone, could you create Corp, Corp/Users, Corp/Groups, ' +
        'Corp/ServiceAccounts and Corp/Workstations? Nothing has anywhere to live yet.',
    }));

    await generateTickets(deps(s), { useOllama: true });
    const t = s.tickets.list().find((x) => x.scenarioId === 'build-ou-structure');
    expect(t?.subject).toBe('Please build out the OU structure');
  });

  it('keeps the original when the model returns nonsense', async () => {
    const s = bare();
    vi.stubGlobal('fetch', async (url: string) => {
      const target = String(url);
      if (!target.includes('/api/generate')) {
        return { ok: true, json: async () => ({ models: [{ name: 'stub' }] }) } as never;
      }
      return { ok: true, json: async () => ({ response: 'not json at all' }) } as never;
    });

    await generateTickets(deps(s), { useOllama: true });
    const t = s.tickets.list().find((x) => x.scenarioId === 'build-ou-structure');
    expect(t?.subject).toBe('Build the organisational unit structure');
  });
});
