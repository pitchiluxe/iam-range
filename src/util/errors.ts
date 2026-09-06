/**
 * util/errors.ts — typed error categories and the global report() helper.
 *
 * Used by zone builders, console renderers, and service wrappers so a single
 * failure doesn't crash the app — it lands in the error store, surfaces as a
 * toast, and (for zone/console failures) renders an in-place fallback.
 */
import { errorStore } from '@/stores/errorStore';

export type AppErrorKind =
  | 'zone-build-failed'
  | 'webgl-lost'
  | 'console-render-failed'
  | 'service-call-failed'
  | 'unhandled';

export interface AppErrorReport {
  kind: AppErrorKind;
  message: string;
  context?: Record<string, unknown>;
  cause?: unknown;
  timestamp: number;
}

export class AppError extends Error {
  public readonly kind: AppErrorKind;
  public readonly context?: Record<string, unknown>;
  public readonly cause?: unknown;

  constructor(
    kind: AppErrorKind,
    message: string,
    opts: { context?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.kind = kind;
    this.context = opts.context;
    this.cause = opts.cause;
  }

  toReport(): AppErrorReport {
    return {
      kind: this.kind,
      message: this.message,
      context: this.context,
      cause: this.cause,
      timestamp: Date.now(),
    };
  }
}

/**
 * Central error sink. Always safe to call — never throws.
 * Records the error in the errorStore and logs to the console.
 */
export function report(
  kind: AppErrorKind,
  message: string,
  opts: { context?: Record<string, unknown>; cause?: unknown } = {},
): void {
  try {
    const err = new AppError(kind, message, opts);
    errorStore.getState().record(err.toReport());
    console.error(`[${kind}] ${message}`, opts.context ?? '', opts.cause ?? '');
  } catch (sink) {
    // If even the error sink breaks, log raw.
    console.error('[report-failed]', kind, message, sink);
  }
}

/**
 * Run a function with an automatic try/catch that routes to report().
 * Returns a fallback value (or undefined) on error.
 */
export function safe<T>(kind: AppErrorKind, fn: () => T, fallback?: T): T | undefined {
  try {
    return fn();
  } catch (e) {
    report(kind, e instanceof Error ? e.message : String(e), { cause: e });
    return fallback;
  }
}
