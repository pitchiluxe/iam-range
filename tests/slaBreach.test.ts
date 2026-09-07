/**
 * tests/slaBreach.test.ts — a missed target is a recorded fact.
 *
 * The countdown badge turned red, said OVERDUE, and nothing else happened.
 * No audit event, no state on the ticket, nothing a review could read
 * afterwards. audio.ts even carried "a descending sad-tone for failure
 * feedback (e.g. SLA overdue)" that nothing ever called. An SLA that costs
 * nothing teaches that SLAs cost nothing, which is the opposite of the point.
 *
 * The first attempt at this hooked detection to the rendered badges, so a
 * breach only existed while somebody had the queue open — the same decoration
 * problem moved one layer up. It lives in the service now, which is why these
 * tests need no DOM.
 */
import { describe, it, expect } from 'vitest';
import { MockAuditLog, MockTicketQueue } from '@/services';
import { SLA_MS, isOverdue } from '@/services/mockTicketQueue';
import type { Ticket, UserId } from '@/domain';

const ACTOR = 'admin-1' as UserId;

function setup() {
  const audit = new MockAuditLog();
  const queue = new MockTicketQueue(audit);
  const raise = (priority: Ticket['priority'], subject: string): Ticket =>
    queue.create({
      kind: 'onboarding',
      requesterId: ACTOR,
      subject,
      body: subject,
      priority,
      relatedUserIds: [],
      payload: { proposedGroupIds: [], proposedRoleIds: [], startDate: Date.now() },
    });
  /** Put a ticket into the past, as if it had been sitting in the queue. */
  const age = (t: Ticket, minutes: number): void => {
    t.createdAt = Date.now() - minutes * 60 * 1000;
  };
  return { audit, queue, raise, age };
}

describe('the target', () => {
  it('is defined once, in the service that owns the queue', () => {
    // The console had its own copy. Two copies of a number are two answers
    // waiting to diverge, and the badge and the breach must agree on late.
    expect(SLA_MS.urgent).toBe(15 * 60 * 1000);
    expect(SLA_MS.high).toBe(30 * 60 * 1000);
  });

  it('does not put normal and low work on a clock', () => {
    const { raise, age } = setup();
    const t = raise('normal', 'Routine request');
    age(t, 600);
    expect(isOverdue(t)).toBe(false);
  });
});

describe('sweeping for breaches', () => {
  it('records an urgent ticket that has sat past fifteen minutes', () => {
    const { queue, raise, age, audit } = setup();
    const t = raise('urgent', 'Locked out of payroll');
    age(t, 20);

    const fresh = queue.sweepSla();

    expect(fresh.map((x) => x.subject)).toEqual(['Locked out of payroll']);
    expect(t.slaBreachedAt).toBeDefined();
    const events = audit.byAction('ticket.slaBreached');
    expect(events).toHaveLength(1);
    // The note has to say what was missed, or the log cannot be reviewed.
    expect(events[0]!.note).toMatch(/15-minute/);
    expect(events[0]!.note).toMatch(/Locked out of payroll/);
  });

  it('leaves a ticket inside its target alone', () => {
    const { queue, raise, age } = setup();
    const t = raise('high', 'New starter Monday');
    age(t, 12);
    expect(queue.sweepSla()).toHaveLength(0);
    expect(t.slaBreachedAt).toBeUndefined();
  });

  it('records each breach once, however often it is swept', () => {
    // The console sweeps every second. Without the flag the log would fill
    // with one entry per second per overdue ticket, which is the same as
    // having no entry at all.
    const { queue, raise, age, audit } = setup();
    age(raise('urgent', 'Locked out'), 20);

    queue.sweepSla();
    const first = queue.sweepSla();
    queue.sweepSla();

    expect(first).toHaveLength(0);
    expect(audit.byAction('ticket.slaBreached')).toHaveLength(1);
  });

  it('does not breach a ticket that is already resolved', () => {
    const { queue, raise, age } = setup();
    const t = raise('urgent', 'Handled promptly');
    queue.resolve(t.id, ACTOR);
    age(t, 60);
    expect(queue.sweepSla()).toHaveLength(0);
  });
});

describe('resolving late', () => {
  it('records the breach even if nobody had the queue open', () => {
    // This is why the sweep is in resolve() and not only on the console's
    // timer: a ticket finished twenty minutes late is late whether or not
    // anyone watched the clock run out.
    const { queue, raise, age, audit } = setup();
    const t = raise('urgent', 'Closed twenty minutes late');
    age(t, 20);

    queue.resolve(t.id, ACTOR);

    expect(t.slaBreachedAt).toBeDefined();
    expect(audit.byAction('ticket.slaBreached')).toHaveLength(1);
    expect(t.status).toBe('resolved');
  });

  it('records nothing when it was resolved in time', () => {
    const { queue, raise, age, audit } = setup();
    const t = raise('urgent', 'Closed in eight minutes');
    age(t, 8);

    queue.resolve(t.id, ACTOR);

    expect(t.slaBreachedAt).toBeUndefined();
    expect(audit.byAction('ticket.slaBreached')).toHaveLength(0);
  });
});
