/**
 * util/assert.ts — simple assertion helpers.
 */
export function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
  if (!condition) throw new Error(`[assert] ${message}`);
}

export function assertNever(x: never, message = 'Unexpected value'): never {
  throw new Error(`[assert] ${message}: ${x}`);
}

/** Assert a value is not null or undefined. */
export function assertDefined<T>(
  val: T | null | undefined,
  message = 'Value is null/undefined',
): T {
  if (val === null || val === undefined) throw new Error(`[assert] ${message}`);
  return val;
}
