/**
 * stores/ticketStore.ts — ticket queue state.
 */
import { create } from 'zustand';
import type { Ticket, TicketId } from '@/domain';

interface TicketState {
  tickets: Ticket[];
  selectedId: TicketId | null;
  resolvedCount: number;
  setTickets(tickets: Ticket[]): void;
  select(id: TicketId | null): void;
  incrementResolved(): void;
  refresh(): void; // placeholder — services push directly
}

export const ticketStore = create<TicketState>()((set) => ({
  tickets: [],
  selectedId: null,
  resolvedCount: 0,
  setTickets(tickets) {
    set({ tickets });
  },
  select(id) {
    set({ selectedId: id });
  },
  incrementResolved() {
    set((s) => ({ resolvedCount: s.resolvedCount + 1 }));
  },
  refresh() {
    /* placeholder; overwritten by conductor wiring */
  },
}));
