/**
 * util/events.ts — tiny in-process event bus.
 * Used by services to emit domain events that the conductor subscribes to.
 * No external dependencies.
 */

/** Any serializable payload. */
export type EventPayload = unknown;

export type EventHandler = (payload: EventPayload) => void;

export interface EventBus {
  on(event: string, handler: EventHandler): () => void;
  off(event: string, handler: EventHandler): void;
  emit(event: string, payload?: EventPayload): void;
}

/** Create a new EventBus. */
export function createEventBus(): EventBus {
  const handlers = new Map<string, Set<EventHandler>>();

  return {
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
      // Return an unsubscribe function
      return () => this.off(event, handler);
    },

    off(event, handler) {
      handlers.get(event)?.delete(handler);
    },

    emit(event, payload) {
      handlers.get(event)?.forEach((h) => {
        try {
          h(payload);
        } catch (e) {
          console.error('[bus]', event, e);
        }
      });
    },
  };
}
