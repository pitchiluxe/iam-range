/**
 * stores/errorStore.ts — global error log.
 *
 * Holds the most recent error reports (max 20) and exposes a lastError field
 * so the toast UI can subscribe and show the latest non-fatal error.
 * Errors are NOT persisted to localStorage.
 */
import { create } from 'zustand';
import type { AppErrorKind, AppErrorReport } from '@/util/errors';

const MAX_ERRORS = 20;

interface ErrorState {
  errors: AppErrorReport[];
  /** Convenience accessor for the most recent error. */
  lastError: AppErrorReport | null;
  record(report: AppErrorReport): void;
  clear(): void;
}

export const errorStore = create<ErrorState>()((set) => ({
  errors: [],
  lastError: null,

  record(report) {
    set((s) => {
      const next = [report, ...s.errors].slice(0, MAX_ERRORS);
      return { errors: next, lastError: next[0] ?? null };
    });
  },

  clear() {
    set({ errors: [], lastError: null });
  },
}));

/** Returns true for errors that should render a full-page fallback. */
export function isFatalKind(kind: AppErrorKind): boolean {
  return kind === 'zone-build-failed' || kind === 'webgl-lost';
}
