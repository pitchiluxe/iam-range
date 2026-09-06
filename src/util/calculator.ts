/**
 * util/calculator.ts — arithmetic evaluator for the VM calculator.
 *
 * Hand-written rather than eval(): input here is trusted, but this keeps
 * precedence, division by zero and malformed input as explicit, testable
 * behaviour instead of whatever the JS engine happens to do, and avoids
 * teaching a reflex worth not having.
 *
 * Grammar is deliberately small — numbers, + - * /, an optional leading
 * minus. No parentheses, no functions: the keypad cannot produce them, and a
 * parser that accepts more than the UI can enter is untested surface.
 */

export type CalcResult = { ok: true; value: number } | { ok: false; error: string };

type Token = { kind: 'num'; value: number } | { kind: 'op'; value: '+' | '-' | '*' | '/' };

const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };

/** Split into numbers and operators, or null if anything else appears. */
function tokenize(expr: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i]!;

    if (ch === ' ') {
      i++;
      continue;
    }

    if (/[0-9.]/.test(ch)) {
      let num = '';
      while (i < expr.length && /[0-9.]/.test(expr[i]!)) num += expr[i++]!;
      // Reject '1.2.3' — Number() would give NaN, but say so deliberately.
      if ((num.match(/\./g) ?? []).length > 1) return null;
      const value = Number(num);
      if (!Number.isFinite(value)) return null;
      tokens.push({ kind: 'num', value });
      continue;
    }

    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      // A leading '-' (or one right after another operator) is a sign, not a
      // binary operator: fold it into the number that follows.
      const isUnaryMinus =
        ch === '-' && (tokens.length === 0 || tokens[tokens.length - 1]!.kind === 'op');
      if (isUnaryMinus) {
        let num = '';
        i++;
        while (i < expr.length && /[0-9.]/.test(expr[i]!)) num += expr[i++]!;
        if (num === '') return null;
        const value = Number(num);
        if (!Number.isFinite(value)) return null;
        tokens.push({ kind: 'num', value: -value });
        continue;
      }
      tokens.push({ kind: 'op', value: ch });
      i++;
      continue;
    }

    return null; // letters, parentheses, anything else
  }

  return tokens;
}

/** Numbers and operators must alternate, starting and ending with a number. */
function isWellFormed(tokens: Token[]): boolean {
  if (tokens.length === 0) return false;
  for (let i = 0; i < tokens.length; i++) {
    const expected = i % 2 === 0 ? 'num' : 'op';
    if (tokens[i]!.kind !== expected) return false;
  }
  return tokens[tokens.length - 1]!.kind === 'num';
}

function apply(a: number, op: string, b: number): CalcResult {
  switch (op) {
    case '+':
      return { ok: true, value: a + b };
    case '-':
      return { ok: true, value: a - b };
    case '*':
      return { ok: true, value: a * b };
    case '/':
      // Explicit: JS would return Infinity, which is not a useful thing to put
      // on a calculator display.
      if (b === 0) return { ok: false, error: 'Cannot divide by zero' };
      return { ok: true, value: a / b };
    default:
      return { ok: false, error: 'Invalid expression' };
  }
}

/**
 * Trim binary floating-point dust so 0.1+0.2 reads as 0.3.
 *
 * 12 significant digits is comfortably inside a double's ~15-17 and well past
 * anything a four-function keypad can enter.
 */
function tidy(n: number): number {
  return Number.parseFloat(n.toPrecision(12));
}

/** Evaluate an arithmetic expression written in keypad syntax. */
export function evaluateExpression(expr: string): CalcResult {
  const tokens = tokenize(expr.trim());
  if (!tokens || !isWellFormed(tokens)) return { ok: false, error: 'Invalid expression' };

  // Shunting-yard into two stacks, folding whenever the operator on top binds
  // at least as tightly as the one arriving — which gives left-to-right order
  // within a precedence level.
  const nums: number[] = [];
  const ops: string[] = [];

  const fold = (): CalcResult | null => {
    const op = ops.pop()!;
    const b = nums.pop()!;
    const a = nums.pop()!;
    const r = apply(a, op, b);
    if (!r.ok) return r;
    nums.push(r.value);
    return null;
  };

  for (const t of tokens) {
    if (t.kind === 'num') {
      nums.push(t.value);
      continue;
    }
    while (ops.length > 0 && PRECEDENCE[ops[ops.length - 1]!]! >= PRECEDENCE[t.value]!) {
      const err = fold();
      if (err) return err;
    }
    ops.push(t.value);
  }

  while (ops.length > 0) {
    const err = fold();
    if (err) return err;
  }

  const value = nums[0];
  if (value === undefined || !Number.isFinite(value)) {
    return { ok: false, error: 'Invalid expression' };
  }
  return { ok: true, value: tidy(value) };
}
