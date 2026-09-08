/**
 * services/mockTicketQueue.ts — in-memory queue of tickets.
 */
import type { Ticket, TicketId, TicketKind, TicketPriority, UserId } from '@/domain';
import { mkTicketId } from '@/domain';
import type { MockAuditLog } from './mockAuditLog';

/**
 * How long each priority has before it has missed its target.
 *
 * Defined here rather than in the console that draws the countdown: the badge
 * and the breach have to agree about what late means, and two copies of a
 * number are two answers waiting to diverge. Zero means no target -- normal
 * and low work are not on a clock.
 */
export const SLA_MS: Record<TicketPriority, number> = {
  urgent: 15 * 60 * 1000,
  high: 30 * 60 * 1000,
  normal: 0,
  low: 0,
};

/** Whether a ticket has passed its target, with no side effects. */
export function isOverdue(t: Ticket, now = Date.now()): boolean {
  const target = SLA_MS[t.priority];
  if (!target) return false;
  return t.status !== 'resolved' && now - t.createdAt >= target;
}

export type NewTicket =
  | {
      id?: TicketId;
      /** Which generator scenario raised this, for the reviewer. */
      scenarioId?: string;
      kind: 'onboarding';
      requesterId: UserId;
      subject: string;
      body: string;
      priority?: Ticket['priority'];
      payload: Extract<Ticket, { kind: 'onboarding' }>['payload'];
      relatedUserIds?: UserId[];
    }
  | {
      id?: TicketId;
      /** Which generator scenario raised this, for the reviewer. */
      scenarioId?: string;
      kind: 'mover';
      requesterId: UserId;
      subject: string;
      body: string;
      priority?: Ticket['priority'];
      payload: Extract<Ticket, { kind: 'mover' }>['payload'];
      relatedUserIds?: UserId[];
    }
  | {
      id?: TicketId;
      /** Which generator scenario raised this, for the reviewer. */
      scenarioId?: string;
      kind: 'leaver';
      requesterId: UserId;
      subject: string;
      body: string;
      priority?: Ticket['priority'];
      payload: Extract<Ticket, { kind: 'leaver' }>['payload'];
      relatedUserIds?: UserId[];
    }
  | {
      id?: TicketId;
      /** Which generator scenario raised this, for the reviewer. */
      scenarioId?: string;
      kind: 'transfer';
      requesterId: UserId;
      subject: string;
      body: string;
      priority?: Ticket['priority'];
      payload: Extract<Ticket, { kind: 'transfer' }>['payload'];
      relatedUserIds?: UserId[];
    }
  | {
      id?: TicketId;
      /** Which generator scenario raised this, for the reviewer. */
      scenarioId?: string;
      kind: 'termination';
      requesterId: UserId;
      subject: string;
      body: string;
      priority?: Ticket['priority'];
      payload: Extract<Ticket, { kind: 'termination' }>['payload'];
      relatedUserIds?: UserId[];
    }
  | {
      id?: TicketId;
      /** Which generator scenario raised this, for the reviewer. */
      scenarioId?: string;
      kind: 'access-request';
      requesterId: UserId;
      subject: string;
      body: string;
      priority?: Ticket['priority'];
      payload: Extract<Ticket, { kind: 'access-request' }>['payload'];
      relatedUserIds?: UserId[];
    }
  | {
      id?: TicketId;
      /** Which generator scenario raised this, for the reviewer. */
      scenarioId?: string;
      kind: 'password-reset';
      requesterId: UserId;
      subject: string;
      body: string;
      priority?: Ticket['priority'];
      payload: Extract<Ticket, { kind: 'password-reset' }>['payload'];
      relatedUserIds?: UserId[];
    }
  | {
      id?: TicketId;
      /** Which generator scenario raised this, for the reviewer. */
      scenarioId?: string;
      kind: 'mfa-issue';
      requesterId: UserId;
      subject: string;
      body: string;
      priority?: Ticket['priority'];
      payload: Extract<Ticket, { kind: 'mfa-issue' }>['payload'];
      relatedUserIds?: UserId[];
    }
  | {
      id?: TicketId;
      /** Which generator scenario raised this, for the reviewer. */
      scenarioId?: string;
      kind: 'incident';
      requesterId: UserId;
      subject: string;
      body: string;
      priority?: Ticket['priority'];
      payload: Extract<Ticket, { kind: 'incident' }>['payload'];
      relatedUserIds?: UserId[];
    };

export class MockTicketQueue {
  private tickets = new Map<TicketId, Ticket>();

  constructor(private readonly audit: MockAuditLog) {}

  list(filter?: { kind?: TicketKind; status?: Ticket['status'] }): Ticket[] {
    const all = Array.from(this.tickets.values());
    if (!filter) return all;
    return all.filter((t) => {
      if (filter.kind && t.kind !== filter.kind) return false;
      if (filter.status && t.status !== filter.status) return false;
      return true;
    });
  }

  get(id: TicketId): Ticket | undefined {
    return this.tickets.get(id);
  }

  create(t: NewTicket): Ticket {
    const id = t.id ?? mkTicketId();
    const now = Date.now();
    const base = {
      id,
      status: 'open' as Ticket['status'],
      priority: (t.priority ?? 'normal') as Ticket['priority'],
      requesterId: t.requesterId,
      subject: t.subject,
      body: t.body,
      createdAt: now,
      updatedAt: now,
      approvals: [],
      comments: [],
      relatedUserIds: t.relatedUserIds ?? [],
      // Kept so the reviewer can tell a ticket about the estate from one
      // about a person. It was discarded here, which is what made the
      // structural tickets impossible to resolve.
      ...(t.scenarioId ? { scenarioId: t.scenarioId } : {}),
    };
    const ticket = { kind: t.kind, ...base, payload: t.payload } as Ticket;
    this.tickets.set(id, ticket);
    this.audit.record({ actorId: t.requesterId, action: 'ticket.created', targetId: id });
    return ticket;
  }

  assign(id: TicketId, by: UserId): void {
    const t = this.tickets.get(id);
    if (!t) return;
    t.assigneeId = by;
    t.status = 'in-progress';
    t.updatedAt = Date.now();
  }

  comment(id: TicketId, by: UserId, body: string): void {
    const t = this.tickets.get(id);
    if (!t) return;
    t.comments.push({ authorId: by, at: Date.now(), body });
    t.updatedAt = Date.now();
  }

  /**
   * Record a breach for every ticket that has passed its target.
   *
   * Idempotent: slaBreachedAt is the flag, so a caller on a one-second timer
   * does not fill the audit log with one entry per second per overdue ticket,
   * which would be the same as having no entry at all.
   *
   * Returns the tickets that breached on this pass, so a caller can say so
   * once rather than re-announcing every ticket already known to be late.
   */
  sweepSla(now = Date.now()): Ticket[] {
    const fresh: Ticket[] = [];
    for (const t of this.tickets.values()) {
      if (t.slaBreachedAt !== undefined) continue;
      if (!isOverdue(t, now)) continue;
      t.slaBreachedAt = now;
      this.audit.record({
        actorId: 'system' as UserId,
        action: 'ticket.slaBreached',
        targetId: t.id,
        note:
          `${t.priority} ticket "${t.subject}" passed its ` +
          `${Math.round(SLA_MS[t.priority] / 60000)}-minute response target.`,
      });
      fresh.push(t);
    }
    return fresh;
  }

  resolve(id: TicketId, by: UserId): void {
    const t = this.tickets.get(id);
    if (!t) return;
    // Sweep before closing it. A ticket finished twenty minutes late is
    // recorded as late even if nobody had the queue open to watch the clock
    // run out.
    this.sweepSla();
    t.status = 'resolved';
    t.updatedAt = Date.now();
    this.audit.record({ actorId: by, action: 'ticket.resolved', targetId: id });
  }

  /** Update one or more mutable fields on a ticket (e.g. priority change from
   *  a bulk action). Does not bypass the audit log — the caller is expected
   *  to record a meaningful event for any change made here. */
  update(id: TicketId, patch: Partial<Pick<Ticket, 'priority' | 'assigneeId' | 'status'>>): void {
    const t = this.tickets.get(id);
    if (!t) return;
    if (patch.priority !== undefined) t.priority = patch.priority;
    if (patch.assigneeId !== undefined) t.assigneeId = patch.assigneeId;
    if (patch.status !== undefined) t.status = patch.status;
    t.updatedAt = Date.now();
  }

  escalate(id: TicketId, by: UserId): void {
    const t = this.tickets.get(id);
    if (!t) return;
    t.priority = 'urgent';
    t.updatedAt = Date.now();
    this.audit.record({ actorId: by, action: 'ticket.escalated', targetId: id });
  }

  reset(): void {
    this.tickets.clear();
  }
}
