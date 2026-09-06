/**
 * stores/auditStore.ts — audit event state.
 */
import { create } from 'zustand';
import type { AuditEvent, UserId } from '@/domain';

interface AuditFilter {
  actorId?: UserId;
  action?: string;
  sinceAt?: number;
}

interface AuditState {
  events: AuditEvent[];
  filter: AuditFilter;
  append(e: AuditEvent): void;
  setFilter(f: Partial<AuditFilter>): void;
  byUser(userId: UserId): AuditEvent[];
  reset(): void;
}

export const auditStore = create<AuditState>()((set, get) => ({
  events: [],
  filter: {},

  append(e) {
    set((s) => ({ events: [...s.events, e] }));
  },

  setFilter(f) {
    set((s) => ({ filter: { ...s.filter, ...f } }));
  },

  byUser(userId: UserId) {
    return get().events.filter(
      (e) => e.actorId === userId || e.targetId === userId || e.subjectId === userId,
    );
  },

  reset() {
    set({ events: [], filter: {} });
  },
}));
