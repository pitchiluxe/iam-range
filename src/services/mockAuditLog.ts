/**
 * services/mockAuditLog.ts — append-only audit log.
 * The bus is the in-process pub/sub used by the conductor.
 */
import { nanoid } from 'nanoid';
import type { AuditEvent, UserId } from '@/domain';
import { mkAuditId } from '@/domain';
import type { EventBus } from '@/util';
import { createEventBus } from '@/util';
import { report } from '@/util/errors';

/** What services pass to record(). */
export interface AuditRecordInput {
  actorId: UserId;
  action: AuditEvent['action'];
  targetId?: string;
  subjectId?: string;
  sessionId?: import('@/domain').SessionId;
  ip?: string;
  mfaUsed?: import('@/domain').MfaMethod;
  diff?: Record<string, unknown>;
  note?: string;
  at?: number;
}

export class MockAuditLog {
  readonly events: AuditEvent[] = [];
  readonly bus: EventBus;

  constructor(bus: EventBus = createEventBus()) {
    this.bus = bus;
  }

  record(input: AuditRecordInput): AuditEvent {
    let event: AuditEvent;
    try {
      event = {
        id: mkAuditId(nanoid(10)),
        at: input.at ?? Date.now(),
        actorId: input.actorId,
        action: input.action,
        ...(input.targetId ? { targetId: input.targetId } : {}),
        ...(input.subjectId ? { subjectId: input.subjectId } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.ip ? { ip: input.ip } : {}),
        ...(input.mfaUsed ? { mfaUsed: input.mfaUsed } : {}),
        ...(input.diff ? { diff: input.diff } : {}),
      };
    } catch (e) {
      report(
        'service-call-failed',
        `audit.record() failed: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e },
      );
      throw e; // Let the caller handle the failure via their Result type
    }
    try {
      this.events.push(event);
      this.bus.emit('audit', event);
    } catch (e) {
      // Bus listeners threw — record the event but don't block on listeners.
      report(
        'service-call-failed',
        `audit bus emit failed: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e },
      );
    }
    return event;
  }

  byUser(userId: UserId): AuditEvent[] {
    return this.events.filter(
      (e) => e.actorId === userId || e.targetId === userId || e.subjectId === userId,
    );
  }

  since(at: number): AuditEvent[] {
    return this.events.filter((e) => e.at >= at);
  }
  byAction(prefix: string): AuditEvent[] {
    return this.events.filter((e) => e.action.startsWith(prefix));
  }
  tail(n: number): AuditEvent[] {
    return this.events.slice(-n).reverse();
  }

  reset(): void {
    this.events.length = 0;
  }
}
