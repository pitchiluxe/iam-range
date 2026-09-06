/**
 * services/mockTicketQueue.ts — in-memory queue of tickets.
 */
import type { Ticket, TicketId, TicketKind, UserId } from '@/domain';
import { mkTicketId } from '@/domain';
import type { MockAuditLog } from './mockAuditLog';

export type NewTicket =
  | {
      id?: TicketId;
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

  resolve(id: TicketId, by: UserId): void {
    const t = this.tickets.get(id);
    if (!t) return;
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
