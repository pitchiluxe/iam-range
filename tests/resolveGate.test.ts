/**
 * tests/resolveGate.test.ts — the supervisor decides, and cannot be walked around.
 *
 * Marking a ticket resolved used to be unconditional. queue.resolve() ran
 * first, the resolved count went up, and only then did the checks run — so a
 * failing review left the ticket resolved anyway and printed a warning. Every
 * ticket in the queue could be closed having done nothing at all, with a
 * perfect score at the end. A lab that teaches "claiming done makes it done"
 * teaches the habit that gets people removed from an identity role.
 *
 * Three separate paths could resolve a ticket — the card button, Resolve all,
 * and the R shortcut — each with its own copy of the same five lines. A gate
 * on one of them is not a gate, so the structural assertion here is that
 * queue.resolve() is reached from exactly one place.
 *
 * The checks themselves are exercised in ticketReview.test.ts; this is about
 * the wiring around them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VmSession } from '@/vm/session';
import { reviewTicketSync } from '@/vm/ticketReview';
import type { Ticket, UserId } from '@/domain';

const ACTOR = 'system' as UserId;
const CONSOLE = readFileSync(
  join(process.cwd(), 'src', 'ui', 'consoles', 'ticketConsole.ts'),
  'utf8',
);

/**
 * Source with comments removed, so prose about a call is not counted as one.
 *
 * Both forms have to go. attemptResolve's own docblock says it is "the one
 * place queue.resolve() is called from", and stripping only `//` comments
 * counted that sentence as a second call site.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('the resolve gate has one door', () => {
  it('calls queue.resolve from exactly one place', () => {
    const calls = code(CONSOLE).match(/queue\.resolve\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it('puts that one call inside attemptResolve, after the review', () => {
    const start = CONSOLE.indexOf('function attemptResolve(');
    expect(start, 'attemptResolve moved').toBeGreaterThan(-1);
    const body = CONSOLE.slice(start, CONSOLE.indexOf('\n  }', start));

    const reviewAt = body.indexOf('reviewTicketSync(');
    const refuseAt = body.indexOf('if (!review.passed)');
    const resolveAt = body.indexOf('queue.resolve(');

    expect(reviewAt, 'the review is not run here').toBeGreaterThan(-1);
    expect(refuseAt, 'nothing acts on a failed review').toBeGreaterThan(reviewAt);
    // The order is the whole point: check, refuse, only then resolve.
    expect(resolveAt).toBeGreaterThan(refuseAt);
  });

  it('scores a ticket only where it resolves it', () => {
    // incrementResolved() used to sit beside each of the three copies, so a
    // refused ticket could still raise the score.
    const bumps = code(CONSOLE).match(/incrementResolved\(\)/g) ?? [];
    expect(bumps).toHaveLength(1);
  });

  it('reviews each ticket separately in the bulk action', () => {
    // Selecting ten tickets must not be a way to close the two that are not
    // finished, so the bulk path goes through the same gate per ticket.
    const start = CONSOLE.indexOf("btn('✓ Resolve all'");
    expect(start, 'the bulk action moved').toBeGreaterThan(-1);
    const body = CONSOLE.slice(start, start + 1600);
    expect(body).toContain('attemptResolve(');
    expect(code(body)).not.toContain('queue.resolve(');
  });
});

describe('what the gate is deciding on', () => {
  function setup() {
    const s = new VmSession();
    s.tickets.list().forEach((t) => s.tickets.resolve(t.id, ACTOR));
    s.dir.createOu('Corp', 'Top level');
    s.dir.createGroup('grp-helpdesk-tier1', 'Service desk');
    return s;
  }

  function ticketFor(s: VmSession, kind: Ticket['kind'], userId: UserId): Ticket {
    const admin = s.dir.getUserByUsername('admin')!;
    return s.tickets.create({
      kind: kind as 'onboarding',
      requesterId: admin.id,
      subject: `${kind} for review`,
      body: 'body',
      priority: 'normal',
      relatedUserIds: [userId],
      payload: { proposedGroupIds: [], proposedRoleIds: [], startDate: Date.now() } as never,
    });
  }

  it('refuses an untouched ticket, and says what is outstanding', () => {
    const s = setup();
    const user = s.dir.createUser({
      username: 'jdoe',
      displayName: 'John Doe',
      email: 'jdoe@omari.test',
      department: 'Help Desk',
      title: 'Analyst',
      mfa: 'none',
    });

    const review = reviewTicketSync(ticketFor(s, 'onboarding', user.id), deps(s), ACTOR);

    expect(review.passed).toBe(false);
    const failed = review.checks.filter((c) => !c.passed);
    expect(failed.length).toBeGreaterThan(0);
    // A refusal that does not say what would satisfy it is a scolding, not
    // supervision. Every failed check has to carry its reason.
    expect(failed.every((c) => c.detail.trim().length > 20)).toBe(true);
  });

  function deps(s: VmSession) {
    return { dir: s.dir, audit: s.audit, pim: s.pim, cloud: s.cloud };
  }
});
